import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { AdrCalculationResult } from "@/lib/adr/types-and-calc";
import type { DeliveryNoteItemInput, DeliveryNoteSourceType } from "@/lib/delivery-notes/types";
import type { DeliveryNoteBusinessSnapshot } from "@/lib/delivery-notes/snapshot";
import { itemsFromBusinessSnapshot } from "@/lib/delivery-notes/snapshot";

export type DeliveryNotePdfInput = {
  documentNumber: string;
  issuedAtIso: string;
  status?: "draft" | "finalized" | "cancelled";
  cancellationReason?: string | null;
  sourceType?: DeliveryNoteSourceType | string | null;
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
  title: string;
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
  const { page, font, fontBold, documentNumber, title } = ctx;
  page.drawText(title, {
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
    size: 11,
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

function isEmptyItem(it: DeliveryNoteItemInput): boolean {
  return (
    it.lineRole === "incoming_empty" ||
    it.cylinderState === "EMPTY_UNCLEANED" ||
    it.cylinderState === "EMPTY_CLEAN"
  );
}

function isFullItem(it: DeliveryNoteItemInput): boolean {
  return it.lineRole === "outgoing_full" || it.cylinderState === "FULL" || it.cylinderState === "PARTIAL";
}

type GasSizeGroup = {
  gas: string;
  size: string;
  qty: number;
  barcodes: string[];
};

function groupByGasSize(items: DeliveryNoteItemInput[]): GasSizeGroup[] {
  const map = new Map<string, GasSizeGroup>();
  for (const it of items) {
    const gas = (it.gasType ?? "—").trim() || "—";
    const size = (it.size ?? "—").trim() || "—";
    const key = `${gas}||${size}`;
    const row = map.get(key) ?? { gas, size, qty: 0, barcodes: [] };
    row.qty += it.quantity;
    if (it.barcode) row.barcodes.push(it.barcode);
    map.set(key, row);
  }
  return [...map.values()];
}

function writeGroupedCylinderSection(
  ctx: Ctx,
  title: string,
  items: DeliveryNoteItemInput[],
  lineSuffix: string,
) {
  if (items.length === 0) return;
  line(ctx, title, 11, true);
  ctx.y -= 2;
  for (const g of groupByGasSize(items)) {
    line(ctx, `${g.gas} ${g.size} ${lineSuffix}: ${g.qty} db`, 10, true);
    if (g.barcodes.length === 0) continue;
    if (g.barcodes.length <= 6) {
      line(ctx, `  Sorszámok: ${g.barcodes.join(", ")}`, 9);
    } else {
      line(ctx, "  Sorszámok:", 9);
      for (const bc of g.barcodes) {
        line(ctx, `    ${bc}`, 9);
      }
    }
  }
  ctx.y -= 6;
}

function writeSupplierAdrBlock(ctx: Ctx, input: DeliveryNotePdfInput, emptyCount: number) {
  line(ctx, "ADR FUVAROKMÁNY ADATOK", 11, true);
  line(ctx, `Szabálykészlet: ${input.adr.rulesetVersion}`, 9);
  ctx.y -= 2;
  line(ctx, `Üres tartály: ${emptyCount} darab`, 9, true);
  if (emptyCount > 0) {
    line(
      ctx,
      "Mindegyik átadott, tisztítatlan üres palack 4. szállítási kategória (ÜRES TARTÁLY, 2).",
      9,
    );
  }
  // Beszállítói átvételnél a teli ADR-t a beszállító bizonylata számolja — nálunk 0 pont.
  line(ctx, "ADR 1.1.3.6 számított érték: 0 / 1000", 10, true);
  line(ctx, "Mennyiségi állapot: ADR 1.1.3.6 határán belül", 9, true);
  line(
    ctx,
    "Megjegyzés: a teli palackok ADR adatait a beszállító szállítólevele / számlája tartalmazza.",
    7,
  );
}

function writeCustomerAdrBlock(ctx: Ctx, input: DeliveryNotePdfInput, emptyCount: number) {
  line(ctx, "ADR FUVAROKMÁNY ADATOK", 11, true);
  line(ctx, `Szabálykészlet: ${input.adr.rulesetVersion}`, 9);
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

  if (emptyCount > 0) {
    line(ctx, "ÜRES TARTÁLY, 2", 9, true);
    line(ctx, `Átvett üres, tisztítatlan palackok: ${emptyCount} db (4. kategória)`, 8);
  }

  ctx.y -= 4;
  line(ctx, "ADR 1.1.3.6 ÖSSZESÍTÉS", 10, true);
  line(ctx, `1. kategória: ${input.adr.pointsByCategory.cat1}`);
  line(ctx, `2. kategória: ${input.adr.pointsByCategory.cat2}`);
  line(ctx, `3. kategória: ${input.adr.pointsByCategory.cat3}`);
  line(ctx, `Üres, tisztítatlan / 4. kategória: ${emptyCount} db`);
  line(ctx, `ADR 1.1.3.6 számított érték: ${input.adr.totalPoints} / 1000`, 10, true);
  line(ctx, input.adr.statusLabelHu, 9, true);
  line(
    ctx,
    "Megjegyzés: a pontszám önmagában nem jelenti, hogy a szállítás minden egyéb ADR-követelménynek megfelel.",
    7,
  );
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

  const isSupplier = input.sourceType === "supplier_exchange";
  const title = isSupplier
    ? "SZÁLLÍTÓLEVÉL – BESZÁLLÍTÓI PALACKCSERE"
    : "SZÁLLÍTÓLEVÉL – PALACKCSERE (VEVŐ)";

  const ctx: Ctx = {
    doc,
    page,
    font,
    fontBold,
    y: PAGE_H - MARGIN,
    pageNum: 1,
    documentNumber: input.documentNumber,
    title,
  };

  drawHeader(ctx, false);
  if (input.status === "cancelled") {
    drawCancelledBanner(ctx, input.cancellationReason);
  }

  line(ctx, `Kiállítás: ${fmtDateTime(input.issuedAtIso)}`, 9);
  if (input.status === "finalized") line(ctx, "Státusz: VÉGLEGESÍTVE", 9, true);
  else if (input.status === "cancelled") line(ctx, "Státusz: ÉRVÉNYTELENÍTVE", 9, true);
  else if (input.status === "draft") line(ctx, "Státusz: PISZKOZAT", 9, true);
  ctx.y -= 6;

  if (isSupplier) {
    line(ctx, `Átvevő (én / cég): ${input.shipperName}`, 10, true);
    if (input.shipperAddress) line(ctx, `Cím: ${input.shipperAddress}`);
    line(ctx, `Beszállító (átadó): ${input.consigneeName}`, 10, true);
    if (input.consigneeAddress) line(ctx, `Cím: ${input.consigneeAddress}`);
  } else {
    line(ctx, `Eladó: ${input.shipperName}`, 10, true);
    if (input.shipperAddress) line(ctx, `Cím: ${input.shipperAddress}`);
    line(ctx, `Vevő: ${input.consigneeName}`, 10, true);
    if (input.consigneeAddress) line(ctx, `Cím: ${input.consigneeAddress}`);
    if (input.deliveryAddress && input.deliveryAddress !== input.consigneeAddress) {
      line(ctx, `Szállítási cím: ${input.deliveryAddress}`);
    }
  }
  if (input.vehiclePlate) line(ctx, `Rendszám: ${input.vehiclePlate}`);
  if (input.driverName) line(ctx, `Gépjárművezető: ${input.driverName}`);
  ctx.y -= 10;

  const emptyItems = input.items.filter(isEmptyItem);
  const fullItems = input.items.filter(isFullItem);

  if (isSupplier) {
    // Én kapom a teli-t, én adom az üres-t — teljes ADR a telinek NINCS.
    writeGroupedCylinderSection(
      ctx,
      "ÁTVETT TELI PALACKOK",
      fullItems,
      "átvett teli palack",
    );
    writeGroupedCylinderSection(
      ctx,
      "ÁTADOTT ÜRES PALACKOK",
      emptyItems,
      "átadott üres palack",
    );
    writeSupplierAdrBlock(ctx, input, emptyItems.reduce((s, i) => s + i.quantity, 0));
    ctx.y -= 20;
    ensure(ctx, 70);
    line(ctx, "Átvevő / gépjárművezető: _________________________  Név: _______________", 9);
    ctx.y -= 16;
    line(ctx, "Átadó (én): _________________________  Név: _______________", 9);
  } else {
    // Én veszem át az üres-t, én adom a teli-t a vevőnek.
    writeGroupedCylinderSection(
      ctx,
      "ÁTVETT ÜRES PALACKOK",
      emptyItems,
      "átvett üres palack",
    );
    writeGroupedCylinderSection(
      ctx,
      "ÁTADOTT TELI PALACKOK",
      fullItems,
      "átadott teli palack",
    );
    writeCustomerAdrBlock(ctx, input, emptyItems.reduce((s, i) => s + i.quantity, 0));
    ctx.y -= 20;
    ensure(ctx, 70);
    line(ctx, "Átadó / gépjárművezető: _________________________  Név: _______________", 9);
    ctx.y -= 16;
    line(ctx, "Átvevő (vevő): _________________________  Név: _______________", 9);
  }

  drawFooter(ctx);
  return doc.save();
}

/** Finalized/cancelled PDF exclusively from frozen snapshots. */
export async function generateDeliveryNotePdfFromSnapshots(args: {
  documentNumber: string;
  issuedAtIso: string;
  status: "finalized" | "cancelled" | "draft";
  cancellationReason?: string | null;
  sourceType?: DeliveryNoteSourceType | string | null;
  business: DeliveryNoteBusinessSnapshot;
  adr: AdrCalculationResult;
}): Promise<Uint8Array> {
  const adrReady = (args.adr.blockingWarnings?.length ?? 0) === 0;
  return generateDeliveryNotePdf({
    documentNumber: args.documentNumber,
    issuedAtIso: args.issuedAtIso,
    status: args.status,
    cancellationReason: args.cancellationReason,
    sourceType: args.sourceType ?? args.business.sourceType ?? null,
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
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the browser has started the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
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
