import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Truck, FileText, RotateCcw, ScrollText, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/more")({
  head: () => ({ meta: [{ title: "Több – Gáz Veled" }] }),
  component: More,
});

const items = [
  { to: "/suppliers", icon: Truck, label: "Beszállítói cserék", desc: "SIAD / Saját szolgáltató" },
  { to: "/rental-return", icon: RotateCcw, label: "Bérlet visszavétel", desc: "Aktív bérlet zárása" },
  { to: "/rentals", icon: FileText, label: "Bérletek", desc: "Lista (hamarosan)" },
  { to: "/audit", icon: ScrollText, label: "Audit napló", desc: "Műveleti előzmények" },
] as const;

function More() {
  return (
    <AppShell title="Több">
      <div className="space-y-2">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <Link key={it.to} to={it.to as never}>
              <Card className="flex items-center gap-3 p-3 transition-colors hover:bg-accent/50">
                <div className="rounded-md bg-primary/15 p-2 text-primary"><Icon className="h-5 w-5" /></div>
                <div className="flex-1">
                  <div className="text-sm font-semibold">{it.label}</div>
                  <div className="text-xs text-muted-foreground">{it.desc}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Card>
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
