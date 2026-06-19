import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { fmtDate } from "@/lib/labels";
import type { RentalType } from "@/lib/labels";
import {
  circulationLabels,
  manufacturerLabels,
  rentalTypeLabels,
  statusLabels,
  type Circulation,
  type Manufacturer,
} from "@/lib/labels";

const DEFAULT_REPLACEMENT_VALUE = 100_000;

const LESSOR = {
  name: "Horváth Márk E.V.",
  registeredOffice: "8060 Mór, Jószerencsét utca 37.",
  site: "8060 Mór, Csókakői út 1.",
  taxNumber: "66716606-1-27",
};

const PRODUCTION_ORIGIN = "https://gazveeled2.vercel.app";

export type RentalContractPartner = {
  name: string;
  company_name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  tax_number?: string | null;
  contact_person?: string | null;
  birth_place?: string | null;
  birth_date?: string | null;
  mother_name?: string | null;
  id_number?: string | null;
  address_card_number?: string | null;
};

export type RentalContractCylinder = {
  barcode: string;
  gas_type: string;
  size: string;
  manufacturer?: string | null;
  factory_serial?: string | null;
  owner?: string | null;
  circulation?: string | null;
  status?: string | null;
  replacement_value?: number;
};

export type RentalContractData = {
  rentalId: string;
  contractNumber?: string | null;
  contractDate?: string;
  rentalType: RentalType;
  partner: RentalContractPartner;
  startDate: string;
  expiryDate: string | null;
  monthlyFee: number;
  deposit: number;
  depositType?: string | null;
  cylinders: RentalContractCylinder[];
  appOrigin?: string;
};

function pdfSafe(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ő/g, "o")
    .replace(/Ő/g, "O")
    .replace(/ű/g, "u")
    .replace(/Ű/g, "U");
}

function formatHuf(n: number): string {
  return `${Math.round(n).toLocaleString("hu-HU")} Ft`;
}

function ownerLabel(c: RentalContractCylinder): string {
  const key = (c.owner ?? c.circulation ?? "") as Circulation;
  return circulationLabels[key] ?? c.owner ?? c.circulation ?? "—";
}

function manufacturerLabel(m: string | null | undefined): string {
  if (!m) return "—";
  return manufacturerLabels[m as Manufacturer] ?? m;
}

function statusLabel(s: string | null | undefined): string {
  if (!s) return "—";
  return statusLabels[s] ?? s;
}

function feeLabel(rentalType: RentalType, monthlyFee: number): string {
  if (rentalType === "free") return "Dijmentes kolcson";
  if (rentalType === "yearly") {
    return `Eves berleti dij: ${formatHuf(monthlyFee)} (brutto)`;
  }
  return `Havi berleti dij: ${formatHuf(monthlyFee)} (brutto)`;
}

function contractQrUrl(data: RentalContractData): string {
  const origin =
    data.appOrigin ??
    (typeof window !== "undefined" ? window.location.origin : PRODUCTION_ORIGIN);
  return `${origin.replace(/\/$/, "")}/rentals/${data.rentalId}`;
}

type PdfCtx = {
  doc: PDFDocument;
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  fontBold: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  pageWidth: number;
  pageHeight: number;
  margin: number;
  page: PDFPage;
  y: number;
};

function createCtx(doc: PDFDocument, font: PdfCtx["font"], fontBold: PdfCtx["fontBold"]): PdfCtx {
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 42;
  return {
    doc,
    font,
    fontBold,
    pageWidth,
    pageHeight,
    margin,
    page: doc.addPage([pageWidth, pageHeight]),
    y: pageHeight - margin,
  };
}

function ensureSpace(ctx: PdfCtx, needed: number) {
  if (ctx.y - needed < ctx.margin) {
    ctx.page = ctx.doc.addPage([ctx.pageWidth, ctx.pageHeight]);
    ctx.y = ctx.pageHeight - ctx.margin;
  }
}

function drawText(ctx: PdfCtx, x: number, text: string, size: number, bold = false) {
  const f = bold ? ctx.fontBold : ctx.font;
  ctx.page.drawText(pdfSafe(text), { x, y: ctx.y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
}

function wrapText(text: string, maxLen: number): string[] {
  const words = pdfSafe(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxLen) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawParagraph(ctx: PdfCtx, text: string, size = 9, bold = false, indent = 0) {
  for (const line of wrapText(text, 95)) {
    ensureSpace(size + 5);
    drawText(ctx, ctx.margin + indent, line, size, bold);
    ctx.y -= size + 4;
  }
}

function drawHeading(ctx: PdfCtx, text: string, size = 11) {
  ensureSpace(size + 8);
  drawText(ctx, ctx.margin, text, size, true);
  ctx.y -= size + 6;
}

function drawField(ctx: PdfCtx, label: string, value: string) {
  drawParagraph(ctx, `${label}: ${value}`, 8.5);
}

function drawFieldIf(ctx: PdfCtx, label: string, value: string | null | undefined) {
  const v = value?.trim();
  if (!v) return;
  drawField(ctx, label, v);
}

function drawLesseeBlock(ctx: PdfCtx, partner: RentalContractPartner) {
  drawHeading(ctx, "ATVEVO", 10);
  const displayName = partner.company_name?.trim() || partner.name;
  drawField(ctx, "Nev / cegnev", displayName);
  drawFieldIf(ctx, "Cim / szekhely", partner.address);
  drawFieldIf(ctx, "Telefonszam", partner.phone);
  drawFieldIf(ctx, "E-mail", partner.email);
  drawFieldIf(ctx, "Adoszam", partner.tax_number);
  drawFieldIf(ctx, "Kepviselo", partner.contact_person);
  drawFieldIf(ctx, "Szuletesi hely", partner.birth_place);
  if (partner.birth_date) drawField(ctx, "Szuletesi ido", fmtDate(partner.birth_date));
  drawFieldIf(ctx, "Anyja neve", partner.mother_name);
  drawFieldIf(ctx, "Szemelyi igazolvany szam", partner.id_number);
  drawFieldIf(ctx, "Lakcimkartya szam", partner.address_card_number);
  ctx.y -= 4;
}

function drawLessorBlock(ctx: PdfCtx) {
  drawHeading(ctx, "ATADO", 10);
  drawField(ctx, "Nev", LESSOR.name);
  drawField(ctx, "Szekhely", LESSOR.registeredOffice);
  drawField(ctx, "Telephely", LESSOR.site);
  drawField(ctx, "Adoszam", LESSOR.taxNumber);
  ctx.y -= 4;
}

function drawCylinderTable(ctx: PdfCtx, cylinders: RentalContractCylinder[]) {
  drawHeading(ctx, "BERELT PALACKOK", 10);

  const cols = [
    { label: "Gyarto", w: 52 },
    { label: "Gaz", w: 58 },
    { label: "Meret", w: 42 },
    { label: "Vonalkod", w: 72 },
    { label: "Gyari sz.", w: 58 },
    { label: "Tul.", w: 38 },
    { label: "All.", w: 38 },
    { label: "Potlas", w: 62 },
  ] as const;

  const tableX = ctx.margin;
  const rowH = 12;
  const headerSize = 6.5;
  const cellSize = 6.5;

  const drawRow = (values: string[], bold = false) => {
    ensureSpace(rowH + 2);
    let x = tableX;
    for (let i = 0; i < cols.length; i++) {
      const text = pdfSafe(values[i] ?? "");
      const clipped = text.length > 14 ? `${text.slice(0, 13)}…` : text;
      ctx.page.drawText(clipped, {
        x: x + 2,
        y: ctx.y - 8,
        size: cellSize,
        font: bold ? ctx.fontBold : ctx.font,
        color: rgb(0.1, 0.1, 0.1),
      });
      x += cols[i].w;
    }
    ctx.y -= rowH;
  };

  drawRow(cols.map((c) => c.label), true);

  if (cylinders.length === 0) {
    drawParagraph(ctx, "Nincs palack hozzarendelve.", 8);
    return;
  }

  for (const c of cylinders) {
    const replacement =
      c.replacement_value != null && c.replacement_value > 0
        ? c.replacement_value
        : DEFAULT_REPLACEMENT_VALUE;
    drawRow([
      manufacturerLabel(c.manufacturer),
      c.gas_type,
      c.size,
      c.barcode,
      c.factory_serial ?? "—",
      ownerLabel(c),
      statusLabel(c.status),
      formatHuf(replacement),
    ]);
  }
  ctx.y -= 6;
}

function drawRentalDetails(ctx: PdfCtx, data: RentalContractData) {
  drawHeading(ctx, "BERLETI ADATOK", 10);
  drawField(ctx, "Kezdo datum", fmtDate(data.startDate));
  if (data.expiryDate) drawField(ctx, "Lejarati datum", fmtDate(data.expiryDate));
  drawField(ctx, "Berleti dij", feeLabel(data.rentalType, data.monthlyFee));
  drawField(ctx, "Berlet tipusa", rentalTypeLabels[data.rentalType]);
  if (data.depositType?.trim()) drawField(ctx, "Kaucio tipusa", data.depositType.trim());
  drawField(ctx, "Kaucio osszege", formatHuf(data.deposit));
  ctx.y -= 4;
}

const CONTRACT_TERMS: { title: string; body: string }[] = [
  {
    title: "Tulajdonjog",
    body: "A berelt palack(ok) minden esetben az Atado tulajdonat kepezik. Tulajdonjuk nem ruhazhato at.",
  },
  {
    title: "Palackcsere",
    body: "A palack toltes vagy csere celjabol mas gazforgalmazonal leadhato vagy cserelheto.",
  },
  {
    title: "Felelosseg",
    body: "Az Atvevo teljes anyagi felelosseget vallal az atvett palack(ok)ert.",
  },
  {
    title: "Potlasi koltseg",
    body: `Az Atvevo vallalja, hogy elvesztes vagy megsemmisules eseten a tablazatban szereplo potlasi erteket megfizeti. Ha nincs egyedi ertek: ${formatHuf(DEFAULT_REPLACEMENT_VALUE)} / palack.`,
  },
  {
    title: "Kesedelmes visszaszolgaltatas",
    body: "Az Atado jogosult tovabbi berleti dij felszamitasara, fizetesi felszolitas kuldésére, koveteleskezelesre es jogi igenyervenyesitesre.",
  },
  {
    title: "Veszelyes nyomasallo edeny",
    body: "Az Atvevo tudomasul veszi, hogy a palackok veszelyes nyomasallo edenyek. Az Atado nem vallal felelosseget a nem rendeltetes szeru hasznalatbol eredo karokert.",
  },
  {
    title: "Adatkezeles",
    body: "Az Atvevo hozzajarul adatainak kezelesehez szerzodes teljesitese, kapcsolattartas, koveteleskezeles es jogi igenyervenyesites celjabol. Adatmegorzes: 5 ev.",
  },
  {
    title: "Okmanykezeles",
    body: "Amennyiben okmanyfoto kerult feltoltesre, az Atvevo hozzajarul azok tarolasahoz.",
  },
];

function drawTerms(ctx: PdfCtx) {
  drawHeading(ctx, "SZERZODESI FELTETELEK", 10);
  for (const term of CONTRACT_TERMS) {
    drawParagraph(ctx, term.title, 9, true);
    drawParagraph(ctx, term.body, 8.5);
    ctx.y -= 2;
  }
}

function drawDeclarations(ctx: PdfCtx) {
  drawHeading(ctx, "NYILATKOZATOK", 10);
  const items = [
    "Atvettem a palackokat",
    "Az adataim helyesek",
    "Megismertem az adatkezelesi tajekoztatot",
    "Hozzajarulok okmanyaim tarolasahoz",
  ];
  for (const item of items) {
    drawParagraph(ctx, `[ ] ${item}`, 8.5);
  }
  ctx.y -= 4;
}

function drawSignatures(ctx: PdfCtx, contractDate: string) {
  ensureSpace(70);
  const sigY = ctx.y;
  const colMid = ctx.pageWidth / 2;
  ctx.page.drawLine({
    start: { x: ctx.margin, y: sigY },
    end: { x: colMid - 24, y: sigY },
    thickness: 0.5,
    color: rgb(0.4, 0.4, 0.4),
  });
  ctx.page.drawLine({
    start: { x: colMid + 24, y: sigY },
    end: { x: ctx.pageWidth - ctx.margin, y: sigY },
    thickness: 0.5,
    color: rgb(0.4, 0.4, 0.4),
  });
  ctx.page.drawText(pdfSafe("Atado alairasa"), {
    x: ctx.margin,
    y: sigY - 12,
    size: 8,
    font: ctx.font,
  });
  ctx.page.drawText(pdfSafe("Atvevo alairasa"), {
    x: colMid + 24,
    y: sigY - 12,
    size: 8,
    font: ctx.font,
  });
  ctx.page.drawText(pdfSafe(`Datum: ${fmtDate(contractDate)}`), {
    x: ctx.margin,
    y: sigY - 28,
    size: 8,
    font: ctx.font,
  });
  ctx.y = sigY - 40;
}

async function drawQrCode(ctx: PdfCtx, url: string) {
  const size = 72;
  const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 160, errorCorrectionLevel: "M" });
  const base64 = dataUrl.split(",")[1];
  const pngBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const img = await ctx.doc.embedPng(pngBytes);
  const x = ctx.pageWidth - ctx.margin - size;
  const y = ctx.margin;
  ctx.page.drawImage(img, { x, y, width: size, height: size });
  ctx.page.drawText(pdfSafe("QR: berlet adatlap"), {
    x,
    y: y - 10,
    size: 6,
    font: ctx.font,
    color: rgb(0.35, 0.35, 0.35),
  });
}

/** Gázpalack bérleti szerződés – V2 */
export async function generateRentalContractPdf(data: RentalContractData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ctx = createCtx(doc, font, fontBold);

  const contractDate = data.contractDate ?? data.startDate;
  const serial =
    data.contractNumber?.trim() ||
    `${data.startDate.slice(0, 4)}/B-${data.rentalId.replace(/-/g, "").slice(0, 4).toUpperCase()}`;

  // Cím + szerződésszám
  ensureSpace(60);
  const title = pdfSafe("GAZPALACK BERLETI SZERZODES");
  const titleW = fontBold.widthOfTextAtSize(title, 14);
  ctx.page.drawText(title, {
    x: (ctx.pageWidth - titleW) / 2,
    y: ctx.y,
    size: 14,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  ctx.y -= 22;
  drawField(ctx, "Szerzodesszam", serial);
  drawField(ctx, "Kelt", fmtDate(contractDate));
  ctx.y -= 6;

  drawLessorBlock(ctx);
  drawLesseeBlock(ctx);
  drawCylinderTable(ctx, data.cylinders);
  drawRentalDetails(ctx, data);
  drawTerms(ctx);
  drawDeclarations(ctx);
  drawSignatures(ctx, contractDate);

  await drawQrCode(ctx, contractQrUrl(data));

  return doc.save();
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
