import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth, signOut } from "@/lib/auth";
import { authDiag } from "@/lib/auth-diag";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Flame } from "lucide-react";

export const Route = createFileRoute("/no-access")({
  head: () => ({ meta: [{ title: "Nincs hozzáférés – Gáz Veled" }] }),
  component: NoAccessPage,
});

function NoAccessPage() {
  const { user, profile, loading } = useAuth();

  authDiag({
    route: "no-access",
    loading,
    userId: user?.id ?? null,
    email: user?.email ?? profile?.email ?? null,
    profile: profile
      ? { role: profile.role, is_active: profile.is_active, email: profile.email }
      : null,
    role: profile?.role ?? null,
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm p-6 text-center">
        <div className="mb-4 flex justify-center">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Flame className="h-6 w-6" />
          </div>
        </div>
        <h1 className="text-lg font-bold">Nincs hozzáférés</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {user
            ? `A fiókod (${profile?.email ?? user.email ?? "—"}) nem rendelkezik alkalmazás-jogosultsággal. Kérj hozzáférést az admintól.`
            : "Be kell jelentkezned a folytatáshoz."}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {user ? (
            <Button variant="outline" onClick={() => signOut()}>
              Kijelentkezés
            </Button>
          ) : (
            <Button asChild>
              <Link to="/auth">Bejelentkezés</Link>
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
