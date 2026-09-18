import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_ORGANIZATION_SETTINGS,
  parseOrganizationSettings,
  type OrganizationModules,
  type OrganizationSettings,
} from "@/lib/organization";

export const Route = createFileRoute("/_authenticated/organization-settings")({
  head: () => ({ meta: [{ title: "Cég beállítások – Gáz Veled" }] }),
  component: OrganizationSettingsPage,
});

const MODULE_LABELS: { key: keyof OrganizationModules; label: string; desc: string }[] = [
  { key: "suppliers", label: "Beszállítói csere", desc: "Beszállítói üres/teli mozgások" },
  { key: "chinese_stock", label: "Kínai készlet", desc: "Darabszámos kínai modul" },
  { key: "flaga_pb", label: "FLAGA PB", desc: "FLAGA készlet és eladás" },
  { key: "prima_pb", label: "PRÍMA PB", desc: "PRÍMA készlet és eladás" },
  { key: "rentals", label: "Bérletek", desc: "Bérleti folyamatok" },
  { key: "tool_rental", label: "Eszköz / fogyóanyag", desc: "Darabszámos raktár" },
  { key: "quotes", label: "Árajánlat", desc: "Árajánlat modul" },
  { key: "gas_orders", label: "Gáz rendelés", desc: "Üres palack rendelés" },
];

function OrganizationSettingsPage() {
  const { isAdmin, organization, loading } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [settings, setSettings] = useState<OrganizationSettings>(DEFAULT_ORGANIZATION_SETTINGS);
  const [binsText, setBinsText] = useState("");

  const { data: orgRow } = useQuery({
    queryKey: ["organization", organization?.id],
    enabled: !!organization?.id && isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, slug, logo_url, settings, is_active")
        .eq("id", organization!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!orgRow) return;
    setName(orgRow.name ?? "");
    setLogoUrl(orgRow.logo_url ?? "");
    const parsed = parseOrganizationSettings(orgRow.settings);
    setSettings(parsed);
    setBinsText(parsed.warehouse_bins.join("\n"));
  }, [orgRow]);

  const save = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("Nincs cég");
      const warehouse_bins = binsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const nextSettings: OrganizationSettings = {
        ...settings,
        warehouse_bins,
      };
      const { error } = await supabase
        .from("organizations")
        .update({
          name: name.trim() || organization.name,
          logo_url: logoUrl.trim() || null,
          settings: nextSettings,
          updated_at: new Date().toISOString(),
        })
        .eq("id", organization.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cég beállítások mentve");
      qc.invalidateQueries({ queryKey: ["organization"] });
      // Force auth reload via soft refresh
      window.location.reload();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <AppShell title="Cég beállítások">
      <Card className="mb-3 space-y-4 p-4">
        <div>
          <Label className="mb-1 block">Cég neve</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Cég neve" />
        </div>
        <div>
          <Label className="mb-1 block">Logó URL (opcionális)</Label>
          <Input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://..."
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Egyelőre külső kép URL. Később feltöltés is jöhet.
          </p>
          {logoUrl.trim() && (
            <img
              src={logoUrl.trim()}
              alt="Logó előnézet"
              className="mt-2 h-12 w-12 rounded border object-contain"
            />
          )}
        </div>
      </Card>

      <Card className="mb-3 space-y-3 p-4">
        <div className="text-sm font-semibold">Modulok</div>
        <p className="text-xs text-muted-foreground">
          Ami ki van kapcsolva, nem jelenik meg a menüben. Az alap app közös, a modulok cégenkéntiek.
        </p>
        {MODULE_LABELS.map((m) => (
          <div key={m.key} className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">{m.label}</div>
              <div className="text-xs text-muted-foreground">{m.desc}</div>
            </div>
            <Switch
              checked={settings.modules[m.key]}
              onCheckedChange={(v) =>
                setSettings((prev) => ({
                  ...prev,
                  modules: { ...prev.modules, [m.key]: v },
                }))
              }
            />
          </div>
        ))}
      </Card>

      <Card className="mb-3 space-y-3 p-4">
        <div className="text-sm font-semibold">Raktárhelyek / kalodák</div>
        <p className="text-xs text-muted-foreground">
          Egy sor = egy hely (pl. Kaloda 1). A palackokra kötés a következő lépés.
        </p>
        <textarea
          className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={binsText}
          onChange={(e) => setBinsText(e.target.value)}
          placeholder={"Kaloda 1\nKaloda 2\nStargon sor"}
        />
      </Card>

      <Card className="mb-3 space-y-3 p-4">
        <div className="text-sm font-semibold">ÁFA / adózás</div>
        <p className="text-xs text-muted-foreground">
          Alanyi adómentes: az árak bruttó egységárak, nincs ÁFA bontás. Áfakörös: az árak nettóban
          tárolódnak, a UI mutatja az ÁFÁ-t és a bruttót (alap: 27%).
        </p>
        <div>
          <Label className="mb-1 block">Adózási mód</Label>
          <Select
            value={settings.tax.regime}
            onValueChange={(v) =>
              setSettings((prev) => ({
                ...prev,
                tax: {
                  ...prev.tax,
                  regime: v as "vat_exempt" | "vat_registered",
                },
              }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vat_exempt">Alanyi adómentes (nincs ÁFA)</SelectItem>
              <SelectItem value="vat_registered">Áfakörös</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {settings.tax.regime === "vat_registered" && (
          <div>
            <Label className="mb-1 block">Alap ÁFA kulcs (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={settings.tax.default_rate}
              onChange={(e) => {
                const n = Number(e.target.value);
                setSettings((prev) => ({
                  ...prev,
                  tax: {
                    ...prev.tax,
                    default_rate: Number.isFinite(n) ? n : 27,
                  },
                }));
              }}
            />
          </div>
        )}
      </Card>

      <Card className="mb-3 space-y-3 p-4">
        <div className="text-sm font-semibold">Számlázási irányelvek</div>
        <p className="text-xs text-muted-foreground">
          Számlázó bekötés később (Billingo / Számlázz.hu). Itt már rögzíthető, mit számlázzunk.
        </p>
        {(
          [
            ["bill_own_circulation", "Saját körforgás számlázása"],
            ["bill_siad_circulation", "SIAD körforgás számlázása"],
            ["bill_foreign_circulation", "Idegen / egyéb körforgás számlázása"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <div className="text-sm">{label}</div>
            <Switch
              checked={settings.invoicing[key]}
              onCheckedChange={(v) =>
                setSettings((prev) => ({
                  ...prev,
                  invoicing: { ...prev.invoicing, [key]: v },
                }))
              }
            />
          </div>
        ))}
      </Card>

      <Button className="w-full" size="lg" disabled={save.isPending} onClick={() => save.mutate()}>
        Mentés
      </Button>
    </AppShell>
  );
}
