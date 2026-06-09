import { supabase } from "@/integrations/supabase/client";

type Circ = "siad" | "own";
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
 * Atomic find-or-create via SECURITY DEFINER RPC.
 * Prevents duplicate-barcode race conditions.
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

/** Atomic quick-exchange. Returns the new exchange id. */
export async function recordExchange(args: {
  partner_id: string;
  incoming_id: string;
  outgoing_id: string;
  reason?: string | null;
  note?: string | null;
  rental_id?: string | null;
  reassign_rental?: boolean;
}): Promise<string> {
  const rpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("record_exchange", {
    p_partner_id: args.partner_id,
    p_incoming_id: args.incoming_id,
    p_outgoing_id: args.outgoing_id,
    p_reason: args.reason ?? null,
    p_note: args.note ?? null,
    p_rental_id: args.rental_id ?? null,
    p_reassign_rental: !!args.reassign_rental,
  });
  if (error) throw error;
  return data as string;
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
