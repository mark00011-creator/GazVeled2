/** Közös nettó ár- és profitkalkuláció – azonos elv, mint product_prices (beszerzési + árrés). */

export function roundHuf(value: number): number {
  return Math.round(value);
}

/** Beszerzési ár + haszon forintban → nettó eladási ár. */
export function salePriceFromProfitFt(purchaseNet: number, profitFt: number): number {
  if (purchaseNet < 0 || profitFt < 0) throw new Error("Az árak nem lehetnek negatívak");
  return roundHuf(purchaseNet + profitFt);
}

/** Beszerzési ár + árrés % → nettó eladási ár. */
export function salePriceFromMarginPercent(purchaseNet: number, marginPercent: number): number {
  if (purchaseNet < 0 || marginPercent < 0) throw new Error("Az árak nem lehetnek negatívak");
  return roundHuf(purchaseNet * (1 + marginPercent / 100));
}

/** Haszon / egység = nettó eladási − nettó beszerzési. */
export function profitPerUnit(
  purchaseNet: number | null | undefined,
  saleNet: number | null | undefined,
): number | null {
  if (purchaseNet == null || saleNet == null) return null;
  return roundHuf(saleNet - purchaseNet);
}

/** Árrés % = haszon / beszerzési × 100. */
export function marginPercent(
  purchaseNet: number | null | undefined,
  saleNet: number | null | undefined,
): number | null {
  if (purchaseNet == null || saleNet == null || purchaseNet <= 0) return null;
  return Math.round(((saleNet - purchaseNet) / purchaseNet) * 10000) / 100;
}

export function vatAmountFromNet(net: number, vatRate: number): number {
  return roundHuf(net * (vatRate / 100));
}

export function grossFromNet(net: number, vatRate: number): number {
  return net + vatAmountFromNet(net, vatRate);
}

export function lineNet(unitPrice: number, quantity: number): number {
  return roundHuf(unitPrice * quantity);
}

export function lineTotals(unitPrice: number, quantity: number, vatRate: number) {
  const net = lineNet(unitPrice, quantity);
  const vat = vatAmountFromNet(net, vatRate);
  const gross = net + vat;
  return { net, vat, gross };
}

export function lineProfit(
  purchaseUnit: number | null | undefined,
  saleUnit: number,
  quantity: number,
) {
  const perUnit = profitPerUnit(purchaseUnit, saleUnit);
  const total = perUnit != null ? roundHuf(perUnit * quantity) : null;
  const purchaseValue =
    purchaseUnit != null ? roundHuf(purchaseUnit * quantity) : null;
  const pct = marginPercent(purchaseUnit, saleUnit);
  return { profitPerUnit: perUnit, lineProfit: total, linePurchaseValue: purchaseValue, marginPercent: pct };
}

export function formatSupplyHuf(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  return `${amount.toLocaleString("hu-HU")} Ft`;
}

export function formatMarginPercent(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return "—";
  return `${pct.toLocaleString("hu-HU", { maximumFractionDigits: 2 })} %`;
}

export function parseSupplyPriceInput(value: string): number | null {
  const trimmed = value.replace(/\s/g, "").replace(",", ".");
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return n;
}
