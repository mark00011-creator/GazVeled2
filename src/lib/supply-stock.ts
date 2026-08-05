import { supabase } from "@/integrations/supabase/client";
import { formatSupabaseError } from "@/lib/supabase-error";

export type SupplyProduct = {
  id: string;
  stock_kind: string;
  natural_key: string;
  name: string;
  category: string | null;
  brand: string | null;
  product_type: string | null;
  specification: string | null;
  packaging: string | null;
  unit_of_measure: string;
  current_stock: number | null;
  minimum_stock: number;
  purchase_price: number | null;
  sale_price: number | null;
  vat_rate: number;
  is_active: boolean;
  is_sellable: boolean;
  is_rentable: boolean;
  note: string | null;
  updated_at: string;
};

export type SupplyMovement = {
  id: string;
  product_id: string;
  movement_type: string;
  quantity: number;
  stock_before: number;
  stock_after: number;
  partner_id: string | null;
  supplier_id: string | null;
  related_sale_id: string | null;
  unit_price: number | null;
  total_amount: number | null;
  document_number: string | null;
  purchase_date: string | null;
  event_group_id: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type SupplySaleItem = {
  id: string;
  sale_id: string;
  product_id: string;
  quantity: number;
  unit_of_measure: string;
  unit_price: number;
  line_net: number;
  vat_rate: number;
  line_vat: number;
  line_gross: number;
  note: string | null;
  product_name: string | null;
  specification: string | null;
  packaging: string | null;
  purchase_unit_price: number | null;
  profit_per_unit: number | null;
  line_purchase_value: number | null;
  line_profit: number | null;
  margin_percent: number | null;
};

export type SupplySale = {
  id: string;
  partner_id: string;
  sale_date: string;
  total_net: number;
  total_vat: number;
  total_gross: number;
  total_purchase_value: number | null;
  total_profit: number | null;
  note: string | null;
  event_group_id: string | null;
  created_by: string | null;
  created_at: string;
  partner?: { name: string; company_name: string | null } | null;
  items?: SupplySaleItem[];
  billing?: { status: string }[];
};

export type SupplySaleLineInput = {
  product_id: string;
  quantity: number;
  unit_price?: number | null;
};

export const SUPPLY_MOVEMENT_LABELS: Record<string, string> = {
  receipt: "Bevételezés",
  sale: "Értékesítés",
  customer_return: "Vevői visszavétel",
  correction_increase: "Korrekció (+)",
  correction_decrease: "Korrekció (−)",
  scrap: "Selejt",
  internal_use: "Belső felhasználás",
  stocktake_delta: "Leltárkülönbözet",
  rental_out: "Bérbe adás",
  rental_return: "Bérlet visszavétel",
};

export const BILLING_STATUS_LABELS: Record<string, string> = {
  pending: "Számlázásra vár",
  exported: "Exportálva",
  invoiced: "Kiszámlázva",
  cancelled: "Törölve",
};

export async function fetchSupplyProducts(): Promise<SupplyProduct[]> {
  const { data, error } = await supabase
    .from("supply_products")
    .select("*")
    .order("name");
  if (error) throw new Error(formatSupabaseError(error, "Készlet betöltése"));
  return (data ?? []) as SupplyProduct[];
}

export async function fetchSupplyMovements(productId: string): Promise<SupplyMovement[]> {
  const { data, error } = await supabase
    .from("supply_stock_movements")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(formatSupabaseError(error, "Mozgások betöltése"));
  return (data ?? []) as SupplyMovement[];
}

export async function fetchSupplySales(): Promise<SupplySale[]> {
  const { data, error } = await supabase
    .from("supply_sales")
    .select(
      `
      *,
      partner:partners(name, company_name),
      items:supply_sale_items(*),
      billing:supply_billing_queue(status)
    `,
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(formatSupabaseError(error, "Értékesítések betöltése"));
  return (data ?? []) as SupplySale[];
}

export async function updateSupplyProductPrices(input: {
  productId: string;
  purchasePrice?: number | null;
  salePrice?: number | null;
  vatRate?: number;
}): Promise<void> {
  const { error } = await supabase.rpc("update_supply_product_prices", {
    p_product_id: input.productId,
    p_purchase_price: input.purchasePrice ?? undefined,
    p_sale_price: input.salePrice ?? undefined,
    p_vat_rate: input.vatRate ?? undefined,
  });
  if (error) throw new Error(formatSupabaseError(error, "Ár mentése"));
}

export async function receiveSupplyStock(input: {
  productId: string;
  quantity: number;
  purchasePrice?: number | null;
  supplierId?: string | null;
  documentNumber?: string;
  purchaseDate?: string;
  note?: string;
}): Promise<void> {
  const { error } = await supabase.rpc("receive_supply_stock", {
    p_product_id: input.productId,
    p_quantity: input.quantity,
    p_purchase_price: input.purchasePrice ?? undefined,
    p_supplier_id: input.supplierId ?? undefined,
    p_document_number: input.documentNumber ?? undefined,
    p_purchase_date: input.purchaseDate ?? undefined,
    p_note: input.note ?? undefined,
  });
  if (error) throw new Error(formatSupabaseError(error, "Bevételezés"));
}

export async function recordSupplySaleBatch(input: {
  partnerId: string;
  items: SupplySaleLineInput[];
  note?: string;
  idempotencyKey?: string;
}): Promise<string> {
  const payload = input.items.map((line) => ({
    product_id: line.product_id,
    quantity: line.quantity,
    ...(line.unit_price != null ? { unit_price: line.unit_price } : {}),
  }));
  const { data, error } = await supabase.rpc("record_supply_sale_batch", {
    p_partner_id: input.partnerId,
    p_items: payload,
    p_note: input.note ?? undefined,
    p_idempotency_key: input.idempotencyKey ?? undefined,
  });
  if (error) throw new Error(formatSupabaseError(error, "Értékesítés"));
  return data as string;
}

export function parsePositiveInt(value: string): number {
  const n = Number(value.replace(/\s/g, ""));
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error("A mennyiségnek pozitív egész számnak kell lennie.");
  }
  return n;
}

export function billingSummaryStatus(rows: { status: string }[] | undefined): string {
  if (!rows?.length) return "pending";
  const statuses = [...new Set(rows.map((r) => r.status))];
  if (statuses.length === 1) return statuses[0];
  if (statuses.every((s) => s === "invoiced" || s === "cancelled")) return statuses[0];
  return "pending";
}

export function partnerDisplayName(p: { name: string; company_name?: string | null }): string {
  return p.company_name?.trim() ? `${p.name} (${p.company_name})` : p.name;
}
