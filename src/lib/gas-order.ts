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

function formatCylinderLine(c: OrderableCylinder): string {
  return `${c.barcode} - ${c.gas_type} ${c.size}`;
}

function formatListBlock(cylinders: OrderableCylinder[]): string {
  if (cylinders.length === 0) return "(nincs)";
  return cylinders.map(formatCylinderLine).join("\n");
}

export function buildGasOrderText(group: GasOrderGroup): string {
  return [
    "Kedves Géza!",
    "",
    "Szeretném megrendelni a következő palackok cseréjét.",
    "",
    "SIAD palackok:",
    "",
    formatListBlock(group.siad),
    "",
    "Saját palackok:",
    "",
    formatListBlock(group.own),
    "",
    "Előre is köszönöm!",
    "",
    "Üdvözlettel:",
    "Horváth Márk",
    "Gáz Veled",
  ].join("\n");
}

export function countOrderable(group: GasOrderGroup): { siad: number; own: number } {
  return { siad: group.siad.length, own: group.own.length };
}
