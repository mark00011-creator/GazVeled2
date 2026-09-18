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
  assert.match(assignSql, /assign_organization_member/);
});
