import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const migPath = path.join(
  root,
  "supabase/migrations/20260922140000_security_privilege_lockdown.sql",
);
const mig = fs.readFileSync(migPath, "utf8");

test("SEC-001 migration locks is_platform_admin and org/role self-escalation", () => {
  assert.match(mig, /enforce_profiles_privilege_columns/);
  assert.match(mig, /trg_profiles_privilege_lock/);
  assert.match(mig, /is_platform_admin módosítása tiltott/);
  assert.match(mig, /Saját organization_id közvetlen módosítása tiltott/);
  assert.match(mig, /Saját role közvetlen módosítása tiltott/);
  assert.match(mig, /is_platform_admin = \(SELECT p\.is_platform_admin/);
  assert.match(mig, /organization_id IS NOT DISTINCT FROM/);
  assert.match(mig, /snmiwsgtnokvqlnwvfwf/);
});

test("SEC-002 critical DEFINER RPCs are org-scoped in migration", () => {
  assert.match(mig, /mark_exchange_batch_invoiced[\s\S]*organization_id = v_org/);
  assert.match(mig, /receive_gas_order[\s\S]*require_write\(\)/);
  assert.match(mig, /return_cylinder_loan[\s\S]*require_exchange_access\(\)/);
  assert.match(mig, /try_delete_orphan_temp_cylinder[\s\S]*assert_cylinder_in_org/);
  assert.match(mig, /finalize_invoice_document_exchanges/);
  assert.match(mig, /app\.allow_profile_privilege_change/);
});

test("create_organization signature matches production param order", () => {
  assert.match(
    mig,
    /create_organization\(\s*p_name text,\s*p_slug text,\s*p_admin_email text DEFAULT NULL,\s*p_logo_url text DEFAULT NULL/s,
  );
});

test("szamlazz finalize uses org-scoped RPC when present", () => {
  const fnPath = path.join(root, "src/lib/api/szamlazz.functions.ts");
  if (!fs.existsSync(fnPath)) {
    return; // feature not in tree yet
  }
  const src = fs.readFileSync(fnPath, "utf8");
  assert.match(src, /finalize_invoice_document_exchanges/);
  assert.match(src, /requireSupabaseAuth/);
  assert.match(src, /buildSzamlazzXmlPreview[\s\S]*middleware\(\[requireSupabaseAuth\]/s);
});
