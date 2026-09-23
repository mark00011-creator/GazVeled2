import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { AdrCalculationResult } from "@/lib/adr/types-and-calc";
import type { DeliveryNoteItemInput } from "@/lib/delivery-notes/types";

function pdfSafe(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ő/gi, "o")
    .replace(/ű/gi, "u");
}

export type DeliveryNotePdfInput = {
  documentNumber: string;
  issuedAtIso: string;
  shipperName: string;
  shipperAddress?: string | null;
  consigneeName: string;
  consigneeAddress?: string | null;
  deliveryAddress?: string | null;
  vehiclePlate?: string | null;
  driverName?: string | null;
  items: DeliveryNoteItemInput[];
  adr: AdrCalculationResult;
  adrReady: boolean;
};

type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  fontBold: PDFFont;
  y: number;
  pageNum: number;
  documentNumber: string;
};

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 42;
const LINE = 12;

function ensure(ctx: Ctx, need: number) {
  if (ctx.y - need < MARGIN + 28) {
    drawFooter(ctx);
    ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
    ctx.pageNum += 1;
    ctx.y = PAGE_H - MARGIN;
    drawHeader(ctx, true);
  }
}

function drawHeader(ctx: Ctx, continued: boolean) {
  const { page, font, fontBold, documentNumber } = ctx;
  page.drawText(pdfSafe("SZALLITOLEVEL / PALACKCSERE BIZONYLAT"), {
    x: MARGIN,
    y: ctx.y,
    size: 13,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  ctx.y -= 16;
  page.drawText(pdfSafe(`Bizonylatszam: ${documentNumber}${continued ? " (folytatas)" : ""}`), {
    x: MARGIN,
    y: ctx.y,
    size: 10,
    font: fontBold,
  });
  ctx.y -= 14;
  page.drawText(pdfSafe(`Oldal: ${ctx.pageNum}`), {
    x: MARGIN,
    y: ctx.y,
    size: 9,
    font,
  });
  ctx.y -= 18;
}

function drawFooter(ctx: Ctx) {
  ctx.page.drawText(pdfSafe(`${ctx.documentNumber} · ${ctx.pageNum}. oldal`), {
    x: MARGIN,
    y: 22,
    size: 8,
    font: ctx.font,
    color: rgb(0.4, 0.4, 0.4),
  });
}

function line(ctx: Ctx, text: string, size = 9, bold = false) {
  ensure(ctx, LINE + 2);
  const maxW = PAGE_W - MARGIN * 2;
  const f = bold ? ctx.fontBold : ctx.font;
  const words = pdfSafe(text).split(/\s+/);
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (f.widthOfTextAtSize(next, size) > maxW && cur) {
      ctx.page.drawText(cur, { x: MARGIN, y: ctx.y, size, font: f });
      ctx.y -= LINE;
      ensure(ctx, LINE + 2);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) {
    ctx.page.drawText(cur, { x: MARGIN, y: ctx.y, size, font: f });
    ctx.y -= LINE;
  }
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("hu-HU");
  } catch {
    return iso;
  }
}

export async function generateDeliveryNotePdf(input: DeliveryNotePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);

  const ctx: Ctx = {
    doc,
    page,
    font,
    fontBold,
    y: PAGE_H - MARGIN,
    pageNum: 1,
    documentNumber: input.documentNumber,
  };

  drawHeader(ctx, false);
  line(ctx, `Kiállítás: ${fmtDateTime(input.issuedAtIso)}`, 9);
  ctx.y -= 4;
  line(ctx, `Feladó: ${input.shipperName}`, 10, true);
  if (input.shipperAddress) line(ctx, `Cím: ${input.shipperAddress}`);
  line(ctx, `Címzett: ${input.consigneeName}`, 10, true);
  if (input.consigneeAddress) line(ctx, `Cím: ${input.consigneeAddress}`);
  if (input.deliveryAddress && input.deliveryAddress !== input.consigneeAddress) {
    line(ctx, `Szállítási cím: ${input.deliveryAddress}`);
  }
  if (input.vehiclePlate) line(ctx, `Rendszám: ${input.vehiclePlate}`);
  if (input.driverName) line(ctx, `Gépjárművezető: ${input.driverName}`);
  ctx.y -= 8;

  line(ctx, "PALACKCSERE TÁBLÁZAT", 11, true);
  ctx.y -= 2;

  const byKey = new Map<
    string,
    { gas: string; size: string; full: number; empty: number; other: number; barcodes: string[] }
  >();
  for (const it of input.items) {
    const key = `${it.gasType ?? "?"}||${it.size ?? "?"}`;
    const row = byKey.get(key) ?? {
      gas: it.gasType ?? "—",
      size: it.size ?? "—",
      full: 0,
      empty: 0,
      other: 0,
      barcodes: [],
    };
    if (it.lineRole === "outgoing_full") row.full += it.quantity;
    else if (it.lineRole === "incoming_empty") row.empty += it.quantity;
    else row.other += it.quantity;
    if (it.barcode) row.barcodes.push(it.barcode);
    byKey.set(key, row);
  }

  for (const row of byKey.values()) {
    line(
      ctx,
      `${row.gas} ${row.size} · teli kiadott: ${row.full} · üres visszavett (tisztítatlan): ${row.empty}` +
        (row.other ? ` · egyéb: ${row.other}` : ""),
      9,
      true,
    );
    if (row.barcodes.length) {
      line(ctx, `  Sorszámok: ${row.barcodes.join(", ")}`, 8);
    }
  }

  ctx.y -= 10;
  line(ctx, "ADR FUVAROKMÁNY ADATOK", 11, true);
  line(ctx, `Szabálykészlet: ${input.adr.rulesetVersion}`, 8);
  ctx.y -= 2;

  if (!input.adrReady) {
    line(ctx, "FIGYELEM: A termék ADR törzsadata nincs hitelesítve – nem jogilag kész ADR dokumentum.", 9, true);
    for (const w of input.adr.blockingWarnings) line(ctx, `• ${w}`, 8);
    ctx.y -= 4;
  }

  for (const l of input.adr.lines) {
    if (!l.includedInDangerousGoods || l.state === "EMPTY_UNCLEANED") continue;
    if (!l.documentLineText) continue;
    line(ctx, l.documentLineText, 9, true);
    line(
      ctx,
      `  ${l.quantity} db palack · mennyiség: ${l.adrQuantity}${l.adrQuantityUnit ?? ""} · kat. ${l.transportCategory ?? "—"} · ×${l.multiplier} · pont: ${l.points}`,
      8,
    );
  }

  if (input.adr.emptyUncleanedCount > 0) {
    line(ctx, "ÜRES TARTÁLY, 2", 9, true);
    line(ctx, `Visszavett üres palackok összesen: ${input.adr.emptyUncleanedCount} db`, 8);
  }

  ctx.y -= 6;
  line(ctx, "ADR 1.1.3.6 ÖSSZESÍTÉS", 10, true);
  line(ctx, `1. kategória: ${input.adr.pointsByCategory.cat1}`);
  line(ctx, `2. kategória: ${input.adr.pointsByCategory.cat2}`);
  line(ctx, `3. kategória: ${input.adr.pointsByCategory.cat3}`);
  line(ctx, `Üres, tisztítatlan / 4. kategória: ${input.adr.emptyUncleanedCount} db`);
  line(
    ctx,
    `ADR 1.1.3.6 számított érték: ${input.adr.totalPoints} / 1000`,
    10,
    true,
  );
  line(ctx, input.adr.statusLabelHu, 9, true);
  line(
    ctx,
    "Megjegyzés: a pontszám önmagában nem jelenti, hogy a szállítás minden egyéb ADR-követelménynek megfelel.",
    7,
  );

  ctx.y -= 20;
  ensure(ctx, 70);
  line(ctx, "Átadó / gépjárművezető: _________________________  Név: _______________", 9);
  ctx.y -= 16;
  line(ctx, "Átvevő: _________________________  Név: _______________", 9);

  drawFooter(ctx);
  return doc.save();
}

export function downloadDeliveryNotePdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
