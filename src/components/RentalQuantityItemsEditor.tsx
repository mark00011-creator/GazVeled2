import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { GAS_TYPES, getAvailableSizes } from "@/lib/gas-cylinder-form";
import {
  FLAGA_PB_CATALOG,
  flagaPbStockLabel,
} from "@/lib/flaga-pb-stock";
import {
  PRIMA_PB_CATALOG,
} from "@/lib/prima-pb-stock";
import {
  RENTAL_QUANTITY_KIND_LABELS,
  type RentalQuantityInput,
  type RentalQuantityStockKind,
} from "@/lib/rental-quantity-stock";

export type RentalQuantityRowDraft = {
  id: string;
  stock_kind: RentalQuantityStockKind;
  /** kind|gas|size – egységes termékazonosító */
  productKey: string;
  quantity: number;
};

export function makeEmptyQuantityRow(
  kind: RentalQuantityStockKind = "chinese",
): RentalQuantityRowDraft {
  return {
    id: crypto.randomUUID(),
    stock_kind: kind,
    productKey: defaultProductKeyForKind(kind),
    quantity: 1,
  };
}

function defaultProductKeyForKind(kind: RentalQuantityStockKind): string {
  if (kind === "flaga_pb") {
    const item = FLAGA_PB_CATALOG[0];
    return quantityProductKey(kind, item.gas_type, item.size);
  }
  if (kind === "prima_pb") {
    const item = PRIMA_PB_CATALOG[0];
    return quantityProductKey(kind, item.gas_type, item.size);
  }
  const gas = GAS_TYPES[0];
  return quantityProductKey(kind, gas, getAvailableSizes(gas)[0]);
}

export function quantityProductKey(
  kind: RentalQuantityStockKind,
  gas_type: string,
  size: string,
): string {
  return `${kind}|${gas_type}|${size}`;
}

export function parseQuantityProductKey(key: string): {
  stock_kind: RentalQuantityStockKind;
  gas_type: string;
  size: string;
} | null {
  const parts = key.split("|");
  if (parts.length < 3) return null;
  const stock_kind = parts[0] as RentalQuantityStockKind;
  const size = parts[parts.length - 1];
  const gas_type = parts.slice(1, -1).join("|");
  if (!["chinese", "flaga_pb", "prima_pb"].includes(stock_kind)) return null;
  return { stock_kind, gas_type, size };
}

export function rentalQuantityRowsToInputs(rows: RentalQuantityRowDraft[]): RentalQuantityInput[] {
  const result: RentalQuantityInput[] = [];
  for (const row of rows) {
    const parsed = parseQuantityProductKey(row.productKey);
    if (!parsed) continue;
    const qty = Math.round(row.quantity);
    if (qty <= 0) continue;
    result.push({
      stock_kind: parsed.stock_kind,
      gas_type: parsed.gas_type,
      size: parsed.size,
      quantity: qty,
    });
  }
  return result;
}

function catalogOptionsForKind(kind: RentalQuantityStockKind): { key: string; label: string }[] {
  if (kind === "flaga_pb") {
    return FLAGA_PB_CATALOG.map((item) => ({
      key: quantityProductKey(kind, item.gas_type, item.size),
      label: flagaPbStockLabel(item.gas_type, item.size),
    }));
  }
  if (kind === "prima_pb") {
    return PRIMA_PB_CATALOG.map((item) => ({
      key: quantityProductKey(kind, item.gas_type, item.size),
      label: `${item.size} ${item.gas_type}`,
    }));
  }
  const options: { key: string; label: string }[] = [];
  for (const gas of GAS_TYPES) {
    for (const size of getAvailableSizes(gas)) {
      options.push({
        key: quantityProductKey(kind, gas, size),
        label: `${gas} ${size}`,
      });
    }
  }
  return options;
}

function sizeForProductKey(productKey: string): string {
  return parseQuantityProductKey(productKey)?.size ?? "—";
}

export function RentalQuantityItemsEditor({
  rows,
  onChange,
}: {
  rows: RentalQuantityRowDraft[];
  onChange: (rows: RentalQuantityRowDraft[]) => void;
}) {
  const optionsByKind = useMemo(
    () => ({
      chinese: catalogOptionsForKind("chinese"),
      flaga_pb: catalogOptionsForKind("flaga_pb"),
      prima_pb: catalogOptionsForKind("prima_pb"),
    }),
    [],
  );

  function updateRow(id: string, patch: Partial<RentalQuantityRowDraft>) {
    onChange(
      rows.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if (patch.stock_kind && patch.stock_kind !== row.stock_kind) {
          next.productKey = defaultProductKeyForKind(patch.stock_kind);
        }
        if (patch.productKey) {
          const parsed = parseQuantityProductKey(patch.productKey);
          if (parsed) next.stock_kind = parsed.stock_kind;
        }
        return next;
      }),
    );
  }

  function removeRow(id: string) {
    onChange(rows.filter((row) => row.id !== id));
  }

  function addRow() {
    onChange([...rows, makeEmptyQuantityRow()]);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>Darabszám alapú bérleti tételek</Label>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="mr-1 h-3 w-3" /> Sor hozzáadása
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Opcionális – Kínai, FLAGA PB vagy PRÍMA PB teli készletből.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const catalog = optionsByKind[row.stock_kind];
            const productKeyValid = catalog.some((o) => o.key === row.productKey);
            const effectiveKey = productKeyValid ? row.productKey : (catalog[0]?.key ?? row.productKey);

            return (
              <li
                key={row.id}
                className="grid grid-cols-[1fr_1fr_auto_auto_auto] items-end gap-2 rounded-md border p-2 sm:grid-cols-2"
              >
                <div className="min-w-0">
                  <Label className="text-xs">Készlettípus</Label>
                  <Select
                    value={row.stock_kind}
                    onValueChange={(v) =>
                      updateRow(row.id, { stock_kind: v as RentalQuantityStockKind })
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(RENTAL_QUANTITY_KIND_LABELS) as RentalQuantityStockKind[]).map(
                        (kind) => (
                          <SelectItem key={kind} value={kind}>
                            {RENTAL_QUANTITY_KIND_LABELS[kind]}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-0 sm:col-span-2">
                  <Label className="text-xs">Gáz / termék</Label>
                  <Select
                    value={effectiveKey}
                    onValueChange={(v) => updateRow(row.id, { productKey: v })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {catalog.map((opt) => (
                        <SelectItem key={opt.key} value={opt.key}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="min-w-0">
                  <Label className="text-xs">Méret</Label>
                  <Input
                    className="h-9 bg-muted"
                    readOnly
                    tabIndex={-1}
                    value={sizeForProductKey(effectiveKey)}
                  />
                </div>

                <div className="min-w-0">
                  <Label className="text-xs">Darabszám</Label>
                  <Input
                    type="number"
                    min={1}
                    className="h-9 w-20"
                    value={row.quantity}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      updateRow(row.id, {
                        quantity: Number.isFinite(raw) ? Math.max(1, Math.round(raw)) : 1,
                      });
                    }}
                  />
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-destructive"
                  aria-label="Sor törlése"
                  onClick={() => removeRow(row.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
