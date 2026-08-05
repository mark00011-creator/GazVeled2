import test from "node:test";
import assert from "node:assert/strict";

function salePriceFromProfitFt(purchaseNet, profitFt) {
  return Math.round(purchaseNet + profitFt);
}

function salePriceFromMarginPercent(purchaseNet, marginPercent) {
  return Math.round(purchaseNet * (1 + marginPercent / 100));
}

function profitPerUnit(purchaseNet, saleNet) {
  if (purchaseNet == null || saleNet == null) return null;
  return Math.round(saleNet - purchaseNet);
}

function marginPercent(purchaseNet, saleNet) {
  if (purchaseNet == null || saleNet == null || purchaseNet <= 0) return null;
  return Math.round(((saleNet - purchaseNet) / purchaseNet) * 10000) / 100;
}

function vatAmountFromNet(net, vatRate) {
  return Math.round(net * (vatRate / 100));
}

function grossFromNet(net, vatRate) {
  return net + vatAmountFromNet(net, vatRate);
}

function lineTotals(unitPrice, quantity, vatRate) {
  const net = Math.round(unitPrice * quantity);
  const vat = vatAmountFromNet(net, vatRate);
  return { net, vat, gross: net + vat };
}

test("haszon forintból eladási ár", () => {
  assert.equal(salePriceFromProfitFt(1000, 300), 1300);
});

test("árrés százalékból eladási ár", () => {
  assert.equal(salePriceFromMarginPercent(1000, 30), 1300);
});

test("kézi eladási árból haszon és árrés", () => {
  assert.equal(profitPerUnit(1000, 1500), 500);
  assert.equal(marginPercent(1000, 1500), 50);
});

test("áfa és bruttó számítás", () => {
  const net = 1000;
  assert.equal(vatAmountFromNet(net, 27), 270);
  assert.equal(grossFromNet(net, 27), 1270);
});

test("sor összesítő kerekítés", () => {
  const t = lineTotals(1300, 2, 27);
  assert.equal(t.net, 2600);
  assert.equal(t.vat, 702);
  assert.equal(t.gross, 3302);
});
