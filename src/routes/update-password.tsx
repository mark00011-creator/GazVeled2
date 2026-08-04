import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MIN_PASSWORD_LENGTH, validatePasswordPair } from "@/lib/app-url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Flame } from "lucide-react";

export const Route = createFileRoute("/update-password")({
  head: () => ({ meta: [{ title: "Új jelszó – Gáz Veled" }] }),
  component: UpdatePasswordPage,
});

function parseHashAuthError(): string | null {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  if (!params.get("error") && !params.get("error_code")) return null;
  const errorCode = params.get("error_code");
  const errorDesc = params.get("error_description");
  if (errorCode === "otp_expired") {
    return "A visszaállító link lejárt vagy már felhasználták. Kérj egy újat a bejelentkezési oldalon.";
  }
  return errorDesc?.replace(/\+/g, " ") ?? "A visszaállító link érvénytelen.";
}

function clearUrlHash() {
  window.history.replaceState(null, "", window.location.pathname);
}

function UpdatePasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const hashError = parseHashAuthError();
    if (hashError) {
      setLinkError(hashError);
      clearUrlHash();
      setChecking(false);
      return;
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryReady(true);
        setChecking(false);
        clearUrlHash();
      }
    });

    void supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        setLinkError("A munkamenet ellenőrzése sikertelen. Kérj egy új visszaállító linket.");
        setChecking(false);
        return;
      }
      const hash = window.location.hash;
      if (session && hash.includes("type=recovery")) {
        setRecoveryReady(true);
        clearUrlHash();
      } else if (!session && !hash.includes("type=recovery")) {
        setLinkError("Érvénytelen vagy lejárt visszaállító link. Kérj egy újat a bejelentkezési oldalon.");
      }
      setChecking(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validatePasswordPair(password, confirm);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      toast.success("Az új jelszó mentve. Jelentkezz be az új jelszavaddal.");
      navigate({ to: "/auth", replace: true });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Flame className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Új jelszó</h1>
            <p className="text-xs text-muted-foreground">Gáz Veled</p>
          </div>
        </div>

        {checking && (
          <p className="text-sm text-muted-foreground">Visszaállító link ellenőrzése…</p>
        )}

        {!checking && linkError && (
          <div className="space-y-4">
            <p className="text-sm text-destructive">{linkError}</p>
            <Button type="button" className="w-full" onClick={() => navigate({ to: "/auth" })}>
              Vissza a bejelentkezéshez
            </Button>
          </div>
        )}

        {!checking && !linkError && recoveryReady && (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Add meg az új jelszavadat (legalább {MIN_PASSWORD_LENGTH} karakter).
            </p>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="new-password">Új jelszó</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                />
              </div>
              <div>
                <Label htmlFor="confirm-password">Új jelszó ismétlése</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "…" : "Jelszó mentése"}
              </Button>
            </form>
          </>
        )}

        {!checking && !linkError && !recoveryReady && (
          <div className="space-y-4">
            <p className="text-sm text-destructive">
              Nem sikerült érvényes visszaállító munkamenetet létrehozni. Kérj egy új linket.
            </p>
            <Button type="button" className="w-full" onClick={() => navigate({ to: "/auth" })}>
              Vissza a bejelentkezéshez
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
