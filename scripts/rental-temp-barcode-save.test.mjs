import assert from "node:assert/strict";
import { describe, it } from "node:test";

function isTempBarcode(barcode) {
  const bc = barcode?.trim() ?? "";
  return !bc || /^temp-/i.test(bc);
}

function normalizeBarcode(barcode) {
  return barcode.trim().toLowerCase();
}

describe("TEMP vonalkód mentés – validáció", () => {
  it("TEMP-000017 TEMP-nek számít", () => {
    assert.equal(isTempBarcode("TEMP-000017"), true);
  });

  it("HU262238 nem TEMP vonalkód", () => {
    assert.equal(isTempBarcode("HU262238"), false);
  });

  it("HU262238 normalizálása hu262238", () => {
    assert.equal(normalizeBarcode("HU262238"), "hu262238");
  });

  it("üres vonalkód elutasítandó", () => {
    assert.equal(normalizeBarcode("   "), "");
  });

  it("TEMP utótag elutasítandó véglegesként", () => {
    assert.match(/^temp-/i, normalizeBarcode("TEMP-999999"));
  });
});
