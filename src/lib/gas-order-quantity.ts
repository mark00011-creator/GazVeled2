import { fetchChineseStock } from "@/lib/chinese-stock";
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
      label: chineseOrderLabel(r.gas_type, r.size),
      key: quantityLineKey("chinese", r.gas_type, r.size),
    }));
}

export function chineseOrderLabel(gas_type: string, size: string): string {
  return `Kínai ${gas_type} ${size}`;
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
