import { supabase } from "@/integrations/supabase/client";
import { formatSupabaseError } from "@/lib/supabase-error";
import { isSchemaMissingError } from "@/lib/supabase-schema";
import { PB_MOVEMENT_LABELS, type PbMovementType } from "@/lib/flaga-pb-stock";

export const PRIMA_PB_CATALOG = [{ gas_type: "Motor", size: "12,5 kg" }] as const;

export type PrimaPbCatalogItem = (typeof PRIMA_PB_CATALOG)[number];

export function primaPbProductKey(gas_type: string, size: string): string {
  return `${gas_type.trim()}|${size.trim()}`;
}

export function primaPbStockLabel(gas_type: string, size: string): string {
  return `${size} ${gas_type}`;
}

export function canonicalPrimaPbItem(gas_type: string, size: string): PrimaPbCatalogItem {
  const key = primaPbProductKey(gas_type, size);
  const found = PRIMA_PB_CATALOG.find((i) => primaPbProductKey(i.gas_type, i.size) === key);
  if (!found) throw new Error(`Ismeretlen PRÍMA PB tétel: ${gas_type} ${size}`);
  return found;
}

export type PrimaPbStockRow = {
  id: string;
  gas_type: string;
  size: string;
  full_count: number;
  empty_count: number;
  updated_at: string;
};

export { PB_MOVEMENT_LABELS, type PbMovementType };

export async function fetchPrimaPbStock(): Promise<PrimaPbStockRow[]> {
  const { data, error } = await supabase
    .from("prima_pb_stock")
    .select("*")
    .order("gas_type")
    .order("size");
  if (error) {
    if (isSchemaMissingError(error)) return [];
    throw new Error(formatSupabaseError(error, "PRÍMA PB készlet betöltése"));
  }
  return (data ?? []) as PrimaPbStockRow[];
}

export async function adjustPrimaPbStock(args: {
  gas_type: string;
  size: string;
  movement_type: PbMovementType;
  quantity: number;
  note?: string;
}): Promise<string> {
  const item = canonicalPrimaPbItem(args.gas_type, args.size);
  const quantity = Math.round(args.quantity);
  if (quantity <= 0) throw new Error("A mennyiségnek pozitívnak kell lennie");

  const { data, error } = await supabase.rpc("adjust_prima_pb_stock", {
    p_gas_type: item.gas_type,
    p_size: item.size,
    p_movement_type: args.movement_type,
    p_quantity: quantity,
    p_note: args.note?.trim() || undefined,
  });
  if (error) throw new Error(formatSupabaseError(error, "PRÍMA PB készlet mozgatása"));
  if (!data) throw new Error("A mozgás rögzítése sikertelen");
  return data as string;
}

export function sumPrimaPbCounts(rows: PrimaPbStockRow[]): { full: number; empty: number } {
  return rows.reduce(
    (acc, r) => ({ full: acc.full + r.full_count, empty: acc.empty + r.empty_count }),
    { full: 0, empty: 0 },
  );
}
