import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { signOut, useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export function OperatorShell({ children }: { children: React.ReactNode }) {
  const { organization } = useAuth();
  const name = organization?.name?.trim() || "Gáz Veled";
  const logo = organization?.logo_url;

  return (
    <div className="flex min-h-screen flex-col bg-background pb-20">
      <header className="sticky top-0 z-30 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/quick-exchange" className="text-sm font-bold tracking-wide text-foreground">
            {logo ? (
              <span className="flex items-center gap-2">
                <img src={logo} alt="" className="h-7 w-7 rounded object-contain" />
                <span className="max-w-[9rem] truncate">{name}</span>
              </span>
            ) : organization && organization.slug !== "gaz-veeled" ? (
              name
            ) : (
              <>
                <span className="text-primary">GÁZ</span> VELED
              </>
            )}
          </Link>
          <span className="text-xs text-muted-foreground">Gyors csere</span>
          <Button variant="ghost" size="sm" onClick={() => signOut()}>
            Kilépés
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4">{children}</main>
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur">
        <ul className="mx-auto flex max-w-3xl">
          <li className="flex-1">
            <Link
              to="/quick-exchange"
              className="flex flex-col items-center gap-1 px-2 py-3 text-[11px] font-medium text-primary"
            >
              <RefreshCw className="h-5 w-5" />
              Gyors csere
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
