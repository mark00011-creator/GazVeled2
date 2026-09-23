import { ADR_VERIFIED_SEEDS, calculateAdr1136 } from "../src/lib/adr/types-and-calc.ts";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";

const O2 = ADR_VERIFIED_SEEDS.OXYGEN_COMPRESSED;
const PB = {
  ...ADR_VERIFIED_SEEDS.CARBON_DIOXIDE,
  transportCategory: 2,
  multiplier: 3,
  quantityBasis: "net_mass_kg",
  hazardLabels: ["2.1"],
  verified: true,
};
const L = (state, q, product, physical) => ({
  id: "x",
  state,
  quantity: q,
  product,
  physical,
});

const floatCases = {
  "999.999": calculateAdr1136([
    L("FULL", 1, O2, { waterCapacityLitres: 999.999, netGasMassKg: null }),
  ]),
  "1000_exact": calculateAdr1136([
    L("FULL", 20, O2, { waterCapacityLitres: 50, netGasMassKg: null }),
  ]),
  "1000.001": calculateAdr1136([
    L("FULL", 1, O2, { waterCapacityLitres: 1000.001, netGasMassKg: null }),
  ]),
  "29x11.5x3": calculateAdr1136([
    L("FULL", 29, PB, { waterCapacityLitres: null, netGasMassKg: 11.5 }),
  ]),
};

const pdfMeta = [];
for (const dir of [
  "docs/delivery-notes/pdf-samples-v2",
  "docs/delivery-notes/pdf-samples",
]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".pdf"))) {
    const bytes = fs.readFileSync(`${dir}/${f}`);
    const doc = await PDFDocument.load(bytes);
    const latin = Buffer.from(bytes).toString("latin1");
    pdfMeta.push({
      file: `${dir}/${f}`,
      pages: doc.getPageCount(),
      bytes: bytes.length,
      notoHint: latin.includes("Noto"),
    });
  }
}

console.log(
  JSON.stringify(
    {
      floatCases: Object.fromEntries(
        Object.entries(floatCases).map(([k, r]) => [
          k,
          { total: r.totalPoints, within: r.within116Exemption },
        ]),
      ),
      pdfMeta,
      fonts: {
        regular: fs.existsSync("public/fonts/NotoSans-Regular.ttf"),
        bold: fs.existsSync("public/fonts/NotoSans-Bold.ttf"),
        regularBytes: fs.statSync("public/fonts/NotoSans-Regular.ttf").size,
      },
    },
    null,
    2,
  ),
);
