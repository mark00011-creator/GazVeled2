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

/** Egységes beszerzési egységár: mindig product_prices (gas_type + size). */
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

export type GasOrderPriceEstimate = {
  siad: GasOrderEstimateLine[];
  own: GasOrderEstimateLine[];
  quantity: GasOrderEstimateLine[];
  knownTotal: number;
  itemCount: number;
  pricedCount: number;
  unknownLabels: string[];
};

export type GasOrderPricedLineInput = {
  gas_type: string;
  size: string;
  quantity: number;
  label: string;
};

export function productOrderLabel(gasType: string, size: string): string {
  return `${gasType} ${size}`;
}

/**
 * Közös árszámítás minden palacktípusra (sorszámos + darabszámos).
 * Az ár kizárólag gas_type + size alapján jön a product_prices térképből.
 */
export function calculateGasOrderLine(
  gasType: string,
  size: string,
  quantity: number,
  displayLabel: string,
  priceMap: Map<string, number>,
): GasOrderEstimateLine {
  const unitPrice = lookupUnitPrice(gasType, size, priceMap);
  const lineTotal = unitPrice != null ? unitPrice * quantity : null;
  return { label: displayLabel, count: quantity, unitPrice, lineTotal };
}

function aggregateSerialLines(
  cylinders: OrderableCylinder[],
  priceMap: Map<string, number>,
): GasOrderEstimateLine[] {
  const counts = new Map<
    string,
    { label: string; gasType: string; size: string; count: number }
  >();

  for (const cylinder of cylinders) {
    const key = priceKey(cylinder.gas_type, cylinder.size);
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    counts.set(key, {
      label: productOrderLabel(cylinder.gas_type, cylinder.size),
      gasType: cylinder.gas_type,
      size: cylinder.size,
      count: 1,
    });
  }

  return [...counts.values()]
    .map(({ label, gasType, size, count }) =>
      calculateGasOrderLine(gasType, size, count, label, priceMap),
    )
    .sort((a, b) => a.label.localeCompare(b.label, "hu"));
}

function pricedQuantityLines(
  lines: GasOrderPricedLineInput[],
  priceMap: Map<string, number>,
): GasOrderEstimateLine[] {
  return lines
    .map((line) =>
      calculateGasOrderLine(line.gas_type, line.size, line.quantity, line.label, priceMap),
    )
    .sort((a, b) => a.label.localeCompare(b.label, "hu"));
}

function collectEstimateTotals(lines: GasOrderEstimateLine[]): {
  knownTotal: number;
  pricedCount: number;
  unknownLabels: string[];
} {
  let knownTotal = 0;
  let pricedCount = 0;
  const unknownLabels: string[] = [];

  for (const line of lines) {
    if (line.lineTotal != null) {
      knownTotal += line.lineTotal;
      pricedCount += line.count;
    } else {
      unknownLabels.push(`${line.label} (${line.count} db)`);
    }
  }

  return { knownTotal, pricedCount, unknownLabels };
}

/** Központi gázrendelés árkalkuláció – egyetlen belépési pont. */
export function estimateGasOrderPrices(
  group: GasOrderGroup,
  quantityLines: GasOrderPricedLineInput[],
  priceMap: Map<string, number>,
): GasOrderPriceEstimate {
  const siad = aggregateSerialLines(group.siad, priceMap);
  const own = aggregateSerialLines(group.own, priceMap);
  const quantity = pricedQuantityLines(quantityLines, priceMap);

  const allLines = [...siad, ...own, ...quantity];
  const totals = collectEstimateTotals(allLines);
  const quantityCount = quantityLines.reduce((sum, line) => sum + line.quantity, 0);

  return {
    siad,
    own,
    quantity,
    knownTotal: totals.knownTotal,
    itemCount: group.siad.length + group.own.length + quantityCount,
    pricedCount: totals.pricedCount,
    unknownLabels: totals.unknownLabels,
  };
}

/** @deprecated Use estimateGasOrderPrices */
export const estimateSupplier1GasOrderCost = estimateGasOrderPrices;

export type GasOrderQuantityEstimateInput = GasOrderPricedLineInput;

export function formatGasOrderEstimateLine(line: GasOrderEstimateLine): string {
  if (line.unitPrice != null && line.lineTotal != null) {
    return `${line.label}: ${line.count} db (${formatHuf(line.unitPrice)}/db = ${formatHuf(line.lineTotal)})`;
  }
  return `${line.label}: ${line.count} db`;
}

function formatEstimateSection(title: string, lines: GasOrderEstimateLine[]): string[] {
  if (lines.length === 0) return [];
  return [title, ...lines.map((line) => `- ${formatGasOrderEstimateLine(line)}`)];
}

export function formatGasOrderEstimateBody(estimate: GasOrderPriceEstimate): string {
  const sections = [
    ...formatEstimateSection("Sorszámos – SIAD", estimate.siad),
    ...formatEstimateSection("Sorszámos – Saját", estimate.own),
    ...formatEstimateSection("Darabszámos", estimate.quantity),
  ];

  if (estimate.knownTotal > 0) {
    sections.push("", `Becsült összeg: ${formatHuf(estimate.knownTotal)}`);
  }

  return sections.length === 0 ? "(nincs)" : sections.join("\n");
}

export function buildGasOrderEmailText(estimate: GasOrderPriceEstimate): string {
  const body = formatGasOrderEstimateBody(estimate);

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

/** @deprecated Use estimateGasOrderPrices */
export function estimateGasOrderCost(
  group: GasOrderGroup,
  priceMap: Map<string, number>,
): {
  lines: GasOrderEstimateLine[];
  knownTotal: number;
  cylinderCount: number;
  pricedCount: number;
  unknownLabels: string[];
} {
  const estimate = estimateGasOrderPrices(group, [], priceMap);
  const lines = [...estimate.siad, ...estimate.own];
  return {
    lines,
    knownTotal: estimate.knownTotal,
    cylinderCount: estimate.itemCount,
    pricedCount: estimate.pricedCount,
    unknownLabels: estimate.unknownLabels,
  };
}

export function formatHuf(amount: number): string {
  return `${amount.toLocaleString("hu-HU")} Ft`;
}
