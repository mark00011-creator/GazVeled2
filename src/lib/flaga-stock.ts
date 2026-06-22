import { supabase } from "@/integrations/supabase/client";
import { formatSupabaseError } from "@/lib/supabase-error";

export const FLAGA_GAS_TYPES = ["PB gáz", "Targonca gáz", "Bután gáz", "Kemping gáz"] as const;

export const FLAGA_SIZES: Record<(typeof FLAGA_GAS_TYPES)[number], string[]> = {
  "PB gáz": ["11 kg", "33 kg"],
  "Targonca gáz": ["5 kg", "10 kg", "18 kg"],
  "Bután gáz": ["11 kg", "33 kg"],
  "Kemping gáz": ["907 g"],
};

export function getFlagaSizes(gasType: string): string[] {
  return FLAGA_SIZES[gasType as (typeof FLAGA_GAS_TYPES)[number]] ?? ["11 kg"];
}

export function canonicalFlagaGasType(gas: string): string {
  const trimmed = gas.trim();
  const found = FLAGA_GAS_TYPES.find((g) => g.toLowerCase() === trimmed.toLowerCase());
  return found ?? trimmed;
}

export function canonicalFlagaSize(gasType: string, size: string): string {
  const trimmed = size.trim();
  const pool = getFlagaSizes(canonicalFlagaGasType(gasType));
  const found = pool.find((s) => s.toLowerCase() === trimmed.toLowerCase());
  return found ?? trimmed;
}

export type FlagaStockRow = {
  id: string;
  gas_type: string;
  size: string;
  full_count: number;
  empty_count: number;
  updated_at: string;
};

export type FlagaMovementType = "purchase" | "sale" | "exchange" | "empty_return" | "adjustment";

export const FLAGA_MOVEMENT_LABELS: Record<FlagaMovementType, string> = {
  purchase: "Beszerzés (teli +)",
  sale: "Eladás (teli −, nincs vissza)",
  exchange: "Csere (teli −, üres +)",
  empty_return: "Üres visszahozás (üres +)",
  adjustment: "Korrekció (teli +, megjegyzés kötelező)",
};

export async function fetchFlagaStock(): Promise<FlagaStockRow[]> {
  const { data, error } = await supabase
    .from("flaga_cylinder_stock")
    .select("*")
    .order("gas_type")
    .order("size");

  if (error) throw new Error(formatSupabaseError(error, "FLAGA készlet betöltése"));
  return (data ?? []) as FlagaStockRow[];
}

export async function adjustFlagaStock(args: {
  gas_type: string;
  size: string;
  movement_type: FlagaMovementType;
  quantity: number;
  note?: string;
}): Promise<string> {
  const gas_type = canonicalFlagaGasType(args.gas_type);
  const size = canonicalFlagaSize(gas_type, args.size);
  const quantity = Math.round(args.quantity);
  if (quantity <= 0) throw new Error("A mennyiségnek pozitívnak kell lennie");

  const { data, error } = await supabase.rpc("adjust_flaga_stock", {
    p_gas_type: gas_type,
    p_size: size,
    p_movement_type: args.movement_type,
    p_quantity: quantity,
    p_note: args.note?.trim() || undefined,
  });

  if (error) throw new Error(formatSupabaseError(error, "FLAGA készlet mozgatása"));
  if (!data) throw new Error("A mozgás rögzítése sikertelen");
  return data as string;
}

export function flagaStockLabel(gas_type: string, size: string): string {
  return `${gas_type} ${size}`;
}

export type FlagaEmptySummaryLine = {
  label: string;
  gas_type: string;
  size: string;
  empty_count: number;
};

export async function fetchFlagaEmptySummary(): Promise<FlagaEmptySummaryLine[]> {
  const rows = await fetchFlagaStock();
  return rows
    .filter((r) => r.empty_count > 0)
    .map((r) => ({
      label: flagaStockLabel(r.gas_type, r.size),
      gas_type: r.gas_type,
      size: r.size,
      empty_count: r.empty_count,
    }));
}
