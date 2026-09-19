import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const mig = fs.readFileSync(
  path.join(root, "supabase/migrations/20260918160000_org_rls_isolation_lockdown.sql"),
  "utf8",
);

test("org isolation migration locks RLS and adds write trigger", () => {
  assert.match(mig, /enforce_organization_isolation/);
  assert.match(mig, /trg_enforce_org_isolation/);
  assert.match(mig, /same_org\(organization_id\)/);
  assert.match(mig, /product_prices select org/);
  assert.match(mig, /chinese_stock select org/);
  assert.match(mig, /rentals select org/);
  assert.doesNotMatch(mig, /read authenticated/);
  assert.match(mig, /snmiwsgtnokvqlnwvfwf/);
});

test("platform UI documents empty-tenant start", () => {
  const src = fs.readFileSync(
    path.join(root, "src/routes/_authenticated/platform-organizations.tsx"),
    "utf8",
  );
  assert.match(src, /üres adattal/);
});
