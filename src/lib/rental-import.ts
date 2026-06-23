import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { newTempBarcode } from "@/lib/cylinder-ops";
import { formatDateOnly, parseDateOnly, todayLocal } from "@/lib/date-utils";
import type { RentalStatus } from "@/lib/rental-ops";
import { formatSupabaseError } from "@/lib/supabase-error";

export type BottleTypeKey =
  | "prima_motor_11kg"
  | "flaga_motor_11kg"
  | "flaga_propan_10_5kg"
  | "flaga_kompozit_7_5kg"
  | "pb_11_5kg"
  | "pb_23kg"
  | "kinai_stargon_20l";

export type BottleSpec = {
  key: BottleTypeKey;
  gas_type: string;
  size: string;
  manufacturer: "chinese" | "other";
};

export const BOTTLE_SPECS: Record<BottleTypeKey, BottleSpec> = {
  prima_motor_11kg: { key: "prima_motor_11kg", gas_type: "Motor", size: "11 kg", manufacturer: "other" },
  flaga_motor_11kg: {
    key: "flaga_motor_11kg",
    gas_type: "Motorüzemű Flaga",
    size: "11 kg",
    manufacturer: "other",
  },
  flaga_propan_10_5kg: {
    key: "flaga_propan_10_5kg",
    gas_type: "Propán",
    size: "10,5 kg",
    manufacturer: "other",
  },
  flaga_kompozit_7_5kg: {
    key: "flaga_kompozit_7_5kg",
    gas_type: "Kompozit",
    size: "7,5 kg",
    manufacturer: "other",
  },
  pb_11_5kg: { key: "pb_11_5kg", gas_type: "Propán-Bután", size: "11,5 kg", manufacturer: "other" },
  pb_23kg: { key: "pb_23kg", gas_type: "Propán-Bután", size: "23 kg", manufacturer: "other" },
  kinai_stargon_20l: {
    key: "kinai_stargon_20l",
    gas_type: "Stargon",
    size: "20 L",
    manufacturer: "chinese",
  },
};

export type RentalImportRowError = {
  row: number;
  partner?: string;
  message: string;
};

export type RentalImportCylinderPlan = {
  row: number;
  bottleType: BottleTypeKey;
  gas_type: string;
  size: string;
  expiry_date: string | null;
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
  rentalCount: number;
  cylinderCount: number;
  partnerCount: number;
  rentals: RentalImportRentalPlan[];
  errors: RentalImportRowError[];
  missingPartners: string[];
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

function stripVendorPrefix(value: string): string {
  return value
    .trim()
    .replace(/^(messer|linde)\s+/i, "")
    .trim();
}

export function mapBottleType(raw: string): BottleTypeKey | null {
  const stripped = stripVendorPrefix(raw);
  const n = normalizeText(stripped);

  if (!n) return null;

  if ((n.includes("kek") || n.includes("prima")) && n.includes("11") && n.includes("motor")) {
    return "prima_motor_11kg";
  }
  if (n.includes("flaga") && n.includes("11") && n.includes("motor")) {
    return "flaga_motor_11kg";
  }
  if (n.includes("propan") && (n.includes("10,5") || n.includes("10.5") || n.includes("10 5"))) {
    return "flaga_propan_10_5kg";
  }
  if (n.includes("flaga") && n.includes("7,5") && n.includes("kompozit")) {
    return "flaga_kompozit_7_5kg";
  }
  if (n.includes("7,5") && n.includes("kompozit")) {
    return "flaga_kompozit_7_5kg";
  }
  if (n.includes("11,5") && (n.includes("pb") || n.includes("propán-bután") || n.includes("propan-butan"))) {
    return "pb_11_5kg";
  }
  if (n.includes("23") && n.includes("kg") && (n.includes("pb") || n.includes("propán-bután") || n.includes("propan-butan"))) {
    return "pb_23kg";
  }
  if ((n.includes("kinai") || n.includes("chinese")) && n.includes("stargon") && n.includes("20")) {
    return "kinai_stargon_20l";
  }
  if (n.includes("stargon") && n.includes("20")) {
    return "kinai_stargon_20l";
  }

  return null;
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
} {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], errors: [{ row: 0, message: "Az Excel fájl üres" }] };
  }

  const sheet = workbook.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (json.length === 0) {
    return { rows: [], errors: [{ row: 0, message: "Nincs adatsor az Excelben" }] };
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
    };
  }

  const rows: ParsedRow[] = [];
  const errors: RentalImportRowError[] = [];

  json.forEach((record, index) => {
    const row = index + 2;
    const partnerName = String(record[columns.partner] ?? "").trim();
    const bottleTypeRaw = String(record[columns.bottle_type] ?? "").trim();

    if (!partnerName && !bottleTypeRaw) return;

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

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ row: 0, message: `Nem sikerült feldolgozni a fájlt: ${fileName}` });
  }

  return { rows, errors };
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
  fileName: string,
  parseErrors: RentalImportRowError[],
): RentalImportPreview {
  const errors = [...parseErrors];
  const missingPartners = new Set<string>();
  const grouped = new Map<string, ParsedRow[]>();

  for (const row of parsedRows) {
    const bottleKey = mapBottleType(row.bottleTypeRaw);
    if (!bottleKey) {
      errors.push({
        row: row.row,
        partner: row.partnerName,
        message: `Ismeretlen palack típus: „${row.bottleTypeRaw}”`,
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
      const bottleKey = mapBottleType(row.bottleTypeRaw);
      if (!bottleKey) continue;
      const spec = BOTTLE_SPECS[bottleKey];
      cylinders.push({
        row: row.row,
        bottleType: bottleKey,
        gas_type: spec.gas_type,
        size: spec.size,
        expiry_date: row.expiry_date ?? expiry_date,
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
    totalRows: parsedRows.length,
    validRows: cylinderCount,
    rentalCount: rentals.length,
    cylinderCount,
    partnerCount: rentals.length,
    rentals,
    errors,
    missingPartners: [...missingPartners].sort((a, b) => a.localeCompare(b, "hu")),
  };
}

export async function parseRentalImportFile(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<RentalImportPreview> {
  const { rows, errors } = parseWorkbookRows(buffer, fileName);
  const partnerIndex = await buildPartnerNameIndex();
  return buildRentalImportPreview(rows, partnerIndex, fileName, errors);
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
        const spec = BOTTLE_SPECS[cyl.bottleType];

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
            manufacturer: spec.manufacturer,
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
