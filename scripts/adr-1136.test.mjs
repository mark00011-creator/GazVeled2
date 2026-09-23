import test from "node:test";
import assert from "node:assert/strict";
import {
  ADR_VERIFIED_SEEDS,
  ADR_UNVERIFIED_STARGON_C18,
  calculateAdr1136,
} from "../src/lib/adr/types-and-calc.ts";

function line(partial) {
  return {
    id: partial.id,
    state: partial.state,
    quantity: partial.quantity,
    product: partial.product,
    physical: {
      waterCapacityLitres: partial.waterCapacityLitres ?? null,
      netGasMassKg: partial.netGasMassKg ?? null,
    },
    businessLabel: partial.businessLabel,
  };
}

const O2 = ADR_VERIFIED_SEEDS.OXYGEN_COMPRESSED;
const CO2 = ADR_VERIFIED_SEEDS.CARBON_DIOXIDE;

const PB_TEST = {
  ...ADR_VERIFIED_SEEDS.CARBON_DIOXIDE,
  unNumber: "1965",
  properShippingNameHu: "SZÉNHIDROGÉN-GÁZ KEVERÉK, CSEPPFOLYÓSÍTOTT, M.N.N.",
  hazardLabels: ["2.1"],
  classificationCode: "2F",
  transportCategory: 2,
  multiplier: 3,
  quantityBasis: "net_mass_kg",
  tunnelRestrictionCode: "B/D",
  verified: true,
  verifiedAt: "2026-09-23",
  source: "Teszttermék ADR 1.1.3.6 (ellenőrzött fixture)",
  transportDocumentText:
    "UN 1965 SZÉNHIDROGÉN-GÁZ KEVERÉK, CSEPPFOLYÓSÍTOTT, M.N.N., 2.1, (B/D)",
};

test("1) 3×50L teli oxigén = 150 pont", () => {
  const r = calculateAdr1136([
    line({ id: "1", state: "FULL", quantity: 3, product: O2, waterCapacityLitres: 50 }),
  ]);
  assert.equal(r.totalPoints, 150);
  assert.equal(r.within116Exemption, true);
});

test("2) 3 teli O2 + 3 üres unclean = 150 + ÜRES TARTÁLY, 2", () => {
  const r = calculateAdr1136([
    line({ id: "f", state: "FULL", quantity: 3, product: O2, waterCapacityLitres: 50 }),
    line({ id: "e", state: "EMPTY_UNCLEANED", quantity: 3, product: O2, waterCapacityLitres: 50 }),
  ]);
  assert.equal(r.totalPoints, 150);
  assert.equal(r.emptyUncleanedCount, 3);
  assert.ok(r.emptyTankAggregateText?.includes("ÜRES TARTÁLY, 2"));
  assert.ok(r.lines.some((l) => l.documentLineText === "ÜRES TARTÁLY, 2"));
});

test("3) csak 100 üres unclean = 0 pont + ÜRES TARTÁLY, 2", () => {
  const r = calculateAdr1136([
    line({
      id: "e",
      state: "EMPTY_UNCLEANED",
      quantity: 100,
      product: O2,
      waterCapacityLitres: 50,
      businessLabel: "Oxigén 50 L",
    }),
  ]);
  assert.equal(r.totalPoints, 0);
  assert.equal(r.emptyUncleanedCount, 100);
  assert.match(r.statusLabelHu, /határán belül/);
  assert.ok(!/nem ADR|ADR mentes/i.test(r.statusLabelHu));
});

test("4) CO2 26×37.5=975; 27×37.5=1012.5 túllépés", () => {
  const a = calculateAdr1136([
    line({ id: "a", state: "FULL", quantity: 26, product: CO2, netGasMassKg: 37.5 }),
  ]);
  assert.equal(a.totalPoints, 975);
  assert.equal(a.within116Exemption, true);

  const b = calculateAdr1136([
    line({ id: "b", state: "FULL", quantity: 27, product: CO2, netGasMassKg: 37.5 }),
  ]);
  assert.equal(b.totalPoints, 1012.5);
  assert.equal(b.within116Exemption, false);
  assert.match(b.statusLabelHu, /túllépve/i);
});

test("5) PB ×3: 28×11.5×3=966; 29×11.5×3=1000.5", () => {
  const a = calculateAdr1136([
    line({ id: "a", state: "FULL", quantity: 28, product: PB_TEST, netGasMassKg: 11.5 }),
  ]);
  assert.equal(a.totalPoints, 966);

  const b = calculateAdr1136([
    line({ id: "b", state: "FULL", quantity: 29, product: PB_TEST, netGasMassKg: 11.5 }),
  ]);
  assert.equal(b.totalPoints, 1000.5);
  assert.equal(b.within116Exemption, false);
});

test("6) kevert O2 10×50 + PB 10×11.5×3 = 845", () => {
  const r = calculateAdr1136([
    line({ id: "o", state: "FULL", quantity: 10, product: O2, waterCapacityLitres: 50 }),
    line({ id: "p", state: "FULL", quantity: 10, product: PB_TEST, netGasMassKg: 11.5 }),
  ]);
  assert.equal(r.totalPoints, 845);
  assert.equal(r.pointsByCategory.cat3, 500);
  assert.equal(r.pointsByCategory.cat2, 345);
});

test("7) EMPTY_CLEAN: 0 pont, nem dangerous goods", () => {
  const r = calculateAdr1136([
    line({ id: "c", state: "EMPTY_CLEAN", quantity: 5, product: O2, waterCapacityLitres: 50 }),
  ]);
  assert.equal(r.totalPoints, 0);
  assert.equal(r.lines[0].includedInDangerousGoods, false);
  assert.equal(r.lines[0].documentLineText, null);
});

test("8) PARTIAL = FULL szerinti pont", () => {
  const r = calculateAdr1136([
    line({ id: "p", state: "PARTIAL", quantity: 2, product: O2, waterCapacityLitres: 50 }),
  ]);
  assert.equal(r.totalPoints, 100);
  assert.ok(r.lines[0].documentLineText?.includes("OXIGÉN"));
});

test("9) nem hitelesített master → blocking warning", () => {
  const r = calculateAdr1136([
    line({
      id: "s",
      state: "FULL",
      quantity: 1,
      product: ADR_UNVERIFIED_STARGON_C18,
      waterCapacityLitres: 50,
      businessLabel: "Stargon",
    }),
  ]);
  assert.ok(r.blockingWarnings.some((w) => /nincs hitelesítve/i.test(w)));
});
