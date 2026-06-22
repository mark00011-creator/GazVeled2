import { supabase } from "@/integrations/supabase/client";
import { GAS_TYPES, getAvailableSizes } from "@/lib/gas-cylinder-form";
import { FLAGA_GAS_TYPES, getFlagaSizes } from "@/lib/flaga-stock";
import { FLAGA_PB_CATALOG } from "@/lib/flaga-pb-stock";
import { PRIMA_PB_CATALOG } from "@/lib/prima-pb-stock";
import { normalizeGasType, normalizeSize, priceKey } from "@/lib/gas-order-prices";
import { formatSupabaseError } from "@/lib/supabase-error";

export type ProductPrice = {
  id: string;
  gas_type: string;
  size: string;
  unit_price: number;
  beszerzesi_ar: number;
  arres: number;
  eladasi_ar: number;
  currency: string;
  product_code: string | null;
  active: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
};

const FLAGA_PB_GAS_TYPES = [...new Set(FLAGA_PB_CATALOG.map((i) => i.gas_type))];
const PRIMA_PB_GAS_TYPES = [...new Set(PRIMA_PB_CATALOG.map((i) => i.gas_type))];

export const PRICE_LIST_GAS_TYPES = [
  ...GAS_TYPES,
  ...FLAGA_GAS_TYPES,
  ...FLAGA_PB_GAS_TYPES,
  ...PRIMA_PB_GAS_TYPES,
];

export function getPriceListSizes(gasType: string): string[] {
  const flagaPbSizes = FLAGA_PB_CATALOG.filter((i) => i.gas_type === gasType).map((i) => i.size);
  if (flagaPbSizes.length > 0) return flagaPbSizes;
  const primaPbSizes = PRIMA_PB_CATALOG.filter((i) => i.gas_type === gasType).map((i) => i.size);
  if (primaPbSizes.length > 0) return primaPbSizes;
  if ((FLAGA_GAS_TYPES as readonly string[]).includes(gasType)) {
    return getFlagaSizes(gasType);
  }
  return getAvailableSizes(gasType);
}

export function priceListCategory(gasType: string, size: string): string | null {
  if (FLAGA_PB_CATALOG.some((i) => i.gas_type === gasType && i.size === size)) return "FLAGA PB";
  if (PRIMA_PB_CATALOG.some((i) => i.gas_type === gasType && i.size === size)) return "PRÍMA PB";
  if ((FLAGA_GAS_TYPES as readonly string[]).includes(gasType)) return "FLAGA";
  return null;
}

export function canonicalGasType(gas: string): string {
  const n = normalizeGasType(gas);
  const found = PRICE_LIST_GAS_TYPES.find((g) => normalizeGasType(g) === n);
  return found ?? gas.trim();
}

export function canonicalSize(gasType: string, size: string): string {
  const n = normalizeSize(size);
  const pool = getPriceListSizes(canonicalGasType(gasType));
  const found = pool.find((s) => normalizeSize(s) === n);
  return found ?? size.trim();
}

export function productLabel(gasType: string, size: string): string {
  return `${gasType} ${size}`;
}

export async function fetchProductPrices(activeOnly = true): Promise<ProductPrice[]> {
  let q = supabase.from("product_prices").select("*").order("gas_type").order("size");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(formatSupabaseError(error, "Árlista betöltése"));
  return (data ?? []) as ProductPrice[];
}

/** Beszerzési ár map (gáz rendelés, készletérték). */
export function buildPurchasePriceMap(prices: ProductPrice[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of prices) {
    if (!row.active || row.beszerzesi_ar <= 0) continue;
    map.set(priceKey(row.gas_type, row.size), row.beszerzesi_ar);
  }
  return map;
}

/** Eladási ár map (csere nyereség, árajánlat). */
export function buildSellingPriceMap(prices: ProductPrice[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of prices) {
    if (!row.active || row.eladasi_ar <= 0) continue;
    map.set(priceKey(row.gas_type, row.size), row.eladasi_ar);
  }
  return map;
}

/** @deprecated Use buildPurchasePriceMap – unit_price = beszerzesi_ar */
export function buildPriceMap(prices: ProductPrice[]): Map<string, number> {
  return buildPurchasePriceMap(prices);
}

export function lookupProductPrice(
  gasType: string,
  size: string,
  prices: ProductPrice[],
): ProductPrice | null {
  const gas = canonicalGasType(gasType);
  const sz = canonicalSize(gas, size);
  const key = priceKey(gas, sz);
  return prices.find((p) => p.active && priceKey(p.gas_type, p.size) === key) ?? null;
}

export async function upsertProductPrice(input: {
  id?: string;
  gas_type: string;
  size: string;
  beszerzesi_ar: number;
  arres: number;
  product_code?: string | null;
  note?: string | null;
  active?: boolean;
}): Promise<ProductPrice> {
  const gas_type = canonicalGasType(input.gas_type);
  const size = canonicalSize(gas_type, input.size);
  const beszerzesi_ar = Math.round(input.beszerzesi_ar);
  const arres = Math.round(input.arres);
  if (beszerzesi_ar < 0) throw new Error("A beszerzési ár nem lehet negatív");
  if (arres < 0) throw new Error("Az árrés nem lehet negatív");

  const row = {
    gas_type,
    size,
    beszerzesi_ar,
    arres,
    eladasi_ar: beszerzesi_ar + arres,
    unit_price: beszerzesi_ar,
    product_code: input.product_code?.trim() || null,
    note: input.note?.trim() || null,
    active: input.active ?? true,
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("product_prices")
      .update(row)
      .eq("id", input.id)
      .select("*")
      .single();
    if (error) throw new Error(formatSupabaseError(error, "Ár mentése"));
    return data as ProductPrice;
  }

  const { data, error } = await supabase.from("product_prices").insert(row).select("*").single();
  if (error) throw new Error(formatSupabaseError(error, "Ár hozzáadása"));
  return data as ProductPrice;
}

export async function deleteProductPrice(id: string): Promise<void> {
  const { error } = await supabase.from("product_prices").delete().eq("id", id);
  if (error) throw new Error(formatSupabaseError(error, "Ár törlése"));
}
