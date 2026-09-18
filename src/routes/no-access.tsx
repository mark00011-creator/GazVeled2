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

function denialMessage(
  reason: ReturnType<typeof useAuth>["denialReason"],
  email: string,
): string {
  switch (reason) {
    case "missing_organization":
      return `A fiókod (${email}) még nincs egy céghez rendelve. Kérd meg a cég adminját, hogy a Jogosultságok menüben adjon hozzá (email: ${email}).`;
    case "viewer":
      return `A fiókod (${email}) megtekintő szerepkörű – nincs app-hozzáférés. Kérj Admin vagy Gyors csere kezelő jogot.`;
    case "inactive":
      return `A fiókod (${email}) le van tiltva. Kérd meg a cég adminját a feloldáshoz.`;
    case "organization_unavailable":
      return `A céged jelenleg nem elérhető. Vedd fel a kapcsolatot a supporttal.`;
    case "missing_profile":
      return `A fiókod (${email}) nincs teljesen beállítva. Jelentkezz ki, majd be, vagy kérj segítséget a supporttól.`;
    default:
      return `A fiókod (${email}) nem rendelkezik alkalmazás-jogosultsággal. Kérj hozzáférést a cég adminjától.`;
  }
}

function NoAccessPage() {
  const { user, profile, loading, denialReason } = useAuth();
  const email = profile?.email ?? user?.email ?? "—";

  authDiag({
    route: "no-access",
    loading,
    userId: user?.id ?? null,
    email,
    profile: profile
      ? { role: profile.role, is_active: profile.is_active, email: profile.email }
      : null,
    role: profile?.role ?? null,
    denialReason,
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
          {loading
            ? "Betöltés…"
            : user
              ? denialMessage(denialReason, email)
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
