import {
  circulationLabels,
  manufacturerLabels,
  type Circulation,
  type Manufacturer,
} from "@/lib/labels";

export const DEFAULT_REPLACEMENT_VALUE = 100_000;

const LEGACY_FLAGA_GAS_TYPES = ["PB gáz", "Targonca gáz", "Bután gáz", "Kemping gáz"] as const;

export type RentalQuantityStockKindLegacy = "chinese" | "flaga_pb" | "prima_pb" | "flaga";

export type RentalContractLineSource = {
  barcode?: string | null;
  gas_type: string;
  size: string;
  manufacturer?: string | null;
  factory_serial?: string | null;
  owner?: string | null;
  circulation?: string | null;
  replacement_value?: number | null;
  is_temporary?: boolean;
};

/** Quantity-based stock line (Chinese / FLAGA PB / PRÍMA PB) – bérleti szerződéshez. */
export type RentalContractStockItem = {
  gas_type: string;
  size: string;
  kind: RentalQuantityStockKindLegacy;
  quantity?: number;
  replacement_value?: number | null;
};

export type RentalContractLine = {
  palackTipus: string;
  gaz: string;
  meret: string;
  gyarto: string;
  tulajdonos: string;
  vonalkodAzonosito: string;
  potlasiErtek: number;
};

function isLegacyFlagaGasType(gasType: string): boolean {
  const g = gasType.trim().toLowerCase();
  return LEGACY_FLAGA_GAS_TYPES.some((t) => t.toLowerCase() === g);
}

function legacyFlagaSubtypeLabel(gasType: string): string {
  const g = gasType.trim();
  if (/pb/i.test(g)) return "FLAGA PB körforgásos";
  if (/targonca/i.test(g)) return "FLAGA targonca körforgásos";
  if (/bután|butan/i.test(g)) return "FLAGA bután körforgásos";
  if (/kemping/i.test(g)) return "FLAGA kemping körforgásos";
  return "FLAGA körforgásos";
}

function isTempBarcode(barcode: string | null | undefined): boolean {
  const bc = barcode?.trim() ?? "";
  return !bc || /^temp-/i.test(bc);
}

export function manufacturerDisplayLabel(m: string | null | undefined): string {
  if (!m) return "—";
  return manufacturerLabels[m as Manufacturer] ?? m;
}

export function ownerDisplayLabel(
  owner: string | null | undefined,
  circulation: string | null | undefined,
): string {
  const key = (owner ?? circulation ?? "") as Circulation;
  return circulationLabels[key] ?? owner ?? circulation ?? "—";
}

/** Derive palacktípus from cylinder / stock fields. */
export function derivePalackTipus(
  source: RentalContractLineSource | RentalContractStockItem,
  opts?: { stockKind?: RentalQuantityStockKindLegacy },
): string {
  const stockKind = opts?.stockKind ?? ("kind" in source ? source.kind : undefined);

  if (stockKind === "chinese" || ("manufacturer" in source && source.manufacturer === "chinese")) {
    return "Kínai körforgásos palack";
  }

  if (stockKind === "flaga_pb") return "FLAGA PB körforgásos";
  if (stockKind === "prima_pb") return "PRÍMA PB körforgásos";

  if (stockKind === "flaga" || isLegacyFlagaGasType(source.gas_type)) {
    return legacyFlagaSubtypeLabel(source.gas_type);
  }

  if ("owner" in source || "circulation" in source) {
    const owner = source.owner ?? "";
    const circulation = source.circulation ?? "";
    if (owner === "siad" || circulation === "siad") return "SIAD palack";
    if (owner === "own") return "Saját palack";
  }

  if ("manufacturer" in source && source.manufacturer) {
    return `${manufacturerDisplayLabel(source.manufacturer)} palack`;
  }

  return "Palack";
}

/** Vonalkód vagy készletazonosító oszlop. */
export function deriveVonalkodAzonosito(
  source: RentalContractLineSource,
  opts?: { stockKind?: RentalQuantityStockKindLegacy; quantityLine?: boolean },
): string {
  if (opts?.quantityLine || opts?.stockKind) {
    return "Körforgásos készlet";
  }

  const bc = source.barcode?.trim();
  if (bc && !isTempBarcode(bc) && !source.is_temporary) {
    return bc;
  }

  if (source.factory_serial?.trim()) {
    return source.factory_serial.trim();
  }

  return "Nincs egyedi sorszám";
}

function resolveReplacementValue(value: number | null | undefined): number {
  if (value != null && value > 0) return value;
  return DEFAULT_REPLACEMENT_VALUE;
}

function lineFromCylinder(c: RentalContractLineSource): RentalContractLine {
  return {
    palackTipus: derivePalackTipus(c),
    gaz: c.gas_type,
    meret: c.size,
    gyarto: manufacturerDisplayLabel(c.manufacturer),
    tulajdonos: ownerDisplayLabel(c.owner, c.circulation),
    vonalkodAzonosito: deriveVonalkodAzonosito(c),
    potlasiErtek: resolveReplacementValue(c.replacement_value),
  };
}

function lineFromStockItem(item: RentalContractStockItem): RentalContractLine {
  const qty = item.quantity ?? 1;
  const meret = qty > 1 ? `${item.size} (${qty} db)` : item.size;
  const gyarto =
    item.kind === "chinese"
      ? "Kínai"
      : item.kind === "flaga_pb"
        ? "FLAGA PB"
        : item.kind === "prima_pb"
          ? "PRÍMA PB"
          : "FLAGA";
  return {
    palackTipus: derivePalackTipus(item, { stockKind: item.kind }),
    gaz: item.gas_type,
    meret,
    gyarto,
    tulajdonos: "Saját",
    vonalkodAzonosito: deriveVonalkodAzonosito({}, { stockKind: item.kind, quantityLine: true }),
    potlasiErtek: resolveReplacementValue(item.replacement_value),
  };
}

/** Build unified contract table rows from cylinders and optional quantity stock. */
export function buildContractLines(
  cylinders: RentalContractLineSource[],
  stockItems?: RentalContractStockItem[],
): RentalContractLine[] {
  const lines = cylinders.map(lineFromCylinder);
  for (const item of stockItems ?? []) {
    lines.push(lineFromStockItem(item));
  }
  return lines;
}
