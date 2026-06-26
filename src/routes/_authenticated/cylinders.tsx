import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Edit } from "lucide-react";
import {
  circulationLabels,
  formatCylinderLocation,
  formatPressureTestYear,
  locationLabels,
  manufacturerLabels,
  SERIALIZED_MANUFACTURER_OPTIONS,
  type Circulation,
  type Manufacturer,
} from "@/lib/labels";
import { NewCylinderDialog } from "@/components/NewCylinderDialog";
import { EditCylinderDialog, type CylinderEditSource } from "@/components/EditCylinderDialog";

export const Route = createFileRoute("/_authenticated/cylinders")({
  head: () => ({ meta: [{ title: "Palackok – Gáz Veled" }] }),
  component: Cylinders,
});

function Cylinders() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [circ, setCirc] = useState<string>("all");
  const [mfr, setMfr] = useState<string>("all");
  const [loc, setLoc] = useState<string>("all");
  const [openNew, setOpenNew] = useState(false);
  const [editingCylinder, setEditingCylinder] = useState<CylinderEditSource | null>(null);

  const { data } = useQuery({
    queryKey: ["cylinders", q, circ, mfr, loc],
    queryFn: async () => {
      let qb = supabase
        .from("cylinders")
        .select(
          "id, barcode, gas_type, size, circulation, owner, manufacturer, pressure_test_year, status, location_type, location_partner_id, location_supplier_id, suppliers:location_supplier_id(name), partners:location_partner_id(name)",
        )
        .eq("active", true)
        .neq("manufacturer", "chinese")
        .order("barcode");
      if (q) qb = qb.ilike("barcode", `%${q}%`);
      if (circ !== "all") qb = qb.eq("circulation", circ as Circulation);
      if (mfr !== "all") qb = qb.eq("manufacturer", mfr as Manufacturer);
      if (loc !== "all")
        qb = qb.eq(
          "location_type",
          loc as "warehouse_full" | "warehouse_empty" | "customer" | "siad" | "own_supplier",
        );
      const { data } = await qb;
      return data ?? [];
    },
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["cylinders"] });
  }

  return (
    <AppShell title="Palackok">
      <div className="mb-3 flex gap-2">
        <Input
          placeholder="Vonalkód keresése…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="font-mono"
        />
        <Button size="icon" onClick={() => setOpenNew(true)}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <NewCylinderDialog
        open={openNew}
        onOpenChange={setOpenNew}
        barcode=""
        barcodeEditable
        onCreated={invalidate}
      />

      <EditCylinderDialog
        open={!!editingCylinder}
        onOpenChange={(open) => {
          if (!open) setEditingCylinder(null);
        }}
        cylinder={editingCylinder}
        onSaved={invalidate}
      />

      <div className="mb-3 grid grid-cols-2 gap-2">
        <Select value={circ} onValueChange={setCirc}>
          <SelectTrigger>
            <SelectValue placeholder="Tulajdonos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Minden tulajdonos</SelectItem>
            <SelectItem value="siad">SIAD</SelectItem>
            <SelectItem value="own">Saját</SelectItem>
            <SelectItem value="berpalack">Egyéb</SelectItem>
          </SelectContent>
        </Select>
        <Select value={mfr} onValueChange={setMfr}>
          <SelectTrigger>
            <SelectValue placeholder="Gyártó" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Minden gyártó</SelectItem>
            {SERIALIZED_MANUFACTURER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="mb-3">
        <Select value={loc} onValueChange={setLoc}>
          <SelectTrigger>
            <SelectValue placeholder="Helyszín" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Minden helyszín</SelectItem>
            {Object.entries(locationLabels).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {(data ?? []).map((c) => (
          <Link key={c.id} to="/cylinders/$id" params={{ id: c.id }}>
            <Card className="p-3 transition-colors hover:bg-accent/50">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="font-mono text-sm font-semibold">{c.barcode}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.gas_type} · {c.size}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Gyártó: {manufacturerLabels[(c.manufacturer as Manufacturer) ?? "other"]}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Nyomáspróba: {formatPressureTestYear(c.pressure_test_year)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge
                    style={{
                      backgroundColor: c.circulation === "siad" ? "var(--siad)" : "var(--own)",
                    }}
                    className="text-background text-[10px]"
                  >
                    {circulationLabels[c.circulation]}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {formatCylinderLocation(
                      c.status,
                      c.location_type,
                      (c as { suppliers?: { name: string } | null }).suppliers?.name,
                      (c as { partners?: { name: string } | null }).partners?.name,
                    )}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-2"
                  onClick={(e) => {
                    e.preventDefault();
                    setEditingCylinder(c as CylinderEditSource);
                  }}
                >
                  <Edit className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          </Link>
        ))}
        {data && data.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">Nincs találat</div>
        )}
      </div>
    </AppShell>
  );
}
