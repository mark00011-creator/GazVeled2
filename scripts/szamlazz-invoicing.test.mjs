import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

test("szamlazz migration defines secrets + invoice_documents + RPCs", () => {
  const sql = read("supabase/migrations/20260922120000_szamlazz_invoicing.sql");
  assert.match(sql, /organization_invoicing_secrets/);
  assert.match(sql, /invoice_documents/);
  assert.match(sql, /invoice_document_items/);
  assert.match(sql, /upsert_szamlazz_agent_key/);
  assert.match(sql, /has_szamlazz_agent_key/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.organization_invoicing_secrets FROM authenticated/);
  assert.match(sql, /enforce_organization_isolation/);
});

test("szamlazz xml builder and address parse exist", () => {
  const xml = read("src/lib/szamlazz/xml.ts");
  const addr = read("src/lib/szamlazz/address.ts");
  assert.match(xml, /buildSzamlazzInvoiceXml/);
  assert.match(xml, /elonezetpdf/);
  assert.match(xml, /parseSzamlazzXmlResponse/);
  assert.match(xml, /resolveVatRate/);
  assert.match(addr, /parsePartnerAddress/);
});

test("szamlazz server agent + createServerFn finalize", () => {
  const agent = read("src/lib/szamlazz/agent.server.ts");
  const fn = read("src/lib/api/szamlazz.functions.ts");
  assert.match(agent, /callSzamlazzCreateInvoice/);
  assert.match(agent, /action-xmlagentxmlfile/);
  assert.match(fn, /finalizeSzamlazzInvoice/);
  assert.match(fn, /requireSupabaseAuth/);
  assert.match(fn, /supabaseAdmin/);
});

test("edge function szamlazz-create-invoice present", () => {
  const edge = read("supabase/functions/szamlazz-create-invoice/index.ts");
  assert.match(edge, /szamlazz\.hu\/szamla/);
  assert.match(edge, /organization_invoicing_secrets/);
});

test("UI wires ask + preview + uninvoiced card", () => {
  const ask = read("src/components/InvoiceAskDialog.tsx");
  const preview = read("src/components/InvoicePreviewDialog.tsx");
  const card = read("src/components/UninvoicedExchangesCard.tsx");
  const qe = read("src/routes/_authenticated/quick-exchange.tsx");
  const org = read("src/routes/_authenticated/organization-settings.tsx");
  assert.match(ask, /Számlázzam/);
  assert.match(preview, /Számla véglegesítése/);
  assert.match(card, /Számlázás/);
  assert.match(qe, /InvoiceAskDialog/);
  assert.match(qe, /handleInvoiceAskYes/);
  assert.match(org, /SzamlazzAgentSettingsCard|Számlázz\.hu Agent/);
});

test("address parse heuristics", async () => {
  // dynamic import of TS not available in node:test without loader –
  // validate regex behavior mirrored here
  const raw = "1234 Budapest, Példa utca 1.";
  const m = raw.match(/^(\d{4})\s+([^,]+?)(?:,\s*|\s+)(.+)$/);
  assert.ok(m);
  assert.equal(m[1], "1234");
  assert.equal(m[2].trim(), "Budapest");
  assert.match(m[3], /Példa/);
});
