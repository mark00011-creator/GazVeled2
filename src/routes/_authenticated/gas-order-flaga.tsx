import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { GasQuantityOrderPanel } from "@/components/GasQuantityOrderPanel";
import { fetchOrderableFlagaPbLines } from "@/lib/gas-order-quantity";

export const Route = createFileRoute("/_authenticated/gas-order-flaga")({
  head: () => ({ meta: [{ title: "Gáz rendelés FLAGA – Gáz Veled" }] }),
  component: GasOrderFlagaPage,
});

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
