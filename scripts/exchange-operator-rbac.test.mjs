import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("roles module defines admin and exchange_operator", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/roles.ts"), "utf8");
  assert.match(src, /exchange_operator/);
  assert.match(src, /ADMIN_ROUTE_PREFIXES/);
  assert.match(src, /defaultHomeForRole/);
  assert.match(src, /\/quick-exchange/);
});

test("authenticated route guards operator from admin paths", () => {
  const src = fs.readFileSync(path.join(root, "src/routes/_authenticated/route.tsx"), "utf8");
  assert.match(src, /isAdminOnlyPath/);
  assert.match(src, /exchange_operator/);
  assert.match(src, /\/quick-exchange/);
  assert.match(src, /canAccessApp/);
});

test("migration defines RBAC functions and RLS", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260724120000_exchange_operator_rbac.sql"),
    "utf8",
  );
  assert.match(sql, /is_exchange_operator/);
  assert.match(sql, /require_exchange_access/);
  assert.match(sql, /exchange_operator/);
  assert.match(sql, /profiles_role_check/);
});

test("RPC guards migration patches exchange RPCs", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260724120001_exchange_operator_rpc_guards.sql"),
    "utf8",
  );
  assert.match(sql, /require_exchange_access/);
  assert.match(sql, /record_chinese_brought_exchange/);
  assert.match(sql, /adjust_chinese_stock/);
  assert.match(sql, /find_or_create_cylinder/);
});

test("users admin page manages roles", () => {
  const src = fs.readFileSync(path.join(root, "src/routes/_authenticated/users.tsx"), "utf8");
  assert.match(src, /exchange_operator/);
  assert.match(src, /is_active/);
});
