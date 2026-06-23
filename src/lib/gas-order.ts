import { supabase } from "@/integrations/supabase/client";
import type { Circulation } from "@/lib/labels";

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

export type GasOrderSummaryLine = {
  label: string;
  count: number;
};

function summarizeGroup(cylinders: OrderableCylinder[]): GasOrderSummaryLine[] {
  const counts = new Map<string, number>();
  for (const c of cylinders) {
    const key = `${c.gas_type} ${c.size}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label, "hu"));
}

export function summarizeGasOrder(group: GasOrderGroup): {
  siad: GasOrderSummaryLine[];
  own: GasOrderSummaryLine[];
} {
  return {
    siad: summarizeGroup(group.siad),
    own: summarizeGroup(group.own),
  };
}

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

function formatDottedLine(label: string, count: number): string {
  const right = `${count} db`;
  const dots = ".".repeat(Math.max(4, 36 - label.length - right.length));
  return `${label} ${dots} ${right}`;
}

function mergedSerialSummary(group: GasOrderGroup): GasOrderSummaryLine[] {
  const counts = new Map<string, number>();
  for (const c of [...group.siad, ...group.own]) {
    const label = `${c.gas_type} ${c.size}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label, "hu"));
}

export type Supplier1QuantityLine = {
  stock_kind: "chinese" | "prima_pb";
  gas_type: string;
  size: string;
  quantity: number;
  label: string;
};

export function quantityOrderLabel(line: Supplier1QuantityLine): string {
  if (line.stock_kind === "prima_pb") return `${line.size} ${line.gas_type} (PRÍMA PB)`;
  return `${line.gas_type} ${line.size} (Chinese)`;
}

export function buildSupplier1GasOrderText(
  group: GasOrderGroup,
  quantityLines: Supplier1QuantityLine[],
): string {
  const bodyLines: string[] = [];

  for (const line of mergedSerialSummary(group)) {
    bodyLines.push(formatDottedLine(line.label, line.count));
  }

  const sortedQty = [...quantityLines].sort((a, b) =>
    quantityOrderLabel(a).localeCompare(quantityOrderLabel(b), "hu"),
  );
  if (sortedQty.length > 0 && bodyLines.length > 0) bodyLines.push("");
  for (const line of sortedQty) {
    bodyLines.push(formatDottedLine(quantityOrderLabel(line), line.quantity));
  }

  const body = bodyLines.length === 0 ? "(nincs)" : bodyLines.join("\n");

  return [
    "Kedves Géza!",
    "",
    "Szeretném megrendelni a következő palackok cseréjét.",
    "",
    body,
    "",
    "Előre is köszönöm!",
    "",
    "Üdvözlettel:",
    "Horváth Márk",
    "Gáz Veled",
  ].join("\n");
}

/** @deprecated Use buildSupplier1GasOrderText for supplier-1 orders */
export function buildGasOrderText(group: GasOrderGroup): string {
  return buildSupplier1GasOrderText(group, []);
}

export function countOrderable(group: GasOrderGroup): { siad: number; own: number } {
  return { siad: group.siad.length, own: group.own.length };
}
