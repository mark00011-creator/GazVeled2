import { supabase } from "@/integrations/supabase/client";
import { statusLabels, type Circulation, type Manufacturer } from "@/lib/labels";
import {
  resolveInventoryLocation,
  validateInventoryEntry,
  type InventoryEntry,
} from "@/lib/inventory";
import {
  fetchProductPrices,
  lookupProductPrice,
  canonicalGasType,
  canonicalSize,
} from "@/lib/product-prices";
import { adjustChineseStock } from "@/lib/chinese-stock";
import { adjustFlagaPbStock } from "@/lib/flaga-pb-stock";
import { adjustPrimaPbStock } from "@/lib/prima-pb-stock";
import { formatSupabaseError } from "@/lib/supabase-error";

export type PartnerOperationType =
  | "exchange"
  | "sale"
  | "empty_return"
  | "chinese_sale"
  | "flaga_sale"
  | "flaga_pb_sale"
  | "prima_pb_sale";

type CylStatus = "full" | "empty" | "service";
type LocType = "warehouse_full" | "warehouse_empty" | "customer" | "siad" | "own_supplier";

export type CylinderRow = {
  id: string;
  barcode: string;
  gas_type: string;
  size: string;
  circulation: Circulation;
  owner: Circulation;
  manufacturer: Manufacturer;
  status: CylStatus;
  location_type: LocType;
  location_partner_id: string | null;
  location_supplier_id: string | null;
  rental_id?: string | null;
  last_movement_at: string | null;
  is_temporary: boolean;
  first_tracked_at: string | null;
  category?: string | null;
};

/** Normalize barcodes to match DB convention (lowercase, trimmed). */
export function normalizeBarcode(barcode: string): string {
  return barcode.trim().toLowerCase();
}

function parseDbError(message: string): string {
  if (message.includes("Missing cylinder")) return "Hiányzó palack az adatbázisban";
  if (message.includes("Missing partner")) return "Hiányzó partner";
  if (message.includes("Reason required")) return "Kényszerhelyettesítéshez indoklás kötelező";
  if (message.includes("invalid input value for enum"))
    return "Érvénytelen tulajdonos típus – használd: Saját, SIAD vagy Egyéb";
  return message;
}

/**
 * Find cylinder by barcode ONLY. Does not create.
 * Throws error if not found.
 */
export async function findCylinderByBarcode(barcode: string): Promise<CylinderRow> {
  const bc = normalizeBarcode(barcode);
  if (!bc) throw new Error("Üres vonalkód");

  const { data, error } = await supabase
    .from("cylinders")
    .select("*")
    .eq("barcode", bc)
    .eq("active", true)
    .maybeSingle();

  if (error) throw new Error(parseDbError(error.message));
  if (!data) throw new Error("Palack nem található az adatbázisban");
  return data as CylinderRow;
}

/** Find cylinder by barcode; returns null if not found. */
export async function tryFindCylinderByBarcode(barcode: string): Promise<CylinderRow | null> {
  const bc = normalizeBarcode(barcode);
  if (!bc) return null;

  const { data, error } = await supabase
    .from("cylinders")
    .select("*")
    .eq("barcode", bc)
    .eq("active", true)
    .maybeSingle();

  if (error) throw new Error(parseDbError(error.message));
  return data ? (data as CylinderRow) : null;
}

async function assertNotInActiveRental(cylinderId: string): Promise<void> {
  const { data: links, error } = await supabase
    .from("rental_cylinders")
    .select("rental_id")
    .eq("cylinder_id", cylinderId)
    .is("removed_at", null);
  if (error) throw new Error(parseDbError(error.message));
  if (!links?.length) return;

  const { data: rentals, error: rentErr } = await supabase
    .from("rentals")
    .select("status")
    .in(
      "id",
      links.map((l) => l.rental_id),
    );
  if (rentErr) throw new Error(parseDbError(rentErr.message));
  if (rentals?.some((r) => r.status === "active")) {
    throw new Error("A palack aktív bérletben van");
  }
}

/**
 * Create NEW cylinder with explicit data (no defaults).
 * User must provide: gas_type, size, circulation, owner
 */
export async function createNewCylinder(args: {
  barcode: string;
  gas_type: string;
  size: string;
  circulation: Circulation;
  owner: Circulation;
  manufacturer?: Manufacturer;
  status?: CylStatus;
  location_type?: LocType;
  location_partner_id?: string | null;
  location_supplier_id?: string | null;
  note?: string;
}): Promise<CylinderRow> {
  const bc = normalizeBarcode(args.barcode);
  if (!bc) throw new Error("Üres vonalkód");
  if (!args.gas_type?.trim()) throw new Error("Gáz típusa kötelező");
  if (!args.size?.trim()) throw new Error("Palack mérete kötelező");
  if (args.manufacturer === "chinese") {
    throw new Error("Kínai palackokat a Kínai készlet modulban kezeld, nem egyedi sorszámmal");
  }

  const manufacturer: Manufacturer =
    args.manufacturer ?? (args.circulation === "siad" ? "siad" : "other");

  const { data, error } = await supabase
    .from("cylinders")
    .insert({
      barcode: bc,
      gas_type: args.gas_type,
      size: args.size,
      circulation: args.circulation,
      owner: args.owner,
      manufacturer,
      status: args.status ?? "empty",
      location_type: args.location_type ?? "warehouse_empty",
      location_partner_id: args.location_partner_id ?? null,
      location_supplier_id: args.location_supplier_id ?? null,
      note: args.note ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(parseDbError(error.message));
  return data as CylinderRow;
}

/**
 * Atomic find-or-create via SECURITY DEFINER RPC.
 * @deprecated Use findCylinderByBarcode + createNewCylinder instead for better control
 */
export async function findOrCreateCylinder(
  barcode: string,
  defaults?: Partial<
    Pick<CylinderRow, "circulation" | "owner" | "status" | "location_type" | "gas_type" | "size">
  >,
): Promise<{ cyl: CylinderRow; created: boolean }> {
  const bc = normalizeBarcode(barcode);
  if (!bc) throw new Error("Üres vonalkód");
  const { data, error } = await supabase.rpc("find_or_create_cylinder", {
    p_barcode: bc,
    p_circulation: defaults?.circulation ?? "own",
    p_owner: defaults?.owner ?? defaults?.circulation ?? "own",
    p_status: defaults?.status ?? "empty",
    p_location_type: defaults?.location_type ?? "warehouse_empty",
    p_gas_type: defaults?.gas_type ?? "ISMERETLEN",
    p_size: defaults?.size ?? "—",
  });
  if (error) throw new Error(parseDbError(error.message));
  const arr = data as Array<{ cylinder: CylinderRow; created: boolean }> | null;
  const row = arr?.[0];
  if (!row) throw new Error("Nem sikerült létrehozni a palackot");
  return { cyl: row.cylinder, created: !!row.created };
}

export async function newTempBarcode(): Promise<string> {
  const { data, error } = await supabase.rpc("next_temp_barcode");
  if (error) throw error;
  return data as string;
}

/** Atomic partner exchange via RPC (movements, locations, rental reassignment). */
export async function recordExchange(args: {
  partner_id: string;
  incoming_id: string;
  outgoing_id: string;
  reason?: string | null;
  note?: string | null;
  rental_id?: string | null;
  reassign_rental?: boolean;
}): Promise<string> {
  const { data, error } = await supabase.rpc("record_exchange", {
    p_partner_id: args.partner_id,
    p_incoming_id: args.incoming_id,
    p_outgoing_id: args.outgoing_id,
    p_reason: args.reason ?? undefined,
    p_note: args.note ?? undefined,
    p_rental_id: args.rental_id ?? undefined,
    p_reassign_rental: args.reassign_rental ?? false,
  });

  if (error) throw new Error(parseDbError(error.message));
  if (!data) throw new Error("A csere rögzítése sikertelen");

  const exchangeId = data as string;
  await storeExchangeProfit(exchangeId, args.outgoing_id);
  await syncRentalCylindersAfterExchange(args);
  return exchangeId;
}

/** Eladás: csak kimenő teli palack (nincs bejövő). */
export async function recordSale(args: {
  partner_id: string;
  outgoing_id: string;
  note?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("record_partner_sale", {
    p_partner_id: args.partner_id,
    p_outgoing_id: args.outgoing_id,
    p_note: args.note ?? undefined,
  });

  if (error) throw new Error(parseDbError(error.message));
  if (!data) throw new Error("Az eladás rögzítése sikertelen");

  const exchangeId = data as string;
  await storeExchangeProfit(exchangeId, args.outgoing_id);
  return exchangeId;
}

/** Üres visszavétel: csak bejövő üres palack. */
export async function recordEmptyReturn(args: {
  partner_id: string;
  incoming_id: string;
  note?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("record_empty_return", {
    p_partner_id: args.partner_id,
    p_incoming_id: args.incoming_id,
    p_note: args.note ?? undefined,
  });

  if (error) throw new Error(parseDbError(error.message));
  if (!data) throw new Error("Az üres visszavétel rögzítése sikertelen");
  return data as string;
}

/** Kínai palack eladás (darabszám alapú) + számlázható exchange sor. */
export async function recordChineseSale(args: {
  partner_id: string;
  gas_type: string;
  size: string;
  quantity: number;
  note?: string | null;
}): Promise<string> {
  const gas_type = canonicalGasType(args.gas_type);
  const size = canonicalSize(gas_type, args.size);
  const quantity = Math.round(args.quantity);
  if (quantity <= 0) throw new Error("A mennyiségnek pozitívnak kell lennie");

  await adjustChineseStock({
    gas_type,
    size,
    movement_type: "sale",
    quantity,
    note: args.note?.trim() || `Eladás partnernek`,
  });

  const prices = await fetchProductPrices(true);
  const price = lookupProductPrice(gas_type, size, prices);
  if (!price) {
    throw new Error(`Nincs árlista bejegyzés: ${gas_type} ${size}`);
  }

  const beszerzesi_ar = price.beszerzesi_ar * quantity;
  const eladasi_ar = price.eladasi_ar * quantity;
  const profit = eladasi_ar - beszerzesi_ar;

  const { data: auth } = await supabase.auth.getUser();
  const detail = `${quantity}× ${gas_type} ${size}`;
  const { data, error } = await supabase
    .from("exchanges")
    .insert({
      partner_id: args.partner_id,
      incoming_cylinder_id: null,
      outgoing_cylinder_id: null,
      incoming_circulation: "own",
      outgoing_circulation: "own",
      is_forced_substitution: false,
      operation_type: "chinese_sale",
      note: [detail, args.note?.trim()].filter(Boolean).join(" · "),
      created_by: auth.user?.id ?? null,
      beszerzesi_ar,
      eladasi_ar,
      profit,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(formatSupabaseError(error, "Kínai eladás rögzítése"));
  }
  return data.id;
}

/** FLAGA PB palack eladás (darabszám alapú). */
export async function recordFlagaPbSale(args: {
  partner_id: string;
  gas_type: string;
  size: string;
  quantity: number;
  note?: string | null;
}): Promise<string> {
  const quantity = Math.round(args.quantity);
  if (quantity <= 0) throw new Error("A mennyiségnek pozitívnak kell lennie");

  await adjustFlagaPbStock({
    gas_type: args.gas_type,
    size: args.size,
    movement_type: "sale",
    quantity,
    note: args.note?.trim() || "Eladás partnernek",
  });

  const prices = await fetchProductPrices(true);
  const price = lookupProductPrice(args.gas_type, args.size, prices);
  if (!price) throw new Error(`Nincs árlista bejegyzés: ${args.gas_type} ${args.size}`);

  const beszerzesi_ar = price.beszerzesi_ar * quantity;
  const eladasi_ar = price.eladasi_ar * quantity;
  const profit = eladasi_ar - beszerzesi_ar;
  const { data: auth } = await supabase.auth.getUser();
  const detail = `${quantity}× ${args.size} ${args.gas_type}`;

  const { data, error } = await supabase
    .from("exchanges")
    .insert({
      partner_id: args.partner_id,
      incoming_cylinder_id: null,
      outgoing_cylinder_id: null,
      incoming_circulation: "own",
      outgoing_circulation: "own",
      is_forced_substitution: false,
      operation_type: "flaga_pb_sale",
      note: [detail, args.note?.trim()].filter(Boolean).join(" · "),
      created_by: auth.user?.id ?? null,
      beszerzesi_ar,
      eladasi_ar,
      profit,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(formatSupabaseError(error, "FLAGA PB eladás rögzítése"));
  return data.id;
}

/** PRÍMA PB palack eladás (darabszám alapú). */
export async function recordPrimaPbSale(args: {
  partner_id: string;
  gas_type: string;
  size: string;
  quantity: number;
  note?: string | null;
}): Promise<string> {
  const quantity = Math.round(args.quantity);
  if (quantity <= 0) throw new Error("A mennyiségnek pozitívnak kell lennie");

  await adjustPrimaPbStock({
    gas_type: args.gas_type,
    size: args.size,
    movement_type: "sale",
    quantity,
    note: args.note?.trim() || "Eladás partnernek",
  });

  const prices = await fetchProductPrices(true);
  const price = lookupProductPrice(args.gas_type, args.size, prices);
  if (!price) throw new Error(`Nincs árlista bejegyzés: ${args.gas_type} ${args.size}`);

  const beszerzesi_ar = price.beszerzesi_ar * quantity;
  const eladasi_ar = price.eladasi_ar * quantity;
  const profit = eladasi_ar - beszerzesi_ar;
  const { data: auth } = await supabase.auth.getUser();
  const detail = `${quantity}× ${args.size} ${args.gas_type}`;

  const { data, error } = await supabase
    .from("exchanges")
    .insert({
      partner_id: args.partner_id,
      incoming_cylinder_id: null,
      outgoing_cylinder_id: null,
      incoming_circulation: "own",
      outgoing_circulation: "own",
      is_forced_substitution: false,
      operation_type: "prima_pb_sale",
      note: [detail, args.note?.trim()].filter(Boolean).join(" · "),
      created_by: auth.user?.id ?? null,
      beszerzesi_ar,
      eladasi_ar,
      profit,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(formatSupabaseError(error, "PRÍMA PB eladás rögzítése"));
  return data.id;
}

async function storeExchangeProfit(exchangeId: string, outgoingId: string): Promise<void> {
  const { data: cyl, error: cylErr } = await supabase
    .from("cylinders")
    .select("gas_type, size")
    .eq("id", outgoingId)
    .single();
  if (cylErr || !cyl) {
    throw new Error(parseDbError(cylErr?.message ?? "Palack nem található a profit számításhoz"));
  }

  const prices = await fetchProductPrices(true);
  const price = lookupProductPrice(cyl.gas_type, cyl.size, prices);
  if (!price) {
    throw new Error(`Nincs árlista bejegyzés: ${cyl.gas_type} ${cyl.size}`);
  }

  const beszerzesi_ar = price.beszerzesi_ar;
  const eladasi_ar = price.eladasi_ar;
  const profit = eladasi_ar - beszerzesi_ar;

  const { error } = await supabase
    .from("exchanges")
    .update({ beszerzesi_ar, eladasi_ar, profit })
    .eq("id", exchangeId);

  if (error) throw new Error(parseDbError(error.message));
}

async function syncRentalCylindersAfterExchange(args: {
  partner_id: string;
  incoming_id: string;
  outgoing_id: string;
  rental_id?: string | null;
  reassign_rental?: boolean;
}): Promise<void> {
  const now = new Date().toISOString();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id ?? null;

  const { data: incoming, error: inCylErr } = await supabase
    .from("cylinders")
    .select("id, status, location_type, location_partner_id")
    .eq("id", args.incoming_id)
    .single();
  if (inCylErr || !incoming)
    throw new Error(parseDbError(inCylErr?.message ?? "Palack nem található"));

  const { data: inLinks, error: inErr } = await supabase
    .from("rental_cylinders")
    .select("rental_id")
    .eq("cylinder_id", args.incoming_id)
    .is("removed_at", null);
  if (inErr) throw new Error(parseDbError(inErr.message));

  for (const link of inLinks ?? []) {
    const { error } = await supabase
      .from("rental_cylinders")
      .update({ removed_at: now })
      .eq("rental_id", link.rental_id)
      .eq("cylinder_id", args.incoming_id);
    if (error) throw new Error(parseDbError(error.message));
  }

  const whLoc = incoming.status === "full" ? "warehouse_full" : "warehouse_empty";
  await recordMovement({
    cylinder_id: args.incoming_id,
    from_location: "customer",
    from_partner_id: args.partner_id,
    to_location: whLoc,
    status_after: incoming.status as CylStatus,
    note: args.reassign_rental ? "Bérpalack cserélve" : "Csere – beérkező palack telephelyre",
    user_id: uid,
  });

  await updateCylinder(args.incoming_id, {
    status: incoming.status as CylStatus,
    rental_id: null,
    location_type: whLoc,
    location_partner_id: null,
    location_supplier_id: null,
  });

  if (args.reassign_rental && args.rental_id) {
    const { data: oldLink } = await supabase
      .from("rental_cylinders")
      .select("expiry_date, rental_start_date, rental_end_date, rental_deposit")
      .eq("rental_id", args.rental_id)
      .eq("cylinder_id", args.incoming_id)
      .is("removed_at", null)
      .maybeSingle();

    const { error: rmErr } = await supabase
      .from("rental_cylinders")
      .update({ removed_at: now })
      .eq("cylinder_id", args.outgoing_id)
      .is("removed_at", null);
    if (rmErr) throw new Error(parseDbError(rmErr.message));

    const { error: insErr } = await supabase.from("rental_cylinders").insert({
      rental_id: args.rental_id,
      cylinder_id: args.outgoing_id,
      expiry_date: oldLink?.expiry_date ?? null,
      rental_start_date: oldLink?.rental_start_date ?? null,
      rental_end_date: oldLink?.rental_end_date ?? null,
      rental_deposit: oldLink?.rental_deposit ?? null,
    });
    if (insErr) throw new Error(parseDbError(insErr.message));

    await recordMovement({
      cylinder_id: args.outgoing_id,
      from_location: "warehouse_full",
      to_location: "customer",
      to_partner_id: args.partner_id,
      status_after: "full",
      note: "Bérpalack cserélve",
      user_id: uid,
    });

    await updateCylinder(args.outgoing_id, {
      status: "full",
      rental_id: args.rental_id,
      location_type: "customer",
      location_partner_id: args.partner_id,
      location_supplier_id: null,
    });

    await supabase.from("audit_log").insert({
      user_id: uid,
      action: "Bérpalack csere",
      entity_type: "rental",
      entity_id: args.rental_id,
      new_value: { incoming_id: args.incoming_id, outgoing_id: args.outgoing_id },
    });
  } else {
    await updateCylinder(args.outgoing_id, { status: "full", rental_id: null });
  }
}

const SUPPLIER_LOCATIONS: LocType[] = ["siad", "own_supplier"];

/** Resolve existing cylinder for empty handover to supplier (no create). */
export async function resolveCylinderForSupplierReturn(
  barcode: string,
  supplierId: string,
): Promise<CylinderRow> {
  const cyl = await findCylinderByBarcode(barcode);
  await assertNotInActiveRental(cyl.id);
  if (cyl.status !== "empty") {
    throw new Error(`A palack nem üres (${statusLabels[cyl.status] ?? cyl.status})`);
  }

  const { data: supplier, error } = await supabase
    .from("suppliers")
    .select("kind")
    .eq("id", supplierId)
    .single();
  if (error || !supplier) throw new Error("Beszállító nem található");

  const supplierLoc = supplier.kind as LocType;
  if (cyl.location_type === supplierLoc && cyl.location_supplier_id === supplierId) {
    throw new Error("A palack már ennél a beszállítónál van");
  }
  return cyl;
}

/** Resolve existing cylinder for full receive from supplier (no create). */
export async function resolveCylinderForSupplierReceive(
  barcode: string,
  supplierId: string,
): Promise<CylinderRow> {
  const cyl = await findCylinderByBarcode(barcode);
  await assertNotInActiveRental(cyl.id);
  if (
    cyl.location_type === "warehouse_full" &&
    cyl.location_supplier_id == null &&
    cyl.status === "full"
  ) {
    throw new Error("A palack már a telephelyen van (teli)");
  }
  if (SUPPLIER_LOCATIONS.includes(cyl.location_type) && cyl.location_supplier_id !== supplierId) {
    throw new Error("A palack más beszállítónál van");
  }
  return cyl;
}

/** Record supplier exchange: empty handover + optional full receive, with movements and audit trail. */
export async function submitSupplierExchange(args: {
  supplier_id: string;
  returned: CylinderRow[];
  received: CylinderRow[];
  note?: string | null;
}): Promise<string> {
  const { data: supplier, error: supErr } = await supabase
    .from("suppliers")
    .select("id, kind")
    .eq("id", args.supplier_id)
    .single();
  if (supErr || !supplier) throw new Error("Beszállító nem található");

  const supplierLoc = supplier.kind as LocType;
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id ?? null;

  const returnedIds: string[] = [];
  const receivedIds: string[] = [];

  for (const cyl of args.returned) {
    if (
      cyl.location_type === supplierLoc &&
      cyl.location_supplier_id === args.supplier_id &&
      cyl.status === "empty"
    ) {
      returnedIds.push(cyl.id);
      continue;
    }

    const { error: movErr } = await recordMovement({
      cylinder_id: cyl.id,
      from_location: cyl.location_type,
      from_partner_id: cyl.location_partner_id,
      from_supplier_id: cyl.location_supplier_id,
      to_location: supplierLoc,
      to_supplier_id: args.supplier_id,
      status_after: "empty",
      note: "Palack átadva beszállítónak",
      user_id: uid,
    });
    if (movErr) throw new Error(parseDbError(movErr.message));

    await updateCylinder(cyl.id, {
      location_type: supplierLoc,
      location_supplier_id: args.supplier_id,
      location_partner_id: null,
      status: "empty",
    });
    returnedIds.push(cyl.id);
  }

  for (const cyl of args.received) {
    if (
      cyl.location_type === "warehouse_full" &&
      cyl.location_supplier_id == null &&
      cyl.status === "full"
    ) {
      receivedIds.push(cyl.id);
      continue;
    }

    const fromLoc = SUPPLIER_LOCATIONS.includes(cyl.location_type)
      ? cyl.location_type
      : supplierLoc;
    const { error: movErr } = await recordMovement({
      cylinder_id: cyl.id,
      from_location: fromLoc,
      from_supplier_id: cyl.location_supplier_id ?? args.supplier_id,
      to_location: "warehouse_full",
      status_after: "full",
      note: "Palack átvéve beszállítótól",
      user_id: uid,
    });
    if (movErr) throw new Error(parseDbError(movErr.message));

    await updateCylinder(cyl.id, {
      location_type: "warehouse_full",
      location_supplier_id: null,
      location_partner_id: null,
      status: "full",
    });
    receivedIds.push(cyl.id);
  }

  const { data, error } = await supabase
    .from("supplier_exchanges")
    .insert({
      supplier_id: args.supplier_id,
      returned_cylinder_ids: returnedIds,
      received_cylinder_ids: receivedIds,
      note: args.note ?? null,
      created_by: uid,
    })
    .select("id")
    .single();

  if (error) throw new Error(parseDbError(error.message));
  return data.id;
}

/** Atomic rental close. */
export async function closeRental(args: {
  rental_id: string;
  returned_barcode: string | null;
  deposit_returned: boolean;
  status: "returned" | "closed" | "problematic";
  note?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("close_rental", {
    p_rental_id: args.rental_id,
    p_returned_barcode: args.returned_barcode ? normalizeBarcode(args.returned_barcode) : "",
    p_deposit_returned: args.deposit_returned,
    p_status: args.status,
    p_note: args.note ?? undefined,
  });
  if (error) throw new Error(parseDbError(error.message));
}

/** Atomic rental cylinder reassignment. */
export async function reassignRentalCylinder(args: {
  rental_id: string;
  new_cylinder_id: string;
  note?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("reassign_rental_cylinder", {
    p_rental_id: args.rental_id,
    p_new_cylinder_id: args.new_cylinder_id,
    p_note: args.note ?? undefined,
  });
  if (error) throw new Error(parseDbError(error.message));
}

/** Update cylinder. */
export async function updateCylinder(
  id: string,
  updates: Partial<
    Pick<
      CylinderRow,
      | "barcode"
      | "gas_type"
      | "size"
      | "circulation"
      | "owner"
      | "manufacturer"
      | "status"
      | "location_type"
      | "location_partner_id"
      | "location_supplier_id"
      | "rental_id"
      | "is_temporary"
    >
  >,
): Promise<CylinderRow> {
  const payload = { ...updates };
  if (payload.barcode) payload.barcode = normalizeBarcode(payload.barcode);
  if (payload.manufacturer === "chinese") {
    throw new Error("Kínai palackokat a Kínai készlet modulban kezeld, nem egyedi sorszámmal");
  }

  const { data, error } = await supabase
    .from("cylinders")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(parseDbError(error.message));
  return data as CylinderRow;
}

/** Update barcode on an existing cylinder only (no insert). */
export async function updateCylinderBarcode(id: string, newBarcode: string): Promise<CylinderRow> {
  const bc = normalizeBarcode(newBarcode);
  if (!bc) throw new Error("Üres vonalkód");

  const existing = await tryFindCylinderByBarcode(bc);
  if (existing && existing.id !== id) throw new Error("Ez a vonalkód már foglalt");

  return updateCylinder(id, { barcode: bc });
}

/** Update barcode on existing cylinder (e.g. temp → permanent). Does not create a new record. */
export async function finalizeCylinderBarcode(
  id: string,
  newBarcode: string,
): Promise<CylinderRow> {
  const bc = normalizeBarcode(newBarcode);
  if (!bc) throw new Error("Üres vonalkód");
  if (bc.startsWith("temp-") || bc.startsWith("TEMP-"))
    throw new Error("A végleges vonalkód nem lehet ideiglenes");

  const existing = await tryFindCylinderByBarcode(bc);
  if (existing && existing.id !== id) throw new Error("Ez a vonalkód már foglalt");

  return updateCylinder(id, { barcode: bc, is_temporary: false });
}

export type InventoryRegisterResult = {
  created: CylinderRow[];
  skipped: { barcode: string; reason: string }[];
};

/** Register cylinders from inventory (single or bulk). Skips existing barcodes. */
export async function registerInventoryCylinders(
  entries: InventoryEntry[],
): Promise<InventoryRegisterResult> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id ?? null;

  const normalized = entries
    .map((e) => ({ ...e, barcode: normalizeBarcode(e.barcode) }))
    .filter((e) => e.barcode);

  if (normalized.length === 0) {
    throw new Error("Nincs feldolgozható vonalkód");
  }

  for (const entry of normalized) {
    const err = validateInventoryEntry(entry);
    if (err) throw new Error(`${entry.barcode || "—"}: ${err}`);
  }

  const supplierIds = [
    ...new Set(
      normalized
        .filter((e) => e.place === "supplier" && e.supplier_id)
        .map((e) => e.supplier_id as string),
    ),
  ];
  const supplierKinds = new Map<string, LocType>();
  if (supplierIds.length > 0) {
    const { data: suppliers, error } = await supabase
      .from("suppliers")
      .select("id, kind")
      .in("id", supplierIds);
    if (error) throw new Error(parseDbError(error.message));
    for (const s of suppliers ?? []) {
      supplierKinds.set(s.id, s.kind as LocType);
    }
    for (const id of supplierIds) {
      if (!supplierKinds.has(id)) throw new Error("Beszállító nem található");
    }
  }

  const barcodes = normalized.map((e) => e.barcode);
  const { data: existing, error: existErr } = await supabase
    .from("cylinders")
    .select("barcode")
    .in("barcode", barcodes);
  if (existErr) throw new Error(parseDbError(existErr.message));

  const existingSet = new Set((existing ?? []).map((r) => r.barcode));
  const created: CylinderRow[] = [];
  const skipped: { barcode: string; reason: string }[] = [];
  const seenInBatch = new Set<string>();

  for (const entry of normalized) {
    if (existingSet.has(entry.barcode)) {
      skipped.push({ barcode: entry.barcode, reason: "Már létezik az adatbázisban" });
      continue;
    }
    if (seenInBatch.has(entry.barcode)) {
      skipped.push({ barcode: entry.barcode, reason: "Duplikált a listában" });
      continue;
    }
    seenInBatch.add(entry.barcode);

    const supplierKind =
      entry.place === "supplier" ? supplierKinds.get(entry.supplier_id as string) : undefined;
    const loc = resolveInventoryLocation(entry, supplierKind);

    const cyl = await createNewCylinder({
      barcode: entry.barcode,
      gas_type: entry.gas_type,
      size: entry.size,
      circulation: entry.owner,
      owner: entry.owner,
      status: entry.status,
      location_type: loc.location_type,
      location_partner_id: loc.location_partner_id,
      location_supplier_id: loc.location_supplier_id,
    });

    const { error: movErr } = await recordMovement({
      cylinder_id: cyl.id,
      from_location: null,
      to_location: loc.location_type,
      to_partner_id: loc.location_partner_id,
      to_supplier_id: loc.location_supplier_id,
      status_after: entry.status,
      note: "Leltár – palack felvéve",
      user_id: uid,
    });
    if (movErr) throw new Error(parseDbError(movErr.message));

    created.push(cyl);
    existingSet.add(entry.barcode);
  }

  return { created, skipped };
}

/** Legacy: kept for compatibility but new code should not need this. */
export async function recordMovement(args: {
  cylinder_id: string;
  from_location: LocType | null;
  from_partner_id?: string | null;
  from_supplier_id?: string | null;
  to_location: LocType;
  to_partner_id?: string | null;
  to_supplier_id?: string | null;
  status_after: CylStatus;
  note?: string;
  user_id: string | null;
}) {
  return supabase.from("movements").insert({
    cylinder_id: args.cylinder_id,
    from_location: args.from_location ?? undefined,
    from_partner_id: args.from_partner_id ?? null,
    from_supplier_id: args.from_supplier_id ?? null,
    to_location: args.to_location,
    to_partner_id: args.to_partner_id ?? null,
    to_supplier_id: args.to_supplier_id ?? null,
    status_after: args.status_after,
    note: args.note ?? null,
    created_by: args.user_id,
  });
}
