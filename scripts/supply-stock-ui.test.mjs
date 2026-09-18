import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

test("tool-rental stock route exists", () => {
  assert.ok(
    fs.existsSync(path.join(root, "src/routes/_authenticated/tool-rental/stock.tsx")),
  );
});

test("roles guards tool-rental admin path", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/roles.ts"), "utf8");
  assert.match(src, /\/tool-rental/);
});

test("more menu links supply stock", () => {
  const src = fs.readFileSync(path.join(root, "src/routes/_authenticated/more.tsx"), "utf8");
  assert.match(src, /\/tool-rental\/stock/);
  assert.match(src, /Eszközök és fogyóanyagok/);
  const adminBlock = src.slice(src.indexOf("const adminItems"), src.indexOf("const items:"));
  const itemsBlock = src.slice(src.indexOf("const items:"), src.indexOf("function MoreLink"));
  assert.equal(adminBlock.includes("/tool-rental/stock"), false);
  assert.ok(itemsBlock.includes("/tool-rental/stock"));
  assert.ok(
    itemsBlock.indexOf("/tool-rental/stock") < itemsBlock.indexOf("/gas-order"),
    "tool-rental first in Műveletek",
  );
});

test("stock page admin guard", () => {
  const src = fs.readFileSync(
    path.join(root, "src/routes/_authenticated/tool-rental/stock.tsx"),
    "utf8",
  );
  assert.match(src, /isAdminRole/);
  assert.match(src, /isModuleEnabled/);
  assert.match(src, /tool_rental/);
  assert.match(src, /if \(loading\)/);
  assert.match(src, /Gyors értékesítés/);
  assert.match(src, /Új tétel/);
  assert.match(src, /Szerkesztés/);
  assert.match(src, /createSupplyProduct/);
  assert.match(src, /updateSupplyProduct/);
  assert.match(src, /recordSupplySaleBatch/);
  assert.match(src, /updateSupplyProductPrices/);
  assert.match(src, /receiveSupplyStock/);
  assert.match(src, /priceFieldLabel/);
});

test("supply lib uses batch sale RPC", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/supply-stock.ts"), "utf8");
  assert.match(src, /record_supply_sale_batch/);
  assert.match(src, /create_supply_product/);
  assert.match(src, /update_supply_product/);
  assert.match(src, /suggestSupplyNaturalKey/);
});

test("snapshot migration adds sale item columns", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260805130000_supply_sale_snapshots.sql"),
    "utf8",
  );
  assert.match(sql, /product_name/);
  assert.match(sql, /purchase_unit_price/);
  assert.match(sql, /line_profit/);
});

test("batch RPC migration uses FOR UPDATE and idempotency", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20260805130100_supply_sale_batch_rpc.sql"),
    "utf8",
  );
  assert.match(sql, /record_supply_sale_batch/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /idempotency_key/);
  assert.match(sql, /Nincs elegendő készlet/);
  assert.match(sql, /product_name/);
});

test("pricing helper aligned with product_prices arres model", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/supply-pricing.ts"), "utf8");
  assert.match(src, /salePriceFromProfitFt/);
  assert.match(src, /salePriceFromMarginPercent/);
});
