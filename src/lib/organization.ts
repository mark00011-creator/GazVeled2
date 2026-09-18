/** Cég (tenant) beállítások – egy app, cégenkénti modulok/branding. */

export const GAZ_VEELED_ORG_ID = "a0000000-0000-4000-8000-000000000001";

export type OrganizationModules = {
  flaga_pb: boolean;
  prima_pb: boolean;
  chinese_stock: boolean;
  rentals: boolean;
  tool_rental: boolean;
  quotes: boolean;
  gas_orders: boolean;
  suppliers: boolean;
};

export type OrganizationInvoicingSettings = {
  provider: "billingo" | "szamlazz" | null;
  bill_own_circulation: boolean;
  bill_siad_circulation: boolean;
  bill_foreign_circulation: boolean;
};

export type TaxRegime = "vat_exempt" | "vat_registered";
export type PriceEntryMode = "net" | "gross";

export type OrganizationTaxSettings = {
  /** Alanyi adómentes vs áfakörös. */
  regime: TaxRegime;
  /** Alap ÁFA % áfakörösnél (pl. 27). */
  default_rate: number;
  /** Bevitel: nettó (ajánlott) vagy bruttó (átszámolás nettóra mentéskor). */
  price_entry: PriceEntryMode;
};

export type OrganizationSettings = {
  modules: OrganizationModules;
  circulations: string[];
  warehouse_bins: string[];
  invoicing: OrganizationInvoicingSettings;
  tax: OrganizationTaxSettings;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  settings: OrganizationSettings;
  is_active: boolean;
};

export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = {
  modules: {
    flaga_pb: true,
    prima_pb: true,
    chinese_stock: true,
    rentals: true,
    tool_rental: true,
    quotes: true,
    gas_orders: true,
    suppliers: true,
  },
  circulations: ["own", "siad", "berpalack"],
  warehouse_bins: [],
  invoicing: {
    provider: null,
    bill_own_circulation: false,
    bill_siad_circulation: true,
    bill_foreign_circulation: true,
  },
  tax: {
    regime: "vat_exempt",
    default_rate: 27,
    price_entry: "net",
  },
};

export function parseOrganizationSettings(raw: unknown): OrganizationSettings {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const modulesSrc =
    src.modules && typeof src.modules === "object"
      ? (src.modules as Record<string, unknown>)
      : {};
  const invoicingSrc =
    src.invoicing && typeof src.invoicing === "object"
      ? (src.invoicing as Record<string, unknown>)
      : {};
  const taxSrc =
    src.tax && typeof src.tax === "object" ? (src.tax as Record<string, unknown>) : {};

  const modules: OrganizationModules = {
    flaga_pb: modulesSrc.flaga_pb !== false,
    prima_pb: modulesSrc.prima_pb !== false,
    chinese_stock: modulesSrc.chinese_stock !== false,
    rentals: modulesSrc.rentals !== false,
    tool_rental: modulesSrc.tool_rental !== false,
    quotes: modulesSrc.quotes !== false,
    gas_orders: modulesSrc.gas_orders !== false,
    suppliers: modulesSrc.suppliers !== false,
  };

  const circulations = Array.isArray(src.circulations)
    ? src.circulations.filter((c): c is string => typeof c === "string")
    : [...DEFAULT_ORGANIZATION_SETTINGS.circulations];

  const warehouse_bins = Array.isArray(src.warehouse_bins)
    ? src.warehouse_bins.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    : [];

  const providerRaw = invoicingSrc.provider;
  const provider =
    providerRaw === "billingo" || providerRaw === "szamlazz" ? providerRaw : null;

  const regime: TaxRegime =
    taxSrc.regime === "vat_registered" ? "vat_registered" : "vat_exempt";
  const defaultRateRaw = Number(taxSrc.default_rate);
  const default_rate =
    Number.isFinite(defaultRateRaw) && defaultRateRaw >= 0 && defaultRateRaw <= 100
      ? defaultRateRaw
      : 27;
  const price_entry: PriceEntryMode = taxSrc.price_entry === "gross" ? "gross" : "net";

  return {
    modules,
    circulations,
    warehouse_bins,
    invoicing: {
      provider,
      bill_own_circulation: invoicingSrc.bill_own_circulation === true,
      bill_siad_circulation: invoicingSrc.bill_siad_circulation !== false,
      bill_foreign_circulation: invoicingSrc.bill_foreign_circulation !== false,
    },
    tax: {
      regime,
      default_rate,
      price_entry,
    },
  };
}

export function isModuleEnabled(
  settings: OrganizationSettings | null | undefined,
  module: keyof OrganizationModules,
): boolean {
  if (!settings) return true;
  return settings.modules[module] !== false;
}
