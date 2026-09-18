import type { OrganizationSettings, OrganizationTaxSettings } from "@/lib/organization";
import { grossFromNet, vatAmountFromNet } from "@/lib/supply-pricing";

export function getTaxSettings(
  settings: OrganizationSettings | null | undefined,
): OrganizationTaxSettings {
  return (
    settings?.tax ?? {
      regime: "vat_exempt",
      default_rate: 27,
      price_entry: "net",
    }
  );
}

export function isVatRegistered(settings: OrganizationSettings | null | undefined): boolean {
  return getTaxSettings(settings).regime === "vat_registered";
}

export function effectiveVatRate(
  settings: OrganizationSettings | null | undefined,
  productVatRate?: number | null,
): number {
  if (!isVatRegistered(settings)) return 0;
  if (productVatRate != null && Number.isFinite(productVatRate)) return productVatRate;
  return getTaxSettings(settings).default_rate;
}

export function taxRegimeLabel(settings: OrganizationSettings | null | undefined): string {
  return isVatRegistered(settings) ? "Áfakörös" : "Alanyi adómentes";
}

/** Nettó egységár → megjelenítendő bruttó (áfamentesnél = nettó). */
export function displayGrossFromNet(
  net: number | null | undefined,
  settings: OrganizationSettings | null | undefined,
  productVatRate?: number | null,
): number | null {
  if (net == null || Number.isNaN(net)) return null;
  const rate = effectiveVatRate(settings, productVatRate);
  return rate > 0 ? grossFromNet(net, rate) : net;
}

export function displayVatAmountFromNet(
  net: number | null | undefined,
  settings: OrganizationSettings | null | undefined,
  productVatRate?: number | null,
): number | null {
  if (net == null || Number.isNaN(net)) return null;
  const rate = effectiveVatRate(settings, productVatRate);
  return rate > 0 ? vatAmountFromNet(net, rate) : 0;
}

export function priceBasisHint(settings: OrganizationSettings | null | undefined): string {
  if (isVatRegistered(settings)) {
    const rate = getTaxSettings(settings).default_rate;
    return `Áfakörös cég · az árak nettóban tárolódnak · alap ÁFA ${rate}%`;
  }
  return "Alanyi adómentes cég · az árak bruttó egységárak (nincs ÁFA bontás)";
}

/** Címke: adómentesnél bruttó / sima ár; áfakörösnél nettó. */
export function priceFieldLabel(
  settings: OrganizationSettings | null | undefined,
  kind: "purchase" | "sale" | "unit",
): string {
  if (isVatRegistered(settings)) {
    if (kind === "purchase") return "Beszerzési nettó ár (Ft)";
    if (kind === "sale") return "Eladási nettó ár (Ft)";
    return "Egységár (nettó)";
  }
  if (kind === "purchase") return "Beszerzési ár (Ft)";
  if (kind === "sale") return "Eladási ár (Ft)";
  return "Egységár (Ft)";
}
