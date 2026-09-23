import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { AdrCalculationResult } from "@/lib/adr/types-and-calc";
import type { DeliveryNoteItemInput } from "@/lib/delivery-notes/types";
import type { DeliveryNoteBusinessSnapshot } from "@/lib/delivery-notes/snapshot";
import { itemsFromBusinessSnapshot } from "@/lib/delivery-notes/snapshot";

export type DeliveryNotePdfInput = {
  documentNumber: string;
  issuedAtIso: string;
  status?: "draft" | "finalized" | "cancelled";
  cancellationReason?: string | null;
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
const LINE = 13;

let fontCache: { regular: Uint8Array; bold: Uint8Array } | null = null;

async function loadFontBytes(): Promise<{ regular: Uint8Array; bold: Uint8Array }> {
  if (fontCache) return fontCache;

  // Browser: public/fonts
  if (typeof window !== "undefined") {
    const [regRes, boldRes] = await Promise.all([
      fetch("/fonts/NotoSans-Regular.ttf"),
      fetch("/fonts/NotoSans-Bold.ttf"),
    ]);
    if (!regRes.ok || !boldRes.ok) {
      throw new Error("Noto Sans font betöltése sikertelen (/fonts/…)");
    }
    fontCache = {
      regular: new Uint8Array(await regRes.arrayBuffer()),
      bold: new Uint8Array(await boldRes.arrayBuffer()),
    };
    return fontCache;
  }

  // Node tests only — dynamic path avoids Vite client static analysis of node:fs
  const fsPath = ["node", "fs"].join(":");
  const pathPath = ["node", "path"].join(":");
  const fs = await import(/* @vite-ignore */ fsPath);
  const path = await import(/* @vite-ignore */ pathPath);
  const root = path.resolve(process.cwd(), "public/fonts");
  fontCache = {
    regular: new Uint8Array(fs.readFileSync(path.join(root, "NotoSans-Regular.ttf"))),
    bold: new Uint8Array(fs.readFileSync(path.join(root, "NotoSans-Bold.ttf"))),
  };
  return fontCache;
}

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
  page.drawText("SZÁLLÍTÓLEVÉL / PALACKCSERE BIZONYLAT", {
    x: MARGIN,
    y: ctx.y,
    size: 13,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  ctx.y -= 16;
  page.drawText(`Bizonylatszám: ${documentNumber}${continued ? " (folytatás)" : ""}`, {
    x: MARGIN,
    y: ctx.y,
    size: 10,
    font: fontBold,
  });
  ctx.y -= 14;
  page.drawText(`Oldal: ${ctx.pageNum}`, {
    x: MARGIN,
    y: ctx.y,
    size: 9,
    font,
  });
  ctx.y -= 18;
}

function drawFooter(ctx: Ctx) {
  ctx.page.drawText(`${ctx.documentNumber} · ${ctx.pageNum}. oldal`, {
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
  const words = text.split(/\s+/);
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

function drawCancelledBanner(ctx: Ctx, reason: string | null | undefined) {
  ensure(ctx, 48);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - 34,
    width: PAGE_W - MARGIN * 2,
    height: 40,
    color: rgb(0.95, 0.85, 0.85),
    borderColor: rgb(0.7, 0.1, 0.1),
    borderWidth: 1.5,
  });
  ctx.page.drawText("ÉRVÉNYTELENÍTVE", {
    x: MARGIN + 8,
    y: ctx.y - 14,
    size: 14,
    font: ctx.fontBold,
    color: rgb(0.7, 0.05, 0.05),
  });
  ctx.y -= 28;
  line(ctx, `Érvénytelenítés oka: ${reason?.trim() || "—"}`, 9, true);
  ctx.y -= 8;
}

export async function generateDeliveryNotePdf(input: DeliveryNotePdfInput): Promise<Uint8Array> {
  const fonts = await loadFontBytes();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fonts.regular, { subset: true });
  const fontBold = await doc.embedFont(fonts.bold, { subset: true });
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
  if (input.status === "cancelled") {
    drawCancelledBanner(ctx, input.cancellationReason);
  }

  line(ctx, `Kiállítás: ${fmtDateTime(input.issuedAtIso)}`, 9);
  if (input.status) line(ctx, `Státusz: ${input.status.toUpperCase()}`, 9, true);
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

  // Explicit item list for multipage stress (each line)
  if (input.items.length >= 15) {
    ctx.y -= 6;
    line(ctx, "Tételrészletező", 10, true);
    for (const it of input.items) {
      line(
        ctx,
        `• ${it.gasType ?? "—"} ${it.size ?? ""} · ${it.quantity} db · ${it.cylinderState}` +
          (it.barcode ? ` · ${it.barcode}` : ""),
        8,
      );
    }
  }

  ctx.y -= 10;
  line(ctx, "ADR FUVAROKMÁNY ADATOK", 11, true);
  line(ctx, `Szabálykészlet: ${input.adr.rulesetVersion}`, 8);
  ctx.y -= 2;

  if (!input.adrReady) {
    line(
      ctx,
      "FIGYELEM: A termék ADR törzsadata nincs hitelesítve – nem jogilag kész ADR dokumentum.",
      9,
      true,
    );
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
  line(ctx, `ADR 1.1.3.6 számított érték: ${input.adr.totalPoints} / 1000`, 10, true);
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

/** Finalized/cancelled PDF exclusively from frozen snapshots. */
export async function generateDeliveryNotePdfFromSnapshots(args: {
  documentNumber: string;
  issuedAtIso: string;
  status: "finalized" | "cancelled" | "draft";
  cancellationReason?: string | null;
  business: DeliveryNoteBusinessSnapshot;
  adr: AdrCalculationResult;
}): Promise<Uint8Array> {
  const adrReady = (args.adr.blockingWarnings?.length ?? 0) === 0;
  return generateDeliveryNotePdf({
    documentNumber: args.documentNumber,
    issuedAtIso: args.issuedAtIso,
    status: args.status,
    cancellationReason: args.cancellationReason,
    shipperName: args.business.shipperName,
    shipperAddress: args.business.shipperAddress,
    consigneeName: args.business.consigneeName,
    consigneeAddress: args.business.consigneeAddress,
    deliveryAddress: args.business.deliveryAddress,
    vehiclePlate: args.business.vehiclePlate,
    driverName: args.business.driverName,
    items: itemsFromBusinessSnapshot(args.business),
    adr: args.adr,
    adrReady,
  });
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

export function pdfBytesToBase64(pdfBytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(pdfBytes).toString("base64");
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < pdfBytes.length; i += chunk) {
    binary += String.fromCharCode(...pdfBytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function pdfBase64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
