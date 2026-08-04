import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "Felhasználók – Gáz Veled" }] }),
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

function UsersAdminPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const qc = useQueryClient();

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

  if (authLoading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <AppShell title="Felhasználók">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Szerepkörök: <strong>Admin</strong> – teljes hozzáférés;{" "}
          <strong>Gyors csere kezelő</strong> – csak Gyors csere;{" "}
          <strong>Megtekintő</strong> – nincs hozzáférés (letiltás). A „Letiltva” állapot azonnal megvonja a hozzáférést.
        </p>
        {isLoading && <p className="text-sm text-muted-foreground">Betöltés…</p>}
        <div className="space-y-2">
          {(profiles ?? []).map((p) => (
            <Card key={p.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">{p.full_name ?? p.email ?? p.id}</div>
                <div className="text-xs text-muted-foreground">{p.email ?? "—"}</div>
              </div>
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
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
