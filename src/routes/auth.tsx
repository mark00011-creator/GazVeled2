import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Flame } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Bejelentkezés – Gáz Veled" }] }),
  component: AuthPage,
});

type AuthMode = "login" | "signup" | "forgot" | "reset";

function AuthPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      const params = new URLSearchParams(hash);
      const errorCode = params.get("error_code");
      const errorDesc = params.get("error_description");
      if (params.get("error") || errorCode) {
        const expired = errorCode === "otp_expired";
        toast.error(
          expired
            ? "A visszaállító link lejárt vagy érvénytelen. Kérj egy újat az alábbi űrlapon."
            : (errorDesc?.replace(/\+/g, " ") ?? "Bejelentkezési hiba"),
        );
        if (expired) setMode("forgot");
        window.history.replaceState(null, "", window.location.pathname);
      }
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("reset");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user && mode !== "reset") navigate({ to: "/dashboard", replace: true });
  }, [user, navigate, mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success("Fiók létrehozva, bejelentkezés…");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth`,
        });
        if (error) throw error;
        toast.success("Ellenőrizd az email fiókodat a jelszó-visszaállító linkért.");
        setMode("login");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;
        toast.success("Új jelszó mentve, bejelentkezés…");
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
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
          <div className="rounded-lg bg-primary/15 p-2 text-primary"><Flame className="h-6 w-6" /></div>
          <div>
            <h1 className="text-lg font-bold">Gáz Veled</h1>
            <p className="text-xs text-muted-foreground">Palack Manager</p>
          </div>
        </div>
        {mode === "forgot" && (
          <p className="mb-4 text-sm text-muted-foreground">
            Add meg az email címedet, és küldünk egy jelszó-visszaállító linket.
          </p>
        )}
        {mode === "reset" && (
          <p className="mb-4 text-sm text-muted-foreground">Állíts be egy új jelszót a fiókodhoz.</p>
        )}
        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <Label htmlFor="name">Név</Label>
              <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
          )}
          {mode !== "reset" && (
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          )}
          {(mode === "login" || mode === "signup") && (
            <div>
              <Label htmlFor="password">Jelszó</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
          )}
          {mode === "reset" && (
            <div>
              <Label htmlFor="new-password">Új jelszó</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy
              ? "…"
              : mode === "login"
                ? "Bejelentkezés"
                : mode === "signup"
                  ? "Regisztráció"
                  : mode === "forgot"
                    ? "Visszaállító link küldése"
                    : "Új jelszó mentése"}
          </Button>
        </form>
        {mode === "login" && (
          <button
            type="button"
            onClick={() => setMode("forgot")}
            className="mt-3 w-full text-sm text-muted-foreground hover:text-foreground"
          >
            Elfelejtetted a jelszavad?
          </button>
        )}
        {(mode === "login" || mode === "signup") && (
          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className={`w-full text-sm text-muted-foreground hover:text-foreground ${mode === "login" ? "mt-2" : "mt-4"}`}
          >
            {mode === "login" ? "Nincs még fiókod? Regisztráció" : "Van fiókod? Bejelentkezés"}
          </button>
        )}
        {(mode === "forgot" || mode === "reset") && (
          <button
            type="button"
            onClick={() => setMode("login")}
            className="mt-2 w-full text-sm text-muted-foreground hover:text-foreground"
          >
            Vissza a bejelentkezéshez
          </button>
        )}
      </Card>
    </div>
  );
}
