/** Számlázz.hu Agent XML építő – tiszta függvények, böngészőben is futtathatók teszthez. */

import { parsePartnerAddress } from "./address";

export type SzamlazzVatCode = string; // "27" | "AAM" | "TAM" | ...

export type SzamlazzInvoiceBuyer = {
  name: string;
  address?: string | null;
  email?: string | null;
  taxNumber?: string | null;
  /** Ha megvan adószám → adoalany=1, különben -1 */
  phone?: string | null;
};

export type SzamlazzInvoiceLine = {
  name: string;
  quantity: number;
  unit?: string;
  /** Nettó egységár Ft (egész) */
  netUnitPrice: number;
  vatRate: SzamlazzVatCode;
  note?: string | null;
};

export type SzamlazzInvoiceInput = {
  agentKey: string;
  eszamla?: boolean;
  downloadPdf?: boolean;
  responseVersion?: 1 | 2;
  /** Előnézet PDF – nem hoz létre számlát (elonezetpdf) */
  previewOnly?: boolean;
  prefix?: string | null;
  paymentMethod?: string;
  currency?: string;
  language?: string;
  comment?: string | null;
  orderNumber?: string | null;
  externalId?: string | null;
  issueDate: string; // YYYY-MM-DD
  fulfillmentDate: string;
  dueDate: string;
  buyer: SzamlazzInvoiceBuyer;
  lines: SzamlazzInvoiceLine[];
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function boolXml(v: boolean): string {
  return v ? "true" : "false";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Százalékos ÁFA kódból szorzó; AAM/TAM stb. → 0 */
export function vatMultiplier(vatRate: string): number {
  const n = Number(vatRate);
  if (Number.isFinite(n) && n >= 0) return n / 100;
  return 0;
}

export function lineAmounts(line: SzamlazzInvoiceLine): {
  net: number;
  vat: number;
  gross: number;
} {
  const qty = line.quantity;
  const net = round2(line.netUnitPrice * qty);
  const vat = round2(net * vatMultiplier(line.vatRate));
  const gross = round2(net + vat);
  return { net, vat, gross };
}

export function buildSzamlazzInvoiceXml(input: SzamlazzInvoiceInput): string {
  if (!input.lines.length) {
    throw new Error("Legalább egy számlatétel kell");
  }
  const addr = parsePartnerAddress(input.buyer.address);
  const hasTax = !!(input.buyer.taxNumber && input.buyer.taxNumber.trim());
  const adoalany = hasTax ? 1 : -1;

  const tetelek = input.lines
    .map((line) => {
      const a = lineAmounts(line);
      return `  <tetel>
    <megnevezes>${escapeXml(line.name)}</megnevezes>
    <mennyiseg>${line.quantity}</mennyiseg>
    <mennyisegiEgyseg>${escapeXml(line.unit ?? "db")}</mennyisegiEgyseg>
    <nettoEgysegar>${line.netUnitPrice}</nettoEgysegar>
    <afakulcs>${escapeXml(line.vatRate)}</afakulcs>
    <nettoErtek>${a.net}</nettoErtek>
    <afaErtek>${a.vat}</afaErtek>
    <bruttoErtek>${a.gross}</bruttoErtek>
    <megjegyzes>${escapeXml(line.note ?? "")}</megjegyzes>
  </tetel>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamla https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd">
<beallitasok>
  <szamlaagentkulcs>${escapeXml(input.agentKey)}</szamlaagentkulcs>
  <eszamla>${boolXml(!!input.eszamla)}</eszamla>
  <szamlaLetoltes>${boolXml(input.downloadPdf !== false)}</szamlaLetoltes>
  <valaszVerzio>${input.responseVersion ?? 2}</valaszVerzio>
  <szamlaKulsoAzon>${escapeXml(input.externalId ?? "")}</szamlaKulsoAzon>
</beallitasok>
<fejlec>
  <keltDatum>${input.issueDate}</keltDatum>
  <teljesitesDatum>${input.fulfillmentDate}</teljesitesDatum>
  <fizetesiHataridoDatum>${input.dueDate}</fizetesiHataridoDatum>
  <fizmod>${escapeXml(input.paymentMethod ?? "Átutalás")}</fizmod>
  <penznem>${escapeXml(input.currency ?? "HUF")}</penznem>
  <szamlaNyelve>${escapeXml(input.language ?? "hu")}</szamlaNyelve>
  <megjegyzes>${escapeXml(input.comment ?? "")}</megjegyzes>
  <arfolyamBank></arfolyamBank>
  <arfolyam>0.0</arfolyam>
  <rendelesSzam>${escapeXml(input.orderNumber ?? "")}</rendelesSzam>
  <dijbekeroSzamlaszam></dijbekeroSzamlaszam>
  <elolegszamla>false</elolegszamla>
  <vegszamla>false</vegszamla>
  <helyesbitoszamla>false</helyesbitoszamla>
  <helyesbitettSzamlaszam></helyesbitettSzamlaszam>
  <dijbekero>false</dijbekero>
  <szamlaszamElotag>${escapeXml(input.prefix ?? "")}</szamlaszamElotag>
  <fizetve>false</fizetve>
  <elonezetpdf>${boolXml(!!input.previewOnly)}</elonezetpdf>
</fejlec>
<elado>
  <bank></bank>
  <bankszamlaszam></bankszamlaszam>
  <emailReplyto></emailReplyto>
  <emailTargy></emailTargy>
  <emailSzoveg></emailSzoveg>
  <alairoNeve></alairoNeve>
</elado>
<vevo>
  <nev>${escapeXml(input.buyer.name)}</nev>
  <orszag>Magyarország</orszag>
  <irsz>${escapeXml(addr.zip)}</irsz>
  <telepules>${escapeXml(addr.city)}</telepules>
  <cim>${escapeXml(addr.street)}</cim>
  <email>${escapeXml(input.buyer.email ?? "")}</email>
  <sendEmail>false</sendEmail>
  <adoalany>${adoalany}</adoalany>
  <adoszam>${escapeXml(input.buyer.taxNumber ?? "")}</adoszam>
  <telefonszam>${escapeXml(input.buyer.phone ?? "")}</telefonszam>
  <megjegyzes></megjegyzes>
</vevo>
<tetelek>
${tetelek}
</tetelek>
</xmlszamla>`;
}

export type SzamlazzAgentSuccess = {
  ok: true;
  invoiceNumber: string | null;
  netTotal: number | null;
  grossTotal: number | null;
  pdfBase64: string | null;
  raw: string;
};

export type SzamlazzAgentFailure = {
  ok: false;
  errorCode: string | null;
  errorMessage: string;
  raw: string;
};

export type SzamlazzAgentResult = SzamlazzAgentSuccess | SzamlazzAgentFailure;

export function parseSzamlazzXmlResponse(body: string): SzamlazzAgentResult {
  const text = body.trim();
  if (!text) {
    return { ok: false, errorCode: null, errorMessage: "Üres válasz a Számlázz.hu-tól", raw: body };
  }

  // valaszVerzio=1 szöveges
  if (text.startsWith("xmlagentresponse=")) {
    if (text.includes("DONE")) {
      const parts = text.split(";");
      return {
        ok: true,
        invoiceNumber: parts[1]?.trim() || null,
        netTotal: null,
        grossTotal: null,
        pdfBase64: null,
        raw: body,
      };
    }
    return {
      ok: false,
      errorCode: null,
      errorMessage: text.replace(/^\[ERR\]\s*/i, ""),
      raw: body,
    };
  }

  if (text.includes("[ERR]") || /^error/i.test(text)) {
    return {
      ok: false,
      errorCode: null,
      errorMessage: text.replace(/^\[ERR\]\s*/i, "").slice(0, 500),
      raw: body,
    };
  }

  const sikeres = /<sikeres>\s*(true|false)\s*<\/sikeres>/i.exec(text)?.[1];
  if (sikeres === "false") {
    return {
      ok: false,
      errorCode: /<hibakod>\s*([^<]*)\s*<\/hibakod>/i.exec(text)?.[1]?.trim() ?? null,
      errorMessage:
        /<hibauzenet>\s*([^<]*)\s*<\/hibauzenet>/i.exec(text)?.[1]?.trim() ||
        "Számlázz.hu hiba",
      raw: body,
    };
  }

  if (sikeres === "true" || /<szamlaszam>/i.test(text) || /<pdf>/i.test(text)) {
    const invoiceNumber = /<szamlaszam>\s*([^<]*)\s*<\/szamlaszam>/i.exec(text)?.[1]?.trim() || null;
    const net = /<szamlanetto>\s*([^<]*)\s*<\/szamlanetto>/i.exec(text)?.[1];
    const gross = /<szamlabrutto>\s*([^<]*)\s*<\/szamlabrutto>/i.exec(text)?.[1];
    const pdf = /<pdf>\s*([^<]*)\s*<\/pdf>/i.exec(text)?.[1]?.replace(/\s+/g, "") || null;
    return {
      ok: true,
      invoiceNumber,
      netTotal: net != null && net !== "" ? Number(net) : null,
      grossTotal: gross != null && gross !== "" ? Number(gross) : null,
      pdfBase64: pdf,
      raw: body,
    };
  }

  // PDF binary válasz (valaszVerzio=1 + szamlaLetoltes) – ritka; szövegként base64-nek tekintjük
  if (text.startsWith("%PDF") || text.includes("JVBERi0")) {
    return {
      ok: true,
      invoiceNumber: null,
      netTotal: null,
      grossTotal: null,
      pdfBase64: text.startsWith("%PDF") ? null : text,
      raw: body,
    };
  }

  return {
    ok: false,
    errorCode: null,
    errorMessage: `Ismeretlen Számlázz.hu válasz: ${text.slice(0, 200)}`,
    raw: body,
  };
}

/** Org tax settings → afakulcs */
export function resolveVatRate(opts: {
  regime: "vat_exempt" | "vat_registered";
  defaultRate: number;
}): SzamlazzVatCode {
  if (opts.regime === "vat_exempt") return "AAM";
  const r = opts.defaultRate;
  if (!Number.isFinite(r) || r <= 0) return "AAM";
  return String(Math.round(r));
}

export function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
