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
  summarizeGasOrder,
  type OrderableCylinder,
} from "@/lib/gas-order";
import { estimateGasOrderCost, formatHuf } from "@/lib/gas-order-prices";
import { buildPurchasePriceMap, fetchProductPrices } from "@/lib/product-prices";
import { downloadPdf, generateSupplier1GasOrderPdf } from "@/lib/gas-order-pdf";
import {
  fetchOrderableChineseLines,
  fetchOrderablePrimaPbLines,
  mergeCirculatingQuantityLines,
  splitMergedCirculatingSelection,
  summarizeUnifiedQuantityLines,
} from "@/lib/gas-order-quantity";
import {
  GasQuantityLineSelector,
  initQuantitySelection,
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

function SummaryBlock({
  title,
  lines,
}: {
  title: string;
  lines: { label: string; count: number }[];
}) {
  if (lines.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{title}</div>
      <ul className="space-y-0.5 text-sm">
        {lines.map((l) => (
          <li key={l.label}>
            {l.label}: <span className="font-medium">{l.count} db</span>
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

function OrderEstimateCard({
  group,
  priceMap,
}: {
  group: { siad: OrderableCylinder[]; own: OrderableCylinder[] };
  priceMap: Map<string, number>;
}) {
  const estimate = estimateGasOrderCost(group, priceMap);
  const total = estimate.cylinderCount;

  if (total === 0) return null;

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold">Becsült rendelési összeg (sorszámos)</h2>
      {estimate.lines.length > 0 && (
        <ul className="mb-3 space-y-1 text-sm">
          {estimate.lines.map((line) => (
            <li key={line.label} className="flex justify-between gap-3">
              <span>
                {line.label} × {line.count} db
              </span>
              <span className="shrink-0 text-muted-foreground">
                {line.lineTotal != null ? formatHuf(line.lineTotal) : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-muted-foreground">Kb. összesen</span>
          <span className="text-xl font-bold">{formatHuf(estimate.knownTotal)}</span>
        </div>
      </div>
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

  const { data: primaLines = [] } = useQuery({
    queryKey: ["gas-order-prima-lines"],
    queryFn: fetchOrderablePrimaPbLines,
  });

  const circulatingLines = useMemo(
    () => mergeCirculatingQuantityLines(chineseLines, primaLines),
    [chineseLines, primaLines],
  );

  useEffect(() => {
    setQtySelection(initQuantitySelection(circulatingLines));
  }, [circulatingLines]);

  const selectedQuantityLines = useMemo(
    () => splitMergedCirculatingSelection(circulatingLines, qtySelection),
    [circulatingLines, qtySelection],
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
  const summary = summarizeGasOrder(group);
  const serialTotal = group.siad.length + group.own.length;
  const quantitySummary = summarizeUnifiedQuantityLines(selectedQuantityLines);
  const quantityTotal = selectedQuantityLines.reduce((s, l) => s + l.quantity, 0);
  const orderTotal = serialTotal + quantityTotal;
  const hasOrderable = serialTotal > 0 || circulatingLines.length > 0;

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
      const bytes = await generateSupplier1GasOrderPdf(group, selectedQuantityLines);
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
      const text = buildSupplier1GasOrderText(group, selectedQuantityLines);
      await navigator.clipboard.writeText(text);
      toast.success("Szöveg a vágólapra másolva");
    } catch {
      toast.error("Másolás sikertelen");
    }
  }

  return (
    <AppShell title="Gáz rendelés">
      <p className="mb-4 text-sm text-muted-foreground">
        Sorszámos üres palackok (SIAD / saját) és körforgásos üres készlet – egy rendelésben.
      </p>

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
            <SummaryBlock title="Sorszámos – SIAD" lines={summary.siad} />
            <SummaryBlock title="Sorszámos – Saját" lines={summary.own} />
            {quantitySummary.length > 0 && (
              <SummaryBlock title="Körforgásos" lines={quantitySummary} />
            )}
            {!hasOrderable && (
              <div className="text-sm text-muted-foreground">
                Nincs rendelhető üres palack a telephelyen
              </div>
            )}
            {orderTotal > 0 && (
              <div className="mt-3 border-t pt-3 text-sm font-medium">
                Összesen kijelölve: {orderTotal} db
              </div>
            )}
          </Card>

          <h2 className="mb-3 text-sm font-semibold">Sorszámos palackok</h2>
          <div className="mb-6 space-y-3">
            <CylinderList title="SIAD palackok" cylinders={group.siad} />
            <CylinderList title="Saját palackok" cylinders={group.own} />
            <OrderEstimateCard group={group} priceMap={priceMap} />
          </div>

          <h2 className="mb-3 text-sm font-semibold">Körforgásos készlet</h2>
          <GasQuantityLineSelector
            title="Rendelhető üres palackok"
            lines={circulatingLines}
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
