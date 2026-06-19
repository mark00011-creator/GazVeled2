import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { GasOrderGroup, OrderableCylinder } from "@/lib/gas-order";
import { buildPurchasePriceMap, fetchProductPrices } from "@/lib/product-prices";
import { priceKey } from "@/lib/gas-order-prices";
import { formatSupabaseError } from "@/lib/supabase-error";

export type GasOrderStatus = Database["public"]["Enums"]["gas_order_status"];

export const gasOrderStatusLabels: Record<GasOrderStatus, string> = {
  planned: "Tervezet",
  ordered: "Megrendelve",
  received: "Megérkezett",
};

export type GasOrderRow = {
  id: string;
  status: GasOrderStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  item_count?: number;
};

export type GasOrderItemRow = {
  id: string;
  gas_order_id: string;
  cylinder_id: string | null;
  barcode: string;
  gas_type: string;
  size: string;
  circulation: string;
  beszerzesi_ar: number | null;
};

export async function fetchGasOrders(): Promise<GasOrderRow[]> {
  const { data, error } = await supabase
    .from("gas_orders")
    .select("*, gas_order_items(count)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(formatSupabaseError(error, "Rendelések betöltése"));

  return (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    item_count: (row.gas_order_items as { count: number }[] | null)?.[0]?.count ?? 0,
  }));
}

export async function fetchGasOrderItems(orderId: string): Promise<GasOrderItemRow[]> {
  const { data, error } = await supabase
    .from("gas_order_items")
    .select("*")
    .eq("gas_order_id", orderId)
    .order("barcode");

  if (error) throw new Error(formatSupabaseError(error, "Rendelés tételek"));
  return (data ?? []) as GasOrderItemRow[];
}

export async function createGasOrderFromGroup(
  group: GasOrderGroup,
  note?: string,
): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const prices = await fetchProductPrices(true);
  const purchaseMap = buildPurchasePriceMap(prices);
  const all: OrderableCylinder[] = [...group.siad, ...group.own];

  const { data: order, error: orderErr } = await supabase
    .from("gas_orders")
    .insert({ status: "planned", note: note?.trim() || null, created_by: auth.user?.id ?? null })
    .select("id")
    .single();

  if (orderErr || !order) throw new Error(formatSupabaseError(orderErr, "Rendelés létrehozása"));

  const items = all.map((c) => ({
    gas_order_id: order.id,
    cylinder_id: c.id,
    barcode: c.barcode,
    gas_type: c.gas_type,
    size: c.size,
    circulation: c.circulation,
    beszerzesi_ar: purchaseMap.get(priceKey(c.gas_type, c.size)) ?? null,
  }));

  if (items.length > 0) {
    const { error: itemsErr } = await supabase.from("gas_order_items").insert(items);
    if (itemsErr) throw new Error(formatSupabaseError(itemsErr, "Rendelés tételek mentése"));
  }

  return order.id;
}

export async function updateGasOrderStatus(orderId: string, status: GasOrderStatus): Promise<void> {
  const { error } = await supabase.from("gas_orders").update({ status }).eq("id", orderId);
  if (error) throw new Error(formatSupabaseError(error, "Státusz mentése"));
}

export async function deleteGasOrder(orderId: string): Promise<void> {
  const { error } = await supabase.from("gas_orders").delete().eq("id", orderId);
  if (error) throw new Error(formatSupabaseError(error, "Rendelés törlése"));
}
