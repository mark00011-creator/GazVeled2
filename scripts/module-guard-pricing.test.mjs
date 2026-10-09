import test from "node:test";
import assert from "node:assert/strict";
import {
  isInvoicingEnabled,
  isDeliveryNotesEnabled,
  parseOrganizationSettings,
  DEFAULT_ORGANIZATION_SETTINGS,
} from "../src/lib/organization.ts";

test("INVOICING off when provider null and modules.invoicing not true", () => {
  const s = parseOrganizationSettings({
    modules: { chinese_stock: true },
    invoicing: { provider: null },
  });
  assert.equal(isInvoicingEnabled(s), false);
});

test("INVOICING on when provider szamlazz", () => {
  const s = parseOrganizationSettings({
    invoicing: { provider: "szamlazz" },
  });
  assert.equal(isInvoicingEnabled(s), true);
});

test("INVOICING explicit modules.invoicing false wins over provider", () => {
  const s = parseOrganizationSettings({
    modules: { invoicing: false },
    invoicing: { provider: "szamlazz" },
  });
  assert.equal(isInvoicingEnabled(s), false);
});

test("DELIVERY_NOTES defaults true", () => {
  const s = parseOrganizationSettings({});
  assert.equal(isDeliveryNotesEnabled(s), true);
  assert.equal(isDeliveryNotesEnabled(DEFAULT_ORGANIZATION_SETTINGS), true);
});

test("DELIVERY_NOTES can be disabled", () => {
  const s = parseOrganizationSettings({ modules: { delivery_notes: false } });
  assert.equal(isDeliveryNotesEnabled(s), false);
});

test("gas+size product key consolidation heuristic", () => {
  function productKey(label) {
    return (
      label
        .replace(/^Kínai csere:\s*/i, "")
        .replace(/^[^\s·]+ · /, "")
        .split(" · ")[0]
        ?.trim() || label
    );
  }
  const labels = [
    "hu1 · Argon 20 L",
    "Kínai csere: Argon 20 L · teli ki 1",
    "hu2 · Argon 10 L",
  ];
  const keys = new Set(labels.map(productKey));
  assert.equal(keys.size, 2);
  assert.ok(keys.has("Argon 20 L"));
  assert.ok(keys.has("Argon 10 L"));
});

test("createInvoiceDraft / createDeliveryNoteDraft source guards exist", async () => {
  const fs = await import("node:fs");
  const inv = fs.readFileSync("src/lib/invoice-drafts.ts", "utf8");
  const dn = fs.readFileSync("src/lib/delivery-notes/ops.ts", "utf8");
  assert.match(inv, /isInvoicingEnabled/);
  assert.match(inv, /A számlázás modul nincs bekapcsolva/);
  assert.match(dn, /isDeliveryNotesEnabled/);
  assert.match(dn, /A szállítólevél modul nincs bekapcsolva/);
});

test("uninvoiced reminder is itemized and invoice actions follow the module", async () => {
  const fs = await import("node:fs");
  const card = fs.readFileSync("src/components/UninvoicedExchangesCard.tsx", "utf8");
  assert.match(card, /isInvoicingEnabled\(organization\?\.settings\)/);
  assert.match(card, /formatProfit\(item\.eladasi_ar\)/);
  assert.match(card, /invoicingOn &&/);
  assert.match(card, /Mégse/);
  assert.match(card, /markUninvoicedGroupInvoiced/);
});

test("quick exchange prompts are module-gated", async () => {
  const fs = await import("node:fs");
  const qe = fs.readFileSync("src/routes/_authenticated/quick-exchange.tsx", "utf8");
  assert.match(qe, /isInvoicingEnabled\(orgSettings\)/);
  assert.match(qe, /isDeliveryNotesEnabled\(orgSettings\)/);
  assert.doesNotMatch(qe, /recordChineseQuantityExchange/);
});

test("more menu has no standalone Bérlet visszavétel entry", async () => {
  const fs = await import("node:fs");
  const more = fs.readFileSync("src/routes/_authenticated/more.tsx", "utf8");
  assert.doesNotMatch(more, /to:\s*"\/rental-return"/);
  assert.match(more, /visszavétel a Bérlők/);
});
