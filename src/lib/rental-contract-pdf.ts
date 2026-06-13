import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { depositTypeLabels, fmtDate } from "@/lib/labels";
import type { DepositType, RentalType } from "@/lib/labels";

/** Átadó – sablon: GÁZPALACK ÁTADÁS-ÁTVÉTELI JEGYZŐKÖNYV */
const LESSOR = {
  name: "Horváth Márk",
  company_label: "Horváth Márk Egyéni Vállalkozó",
  address: "8060 Mór, Bartók Béla utca 17",
  registered_office: "8060 Mór, Jószerencsét utca 37",
  tax_number: "67696606-1-27",
  reg_number: "57046884",
};

const GAS_COLUMNS = [
  "Hélium",
  "Szén-dioxid",
  "Nitrogén",
  "Oxigén",
  "Biogon",
  "Stargon",
  "Acetilén",
  "Spórgáz",
] as const;

const SIZE_ROWS = [
  "9L",
  "20L",
  "40L",
  "50L",
  "1-5kg",
  "5 kg",
  "10 kg",
  "15 kg",
  "20 kg",
  "30 kg",
  "37,5 kg",
] as const;

/** Normalize app gas/size labels to template grid keys. */
const GAS_ALIASES: Record<string, string> = {
  Széndioxid: "Szén-dioxid",
  Argon: "Spórgáz",
  Stargon: "Stargon",
};

function normalizeGas(gas: string): string {
  return GAS_ALIASES[gas] ?? gas;
}

function normalizeSize(size: string): string {
  const s = size.trim();
  if (/^\d+\s*L$/i.test(s)) return s.replace(/\s+/g, "").replace(/l$/i, "L");
  if (s === "1-5 kg") return "1-5kg";
  return s;
}

export type RentalContractData = {
  rentalId: string;
  contractNumber?: string | null;
  rentalType: RentalType;
  contractDate?: string;
  handoverDate?: string;
  partner: {
    name: string;
    company_name?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    tax_number?: string | null;
    contact_person?: string | null;
    id_number?: string | null;
  };
  startDate: string;
  expiryDate: string | null;
  monthlyFee: number;
  deposit: number;
  depositType?: DepositType | null;
  cylinders: {
    barcode: string;
    gas_type: string;
    size: string;
    replacement_value?: number | null;
  }[];
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

function contractSerial(rentalId: string, startDate: string): string {
  const year = startDate.slice(0, 4);
  const seq = rentalId.replace(/-/g, "").slice(0, 4).toUpperCase();
  return `GV-${year}-${seq}`;
}

function countByGasSize(cylinders: RentalContractData["cylinders"]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of cylinders) {
    const gas = normalizeGas(c.gas_type);
    const size = normalizeSize(c.size);
    const key = `${gas}|${size}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function summarizeList(cylinders: RentalContractData["cylinders"]): string {
  const counts = new Map<string, number>();
  for (const c of cylinders) {
    const key = `${c.gas_type} ${c.size}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([k, n]) => `${n} db ${k}`).join(", ");
}

function feeClause(rentalType: RentalType, monthlyFee: number): string {
  if (rentalType === "free") {
    return "2.) A berlet dijmentes kolcson, nyilvantartasi celokra.";
  }
  if (rentalType === "yearly") {
    return `2.) A berleti dij osszege brutto ${monthlyFee.toLocaleString("hu-HU")} Ft/ev, mely a szerzodes alairasanak napjatol szamitjuk. Az elkovetkezo evekben az alairas honapjaban kerul sor az eves dij szamlazasara a mar meglévo palackok utan. Amennyiben a berleti dij kiegyenlitesre kerult, de ATVEVO felmondja a berleti szerzodest, abban az esetben a berleti dijat az ATADONAK nem all modjaban visszateriteni.`;
  }
  return `2.) A berleti dij osszege brutto ${monthlyFee.toLocaleString("hu-HU")} Ft/ho, mely a szerzodes alairasanak napjatol szamitjuk a ho fordulot. Az elkovetkezo honapokban a meglévo palackok utan havonta kerul sor a dij szamlazasara. Amennyiben a berleti dij kiegyenlitesre kerult, de ATVEVO felmondja a berleti szerzodest, abban az esetben a berleti dijat az ATADONAK nem all modjaban visszateriteni.`;
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

/** Gázpalack átadás-átvételi jegyzőkönyv – sablon: GÁZPALACK ÁTADÁS Dreska András.doc */
export async function generateRentalContractPdf(data: RentalContractData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serial = data.contractNumber ?? contractSerial(data.rentalId, data.startDate);
  const qrDataUrl = await QRCode.toDataURL(serial, { margin: 1, width: 96 });
  const qrPng = await doc.embedPng(qrDataUrl);
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 40;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const colMid = pageWidth / 2;

  const ensureSpace = (needed: number) => {
    if (y - needed < margin) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  };

  const drawAt = (x: number, text: string, size: number, bold = false) => {
    const f = bold ? fontBold : font;
    page.drawText(pdfSafe(text), { x, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
  };

  const drawLine = (text: string, size = 9, bold = false, indent = 0) => {
    for (const line of wrapText(text, 100)) {
      ensureSpace(size + 4);
      drawAt(margin + indent, line, size, bold);
      y -= size + 4;
    }
  };

  const contractDate = data.contractDate ?? data.startDate;
  const handoverDate = data.handoverDate ?? data.startDate;
  const dateFmt = fmtDate(contractDate).replace(/\s/g, " ");

  // Fejléc
  ensureSpace(50);
  const title = pdfSafe("GAZPALACK ATADAS-ATVETELI JEGYZOKONYV");
  const titleW = fontBold.widthOfTextAtSize(title, 13);
  page.drawText(title, {
    x: (pageWidth - titleW) / 2,
    y,
    size: 13,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  y -= 18;
  drawAt(margin, `Sorszama: ${serial}`, 9);
  drawAt(pageWidth - margin - 100, dateFmt, 9);
  page.drawImage(qrPng, { x: pageWidth - margin - 48, y: y - 38, width: 42, height: 42 });
  y -= 14;

  // Két oszlop fejléc
  drawAt(margin, "PALACK ATADO", 9, true);
  drawAt(colMid + 8, "PALACK ATVEVO / KEPVISELO", 9, true);
  y -= 12;

  const colYStart = y;
  let leftY = colYStart;
  let rightY = colYStart;

  const drawLeft = (label: string, value: string) => {
    page.drawText(pdfSafe(`${label}: ${value || "-"}`), { x: margin, y: leftY, size: 8, font });
    leftY -= 11;
  };
  const drawRight = (label: string, value: string) => {
    page.drawText(pdfSafe(`${label}: ${value || "-"}`), {
      x: colMid + 8,
      y: rightY,
      size: 8,
      font,
    });
    rightY -= 11;
  };

  drawLeft("Ceg neve", LESSOR.name);
  drawRight("Ceg neve", data.partner.company_name ?? data.partner.name);
  drawLeft("Cim", LESSOR.address);
  drawRight("Cim", data.partner.address ?? "");
  drawLeft("Szekhely", LESSOR.registered_office);
  drawRight("Szekhely", "");
  drawLeft("Adoszam", LESSOR.tax_number);
  drawRight("Adoszam", data.partner.tax_number ?? "");
  drawLeft("Nyilv. szam", LESSOR.reg_number);
  drawRight("Nyilv. szam", "");
  drawLeft("Kaucio osszege", `${data.deposit.toLocaleString("hu-HU")} Ft`);
  drawLeft("Kaucio tipusa", depositTypeLabels[data.depositType ?? "custom"] ?? "Egyedi osszeg");
  drawRight("Telefonszam", data.partner.phone ?? "");
  drawRight("e-mail cim", data.partner.email ?? "");
  if (data.partner.id_number) drawRight("Szemelyi ig. szam", data.partner.id_number);
  if (data.partner.contact_person) drawRight("Kepviselo neve", data.partner.contact_person);
  drawLeft("tovabbiakban: ATADO", "");
  drawRight("tovabbiakban: ATVEVO", "");

  y = Math.min(leftY, rightY) - 10;

  drawLine(
    "Jelen jegyzokonyv a felek kozott megkotott berleti szerzodes alapjan, illetve a SIAD Hungary Kft. Altalanos Szerzodesi Felteteleinek ervényben levo rendelkezesei szerint keszult.",
    8,
  );
  y -= 4;

  // Palack rács
  ensureSpace(120);
  drawLine("Palackok (atadott mennyiseg):", 9, true);
  y -= 2;

  const counts = countByGasSize(data.cylinders);
  const cellW = (pageWidth - margin * 2) / GAS_COLUMNS.length;
  const gridTop = y;
  const headerH = 14;

  // Oszlop fejlécek
  GAS_COLUMNS.forEach((gas, i) => {
    const x = margin + i * cellW + 2;
    page.drawText(pdfSafe(gas), {
      x,
      y: gridTop,
      size: 6,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2),
    });
  });
  y = gridTop - headerH;

  for (const size of SIZE_ROWS) {
    ensureSpace(12);
    page.drawText(pdfSafe(size), { x: margin - 2, y, size: 6, font, color: rgb(0.3, 0.3, 0.3) });
    GAS_COLUMNS.forEach((gas, i) => {
      const cnt = counts.get(`${gas}|${size}`) ?? 0;
      const mark = cnt > 0 ? `[${cnt}]` : "[ ]";
      page.drawText(pdfSafe(mark), {
        x: margin + i * cellW + 4,
        y,
        size: 7,
        font: cnt > 0 ? fontBold : font,
        color: cnt > 0 ? rgb(0, 0, 0) : rgb(0.6, 0.6, 0.6),
      });
    });
    y -= 11;
  }
  y -= 6;

  // Összefoglaló + vonalkódok
  const summary = summarizeList(data.cylinders);
  drawLine(
    `1.) Felek kijelentik, hogy ATADO berbe adja ATVEVONEK a kovetkezo palackokat berleti dij elleneben: ${summary || "0 db"}.`,
    9,
  );
  y -= 2;

  if (data.cylinders.length > 0) {
    for (const c of data.cylinders) {
      drawLine(`   - ${c.barcode}: ${c.gas_type}, ${c.size}`, 8, false, 4);
    }
    y -= 4;
  }

  drawLine(feeClause(data.rentalType, data.monthlyFee), 9);
  y -= 2;
  drawLine(
    `Havi/eves dij: ${data.monthlyFee.toLocaleString("hu-HU")} Ft. Kaucio: ${data.deposit.toLocaleString("hu-HU")} Ft (${depositTypeLabels[data.depositType ?? "custom"] ?? "Egyedi osszeg"}).`,
    9,
  );
  const replacementTotal = data.cylinders.reduce(
    (sum, c) => sum + Number(c.replacement_value ?? 100000),
    0,
  );
  drawLine(
    `Palack potlasi ertek nyilvantartas szerint: ${replacementTotal.toLocaleString("hu-HU")} Ft (szerzodesben jelenleg egysegesen 100 000 Ft/palack kezelheto).`,
    9,
  );
  y -= 2;
  drawLine(
    "3.) ATADO kijelenti, hogy ATVEVONEK megteriti a kauciot, amennyiben ATVEVO felmondja a berleti szerzodest, valamint a felmondast koveto 5 napon visszaadja a berelt palackot. Amennyiben ATVEVO a berleti ido lejarta utan nem hosszabbitja meg a berleti idot, koteles visszaadni azt a palackot ATADONAK. Amennyiben 10 napon belul nem tortenik meg a visszaadas, akkor a berles tovabb folytatodik az eves berleti dijnak a ketszereseert. Ezt az ATADO az atvett kauciobol levonhatja, amennyiben ATVEVO nem rendezi.",
    9,
  );
  y -= 2;
  drawLine(
    `4.) Felek ezuton megallapodnak, hogy az 1. pontban megnevezett gazpalackot/gazpalackokat ${fmtDate(handoverDate).replace(/\./g, " ")}-en ATADO atadja ATVEVONEK, mellyel az az ATVEVO berletebe kerul, annak berleti dijat es a vele kapcsolatos osszes kotelezettseget ettol a naptol fogva ATVEVO viseli.`,
    9,
  );
  if (data.expiryDate) {
    y -= 2;
    drawLine(`Berlet lejarata: ${fmtDate(data.expiryDate)}`, 9);
  }

  y -= 2;
  drawLine(`QR-kod tartalma / szerzodes azonosito: ${serial}`, 8);

  y -= 24;
  ensureSpace(50);
  const sigY = y;
  page.drawLine({
    start: { x: margin, y: sigY },
    end: { x: colMid - 20, y: sigY },
    thickness: 0.5,
    color: rgb(0.4, 0.4, 0.4),
  });
  page.drawLine({
    start: { x: colMid + 20, y: sigY },
    end: { x: pageWidth - margin, y: sigY },
    thickness: 0.5,
    color: rgb(0.4, 0.4, 0.4),
  });
  page.drawText(pdfSafe("Atado (nev, alairas, belyegzo)"), {
    x: margin,
    y: sigY - 12,
    size: 8,
    font,
  });
  page.drawText(pdfSafe("Atvevo (nev, alairas, belyegzo)"), {
    x: colMid + 20,
    y: sigY - 12,
    size: 8,
    font,
  });

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
