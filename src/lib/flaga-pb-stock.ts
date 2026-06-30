import { supabase } from "@/integrations/supabase/client";
import { formatSupabaseError } from "@/lib/supabase-error";
import { isSchemaMissingError } from "@/lib/supabase-schema";

export const FLAGA_PB_CATALOG = [
  { gas_type: "Motorüzemű Flaga", size: "11 kg" },
  { gas_type: "Propán-Bután", size: "11,5 kg" },
  { gas_type: "Propán-Bután", size: "23 kg" },
  { gas_type: "Propán", size: "10,5 kg" },
  { gas_type: "Kompozit", size: "7,5 kg" },
] as const;

/** Gáz rendelés FLAGA oldal megjelenítési sorrendje. */
export const FLAGA_PB_DISPLAY_ORDER = [
  { gas_type: "Propán", size: "10,5 kg" },
  { gas_type: "Motorüzemű Flaga", size: "11 kg" },
  { gas_type: "Propán-Bután", size: "11,5 kg" },
  { gas_type: "Propán-Bután", size: "23 kg" },
  { gas_type: "Kompozit", size: "7,5 kg" },
] as const;

export type FlagaPbCatalogItem = (typeof FLAGA_PB_CATALOG)[number];

export function flagaPbProductKey(gas_type: string, size: string): string {
  return `${gas_type.trim()}|${size.trim()}`;
}

export function flagaPbStockLabel(gas_type: string, size: string): string {
  return `${size} ${gas_type}`;
}

export function canonicalFlagaPbItem(gas_type: string, size: string): FlagaPbCatalogItem {
  const key = flagaPbProductKey(gas_type, size);
  const found = FLAGA_PB_CATALOG.find((i) => flagaPbProductKey(i.gas_type, i.size) === key);
  if (!found) throw new Error(`Ismeretlen FLAGA PB tétel: ${gas_type} ${size}`);
  return found;
}

export type FlagaPbStockRow = {
  id: string;
  gas_type: string;
  size: string;
  full_count: number;
  empty_count: number;
  updated_at: string;
};

export type PbMovementType = "purchase" | "sale" | "exchange" | "empty_return" | "adjustment";

export const PB_MOVEMENT_LABELS: Record<PbMovementType, string> = {
  purchase: "Beszerzés (teli +)",
  sale: "Eladás (teli −)",
  exchange: "Csere (teli −, üres +)",
  empty_return: "Üres visszavétel (üres +)",
  adjustment: "Készletkorrekció (teli +, megjegyzés kötelező)",
};

export async function fetchFlagaPbStock(): Promise<FlagaPbStockRow[]> {
  const { data, error } = await supabase
    .from("flaga_pb_stock")
    .select("*")
    .order("gas_type")
    .order("size");
  if (error) {
    if (isSchemaMissingError(error)) return [];
    throw new Error(formatSupabaseError(error, "FLAGA PB készlet betöltése"));
  }
  return (data ?? []) as FlagaPbStockRow[];
}

export async function adjustFlagaPbStock(args: {
  gas_type: string;
  size: string;
  movement_type: PbMovementType;
  quantity: number;
  note?: string;
}): Promise<string> {
  const item = canonicalFlagaPbItem(args.gas_type, args.size);
  const quantity = Math.round(args.quantity);
  if (quantity <= 0) throw new Error("A mennyiségnek pozitívnak kell lennie");

  const { data, error } = await supabase.rpc("adjust_flaga_pb_stock", {
    p_gas_type: item.gas_type,
    p_size: item.size,
    p_movement_type: args.movement_type,
    p_quantity: quantity,
    p_note: args.note?.trim() || undefined,
  });
  if (error) throw new Error(formatSupabaseError(error, "FLAGA PB készlet mozgatása"));
  if (!data) throw new Error("A mozgás rögzítése sikertelen");
  return data as string;
}

export function sumFlagaPbCounts(rows: FlagaPbStockRow[]): { full: number; empty: number } {
  return rows.reduce(
    (acc, r) => ({ full: acc.full + r.full_count, empty: acc.empty + r.empty_count }),
    { full: 0, empty: 0 },
  );
}

export type FlagaPbCatalogStockLine = {
  gas_type: string;
  size: string;
  label: string;
  full_count: number;
  empty_count: number;
};

/** Minden katalógus tétel teli/üres darabszámmal (hiányzó sor → 0). */
export function buildFlagaPbCatalogStockLines(rows: FlagaPbStockRow[]): FlagaPbCatalogStockLine[] {
  const byKey = new Map(rows.map((r) => [flagaPbProductKey(r.gas_type, r.size), r]));
  return FLAGA_PB_DISPLAY_ORDER.map((item) => {
    const row = byKey.get(flagaPbProductKey(item.gas_type, item.size));
    return {
      gas_type: item.gas_type,
      size: item.size,
      label: flagaPbStockLabel(item.gas_type, item.size),
      full_count: row?.full_count ?? 0,
      empty_count: row?.empty_count ?? 0,
    };
  });
}
