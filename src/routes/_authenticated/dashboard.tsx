import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, RefreshCw, Cylinder, Boxes, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Áttekintés – Gáz Veled" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const { data: cyls } = await supabase.from("cylinders").select("circulation,status,location_type,last_movement_at").eq("active", true);
      const { count: forced } = await supabase.from("exchanges").select("*", { count: "exact", head: true }).eq("is_forced_substitution", true);
      const { data: rentals } = await supabase.from("rentals").select("monthly_fee,status").eq("status", "active");

      const list = cyls ?? [];
      const by = (p: (c: typeof list[number]) => boolean) => list.filter(p).length;
      const now = Date.now();
      const atSiad = list.filter((c) => c.location_type === "siad");
      const daysAt = (d: string | null) => (d ? Math.floor((now - new Date(d).getTime()) / 86400000) : 0);
      const risk120 = atSiad.filter((c) => { const d = daysAt(c.last_movement_at); return d >= 120 && d < 180; }).length;
      const risk180 = atSiad.filter((c) => { const d = daysAt(c.last_movement_at); return d >= 180 && d < 365; }).length;
      const risk365 = atSiad.filter((c) => daysAt(c.last_movement_at) >= 365).length;

      return {
        fullSiad: by((c) => c.status === "full" && c.circulation === "siad"),
        emptySiad: by((c) => c.status === "empty" && c.circulation === "siad"),
        fullOwn: by((c) => c.status === "full" && c.circulation === "own"),
        emptyOwn: by((c) => c.status === "empty" && c.circulation === "own"),
        atCustomer: by((c) => c.location_type === "customer"),
        warehouse: by((c) => c.location_type === "warehouse_full" || c.location_type === "warehouse_empty"),
        forced: forced ?? 0,
        monthlyRevenue: (rentals ?? []).reduce((s, r) => s + Number(r.monthly_fee), 0),
        risk120, risk180, risk365,
      };
    },
  });

  return (
    <AppShell title="Áttekintés">
      <Link to="/quick-exchange" className="mb-4 flex items-center justify-between rounded-xl bg-gradient-to-r from-primary to-primary/70 p-5 text-primary-foreground shadow-lg transition-transform active:scale-[0.98]">
        <div>
          <div className="text-xs uppercase tracking-wider opacity-80">Egy érintésre</div>
          <div className="mt-1 text-xl font-bold">Gyors csere</div>
        </div>
        <RefreshCw className="h-8 w-8" />
      </Link>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Teli – SIAD" value={stats?.fullSiad} tint="siad" />
        <StatCard label="Üres – SIAD" value={stats?.emptySiad} tint="siad" muted />
        <StatCard label="Teli – Saját" value={stats?.fullOwn} tint="own" />
        <StatCard label="Üres – Saját" value={stats?.emptyOwn} tint="own" muted />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Boxes className="h-3.5 w-3.5" /> Telephelyen</div>
          <div className="mt-1 text-2xl font-bold">{stats?.warehouse ?? "—"}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Cylinder className="h-3.5 w-3.5" /> Partnernél</div>
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

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Kényszerhelyettesítések</div>
          <div className="mt-1 text-2xl font-bold">{stats?.forced ?? "—"}</div>
          <Badge variant="outline" className="mt-2 text-[10px]">Életciklus során</Badge>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-1 text-xs text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" /> Havi bérleti</div>
          <div className="mt-1 text-2xl font-bold">{(stats?.monthlyRevenue ?? 0).toLocaleString("hu-HU")} Ft</div>
        </Card>
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, tint, muted }: { label: string; value: number | undefined; tint: "siad" | "own"; muted?: boolean }) {
  return (
    <Card className={`p-4 ${muted ? "opacity-90" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`h-2 w-2 rounded-full ${tint === "siad" ? "bg-[var(--siad)]" : "bg-[var(--own)]"}`} />
      </div>
      <div className="mt-2 text-3xl font-bold">{value ?? "—"}</div>
    </Card>
  );
}

function RiskBadge({ label, value, tone }: { label: string; value: number | undefined; tone: "warning" | "danger" | "destructive" }) {
  const color = tone === "warning" ? "bg-warning/20 text-warning" : tone === "danger" ? "bg-[color:var(--danger)]/20 text-[color:var(--danger)]" : "bg-destructive/25 text-destructive";
  return (
    <div className={`rounded-lg p-2 ${color}`}>
      <div className="text-xl font-bold">{value ?? "—"}</div>
      <div className="text-[10px] uppercase tracking-wide">{label}</div>
    </div>
  );
}
