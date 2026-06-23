import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { newTempBarcode } from "@/lib/cylinder-ops";
import { formatDateOnly, parseDateOnly, todayLocal } from "@/lib/date-utils";
import { normalizeGasType, normalizeSize, priceKey } from "@/lib/gas-order-prices";
import type { RentalStatus } from "@/lib/rental-ops";
import { formatSupabaseError } from "@/lib/supabase-error";

export type CylinderManufacturer = Database["public"]["Enums"]["cylinder_manufacturer"];

export type CylinderTypeCatalogEntry = {
  gas_type: string;
  size: string;
  manufacturer: CylinderManufacturer;
};

export type RentalImportRowError = {
  row: number;
  partner?: string;
  message: string;
};

export type RentalImportCylinderPlan = {
  row: number;
  gas_type: string;
  size: string;
  manufacturer: CylinderManufacturer;
  expiry_date: string | null;
  rawLabel: string;
};

export type RentalImportRentalPlan = {
  partnerName: string;
  partner_id: string | null;
  start_date: string;
  end_date: string | null;
  expiry_date: string | null;
  deposit: number;
  status: RentalStatus;
  cylinders: RentalImportCylinderPlan[];
};

export type RentalImportPreview = {
  fileName: string;
  totalRows: number;
  validRows: number;
  skippedRows: number;
  rentalCount: number;
  cylinderCount: number;
  partnerCount: number;
  catalogSize: number;
  rentals: RentalImportRentalPlan[];
  errors: RentalImportRowError[];
  missingPartners: string[];
  skippedPartners: string[];
};

export type RentalImportResult = {
  partnersImported: number;
  rentalsCreated: number;
  cylindersCreated: number;
  rentalCylindersCreated: number;
  missingPartners: string[];
  errors: string[];
};

type ParsedRow = {
  row: number;
  partnerName: string;
  start_date: string | null;
  end_date: string | null;
  expiry_date: string | null;
  deposit: number;
  bottleTypeRaw: string;
};

type ColumnMap = {
  partner: string;
  start_date: string;
  end_date: string;
  expiry_date: string;
  deposit: string;
  bottle_type: string;
};

const EXCLUDED_PARTNER_KEYS = new Set(["dreska andras"]);

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizePartnerName(value: string): string {
  return normalizeText(value);
}

export function isExcludedImportPartner(partnerName: string): boolean {
  return EXCLUDED_PARTNER_KEYS.has(normalizePartnerName(partnerName));
}

function stripVendorPrefix(value: string): string {
  return value
    .trim()
    .replace(/^(messer|linde)\s+/i, "")
    .trim();
}

function stripImportLabelPrefixes(raw: string): { text: string; preferChinese: boolean } {
  let text = raw.trim();
  let preferChinese = false;

  if (/^(kinai|chinese|kínai)\s+/i.test(text)) {
    preferChinese = true;
    text = text.replace(/^(kínai|kinai|chinese)\s+/i, "").trim();
  }

  text = stripVendorPrefix(text);
  return { text, preferChinese };
}

function sizeTokens(size: string): string[] {
  const norm = normalizeSize(size);
  const tokens = new Set([norm, normalizeText(norm)]);
  if (norm.includes(",")) tokens.add(normalizeText(norm.replace(",", ".")));
  if (norm.includes(".")) tokens.add(normalizeText(norm.replace(".", ",")));
  return [...tokens];
}

function gasTokens(gas_type: string): string[] {
  const norm = normalizeText(gas_type);
  const viaAlias = normalizeGasType(gas_type);
  const tokens = new Set([norm, normalizeText(viaAlias)]);
  for (const word of norm.split(" ").filter((w) => w.length > 2)) {
    tokens.add(word);
  }
  return [...tokens];
}

function textContainsSize(text: string, size: string): boolean {
  const normText = normalizeText(text);
  return sizeTokens(size).some((token) => token.length > 0 && normText.includes(token));
}

function textMatchesGas(text: string, gas_type: string): boolean {
  const normText = normalizeText(text);
  const full = normalizeText(gas_type);
  if (full.length > 0 && normText.includes(full)) return true;

  const words = gasTokens(gas_type).filter((w) => w.length > 2);
  if (words.length === 0) return false;
  const matched = words.filter((w) => normText.includes(w));
  const unmatched = words.filter((w) => !normText.includes(w));
  if (matched.length === 0) return false;
  if (unmatched.length === 0) return true;
  return matched.length >= Math.min(words.length, Math.max(1, words.length - 1));
}

function catalogMatchScore(normText: string, entry: CylinderTypeCatalogEntry): number {
  if (!textContainsSize(normText, entry.size)) return 0;

  const gasNorm = normalizeText(entry.gas_type);
  if (gasNorm.length > 0 && normText.includes(gasNorm)) {
    return 200 + gasNorm.length;
  }

  const words = gasTokens(entry.gas_type).filter((w) => w.length > 2);
  if (words.length === 0) return 0;

  const matched = words.filter((w) => normText.includes(w));
  const unmatched = words.filter((w) => !normText.includes(w));
  if (matched.length === 0) return 0;

  let score = 40 + matched.length * 15 - unmatched.length * 45;
  if (unmatched.some((w) => /\d/.test(w))) score -= 60;
  return score;
}

function findCatalogEntry(
  catalog: CylinderTypeCatalogEntry[],
  gas_type: string,
  size: string,
): CylinderTypeCatalogEntry | null {
  const key = priceKey(gas_type, size);
  return catalog.find((c) => priceKey(c.gas_type, c.size) === key) ?? null;
}

/** Excel rövidítések → katalógus-bejegyzés (a katalógus továbbra is DB-ből jön). */
function resolvePbLabelHints(
  normText: string,
  catalog: CylinderTypeCatalogEntry[],
): CylinderTypeCatalogEntry | null {
  if ((normText.includes("kek") || normText.includes("prima")) && normText.includes("motor")) {
    return (
      findCatalogEntry(catalog, "Motor", "12,5 kg") ??
      catalog.find((c) => normalizeText(c.gas_type) === "motor") ??
      null
    );
  }

  if (normText.includes("flaga") && normText.includes("motor") && normText.includes("11")) {
    return findCatalogEntry(catalog, "Motorüzemű Flaga", "11 kg");
  }

  if (normText.includes("propan") && (normText.includes("10,5") || normText.includes("10.5"))) {
    return findCatalogEntry(catalog, "Propán", "10,5 kg");
  }

  if (normText.includes("kompozit") && (normText.includes("7,5") || normText.includes("7.5"))) {
    return findCatalogEntry(catalog, "Kompozit", "7,5 kg");
  }

  if (
    (normText.includes("11,5") || normText.includes("11.5")) &&
    (normText.includes("pb") ||
      normText.includes("propan-butan") ||
      normText.includes("propán-bután"))
  ) {
    return findCatalogEntry(catalog, "Propán-Bután", "11,5 kg");
  }

  if (
    normText.includes("23") &&
    normText.includes("kg") &&
    (normText.includes("pb") ||
      normText.includes("propan-butan") ||
      normText.includes("propán-bután"))
  ) {
    return findCatalogEntry(catalog, "Propán-Bután", "23 kg");
  }

  if (normText.includes("pb") || normText.includes("flaga pb") || normText.includes("prima pb")) {
    const sizeInText = normText.match(/(\d+(?:[.,]\d+)?)\s*kg/);
    if (sizeInText) {
      const normSize = normalizeSize(`${sizeInText[1]} kg`);
      const pbCandidates = catalog.filter(
        (c) =>
          normalizeSize(c.size) === normSize &&
          (normalizeText(c.gas_type).includes("propan") ||
            normalizeText(c.gas_type) === "motor" ||
            normalizeText(c.gas_type).includes("kompozit") ||
            normalizeText(c.gas_type).includes("flaga")),
      );
      if (pbCandidates.length === 1) return pbCandidates[0] ?? null;
      if (normText.includes("motor") || normText.includes("flaga")) {
        return (
          pbCandidates.find((c) => normalizeText(c.gas_type).includes("flaga")) ??
          pbCandidates.find((c) => normalizeText(c.gas_type) === "motor") ??
          null
        );
      }
    }
  }

  return null;
}

function pickCatalogEntry(
  candidates: CylinderTypeCatalogEntry[],
  preferChinese: boolean,
): CylinderTypeCatalogEntry | null {
  if (candidates.length === 0) return null;
  if (preferChinese) {
    const chinese = candidates.find((c) => c.manufacturer === "chinese");
    if (chinese) return chinese;
  }
  return [...candidates].sort((a, b) => b.gas_type.length - a.gas_type.length)[0] ?? null;
}

export function resolveBottleType(
  raw: string,
  catalog: CylinderTypeCatalogEntry[],
): CylinderTypeCatalogEntry | null {
  const { text, preferChinese } = stripImportLabelPrefixes(raw);
  if (!text) return null;

  const normText = normalizeText(text);
  const catalogByKey = new Map(catalog.map((c) => [priceKey(c.gas_type, c.size), c]));

  const pbHint = resolvePbLabelHints(normText, catalog);
  if (pbHint) return pbHint;

  const gasSizeMatch = text.match(/^(.+?)\s+(\d+(?:[.,]\d+)?\s*(?:kg|l))$/i);
  if (gasSizeMatch) {
    const direct = catalogByKey.get(priceKey(gasSizeMatch[1].trim(), gasSizeMatch[2].trim()));
    if (direct) return direct;
  }

  const sizeGasMatch = text.match(/^(\d+(?:[.,]\d+)?\s*(?:kg|l))\s+(.+)$/i);
  if (sizeGasMatch) {
    const direct = catalogByKey.get(priceKey(sizeGasMatch[2].trim(), sizeGasMatch[1].trim()));
    if (direct) return direct;
  }

  const scored = catalog
    .map((entry) => ({ entry, score: catalogMatchScore(normText, entry) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    const topScore = scored[0]!.score;
    const topCandidates = scored.filter((row) => row.score >= topScore - 5).map((row) => row.entry);
    return pickCatalogEntry(topCandidates, preferChinese);
  }

  const sizeInText = text.match(/(\d+(?:[.,]\d+)?\s*(?:kg|l))/i);
  if (sizeInText) {
    const normSize = normalizeSize(sizeInText[1]);
    const sizeCandidates = catalog.filter((c) => normalizeSize(c.size) === normSize);
    const gasMatched = sizeCandidates.filter((c) => textMatchesGas(text, c.gas_type));
    const picked = pickCatalogEntry(gasMatched, preferChinese);
    if (picked) return picked;
  }

  return null;
}

export async function buildCylinderTypeCatalog(): Promise<CylinderTypeCatalogEntry[]> {
  const { data, error } = await supabase
    .from("cylinders")
    .select("gas_type, size, manufacturer")
    .eq("active", true);

  if (error) {
    throw new Error(formatSupabaseError(error, "Palacktípus katalógus betöltése"));
  }

  const { data: priceData, error: priceError } = await supabase
    .from("product_prices")
    .select("gas_type, size")
    .eq("active", true);

  if (priceError) {
    throw new Error(formatSupabaseError(priceError, "Árlista palacktípusok betöltése"));
  }

  const map = new Map<string, CylinderTypeCatalogEntry>();

  for (const row of data ?? []) {
    const key = priceKey(row.gas_type, row.size);
    if (!map.has(key)) {
      map.set(key, {
        gas_type: row.gas_type,
        size: row.size,
        manufacturer: row.manufacturer,
      });
    }
  }

  for (const row of priceData ?? []) {
    const key = priceKey(row.gas_type, row.size);
    if (!map.has(key)) {
      map.set(key, {
        gas_type: row.gas_type,
        size: row.size,
        manufacturer: "other",
      });
    }
  }

  return [...map.values()].sort((a, b) => {
    const byGas = a.gas_type.localeCompare(b.gas_type, "hu");
    return byGas !== 0 ? byGas : a.size.localeCompare(b.size, "hu");
  });
}

function parseExcelDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateOnly(value);
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const d = new Date(parsed.y, parsed.m - 1, parsed.d);
    return formatDateOnly(d);
  }
  const text = String(value).trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    return formatDateOnly(new Date(y, m - 1, d));
  }

  const hu = text.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (hu) {
    const d = Number(hu[1]);
    const m = Number(hu[2]);
    const y = Number(hu[3]);
    return formatDateOnly(new Date(y, m - 1, d));
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return formatDateOnly(parsed);
  return null;
}

function parseDeposit(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Math.max(0, Math.round(value));
  const cleaned = String(value).replace(/\s/g, "").replace(/ft|huf/gi, "").replace(",", ".");
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.max(0, Math.round(num)) : 0;
}

function findColumnKey(headers: string[], aliases: string[]): string | null {
  for (const header of headers) {
    const norm = normalizeText(header);
    if (aliases.includes(norm)) return header;
  }
  return null;
}

function detectColumns(headers: string[]): ColumnMap | null {
  const partner = findColumnKey(headers, [
    "partner",
    "partnernev",
    "partner neve",
    "nev",
    "ugyfel",
    "ceg",
    "vallalat",
    "ugyfel neve",
  ]);
  const start_date = findColumnKey(headers, [
    "kezdet",
    "berlet kezdete",
    "indulas",
    "start",
    "start date",
    "berlet kezdo",
  ]);
  const expiry_date = findColumnKey(headers, [
    "lejarat",
    "lejarati datum",
    "expiry",
    "lejarati ido",
    "ervenyesseg",
  ]);
  const end_date = findColumnKey(headers, ["vege", "veg", "berlet vege", "end date", "befejezes"]);
  const deposit = findColumnKey(headers, ["kaucio", "kaucio osszeg", "deposit", "kaucio osszege"]);
  const bottle_type = findColumnKey(headers, [
    "palack",
    "tipus",
    "palack tipus",
    "gaz",
    "gaztipus",
    "gaz tipus",
    "meret",
    "palacktipus",
    "termek",
  ]);

  if (!partner || !bottle_type) return null;

  return {
    partner,
    start_date: start_date ?? "",
    end_date: end_date ?? "",
    expiry_date: expiry_date ?? "",
    deposit: deposit ?? "",
    bottle_type,
  };
}

function rentalStatusFromExpiry(expiry_date: string | null): RentalStatus {
  if (!expiry_date) return "active";
  const today = parseDateOnly(todayLocal());
  const expiry = parseDateOnly(expiry_date);
  return expiry < today ? "expired" : "active";
}

function parseWorkbookRows(buffer: ArrayBuffer, fileName: string): {
  rows: ParsedRow[];
  errors: RentalImportRowError[];
  skippedRows: number;
  skippedPartners: Set<string>;
} {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const skippedPartners = new Set<string>();
  let skippedRows = 0;

  if (!sheetName) {
    return { rows: [], errors: [{ row: 0, message: "Az Excel fájl üres" }], skippedRows: 0, skippedPartners };
  }

  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (json.length === 0) {
    return { rows: [], errors: [{ row: 0, message: "Nincs adatsor az Excelben" }], skippedRows: 0, skippedPartners };
  }

  const headers = Object.keys(json[0] ?? {});
  const columns = detectColumns(headers);
  if (!columns) {
    return {
      rows: [],
      errors: [
        {
          row: 0,
          message: `Nem található partner vagy palack típus oszlop. Fejlécek: ${headers.join(", ")}`,
        },
      ],
      skippedRows: 0,
      skippedPartners,
    };
  }

  const rows: ParsedRow[] = [];
  const errors: RentalImportRowError[] = [];

  json.forEach((record, index) => {
    const row = index + 2;
    const partnerName = String(record[columns.partner] ?? "").trim();
    const bottleTypeRaw = String(record[columns.bottle_type] ?? "").trim();

    if (!partnerName && !bottleTypeRaw) return;

    if (isExcludedImportPartner(partnerName)) {
      skippedRows += 1;
      skippedPartners.add(partnerName);
      return;
    }

    if (!partnerName) {
      errors.push({ row, message: "Hiányzó partnernév" });
      return;
    }
    if (!bottleTypeRaw) {
      errors.push({ row, partner: partnerName, message: "Hiányzó palack típus" });
      return;
    }

    rows.push({
      row,
      partnerName,
      start_date: columns.start_date ? parseExcelDate(record[columns.start_date]) : null,
      end_date: columns.end_date ? parseExcelDate(record[columns.end_date]) : null,
      expiry_date: columns.expiry_date ? parseExcelDate(record[columns.expiry_date]) : null,
      deposit: columns.deposit ? parseDeposit(record[columns.deposit]) : 0,
      bottleTypeRaw,
    });
  });

  if (rows.length === 0 && errors.length === 0 && skippedRows === 0) {
    errors.push({ row: 0, message: `Nem sikerült feldolgozni a fájlt: ${fileName}` });
  }

  return { rows, errors, skippedRows, skippedPartners };
}

export async function buildPartnerNameIndex(): Promise<Map<string, { id: string; name: string }>> {
  const { data, error } = await supabase.from("partners").select("id,name");
  if (error) throw new Error(formatSupabaseError(error, "Partnerek betöltése"));

  const index = new Map<string, { id: string; name: string }>();
  for (const p of data ?? []) {
    const key = normalizePartnerName(p.name);
    if (!index.has(key)) index.set(key, { id: p.id, name: p.name });
  }
  return index;
}

export function buildRentalImportPreview(
  parsedRows: ParsedRow[],
  partnerIndex: Map<string, { id: string; name: string }>,
  catalog: CylinderTypeCatalogEntry[],
  fileName: string,
  parseErrors: RentalImportRowError[],
  skippedRows = 0,
  skippedPartners: string[] = [],
): RentalImportPreview {
  const errors = [...parseErrors];
  const missingPartners = new Set<string>();
  const grouped = new Map<string, ParsedRow[]>();

  if (catalog.length === 0) {
    errors.push({
      row: 0,
        message:
        "Nincs ismert palacktípus a cylinders táblában – előbb legyenek rögzített palackok",
    });
  }

  for (const row of parsedRows) {
    const spec = resolveBottleType(row.bottleTypeRaw, catalog);
    if (!spec) {
      errors.push({
        row: row.row,
        partner: row.partnerName,
        message: `Ismeretlen palack típus: „${row.bottleTypeRaw}” (nincs egyező gas_type + size a cylinders / árlista alapján)`,
      });
      continue;
    }

    const partnerKey = normalizePartnerName(row.partnerName);
    const partner = partnerIndex.get(partnerKey);
    if (!partner) {
      missingPartners.add(row.partnerName);
      errors.push({
        row: row.row,
        partner: row.partnerName,
        message: `Partner nem található: „${row.partnerName}”`,
      });
      continue;
    }

    const list = grouped.get(partnerKey) ?? [];
    list.push(row);
    grouped.set(partnerKey, list);
  }

  const rentals: RentalImportRentalPlan[] = [];

  for (const [partnerKey, partnerRows] of grouped) {
    const partner = partnerIndex.get(partnerKey)!;
    const startDates = partnerRows.map((r) => r.start_date).filter(Boolean) as string[];
    const expiryDates = partnerRows.map((r) => r.expiry_date).filter(Boolean) as string[];
    const endDates = partnerRows.map((r) => r.end_date).filter(Boolean) as string[];

    const start_date = startDates.sort()[0] ?? todayLocal();
    const expiry_date = expiryDates.sort().at(-1) ?? null;
    const end_date = endDates.sort().at(-1) ?? null;
    const deposit = partnerRows.find((r) => r.deposit > 0)?.deposit ?? partnerRows[0]?.deposit ?? 0;

    const cylinders: RentalImportCylinderPlan[] = [];
    for (const row of partnerRows) {
      const spec = resolveBottleType(row.bottleTypeRaw, catalog);
      if (!spec) continue;
      const { preferChinese } = stripImportLabelPrefixes(row.bottleTypeRaw);
      cylinders.push({
        row: row.row,
        gas_type: spec.gas_type,
        size: spec.size,
        manufacturer: preferChinese ? "chinese" : spec.manufacturer,
        expiry_date: row.expiry_date ?? expiry_date,
        rawLabel: row.bottleTypeRaw,
      });
    }

    rentals.push({
      partnerName: partner.name,
      partner_id: partner.id,
      start_date,
      end_date,
      expiry_date,
      deposit,
      status: rentalStatusFromExpiry(expiry_date),
      cylinders,
    });
  }

  rentals.sort((a, b) => a.partnerName.localeCompare(b.partnerName, "hu"));

  const cylinderCount = rentals.reduce((sum, r) => sum + r.cylinders.length, 0);

  return {
    fileName,
    totalRows: parsedRows.length + skippedRows,
    validRows: cylinderCount,
    skippedRows,
    rentalCount: rentals.length,
    cylinderCount,
    partnerCount: rentals.length,
    catalogSize: catalog.length,
    rentals,
    errors,
    missingPartners: [...missingPartners].sort((a, b) => a.localeCompare(b, "hu")),
    skippedPartners: [...skippedPartners].sort((a, b) => a.localeCompare(b, "hu")),
  };
}

export async function parseRentalImportFile(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<RentalImportPreview> {
  const { rows, errors, skippedRows, skippedPartners } = parseWorkbookRows(buffer, fileName);
  const [partnerIndex, catalog] = await Promise.all([
    buildPartnerNameIndex(),
    buildCylinderTypeCatalog(),
  ]);
  return buildRentalImportPreview(
    rows,
    partnerIndex,
    catalog,
    fileName,
    errors,
    skippedRows,
    [...skippedPartners],
  );
}

export async function executeRentalImport(preview: RentalImportPreview): Promise<RentalImportResult> {
  const result: RentalImportResult = {
    partnersImported: 0,
    rentalsCreated: 0,
    cylindersCreated: 0,
    rentalCylindersCreated: 0,
    missingPartners: preview.missingPartners,
    errors: [],
  };

  if (preview.rentalCount === 0) {
    result.errors.push("Nincs importálható bérlet az előnézetben");
    return result;
  }

  const importable = preview.rentals.filter((r) => r.partner_id && r.cylinders.length > 0);
  if (importable.length === 0) {
    result.errors.push("Minden sor hibás – nincs importálható adat");
    return result;
  }

  for (const plan of importable) {
    try {
      const { data: rental, error: rentalErr } = await supabase
        .from("rentals")
        .insert({
          partner_id: plan.partner_id!,
          start_date: plan.start_date,
          end_date: plan.end_date,
          expiry_date: plan.expiry_date,
          deposit: plan.deposit,
          status: plan.status,
          rental_type: "yearly",
          monthly_fee: 0,
          billing_cycle_months: 12,
          note: "Bérleti migráció import (Palack bérlések.xlsx)",
        })
        .select("id")
        .single();

      if (rentalErr || !rental) {
        throw new Error(formatSupabaseError(rentalErr, `Bérlet létrehozása: ${plan.partnerName}`));
      }

      result.rentalsCreated += 1;
      result.partnersImported += 1;

      let firstCylinderId: string | null = null;

      for (const cyl of plan.cylinders) {
        const barcode = await newTempBarcode();

        const { data: cylinder, error: cylErr } = await supabase
          .from("cylinders")
          .insert({
            barcode,
            factory_serial: barcode,
            gas_type: cyl.gas_type,
            size: cyl.size,
            circulation: "berpalack",
            owner: "own",
            status: "full",
            location_type: "customer",
            location_partner_id: plan.partner_id,
            rental_id: rental.id,
            is_temporary: true,
            manufacturer: cyl.manufacturer,
            replacement_value: 0,
            active: true,
            note: "Bérleti migráció import",
          })
          .select("id")
          .single();

        if (cylErr || !cylinder) {
          throw new Error(formatSupabaseError(cylErr, `Palack létrehozása: ${plan.partnerName}`));
        }

        result.cylindersCreated += 1;
        if (!firstCylinderId) firstCylinderId = cylinder.id;

        const { error: linkErr } = await supabase.from("rental_cylinders").insert({
          rental_id: rental.id,
          cylinder_id: cylinder.id,
          expiry_date: cyl.expiry_date,
          added_at: `${plan.start_date}T12:00:00.000Z`,
        });

        if (linkErr) {
          throw new Error(formatSupabaseError(linkErr, `Bérlet–palack kapcsolat: ${plan.partnerName}`));
        }

        result.rentalCylindersCreated += 1;
      }

      if (firstCylinderId) {
        await supabase
          .from("rentals")
          .update({ current_cylinder_id: firstCylinderId, original_cylinder_id: firstCylinderId })
          .eq("id", rental.id);
      }
    } catch (e) {
      result.errors.push((e as Error).message);
    }
  }

  return result;
}
