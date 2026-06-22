import { supabase } from "@/integrations/supabase/client";
import { formatHuf, priceKey } from "@/lib/gas-order-prices";
import { buildPurchasePriceMap, fetchProductPrices, type ProductPrice } from "@/lib/product-prices";
import { formatSupabaseError } from "@/lib/supabase-error";

export type ExchangeProfitStats = {
  todayProfit: number;
  monthProfit: number;
  yearProfit: number;
  monthExchangeCount: number;
  monthAvgProfit: number | null;
};

export type TopExchangedProduct = {
  label: string;
  gas_type: string;
  size: string;
  count: number;
};

export type WarehouseInventoryValue = {
  totalValue: number;
  lines: { label: string; count: number; unitPrice: number | null; lineTotal: number | null }[];
};

function startOfDayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function startOfMonthIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function startOfYearIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), 0, 1).toISOString();
}

function sumProfit(rows: { profit: number }[]): number {
  return rows.reduce((s, r) => s + r.profit, 0);
}

type ExchangeQuery = {
  not: (col: string, op: string, val: unknown) => ExchangeQuery;
  eq: (col: string, val: unknown) => ExchangeQuery;
  gte: (col: string, val: string) => ExchangeQuery;
  order: (col: string, opts?: { ascending?: boolean }) => ExchangeQuery;
  limit: (n: number) => ExchangeQuery;
  select: (...args: unknown[]) => unknown;
};

/**
 * Bevételt generáló partner tranzakciók (csere, eladás, kínai eladás).
 * Üres visszavételnek nincs profit mezője.
 */
export function applyCompletedQuickExchangeFilters<T extends ExchangeQuery>(query: T): T {
  return query.not("profit", "is", null) as T;
}

type CylinderRef = { barcode: string; gas_type: string; size: string } | null;

export type UninvoicedExchange = {
  id: string;
  created_at: string;
  eladasi_ar: number;
  profit: number;
  partnerName: string;
  incomingLabel: string;
  outgoingLabel: string;
};

export type UninvoicedExchangeSummary = {
  count: number;
  totalSaleValue: number;
  recent: UninvoicedExchange[];
};

const UNINVOICED_SELECT = `
  id,
  created_at,
  eladasi_ar,
  profit,
  operation_type,
  note,
  partners ( name ),
  incoming: cylinders!exchanges_incoming_cylinder_id_fkey ( barcode, gas_type, size ),
  outgoing: cylinders!exchanges_outgoing_cylinder_id_fkey ( barcode, gas_type, size )
`;

function cylinderLabel(cyl: CylinderRef): string {
  if (!cyl) return "—";
  return `${cyl.barcode} · ${cyl.gas_type} ${cyl.size}`;
}

function mapUninvoicedRow(row: {
  id: string;
  created_at: string;
  eladasi_ar: number | null;
  profit: number | null;
  operation_type?: string | null;
  note?: string | null;
  partners: { name: string } | null;
  incoming: CylinderRef;
  outgoing: CylinderRef;
}): UninvoicedExchange {
  const op = row.operation_type ?? "exchange";
  let incomingLabel = cylinderLabel(row.incoming);
  let outgoingLabel = cylinderLabel(row.outgoing);
  if (op === "sale") incomingLabel = "— (eladás)";
  if (op === "chinese_sale") {
    incomingLabel = "—";
    outgoingLabel = row.note?.split(" · ")[0] ?? "Kínai eladás";
  }
  if (op === "flaga_sale") {
    incomingLabel = "—";
    outgoingLabel = row.note?.split(" · ")[0] ?? "FLAGA eladás";
  }
  if (op === "flaga_pb_sale") {
    incomingLabel = "—";
    outgoingLabel = row.note?.split(" · ")[0] ?? "FLAGA PB eladás";
  }
  if (op === "prima_pb_sale") {
    incomingLabel = "—";
    outgoingLabel = row.note?.split(" · ")[0] ?? "PRÍMA PB eladás";
  }
  return {
    id: row.id,
    created_at: row.created_at,
    eladasi_ar: row.eladasi_ar ?? 0,
    profit: row.profit ?? 0,
    partnerName: row.partners?.name ?? "—",
    incomingLabel,
    outgoingLabel,
  };
}

export async function fetchUninvoicedExchanges(limit = 5): Promise<UninvoicedExchangeSummary> {
  const base = applyCompletedQuickExchangeFilters(
    supabase.from("exchanges").select(UNINVOICED_SELECT).eq("invoiced", false),
  );

  const [allRes, recentRes] = await Promise.all([
    applyCompletedQuickExchangeFilters(
      supabase.from("exchanges").select("eladasi_ar").eq("invoiced", false),
    ),
    base.order("created_at", { ascending: false }).limit(limit),
  ]);

  if (allRes.error) throw new Error(formatSupabaseError(allRes.error, "Számlázatlan cserék száma"));
  if (recentRes.error)
    throw new Error(formatSupabaseError(recentRes.error, "Számlázatlan cserék listája"));

  const rows = allRes.data ?? [];
  const totalSaleValue = rows.reduce((s, r) => s + (r.eladasi_ar ?? 0), 0);

  return {
    count: rows.length,
    totalSaleValue,
    recent: (recentRes.data ?? []).map((row) =>
      mapUninvoicedRow(
        row as {
          id: string;
          created_at: string;
          eladasi_ar: number | null;
          profit: number | null;
          partners: { name: string } | null;
          incoming: CylinderRef;
          outgoing: CylinderRef;
        },
      ),
    ),
  };
}

export async function markExchangeInvoiced(exchangeId: string): Promise<void> {
  const { error } = await supabase
    .from("exchanges")
    .update({ invoiced: true, invoiced_at: new Date().toISOString() })
    .eq("id", exchangeId)
    .eq("invoiced", false);

  if (error) throw new Error(formatSupabaseError(error, "Kiszámlázás rögzítése"));
}

export async function fetchExchangeProfitStats(): Promise<ExchangeProfitStats> {
  const monthStart = startOfMonthIso();
  const yearStart = startOfYearIso();
  const todayStart = startOfDayIso();

  const [todayRes, monthRes, yearRes, monthCountRes] = await Promise.all([
    applyCompletedQuickExchangeFilters(
      supabase.from("exchanges").select("profit").gte("created_at", todayStart),
    ),
    applyCompletedQuickExchangeFilters(
      supabase.from("exchanges").select("profit").gte("created_at", monthStart),
    ),
    applyCompletedQuickExchangeFilters(
      supabase.from("exchanges").select("profit").gte("created_at", yearStart),
    ),
    applyCompletedQuickExchangeFilters(
      supabase
        .from("exchanges")
        .select("*", { count: "exact", head: true })
        .gte("created_at", monthStart),
    ),
  ]);

  if (todayRes.error) throw new Error(formatSupabaseError(todayRes.error, "Mai nyereség"));
  if (monthRes.error) throw new Error(formatSupabaseError(monthRes.error, "Havi nyereség"));
  if (yearRes.error) throw new Error(formatSupabaseError(yearRes.error, "Éves nyereség"));
  if (monthCountRes.error)
    throw new Error(formatSupabaseError(monthCountRes.error, "Cserek száma"));

  const monthProfit = sumProfit(monthRes.data ?? []);
  const monthExchangeCount = monthCountRes.count ?? 0;

  return {
    todayProfit: sumProfit(todayRes.data ?? []),
    monthProfit,
    yearProfit: sumProfit(yearRes.data ?? []),
    monthExchangeCount,
    monthAvgProfit: monthExchangeCount > 0 ? Math.round(monthProfit / monthExchangeCount) : null,
  };
}

export async function fetchTopExchangedProducts(limit = 5): Promise<TopExchangedProduct[]> {
  const monthStart = startOfMonthIso();

  const { data, error } = await applyCompletedQuickExchangeFilters(
    supabase
      .from("exchanges")
      .select("outgoing_cylinder_id, cylinders!exchanges_outgoing_cylinder_id_fkey(gas_type, size)")
      .not("outgoing_cylinder_id", "is", null)
      .gte("created_at", monthStart),
  );

  if (error) throw new Error(formatSupabaseError(error, "Forgalom statisztika"));

  const counts = new Map<string, TopExchangedProduct>();
  for (const row of data ?? []) {
    const cyl = row.cylinders as { gas_type: string; size: string } | null;
    if (!cyl) continue;
    const key = `${cyl.gas_type}|${cyl.size}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else
      counts.set(key, {
        label: `${cyl.gas_type} ${cyl.size}`,
        gas_type: cyl.gas_type,
        size: cyl.size,
        count: 1,
      });
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "hu"))
    .slice(0, limit);
}

export async function fetchWarehouseInventoryValue(
  prices?: ProductPrice[],
): Promise<WarehouseInventoryValue> {
  const priceRows = prices ?? (await fetchProductPrices(true));
  const purchaseMap = buildPurchasePriceMap(priceRows);

  const { data, error } = await supabase
    .from("cylinders")
    .select("gas_type, size")
    .eq("active", true)
    .eq("location_type", "warehouse_full")
    .eq("status", "full");

  if (error) throw new Error(formatSupabaseError(error, "Telephelyi készlet"));

  const counts = new Map<string, { label: string; count: number }>();
  for (const cyl of data ?? []) {
    const key = `${cyl.gas_type}|${cyl.size}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { label: `${cyl.gas_type} ${cyl.size}`, count: 1 });
  }

  let totalValue = 0;
  const lines = [...counts.values()]
    .map(({ label, count }) => {
      const parts = label.split(" ");
      const size = parts.slice(-2).join(" ");
      const gasType = parts.slice(0, -2).join(" ");
      const matchedPrice = purchaseMap.get(priceKey(gasType, size)) ?? null;
      const lineTotal = matchedPrice != null ? matchedPrice * count : null;
      if (lineTotal != null) totalValue += lineTotal;
      return { label, count, unitPrice: matchedPrice, lineTotal };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "hu"));

  return { totalValue, lines };
}

export function formatProfit(amount: number): string {
  return formatHuf(amount);
}
