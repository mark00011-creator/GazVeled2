/**
 * PDF audit harness – generates sample delivery-note PDFs to docs/delivery-notes/pdf-samples/
 * Does NOT touch production. Read-only generation from ADR engine + PDF lib.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ADR_VERIFIED_SEEDS,
  calculateAdr1136,
} from "../src/lib/adr/types-and-calc.ts";
import { generateDeliveryNotePdf } from "../src/lib/delivery-notes/pdf.ts";

const outDir = path.resolve(import.meta.dirname, "../docs/delivery-notes/pdf-samples");
fs.mkdirSync(outDir, { recursive: true });

const O2 = ADR_VERIFIED_SEEDS.OXYGEN_COMPRESSED;
const PB = {
  ...ADR_VERIFIED_SEEDS.CARBON_DIOXIDE,
  unNumber: "1965",
  properShippingNameHu: "SZÉNHIDROGÉN-GÁZ KEVERÉK, CSEPPFOLYÓSÍTOTT, M.N.N.",
  hazardLabels: ["2.1"],
  transportCategory: 2,
  multiplier: 3,
  quantityBasis: "net_mass_kg",
  tunnelRestrictionCode: "B/D",
  verified: true,
  transportDocumentText:
    "UN 1965 SZÉNHIDROGÉN-GÁZ KEVERÉK, CSEPPFOLYÓSÍTOTT, M.N.N., 2.1, (B/D)",
};

function line(id, state, quantity, product, physical, businessLabel) {
  return { id, state, quantity, product, physical, businessLabel };
}

async function writeCase(name, items, itemInputs) {
  const adr = calculateAdr1136(items);
  const bytes = await generateDeliveryNotePdf({
    documentNumber: `SZL-2026-AUDIT-${name}`,
    issuedAtIso: new Date().toISOString(),
    shipperName: "Gáz Veled Kft. – Teszt Feladó Ékezetekkel: ÁÉÍÓÖŐÚÜŰ",
    shipperAddress: "1234 Budapest, Hosszú Teszt Utca 12. fszt. 3.",
    consigneeName: "ARA ÉTTEREM Korlátolt Felelősségű Társaság",
    consigneeAddress: "9024 Győr, Hosszú Címzett Utca 99.",
    deliveryAddress: "9024 Győr, Telephely út 1.",
    vehiclePlate: "ABC-123",
    driverName: "Teszt Sofőr",
    items: itemInputs,
    adr,
    adrReady: adr.blockingWarnings.length === 0,
  });
  const file = path.join(outDir, `${name}.pdf`);
  fs.writeFileSync(file, bytes);
  const doc = await (await import("pdf-lib")).PDFDocument.load(bytes);
  return {
    name,
    file,
    pages: doc.getPageCount(),
    bytes: bytes.length,
    totalPoints: adr.totalPoints,
    within: adr.within116Exemption,
    emptyText: adr.emptyTankAggregateText,
    status: adr.statusLabelHu,
    warnings: adr.blockingWarnings,
  };
}

const results = [];

// A) 3 full O2 + 3 empty O2
results.push(
  await writeCase(
    "A-3full-3empty-O2",
    [
      line("f", "FULL", 3, O2, { waterCapacityLitres: 50, netGasMassKg: null }, "Oxigén 50 L"),
      line("e", "EMPTY_UNCLEANED", 3, O2, { waterCapacityLitres: 50, netGasMassKg: null }, "Oxigén 50 L üres"),
    ],
    [
      { lineRole: "outgoing_full", cylinderState: "FULL", gasType: "Oxigén", size: "50 L", quantity: 3, barcode: "O2-FULL-1" },
      { lineRole: "incoming_empty", cylinderState: "EMPTY_UNCLEANED", gasType: "Oxigén", size: "50 L", quantity: 3, barcode: "O2-EMPTY-1" },
    ],
  ),
);

// B) only empty
results.push(
  await writeCase(
    "B-only-empty",
    [
      line("e", "EMPTY_UNCLEANED", 12, O2, { waterCapacityLitres: 50, netGasMassKg: null }, "Oxigén üres"),
    ],
    [
      { lineRole: "incoming_empty", cylinderState: "EMPTY_UNCLEANED", gasType: "Oxigén", size: "50 L", quantity: 12, barcode: "E1" },
    ],
  ),
);

// C) mixed O2 + PB
results.push(
  await writeCase(
    "C-mixed-O2-PB",
    [
      line("o", "FULL", 10, O2, { waterCapacityLitres: 50, netGasMassKg: null }, "Oxigén"),
      line("p", "FULL", 10, PB, { waterCapacityLitres: null, netGasMassKg: 11.5 }, "PB 11,5"),
    ],
    [
      { lineRole: "outgoing_full", cylinderState: "FULL", gasType: "Oxigén", size: "50 L", quantity: 10 },
      { lineRole: "outgoing_full", cylinderState: "FULL", gasType: "Propán-Bután", size: "11,5 kg", quantity: 10, netGasMassKg: 11.5 },
    ],
  ),
);

// D) under 1000 (845)
results.push(
  await writeCase(
    "D-under-1000",
    [
      line("o", "FULL", 10, O2, { waterCapacityLitres: 50, netGasMassKg: null }, "Oxigén"),
      line("p", "FULL", 10, PB, { waterCapacityLitres: null, netGasMassKg: 11.5 }, "PB"),
    ],
    [
      { lineRole: "outgoing_full", cylinderState: "FULL", gasType: "Oxigén", size: "50 L", quantity: 10 },
      { lineRole: "outgoing_full", cylinderState: "FULL", gasType: "PB", size: "11,5 kg", quantity: 10, netGasMassKg: 11.5 },
    ],
  ),
);

// E) over 1000
results.push(
  await writeCase(
    "E-over-1000",
    [
      line("o", "FULL", 27, O2, { waterCapacityLitres: 50, netGasMassKg: null }, "Oxigén"),
    ],
    [
      { lineRole: "outgoing_full", cylinderState: "FULL", gasType: "Oxigén", size: "50 L", quantity: 27, barcode: "MANY" },
    ],
  ),
);

// F) multipage stress – many barcodes
const manyItems = Array.from({ length: 40 }, (_, i) => ({
  lineRole: "incoming_empty",
  cylinderState: "EMPTY_UNCLEANED",
  gasType: "Argon",
  size: "50 L",
  quantity: 1,
  barcode: `HU-LONG-BARCODE-${String(i + 1).padStart(4, "0")}-Ékezet`,
}));
results.push(
  await writeCase(
    "F-multipage-empty",
    [line("e", "EMPTY_UNCLEANED", 40, O2, { waterCapacityLitres: 50, netGasMassKg: null }, "üres")],
    manyItems,
  ),
);

// Exact 1000 boundary
const exact = calculateAdr1136([
  line("p", "FULL", 2000 / 3 / 11.5, PB, { waterCapacityLitres: null, netGasMassKg: 11.5 }, "PB?"),
]);
// Better: 20 * 50 = 1000 O2
const exact1000 = calculateAdr1136([
  line("o", "FULL", 20, O2, { waterCapacityLitres: 50, netGasMassKg: null }, "Oxigén"),
]);

console.log(JSON.stringify({ results, exact1000: { total: exact1000.totalPoints, within: exact1000.within116Exemption, status: exact1000.statusLabelHu }, junk: exact.totalPoints }, null, 2));
