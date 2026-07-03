import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  type OrderableQuantityLine,
} from "@/lib/gas-order-quantity";
import {
  createGasOrderFromQuantityLines,
  deleteGasOrder,
  fetchGasOrders,
  gasOrderStatusLabels,
  updateGasOrderStatus,
  type GasOrderRow,
  type GasOrderStatus,
} from "@/lib/gas-orders";
import { fmtDate } from "@/lib/labels";
import { useQuery } from "@tanstack/react-query";
import {
  GasQuantityLineSelector,
  initQuantitySelection,
  toSelectedQuantityLines,
  type QuantitySelectionState,
} from "@/components/GasQuantityLineSelector";

export function GasQuantityOrderPanel({
  title,
  lines,
  copyTitle,
  ordersQueryKey,
}: {
  title: string;
  lines: OrderableQuantityLine[];
  copyTitle: string;
  ordersQueryKey: string[];
}) {
  const qc = useQueryClient();
  const [selection, setSelection] = useState<QuantitySelectionState>({});
  const [orderBusy, setOrderBusy] = useState(false);

  useEffect(() => {
    setSelection(initQuantitySelection(lines));
  }, [lines]);

  const selectedLines = useMemo(() => toSelectedQuantityLines(lines, selection), [lines, selection]);
  const totalQty = selectedLines.reduce((s, l) => s + l.quantity, 0);

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ordersQueryKey,
    queryFn: () => fetchGasOrders("flaga_pb"),
  });

  async function handleCreateOrder() {
    if (selectedLines.length === 0) {
      toast.error("Válassz legalább egy tételt");
      return;
    }
    setOrderBusy(true);
    try {
      await createGasOrderFromQuantityLines("flaga_pb", selectedLines);
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
      if (status === "received") {
        // Megérkezéskor a készletegyenleg is változik (teli +, üres −).
        await qc.invalidateQueries({ queryKey: ["flaga-pb-stock"] });
        await qc.invalidateQueries({ queryKey: ["gas-order-flaga-lines"] });
      }
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
      <GasQuantityLineSelector
        title={title}
        lines={lines}
        selection={selection}
        onSelectionChange={setSelection}
      />

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
