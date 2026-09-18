import test from "node:test";
import assert from "node:assert/strict";

function getTaxSettings(settings) {
  return (
    settings?.tax ?? {
      regime: "vat_exempt",
      default_rate: 27,
      price_entry: "net",
    }
  );
}

function isVatRegistered(settings) {
  return getTaxSettings(settings).regime === "vat_registered";
}

function effectiveVatRate(settings, productVatRate) {
  if (!isVatRegistered(settings)) return 0;
  if (productVatRate != null && Number.isFinite(productVatRate)) return productVatRate;
  return getTaxSettings(settings).default_rate;
}

function grossFromNet(net, vatRate) {
  return net + Math.round(net * (vatRate / 100));
}

test("alanyi adómentes → ÁFA 0", () => {
  assert.equal(effectiveVatRate({ tax: { regime: "vat_exempt", default_rate: 27 } }, 27), 0);
  assert.equal(effectiveVatRate(null, 27), 0);
});

test("áfakörös → termék vagy alap kulcs", () => {
  const s = { tax: { regime: "vat_registered", default_rate: 27, price_entry: "net" } };
  assert.equal(effectiveVatRate(s, null), 27);
  assert.equal(effectiveVatRate(s, 5), 5);
});

test("bruttó megjelenítés adómentesnél = nettó", () => {
  const exempt = { tax: { regime: "vat_exempt", default_rate: 27 } };
  const registered = { tax: { regime: "vat_registered", default_rate: 27 } };
  const net = 1000;
  assert.equal(isVatRegistered(exempt) ? grossFromNet(net, 27) : net, 1000);
  assert.equal(grossFromNet(net, effectiveVatRate(registered, 27)), 1270);
});
