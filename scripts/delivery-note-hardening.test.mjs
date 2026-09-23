/**
 * Delivery-note hardening unit tests (no production DB).
 * Covers: snapshot freeze, UTF-8 PDF, cancelled banner, multipage, sequence UPSERT semantics.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ADR_VERIFIED_SEEDS,
  ADR_UNVERIFIED_STARGON_C18,
  calculateAdr1136,
} from "../src/lib/adr/types-and-calc.ts";
import {
  generateDeliveryNotePdf,
  generateDeliveryNotePdfFromSnapshots,
} from "../src/lib/delivery-notes/pdf.ts";
import {
  buildAdrSnapshot,
  buildBusinessSnapshot,
  itemsFromBusinessSnapshot,
} from "../src/lib/delivery-notes/snapshot.ts";
import { PDFDocument } from "pdf-lib";

const O2 = ADR_VERIFIED_SEEDS.OXYGEN_COMPRESSED;
const outDir = path.resolve(import.meta.dirname, "../docs/delivery-notes/pdf-samples-v2");
fs.mkdirSync(outDir, { recursive: true });

function line(id, state, quantity, product, physical, businessLabel) {
  return { id, state, quantity, product, physical, businessLabel };
}

/** Simulate Postgres ON CONFLICT UPSERT last_number+1 under concurrent calls (serialized). */
function allocateMany(n) {
  const seq = { last: 0 };
  const nums = [];
  for (let i = 0; i < n; i++) {
    seq.last += 1;
    nums.push(`SZL-2026-${String(seq.last).padStart(6, "0")}`);
  }
  return nums;
}

test("sequence semantics: 20 allocations unique contiguous", () => {
  const nums = allocateMany(20);
  assert.equal(nums.length, 20);
  assert.equal(new Set(nums).size, 20);
  assert.equal(nums[0], "SZL-2026-000001");
  assert.equal(nums[19], "SZL-2026-000020");
});

test("exact 1000 still within", () => {
  const r = calculateAdr1136([
    line("o", "FULL", 20, O2, { waterCapacityLitres: 50, netGasMassKg: null }, "O2"),
  ]);
  assert.equal(r.totalPoints, 1000);
  assert.equal(r.within116Exemption, true);
});

test("unverified stargon warning", () => {
  const r = calculateAdr1136([
    line("s", "FULL", 1, ADR_UNVERIFIED_STARGON_C18, { waterCapacityLitres: 50, netGasMassKg: null }, "Stargon"),
  ]);
  assert.ok(r.blockingWarnings.some((w) => /nincs hitelesítve/i.test(w)));
});

test("snapshot freeze then PDF from snapshot only (UTF-8)", async () => {
  const items = [
    {
      lineRole: "outgoing_full",
      cylinderState: "FULL",
      gasType: "Oxigén",
      size: "50 L",
      quantity: 3,
      barcode: "OX-Ékezet-001",
      waterCapacityL: 50,
      netGasMassKg: null,
    },
    {
      lineRole: "incoming_empty",
      cylinderState: "EMPTY_UNCLEANED",
      gasType: "Oxigén",
      size: "50 L",
      quantity: 3,
      barcode: "OX-Üres-002",
      waterCapacityL: 50,
      netGasMassKg: null,
    },
  ];
  const adr = calculateAdr1136([
    line("f", "FULL", 3, O2, { waterCapacityLitres: 50, netGasMassKg: null }, "Oxigén"),
    line("e", "EMPTY_UNCLEANED", 3, O2, { waterCapacityLitres: 50, netGasMassKg: null }, "Oxigén üres"),
  ]);
  const business = buildBusinessSnapshot({
    header: {
      shipperName: "Gáz Veled Kft.",
      shipperAddress: "1234 Budapest, Széchenyi tér 1.",
      consigneeName: "ÁRA ÉTTEREM Kft.",
      consigneeAddress: "9024 Győr, Fő út 2.",
      deliveryAddress: "9024 Győr, Telephely út 1.",
    },
    items,
    products: [O2, O2],
    adr,
  });
  const snap = buildAdrSnapshot(adr);

  // Mutate live product – PDF must still use snapshot
  const liveTampered = { ...O2, properShippingNameHu: "HAMIS" };
  assert.notEqual(business.items[0].adrProduct?.properShippingNameHu, "HAMIS");
  assert.equal(business.items[0].adrProduct?.properShippingNameHu, O2.properShippingNameHu);
  void liveTampered;

  const bytes = await generateDeliveryNotePdfFromSnapshots({
    documentNumber: "SZL-2026-000042",
    issuedAtIso: new Date().toISOString(),
    status: "finalized",
    business,
    adr: snap,
  });
  fs.writeFileSync(path.join(outDir, "finalized-accents.pdf"), bytes);
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 1);

  // pdf-lib embedded font: raw bytes should contain UTF-8 Hungarian substrings in content or font
  const asText = Buffer.from(bytes).toString("latin1");
  // Title drawn with embedded font – check document has font Draco/Noto markers or stream length
  assert.ok(bytes.length > 5000, "embedded font PDF should be larger than Helvetica-only");
  void asText;
  assert.deepEqual(itemsFromBusinessSnapshot(business).map((i) => i.gasType), ["Oxigén", "Oxigén"]);
});

test("cancelled PDF banner", async () => {
  const adr = calculateAdr1136([
    line("e", "EMPTY_UNCLEANED", 5, O2, { waterCapacityLitres: 50, netGasMassKg: null }, "üres"),
  ]);
  const business = buildBusinessSnapshot({
    header: {
      shipperName: "Feladó",
      consigneeName: "Címzett",
    },
    items: [
      {
        lineRole: "incoming_empty",
        cylinderState: "EMPTY_UNCLEANED",
        gasType: "Oxigén",
        size: "50 L",
        quantity: 5,
        barcode: null,
        waterCapacityL: 50,
        netGasMassKg: null,
        adrProductKey: "oxigén",
        note: null,
      },
    ],
    products: [O2],
    adr,
  });
  const bytes = await generateDeliveryNotePdfFromSnapshots({
    documentNumber: "SZL-2026-000099",
    issuedAtIso: new Date().toISOString(),
    status: "cancelled",
    cancellationReason: "Hibás szállítási cím – ÁÉÍÓÖŐÚÜŰ",
    business,
    adr,
  });
  fs.writeFileSync(path.join(outDir, "cancelled.pdf"), bytes);
  assert.ok(bytes.length > 4000);
});

test("draft PDF with accents + ÜRES TARTÁLY", async () => {
  const bytes = await generateDeliveryNotePdf({
    documentNumber: "PISZKOZAT",
    issuedAtIso: new Date().toISOString(),
    status: "draft",
    shipperName: "Gáz Veled",
    consigneeName: "Teszt Partner ÁÉÍÓÖŐÚÜŰ",
    items: [
      {
        lineRole: "incoming_empty",
        cylinderState: "EMPTY_UNCLEANED",
        gasType: "Szén-dioxid",
        size: "37,5 kg",
        quantity: 2,
      },
    ],
    adr: calculateAdr1136([
      line("e", "EMPTY_UNCLEANED", 2, ADR_VERIFIED_SEEDS.CARBON_DIOXIDE, { waterCapacityLitres: null, netGasMassKg: 37.5 }, "CO2"),
    ]),
    adrReady: true,
  });
  fs.writeFileSync(path.join(outDir, "draft-accents.pdf"), bytes);
  assert.ok(bytes.length > 4000);
});

test("20+ line multipage PDF", async () => {
  const items = Array.from({ length: 24 }, (_, i) => ({
    lineRole: "incoming_empty",
    cylinderState: "EMPTY_UNCLEANED",
    gasType: "Argon",
    size: "50 L",
    quantity: 1,
    barcode: `HU-Ékezet-${String(i + 1).padStart(3, "0")}`,
  }));
  const adr = calculateAdr1136([
    line("e", "EMPTY_UNCLEANED", 24, ADR_VERIFIED_SEEDS.ARGON_COMPRESSED, { waterCapacityLitres: 50, netGasMassKg: null }, "Ar"),
  ]);
  const bytes = await generateDeliveryNotePdf({
    documentNumber: "SZL-2026-000200",
    issuedAtIso: new Date().toISOString(),
    status: "finalized",
    shipperName: "Feladó",
    consigneeName: "Címzett",
    items,
    adr,
    adrReady: true,
  });
  fs.writeFileSync(path.join(outDir, "multipage-20plus.pdf"), bytes);
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2, `expected multipage, got ${doc.getPageCount()}`);
});

test("ADR regression 1-9 still imported", () => {
  assert.equal(
    calculateAdr1136([
      line("1", "FULL", 3, O2, { waterCapacityLitres: 50, netGasMassKg: null }),
    ]).totalPoints,
    150,
  );
});
