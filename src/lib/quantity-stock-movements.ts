/** Darabszámos készletmozgások – Kínai / FLAGA PB / PRÍMA PB közös típusok. */
export type QuantityStockMovementType =
  | "purchase"
  | "sale"
  | "customer_exchange"
  | "supplier_exchange"
  | "empty_return"
  | "adjustment";

/** Régi API: exchange = ügyfélcsere */
export type LegacyQuantityStockMovementType = QuantityStockMovementType | "exchange";

export const QUANTITY_STOCK_MOVEMENT_LABELS: Record<QuantityStockMovementType, string> = {
  purchase: "Beszerzés (teli +)",
  sale: "Eladás (teli −)",
  customer_exchange: "Ügyfélcsere: teli ki, üres be",
  supplier_exchange: "Beszállítói csere: üres ki, teli be",
  empty_return: "Üres visszahozás (üres +)",
  adjustment: "Készletkorrekció (teli +, megjegyzés kötelező)",
};

export const CHINESE_STOCK_UI_MOVEMENTS: QuantityStockMovementType[] = [
  "purchase",
  "sale",
  "customer_exchange",
  "supplier_exchange",
  "empty_return",
  "adjustment",
];

export function parseStockQuantityInput(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Érvényes darabszámot adj meg");
  const qty = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(qty) || qty <= 0 || String(qty) !== trimmed) {
    throw new Error("Érvényes egész darabszámot adj meg");
  }
  return qty;
}
