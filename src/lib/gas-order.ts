import { supabase } from "@/integrations/supabase/client";
import type { Circulation, Manufacturer } from "@/lib/labels";
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
  manufacturer: Manufacturer | null;
};

export const SERIAL_GROUP_KEYS = [
  "siad_rental",
  "own_siad",
  "linde",
  "messer",
  "other",
] as const;

export type SerialGroupKey = (typeof SERIAL_GROUP_KEYS)[number];

export const serialGroupTitles: Record<SerialGroupKey, string> = {
  siad_rental: "Sorszámos – SIAD bérpalack",
  own_siad: "Sorszámos – Saját SIAD",
  linde: "Sorszámos – LINDE",
  messer: "Sorszámos – MESSER",
  other: "Sorszámos – Egyéb",
};

export type GasOrderGroup = {
  siad_rental: OrderableCylinder[];
  own_siad: OrderableCylinder[];
  linde: OrderableCylinder[];
  messer: OrderableCylinder[];
  other: OrderableCylinder[];
};

export function classifySerialCylinder(cylinder: Pick<OrderableCylinder, "circulation" | "manufacturer">): SerialGroupKey {
  if (cylinder.circulation === "siad") return "siad_rental";
  if (cylinder.manufacturer === "siad") return "own_siad";
  if (cylinder.manufacturer === "linde") return "linde";
  if (cylinder.manufacturer === "messer") return "messer";
  return "other";
}

export function emptyGasOrderGroup(): GasOrderGroup {
  return {
    siad_rental: [],
    own_siad: [],
    linde: [],
    messer: [],
    other: [],
  };
}

export function allSerialCylinders(group: GasOrderGroup): OrderableCylinder[] {
  return SERIAL_GROUP_KEYS.flatMap((key) => group[key]);
}

export function countSerialCylinders(group: GasOrderGroup): number {
  return allSerialCylinders(group).length;
}

export async function fetchOrderableCylinders(): Promise<GasOrderGroup> {
  const { data, error } = await supabase
    .from("cylinders")
    .select("id, barcode, gas_type, size, circulation, manufacturer")
    .eq("active", true)
    .eq("status", "empty")
    .eq("location_type", "warehouse_empty")
    .in("circulation", ["siad", "own"])
    .order("circulation")
    .order("gas_type")
    .order("size")
    .order("barcode");

  if (error) throw error;

  const group = emptyGasOrderGroup();

  for (const row of data ?? []) {
    const cyl: OrderableCylinder = {
      id: row.id,
      barcode: row.barcode,
      gas_type: row.gas_type,
      size: row.size,
      circulation: row.circulation as Circulation,
      manufacturer: (row.manufacturer as Manufacturer | null) ?? null,
    };
    group[classifySerialCylinder(cyl)].push(cyl);
  }

  return group;
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

export function countOrderable(group: GasOrderGroup): Record<SerialGroupKey, number> {
  return Object.fromEntries(SERIAL_GROUP_KEYS.map((key) => [key, group[key].length])) as Record<
    SerialGroupKey,
    number
  >;
}
