import { supabase } from "@/integrations/supabase/client";

type Circ = "siad" | "own" | "other";
type CylStatus = "full" | "empty" | "service";
type LocType = "warehouse_full" | "warehouse_empty" | "customer" | "siad" | "own_supplier";

export type CylinderRow = {
  id: string;
  barcode: string;
  gas_type: string;
  size: string;
  circulation: Circ;
  owner: Circ;
  status: CylStatus;
  location_type: LocType;
  location_partner_id: string | null;
  location_supplier_id: string | null;
  last_movement_at: string | null;
  is_temporary: boolean;
  first_tracked_at: string | null;
  category?: string | null;
};

/**
 * Find cylinder by barcode ONLY. Does not create.
 * Throws error if not found.
 */
export async function findCylinderByBarcode(barcode: string): Promise<CylinderRow> {
  const bc = barcode.trim();
  if (!bc) throw new Error("Üres vonalkód");
  
  const { data, error } = await supabase
    .from("cylinders")
    .select("*")
    .eq("barcode", bc)
    .single();
  
  if (error) throw new Error("Palack nem található az adatbázisban");
  return data;
}

/**
 * Create NEW cylinder with explicit data (no defaults).
 * User must provide: gas_type, size, circulation, owner
 */
export async function createNewCylinder(args: {
  barcode: string;
  gas_type: string;
  size: string;
  circulation: Circ;
  owner: Circ;
  status?: CylStatus;
  location_type?: LocType;
  location_partner_id?: string | null;
  location_supplier_id?: string | null;
  note?: string;
}): Promise<CylinderRow> {
  const bc = args.barcode.trim();
  if (!bc) throw new Error("Üres vonalkód");
  if (!args.gas_type?.trim()) throw new Error("Gáz típusa kötelező");
  if (!args.size?.trim()) throw new Error("Palack mérete kötelező");

  const { data, error } = await supabase
    .from("cylinders")
    .insert({
      barcode: bc,
      gas_type: args.gas_type,
      size: args.size,
      circulation: args.circulation,
      owner: args.owner,
      status: args.status ?? "empty",
      location_type: args.location_type ?? "warehouse_empty",
      location_partner_id: args.location_partner_id ?? null,
      location_supplier_id: args.location_supplier_id ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Atomic find-or-create via SECURITY DEFINER RPC.
 * Prevents duplicate-barcode race conditions.
 * @deprecated Use findCylinderByBarcode + createNewCylinder instead for better control
 */
export async function findOrCreateCylinder(
  barcode: string,
  defaults?: Partial<Pick<CylinderRow, "circulation" | "owner" | "status" | "location_type" | "gas_type" | "size">>,
): Promise<{ cyl: CylinderRow; created: boolean }> {
  const bc = barcode.trim();
  if (!bc) throw new Error("Üres vonalkód");
  const { data, error } = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(
    "find_or_create_cylinder",
    {
      p_barcode: bc,
      p_circulation: defaults?.circulation ?? "own",
      p_owner: defaults?.owner ?? defaults?.circulation ?? null,
      p_status: defaults?.status ?? "empty",
      p_location_type: defaults?.location_type ?? "warehouse_empty",
      p_gas_type: defaults?.gas_type ?? "ISMERETLEN",
      p_size: defaults?.size ?? "—",
    },
  );
  if (error) throw error;
  const arr = data as Array<{ cylinder: CylinderRow; created: boolean }> | { cylinder: CylinderRow; created: boolean } | null;
  const row = Array.isArray(arr) ? arr[0] : arr;
  if (!row) throw new Error("Nem sikerült létrehozni a palackot");
  return { cyl: row.cylinder, created: !!row.created };
}

export async function newTempBarcode(): Promise<string> {
  const { data, error } = await supabase.rpc("next_temp_barcode");
  if (error) throw error;
  return data as string;
}

/** Record quick-exchange directly to database. Returns the new exchange id. */
export async function recordExchange(args: {
  partner_id: string;
  incoming_id: string;
  outgoing_id: string;
  reason?: string | null;
  note?: string | null;
  rental_id?: string | null;
  reassign_rental?: boolean;
}): Promise<string> {
  const { data, error } = await supabase
    .from("exchanges")
    .insert({
      partner_id: args.partner_id,
      incoming_cylinder_id: args.incoming_id,
      outgoing_cylinder_id: args.outgoing_id,
      reason: args.reason ?? null,
      note: args.note ?? null,
      rental_id: args.rental_id ?? null,
      reassign_rental: args.reassign_rental ?? false,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

/** Atomic supplier exchange. */
export async function recordSupplierExchange(args: {
  supplier_id: string;
  returned_barcodes: string[];
  received_barcodes: string[];
  note?: string | null;
}): Promise<string> {
  const rpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("record_supplier_exchange", {
    p_supplier_id: args.supplier_id,
    p_returned_barcodes: args.returned_barcodes,
    p_received_barcodes: args.received_barcodes,
    p_note: args.note ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** Atomic rental close. */
export async function closeRental(args: {
  rental_id: string;
  returned_barcode: string | null;
  deposit_returned: boolean;
  status: "returned" | "closed" | "problematic";
  note?: string | null;
}): Promise<void> {
  const rpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { error } = await rpc("close_rental", {
    p_rental_id: args.rental_id,
    p_returned_barcode: args.returned_barcode,
    p_deposit_returned: args.deposit_returned,
    p_status: args.status,
    p_note: args.note ?? null,
  });
  if (error) throw error;
}

/** Atomic rental cylinder reassignment. */
export async function reassignRentalCylinder(args: {
  rental_id: string;
  new_cylinder_id: string;
  note?: string | null;
}): Promise<void> {
  const rpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { error } = await rpc("reassign_rental_cylinder", {
    p_rental_id: args.rental_id,
    p_new_cylinder_id: args.new_cylinder_id,
    p_note: args.note ?? null,
  });
  if (error) throw error;
}

/** Update cylinder. */
export async function updateCylinder(
  id: string,
  updates: Partial<Pick<CylinderRow, "barcode" | "gas_type" | "size" | "circulation" | "owner" | "status" | "location_type" | "location_partner_id" | "location_supplier_id">>,
): Promise<CylinderRow> {
  const { data, error } = await supabase
    .from("cylinders")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
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
