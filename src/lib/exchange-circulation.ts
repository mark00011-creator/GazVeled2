import type { Circulation, Manufacturer } from "@/lib/labels";
import { classifySerialCylinder, type SerialGroupKey } from "@/lib/gas-order";
import type { RentalQuantityStockKind } from "@/lib/rental-quantity-stock";

/** Finom körforgás-kulcs (csere ajánlás, eltérés, rendezés). */
export type ExchangeCirculationKey = SerialGroupKey | RentalQuantityStockKind;

export const EXCHANGE_CIRCULATION_LABELS: Record<ExchangeCirculationKey, string> = {
  siad_rental: "SIAD bérpalack",
  own_siad: "SIAD saját",
  linde: "LINDE",
  messer: "MESSER",
  other: "Egyéb",
  chinese: "Kínai",
  flaga_pb: "FLAGA PB",
  prima_pb: "PRÍMA PB",
};

export type ExchangeCirculationSide = {
  key: ExchangeCirculationKey;
  gas_type: string;
  size: string;
};

export function deriveExchangeCirculationFromCylinder(cyl: {
  circulation: Circulation;
  manufacturer: Manufacturer | string | null;
}): ExchangeCirculationKey {
  if (cyl.manufacturer === "chinese") return "chinese";
  return classifySerialCylinder({
    circulation: cyl.circulation,
    manufacturer: (cyl.manufacturer as Manufacturer | null) ?? null,
  });
}

export function deriveExchangeCirculationSideFromCylinder(cyl: {
  circulation: Circulation;
  manufacturer: Manufacturer | string | null;
  gas_type: string;
  size: string;
}): ExchangeCirculationSide {
  return {
    key: deriveExchangeCirculationFromCylinder(cyl),
    gas_type: cyl.gas_type,
    size: cyl.size,
  };
}

export function deriveQuantityExchangeCirculation(
  stockKind: RentalQuantityStockKind,
  gas_type: string,
  size: string,
): ExchangeCirculationSide {
  return { key: stockKind, gas_type, size };
}

export function formatExchangeCirculationLabel(key: string): string {
  return EXCHANGE_CIRCULATION_LABELS[key as ExchangeCirculationKey] ?? key;
}

/** Emberi olvasható eltérés-szöveg (UI figyelmeztetés). */
export function formatCirculationDifferenceWarning(diff: {
  incoming_exchange_circulation: string;
  outgoing_exchange_circulation: string;
  incoming_gas_type: string;
  outgoing_gas_type: string;
  size: string;
  quantity: number;
  quantity_settled?: number;
}): string {
  const openQty = diff.quantity - (diff.quantity_settled ?? 0);
  const inLabel = formatExchangeCirculationLabel(diff.incoming_exchange_circulation);
  const outLabel = formatExchangeCirculationLabel(diff.outgoing_exchange_circulation);
  const suffix = openQty > 1 ? ` (${openQty} db nyitott)` : "";
  return `${inLabel} ${diff.incoming_gas_type} ${diff.size} helyett ${outLabel} ${diff.outgoing_gas_type} ${diff.size} lett kiadva.${suffix}`;
}

/** Rendezés: a csere fordított körforgás-áramlása egyezik az eltéréssel. */
export function canExchangeSettleDifference(
  diff: {
    incoming_exchange_circulation: string;
    outgoing_exchange_circulation: string;
    incoming_gas_type: string;
    outgoing_gas_type: string;
    size: string;
    quantity: number;
    quantity_settled: number;
  },
  incoming: ExchangeCirculationSide,
  outgoing: ExchangeCirculationSide,
): boolean {
  const openQty = diff.quantity - diff.quantity_settled;
  if (openQty <= 0) return false;
  return (
    diff.outgoing_exchange_circulation === incoming.key &&
    diff.incoming_exchange_circulation === outgoing.key &&
    diff.outgoing_gas_type === incoming.gas_type &&
    diff.incoming_gas_type === outgoing.gas_type &&
    diff.size === incoming.size &&
    diff.size === outgoing.size
  );
}

/** Alap ajánlás: ugyanaz a körforgás-kulcs (gáz+méret egyezés külön). */
export function isSameExchangeCirculation(a: ExchangeCirculationSide, b: ExchangeCirculationSide): boolean {
  return a.key === b.key;
}

export function suggestOutgoingCirculation(incoming: ExchangeCirculationSide): ExchangeCirculationKey {
  return incoming.key;
}
