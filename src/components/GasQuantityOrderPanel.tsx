import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClipboardList, Copy } from "lucide-react";
import { toast } from "sonner";
import {
  buildQuantityGasOrderText,
  summarizeQuantityLines,
  type OrderableQuantityLine,
  type SelectedQuantityLine,
} from "@/lib/gas-order-quantity";
import {
  createGasOrderFromQuantityLines,
  deleteGasOrder,
  fetchGasOrders,
  gasOrderStatusLabels,
  updateGasOrderStatus,
  type GasOrderKind,
  type GasOrderRow,
  type GasOrderStatus,
} from "@/lib/gas-orders";
import { fmtDate } from "@/lib/labels";
import { useQuery } from "@tanstack/react-query";

type SelectionState = Record<string, { selected: boolean; quantity: number }>;

function toSelectedLines(
  lines: OrderableQuantityLine[],
  selection: SelectionState,
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

function initSelection(lines: OrderableQuantityLine[]): SelectionState {
  const state: SelectionState = {};
  for (const line of lines) {
    state[line.key] = { selected: true, quantity: line.empty_count };
  }
  return state;
}

export function GasQuantityOrderPanel({
  title,
  orderKind,
  lines,
  copyTitle,
  ordersQueryKey,
}: {
  title: string;
  orderKind: Extract<GasOrderKind, "chinese_prima" | "flaga_pb">;
  lines: OrderableQuantityLine[];
  copyTitle: string;
  ordersQueryKey: string[];
}) {
  const qc = useQueryClient();
  const [selection, setSelection] = useState<SelectionState>({});
  const [orderBusy, setOrderBusy] = useState(false);

  useEffect(() => {
    setSelection(initSelection(lines));
  }, [lines]);

  const selectedLines = useMemo(() => toSelectedLines(lines, selection), [lines, selection]);
  const summary = summarizeQuantityLines(selectedLines);
  const totalQty = selectedLines.reduce((s, l) => s + l.quantity, 0);

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ordersQueryKey,
    queryFn: () => fetchGasOrders(orderKind),
  });

  function updateLine(key: string, patch: Partial<{ selected: boolean; quantity: number }>) {
    setSelection((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }));
  }

  function selectAll(checked: boolean) {
    setSelection((prev) => {
      const next = { ...prev };
      for (const line of lines) {
        next[line.key] = {
          selected: checked,
          quantity: prev[line.key]?.quantity ?? line.empty_count,
        };
      }
      return next;
    });
  }

  async function handleCreateOrder() {
    if (selectedLines.length === 0) {
      toast.error("Válassz legalább egy tételt");
      return;
    }
    setOrderBusy(true);
    try {
      await createGasOrderFromQuantityLines(orderKind, selectedLines);
      await qc.invalidateQueries({ queryKey: ordersQueryKey });
      toast.success("Rendelés létrehozva (Tervezet)");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOrderBusy(false);
    }
  }

  async function handleCopy() {
    try {
      const text = buildQuantityGasOrderText(copyTitle, selectedLines);
      await navigator.clipboard.writeText(text);
      toast.success("Szöveg a vágólapra másolva");
    } catch {
      toast.error("Másolás sikertelen");
    }
  }

  async function handleStatusChange(orderId: string, status: GasOrderStatus) {
    try {
      await updateGasOrderStatus(orderId, status);
      await qc.invalidateQueries({ queryKey: ordersQueryKey });
      toast.success("Státusz frissítve");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleDeleteOrder(order: GasOrderRow) {
    if (!confirm(`Törlöd a rendelést (${order.item_count ?? 0} tétel)?`)) return;
    try {
      await deleteGasOrder(order.id);
      await qc.invalidateQueries({ queryKey: ordersQueryKey });
      toast.success("Rendelés törölve");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
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
            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              Kijelölve
            </div>
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

      <div className="mb-4 flex flex-col gap-2">
        <Button size="lg" disabled={orderBusy || totalQty === 0} onClick={handleCreateOrder}>
          <ClipboardList className="mr-2 h-5 w-5" />
          Rendelés rögzítése (Tervezet)
        </Button>
        <Button size="lg" variant="outline" disabled={totalQty === 0} onClick={handleCopy}>
          <Copy className="mr-2 h-5 w-5" />
          Szöveg másolása
        </Button>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">Rendelés státuszok</h2>
        {ordersLoading && <div className="text-sm text-muted-foreground">Betöltés…</div>}
        {!ordersLoading && orders.length === 0 && (
          <div className="text-sm text-muted-foreground">Még nincs rögzített rendelés.</div>
        )}
        <ul className="space-y-2">
          {orders.map((order) => (
            <li key={order.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{fmtDate(order.created_at)}</div>
                  <div className="text-xs text-muted-foreground">{order.item_count ?? 0} tétel</div>
                </div>
                <Select
                  value={order.status}
                  onValueChange={(v) => handleStatusChange(order.id, v as GasOrderStatus)}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(gasOrderStatusLabels) as GasOrderStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {gasOrderStatusLabels[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {order.note && (
                <div className="mt-1 text-xs text-muted-foreground">{order.note}</div>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 text-destructive"
                onClick={() => handleDeleteOrder(order)}
              >
                Törlés
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
