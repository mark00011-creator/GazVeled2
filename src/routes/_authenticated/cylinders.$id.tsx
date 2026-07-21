import { createFileRoute, Link } from "@tanstack/react-router";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { supabase } from "@/integrations/supabase/client";

import { AppShell } from "@/components/AppShell";

import { Card } from "@/components/ui/card";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import { ArrowLeft } from "lucide-react";

import { circulationLabels, fmtDateTime, formatCylinderLocation, manufacturerLabels, type Manufacturer } from "@/lib/labels";
import { finalizeCylinderBarcode } from "@/lib/cylinder-ops";
import { CylinderHistorySection } from "@/components/CylinderHistorySection";
import { toast } from "sonner";



export const Route = createFileRoute("/_authenticated/cylinders/$id")({

  head: () => ({ meta: [{ title: "Palack – Gáz Veled" }] }),

  component: CylinderDetail,

});



function CylinderDetail() {

  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [newBarcode, setNewBarcode] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: cyl, isLoading, isError } = useQuery({

    queryKey: ["cyl-d", id],

    queryFn: async () => {

      const { data, error } = await supabase

        .from("cylinders")

        .select("id, barcode, gas_type, size, circulation, manufacturer, status, location_type, last_movement_at, is_temporary, suppliers:location_supplier_id(name), partners:location_partner_id(name)")

        .eq("id", id)

        .eq("active", true)

        .maybeSingle();

      if (error) throw error;

      return data;

    },

  });

  async function saveBarcode() {
    if (!cyl) return;
    setSaving(true);
    try {
      await finalizeCylinderBarcode(cyl.id, newBarcode);
      toast.success("Vonalkód mentve");
      setNewBarcode("");
      qc.invalidateQueries({ queryKey: ["cyl-d", id] });
      qc.invalidateQueries({ queryKey: ["cylinders"] });
      qc.invalidateQueries({ queryKey: ["cylinder-history", id] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (

    <AppShell title="Palack">

      <Link to="/cylinders"><Button variant="ghost" size="sm" className="mb-3"><ArrowLeft className="mr-1 h-4 w-4" /> Vissza</Button></Link>

      {isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Betöltés…</div>}

      {isError && <div className="py-8 text-center text-sm text-destructive">Palack betöltése sikertelen</div>}

      {!isLoading && !isError && !cyl && <div className="py-8 text-center text-sm text-muted-foreground">Palack nem található</div>}

      {cyl && (

        <Card className="p-4">

          <div className="font-mono text-lg font-bold">{cyl.barcode}</div>

          {(cyl as { is_temporary?: boolean }).is_temporary && (
            <Badge variant="outline" className="mt-1">Ideiglenes vonalkód</Badge>
          )}

          <div className="mt-1 text-sm text-muted-foreground">{cyl.gas_type} · {cyl.size}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Gyártó: {manufacturerLabels[(cyl.manufacturer as Manufacturer) ?? "other"]}
          </div>

          {(cyl as { is_temporary?: boolean }).is_temporary && (
            <div className="mt-4 space-y-2 rounded-md border border-dashed p-3">
              <Label className="text-xs">Végleges vonalkód</Label>
              <Input
                className="font-mono"
                placeholder="Végleges vonalkód"
                value={newBarcode}
                onChange={(e) => setNewBarcode(e.target.value)}
              />
              <Button size="sm" className="w-full" disabled={saving || !newBarcode.trim()} onClick={saveBarcode}>
                {saving ? "Mentés…" : "Vonalkód mentése"}
              </Button>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">

            <Badge style={{ backgroundColor: cyl.circulation === "siad" ? "var(--siad)" : "var(--own)" }} className="text-background">{circulationLabels[cyl.circulation]}</Badge>

            <Badge variant="outline">

              {formatCylinderLocation(

                cyl.status,

                cyl.location_type,

                (cyl as { suppliers?: { name: string } | null }).suppliers?.name,

                (cyl as { partners?: { name: string } | null }).partners?.name,

              )}

            </Badge>

          </div>

          <div className="mt-2 text-xs text-muted-foreground">Utolsó mozgás: {fmtDateTime(cyl.last_movement_at)}</div>

        </Card>

      )}

      {cyl && <CylinderHistorySection cylinderId={cyl.id} />}

    </AppShell>

  );

}

