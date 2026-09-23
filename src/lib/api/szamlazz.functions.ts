import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { callSzamlazzCreateInvoice } from "@/lib/szamlazz/agent.server";
import {
  addDaysIso,
  buildSzamlazzInvoiceXml,
  lineAmounts,
  todayIsoDate,
  type SzamlazzInvoiceLine,
} from "@/lib/szamlazz/xml";

const finalizeSchema = z.object({
  documentId: z.string().uuid(),
  previewOnly: z.boolean().optional(),
});

type SecretRow = {
  agent_key: string;
  invoice_prefix: string | null;
  eszamla: boolean;
  payment_method: string;
  due_days: number;
};

type DocRow = {
  id: string;
  organization_id: string;
  partner_id: string;
  status: string;
  payment_method: string;
  note: string | null;
  issue_date: string | null;
  fulfillment_date: string | null;
  due_date: string | null;
  external_invoice_ref: string | null;
};

type ItemRow = {
  id: string;
  exchange_id: string | null;
  name: string;
  quantity: number;
  unit: string;
  net_unit_price: number;
  vat_rate: string;
  note: string | null;
};

type PartnerRow = {
  name: string;
  company_name: string | null;
  address: string | null;
  email: string | null;
  tax_number: string | null;
  phone: string | null;
};

async function assertOrgAccess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (t: string) => any },
  orgId: string,
) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .single();
  if (error || !profile?.organization_id) {
    throw new Error("Nincs aktív szervezet");
  }
  if (profile.organization_id !== orgId) {
    throw new Error("Másik cég dokumentuma");
  }
  return profile as { organization_id: string; role: string };
}

/**
 * Draft véglegesítése vagy előnézet PDF a Számla Agenten keresztül.
 * Agent kulcs service_role-lal olvasható; soha nem megy a kliensnek.
 */
export const finalizeSzamlazzInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(finalizeSchema)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const previewOnly = !!data.previewOnly;

    const { data: doc, error: docErr } = await supabase
      .from("invoice_documents")
      .select(
        "id, organization_id, partner_id, status, payment_method, note, issue_date, fulfillment_date, due_date, external_invoice_ref",
      )
      .eq("id", data.documentId)
      .single();
    if (docErr || !doc) throw new Error(docErr?.message ?? "Dokumentum nem található");
    const document = doc as DocRow;

    await assertOrgAccess(supabase, document.organization_id);

    if (!previewOnly && document.status === "finalized") {
      throw new Error("A számla már véglegesítve van");
    }

    const { data: items, error: itemsErr } = await supabase
      .from("invoice_document_items")
      .select("id, exchange_id, name, quantity, unit, net_unit_price, vat_rate, note")
      .eq("document_id", document.id)
      .order("line_no", { ascending: true });
    if (itemsErr) throw new Error(itemsErr.message);
    const lineRows = (items ?? []) as ItemRow[];
    if (lineRows.length === 0) throw new Error("Nincs számlatétel");

    const { data: partner, error: partnerErr } = await supabase
      .from("partners")
      .select("name, company_name, address, email, tax_number, phone")
      .eq("id", document.partner_id)
      .single();
    if (partnerErr || !partner) throw new Error(partnerErr?.message ?? "Partner nem található");
    const p = partner as PartnerRow;

    const { data: secret, error: secretErr } = await supabaseAdmin
      .from("organization_invoicing_secrets")
      .select("agent_key, invoice_prefix, eszamla, payment_method, due_days")
      .eq("organization_id", document.organization_id)
      .maybeSingle();
    if (secretErr) throw new Error(secretErr.message);
    if (!secret?.agent_key) {
      throw new Error(
        "Nincs Számla Agent kulcs. Állítsd be a Cég beállításokban (teszt fiók kulcsa ajánlott).",
      );
    }
    const sec = secret as SecretRow;

    const today = todayIsoDate();
    const issue = document.issue_date ?? today;
    const fulfill = document.fulfillment_date ?? issue;
    const due =
      document.due_date ?? addDaysIso(issue, sec.due_days ?? 8);

    const lines: SzamlazzInvoiceLine[] = lineRows.map((r) => ({
      name: r.name,
      quantity: Number(r.quantity),
      unit: r.unit || "db",
      netUnitPrice: r.net_unit_price,
      vatRate: r.vat_rate,
      note: r.note,
    }));

    // Összegek frissítése drafton (előnézet / véglegesítés előtt)
    let netTotal = 0;
    let vatTotal = 0;
    let grossTotal = 0;
    for (const line of lines) {
      const a = lineAmounts(line);
      netTotal += Math.round(a.net);
      vatTotal += Math.round(a.vat);
      grossTotal += Math.round(a.gross);
    }

    if (!previewOnly) {
      await supabase
        .from("invoice_documents")
        .update({
          status: "finalizing",
          issue_date: issue,
          fulfillment_date: fulfill,
          due_date: due,
          net_total: netTotal,
          vat_total: vatTotal,
          gross_total: grossTotal,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", document.id);
    }

    const result = await callSzamlazzCreateInvoice({
      agentKey: sec.agent_key,
      eszamla: !!sec.eszamla,
      downloadPdf: true,
      responseVersion: 2,
      previewOnly,
      prefix: sec.invoice_prefix,
      paymentMethod: document.payment_method || sec.payment_method || "Átutalás",
      comment: document.note,
      orderNumber: document.external_invoice_ref ?? document.id,
      externalId: document.id,
      issueDate: issue,
      fulfillmentDate: fulfill,
      dueDate: due,
      buyer: {
        name: (p.company_name || p.name).trim(),
        address: p.address,
        email: p.email,
        taxNumber: p.tax_number,
        phone: p.phone,
      },
      lines,
    });

    if (!result.ok) {
      if (!previewOnly) {
        await supabase
          .from("invoice_documents")
          .update({
            status: "failed",
            last_error: result.errorMessage,
            updated_at: new Date().toISOString(),
          })
          .eq("id", document.id);
      }
      throw new Error(result.errorMessage);
    }

    if (previewOnly) {
      return {
        preview: true as const,
        invoiceNumber: result.invoiceNumber,
        pdfBase64: result.pdfBase64,
        netTotal,
        grossTotal,
      };
    }

    const invoiceNumber = result.invoiceNumber;
    const { error: finRpcErr } = await supabase.rpc("finalize_invoice_document_exchanges", {
      p_document_id: document.id,
      p_external_invoice_number: invoiceNumber,
    });
    if (finRpcErr) throw new Error(finRpcErr.message);

    // PDF / nettók külön (RPC nem tárolja a nagy PDF-et mindig)
    await supabase
      .from("invoice_documents")
      .update({
        pdf_base64: result.pdfBase64,
        net_total: netTotal,
        vat_total: vatTotal,
        gross_total: grossTotal,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", document.id);

    return {
      preview: false as const,
      invoiceNumber,
      pdfBase64: result.pdfBase64,
      netTotal,
      grossTotal,
    };
  });

/** XML smoke-test – csak bejelentkezett user */
export const buildSzamlazzXmlPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      agentKeyPlaceholder: z.string().default("TESTKEY"),
      buyerName: z.string(),
      lineName: z.string(),
      netUnitPrice: z.number(),
      vatRate: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const today = todayIsoDate();
    return buildSzamlazzInvoiceXml({
      agentKey: data.agentKeyPlaceholder,
      issueDate: today,
      fulfillmentDate: today,
      dueDate: addDaysIso(today, 8),
      buyer: { name: data.buyerName },
      lines: [
        {
          name: data.lineName,
          quantity: 1,
          netUnitPrice: data.netUnitPrice,
          vatRate: data.vatRate,
        },
      ],
      previewOnly: true,
    });
  });
