import { createFileRoute, Link } from "@tanstack/react-router";

import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

import { AppShell } from "@/components/AppShell";

import { Card } from "@/components/ui/card";

import { Badge } from "@/components/ui/badge";

import {
  AlertTriangle,
  RefreshCw,
  Cylinder,
  Boxes,
  TrendingUp,
  FileText,
  Bell,
  Calendar,
  Gift,
  Package,
  Banknote,
  BarChart3,
  Warehouse,
} from "lucide-react";

import { fmtDate, isRentalExpired, rentalTypeLabels, effectiveRentalExpiry, rentalDisplayStatus, type RentalType } from "@/lib/labels";

import {
  daysUntil,
  formatExpiryWarning,
  formatInvoiceWarning,
  invoiceUrgency,
} from "@/lib/rental-billing";

import { rentalNumber } from "@/lib/rental-ops";

import {
  fetchExchangeProfitStats,
  fetchTopExchangedProducts,
  fetchWarehouseInventoryValue,
  formatProfit,
} from "@/lib/dashboard-stats";
import { fetchChineseStock } from "@/lib/chinese-stock";
import { fetchFlagaPbStock, sumFlagaPbCounts } from "@/lib/flaga-pb-stock";
import { fetchPrimaPbStock, sumPrimaPbCounts } from "@/lib/prima-pb-stock";
import { fetchActiveDeployedQuantitySummary } from "@/lib/rental-quantity-stock";
import { UninvoicedExchangesCard } from "@/components/UninvoicedExchangesCard";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Áttekintés – Gáz Veled" }] }),

  component: Dashboard,
});

type RentalWidget = {
  id: string;

  next_invoice_date: string | null;

  expiry_date: string | null;

  rental_type: RentalType | null;

  monthly_fee: number;

  partners: { name: string } | null;
};

function Dashboard() {
  const {
    data: stats,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["dashboard-stats"],

    queryFn: async () => {
      const { data: cyls, error: cylErr } = await supabase
        .from("cylinders")
        .select("circulation,status,location_type,last_movement_at")
        .eq("active", true);

      if (cylErr) throw cylErr;

      const { count: forced, error: forcedErr } = await supabase
        .from("exchanges")
        .select("*", { count: "exact", head: true })
        .eq("is_forced_substitution", true);

      if (forcedErr) throw forcedErr;

      const { data: rentals, error: rentErr } = await supabase

        .from("rentals")

        .select(
          "id, monthly_fee, status, start_date, next_invoice_date, expiry_date, rental_type, partners(name)",
        )

        .eq("status", "active");

      if (rentErr) throw rentErr;

      const { data: openRentals, error: openRentErr } = await supabase
        .from("rentals")
        .select("id, status, start_date, expiry_date")
        .neq("status", "closed");

      if (openRentErr) throw openRentErr;

      const expiredRentalCount = (openRentals ?? []).filter((r) => {
        const expiry = effectiveRentalExpiry(r.start_date, r.expiry_date);
        return rentalDisplayStatus(r.status, expiry) === "expired";
      }).length;

      const activeRentalIds = (rentals ?? []).map((r) => r.id);

      let rentedCylCount = 0;

      if (activeRentalIds.length > 0) {
        const { count, error: rcErr } = await supabase

          .from("rental_cylinders")

          .select("*", { count: "exact", head: true })

          .in("rental_id", activeRentalIds)

          .is("removed_at", null);

        if (rcErr) throw rcErr;

        rentedCylCount = count ?? 0;
      }

      const list = cyls ?? [];

      const by = (p: (c: (typeof list)[number]) => boolean) => list.filter(p).length;

      const now = Date.now();

      const atSiad = list.filter((c) => c.location_type === "siad");

      const daysAt = (d: string | null) =>
        d ? Math.floor((now - new Date(d).getTime()) / 86400000) : 0;

      const risk120 = atSiad.filter((c) => {
        const d = daysAt(c.last_movement_at);
        return d >= 120 && d < 180;
      }).length;

      const risk180 = atSiad.filter((c) => {
        const d = daysAt(c.last_movement_at);
        return d >= 180 && d < 365;
      }).length;

      const risk365 = atSiad.filter((c) => daysAt(c.last_movement_at) >= 365).length;

      const activeRentals = (rentals ?? []) as RentalWidget[];

      const monthlyDue = activeRentals

        .filter((r) => r.rental_type === "monthly" && r.next_invoice_date)

        .map((r) => ({ ...r, days: daysUntil(r.next_invoice_date) }))

        .filter((r) => r.days !== null && r.days <= 5)

        .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

      const yearlyExpiring = activeRentals

        .filter(
          (r) =>
            (r.rental_type === "yearly" || !r.rental_type || r.rental_type === "free") &&
            r.expiry_date,
        )

        .map((r) => ({ ...r, days: daysUntil(r.expiry_date) }))

        .filter((r) => r.days !== null && r.days <= 30)

        .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

      const freeLoans = activeRentals.filter((r) => r.rental_type === "free");

      const monthlyRevenue = activeRentals

        .filter((r) => r.rental_type === "monthly")

        .reduce((s, r) => s + Number(r.monthly_fee), 0);

      const [profitStats, warehouseValue, topProducts, chineseStock, flagaPbStock, primaPbStock, deployedQty] =
        await Promise.all([
        fetchExchangeProfitStats(),
        fetchWarehouseInventoryValue(),
        fetchTopExchangedProducts(5),
        fetchChineseStock(),
        fetchFlagaPbStock(),
        fetchPrimaPbStock(),
        fetchActiveDeployedQuantitySummary(),
      ]);

      const chineseTotals = (chineseStock ?? []).reduce(
        (acc, r) => ({ full: acc.full + r.full_count, empty: acc.empty + r.empty_count }),
        { full: 0, empty: 0 },
      );
      const flagaPbTotals = sumFlagaPbCounts(flagaPbStock ?? []);
      const primaPbTotals = sumPrimaPbCounts(primaPbStock ?? []);

      return {
        fullSiad: by((c) => c.status === "full" && c.circulation === "siad"),

        emptySiad: by((c) => c.status === "empty" && c.circulation === "siad"),

        fullOwn: by((c) => c.status === "full" && c.circulation === "own"),

        emptyOwn: by((c) => c.status === "empty" && c.circulation === "own"),

        atCustomer: by((c) => c.location_type === "customer"),

        warehouse: by(
          (c) => c.location_type === "warehouse_full" || c.location_type === "warehouse_empty",
        ),

        forced: forced ?? 0,

        activeRentals: activeRentals.length,

        expiredRentalCount,

        rentedCylinders: rentedCylCount ?? 0,

        monthlyRevenue,

        monthlyDue,

        yearlyExpiring,

        freeLoans,

        risk120,
        risk180,
        risk365,

        orderableSiad: by(
          (c) =>
            c.status === "empty" &&
            c.location_type === "warehouse_empty" &&
            c.circulation === "siad",
        ),

        orderableOwn: by(
          (c) =>
            c.status === "empty" &&
            c.location_type === "warehouse_empty" &&
            c.circulation === "own",
        ),

        warehouseFullSerial: by((c) => c.location_type === "warehouse_full"),
        warehouseEmptySerial: by((c) => c.location_type === "warehouse_empty"),

        profitStats,
        warehouseValue,
        topProducts,
        chineseTotals,
        flagaPbTotals,
        primaPbTotals,
        deployedQty,
      };
    },
  });

  if (isLoading) {
    return (
      <AppShell title="Áttekintés">
        <div className="py-8 text-center text-sm text-muted-foreground">Betöltés…</div>
      </AppShell>
    );
  }

  if (isError) {
    return (
      <AppShell title="Áttekintés">
        <div className="py-8 text-center text-sm text-destructive">
          Dashboard betöltése sikertelen
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Áttekintés">
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          to="/quick-exchange"
          className="flex items-center justify-between rounded-xl bg-gradient-to-r from-primary to-primary/70 p-5 text-primary-foreground shadow-lg transition-transform active:scale-[0.98]"
        >
          <div>
            <div className="text-xs uppercase tracking-wider opacity-80">Egy érintésre</div>

            <div className="mt-1 text-xl font-bold">Gyors csere</div>
          </div>

          <RefreshCw className="h-8 w-8" />
        </Link>

        <Link
          to="/rentals"
          search={{ status: "expired" }}
          className="flex items-center justify-between rounded-xl bg-gradient-to-r from-destructive to-destructive/80 p-5 text-destructive-foreground shadow-lg transition-transform active:scale-[0.98]"
        >
          <div>
            <div className="text-xs uppercase tracking-wider opacity-90">Figyelmeztetés</div>

            <div className="mt-1 text-xl font-bold">Lejárt bérletek</div>

            <div className="mt-1 text-2xl font-bold">{stats?.expiredRentalCount ?? 0} db</div>
          </div>

          <AlertTriangle className="h-8 w-8" />
        </Link>
      </div>

      <h2 className="mb-2 text-sm font-semibold">Készlet áttekintés</h2>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="mb-3 text-sm font-semibold">Kínai</div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div>
              <div className="text-lg font-bold">{stats?.chineseTotals?.full ?? "—"}</div>
              <div className="text-xs text-muted-foreground">Teli</div>
            </div>
            <div>
              <div className="text-lg font-bold">{stats?.chineseTotals?.empty ?? "—"}</div>
              <div className="text-xs text-muted-foreground">Üres</div>
            </div>
            <div>
              <div className="text-lg font-bold">{stats?.deployedQty?.chinese ?? "—"}</div>
              <div className="text-xs text-muted-foreground">Bérletben</div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-3 text-sm font-semibold">FLAGA PB</div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div>
              <div className="text-lg font-bold">{stats?.flagaPbTotals?.full ?? "—"}</div>
              <div className="text-xs text-muted-foreground">Teli</div>
            </div>
            <div>
              <div className="text-lg font-bold">{stats?.flagaPbTotals?.empty ?? "—"}</div>
              <div className="text-xs text-muted-foreground">Üres</div>
            </div>
            <div>
              <div className="text-lg font-bold">{stats?.deployedQty?.flaga_pb ?? "—"}</div>
              <div className="text-xs text-muted-foreground">Bérletben</div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-3 text-sm font-semibold">PRÍMA PB</div>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div>
              <div className="text-lg font-bold">{stats?.primaPbTotals?.full ?? "—"}</div>
              <div className="text-xs text-muted-foreground">Teli</div>
            </div>
            <div>
              <div className="text-lg font-bold">{stats?.primaPbTotals?.empty ?? "—"}</div>
              <div className="text-xs text-muted-foreground">Üres</div>
            </div>
            <div>
              <div className="text-lg font-bold">{stats?.deployedQty?.prima_pb ?? "—"}</div>
              <div className="text-xs text-muted-foreground">Bérletben</div>
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Sorszámos – telephelyen (teli)</div>
          <div className="mt-1 text-2xl font-bold">{stats?.warehouseFullSerial ?? "—"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Sorszámos – telephelyen (üres)</div>
          <div className="mt-1 text-2xl font-bold">{stats?.warehouseEmptySerial ?? "—"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Sorszámos – bérletben</div>
          <div className="mt-1 text-2xl font-bold">{stats?.rentedCylinders ?? "—"}</div>
        </Card>
      </div>

      <h2 className="mb-2 text-sm font-semibold">Nyereség (csere)</h2>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Banknote className="h-3.5 w-3.5" /> Mai nyereség
          </div>
          <div className="mt-1 text-xl font-bold">
            {formatProfit(stats?.profitStats?.todayProfit ?? 0)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" /> Havi nyereség
          </div>
          <div className="mt-1 text-xl font-bold">
            {formatProfit(stats?.profitStats?.monthProfit ?? 0)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Banknote className="h-3.5 w-3.5" /> Éves nyereség
          </div>
          <div className="mt-1 text-xl font-bold">
            {formatProfit(stats?.profitStats?.yearProfit ?? 0)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5" /> Cserék száma (hó)
          </div>
          <div className="mt-1 text-2xl font-bold">
            {stats?.profitStats?.monthExchangeCount ?? "—"}
          </div>
        </Card>
        <Card className="col-span-2 p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5" /> Átlag profit/csere (hó)
          </div>
          <div className="mt-1 text-xl font-bold">
            {stats?.profitStats?.monthAvgProfit != null
              ? formatProfit(stats.profitStats.monthAvgProfit)
              : "—"}
          </div>
        </Card>
        <Card className="col-span-2 p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Warehouse className="h-3.5 w-3.5" /> Telephelyi készlet értéke
          </div>
          <div className="mt-1 text-xl font-bold">
            {formatProfit(stats?.warehouseValue?.totalValue ?? 0)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Teli palackok beszerzési áron (telephely)
          </div>
        </Card>
      </div>

      <UninvoicedExchangesCard />

      {(stats?.topProducts?.length ?? 0) > 0 && (
        <Card className="mb-4 p-4">
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <div className="text-sm font-semibold">Havi legtöbbet cserélt termékek</div>
          </div>
          <ul className="space-y-1 text-sm">
            {stats!.topProducts.map((p) => (
              <li key={p.label} className="flex justify-between">
                <span>{p.label}</span>
                <span className="font-medium">{p.count} csere</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Link to="/gas-order">
        <Card className="mb-4 p-4 transition-colors hover:bg-accent/50">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Package className="h-3.5 w-3.5" /> Rendelhető üres palackok
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <div className="text-2xl font-bold">{stats?.orderableSiad ?? "—"}</div>
              <div className="text-xs text-muted-foreground">SIAD üres</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{stats?.orderableOwn ?? "—"}</div>
              <div className="text-xs text-muted-foreground">Saját üres</div>
            </div>
          </div>
        </Card>
      </Link>

      <h2 className="mb-2 text-sm font-semibold">Bérletek</h2>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Cylinder className="h-3.5 w-3.5" /> Bérletben lévő palackok
          </div>

          <div className="mt-1 text-2xl font-bold">{stats?.rentedCylinders ?? "—"} db</div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> Aktív bérleti szerződés
          </div>

          <div className="mt-1 text-2xl font-bold">{stats?.activeRentals ?? "—"}</div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" /> Havi bérleti bevétel
          </div>

          <div className="mt-1 text-xl font-bold">
            {(stats?.monthlyRevenue ?? 0).toLocaleString("hu-HU")} Ft
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Bell className="h-3.5 w-3.5" /> 5 napon belül számlázandó
          </div>

          <div className="mt-1 text-2xl font-bold">{stats?.monthlyDue?.length ?? "—"}</div>
        </Card>
      </div>

      {(stats?.yearlyExpiring?.length ?? 0) > 0 && (
        <Card className="mb-4 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-warning" />

            <div className="text-sm font-semibold">Hamarosan lejáró / lejárt bérletek</div>
          </div>

          <div className="space-y-2">
            {stats!.yearlyExpiring.map((r) => {
              const partnerName = r.partners?.name ?? "—";

              const urgency = invoiceUrgency(r.days);

              const tone =
                urgency === "red"
                  ? "border-destructive/50 bg-destructive/10"
                  : "border-warning/50 bg-warning/10";

              return (
                <Link key={r.id} to="/rentals/$id" params={{ id: r.id }}>
                  <div className={`rounded-lg border p-3 text-sm ${tone}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{partnerName}</span>

                      <div className="flex gap-1">
                        {isRentalExpired(r.expiry_date) && (
                          <Badge variant="destructive">LEJÁRT</Badge>
                        )}

                        <Badge variant="outline" className="font-mono text-[10px]">
                          {rentalNumber(r.id)}
                        </Badge>
                      </div>
                    </div>

                    <div className="mt-1 text-xs">{formatExpiryWarning(partnerName, r.days!)}</div>

                    <div
                      className={`mt-1 text-xs ${isRentalExpired(r.expiry_date) ? "font-medium text-destructive" : "text-muted-foreground"}`}
                    >
                      Lejárat: {fmtDate(r.expiry_date)}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      {(stats?.monthlyDue?.length ?? 0) > 0 && (
        <Card className="mb-4 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Bell className="h-4 w-4 text-warning" />

            <div className="text-sm font-semibold">5 napon belül számlázandó havi bérletek</div>
          </div>

          <div className="space-y-2">
            {stats!.monthlyDue.map((r) => {
              const partnerName = r.partners?.name ?? "—";

              const urgency = invoiceUrgency(r.days);

              const tone =
                urgency === "red"
                  ? "border-destructive/50 bg-destructive/10"
                  : "border-warning/50 bg-warning/10";

              return (
                <Link key={r.id} to="/rentals/$id" params={{ id: r.id }}>
                  <div className={`rounded-lg border p-3 text-sm ${tone}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{partnerName}</span>

                      <Badge variant="outline" className="font-mono text-[10px]">
                        {rentalNumber(r.id)}
                      </Badge>
                    </div>

                    <div className="mt-1 text-xs">{formatInvoiceWarning(partnerName, r.days!)}</div>

                    <div className="mt-1 text-xs text-muted-foreground">
                      Esedékes: {fmtDate(r.next_invoice_date)}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      {(stats?.freeLoans?.length ?? 0) > 0 && (
        <Card className="mb-4 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Gift className="h-4 w-4 text-primary" />

            <div className="text-sm font-semibold">Díjmentes kölcsönök</div>
          </div>

          <div className="space-y-2">
            {stats!.freeLoans.map((r) => (
              <Link key={r.id} to="/rentals/$id" params={{ id: r.id }}>
                <div className="rounded-lg border border-border/60 p-3 text-sm transition-colors hover:bg-accent/50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{r.partners?.name ?? "—"}</span>

                    <Badge variant="outline">{rentalTypeLabels.free}</Badge>
                  </div>

                  {r.expiry_date && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Lejárat: {fmtDate(r.expiry_date)}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Teli – SIAD" value={stats?.fullSiad} tint="siad" />

        <StatCard label="Üres – SIAD" value={stats?.emptySiad} tint="siad" muted />

        <StatCard label="Teli – Saját" value={stats?.fullOwn} tint="own" />

        <StatCard label="Üres – Saját" value={stats?.emptyOwn} tint="own" muted />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Boxes className="h-3.5 w-3.5" /> Telephelyen
          </div>

          <div className="mt-1 text-2xl font-bold">{stats?.warehouse ?? "—"}</div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Cylinder className="h-3.5 w-3.5" /> Partnernél
          </div>

          <div className="mt-1 text-2xl font-bold">{stats?.atCustomer ?? "—"}</div>
        </Card>
      </div>

      <Card className="mt-3 p-4">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warning" />

          <div className="text-sm font-semibold">SIAD kockázat</div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <RiskBadge label="120+ nap" value={stats?.risk120} tone="warning" />

          <RiskBadge label="180+ nap" value={stats?.risk180} tone="danger" />

          <RiskBadge label="365+ nap" value={stats?.risk365} tone="destructive" />
        </div>
      </Card>

      <Card className="mt-3 p-4">
        <div className="text-xs text-muted-foreground">Kényszerhelyettesítések</div>

        <div className="mt-1 text-2xl font-bold">{stats?.forced ?? "—"}</div>
      </Card>
    </AppShell>
  );
}

function StatCard({
  label,
  value,
  tint,
  muted,
}: {
  label: string;
  value: number | undefined;
  tint: "siad" | "own";
  muted?: boolean;
}) {
  return (
    <Card className={`p-4 ${muted ? "opacity-90" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>

        <span
          className={`h-2 w-2 rounded-full ${tint === "siad" ? "bg-[var(--siad)]" : "bg-[var(--own)]"}`}
        />
      </div>

      <div className="mt-2 text-3xl font-bold">{value ?? "—"}</div>
    </Card>
  );
}

function RiskBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone: "warning" | "danger" | "destructive";
}) {
  const color =
    tone === "warning"
      ? "bg-warning/20 text-warning"
      : tone === "danger"
        ? "bg-[color:var(--danger)]/20 text-[color:var(--danger)]"
        : "bg-destructive/25 text-destructive";

  return (
    <div className={`rounded-lg p-2 ${color}`}>
      <div className="text-xl font-bold">{value ?? "—"}</div>

      <div className="text-[10px] uppercase tracking-wide">{label}</div>
    </div>
  );
}
