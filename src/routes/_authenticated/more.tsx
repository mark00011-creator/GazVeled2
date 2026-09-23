import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/organization";
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
  Wrench,
  Building2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/more")({
  head: () => ({ meta: [{ title: "Több – Gáz Veled" }] }),
  component: More,
});

type MoreItem = {
  to: string;
  icon: typeof Package;
  label: string;
  desc: string;
  platformOnly?: boolean;
  module?:
    | "flaga_pb"
    | "prima_pb"
    | "chinese_stock"
    | "rentals"
    | "tool_rental"
    | "quotes"
    | "gas_orders"
    | "suppliers";
};

const adminItems: MoreItem[] = [
  {
    to: "/platform-organizations",
    icon: Building2,
    label: "Cégek (platform)",
    desc: "Új ügyfélcég, bemutató váltás Gáz Veled ↔ Minta",
    platformOnly: true,
  },
  {
    to: "/organization-settings",
    icon: Building2,
    label: "Cég beállítások",
    desc: "Név, logó, modulok, kalodák, számlázási irányelvek",
  },
  {
    to: "/users",
    icon: ScrollText,
    label: "Jogosultságok",
    desc: "Dolgozók, szerepkörök, céghez rendelés",
  },
  {
    to: "/rental-import",
    icon: FileSpreadsheet,
    label: "Bérlet import",
    desc: "Excel bérlések migrálása (egyszeri admin)",
    module: "rentals",
  },
];

const items: MoreItem[] = [
  {
    to: "/tool-rental/stock",
    icon: Wrench,
    label: "Eszközök és fogyóanyagok",
    desc: "Darabszámos készlet, árak, bevételezés, értékesítés",
    module: "tool_rental",
  },
  {
    to: "/gas-order",
    icon: Package,
    label: "Gáz rendelés",
    desc: "Üres telephelyi palackok rendelése",
    module: "gas_orders",
  },
  {
    to: "/gas-order-flaga",
    icon: Package,
    label: "Gáz rendelés FLAGA",
    desc: "FLAGA PB üres palackok rendelése",
    module: "flaga_pb",
  },
  { to: "/price-list", icon: Tags, label: "Árlista", desc: "Beszerzési ár, árrés, eladási ár" },
  {
    to: "/chinese-stock",
    icon: Boxes,
    label: "Kínai készlet",
    desc: "Darabszám alapú kínai palack készlet",
    module: "chinese_stock",
  },
  {
    to: "/flaga-pb-stock",
    icon: Boxes,
    label: "FLAGA PB készlet",
    desc: "Körforgásos FLAGA PB palack készlet",
    module: "flaga_pb",
  },
  {
    to: "/prima-pb-stock",
    icon: Boxes,
    label: "PRÍMA PB készlet",
    desc: "Körforgásos PRÍMA PB palack készlet",
    module: "prima_pb",
  },
  {
    to: "/quotes",
    icon: FileSpreadsheet,
    label: "Árajánlat",
    desc: "Partner ajánlatok készítése, PDF",
    module: "quotes",
  },
  {
    to: "/inventory",
    icon: ClipboardList,
    label: "Leltár",
    desc: "Meglévő palackállomány feltöltése",
  },
  {
    to: "/suppliers",
    icon: Truck,
    label: "Beszállítói cserék",
    desc: "SIAD / Saját szolgáltató",
    module: "suppliers",
  },
  {
    to: "/delivery-notes",
    icon: FileText,
    label: "Szállítólevelek",
    desc: "ADR szállítólevél / palackcsere bizonylat, kézi és előzményből",
  },
  {
    to: "/rental-return",
    icon: RotateCcw,
    label: "Bérlet visszavétel",
    desc: "Aktív bérlet zárása",
    module: "rentals",
  },
  {
    to: "/loaned-cylinders",
    icon: HandCoins,
    label: "Kölcsönadott",
    desc: "Aktív kölcsön palackok és visszavétel",
  },
  {
    to: "/rentals",
    icon: FileText,
    label: "Bérletek",
    desc: "Aktív és lezárt bérletek",
    module: "rentals",
  },
  { to: "/audit", icon: ScrollText, label: "Audit napló", desc: "Műveleti előzmények" },
];

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
  const { orgSettings, isPlatformAdmin } = useAuth();

  const visibleAdmin = adminItems.filter((it) => {
    if (it.platformOnly && !isPlatformAdmin) return false;
    return !it.module || isModuleEnabled(orgSettings, it.module);
  });
  const visibleItems = items.filter((it) => !it.module || isModuleEnabled(orgSettings, it.module));

  return (
    <AppShell title="Több">
      <div className="space-y-4">
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Admin / migráció
          </h2>
          <div className="space-y-2">
            {visibleAdmin.map((it) => (
              <MoreLink key={it.to} {...it} highlight />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Műveletek
          </h2>
          <div className="space-y-2">
            {visibleItems.map((it) => (
              <MoreLink key={it.to} {...it} />
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
