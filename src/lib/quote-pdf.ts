import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatHuf } from "@/lib/gas-order-prices";
import { quoteItemLabel, quoteTotal, type QuoteItemRow, type QuoteRow } from "@/lib/quotes";

function pdfSafe(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ő/g, "o")
    .replace(/Ő/g, "O")
    .replace(/ű/g, "u")
    .replace(/Ű/g, "U");
}

export async function generateQuotePdf(
  quote: QuoteRow,
  items: QuoteItemRow[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 50;
  const lineH = 16;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const ensureSpace = (needed: number) => {
    if (y - needed < margin) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  };

  const drawLine = (text: string, size = 11, bold = false, x = margin) => {
    ensureSpace(lineH);
    page.drawText(pdfSafe(text), {
      x,
      y,
      size,
      font: bold ? fontBold : font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= lineH;
  };

  const partnerName = quote.partners?.company_name || quote.partners?.name || "—";

  drawLine("Gaz Veled", 18, true);
  y -= 4;
  drawLine("ARAJANLAT", 14, true);
  y -= 8;
  drawLine(`Szam: ${quote.quote_number}`, 11, true);
  drawLine(`Datum: ${quote.quote_date}`);
  drawLine(`Partner: ${partnerName}`);
  if (quote.note) drawLine(`Megjegyzes: ${quote.note}`);
  y -= 8;

  drawLine("Termek", 10, true);
  drawLine("Menny.    Listaar    Kedv.    Ajanlati ar", 9, true);

  for (const item of items) {
    const label = quoteItemLabel(item);
    drawLine(label, 10, true);
    const discount = item.discount_percent > 0 ? `${item.discount_percent}%` : "—";
    const detail = `  ${item.quantity} db    ${formatHuf(item.list_price)}    ${discount}    ${formatHuf(item.unit_price)}`;
    drawLine(detail, 9);
  }

  y -= 8;
  const total = quoteTotal(items);
  drawLine(`Osszesen: ${formatHuf(total)}`, 12, true);

  return doc.save();
}

export function downloadQuotePdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes.slice()], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
