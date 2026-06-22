import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import {
  Truck,
  FileText,
  RotateCcw,
  ScrollText,
  ChevronRight,
  ClipboardList,
  Package,
  Tags,
  FileSpreadsheet,
  Boxes,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/more")({
  head: () => ({ meta: [{ title: "Több – Gáz Veled" }] }),
  component: More,
});

const items = [
  {
    to: "/gas-order",
    icon: Package,
    label: "Gáz rendelés",
    desc: "Üres telephelyi palackok rendelése",
  },
  { to: "/price-list", icon: Tags, label: "Árlista", desc: "Beszerzési ár, árrés, eladási ár" },
  {
    to: "/chinese-stock",
    icon: Boxes,
    label: "Kínai készlet",
    desc: "Darabszám alapú kínai palack készlet",
  },
  {
    to: "/flaga-stock",
    icon: Boxes,
    label: "FLAGA készlet",
    desc: "Darabszám alapú FLAGA palack készlet",
  },
  {
    to: "/flaga-pb-stock",
    icon: Boxes,
    label: "FLAGA PB készlet",
    desc: "Körforgásos FLAGA PB palack készlet",
  },
  {
    to: "/prima-pb-stock",
    icon: Boxes,
    label: "PRÍMA PB készlet",
    desc: "Körforgásos PRÍMA PB palack készlet",
  },
  {
    to: "/quotes",
    icon: FileSpreadsheet,
    label: "Árajánlat",
    desc: "Partner ajánlatok készítése, PDF",
  },
  {
    to: "/inventory",
    icon: ClipboardList,
    label: "Leltár",
    desc: "Meglévő palackállomány feltöltése",
  },
  { to: "/suppliers", icon: Truck, label: "Beszállítói cserék", desc: "SIAD / Saját szolgáltató" },
  {
    to: "/rental-return",
    icon: RotateCcw,
    label: "Bérlet visszavétel",
    desc: "Aktív bérlet zárása",
  },
  { to: "/rentals", icon: FileText, label: "Bérletek", desc: "Aktív és lezárt bérletek" },
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
                <div className="rounded-md bg-primary/15 p-2 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
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
