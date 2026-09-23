import { supabase } from "@/integrations/supabase/client";
import { formatSupabaseError } from "@/lib/supabase-error";
import { resolveVatRate, lineAmounts } from "@/lib/szamlazz/xml";
import type { TaxRegime } from "@/lib/organization";

export type InvoiceDocumentStatus = "draft" | "finalizing" | "finalized" | "failed";

export type InvoiceDraftItemInput = {
  exchangeId?: string | null;
  name: string;
  quantity?: number;
  unit?: string;
  netUnitPrice: number;
  vatRate: string;
  note?: string | null;
};

export type InvoiceDocument = {
  id: string;
  partner_id: string;
  status: InvoiceDocumentStatus;
  batch_id: string | null;
  payment_method: string;
  note: string | null;
  net_total: number;
  vat_total: number;
  gross_total: number;
  external_invoice_number: string | null;
  last_error: string | null;
  created_at: string;
};

export type InvoiceDocumentItem = {
  id: string;
  exchange_id: string | null;
  line_no: number;
  name: string;
  quantity: number;
  unit: string;
  net_unit_price: number;
  vat_rate: string;
  net_amount: number;
  vat_amount: number;
  gross_amount: number;
  note: string | null;
};

export type SzamlazzPublicSettings = {
  has_agent_key: boolean;
  invoice_prefix: string | null;
  eszamla: boolean;
  payment_method: string;
  due_days: number;
};

export async function fetchSzamlazzPublicSettings(): Promise<SzamlazzPublicSettings | null> {
  const { data, error } = await supabase.rpc("get_szamlazz_invoicing_public_settings");
  if (error) throw new Error(formatSupabaseError(error, "Számlázz beállítások"));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    has_agent_key: !!row.has_agent_key,
    invoice_prefix: row.invoice_prefix ?? null,
    eszamla: !!row.eszamla,
    payment_method: row.payment_method ?? "Átutalás",
    due_days: row.due_days ?? 8,
  };
}

export async function saveSzamlazzAgentKey(input: {
  agentKey: string;
  invoicePrefix?: string | null;
  eszamla?: boolean;
  paymentMethod?: string;
  dueDays?: number;
}): Promise<void> {
  const { error } = await supabase.rpc("upsert_szamlazz_agent_key", {
    p_agent_key: input.agentKey,
    p_invoice_prefix: input.invoicePrefix ?? null,
    p_eszamla: input.eszamla ?? false,
    p_payment_method: input.paymentMethod ?? "Átutalás",
    p_due_days: input.dueDays ?? 8,
  });
  if (error) throw new Error(formatSupabaseError(error, "Agent kulcs mentése"));
}

export async function clearSzamlazzAgentKey(): Promise<void> {
  const { error } = await supabase.rpc("clear_szamlazz_agent_key");
  if (error) throw new Error(formatSupabaseError(error, "Agent kulcs törlése"));
}

export async function updateSzamlazzInvoicingSettings(input: {
  invoicePrefix?: string | null;
  eszamla?: boolean;
  paymentMethod?: string;
  dueDays?: number;
}): Promise<void> {
  const { error } = await supabase.rpc("update_szamlazz_invoicing_settings", {
    p_invoice_prefix: input.invoicePrefix ?? null,
    p_eszamla: input.eszamla ?? false,
    p_payment_method: input.paymentMethod ?? "Átutalás",
    p_due_days: input.dueDays ?? 8,
  });
  if (error) throw new Error(formatSupabaseError(error, "Számlázz beállítások"));
}

function totalsFromItems(items: InvoiceDraftItemInput[]) {
  let net = 0;
  let vat = 0;
  let gross = 0;
  for (const it of items) {
    const a = lineAmounts({
      name: it.name,
      quantity: it.quantity ?? 1,
      netUnitPrice: it.netUnitPrice,
      vatRate: it.vatRate,
    });
    net += Math.round(a.net);
    vat += Math.round(a.vat);
    gross += Math.round(a.gross);
  }
  return { net, vat, gross };
}

export async function createInvoiceDraft(input: {
  organizationId: string;
  partnerId: string;
  batchId?: string | null;
  note?: string | null;
  paymentMethod?: string;
  items: InvoiceDraftItemInput[];
}): Promise<string> {
  if (!input.items.length) throw new Error("Legalább egy tétel kell");
  const t = totalsFromItems(input.items);

  const { data: doc, error } = await supabase
    .from("invoice_documents")
    .insert({
      organization_id: input.organizationId,
      partner_id: input.partnerId,
      status: "draft",
      provider: "szamlazz",
      batch_id: input.batchId ?? null,
      note: input.note ?? null,
      payment_method: input.paymentMethod ?? "Átutalás",
      net_total: t.net,
      vat_total: t.vat,
      gross_total: t.gross,
    } as never)
    .select("id")
    .single();
  if (error || !doc) throw new Error(formatSupabaseError(error, "Számla draft létrehozása"));

  const rows = input.items.map((it, i) => {
    const qty = it.quantity ?? 1;
    const a = lineAmounts({
      name: it.name,
      quantity: qty,
      netUnitPrice: it.netUnitPrice,
      vatRate: it.vatRate,
    });
    return {
      organization_id: input.organizationId,
      document_id: (doc as { id: string }).id,
      exchange_id: it.exchangeId ?? null,
      line_no: i + 1,
      name: it.name,
      quantity: qty,
      unit: it.unit ?? "db",
      net_unit_price: it.netUnitPrice,
      vat_rate: it.vatRate,
      net_amount: Math.round(a.net),
      vat_amount: Math.round(a.vat),
      gross_amount: Math.round(a.gross),
      note: it.note ?? null,
    };
  });

  const { error: itemsErr } = await supabase
    .from("invoice_document_items")
    .insert(rows as never);
  if (itemsErr) {
    await supabase.from("invoice_documents").delete().eq("id", (doc as { id: string }).id);
    throw new Error(formatSupabaseError(itemsErr, "Számla tételek mentése"));
  }

  return (doc as { id: string }).id;
}

export async function fetchInvoiceDocument(documentId: string): Promise<{
  document: InvoiceDocument;
  items: InvoiceDocumentItem[];
  partnerName: string;
}> {
  const { data: doc, error } = await supabase
    .from("invoice_documents")
    .select(
      "id, partner_id, status, batch_id, payment_method, note, net_total, vat_total, gross_total, external_invoice_number, last_error, created_at, partners(name)",
    )
    .eq("id", documentId)
    .single();
  if (error || !doc) throw new Error(formatSupabaseError(error, "Számla betöltése"));

  const { data: items, error: itemsErr } = await supabase
    .from("invoice_document_items")
    .select(
      "id, exchange_id, line_no, name, quantity, unit, net_unit_price, vat_rate, net_amount, vat_amount, gross_amount, note",
    )
    .eq("document_id", documentId)
    .order("line_no", { ascending: true });
  if (itemsErr) throw new Error(formatSupabaseError(itemsErr, "Számla tételek"));

  const row = doc as InvoiceDocument & { partners: { name: string } | null };
  return {
    document: {
      id: row.id,
      partner_id: row.partner_id,
      status: row.status,
      batch_id: row.batch_id,
      payment_method: row.payment_method,
      note: row.note,
      net_total: row.net_total,
      vat_total: row.vat_total,
      gross_total: row.gross_total,
      external_invoice_number: row.external_invoice_number,
      last_error: row.last_error,
      created_at: row.created_at,
    },
    items: (items ?? []) as InvoiceDocumentItem[],
    partnerName: row.partners?.name ?? "—",
  };
}

export async function updateInvoiceDraftItems(
  documentId: string,
  organizationId: string,
  items: InvoiceDraftItemInput[],
): Promise<void> {
  const t = totalsFromItems(items);
  const { error: delErr } = await supabase
    .from("invoice_document_items")
    .delete()
    .eq("document_id", documentId);
  if (delErr) throw new Error(formatSupabaseError(delErr, "Tételek törlése"));

  const rows = items.map((it, i) => {
    const qty = it.quantity ?? 1;
    const a = lineAmounts({
      name: it.name,
      quantity: qty,
      netUnitPrice: it.netUnitPrice,
      vatRate: it.vatRate,
    });
    return {
      organization_id: organizationId,
      document_id: documentId,
      exchange_id: it.exchangeId ?? null,
      line_no: i + 1,
      name: it.name,
      quantity: qty,
      unit: it.unit ?? "db",
      net_unit_price: it.netUnitPrice,
      vat_rate: it.vatRate,
      net_amount: Math.round(a.net),
      vat_amount: Math.round(a.vat),
      gross_amount: Math.round(a.gross),
      note: it.note ?? null,
    };
  });

  const { error: insErr } = await supabase
    .from("invoice_document_items")
    .insert(rows as never);
  if (insErr) throw new Error(formatSupabaseError(insErr, "Tételek mentése"));

  const { error: upErr } = await supabase
    .from("invoice_documents")
    .update({
      net_total: t.net,
      vat_total: t.vat,
      gross_total: t.gross,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", documentId);
  if (upErr) throw new Error(formatSupabaseError(upErr, "Összegek frissítése"));
}

/** Gyors csere csoportból draft tételek. */
export function buildDraftItemsFromUninvoicedGroup(opts: {
  items: {
    exchangeId: string;
    outgoingLabel: string;
    eladasi_ar: number;
  }[];
  taxRegime: TaxRegime;
  defaultVatRate: number;
}): InvoiceDraftItemInput[] {
  const vatRate = resolveVatRate({
    regime: opts.taxRegime,
    defaultRate: opts.defaultVatRate,
  });
  return opts.items.map((it) => ({
    exchangeId: it.exchangeId,
    name: `Gázcsere: ${it.outgoingLabel}`,
    quantity: 1,
    unit: "db",
    netUnitPrice: Math.max(0, it.eladasi_ar || 0),
    vatRate,
  }));
}
