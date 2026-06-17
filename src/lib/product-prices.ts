import { supabase } from "@/integrations/supabase/client";
import { CO2_SIZES, GAS_TYPES, STANDARD_SIZES } from "@/lib/gas-cylinder-form";
import { normalizeGasType, normalizeSize, priceKey } from "@/lib/gas-order-prices";
import { formatSupabaseError } from "@/lib/supabase-error";

export type ProductPrice = {
  id: string;
  gas_type: string;
  size: string;
  unit_price: number;
  currency: string;
  product_code: string | null;
  active: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export function canonicalGasType(gas: string): string {
  const n = normalizeGasType(gas);
  const found = GAS_TYPES.find((g) => normalizeGasType(g) === n);
  return found ?? gas.trim();
}

export function canonicalSize(gasType: string, size: string): string {
  const n = normalizeSize(size);
  const pool = canonicalGasType(gasType) === "Széndioxid" ? CO2_SIZES : STANDARD_SIZES;
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

export function buildPriceMap(prices: ProductPrice[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of prices) {
    if (!row.active || row.unit_price <= 0) continue;
    map.set(priceKey(row.gas_type, row.size), row.unit_price);
  }
  return map;
}

export async function upsertProductPrice(input: {
  id?: string;
  gas_type: string;
  size: string;
  unit_price: number;
  product_code?: string | null;
  note?: string | null;
  active?: boolean;
}): Promise<ProductPrice> {
  const gas_type = canonicalGasType(input.gas_type);
  const size = canonicalSize(gas_type, input.size);
  const unit_price = Math.round(input.unit_price);
  if (unit_price < 0) throw new Error("Az ár nem lehet negatív");

  const row = {
    gas_type,
    size,
    unit_price,
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
