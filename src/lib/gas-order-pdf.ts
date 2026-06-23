import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  buildSupplier1GasOrderText,
  type GasOrderGroup,
  type Supplier1QuantityLine,
} from "@/lib/gas-order";

function pdfSafe(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ő/g, "o")
    .replace(/Ő/g, "O")
    .replace(/ű/g, "u")
    .replace(/Ű/g, "U");
}

function wrapLines(text: string, maxLen: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const line = pdfSafe(raw);
    if (line.length <= maxLen) {
      lines.push(line);
      continue;
    }
    let rest = line;
    while (rest.length > maxLen) {
      let cut = rest.lastIndexOf(" ", maxLen);
      if (cut < 20) cut = maxLen;
      lines.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) lines.push(rest);
  }
  return lines;
}

export async function generateSupplier1GasOrderPdf(
  group: GasOrderGroup,
  quantityLines: Supplier1QuantityLine[] = [],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 50;
  const lineH = 14;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const ensureSpace = (needed: number) => {
    if (y - needed < margin) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  };

  const drawLine = (text: string, size = 11, bold = false) => {
    ensureSpace(lineH);
    const f = bold ? fontBold : font;
    page.drawText(pdfSafe(text), { x: margin, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
    y -= lineH;
  };

  const body = buildSupplier1GasOrderText(group, quantityLines);
  for (const line of wrapLines(body, 85)) {
    const safe = pdfSafe(line);
    const bold = safe.startsWith("Kedves");
    drawLine(line, 11, bold);
  }

  return doc.save();
}

/** @deprecated Use generateSupplier1GasOrderPdf */
export async function generateGasOrderPdf(group: GasOrderGroup): Promise<Uint8Array> {
  return generateSupplier1GasOrderPdf(group, []);
}

export function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes.slice()], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
