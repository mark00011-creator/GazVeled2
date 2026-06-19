import { supabase } from "@/integrations/supabase/client";
import {
  lookupProductPrice,
  fetchProductPrices,
  productLabel,
  type ProductPrice,
} from "@/lib/product-prices";
import { formatSupabaseError } from "@/lib/supabase-error";

export type QuoteRow = {
  id: string;
  partner_id: string;
  quote_number: string;
  quote_date: string;
  note: string | null;
  created_at: string;
  created_by: string | null;
  partners?: { name: string; company_name: string | null } | null;
};

export type QuoteItemRow = {
  id: string;
  quote_id: string;
  gas_type: string;
  size: string;
  quantity: number;
  list_price: number;
  discount_percent: number;
  unit_price: number;
  is_custom_price: boolean;
  sort_order: number;
};

export type QuoteItemDraft = {
  gas_type: string;
  size: string;
  quantity: number;
  list_price: number;
  discount_percent: number;
  unit_price: number;
  is_custom_price: boolean;
};

export const DISCOUNT_OPTIONS = [0, 5, 10, 15] as const;

export function calcOfferPrice(listPrice: number, discountPercent: number): number {
  return Math.round(listPrice * (1 - discountPercent / 100));
}

export function nextQuoteNumber(existing: QuoteRow[]): string {
  const year = new Date().getFullYear();
  const prefix = `AJ-${year}-`;
  let max = 0;
  for (const q of existing) {
    if (!q.quote_number.startsWith(prefix)) continue;
    const n = parseInt(q.quote_number.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

export async function fetchQuotes(): Promise<QuoteRow[]> {
  const { data, error } = await supabase
    .from("quotes")
    .select("*, partners(name, company_name)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(formatSupabaseError(error, "Árajánlatok betöltése"));
  return (data ?? []) as QuoteRow[];
}

export async function fetchQuote(id: string): Promise<{ quote: QuoteRow; items: QuoteItemRow[] }> {
  const [quoteRes, itemsRes] = await Promise.all([
    supabase.from("quotes").select("*, partners(name, company_name)").eq("id", id).single(),
    supabase.from("quote_items").select("*").eq("quote_id", id).order("sort_order"),
  ]);

  if (quoteRes.error) throw new Error(formatSupabaseError(quoteRes.error, "Árajánlat"));
  if (itemsRes.error) throw new Error(formatSupabaseError(itemsRes.error, "Árajánlat tételek"));

  return { quote: quoteRes.data as QuoteRow, items: (itemsRes.data ?? []) as QuoteItemRow[] };
}

export function draftFromPrice(
  gasType: string,
  size: string,
  quantity: number,
  prices: ProductPrice[],
  discountPercent = 0,
): QuoteItemDraft | null {
  const price = lookupProductPrice(gasType, size, prices);
  if (!price) return null;
  const list_price = price.eladasi_ar;
  return {
    gas_type: price.gas_type,
    size: price.size,
    quantity,
    list_price,
    discount_percent: discountPercent,
    unit_price: calcOfferPrice(list_price, discountPercent),
    is_custom_price: false,
  };
}

export async function saveQuote(input: {
  id?: string;
  partner_id: string;
  quote_number: string;
  quote_date: string;
  note?: string;
  items: QuoteItemDraft[];
}): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();

  const quotePayload = {
    partner_id: input.partner_id,
    quote_number: input.quote_number.trim(),
    quote_date: input.quote_date,
    note: input.note?.trim() || null,
    created_by: auth.user?.id ?? null,
  };

  let quoteId = input.id;

  if (quoteId) {
    const { error } = await supabase.from("quotes").update(quotePayload).eq("id", quoteId);
    if (error) throw new Error(formatSupabaseError(error, "Árajánlat mentése"));
    await supabase.from("quote_items").delete().eq("quote_id", quoteId);
  } else {
    const { data, error } = await supabase
      .from("quotes")
      .insert(quotePayload)
      .select("id")
      .single();
    if (error || !data) throw new Error(formatSupabaseError(error, "Árajánlat létrehozása"));
    quoteId = data.id;
  }

  if (input.items.length > 0) {
    const rows = input.items.map((item, i) => ({
      quote_id: quoteId!,
      gas_type: item.gas_type,
      size: item.size,
      quantity: item.quantity,
      list_price: item.list_price,
      discount_percent: item.discount_percent,
      unit_price: item.unit_price,
      is_custom_price: item.is_custom_price,
      sort_order: i,
    }));
    const { error } = await supabase.from("quote_items").insert(rows);
    if (error) throw new Error(formatSupabaseError(error, "Tételek mentése"));
  }

  return quoteId!;
}

export async function deleteQuote(id: string): Promise<void> {
  const { error } = await supabase.from("quotes").delete().eq("id", id);
  if (error) throw new Error(formatSupabaseError(error, "Árajánlat törlése"));
}

export function quoteItemLabel(item: QuoteItemRow | QuoteItemDraft): string {
  return productLabel(item.gas_type, item.size);
}

export function quoteTotal(items: { quantity: number; unit_price: number }[]): number {
  return items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
}

export async function lookupBeszerzesiAr(
  gasType: string,
  size: string,
  prices?: ProductPrice[],
): Promise<number | null> {
  const rows = prices ?? (await fetchProductPrices(true));
  return lookupProductPrice(gasType, size, rows)?.beszerzesi_ar ?? null;
}
