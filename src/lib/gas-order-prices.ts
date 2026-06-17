import type { GasOrderGroup, OrderableCylinder } from "@/lib/gas-order";

const GAS_ALIASES: Record<string, string> = {
  széndioxid: "széndioxid",
  szendioxid: "széndioxid",
  "szén-dioxid": "széndioxid",
  "szen-dioxid": "széndioxid",
  co2: "széndioxid",
  argon: "argon",
  acetilén: "acetilén",
  acetilen: "acetilén",
  stargon: "stargon",
  nitrogén: "nitrogén",
  nitrogen: "nitrogén",
  oxigén: "oxigén",
  oxygen: "oxigén",
};

export function normalizeGasType(gas: string): string {
  const key = gas.trim().toLowerCase();
  return GAS_ALIASES[key] ?? key;
}

export function normalizeSize(size: string): string {
  const s = size.trim().replace(/\s+/g, " ");
  const lower = s.toLowerCase();
  const liter = lower.match(/^(\d+)\s*l$/);
  if (liter) return `${liter[1]} l`;
  if (lower === "1-5kg" || lower === "1-5 kg") return "1-5 kg";
  const kg = lower.match(/^(\d+(?:[.,]\d+)?)\s*kg$/);
  if (kg) return `${kg[1].replace(".", ",")} kg`;
  return s;
}

export function priceKey(gasType: string, size: string): string {
  return `${normalizeGasType(gasType)}|${normalizeSize(size)}`;
}

export function lookupUnitPrice(
  gasType: string,
  size: string,
  priceMap: Map<string, number>,
): number | null {
  const price = priceMap.get(priceKey(gasType, size));
  return price != null && price > 0 ? price : null;
}

export type GasOrderEstimateLine = {
  label: string;
  count: number;
  unitPrice: number | null;
  lineTotal: number | null;
};

export type GasOrderEstimate = {
  lines: GasOrderEstimateLine[];
  knownTotal: number;
  cylinderCount: number;
  pricedCount: number;
  unknownLabels: string[];
};

function allCylinders(group: GasOrderGroup): OrderableCylinder[] {
  return [...group.siad, ...group.own];
}

export function estimateGasOrderCost(group: GasOrderGroup, priceMap: Map<string, number>): GasOrderEstimate {
  const counts = new Map<string, { label: string; gasType: string; size: string; count: number }>();

  for (const c of allCylinders(group)) {
    const gasType = normalizeGasType(c.gas_type);
    const size = normalizeSize(c.size);
    const key = `${gasType}|${size}`;
    const label = `${c.gas_type} ${c.size}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { label, gasType, size, count: 1 });
  }

  const lines: GasOrderEstimateLine[] = [];
  const unknownLabels: string[] = [];
  let knownTotal = 0;
  let pricedCount = 0;

  for (const { label, gasType, size, count } of counts.values()) {
    const unitPrice = lookupUnitPrice(gasType, size, priceMap);
    const lineTotal = unitPrice != null ? unitPrice * count : null;
    lines.push({ label, count, unitPrice, lineTotal });
    if (lineTotal != null) {
      knownTotal += lineTotal;
      pricedCount += count;
    } else {
      unknownLabels.push(`${label} (${count} db)`);
    }
  }

  lines.sort((a, b) => a.label.localeCompare(b.label, "hu"));

  return {
    lines,
    knownTotal,
    cylinderCount: allCylinders(group).length,
    pricedCount,
    unknownLabels,
  };
}

export function formatHuf(amount: number): string {
  return `${amount.toLocaleString("hu-HU")} Ft`;
}
