import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, RefreshCw, Cylinder, Users, MoreHorizontal } from "lucide-react";
import { signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";

const tabs = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Áttekintés" },
  { to: "/quick-exchange", icon: RefreshCw, label: "Gyors csere" },
  { to: "/cylinders", icon: Cylinder, label: "Palackok" },
  { to: "/partners", icon: Users, label: "Partnerek" },
  { to: "/more", icon: MoreHorizontal, label: "Több" },
] as const;

export function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  const loc = useLocation();
  return (
    <div className="flex min-h-screen flex-col bg-background pb-20">
      <header className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/dashboard" className="text-sm font-bold tracking-wide text-foreground">
            <span className="text-primary">GÁZ</span> VELED
          </Link>
          {title && <h1 className="text-sm font-medium text-muted-foreground">{title}</h1>}
          <Button variant="ghost" size="sm" onClick={() => signOut()}>Kilépés</Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">{children}</main>
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur">
        <ul className="mx-auto flex max-w-3xl">
          {tabs.map((t) => {
            const active = loc.pathname === t.to || (t.to !== "/dashboard" && loc.pathname.startsWith(t.to));
            const Icon = t.icon;
            return (
              <li key={t.to} className="flex-1">
                <Link
                  to={t.to}
                  className={`flex flex-col items-center gap-1 px-2 py-3 text-[11px] font-medium transition-colors ${
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
