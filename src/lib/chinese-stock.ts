import { supabase } from "@/integrations/supabase/client";
import { canonicalGasType, canonicalSize } from "@/lib/product-prices";
import { formatSupabaseError } from "@/lib/supabase-error";

export type ChineseStockRow = {
  id: string;
  gas_type: string;
  size: string;
  full_count: number;
  empty_count: number;
  updated_at: string;
};

export type ChineseMovementType = "purchase" | "sale" | "exchange" | "empty_return";

export const CHINESE_MOVEMENT_LABELS: Record<ChineseMovementType, string> = {
  purchase: "Beszerzés (teli +)",
  sale: "Eladás (teli −, nincs vissza)",
  exchange: "Csere (teli −, üres +)",
  empty_return: "Üres visszahozás (üres +)",
};

export async function fetchChineseStock(): Promise<ChineseStockRow[]> {
  const { data, error } = await supabase
    .from("chinese_cylinder_stock")
    .select("*")
    .order("gas_type")
    .order("size");

  if (error) throw new Error(formatSupabaseError(error, "Kínai készlet betöltése"));
  return (data ?? []) as ChineseStockRow[];
}

export async function adjustChineseStock(args: {
  gas_type: string;
  size: string;
  movement_type: ChineseMovementType;
  quantity: number;
  note?: string;
}): Promise<string> {
  const gas_type = canonicalGasType(args.gas_type);
  const size = canonicalSize(gas_type, args.size);
  const quantity = Math.round(args.quantity);
  if (quantity <= 0) throw new Error("A mennyiségnek pozitívnak kell lennie");

  const { data, error } = await supabase.rpc("adjust_chinese_stock", {
    p_gas_type: gas_type,
    p_size: size,
    p_movement_type: args.movement_type,
    p_quantity: quantity,
    p_note: args.note?.trim() || undefined,
  });

  if (error) throw new Error(formatSupabaseError(error, "Kínai készlet mozgatása"));
  if (!data) throw new Error("A mozgás rögzítése sikertelen");
  return data as string;
}

export function chineseStockLabel(gas_type: string, size: string): string {
  return `${gas_type} ${size}`;
}

export type ChineseEmptySummaryLine = {
  label: string;
  gas_type: string;
  size: string;
  empty_count: number;
};

export async function fetchChineseEmptySummary(): Promise<ChineseEmptySummaryLine[]> {
  const rows = await fetchChineseStock();
  return rows
    .filter((r) => r.empty_count > 0)
    .map((r) => ({
      label: chineseStockLabel(r.gas_type, r.size),
      gas_type: r.gas_type,
      size: r.size,
      empty_count: r.empty_count,
    }));
}
