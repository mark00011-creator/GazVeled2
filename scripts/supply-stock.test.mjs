import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const tablesSql = fs.readFileSync(
  path.join(root, "supabase/migrations/20260805120000_supply_products_tables.sql"),
  "utf8",
);
const indexesSql = fs.readFileSync(
  path.join(root, "supabase/migrations/20260805120100_supply_products_indexes.sql"),
  "utf8",
);
const rlsSql = fs.readFileSync(
  path.join(root, "supabase/migrations/20260805120200_supply_products_rls.sql"),
  "utf8",
);
const rpcSql = fs.readFileSync(
  path.join(root, "supabase/migrations/20260805120300_supply_products_rpc.sql"),
  "utf8",
);
const seedSql = fs.readFileSync(
  path.join(root, "supabase/migrations/20260805120400_supply_products_seed.sql"),
  "utf8",
);
const invariantsSql = fs.readFileSync(path.join(root, "sql/check_business_invariants.sql"), "utf8");

test("supply tables migration defines core schema", () => {
  assert.match(tablesSql, /CREATE TABLE IF NOT EXISTS public\.supply_products/);
  assert.match(tablesSql, /CREATE TABLE IF NOT EXISTS public\.supply_stock_movements/);
  assert.match(tablesSql, /CREATE TABLE IF NOT EXISTS public\.supply_sales/);
  assert.match(tablesSql, /CREATE TABLE IF NOT EXISTS public\.supply_sale_items/);
  assert.match(tablesSql, /CREATE TABLE IF NOT EXISTS public\.supply_billing_queue/);
  assert.match(tablesSql, /stock_kind IN \('unit', 'quantity'\)/);
  assert.match(tablesSql, /sale_price IS NULL OR sale_price > 0/);
  assert.match(tablesSql, /guard_supply_product_stock_update/);
});

test("supply seed is idempotent with natural keys and null prices", () => {
  assert.match(seedSql, /supply:mixgas-regulator/);
  assert.match(seedSql, /supply:welding-wire-1.0-15kg/);
  assert.match(seedSql, /supply:welding-wire-0.8-15kg/);
  assert.match(seedSql, /ON CONFLICT \(natural_key\) DO NOTHING/);
  assert.match(seedSql, /NOT EXISTS \(\s*SELECT 1 FROM public\.supply_stock_movements/);
  assert.doesNotMatch(seedSql, /sale_price.*[1-9]/);
});

test("supply RLS restricts to admin select only", () => {
  assert.match(rlsSql, /is_admin\(\)/);
  assert.match(rlsSql, /REVOKE ALL ON public\.supply_products/);
  assert.match(rlsSql, /GRANT SELECT ON public\.supply_products TO authenticated/);
  assert.doesNotMatch(rlsSql, /INSERT ON public\.supply_products TO authenticated/);
});

test("supply RPC migration defines required functions", () => {
  for (const fn of [
    "receive_supply_stock",
    "record_supply_sale",
    "adjust_supply_stock",
    "update_supply_product_prices",
    "create_supply_product",
    "deactivate_supply_product",
  ]) {
    assert.match(rpcSql, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`));
  }
  assert.match(rpcSql, /require_admin\(\)/);
  assert.match(rpcSql, /REVOKE ALL ON FUNCTION public\.record_supply_sale/);
  assert.match(rpcSql, /Az értékesítéshez eladási ár beállítása szükséges/);
  assert.match(rpcSql, /idempotency_key IS NOT NULL THEN/);
  assert.match(rpcSql, /try_insert_supply_event/);
  assert.doesNotMatch(rpcSql, /GRANT EXECUTE ON FUNCTION public\.apply_supply_stock_delta/);
});

test("supply indexes migration covers lookup paths", () => {
  assert.match(indexesSql, /idx_supply_products_natural_key/);
  assert.match(indexesSql, /idx_supply_movements_product_created/);
  assert.match(indexesSql, /idx_supply_billing_queue_status/);
});

test("business invariants includes supply section", () => {
  assert.match(invariantsSql, /SZAKASZ 11: ESZKÖZ- ÉS FOGYÓANYAG-KÉSZLET/);
  assert.match(invariantsSql, /fail_11 AS/);
  assert.match(invariantsSql, /Eszköz- és fogyóanyag-készlet/);
});

test("chinese cylinder stock tables unchanged in supply migrations", () => {
  const combined = tablesSql + indexesSql + rlsSql + rpcSql + seedSql;
  assert.doesNotMatch(combined, /\b(?:ALTER|DROP|CREATE)\s+TABLE\s+public\.chinese_cylinder_stock\b/i);
  assert.doesNotMatch(combined, /\b(?:ALTER|DROP|CREATE)\s+TABLE\s+public\.product_prices\b/i);
  assert.doesNotMatch(combined, /\badjust_chinese_stock\b/);
});

test("supply sale rules encoded in RPC", () => {
  assert.match(rpcSql, /FOR UPDATE/);
  assert.match(rpcSql, /Nincs elegendő készlet/);
  assert.match(rpcSql, /supply_billing_queue/);
  assert.match(rpcSql, /round\(v_line_net \* v_product\.vat_rate/);
});
