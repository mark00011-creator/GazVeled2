import { supabase } from "@/integrations/supabase/client";
import {
  canExchangeSettleDifference,
  formatCirculationDifferenceWarning,
  type ExchangeCirculationSide,
} from "@/lib/exchange-circulation";
import { formatSupabaseError } from "@/lib/supabase-error";

/** Körforgás-eltérés státusz (DB: circulation_difference_status). */
export type CirculationDifferenceStatus = "open" | "partially_settled" | "closed";

export const CIRCULATION_DIFFERENCE_STATUS_LABELS: Record<CirculationDifferenceStatus, string> = {
  open: "Nyitott",
  partially_settled: "Részben rendezett",
  closed: "Lezárt",
};

/**
 * Körforgás-eltérés rekord – mezők jelentése (AI lekérdezéshez):
 * - partner_id: melyik partnernél keletkezett
 * - incoming_exchange_circulation / outgoing_exchange_circulation: finom körforgás-kulcs
 * - incoming_gas_type / outgoing_gas_type: hozott / kiadott gáz
 * - size: palack méret
 * - quantity: darabszám (sorszámos palacknál 1)
 * - quantity_settled: eddig rendezett darabszám
 * - exchange_id: létrehozó csere
 * - status: open | partially_settled | closed
 */
export type CirculationDifferenceRow = {
  id: string;
  partner_id: string;
  created_at: string;
  incoming_exchange_circulation: string;
  outgoing_exchange_circulation: string;
  incoming_gas_type: string;
  outgoing_gas_type: string;
  size: string;
  quantity: number;
  quantity_settled: number;
  created_by: string | null;
  note: string | null;
  status: CirculationDifferenceStatus;
  exchange_id: string | null;
};

export type CirculationDifferenceSettlementRow = {
  id: string;
  difference_id: string;
  settling_exchange_id: string;
  quantity_settled: number;
  created_at: string;
  created_by: string | null;
};

export async function fetchOpenCirculationDifferences(
  partnerId: string,
): Promise<CirculationDifferenceRow[]> {
  const { data, error } = await supabase
    .from("circulation_differences")
    .select("*")
    .eq("partner_id", partnerId)
    .in("status", ["open", "partially_settled"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(formatSupabaseError(error, "Körforgás-eltérések betöltése"));
  return (data ?? []) as CirculationDifferenceRow[];
}

export async function fetchOpenCirculationDifferenceWarnings(partnerId: string): Promise<string[]> {
  const rows = await fetchOpenCirculationDifferences(partnerId);
  return rows.map(formatCirculationDifferenceWarning);
}

export function findSettleableDifferences(
  openDiffs: CirculationDifferenceRow[],
  incoming: ExchangeCirculationSide,
  outgoing: ExchangeCirculationSide,
): CirculationDifferenceRow[] {
  return openDiffs.filter((d) => canExchangeSettleDifference(d, incoming, outgoing));
}

/** Bejövő palack alapján: mely nyitott eltérések rendezhetők (még nincs kimenő). */
export function findDiffsMatchingIncoming(
  openDiffs: CirculationDifferenceRow[],
  incoming: ExchangeCirculationSide,
): CirculationDifferenceRow[] {
  return openDiffs.filter(
    (d) =>
      d.outgoing_exchange_circulation === incoming.key &&
      d.outgoing_gas_type === incoming.gas_type &&
      d.size === incoming.size &&
      d.quantity - d.quantity_settled > 0,
  );
}

export async function fetchPartnerOpenDifferenceCount(partnerId: string): Promise<number> {
  const { count, error } = await supabase
    .from("circulation_differences")
    .select("*", { count: "exact", head: true })
    .eq("partner_id", partnerId)
    .in("status", ["open", "partially_settled"]);
  if (error) throw new Error(formatSupabaseError(error, "Nyitott eltérések száma"));
  return count ?? 0;
}

/** AI előkészítés: nyitott eltérések partnerenként (view). */
export type PartnerOpenDifferenceSummary = {
  partner_id: string;
  partner_name: string;
  open_count: number;
  open_quantity: number;
};

export async function fetchPartnerOpenDifferenceSummaries(): Promise<PartnerOpenDifferenceSummary[]> {
  const { data, error } = await supabase.from("partner_open_circulation_differences_v").select("*");
  if (error) throw new Error(formatSupabaseError(error, "Partner eltérés összesítő"));
  return (data ?? []) as PartnerOpenDifferenceSummary[];
}

export async function logCirculationDifferenceAudit(args: {
  partner_id: string;
  action: string;
  difference_id?: string;
  exchange_id?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  await supabase.from("audit_log").insert({
    user_id: auth.user?.id ?? null,
    action: args.action,
    entity_type: "circulation_difference",
    entity_id: args.difference_id ?? args.exchange_id ?? null,
    new_value: {
      partner_id: args.partner_id,
      exchange_id: args.exchange_id,
      ...(args.detail ?? {}),
    },
  });
}
