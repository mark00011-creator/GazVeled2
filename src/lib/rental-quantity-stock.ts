import { supabase } from "@/integrations/supabase/client";
import { adjustChineseStock, fetchChineseStock } from "@/lib/chinese-stock";
import { canonicalGasType, canonicalSize } from "@/lib/product-prices";
import { adjustFlagaPbStock, canonicalFlagaPbItem, fetchFlagaPbStock } from "@/lib/flaga-pb-stock";
import { adjustPrimaPbStock, canonicalPrimaPbItem, fetchPrimaPbStock } from "@/lib/prima-pb-stock";
import { formatSupabaseError } from "@/lib/supabase-error";
import { isSchemaMissingError } from "@/lib/supabase-schema";
import type { RentalContractStockItem, RentalQuantityStockKindLegacy } from "@/lib/rental-contract-labels";

export const RENTAL_QUANTITY_INSUFFICIENT_STOCK_MSG =
  "Nincs elegendő teli készlet a kiválasztott darabszámos tételből.";

export type RentalQuantityStockKind = "chinese" | "flaga_pb" | "prima_pb";

export const RENTAL_QUANTITY_KIND_LABELS: Record<RentalQuantityStockKind, string> = {
  chinese: "Kínai",
  flaga_pb: "FLAGA PB",
  prima_pb: "PRÍMA PB",
};

export type RentalQuantityItem = {
  id: string;
  rental_id: string;
  stock_kind: RentalQuantityStockKindLegacy;
  gas_type: string;
  size: string;
  quantity: number;
  added_at: string;
  removed_at: string | null;
};

export type RentalQuantityInput = {
  stock_kind: RentalQuantityStockKind;
  gas_type: string;
  size: string;
  quantity: number;
};

export async function fetchRentalQuantityItems(rentalId: string): Promise<RentalQuantityItem[]> {
  const { data, error } = await supabase
    .from("rental_quantity_items")
    .select("*")
    .eq("rental_id", rentalId)
    .is("removed_at", null)
    .order("added_at", { ascending: true });
  if (error) {
    if (isSchemaMissingError(error)) return [];
    throw new Error(formatSupabaseError(error, "Bérleti darabszám tételek"));
  }
  return (data ?? []) as RentalQuantityItem[];
}

export async function fetchActiveDeployedQuantitySummary(): Promise<
  Record<RentalQuantityStockKind, number>
> {
  const { data: activeRentals, error: rentErr } = await supabase
    .from("rentals")
    .select("id")
    .eq("status", "active");
  if (rentErr) throw new Error(formatSupabaseError(rentErr, "Aktív bérletek"));
  const ids = (activeRentals ?? []).map((r) => r.id);
  const empty: Record<RentalQuantityStockKind, number> = {
    chinese: 0,
    flaga_pb: 0,
    prima_pb: 0,
  };
  if (ids.length === 0) return empty;

  const { data, error } = await supabase
    .from("rental_quantity_items")
    .select("stock_kind, quantity")
    .in("rental_id", ids)
    .is("removed_at", null);
  if (error) {
    if (isSchemaMissingError(error)) return empty;
    throw new Error(formatSupabaseError(error, "Kihelyezett darabszám"));
  }
  for (const row of data ?? []) {
    const kind = row.stock_kind as RentalQuantityStockKindLegacy;
    if (kind in empty) empty[kind as RentalQuantityStockKind] += Number(row.quantity);
  }
  return empty;
}

async function issueStockToRental(
  item: RentalQuantityInput,
  rentalId: string,
): Promise<void> {
  const note = `Bérletbe kiadva (${rentalId})`;
  const qty = Math.round(item.quantity);
  if (qty <= 0) throw new Error("A darabszámnak pozitívnak kell lennie");

  switch (item.stock_kind) {
    case "chinese":
      await adjustChineseStock({
        gas_type: item.gas_type,
        size: item.size,
        movement_type: "sale",
        quantity: qty,
        note,
      });
      break;
    case "flaga_pb":
      await adjustFlagaPbStock({
        gas_type: item.gas_type,
        size: item.size,
        movement_type: "sale",
        quantity: qty,
        note,
      });
      break;
    case "prima_pb":
      await adjustPrimaPbStock({
        gas_type: item.gas_type,
        size: item.size,
        movement_type: "sale",
        quantity: qty,
        note,
      });
      break;
    default:
      throw new Error(`Ismeretlen készlettípus: ${item.stock_kind}`);
  }
}

async function returnStockFromRental(
  item: Pick<RentalQuantityItem, "stock_kind" | "gas_type" | "size" | "quantity">,
  rentalId: string,
): Promise<void> {
  if (item.stock_kind === "flaga") {
    throw new Error(
      "A régi FLAGA készlet modul megszűnt; a visszavételt manuálisan kezeld a FLAGA PB készletben",
    );
  }

  const note = `Visszavéve bérletből (${rentalId})`;
  const qty = Math.round(item.quantity);
  if (qty <= 0) throw new Error("A darabszámnak pozitívnak kell lennie");

  switch (item.stock_kind) {
    case "chinese":
      await adjustChineseStock({
        gas_type: item.gas_type,
        size: item.size,
        movement_type: "empty_return",
        quantity: qty,
        note,
      });
      break;
    case "flaga_pb":
      await adjustFlagaPbStock({
        gas_type: item.gas_type,
        size: item.size,
        movement_type: "empty_return",
        quantity: qty,
        note,
      });
      break;
    case "prima_pb":
      await adjustPrimaPbStock({
        gas_type: item.gas_type,
        size: item.size,
        movement_type: "empty_return",
        quantity: qty,
        note,
      });
      break;
    default:
      throw new Error(`Ismeretlen készlettípus: ${item.stock_kind}`);
  }
}

function aggregateQuantityInputs(items: RentalQuantityInput[]): RentalQuantityInput[] {
  const byKey = new Map<string, RentalQuantityInput>();
  for (const item of items) {
    const key = `${item.stock_kind}\0${item.gas_type}\0${item.size}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity += Math.round(item.quantity);
    } else {
      byKey.set(key, {
        stock_kind: item.stock_kind,
        gas_type: item.gas_type,
        size: item.size,
        quantity: Math.round(item.quantity),
      });
    }
  }
  return [...byKey.values()];
}

function fullStockCount(
  item: RentalQuantityInput,
  chineseRows: Awaited<ReturnType<typeof fetchChineseStock>>,
  flagaRows: Awaited<ReturnType<typeof fetchFlagaPbStock>>,
  primaRows: Awaited<ReturnType<typeof fetchPrimaPbStock>>,
): number {
  switch (item.stock_kind) {
    case "chinese": {
      const gas = canonicalGasType(item.gas_type);
      const size = canonicalSize(gas, item.size);
      const row = chineseRows.find((r) => r.gas_type === gas && r.size === size);
      return row?.full_count ?? 0;
    }
    case "flaga_pb": {
      const canonical = canonicalFlagaPbItem(item.gas_type, item.size);
      const row = flagaRows.find(
        (r) => r.gas_type === canonical.gas_type && r.size === canonical.size,
      );
      return row?.full_count ?? 0;
    }
    case "prima_pb": {
      const canonical = canonicalPrimaPbItem(item.gas_type, item.size);
      const row = primaRows.find(
        (r) => r.gas_type === canonical.gas_type && r.size === canonical.size,
      );
      return row?.full_count ?? 0;
    }
    default:
      return 0;
  }
}

/** Teli készlet ellenőrzése mentés előtt (darabszám alapú bérleti tételek). */
export async function validateRentalQuantityFullStock(items: RentalQuantityInput[]): Promise<void> {
  if (items.length === 0) return;

  const aggregated = aggregateQuantityInputs(items);
  const [chineseRows, flagaRows, primaRows] = await Promise.all([
    fetchChineseStock(),
    fetchFlagaPbStock(),
    fetchPrimaPbStock(),
  ]);

  for (const item of aggregated) {
    const available = fullStockCount(item, chineseRows, flagaRows, primaRows);
    if (available < item.quantity) {
      throw new Error(RENTAL_QUANTITY_INSUFFICIENT_STOCK_MSG);
    }
  }
}

export async function assignQuantityItemsToRental(
  rentalId: string,
  items: RentalQuantityInput[],
): Promise<void> {
  if (items.length === 0) return;
  await validateRentalQuantityFullStock(items);
  for (const item of items) {
    await issueStockToRental(item, rentalId);
  }
  const rows = items.map((item) => ({
    rental_id: rentalId,
    stock_kind: item.stock_kind,
    gas_type: item.gas_type,
    size: item.size,
    quantity: Math.round(item.quantity),
  }));
  const { error } = await supabase.from("rental_quantity_items").insert(rows);
  if (error) throw new Error(formatSupabaseError(error, "Bérleti darabszám rögzítése"));
}

export async function returnRentalQuantityItems(
  rentalId: string,
  itemIds?: string[],
): Promise<void> {
  const items = await fetchRentalQuantityItems(rentalId);
  const toReturn = itemIds?.length
    ? items.filter((i) => itemIds.includes(i.id))
    : items;
  if (toReturn.length === 0) return;

  for (const item of toReturn) {
    await returnStockFromRental(
      {
        stock_kind: item.stock_kind,
        gas_type: item.gas_type,
        size: item.size,
        quantity: item.quantity,
      },
      rentalId,
    );
  }

  const ids = toReturn.map((i) => i.id);
  const { error } = await supabase
    .from("rental_quantity_items")
    .update({ removed_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw new Error(formatSupabaseError(error, "Bérleti darabszám lezárása"));
}

/** Soronként: kind,gáz,méret,darab – pl. flaga_pb,Motorüzemű Flaga,11 kg,2 */
export function parseRentalQuantityLines(text: string): RentalQuantityInput[] {
  const result: RentalQuantityInput[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 4) {
      throw new Error(`Érvénytelen sor (kind,gáz,méret,darab): ${line}`);
    }
    const qty = Number(parts[parts.length - 1]);
    const size = parts[parts.length - 2];
    const gas_type = parts.slice(1, -2).join(",");
    const stock_kind = parts[0] as RentalQuantityStockKindLegacy;
    if (stock_kind === "flaga") {
      throw new Error(`A régi FLAGA készlet modul megszűnt; használd a flaga_pb kindot: ${line}`);
    }
    if (!["chinese", "flaga_pb", "prima_pb"].includes(stock_kind)) {
      throw new Error(`Ismeretlen kind: ${stock_kind}`);
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Érvénytelen darabszám: ${line}`);
    }
    result.push({ stock_kind, gas_type, size, quantity: qty });
  }
  return result;
}

export function toContractStockItems(items: RentalQuantityItem[]): RentalContractStockItem[] {
  return items.map((item) => ({
    gas_type: item.gas_type,
    size: item.size,
    kind: item.stock_kind,
    quantity: item.quantity,
  }));
}

export function summarizeRentalQuantityItems(items: RentalQuantityItem[]): string[] {
  const byKey = new Map<string, { label: string; qty: number }>();
  for (const item of items) {
    const kind = item.stock_kind as RentalQuantityStockKind;
    const kindLabel = RENTAL_QUANTITY_KIND_LABELS[kind] ?? item.stock_kind;
    const key = `${kind}\0${item.gas_type}\0${item.size}`;
    const label = `${kindLabel}: ${item.gas_type} ${item.size}`;
    const existing = byKey.get(key);
    if (existing) existing.qty += item.quantity;
    else byKey.set(key, { label, qty: item.quantity });
  }
  return [...byKey.values()].map(({ label, qty }) => `${label} – ${qty} db`);
}
