import { supabase } from "@/integrations/supabase/client";
import type { Circulation } from "@/lib/labels";
import {
  buildGasOrderEmailText,
  estimateGasOrderPrices,
  type GasOrderPricedLineInput,
} from "@/lib/gas-order-prices";

export type OrderableCylinder = {
  id: string;
  barcode: string;
  gas_type: string;
  size: string;
  circulation: Circulation;
};

export type GasOrderGroup = {
  siad: OrderableCylinder[];
  own: OrderableCylinder[];
};

export async function fetchOrderableCylinders(): Promise<GasOrderGroup> {
  const { data, error } = await supabase
    .from("cylinders")
    .select("id, barcode, gas_type, size, circulation")
    .eq("active", true)
    .eq("status", "empty")
    .eq("location_type", "warehouse_empty")
    .in("circulation", ["siad", "own"])
    .order("circulation")
    .order("gas_type")
    .order("size")
    .order("barcode");

  if (error) throw error;

  const siad: OrderableCylinder[] = [];
  const own: OrderableCylinder[] = [];

  for (const row of data ?? []) {
    const cyl: OrderableCylinder = {
      id: row.id,
      barcode: row.barcode,
      gas_type: row.gas_type,
      size: row.size,
      circulation: row.circulation as Circulation,
    };
    if (cyl.circulation === "siad") siad.push(cyl);
    else if (cyl.circulation === "own") own.push(cyl);
  }

  return { siad, own };
}

export type Supplier1QuantityLine = GasOrderPricedLineInput & {
  stock_kind: "chinese" | "prima_pb";
};

export function buildSupplier1GasOrderText(
  group: GasOrderGroup,
  quantityLines: GasOrderPricedLineInput[],
  priceMap: Map<string, number>,
): string {
  const estimate = estimateGasOrderPrices(group, quantityLines, priceMap);
  return buildGasOrderEmailText(estimate);
}

/** @deprecated Use buildSupplier1GasOrderText with priceMap */
export function buildGasOrderText(group: GasOrderGroup): string {
  return buildSupplier1GasOrderText(group, [], new Map());
}

export function countOrderable(group: GasOrderGroup): { siad: number; own: number } {
  return { siad: group.siad.length, own: group.own.length };
}
