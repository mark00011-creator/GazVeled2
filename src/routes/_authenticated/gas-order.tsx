import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, FileDown } from "lucide-react";
import { toast } from "sonner";
import {
  buildGasOrderText,
  fetchOrderableCylinders,
  summarizeGasOrder,
  type OrderableCylinder,
} from "@/lib/gas-order";
import { estimateGasOrderCost, formatHuf } from "@/lib/gas-order-prices";
import { buildPriceMap, fetchProductPrices } from "@/lib/product-prices";
import { downloadPdf, generateGasOrderPdf } from "@/lib/gas-order-pdf";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/gas-order")({
  head: () => ({ meta: [{ title: "Gáz rendelés – Gáz Veled" }] }),
  component: GasOrderPage,
});

function SummaryBlock({ title, lines }: { title: string; lines: { label: string; count: number }[] }) {
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
      <h2 className="mb-3 text-sm font-semibold">Becsült rendelési összeg</h2>
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
        {estimate.unknownLabels.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Nincs ár az árlistában: {estimate.unknownLabels.join(", ")}
          </p>
        )}
        {estimate.pricedCount < estimate.cylinderCount && estimate.pricedCount > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Az összeg csak a {estimate.pricedCount}/{estimate.cylinderCount} ismert árú palackot tartalmazza.
          </p>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Árak:{" "}
        <Link to="/price-list" className="underline hover:text-foreground">Árlista</Link>
      </p>
    </Card>
  );
}

function GasOrderPage() {
  const [pdfBusy, setPdfBusy] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["gas-order"],
    queryFn: fetchOrderableCylinders,
  });

  const { data: priceRows = [] } = useQuery({
    queryKey: ["product-prices"],
    queryFn: () => fetchProductPrices(true),
  });

  const priceMap = buildPriceMap(priceRows);

  const group = data ?? { siad: [], own: [] };
  const summary = summarizeGasOrder(group);
  const total = group.siad.length + group.own.length;

  async function handlePdf() {
    setPdfBusy(true);
    try {
      const bytes = await generateGasOrderPdf(group);
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
      const text = buildGasOrderText(group);
      await navigator.clipboard.writeText(text);
      toast.success("Szöveg a vágólapra másolva");
    } catch {
      toast.error("Másolás sikertelen");
    }
  }

  return (
    <AppShell title="Gáz rendelés">
      <p className="mb-4 text-sm text-muted-foreground">
        Telephelyi üres palackok (SIAD és saját) automatikus rendelési listája.
      </p>

      {isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Betöltés…</div>}
      {isError && <div className="py-8 text-center text-sm text-destructive">Lista betöltése sikertelen</div>}

      {!isLoading && !isError && (
        <>
          <Card className="mb-4 p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Összesítés</h2>
            <SummaryBlock title="SIAD" lines={summary.siad} />
            <SummaryBlock title="Saját" lines={summary.own} />
            {total === 0 && (
              <div className="text-sm text-muted-foreground">Nincs rendelhető üres palack a telephelyen</div>
            )}
          </Card>

          <div className="mb-4 space-y-3">
            <CylinderList title="SIAD palackok" cylinders={group.siad} />
            <CylinderList title="Saját palackok" cylinders={group.own} />
            <OrderEstimateCard group={group} priceMap={priceMap} />
          </div>

          <div className="flex flex-col gap-2">
            <Button size="lg" disabled={pdfBusy || total === 0} onClick={handlePdf}>
              <FileDown className="mr-2 h-5 w-5" />
              PDF rendelés készítése
            </Button>
            <Button size="lg" variant="outline" disabled={total === 0} onClick={handleCopy}>
              <Copy className="mr-2 h-5 w-5" />
              Szöveg másolása
            </Button>
          </div>
        </>
      )}
    </AppShell>
  );
}
