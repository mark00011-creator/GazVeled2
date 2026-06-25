import { fetchChineseStock, chineseStockLabel } from "@/lib/chinese-stock";
import { FLAGA_PB_CATALOG, fetchFlagaPbStock, flagaPbStockLabel } from "@/lib/flaga-pb-stock";
import { fetchPrimaPbStock, primaPbStockLabel } from "@/lib/prima-pb-stock";

export type QuantityStockKind = "chinese" | "prima_pb" | "flaga_pb";

export type OrderableQuantityLine = {
  stock_kind: QuantityStockKind;
  gas_type: string;
  size: string;
  empty_count: number;
  label: string;
  key: string;
};

export function quantityLineKey(kind: QuantityStockKind, gas_type: string, size: string): string {
  return `${kind}|${gas_type}|${size}`;
}

export async function fetchOrderableChineseLines(): Promise<OrderableQuantityLine[]> {
  const rows = await fetchChineseStock();
  return rows
    .filter((r) => r.empty_count > 0)
    .map((r) => ({
      stock_kind: "chinese" as const,
      gas_type: r.gas_type,
      size: r.size,
      empty_count: r.empty_count,
      label: chineseStockLabel(r.gas_type, r.size),
      key: quantityLineKey("chinese", r.gas_type, r.size),
    }));
}

export async function fetchOrderablePrimaPbLines(): Promise<OrderableQuantityLine[]> {
  const rows = await fetchPrimaPbStock();
  return rows
    .filter((r) => r.empty_count > 0)
    .map((r) => ({
      stock_kind: "prima_pb" as const,
      gas_type: r.gas_type,
      size: r.size,
      empty_count: r.empty_count,
      label: primaPbStockLabel(r.gas_type, r.size),
      key: quantityLineKey("prima_pb", r.gas_type, r.size),
    }));
}

export async function fetchOrderableFlagaPbLines(): Promise<OrderableQuantityLine[]> {
  const rows = await fetchFlagaPbStock();
  const catalogKeys = new Set(
    FLAGA_PB_CATALOG.map((i) => quantityLineKey("flaga_pb", i.gas_type, i.size)),
  );
  return rows
    .filter(
      (r) =>
        r.empty_count > 0 &&
        catalogKeys.has(quantityLineKey("flaga_pb", r.gas_type, r.size)),
    )
    .map((r) => ({
      stock_kind: "flaga_pb" as const,
      gas_type: r.gas_type,
      size: r.size,
      empty_count: r.empty_count,
      label: flagaPbStockLabel(r.gas_type, r.size),
      key: quantityLineKey("flaga_pb", r.gas_type, r.size),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "hu"));
}

export type SelectedQuantityLine = {
  stock_kind: QuantityStockKind;
  gas_type: string;
  size: string;
  quantity: number;
  label: string;
};

export function summarizeQuantityLines(
  lines: SelectedQuantityLine[],
): { label: string; count: number }[] {
  return lines
    .map((l) => ({ label: l.label, count: l.quantity }))
    .sort((a, b) => a.label.localeCompare(b.label, "hu"));
}

/** Összesíti a körforgásos tételeket termék szerint (Kínai + PRÍMA PB együtt). */
export function summarizeUnifiedQuantityLines(
  lines: SelectedQuantityLine[],
): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const label = circulatingProductLabel(line.gas_type, line.size);
    counts.set(label, (counts.get(label) ?? 0) + line.quantity);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label, "hu"));
}

export function circulatingProductLabel(gas_type: string, size: string): string {
  return `${gas_type} ${size}`;
}

export type CirculatingQuantitySource = {
  stock_kind: CirculatingStockKind;
  gas_type: string;
  size: string;
  empty_count: number;
  source_key: string;
};

/** Körforgásos készletforrások típusai (Kínai + PRÍMA PB). */
export type CirculatingStockKind = Extract<QuantityStockKind, "chinese" | "prima_pb">;

/**
 * Sorrend, ahogy a rendelés lefoglalja a körforgásos készletforrásokat.
 * Módosításhoz elég ezt a tömböt átírni.
 */
export const CIRCULATING_STOCK_ALLOCATION_ORDER: readonly CirculatingStockKind[] = [
  "chinese",
  "prima_pb",
];

function circulatingSourceSortIndex(kind: CirculatingStockKind): number {
  const idx = CIRCULATING_STOCK_ALLOCATION_ORDER.indexOf(kind);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

export function sortCirculatingQuantitySources(
  sources: CirculatingQuantitySource[],
): CirculatingQuantitySource[] {
  return [...sources].sort(
    (a, b) => circulatingSourceSortIndex(a.stock_kind) - circulatingSourceSortIndex(b.stock_kind),
  );
}

export function allocateCirculatingQuantity(
  sources: CirculatingQuantitySource[],
  quantity: number,
  productLabel: string,
): SelectedQuantityLine[] {
  const result: SelectedQuantityLine[] = [];
  let remaining = quantity;

  for (const source of sortCirculatingQuantitySources(sources)) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, source.empty_count);
    if (take <= 0) continue;
    result.push({
      stock_kind: source.stock_kind,
      gas_type: source.gas_type,
      size: source.size,
      quantity: take,
      label: productLabel,
    });
    remaining -= take;
  }

  return result;
}

export type MergedCirculatingQuantityLine = {
  key: string;
  gas_type: string;
  size: string;
  label: string;
  empty_count: number;
  sources: CirculatingQuantitySource[];
};

export function mergeCirculatingQuantityLines(
  chinese: OrderableQuantityLine[],
  prima: OrderableQuantityLine[],
): MergedCirculatingQuantityLine[] {
  const map = new Map<string, MergedCirculatingQuantityLine>();

  for (const line of [...chinese, ...prima]) {
    if (line.stock_kind !== "chinese" && line.stock_kind !== "prima_pb") continue;
    const productKey = `${line.gas_type}|${line.size}`;
    let merged = map.get(productKey);
    if (!merged) {
      merged = {
        key: `circ|${productKey}`,
        gas_type: line.gas_type,
        size: line.size,
        label: circulatingProductLabel(line.gas_type, line.size),
        empty_count: 0,
        sources: [],
      };
      map.set(productKey, merged);
    }
    merged.empty_count += line.empty_count;
    merged.sources.push({
      stock_kind: line.stock_kind,
      gas_type: line.gas_type,
      size: line.size,
      empty_count: line.empty_count,
      source_key: line.key,
    });
  }

  for (const merged of map.values()) {
    merged.sources = sortCirculatingQuantitySources(merged.sources);
  }

  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "hu"));
}

export function splitMergedCirculatingSelection(
  mergedLines: MergedCirculatingQuantityLine[],
  selection: Record<string, { selected: boolean; quantity: number } | undefined>,
): SelectedQuantityLine[] {
  const result: SelectedQuantityLine[] = [];

  for (const merged of mergedLines) {
    const sel = selection[merged.key];
    if (!sel?.selected || sel.quantity <= 0) continue;

    const qty = Math.min(sel.quantity, merged.empty_count);
    result.push(...allocateCirculatingQuantity(merged.sources, qty, merged.label));
  }

  return result;
}

export function buildQuantityGasOrderText(
  title: string,
  lines: SelectedQuantityLine[],
): string {
  const body =
    lines.length === 0
      ? "(nincs)"
      : lines.map((l) => `${l.label} – ${l.quantity} db`).join("\n");

  return [
    "Kedves Géza!",
    "",
    `Szeretném megrendelni a következő ${title} üres palackok cseréjét.`,
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
