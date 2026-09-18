import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("organizations migration seeds GazVeled and helpers", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260918093000_organizations.sql"),
    "utf8",
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.organizations/);
  assert.match(sql, /a0000000-0000-4000-8000-000000000001/);
  assert.match(sql, /auth_organization_id/);
  assert.match(sql, /same_org/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS organization_id/);
  assert.match(sql, /warehouse_bins/);
});

test("organization settings helpers and UI wiring", () => {
  const orgLib = fs.readFileSync(path.join(root, "src/lib/organization.ts"), "utf8");
  const auth = fs.readFileSync(path.join(root, "src/lib/auth.ts"), "utf8");
  const more = fs.readFileSync(path.join(root, "src/routes/_authenticated/more.tsx"), "utf8");
  const settings = fs.readFileSync(
    path.join(root, "src/routes/_authenticated/organization-settings.tsx"),
    "utf8",
  );
  const assignSql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260918110000_assign_organization_member.sql"),
    "utf8",
  );
  assert.match(orgLib, /isModuleEnabled/);
  assert.match(orgLib, /parseOrganizationSettings/);
  assert.match(auth, /organization_id/);
  assert.match(auth, /fetchOrganization/);
  assert.match(auth, /denialReason/);
  assert.match(more, /organization-settings/);
  assert.match(more, /isModuleEnabled/);
  assert.match(settings, /Cég beállítások/);
  assert.match(settings, /warehouse_bins/);
  assert.match(settings, /ÁFA \/ adózás/);
  assert.match(settings, /vat_exempt/);
  assert.match(settings, /vat_registered/);
  assert.match(orgLib, /OrganizationTaxSettings/);
  assert.match(orgLib, /tax:/);
  assert.match(assignSql, /assign_organization_member/);
});

test("org tax helpers and UI wiring", () => {
  const orgTax = fs.readFileSync(path.join(root, "src/lib/org-tax.ts"), "utf8");
  const priceList = fs.readFileSync(
    path.join(root, "src/routes/_authenticated/price-list.tsx"),
    "utf8",
  );
  const stock = fs.readFileSync(
    path.join(root, "src/routes/_authenticated/tool-rental/stock.tsx"),
    "utf8",
  );
  const taxSql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260918130000_organization_tax_settings.sql"),
    "utf8",
  );
  assert.match(orgTax, /effectiveVatRate/);
  assert.match(orgTax, /priceBasisHint/);
  assert.match(orgTax, /priceFieldLabel/);
  assert.match(orgTax, /displayGrossFromNet/);
  assert.match(orgTax, /bruttó egységárak/);
  assert.match(priceList, /priceBasisHint/);
  assert.match(stock, /effectiveVatRate/);
  assert.match(stock, /priceBasisHint/);
  assert.match(stock, /Új tétel/);
  assert.match(taxSql, /vat_exempt/);
  assert.match(taxSql, /settings.*tax|\{tax\}/);
  const saleVatSql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260918131500_supply_sale_org_vat.sql"),
    "utf8",
  );
  assert.match(saleVatSql, /org_effective_vat_rate/);
  assert.match(saleVatSql, /record_supply_sale_batch/);
  const updateSql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260918140000_update_supply_product.sql"),
    "utf8",
  );
  assert.match(updateSql, /update_supply_product/);
  assert.match(updateSql, /org_effective_vat_rate/);
});
