import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { circulationLabels, fmtDateTime, locationLabels, statusLabels } from "@/lib/labels";

export const Route = createFileRoute("/_authenticated/cylinders/$id")({
  head: () => ({ meta: [{ title: "Palack – Gáz Veled" }] }),
  component: CylinderDetail,
});

function CylinderDetail() {
  const { id } = Route.useParams();
  const { data: cyl } = useQuery({
    queryKey: ["cyl-d", id],
    queryFn: async () => (await supabase.from("cylinders").select("*").eq("id", id).single()).data,
  });
  const { data: moves } = useQuery({
    queryKey: ["cyl-moves", id],
    queryFn: async () => (await supabase.from("movements").select("*").eq("cylinder_id", id).order("created_at", { ascending: false })).data ?? [],
  });

  return (
    <AppShell title="Palack">
      <Link to="/cylinders"><Button variant="ghost" size="sm" className="mb-3"><ArrowLeft className="mr-1 h-4 w-4" /> Vissza</Button></Link>
      {cyl && (
        <Card className="p-4">
          <div className="font-mono text-lg font-bold">{cyl.barcode}</div>
          <div className="mt-1 text-sm text-muted-foreground">{cyl.gas_type} · {cyl.size}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge style={{ backgroundColor: cyl.circulation === "siad" ? "var(--siad)" : "var(--own)" }} className="text-background">{circulationLabels[cyl.circulation]}</Badge>
            <Badge variant="outline">{statusLabels[cyl.status]}</Badge>
            <Badge variant="secondary">{locationLabels[cyl.location_type]}</Badge>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">Utolsó mozgás: {fmtDateTime(cyl.last_movement_at)}</div>
        </Card>
      )}

      <h2 className="mb-2 mt-4 text-sm font-semibold">Előélet</h2>
      <div className="space-y-2">
        {(moves ?? []).map((m) => (
          <Card key={m.id} className="p-3">
            <div className="flex items-center justify-between text-xs">
              <span>{locationLabels[m.from_location ?? ""] ?? "—"} → {locationLabels[m.to_location]}</span>
              <span className="text-muted-foreground">{fmtDateTime(m.created_at)}</span>
            </div>
            {m.note && <div className="mt-1 text-xs text-muted-foreground">{m.note}</div>}
          </Card>
        ))}
        {moves && moves.length === 0 && <div className="py-4 text-center text-sm text-muted-foreground">Nincs mozgás</div>}
      </div>
    </AppShell>
  );
}
