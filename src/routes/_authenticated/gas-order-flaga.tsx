import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { GasQuantityOrderPanel } from "@/components/GasQuantityOrderPanel";
import { fetchOrderableFlagaPbLines } from "@/lib/gas-order-quantity";
import {
  buildFlagaPbCatalogStockLines,
  fetchFlagaPbStock,
  flagaPbProductKey,
} from "@/lib/flaga-pb-stock";

export const Route = createFileRoute("/_authenticated/gas-order-flaga")({
  head: () => ({ meta: [{ title: "Gáz rendelés FLAGA – Gáz Veled" }] }),
  component: GasOrderFlagaPage,
});

function FlagaPbStockOverview() {
  const { data: stock = [], isLoading, isError } = useQuery({
    queryKey: ["flaga-pb-stock"],
    queryFn: fetchFlagaPbStock,
  });

  const lines = useMemo(() => buildFlagaPbCatalogStockLines(stock), [stock]);

  if (isLoading) {
    return (
      <Card className="mb-4 p-4">
        <div className="text-sm text-muted-foreground">Készlet betöltése…</div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="mb-4 p-4">
        <div className="text-sm text-destructive">Teli készlet betöltése sikertelen</div>
      </Card>
    );
  }

  return (
    <Card className="mb-4 p-4">
      <h2 className="mb-3 text-sm font-semibold">FLAGA PB – teli készlet</h2>
      <p className="mb-3 text-xs text-muted-foreground">Csak tájékoztató – nem rendelhető.</p>
      <ul className="space-y-3">
        {lines.map((row) => (
          <li
            key={flagaPbProductKey(row.gas_type, row.size)}
            className="rounded-lg border p-3 text-sm"
          >
            <div className="font-medium">{row.label}</div>
            <div className="mt-1 text-muted-foreground">Teli: {row.full_count} db</div>
            <div className="text-muted-foreground">Üres: {row.empty_count} db</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function GasOrderFlagaPage() {
  const { data: lines = [], isLoading, isError } = useQuery({
    queryKey: ["gas-order-flaga-lines"],
    queryFn: fetchOrderableFlagaPbLines,
  });

  return (
    <AppShell title="Gáz rendelés FLAGA">
      <p className="mb-2 text-sm text-muted-foreground">
        <Link to="/gas-order" className="underline hover:text-foreground">
          ← Vissza a normál gáz rendeléshez
        </Link>
      </p>
      <p className="mb-4 text-sm text-muted-foreground">
        FLAGA PB üres palackok rendelése (11 kg Motorüzemű Flaga, Propán-Bután, Propán, Kompozit).
      </p>

      <FlagaPbStockOverview />

      {isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Betöltés…</div>}
      {isError && (
        <div className="py-8 text-center text-sm text-destructive">
          Lista betöltése sikertelen – ellenőrizd, hogy a FLAGA PB migráció fut-e productionben.
        </div>
      )}

      {!isLoading && !isError && (
        <GasQuantityOrderPanel
          title="FLAGA PB – rendelhető üres palackok"
          lines={lines}
          copyTitle="FLAGA PB"
          ordersQueryKey={["gas-orders", "flaga_pb"]}
        />
      )}
    </AppShell>
  );
}
