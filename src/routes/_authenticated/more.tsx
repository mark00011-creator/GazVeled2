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
  HandCoins,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/more")({
  head: () => ({ meta: [{ title: "Több – Gáz Veled" }] }),
  component: More,
});

const adminItems = [
  {
    to: "/rental-import",
    icon: FileSpreadsheet,
    label: "Bérlet import",
    desc: "Excel bérlések migrálása (egyszeri admin)",
  },
] as const;

const items = [
  {
    to: "/gas-order",
    icon: Package,
    label: "Gáz rendelés",
    desc: "Üres telephelyi palackok rendelése",
  },
  {
    to: "/gas-order-flaga",
    icon: Package,
    label: "Gáz rendelés FLAGA",
    desc: "FLAGA PB üres palackok rendelése",
  },
  { to: "/price-list", icon: Tags, label: "Árlista", desc: "Beszerzési ár, árrés, eladási ár" },
  {
    to: "/chinese-stock",
    icon: Boxes,
    label: "Kínai készlet",
    desc: "Darabszám alapú kínai palack készlet",
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
  {
    to: "/loaned-cylinders",
    icon: HandCoins,
    label: "Kölcsönadott",
    desc: "Aktív kölcsön palackok és visszavétel",
  },
  { to: "/rentals", icon: FileText, label: "Bérletek", desc: "Aktív és lezárt bérletek" },
  { to: "/audit", icon: ScrollText, label: "Audit napló", desc: "Műveleti előzmények" },
] as const;

function MoreLink({
  to,
  icon: Icon,
  label,
  desc,
  highlight,
}: {
  to: string;
  icon: typeof Package;
  label: string;
  desc: string;
  highlight?: boolean;
}) {
  return (
    <Link to={to as never}>
      <Card
        className={`flex items-center gap-3 p-3 transition-colors hover:bg-accent/50 ${
          highlight ? "border-amber-500/40 bg-amber-500/5" : ""
        }`}
      >
        <div
          className={`rounded-md p-2 ${
            highlight ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-primary/15 text-primary"
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">{label}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Card>
    </Link>
  );
}

function More() {
  return (
    <AppShell title="Több">
      <div className="space-y-4">
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Admin / migráció
          </h2>
          <div className="space-y-2">
            {adminItems.map((it) => (
              <MoreLink key={it.to} {...it} highlight />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Műveletek
          </h2>
          <div className="space-y-2">
            {items.map((it) => (
              <MoreLink key={it.to} {...it} />
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
