import { supabase } from "@/integrations/supabase/client";

import {

  findCylinderByBarcode,

  newTempBarcode,

  normalizeBarcode,

  recordMovement,

  updateCylinder,

  type CylinderRow,

} from "@/lib/cylinder-ops";

import { addYears, todayLocal } from "@/lib/date-utils";

import { addMonths } from "@/lib/rental-billing";
import type { Circulation } from "@/lib/labels";

import { summarizeRentalCylinders, type RentalType } from "@/lib/labels";

import {
  isMissingRentalCylinderColumnError,
  logSupabaseError,
  throwSupabaseError,
} from "@/lib/supabase-error";
import {
  assignQuantityItemsToRental,
  fetchRentalQuantityItems,
  returnRentalQuantityItems,
  type RentalQuantityInput,
} from "@/lib/rental-quantity-stock";



export type { RentalType };

export type RentalStatus = "active" | "expired" | "cancelled" | "closed";



const WAREHOUSE_LOCS = ["warehouse_full", "warehouse_empty"] as const;



function parseDbError(message: string): string {

  if (message.includes("duplicate key")) return "A palack már hozzá van rendelve ehhez a bérlethez";

  if (message.includes("first_invoice_date") || message.includes("next_invoice_date") || message.includes("billing_cycle_months")) {

    return `${message} (Hiányzó rentals oszlop – futtasd a rental_billing migrációt)`;

  }

  if (message.includes("rental_id")) {

    return `${message} (Hiányzó cylinders.rental_id oszlop – futtasd a rental_billing migrációt)`;

  }

  if (message.includes("rental_type") || message.includes("expiry_date")) {

    return `${message} (Hiányzó rental_type migráció – futtasd a rental_type migrációt)`;

  }

  return message;

}



export function rentalNumber(id: string): string {

  return `#${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

}



export function defaultExpiryDate(startDate: string): string {

  return addYears(startDate, 1);

}

export const RENTAL_DETAIL_SELECT =
  "id, partner_id, start_date, end_date, expiry_date, rental_type, monthly_fee, deposit, deposit_type, contract_number, status, next_invoice_date, first_invoice_date, billing_cycle_months, note, created_at, updated_at, current_cylinder_id, original_cylinder_id";

export const PARTNER_CONTRACT_SELECT =
  "id, name, phone, email, address, company_name, tax_number, contact_person, birth_place, birth_date, mother_name, id_number, address_card_number";

export type RentalPartnerDetail = {
  id: string;
  name: string;
  company_name: string | null;
  tax_number: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  contact_person: string | null;
  birth_place: string | null;
  birth_date: string | null;
  mother_name: string | null;
  id_number: string | null;
  address_card_number: string | null;
};

export type RentalWithPartner = {
  id: string;
  partner_id: string;
  start_date: string;
  end_date: string | null;
  expiry_date: string | null;
  rental_type: RentalType;
  monthly_fee: number;
  deposit: number;
  deposit_type: string | null;
  contract_number: string | null;
  status: string;
  next_invoice_date: string | null;
  first_invoice_date: string | null;
  billing_cycle_months: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  current_cylinder_id: string | null;
  original_cylinder_id: string | null;
  partners: RentalPartnerDetail | null;
};

/** Rentals + partner külön lekérdezéssel (PostgREST nested embed hibák elkerülésére). */
export async function fetchRentalWithPartner(rentalId: string): Promise<RentalWithPartner | null> {
  const { data: rental, error: rentalErr } = await supabase
    .from("rentals")
    .select(RENTAL_DETAIL_SELECT)
    .eq("id", rentalId)
    .maybeSingle();
  if (rentalErr) {
    throwSupabaseError("fetchRentalWithPartner → rentals SELECT", rentalErr, { rentalId });
  }
  if (!rental) return null;

  const { data: partner, error: partnerErr } = await supabase
    .from("partners")
    .select(PARTNER_CONTRACT_SELECT)
    .eq("id", rental.partner_id)
    .maybeSingle();
  if (partnerErr) {
    throwSupabaseError("fetchRentalWithPartner → partners SELECT", partnerErr, {
      rentalId,
      partnerId: rental.partner_id,
    });
  }

  return {
    ...rental,
    rental_type: (rental.rental_type ?? "yearly") as RentalType,
    partners: partner,
  };
}

/** Cylinder IDs in active rentals (not removed). */

export async function getActiveRentalCylinderIds(): Promise<Set<string>> {

  const { data: activeRentals, error: rentErr } = await supabase

    .from("rentals")

    .select("id")

    .eq("status", "active");



  if (rentErr) throwSupabaseError("getActiveRentalCylinderIds → rentals SELECT", rentErr);



  const rentalIds = (activeRentals ?? []).map((r) => r.id);

  if (rentalIds.length === 0) return new Set();



  const { data, error } = await supabase

    .from("rental_cylinders")

    .select("cylinder_id")

    .in("rental_id", rentalIds)

    .is("removed_at", null);



  if (error) throwSupabaseError("getActiveRentalCylinderIds → rental_cylinders SELECT", error);

  return new Set((data ?? []).map((r) => r.cylinder_id));

}



async function logRentalAudit(rentalId: string, action: string, newValue?: Record<string, unknown>): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  await supabase.from("audit_log").insert({
    user_id: auth.user?.id ?? null,
    action,
    entity_type: "rental",
    entity_id: rentalId,
    new_value: newValue ?? null,
  });
}

export function parseRentalCylinderSpecs(text: string): { gas_type: string; size: string }[] {
  const result: { gas_type: string; size: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const comma = trimmed.split(",").map((s) => s.trim());
    if (comma.length >= 2 && comma[0] && comma[1]) {
      result.push({ gas_type: comma[0], size: comma[1] });
      continue;
    }
    const space = trimmed.match(/^(.+?)\s+(\d[\d\s.,]*\s*(?:L|kg).*)$/i);
    if (space) result.push({ gas_type: space[1].trim(), size: space[2].trim() });
  }
  return result;
}

async function createTempRentalCylinder(gas_type: string, size: string): Promise<CylinderRow> {
  const barcode = await newTempBarcode();
  const { data, error } = await supabase
    .from("cylinders")
    .insert({
      barcode,
      gas_type,
      size,
      circulation: "berpalack" as Circulation,
      owner: "own" as Circulation,
      status: "full",
      location_type: "warehouse_full",
      is_temporary: true,
    })
    .select()
    .single();
  if (error) throwSupabaseError("createTempRentalCylinder → cylinders INSERT", error);
  if (!data) throw new Error("Ideiglenes palack létrehozása sikertelen");
  return data as CylinderRow;
}

export async function validateCylinderForRental(barcode: string): Promise<CylinderRow> {

  const cyl = await findCylinderByBarcode(barcode);

  if (!WAREHOUSE_LOCS.includes(cyl.location_type as (typeof WAREHOUSE_LOCS)[number])) {

    throw new Error(`${cyl.barcode}: nem telephelyi készletben van`);

  }

  const active = await getActiveRentalCylinderIds();

  if (active.has(cyl.id)) {

    throw new Error(`${cyl.barcode}: már aktív bérletben van`);

  }

  return cyl;

}



export type RentalCylinderDetail = {

  rental_id: string;

  cylinder_id: string;

  added_at: string;

  expiry_date: string | null;

  rental_start_date: string | null;

  rental_end_date: string | null;

  rental_deposit: number | null;

  barcode: string;

  gas_type: string;

  size: string;

  manufacturer: string;

  factory_serial: string | null;

  replacement_value: number;

  owner: string;

  circulation: string;

  status: string;

  pressure_test_year: number | null;

};

const RENTAL_CYLINDER_LINK_SELECT_FULL =
  "cylinder_id, added_at, expiry_date, rental_start_date, rental_end_date, rental_deposit, rental_id";
const RENTAL_CYLINDER_LINK_SELECT_LEGACY = "cylinder_id, added_at, expiry_date, rental_id";

type RentalCylinderLinkRow = {
  cylinder_id: string;
  added_at: string;
  expiry_date: string | null;
  rental_id: string;
  rental_start_date?: string | null;
  rental_end_date?: string | null;
  rental_deposit?: number | null;
};

async function insertRentalCylinderLinks(
  rows: Array<{
    rental_id: string;
    cylinder_id: string;
    expiry_date: string | null;
    rental_start_date?: string;
    rental_end_date?: string | null;
    rental_deposit?: number;
  }>,
  label: string,
): Promise<void> {
  const { error } = await supabase.from("rental_cylinders").insert(rows);
  if (!error) return;

  if (isMissingRentalCylinderColumnError(error)) {
    const legacyRows = rows.map(({ rental_id, cylinder_id, expiry_date }) => ({
      rental_id,
      cylinder_id,
      expiry_date,
    }));
    const { error: legacyErr } = await supabase.from("rental_cylinders").insert(legacyRows);
    if (legacyErr) throwSupabaseError(`${label} (legacy)`, legacyErr);
    return;
  }

  throwSupabaseError(label, error);
}

async function fetchRentalCylinderLinkRows(rentalId: string): Promise<RentalCylinderLinkRow[]> {
  const { data, error } = await supabase
    .from("rental_cylinders")
    .select(RENTAL_CYLINDER_LINK_SELECT_FULL)
    .eq("rental_id", rentalId)
    .is("removed_at", null)
    .order("added_at", { ascending: true });
  if (!error) return (data ?? []) as RentalCylinderLinkRow[];

  if (isMissingRentalCylinderColumnError(error)) {
    const { data: legacyData, error: legacyErr } = await supabase
      .from("rental_cylinders")
      .select(RENTAL_CYLINDER_LINK_SELECT_LEGACY)
      .eq("rental_id", rentalId)
      .is("removed_at", null)
      .order("added_at", { ascending: true });
    if (legacyErr) throwSupabaseError("fetchRentalCylinderLinkRows → rental_cylinders (legacy)", legacyErr);
    return (legacyData ?? []) as RentalCylinderLinkRow[];
  }

  throwSupabaseError("fetchRentalCylinderLinkRows → rental_cylinders", error);
}

/** Backfill rental_cylinders from cylinders.rental_id (legacy data). */
async function ensureRentalCylinderLinks(
  rentalId: string,
  defaults: {
    expiry_date: string | null;
    start_date: string;
    end_date: string | null;
    deposit: number;
  },
  legacyCylinderIds: string[],
): Promise<void> {
  const { data: existing, error } = await supabase
    .from("rental_cylinders")
    .select("cylinder_id")
    .eq("rental_id", rentalId)
    .is("removed_at", null);
  if (error) throwSupabaseError("ensureRentalCylinderLinks → rental_cylinders", error);

  const linked = new Set((existing ?? []).map((r) => r.cylinder_id));
  const toLink = [...new Set(legacyCylinderIds)].filter((id) => !linked.has(id));
  if (toLink.length === 0) return;

  const rows = toLink.map((cylinder_id) => ({
    rental_id: rentalId,
    cylinder_id,
    expiry_date: defaults.expiry_date,
    rental_start_date: defaults.start_date,
    rental_end_date: defaults.end_date,
    rental_deposit: defaults.deposit,
  }));
  await insertRentalCylinderLinks(rows, "ensureRentalCylinderLinks → rental_cylinders INSERT");
}

/** Collect cylinder IDs for a rental from all sources (links + cylinders.rental_id + legacy fields). */
async function collectRentalCylinderIds(
  rentalId: string,
  partnerId: string | null,
  legacyIds: (string | null)[],
): Promise<string[]> {
  const ids = new Set<string>();

  const { data: links, error: linkErr } = await supabase
    .from("rental_cylinders")
    .select("cylinder_id")
    .eq("rental_id", rentalId)
    .is("removed_at", null);
  if (linkErr) throwSupabaseError("collectRentalCylinderIds → rental_cylinders", linkErr);
  for (const l of links ?? []) ids.add(l.cylinder_id);

  const { data: byRentalId, error: cylErr } = await supabase
    .from("cylinders")
    .select("id")
    .eq("rental_id", rentalId)
    .eq("active", true);
  if (cylErr) throwSupabaseError("collectRentalCylinderIds → cylinders.rental_id", cylErr);
  for (const c of byRentalId ?? []) ids.add(c.id);

  if (partnerId) {
    const { data: atPartner, error: pErr } = await supabase
      .from("cylinders")
      .select("id")
      .eq("location_partner_id", partnerId)
      .eq("rental_id", rentalId)
      .eq("active", true);
    if (pErr) throwSupabaseError("collectRentalCylinderIds → cylinders at partner", pErr);
    for (const c of atPartner ?? []) ids.add(c.id);
  }

  for (const lid of legacyIds) {
    if (lid) ids.add(lid);
  }

  return [...ids];
}

/** Fetch rental cylinders without nested embed (avoids PostgREST join issues). */
export async function fetchRentalCylinderDetails(rentalId: string): Promise<RentalCylinderDetail[]> {
  const { data: rental, error: rentErr } = await supabase
    .from("rentals")
    .select("partner_id, start_date, end_date, deposit, expiry_date, current_cylinder_id, original_cylinder_id")
    .eq("id", rentalId)
    .single();
  if (rentErr) throwSupabaseError("fetchRentalCylinderDetails → rentals", rentErr);

  const defaultExpiry = rental.expiry_date ?? defaultExpiryDate(rental.start_date);
  const legacyIds = [rental.current_cylinder_id, rental.original_cylinder_id];

  const allIds = await collectRentalCylinderIds(rentalId, rental.partner_id, legacyIds);
  if (allIds.length === 0) return [];

  await ensureRentalCylinderLinks(
    rentalId,
    {
      expiry_date: defaultExpiry,
      start_date: rental.start_date,
      end_date: rental.end_date,
      deposit: Number(rental.deposit ?? 0),
    },
    allIds,
  );

  const links = await fetchRentalCylinderLinkRows(rentalId);
  const linkByCyl = new Map(links.map((l) => [l.cylinder_id, l]));

  const { data: cyls, error: cylErr } = await supabase
    .from("cylinders")
    .select("id, barcode, gas_type, size, manufacturer, factory_serial, replacement_value, owner, circulation, status, pressure_test_year")
    .in("id", allIds)
    .eq("active", true);
  if (cylErr) throwSupabaseError("fetchRentalCylinderDetails → cylinders", cylErr);

  return (cyls ?? [])
    .map((c) => {
      const link = linkByCyl.get(c.id);
      return {
        rental_id: rentalId,
        cylinder_id: c.id,
        added_at: link?.added_at ?? rental.start_date,
        expiry_date: link?.expiry_date ?? defaultExpiry,
        rental_start_date: link?.rental_start_date ?? rental.start_date,
        rental_end_date: link?.rental_end_date ?? rental.end_date,
        rental_deposit: link?.rental_deposit != null ? Number(link.rental_deposit) : Number(rental.deposit ?? 0),
        barcode: c.barcode,
        gas_type: c.gas_type,
        size: c.size,
        manufacturer: c.manufacturer,
        factory_serial: c.factory_serial,
        replacement_value: Number(c.replacement_value ?? 100_000),
        owner: c.owner,
        circulation: c.circulation,
        status: c.status,
        pressure_test_year: c.pressure_test_year ?? null,
      };
    })
    .sort((a, b) => a.barcode.localeCompare(b.barcode));
}



export async function findActiveRentalIdForCylinder(cylinderId: string): Promise<string | null> {

  const { data: links, error: linkErr } = await supabase

    .from("rental_cylinders")

    .select("rental_id")

    .eq("cylinder_id", cylinderId)

    .is("removed_at", null);

  if (linkErr) throwSupabaseError("findActiveRentalIdForCylinder → rental_cylinders", linkErr);

  if (!links?.length) return null;



  const { data: rentals, error: rentErr } = await supabase

    .from("rentals")

    .select("id")

    .in("id", links.map((l) => l.rental_id))

    .eq("status", "active");

  if (rentErr) throwSupabaseError("findActiveRentalIdForCylinder → rentals", rentErr);

  return rentals?.[0]?.id ?? null;

}



export async function fetchRentedCylinderIdsForPartner(partnerId: string): Promise<Set<string>> {

  const { data: rentals, error: rentErr } = await supabase

    .from("rentals")

    .select("id")

    .eq("partner_id", partnerId)

    .eq("status", "active");



  if (rentErr) throwSupabaseError("fetchRentedCylinderIdsForPartner → rentals", rentErr);



  const rentalIds = (rentals ?? []).map((r) => r.id);

  if (rentalIds.length === 0) return new Set();



  const ids = new Set<string>();

  const { data: links, error: linkErr } = await supabase
    .from("rental_cylinders")
    .select("cylinder_id")
    .in("rental_id", rentalIds)
    .is("removed_at", null);
  if (linkErr) throwSupabaseError("fetchRentedCylinderIdsForPartner → rental_cylinders", linkErr);
  for (const l of links ?? []) ids.add(l.cylinder_id);

  const { data: direct, error: directErr } = await supabase
    .from("cylinders")
    .select("id")
    .in("rental_id", rentalIds)
    .eq("active", true);
  if (directErr) throwSupabaseError("fetchRentedCylinderIdsForPartner → cylinders", directErr);
  for (const c of direct ?? []) ids.add(c.id);

  return ids;
}



/** Active rental cylinder summaries per partner id. */

export async function fetchPartnerRentalSummaries(): Promise<Record<string, string[]>> {

  const { data: rentals, error: rentErr } = await supabase

    .from("rentals")

    .select("id, partner_id")

    .eq("status", "active");

  if (rentErr) throw rentErr;



  const rentalIds = (rentals ?? []).map((r) => r.id);

  if (rentalIds.length === 0) return {};



  const partnerByRental = new Map((rentals ?? []).map((r) => [r.id, r.partner_id]));



  const { data: links, error: linkErr } = await supabase

    .from("rental_cylinders")

    .select("rental_id, cylinder_id")

    .in("rental_id", rentalIds)

    .is("removed_at", null);

  if (linkErr) throw linkErr;

  if (!links?.length) return {};



  const cylIds = [...new Set(links.map((l) => l.cylinder_id))];

  const { data: cyls, error: cylErr } = await supabase

    .from("cylinders")

    .select("id, gas_type, size")

    .in("id", cylIds);

  if (cylErr) throw cylErr;



  const cylMap = new Map((cyls ?? []).map((c) => [c.id, c]));

  const byPartner = new Map<string, { gas_type: string; size: string }[]>();



  for (const link of links) {

    const partnerId = partnerByRental.get(link.rental_id);

    const cyl = cylMap.get(link.cylinder_id);

    if (!partnerId || !cyl) continue;

    const list = byPartner.get(partnerId) ?? [];

    list.push({ gas_type: cyl.gas_type, size: cyl.size });

    byPartner.set(partnerId, list);

  }



  const result: Record<string, string[]> = {};

  for (const [pid, list] of byPartner) {

    result[pid] = summarizeRentalCylinders(list);

  }

  return result;

}



async function assignCylinderToRental(

  rentalId: string,

  partnerId: string,

  cyl: CylinderRow,

  userId: string | null,

  cylinderExpiryDate: string,

  rentalStartDate: string,

  rentalDeposit: number,

): Promise<void> {

  await insertRentalCylinderLinks(
    [
      {
        rental_id: rentalId,
        cylinder_id: cyl.id,
        expiry_date: cylinderExpiryDate,
        rental_start_date: rentalStartDate,
        rental_deposit: rentalDeposit,
      },
    ],
    "assignCylinderToRental → rental_cylinders INSERT",
  );



  try {

    await updateCylinder(cyl.id, {

      location_type: "customer",

      location_partner_id: partnerId,

      location_supplier_id: null,

      rental_id: rentalId,

      status: "full",

    });

  } catch (e) {

    logSupabaseError("assignCylinderToRental → cylinders UPDATE", null, { cylinderId: cyl.id, rentalId });

    throw new Error(parseDbError((e as Error).message));

  }



  const { error: movErr } = await recordMovement({

    cylinder_id: cyl.id,

    from_location: cyl.location_type,

    to_location: "customer",

    to_partner_id: partnerId,

    status_after: "full",

    note: "Bérletbe kiadva",

    user_id: userId,

  });

  if (movErr) throwSupabaseError("assignCylinderToRental → movements INSERT", movErr, { cylinderId: cyl.id });

}



export async function createRentalWithCylinders(args: {

  partner_id: string;

  start_date: string;

  expiry_date: string;

  rental_type: RentalType;

  first_invoice_date?: string | null;

  next_invoice_date?: string | null;

  billing_cycle_months?: number;

  monthly_fee: number;

  deposit: number;

  status: RentalStatus;

  note?: string | null;

  cylinder_barcodes: string[];
  cylinder_specs?: { gas_type: string; size: string }[];
  quantity_items?: RentalQuantityInput[];

}): Promise<string> {

  if (args.rental_type === "monthly" && args.monthly_fee <= 0) {

    throw new Error("Havi bérletnél a havi díj kötelező");

  }



  const barcodes = [...new Set(args.cylinder_barcodes.map(normalizeBarcode).filter(Boolean))];
  const specs = args.cylinder_specs ?? [];
  const quantityItems = args.quantity_items ?? [];

  if (barcodes.length === 0 && specs.length === 0 && quantityItems.length === 0) {
    throw new Error("Adj meg legalább egy palackot vagy darabszámú tételt");
  }

  const { data: auth } = await supabase.auth.getUser();

  const uid = auth.user?.id ?? null;



  const cylinders: CylinderRow[] = [];

  for (const bc of barcodes) {

    cylinders.push(await validateCylinderForRental(bc));

  }

  for (const spec of specs) {
    cylinders.push(await createTempRentalCylinder(spec.gas_type, spec.size));
  }



  const rentalPayload: Record<string, unknown> = {

    partner_id: args.partner_id,

    start_date: args.start_date,

    expiry_date: args.expiry_date,

    rental_type: args.rental_type,

    billing_cycle_months: args.billing_cycle_months ?? 1,

    monthly_fee: args.monthly_fee,

    deposit: args.deposit,

    status: args.status,

    note: args.note ?? null,

    current_cylinder_id: cylinders[0]?.id ?? null,

    original_cylinder_id: cylinders[0]?.id ?? null,

  };



  if (args.rental_type === "monthly") {

    rentalPayload.first_invoice_date = args.first_invoice_date ?? args.start_date;

    rentalPayload.next_invoice_date = args.next_invoice_date ?? args.first_invoice_date ?? args.start_date;

  } else {

    rentalPayload.first_invoice_date = null;

    rentalPayload.next_invoice_date = null;

  }

  const { data: contractNumber, error: cnErr } = await supabase.rpc("next_rental_contract_number", {
    p_start_date: args.start_date,
  });
  if (!cnErr && contractNumber) {
    rentalPayload.contract_number = contractNumber;
  }



  const { data: rental, error: rentErr } = await supabase

    .from("rentals")

    .insert(rentalPayload as never)

    .select("id")

    .single();



  if (rentErr) throwSupabaseError("createRentalWithCylinders → rentals INSERT", rentErr, { payload: rentalPayload });

  if (!rental) throw new Error("Bérlet létrehozása sikertelen: üres válasz");



  try {

    for (const cyl of cylinders) {

      await assignCylinderToRental(
        rental.id,
        args.partner_id,
        cyl,
        uid,
        args.expiry_date,
        args.start_date,
        args.deposit,
      );

    }

    if (quantityItems.length > 0) {
      await assignQuantityItemsToRental(rental.id, quantityItems);
    }

  } catch (e) {

    await supabase.from("rentals").delete().eq("id", rental.id);

    throw e;

  }



  return rental.id;

}



/** Egy palack bérletének meghosszabbítása +1 év – a palack a vevőnél marad. */
export async function extendRentalCylinder(rentalId: string, cylinderId: string): Promise<void> {
  const { data: link, error } = await supabase
    .from("rental_cylinders")
    .select("expiry_date, added_at")
    .eq("rental_id", rentalId)
    .eq("cylinder_id", cylinderId)
    .is("removed_at", null)
    .single();

  if (error || !link) throw new Error("Palack bérlete nem található");

  const base = link.expiry_date ?? link.added_at.slice(0, 10);
  const newExpiry = addYears(base, 1);

  const { error: updErr } = await supabase
    .from("rental_cylinders")
    .update({ expiry_date: newExpiry })
    .eq("rental_id", rentalId)
    .eq("cylinder_id", cylinderId);

  if (updErr) throw new Error(parseDbError(updErr.message));
  await logRentalAudit(rentalId, "Palack bérlet meghosszabbítva", { cylinder_id: cylinderId, expiry_date: newExpiry });
}

export type PartnerRentalOverview = {
  rental: {
    id: string;
    start_date: string;
    expiry_date: string | null;
    rental_type: RentalType | null;
    status: string;
    monthly_fee: number;
  };
  cylinders: RentalCylinderDetail[];
};

export async function fetchPartnerRentalOverview(partnerId: string): Promise<PartnerRentalOverview[]> {
  const { data: rentals, error: rentErr } = await supabase
    .from("rentals")
    .select("id, start_date, expiry_date, rental_type, status, monthly_fee")
    .eq("partner_id", partnerId)
    .in("status", ["active", "expired", "cancelled"])
    .order("start_date", { ascending: false });

  if (rentErr) throwSupabaseError("fetchPartnerRentalOverview → rentals", rentErr);

  const result: PartnerRentalOverview[] = [];
  for (const rental of rentals ?? []) {
    const cylinders = await fetchRentalCylinderDetails(rental.id);
    if (cylinders.length === 0) continue;
    result.push({
      rental: {
        id: rental.id,
        start_date: rental.start_date,
        expiry_date: rental.expiry_date,
        rental_type: (rental.rental_type ?? "yearly") as RentalType,
        status: rental.status,
        monthly_fee: Number(rental.monthly_fee),
      },
      cylinders,
    });
  }
  return result;
}

export async function extendRental(rentalId: string): Promise<void> {

  const { data: rental, error } = await supabase

    .from("rentals")

    .select("id, rental_type, expiry_date, start_date, next_invoice_date, status, partner_id")

    .eq("id", rentalId)

    .single();



  if (error || !rental) throw new Error("Bérlet nem található");

  if (rental.status === "closed") throw new Error("Lezárt bérlet nem hosszabbítható");



  const type = (rental.rental_type ?? "yearly") as RentalType;

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    status: "active",
  };

  const expiryBase = rental.expiry_date ?? rental.start_date ?? todayLocal();



  if (type === "yearly") {

    updates.expiry_date = addYears(expiryBase, 1);

    const invBase = rental.next_invoice_date ?? rental.start_date ?? todayLocal();

    updates.next_invoice_date = addYears(invBase, 1);

  } else if (type === "monthly") {

    updates.expiry_date = addMonths(expiryBase, 1);

    const invBase = rental.next_invoice_date ?? rental.start_date ?? todayLocal();

    updates.next_invoice_date = addMonths(invBase, 1);

  } else if (type === "free") {

    updates.expiry_date = addYears(expiryBase, 1);

  } else {

    throw new Error("Ismeretlen bérlet típus");

  }



  const { error: updErr } = await supabase.from("rentals").update(updates).eq("id", rentalId);

  if (updErr) throw new Error(parseDbError(updErr.message));

  if (updates.expiry_date) {
    const { error: rcErr } = await supabase
      .from("rental_cylinders")
      .update({ expiry_date: updates.expiry_date as string })
      .eq("rental_id", rentalId)
      .is("removed_at", null);
    if (rcErr) throw new Error(parseDbError(rcErr.message));
  }

  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id ?? null;
  const cyls = await fetchRentalCylinderDetails(rentalId);

  for (const c of cyls) {
    await recordMovement({
      cylinder_id: c.cylinder_id,
      from_location: "customer",
      from_partner_id: rental.partner_id,
      to_location: "customer",
      to_partner_id: rental.partner_id,
      status_after: c.status as "full" | "empty" | "service",
      note: "Bérlet hosszabbítva",
      user_id: uid,
    });
  }

  await logRentalAudit(rentalId, "Bérlet hosszabbítva", updates);

}



export async function returnRentalCylinders(args: {

  rental_id: string;

  cylinder_ids?: string[];

  note?: string | null;

}): Promise<void> {

  const { data: auth } = await supabase.auth.getUser();

  const uid = auth.user?.id ?? null;



  const { data: rental, error: rentErr } = await supabase

    .from("rentals")

    .select("id, partner_id, status, note")

    .eq("id", args.rental_id)

    .single();



  if (rentErr || !rental) throw new Error("Bérlet nem található");

  if (!["active", "expired", "cancelled"].includes(rental.status)) {

    throw new Error("A bérlet már lezárt");

  }



  const { data: links, error: linkErr } = await supabase

    .from("rental_cylinders")

    .select("cylinder_id")

    .eq("rental_id", args.rental_id)

    .is("removed_at", null);



  if (linkErr) throwSupabaseError("returnRentalCylinders → rental_cylinders", linkErr);



  let linkIds = (links ?? []).map((l) => l.cylinder_id);

  if (args.cylinder_ids?.length) {

    const idSet = new Set(args.cylinder_ids);

    linkIds = linkIds.filter((id) => idSet.has(id));

  }



  if (linkIds.length === 0) {
    const qtyItems = await fetchRentalQuantityItems(args.rental_id);
    if (qtyItems.length === 0) {
      throw new Error("Nincs visszavételezhető palack vagy darabszámú tétel");
    }
    await returnRentalQuantityItems(args.rental_id);
  } else {
    const { data: cylRows, error: cylErr } = await supabase
      .from("cylinders")
      .select("id, barcode, gas_type, size, status, location_type, location_partner_id")
      .in("id", linkIds);

    if (cylErr) throwSupabaseError("returnRentalCylinders → cylinders", cylErr);

    const now = new Date().toISOString();

    for (const cyl of (cylRows ?? []) as CylinderRow[]) {
      const whLoc = cyl.status === "full" ? "warehouse_full" : "warehouse_empty";

      const { error: movErr } = await recordMovement({
        cylinder_id: cyl.id,
        from_location: "customer",
        from_partner_id: rental.partner_id,
        to_location: whLoc,
        status_after: cyl.status,
        note: "Visszavéve bérletből",
        user_id: uid,
      });
      if (movErr) throw new Error(parseDbError(movErr.message));

      await updateCylinder(cyl.id, {
        location_type: whLoc,
        location_partner_id: null,
        location_supplier_id: null,
        rental_id: null,
      } as Parameters<typeof updateCylinder>[1]);

      const endDate = now.slice(0, 10);
      const { error: rcUpdErr } = await supabase
        .from("rental_cylinders")
        .update({ removed_at: now, rental_end_date: endDate })
        .eq("rental_id", args.rental_id)
        .eq("cylinder_id", cyl.id);
      if (rcUpdErr && isMissingRentalCylinderColumnError(rcUpdErr)) {
        const { error: legacyUpdErr } = await supabase
          .from("rental_cylinders")
          .update({ removed_at: now })
          .eq("rental_id", args.rental_id)
          .eq("cylinder_id", cyl.id);
        if (legacyUpdErr) {
          throwSupabaseError("returnRentalCylinders → rental_cylinders UPDATE (legacy)", legacyUpdErr);
        }
      } else if (rcUpdErr) {
        throwSupabaseError("returnRentalCylinders → rental_cylinders UPDATE", rcUpdErr);
      }
    }
  }

  const now = new Date().toISOString();

  const { count } = await supabase
    .from("rental_cylinders")
    .select("*", { count: "exact", head: true })
    .eq("rental_id", args.rental_id)
    .is("removed_at", null);

  const { count: qtyCount } = await supabase
    .from("rental_quantity_items")
    .select("*", { count: "exact", head: true })
    .eq("rental_id", args.rental_id)
    .is("removed_at", null);

  const updates: Record<string, unknown> = { updated_at: now };

  if ((count ?? 0) === 0 && (qtyCount ?? 0) > 0) {
    await returnRentalQuantityItems(args.rental_id);
  }

  if ((count ?? 0) === 0) {
    updates.status = "closed";
    updates.end_date = todayLocal();
  }

  if (args.note?.trim()) {

    const prev = rental.note?.trim();

    updates.note = prev ? `${prev} | Visszavétel: ${args.note.trim()}` : args.note.trim();

  }



  const { error: updErr } = await supabase.from("rentals").update(updates).eq("id", args.rental_id);

  if (updErr) throw new Error(parseDbError(updErr.message));

  if (updates.status === "closed") {
    await logRentalAudit(args.rental_id, "Bérlet lezárva", { end_date: updates.end_date });
  }

}



export async function advanceRentalBilling(rentalId: string): Promise<void> {

  const { data: rental, error } = await supabase

    .from("rentals")

    .select("next_invoice_date, billing_cycle_months, rental_type")

    .eq("id", rentalId)

    .single();



  if (error || !rental?.next_invoice_date) {

    throw new Error("Bérlet vagy következő számlázás nem található");

  }

  if (rental.rental_type === "free" || rental.rental_type === "yearly") {

    throw new Error("Ez a bérlet típus nem számlázható havi ciklussal");

  }



  const months = rental.billing_cycle_months ?? 1;

  const next = addMonths(rental.next_invoice_date, months);



  const { error: updErr } = await supabase

    .from("rentals")

    .update({ next_invoice_date: next })

    .eq("id", rentalId);



  if (updErr) throw new Error(parseDbError(updErr.message));

}


