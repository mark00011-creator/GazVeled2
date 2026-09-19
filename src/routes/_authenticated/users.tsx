import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ROLE_LABELS, type AppRole } from "@/lib/roles";
import { toast } from "sonner";
import { formatSupabaseError } from "@/lib/supabase-error";
import { UserPlus } from "lucide-react";
import { usePersistedFormState } from "@/hooks/use-persisted-form-state";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Jogosultságok – Gáz Veled" }] }),
  component: UsersAdminPage,
});

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole;
  is_active: boolean;
};

const ASSIGNABLE_ROLES: AppRole[] = ["admin", "exchange_operator", "viewer"];

type InviteForm = {
  inviteEmail: string;
  inviteName: string;
  inviteRole: AppRole;
};

const INVITE_DEFAULTS: InviteForm = {
  inviteEmail: "",
  inviteName: "",
  inviteRole: "exchange_operator",
};

function UsersAdminPage() {
  const { isAdmin, loading: authLoading, organization } = useAuth();
  const qc = useQueryClient();
  const { state: invite, patch: patchInvite, reset: resetInvite } = usePersistedFormState(
    INVITE_DEFAULTS,
    { formKey: "invite" },
  );
  const { inviteEmail, inviteName, inviteRole } = invite;

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["admin-profiles"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, role, is_active")
        .order("email");
      if (error) throw new Error(formatSupabaseError(error, "Felhasználók betöltése"));
      return (data ?? []) as ProfileRow[];
    },
  });

  const assignMember = useMutation({
    mutationFn: async () => {
      const email = inviteEmail.trim().toLowerCase();
      if (!email) throw new Error("Email kötelező");
      const { error } = await supabase.rpc("assign_organization_member", {
        p_email: email,
        p_role: inviteRole,
        p_full_name: inviteName.trim() || null,
        p_is_active: true,
      });
      if (error) throw new Error(formatSupabaseError(error, "Hozzárendelés"));
    },
    onSuccess: () => {
      toast.success("Felhasználó hozzáadva a céghez");
      resetInvite();
      qc.invalidateQueries({ queryKey: ["admin-profiles"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const updateRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: AppRole }) => {
      const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
      if (error) throw new Error(formatSupabaseError(error, "Szerepkör mentése"));
    },
    onSuccess: () => {
      toast.success("Szerepkör frissítve");
      qc.invalidateQueries({ queryKey: ["admin-profiles"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const updateActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("profiles").update({ is_active }).eq("id", id);
      if (error) throw new Error(formatSupabaseError(error, "Státusz mentése"));
    },
    onSuccess: () => {
      toast.success("Felhasználó státusz frissítve");
      qc.invalidateQueries({ queryKey: ["admin-profiles"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const updateName = useMutation({
    mutationFn: async ({ id, full_name }: { id: string; full_name: string }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: full_name.trim() || null })
        .eq("id", id);
      if (error) throw new Error(formatSupabaseError(error, "Név mentése"));
    },
    onSuccess: () => {
      toast.success("Név frissítve");
      qc.invalidateQueries({ queryKey: ["admin-profiles"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (authLoading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <AppShell title="Jogosultságok">
      <div className="space-y-4">
        <Card className="space-y-2 p-4 text-sm text-muted-foreground">
          <p>
            Cég: <span className="font-medium text-foreground">{organization?.name ?? "—"}</span>
          </p>
          <p>
            <strong className="text-foreground">Admin</strong> – teljes hozzáférés (beállítások,
            felhasználók, modulok).
          </p>
          <p>
            <strong className="text-foreground">Gyors csere kezelő</strong> – csak Gyors csere
            (udvari dolgozó).
          </p>
          <p>
            <strong className="text-foreground">Megtekintő</strong> – nincs app-hozzáférés (várakozó
            / letiltott jogosultság).
          </p>
          <p className="text-xs">
            Új dolgozó: előbb regisztráljon / jelentkezzen be az appban, utána itt e-mail alapján
            hozzáadod a céghez. Support / infra hozzáférést a dolgozók nem kapnak.
          </p>
        </Card>

        <Card className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <UserPlus className="h-4 w-4" />
            Dolgozó hozzáadása a céghez
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1 block">Email</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => patchInvite({ inviteEmail: e.target.value })}
                placeholder="dolgozo@ceg.hu"
                className="font-mono"
              />
            </div>
            <div>
              <Label className="mb-1 block">Megjelenő név (opcionális)</Label>
              <Input
                value={inviteName}
                onChange={(e) => patchInvite({ inviteName: e.target.value })}
                placeholder="Kovács János"
              />
            </div>
            <div>
              <Label className="mb-1 block">Szerepkör</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => patchInvite({ inviteRole: v as AppRole })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                disabled={assignMember.isPending}
                onClick={() => assignMember.mutate()}
              >
                Hozzáadás
              </Button>
            </div>
          </div>
        </Card>

        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Cég dolgozói ({profiles?.length ?? 0})
          </h2>
          {isLoading && <p className="text-sm text-muted-foreground">Betöltés…</p>}
          {(profiles ?? []).map((p) => (
            <Card key={p.id} className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1 block text-xs text-muted-foreground">Név (naplóhoz)</Label>
                  <Input
                    defaultValue={p.full_name ?? ""}
                    placeholder={p.email ?? "Név"}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (next !== (p.full_name ?? "").trim()) {
                        updateName.mutate({ id: p.id, full_name: next });
                      }
                    }}
                  />
                </div>
                <div>
                  <Label className="mb-1 block text-xs text-muted-foreground">Email</Label>
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-sm">
                    {p.email ?? "—"}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                  value={p.role}
                  onValueChange={(v) => updateRole.mutate({ id: p.id, role: v as AppRole })}
                  disabled={updateRole.isPending || updateActive.isPending}
                >
                  <SelectTrigger className="w-full sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={p.is_active ? "active" : "disabled"}
                  onValueChange={(v) =>
                    updateActive.mutate({ id: p.id, is_active: v === "active" })
                  }
                  disabled={updateRole.isPending || updateActive.isPending}
                >
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktív</SelectItem>
                    <SelectItem value="disabled">Letiltva</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
