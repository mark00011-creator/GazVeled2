// Számlázz.hu Számla Agent – Edge Function (opcionális; az app createServerFn-t használ).
// Deploy: supabase functions deploy szamlazz-create-invoice
// Secret: SUPABASE_SERVICE_ROLE_KEY (auto), agent kulcs a organization_invoicing_secrets táblából.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SZAMLAZZ_URL = "https://www.szamlazz.hu/szamla/";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
      },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { documentId, previewOnly } = await req.json();
    if (!documentId) return json({ error: "documentId kötelező" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

    const { data: doc, error: docErr } = await userClient
      .from("invoice_documents")
      .select("*")
      .eq("id", documentId)
      .single();
    if (docErr || !doc) return json({ error: docErr?.message ?? "Nincs dokumentum" }, 404);

    const { data: secret } = await admin
      .from("organization_invoicing_secrets")
      .select("agent_key, invoice_prefix, eszamla, payment_method, due_days")
      .eq("organization_id", doc.organization_id)
      .maybeSingle();
    if (!secret?.agent_key) {
      return json({ error: "Nincs Számla Agent kulcs" }, 400);
    }

    const { data: items } = await userClient
      .from("invoice_document_items")
      .select("*")
      .eq("document_id", documentId)
      .order("line_no");

    const { data: partner } = await userClient
      .from("partners")
      .select("name, company_name, address, email, tax_number, phone")
      .eq("id", doc.partner_id)
      .single();

    // Minimális XML – a teljes builder a createServerFn útvonalon van;
    // Edge Function a production Vercel serverFn-t egészíti ki / fallback.
    const today = new Date().toISOString().slice(0, 10);
    const tetelek = (items ?? [])
      .map((it: Record<string, unknown>) => {
        const qty = Number(it.quantity) || 1;
        const netUnit = Number(it.net_unit_price) || 0;
        const net = netUnit * qty;
        const vatRate = String(it.vat_rate ?? "AAM");
        const vatMul = Number(vatRate);
        const vat = Number.isFinite(vatMul) ? (net * vatMul) / 100 : 0;
        return `<tetel>
  <megnevezes>${esc(String(it.name))}</megnevezes>
  <mennyiseg>${qty}</mennyiseg>
  <mennyisegiEgyseg>${esc(String(it.unit ?? "db"))}</mennyisegiEgyseg>
  <nettoEgysegar>${netUnit}</nettoEgysegar>
  <afakulcs>${esc(vatRate)}</afakulcs>
  <nettoErtek>${net}</nettoErtek>
  <afaErtek>${vat}</afaErtek>
  <bruttoErtek>${net + vat}</bruttoErtek>
  <megjegyzes></megjegyzes>
</tetel>`;
      })
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamla https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd">
<beallitasok>
  <szamlaagentkulcs>${esc(secret.agent_key)}</szamlaagentkulcs>
  <eszamla>${secret.eszamla ? "true" : "false"}</eszamla>
  <szamlaLetoltes>true</szamlaLetoltes>
  <valaszVerzio>2</valaszVerzio>
  <szamlaKulsoAzon>${esc(doc.id)}</szamlaKulsoAzon>
</beallitasok>
<fejlec>
  <keltDatum>${today}</keltDatum>
  <teljesitesDatum>${today}</teljesitesDatum>
  <fizetesiHataridoDatum>${today}</fizetesiHataridoDatum>
  <fizmod>${esc(doc.payment_method || secret.payment_method || "Átutalás")}</fizmod>
  <penznem>HUF</penznem>
  <szamlaNyelve>hu</szamlaNyelve>
  <megjegyzes>${esc(doc.note ?? "")}</megjegyzes>
  <arfolyamBank></arfolyamBank>
  <arfolyam>0.0</arfolyam>
  <rendelesSzam>${esc(doc.id)}</rendelesSzam>
  <dijbekeroSzamlaszam></dijbekeroSzamlaszam>
  <elolegszamla>false</elolegszamla>
  <vegszamla>false</vegszamla>
  <helyesbitoszamla>false</helyesbitoszamla>
  <helyesbitettSzamlaszam></helyesbitettSzamlaszam>
  <dijbekero>false</dijbekero>
  <szamlaszamElotag>${esc(secret.invoice_prefix ?? "")}</szamlaszamElotag>
  <fizetve>false</fizetve>
  <elonezetpdf>${previewOnly ? "true" : "false"}</elonezetpdf>
</fejlec>
<elado>
  <bank></bank>
  <bankszamlaszam></bankszamlaszam>
  <emailReplyto></emailReplyto>
  <emailTargy></emailTargy>
  <emailSzoveg></emailSzoveg>
  <alairoNeve></alairoNeve>
</elado>
<vevo>
  <nev>${esc((partner?.company_name || partner?.name || "Vevő").trim())}</nev>
  <orszag>Magyarország</orszag>
  <irsz>0000</irsz>
  <telepules>Ismeretlen</telepules>
  <cim>${esc(partner?.address || "Nincs megadva")}</cim>
  <email>${esc(partner?.email ?? "")}</email>
  <sendEmail>false</sendEmail>
  <adoalany>${partner?.tax_number ? 1 : -1}</adoalany>
  <adoszam>${esc(partner?.tax_number ?? "")}</adoszam>
  <telefonszam>${esc(partner?.phone ?? "")}</telefonszam>
  <megjegyzes></megjegyzes>
</vevo>
<tetelek>
${tetelek}
</tetelek>
</xmlszamla>`;

    const form = new FormData();
    form.append(
      "action-xmlagentxmlfile",
      new Blob([xml], { type: "text/xml; charset=UTF-8" }),
      "szamla.xml",
    );
    const agentRes = await fetch(SZAMLAZZ_URL, { method: "POST", body: form });
    const body = await agentRes.text();

    const ok = /<sikeres>\s*true\s*<\/sikeres>/i.test(body) || body.includes("DONE");
    if (!ok) {
      const msg =
        /<hibauzenet>\s*([^<]*)\s*<\/hibauzenet>/i.exec(body)?.[1] ||
        body.slice(0, 300);
      if (!previewOnly) {
        await userClient
          .from("invoice_documents")
          .update({ status: "failed", last_error: msg })
          .eq("id", documentId);
      }
      return json({ error: msg }, 400);
    }

    const invoiceNumber =
      /<szamlaszam>\s*([^<]*)\s*<\/szamlaszam>/i.exec(body)?.[1]?.trim() ||
      agentRes.headers.get("szlahu_szamlaszam");
    const pdf = /<pdf>\s*([^<]*)\s*<\/pdf>/i.exec(body)?.[1]?.replace(/\s+/g, "") || null;

    if (previewOnly) {
      return json({ preview: true, invoiceNumber, pdfBase64: pdf });
    }

    await userClient
      .from("invoice_documents")
      .update({
        status: "finalized",
        external_invoice_number: invoiceNumber,
        pdf_base64: pdf,
        finalized_at: new Date().toISOString(),
        finalized_by: userData.user.id,
        last_error: null,
      })
      .eq("id", documentId);

    const exchangeIds = (items ?? [])
      .map((i: { exchange_id?: string | null }) => i.exchange_id)
      .filter(Boolean);
    if (exchangeIds.length) {
      await userClient
        .from("exchanges")
        .update({
          invoiced: true,
          invoiced_at: new Date().toISOString(),
          external_invoice_number: invoiceNumber,
        })
        .in("id", exchangeIds)
        .eq("invoiced", false);
    }

    return json({ preview: false, invoiceNumber, pdfBase64: pdf });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
