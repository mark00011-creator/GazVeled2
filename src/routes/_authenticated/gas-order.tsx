import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, FileDown, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import {
  buildSupplier1GasOrderText,
  fetchOrderableCylinders,
  type OrderableCylinder,
} from "@/lib/gas-order";
import {
  estimateGasOrderPrices,
  formatGasOrderEstimateLine,
  formatHuf,
  type GasOrderEstimateLine,
} from "@/lib/gas-order-prices";
import { buildPurchasePriceMap, fetchProductPrices } from "@/lib/product-prices";
import { downloadPdf, generateSupplier1GasOrderPdf } from "@/lib/gas-order-pdf";
import {
  fetchOrderableChineseLines,
} from "@/lib/gas-order-quantity";
import {
  GasQuantityLineSelector,
  initQuantitySelection,
  toSelectedQuantityLines,
  type QuantitySelectionState,
} from "@/components/GasQuantityLineSelector";
import {
  createSupplier1GasOrder,
  deleteGasOrder,
  fetchSupplier1GasOrders,
  gasOrderStatusLabels,
  updateGasOrderStatus,
  type GasOrderRow,
  type GasOrderStatus,
} from "@/lib/gas-orders";
import { fmtDate } from "@/lib/labels";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/gas-order")({
  head: () => ({ meta: [{ title: "Gáz rendelés – Gáz Veled" }] }),
  component: GasOrderPage,
});

function PricedSummaryBlock({
  title,
  lines,
}: {
  title: string;
  lines: GasOrderEstimateLine[];
}) {
  if (lines.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{title}</div>
      <ul className="space-y-1 text-sm">
        {lines.map((line) => (
          <li key={line.label} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="font-medium">{formatGasOrderEstimateLine(line)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CylinderList({ title, cylinders }: { title: string; cylinders: OrderableCylinder[] }) {
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {cylinders.length === 0 ? (
        <div className="text-sm text-muted-foreground">Nincs rendelhető palack</div>
      ) : (
        <ul className="space-y-1.5 font-mono text-sm">
          {cylinders.map((c) => (
            <li key={c.id}>
              {c.barcode} - {c.gas_type} {c.size}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function GasOrderPage() {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [qtySelection, setQtySelection] = useState<QuantitySelectionState>({});
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["gas-order"],
    queryFn: fetchOrderableCylinders,
  });

  const { data: chineseLines = [] } = useQuery({
    queryKey: ["gas-order-chinese-lines"],
    queryFn: fetchOrderableChineseLines,
  });

  useEffect(() => {
    setQtySelection(initQuantitySelection(chineseLines));
  }, [chineseLines]);

  const selectedQuantityLines = useMemo(
    () => toSelectedQuantityLines(chineseLines, qtySelection),
    [chineseLines, qtySelection],
  );

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ["gas-orders", "supplier-1"],
    queryFn: fetchSupplier1GasOrders,
  });

  const { data: priceRows = [] } = useQuery({
    queryKey: ["product-prices"],
    queryFn: () => fetchProductPrices(true),
  });

  const priceMap = buildPurchasePriceMap(priceRows);

  const group = data ?? { siad: [], own: [] };
  const estimate = useMemo(
    () => estimateGasOrderPrices(group, selectedQuantityLines, priceMap),
    [group, selectedQuantityLines, priceMap],
  );
  const serialTotal = group.siad.length + group.own.length;
  const quantityTotal = selectedQuantityLines.reduce((s, l) => s + l.quantity, 0);
  const orderTotal = serialTotal + quantityTotal;
  const hasOrderable = serialTotal > 0 || chineseLines.length > 0;

  async function handleCreateOrder() {
    if (orderTotal === 0) {
      toast.error("Válassz legalább egy tételt");
      return;
    }
    setOrderBusy(true);
    try {
      await createSupplier1GasOrder(group, selectedQuantityLines);
      await qc.invalidateQueries({ queryKey: ["gas-orders", "supplier-1"] });
      toast.success("Rendelés létrehozva (Tervezet)");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOrderBusy(false);
    }
  }

  async function handleStatusChange(orderId: string, status: GasOrderStatus) {
    try {
      await updateGasOrderStatus(orderId, status);
      await qc.invalidateQueries({ queryKey: ["gas-orders", "supplier-1"] });
      toast.success("Státusz frissítve");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleDeleteOrder(order: GasOrderRow) {
    if (!confirm(`Törlöd a rendelést (${order.item_count ?? 0} tétel)?`)) return;
    try {
      await deleteGasOrder(order.id);
      await qc.invalidateQueries({ queryKey: ["gas-orders", "supplier-1"] });
      toast.success("Rendelés törölve");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handlePdf() {
    setPdfBusy(true);
    try {
      const bytes = await generateSupplier1GasOrderPdf(group, selectedQuantityLines, priceMap);
      const date = new Date().toISOString().slice(0, 10);
      downloadPdf(bytes, `gaz-rendeles-${date}.pdf`);
      toast.success("PDF letöltve");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPdfBusy(false);
    }
  }

  async function handleCopy() {
    try {
      const text = buildSupplier1GasOrderText(group, selectedQuantityLines, priceMap);
      await navigator.clipboard.writeText(text);
      toast.success("Szöveg a vágólapra másolva");
    } catch {
      toast.error("Másolás sikertelen");
    }
  }

  return (
    <AppShell title="Gáz rendelés">
      {isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Betöltés…</div>}
      {isError && (
        <div className="py-8 text-center text-sm text-destructive">Lista betöltése sikertelen</div>
      )}

      {!isLoading && !isError && (
        <>
          <Card className="mb-4 p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Rendelés összesítés
            </h2>
            <PricedSummaryBlock title="Sorszámos – SIAD" lines={estimate.siad} />
            <PricedSummaryBlock title="Sorszámos – Saját" lines={estimate.own} />
            <PricedSummaryBlock title="Darabszámos" lines={estimate.quantity} />
            {!hasOrderable && (
              <div className="text-sm text-muted-foreground">
                Nincs rendelhető üres palack a telephelyen
              </div>
            )}
            {orderTotal > 0 && (
              <div className="mt-3 space-y-2 border-t pt-3 text-sm">
                <div className="font-medium">Összesen kijelölve: {orderTotal} db</div>
                {estimate.knownTotal > 0 && (
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground">Becsült összeg</span>
                    <span className="text-lg font-bold">{formatHuf(estimate.knownTotal)}</span>
                  </div>
                )}
                {estimate.unknownLabels.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Ár nélkül: {estimate.unknownLabels.join(", ")}
                  </div>
                )}
              </div>
            )}
          </Card>

          <h2 className="mb-3 text-sm font-semibold">Sorszámos palackok</h2>
          <div className="mb-6 space-y-3">
            <CylinderList title="SIAD palackok" cylinders={group.siad} />
            <CylinderList title="Saját palackok" cylinders={group.own} />
          </div>

          <GasQuantityLineSelector
            title="Darabszámos"
            lines={chineseLines}
            selection={qtySelection}
            onSelectionChange={setQtySelection}
          />

          <div className="mb-6 flex flex-col gap-2">
            <Button size="lg" disabled={orderBusy || orderTotal === 0} onClick={handleCreateOrder}>
              <ClipboardList className="mr-2 h-5 w-5" />
              Rendelés rögzítése (Tervezet)
            </Button>
            <Button size="lg" disabled={pdfBusy || orderTotal === 0} onClick={handlePdf}>
              <FileDown className="mr-2 h-5 w-5" />
              PDF rendelés
            </Button>
            <Button size="lg" variant="outline" disabled={orderTotal === 0} onClick={handleCopy}>
              <Copy className="mr-2 h-5 w-5" />
              Szöveg másolása
            </Button>
          </div>

          <Card className="mb-6 p-4">
            <h2 className="mb-3 text-sm font-semibold">Rendelés státuszok</h2>
            {ordersLoading && (
              <div className="text-sm text-muted-foreground">Betöltés…</div>
            )}
            {!ordersLoading && orders.length === 0 && (
              <div className="text-sm text-muted-foreground">Még nincs rögzített rendelés.</div>
            )}
            <ul className="space-y-2">
              {orders.map((order) => (
                <li key={order.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{fmtDate(order.created_at)}</div>
                      <div className="text-xs text-muted-foreground">
                        {order.item_count ?? 0} tétel
                      </div>
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

          <p className="text-center text-sm text-muted-foreground">
            <Link to="/gas-order-flaga" className="underline hover:text-foreground">
              FLAGA PB gáz rendelés (külön beszállító) →
            </Link>
          </p>
        </>
      )}
    </AppShell>
  );
}
