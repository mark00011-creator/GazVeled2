import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  summarizeQuantityLines,
  type OrderableQuantityLine,
  type SelectedQuantityLine,
} from "@/lib/gas-order-quantity";

export type QuantitySelectionState = Record<string, { selected: boolean; quantity: number }>;

export function toSelectedQuantityLines(
  lines: OrderableQuantityLine[],
  selection: QuantitySelectionState,
): SelectedQuantityLine[] {
  const result: SelectedQuantityLine[] = [];
  for (const line of lines) {
    const sel = selection[line.key];
    if (!sel?.selected || sel.quantity <= 0) continue;
    result.push({
      stock_kind: line.stock_kind,
      gas_type: line.gas_type,
      size: line.size,
      quantity: Math.min(sel.quantity, line.empty_count),
      label: line.label,
    });
  }
  return result;
}

export function initQuantitySelection(lines: OrderableQuantityLine[]): QuantitySelectionState {
  const state: QuantitySelectionState = {};
  for (const line of lines) {
    state[line.key] = { selected: true, quantity: line.empty_count };
  }
  return state;
}

export function GasQuantityLineSelector({
  title,
  lines,
  selection,
  onSelectionChange,
}: {
  title: string;
  lines: OrderableQuantityLine[];
  selection: QuantitySelectionState;
  onSelectionChange: (next: QuantitySelectionState) => void;
}) {
  const selectedLines = useMemo(
    () => toSelectedQuantityLines(lines, selection),
    [lines, selection],
  );
  const summary = summarizeQuantityLines(selectedLines);
  const totalQty = selectedLines.reduce((s, l) => s + l.quantity, 0);

  function updateLine(key: string, patch: Partial<{ selected: boolean; quantity: number }>) {
    onSelectionChange({
      ...selection,
      [key]: { ...selection[key], ...patch },
    });
  }

  function selectAll(checked: boolean) {
    const next = { ...selection };
    for (const line of lines) {
      next[line.key] = {
        selected: checked,
        quantity: selection[line.key]?.quantity ?? line.empty_count,
      };
    }
    onSelectionChange(next);
  }

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {lines.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => selectAll(true)}>
            Mind kijelöl
          </Button>
        )}
      </div>
      {lines.length === 0 ? (
        <div className="text-sm text-muted-foreground">Nincs rendelhető üres palack</div>
      ) : (
        <ul className="space-y-3">
          {lines.map((line) => {
            const sel = selection[line.key] ?? { selected: false, quantity: line.empty_count };
            return (
              <li
                key={line.key}
                className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm"
              >
                <Checkbox
                  id={`qty-${line.key}`}
                  checked={sel.selected}
                  onCheckedChange={(v) => updateLine(line.key, { selected: v === true })}
                />
                <Label htmlFor={`qty-${line.key}`} className="min-w-0 flex-1 cursor-pointer">
                  {line.label}
                  <span className="ml-2 text-muted-foreground">(üres: {line.empty_count} db)</span>
                  {line.stock_kind === "chinese" && (
                    <span className="ml-1 text-xs text-muted-foreground">· Chinese</span>
                  )}
                  {line.stock_kind === "prima_pb" && (
                    <span className="ml-1 text-xs text-muted-foreground">· PRÍMA PB</span>
                  )}
                </Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Rendelés:</span>
                  <Input
                    type="number"
                    min={1}
                    max={line.empty_count}
                    className="h-8 w-20"
                    disabled={!sel.selected}
                    value={sel.quantity}
                    onChange={(e) =>
                      updateLine(line.key, {
                        quantity: Math.min(
                          line.empty_count,
                          Math.max(1, Number(e.target.value) || 1),
                        ),
                      })
                    }
                  />
                  <span className="text-xs text-muted-foreground">db</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {summary.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Kijelölve</div>
          <ul className="space-y-0.5 text-sm">
            {summary.map((s) => (
              <li key={s.label}>
                {s.label}: <span className="font-medium">{s.count} db</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 text-sm font-medium">Összesen: {totalQty} db</div>
        </div>
      )}
    </Card>
  );
}
