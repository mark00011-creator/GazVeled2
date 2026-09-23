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

const UNINVOICED_SELECT = `
  id,
  batch_id,
  partner_id,
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

export type UninvoicedExchangeItem = {
  exchangeId: string;
  incomingLabel: string;
  outgoingLabel: string;
  eladasi_ar: number;
  profit: number;
};

export type UninvoicedExchange = {
  /** UI kulcs: batch_id vagy egyedi exchange id */
  id: string;
  batchId: string | null;
  partnerId: string;
  exchangeIds: string[];
  created_at: string;
  eladasi_ar: number;
  profit: number;
  partnerName: string;
  incomingLabel: string;
  outgoingLabel: string;
  items: UninvoicedExchangeItem[];
  pairCount: number;
};

export type UninvoicedExchangeSummary = {
  count: number;
  totalSaleValue: number;
  recent: UninvoicedExchange[];
};

function mapUninvoicedRow(row: {
  id: string;
  batch_id?: string | null;
  partner_id?: string | null;
  created_at: string;
  eladasi_ar: number | null;
  profit: number | null;
  operation_type?: string | null;
  note?: string | null;
  partners: { name: string } | null;
  incoming: CylinderRef;
  outgoing: CylinderRef;
}): UninvoicedExchangeItem & {
  batchId: string | null;
  partnerId: string;
  created_at: string;
  partnerName: string;
} {
  const op = row.operation_type ?? "exchange";
  let incomingLabel = cylinderLabel(row.incoming);
  let outgoingLabel = cylinderLabel(row.outgoing);
  if (op === "sale") incomingLabel = "— (eladás)";
  if (op === "loan") incomingLabel = "— (kölcsön)";
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
    exchangeId: row.id,
    batchId: row.batch_id ?? null,
    partnerId: row.partner_id ?? "",
    created_at: row.created_at,
    partnerName: row.partners?.name ?? "—",
    incomingLabel,
    outgoingLabel,
    eladasi_ar: row.eladasi_ar ?? 0,
    profit: row.profit ?? 0,
  };
}

function groupUninvoicedRows(
  rows: ReturnType<typeof mapUninvoicedRow>[],
): UninvoicedExchange[] {
  const groups = new Map<string, UninvoicedExchange>();
  for (const row of rows) {
    const key = row.batchId ?? row.exchangeId;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        id: key,
        batchId: row.batchId,
        partnerId: row.partnerId,
        exchangeIds: [row.exchangeId],
        created_at: row.created_at,
        eladasi_ar: row.eladasi_ar,
        profit: row.profit,
        partnerName: row.partnerName,
        incomingLabel: row.incomingLabel,
        outgoingLabel: row.outgoingLabel,
        items: [
          {
            exchangeId: row.exchangeId,
            incomingLabel: row.incomingLabel,
            outgoingLabel: row.outgoingLabel,
            eladasi_ar: row.eladasi_ar,
            profit: row.profit,
          },
        ],
        pairCount: 1,
      });
      continue;
    }
    existing.exchangeIds.push(row.exchangeId);
    existing.eladasi_ar += row.eladasi_ar;
    existing.profit += row.profit;
    existing.items.push({
      exchangeId: row.exchangeId,
      incomingLabel: row.incomingLabel,
      outgoingLabel: row.outgoingLabel,
      eladasi_ar: row.eladasi_ar,
      profit: row.profit,
    });
    existing.pairCount = existing.items.length;
    if (row.created_at > existing.created_at) existing.created_at = row.created_at;
  }
  return [...groups.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function fetchUninvoicedExchanges(limit = 5): Promise<UninvoicedExchangeSummary> {
  const [allRes, recentRes] = await Promise.all([
    applyCompletedQuickExchangeFilters(
      supabase.from("exchanges").select("id, batch_id, eladasi_ar").eq("invoiced", false),
    ),
    applyCompletedQuickExchangeFilters(
      supabase.from("exchanges").select(UNINVOICED_SELECT).eq("invoiced", false),
    )
      .order("created_at", { ascending: false })
      .limit(Math.max(limit * 20, 40)),
  ]);

  if (allRes.error) throw new Error(formatSupabaseError(allRes.error, "Számlázatlan cserék száma"));
  if (recentRes.error)
    throw new Error(formatSupabaseError(recentRes.error, "Számlázatlan cserék listája"));

  const allRows = allRes.data ?? [];
  const totalSaleValue = allRows.reduce((s, r) => s + (r.eladasi_ar ?? 0), 0);
  const allGroupKeys = new Set(
    allRows.map((r) => (r as { batch_id?: string | null }).batch_id ?? r.id),
  );

  const mapped = (recentRes.data ?? []).map((row) =>
    mapUninvoicedRow(
      row as {
        id: string;
        batch_id?: string | null;
        partner_id?: string | null;
        created_at: string;
        eladasi_ar: number | null;
        profit: number | null;
        operation_type?: string | null;
        note?: string | null;
        partners: { name: string } | null;
        incoming: CylinderRef;
        outgoing: CylinderRef;
      },
    ),
  );
  const grouped = groupUninvoicedRows(mapped);

  return {
    count: allGroupKeys.size,
    totalSaleValue,
    recent: grouped.slice(0, limit),
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

export async function markUninvoicedGroupInvoiced(group: {
  batchId: string | null;
  exchangeIds: string[];
}): Promise<void> {
  if (group.batchId) {
    const { error } = await supabase.rpc("mark_exchange_batch_invoiced", {
      p_batch_id: group.batchId,
    });
    if (error) throw new Error(formatSupabaseError(error, "Batch kiszámlázás rögzítése"));
    return;
  }
  if (group.exchangeIds.length === 0) return;
  if (group.exchangeIds.length === 1) {
    await markExchangeInvoiced(group.exchangeIds[0]);
    return;
  }
  const { error } = await supabase
    .from("exchanges")
    .update({ invoiced: true, invoiced_at: new Date().toISOString() })
    .in("id", group.exchangeIds)
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

export type MonthlyProfitRow = {
  year: number;
  month: number; // 1–12
  label: string;
  profit: number;
  exchangeCount: number;
};

const HU_MONTHS = [
  "Január",
  "Február",
  "Március",
  "Április",
  "Május",
  "Június",
  "Július",
  "Augusztus",
  "Szeptember",
  "Október",
  "November",
  "December",
];

/** Aktuális naptári év havi nyereség / bevétel lebontása (csere profit). */
export async function fetchYearlyMonthlyProfitBreakdown(
  year = new Date().getFullYear(),
): Promise<MonthlyProfitRow[]> {
  const yearStart = new Date(year, 0, 1).toISOString();
  const yearEnd = new Date(year + 1, 0, 1).toISOString();

  const { data, error } = await applyCompletedQuickExchangeFilters(
    supabase
      .from("exchanges")
      .select("profit, created_at")
      .gte("created_at", yearStart)
      .lt("created_at", yearEnd),
  );
  if (error) throw new Error(formatSupabaseError(error, "Éves havi lebontás"));

  const buckets = Array.from({ length: 12 }, (_, i) => ({
    year,
    month: i + 1,
    label: HU_MONTHS[i],
    profit: 0,
    exchangeCount: 0,
  }));

  for (const row of data ?? []) {
    const d = new Date(row.created_at as string);
    if (d.getFullYear() !== year) continue;
    const idx = d.getMonth();
    buckets[idx].profit += Number(row.profit) || 0;
    buckets[idx].exchangeCount += 1;
  }

  return buckets;
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
