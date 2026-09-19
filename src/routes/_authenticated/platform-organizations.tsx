import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Plus, RefreshCw } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { formatSupabaseError } from "@/lib/supabase-error";
import { GAZ_VEELED_ORG_ID } from "@/lib/organization";
import { usePersistedFormState } from "@/hooks/use-persisted-form-state";

export const Route = createFileRoute("/_authenticated/platform-organizations")({
  head: () => ({ meta: [{ title: "Cégek – Gáz Veled platform" }] }),
  component: PlatformOrganizationsPage,
});

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  is_active: boolean;
  tax_regime: string;
  member_count: number;
  created_at: string;
};

type CreateForm = {
  name: string;
  slug: string;
  slugTouched: boolean;
  adminEmail: string;
  taxRegime: "vat_exempt" | "vat_registered";
  vatRate: string;
};

const CREATE_DEFAULTS: CreateForm = {
  name: "",
  slug: "",
  slugTouched: false,
  adminEmail: "",
  taxRegime: "vat_exempt",
  vatRate: "27",
};

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function PlatformOrganizationsPage() {
  const { isPlatformAdmin, organization, loading } = useAuth();
  const qc = useQueryClient();
  const { state: form, patch, reset } = usePersistedFormState(CREATE_DEFAULTS, {
    formKey: "create",
  });
  const { name, slug, slugTouched, adminEmail, taxRegime, vatRate } = form;

  const { data: orgs, isLoading } = useQuery({
    queryKey: ["platform-organizations"],
    enabled: isPlatformAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("platform_list_organizations");
      if (error) throw new Error(formatSupabaseError(error, "Cégek betöltése"));
      return (data ?? []) as OrgRow[];
    },
  });

  const createOrg = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Cégnév kötelező");
      const s = (slug.trim() || slugify(trimmed)).slice(0, 60);
      const rate = Number(vatRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        throw new Error("Érvénytelen ÁFA kulcs");
      }
      const { error } = await supabase.rpc("create_organization", {
        p_name: trimmed,
        p_slug: s,
        p_admin_email: adminEmail.trim() || null,
        p_tax_regime: taxRegime,
        p_vat_rate: rate,
      });
      if (error) throw new Error(formatSupabaseError(error, "Cég létrehozása"));
    },
    onSuccess: () => {
      toast.success("Új cég létrehozva");
      reset();
      qc.invalidateQueries({ queryKey: ["platform-organizations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const switchOrg = useMutation({
    mutationFn: async (orgId: string) => {
      const { error } = await supabase.rpc("platform_set_active_organization", {
        p_organization_id: orgId,
      });
      if (error) throw new Error(formatSupabaseError(error, "Cégváltás"));
    },
    onSuccess: () => {
      toast.success("Aktív cég átállítva");
      window.location.assign("/dashboard");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return null;
  if (!isPlatformAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <AppShell title="Cégek (platform)">
      <p className="mb-3 text-sm text-muted-foreground">
        Új ügyfélcégek <strong>üres adattal</strong> indulnak (saját partnerek, készlet, árak).
        Bemutatóhoz válts a <strong>Minta Gáztelep</strong>re vagy a létrehozott cégre, majd vissza a Gáz
        Veledre.
      </p>
      <p className="mb-4 text-xs text-muted-foreground">
        Most aktív: <span className="font-medium text-foreground">{organization?.name ?? "—"}</span>
      </p>

      <Card className="mb-4 space-y-3 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Plus className="h-4 w-4" />
          Új cég
        </div>
        <div>
          <Label>Cég neve *</Label>
          <Input
            value={name}
            onChange={(e) => {
              const v = e.target.value;
              patch({
                name: v,
                ...(!slugTouched ? { slug: slugify(v) } : {}),
              });
            }}
            placeholder="pl. Kovács Gáz Kft."
          />
        </div>
        <div>
          <Label>Slug (URL-barát azonosító)</Label>
          <Input
            value={slug}
            onChange={(e) => {
              patch({ slugTouched: true, slug: e.target.value.toLowerCase() });
            }}
            placeholder="kovacs-gaz"
          />
        </div>
        <div>
          <Label>Első admin e-mail (opcionális)</Label>
          <Input
            type="email"
            value={adminEmail}
            onChange={(e) => patch({ adminEmail: e.target.value })}
            placeholder="ugyfel@pelda.hu – előbb regisztráljon"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Adózás</Label>
            <Select
              value={taxRegime}
              onValueChange={(v) =>
                patch({ taxRegime: v as "vat_exempt" | "vat_registered" })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vat_exempt">Alanyi adómentes</SelectItem>
                <SelectItem value="vat_registered">Áfakörös</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {taxRegime === "vat_registered" && (
            <div>
              <Label>ÁFA %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={vatRate}
                onChange={(e) => patch({ vatRate: e.target.value })}
              />
            </div>
          )}
        </div>
        <Button
          className="w-full"
          disabled={createOrg.isPending}
          onClick={() => createOrg.mutate()}
        >
          {createOrg.isPending ? "Létrehozás…" : "Cég létrehozása"}
        </Button>
      </Card>

      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Cégek
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Betöltés…</p>}
      <div className="space-y-2">
        {(orgs ?? []).map((o) => {
          const active = o.id === organization?.id;
          return (
            <Card key={o.id} className={`p-3 ${active ? "border-primary/50 bg-primary/5" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">{o.name}</span>
                    {active && <Badge>Aktív</Badge>}
                    {o.id === GAZ_VEELED_ORG_ID && <Badge variant="secondary">Saját</Badge>}
                    {!o.is_active && <Badge variant="destructive">Inaktív</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {o.slug} · {o.member_count} tag ·{" "}
                    {o.tax_regime === "vat_registered" ? "Áfakörös" : "Adómentes"}
                  </div>
                </div>
                {!active && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1"
                    disabled={switchOrg.isPending}
                    onClick={() => {
                      if (
                        !confirm(
                          `Átváltasz ide: ${o.name}?\nA saját adatok helyett ennek a cégnek a nézetét látod.`,
                        )
                      ) {
                        return;
                      }
                      switchOrg.mutate(o.id);
                    }}
                  >
                    <RefreshCw className="h-3 w-3" />
                    Váltás
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
