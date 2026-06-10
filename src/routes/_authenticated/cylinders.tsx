import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Edit } from "lucide-react";
import { toast } from "sonner";
import { circulationLabels, locationLabels, statusLabels } from "@/lib/labels";
import { updateCylinder, type CylinderRow } from "@/lib/cylinder-ops";

export const Route = createFileRoute("/_authenticated/cylinders")({
  head: () => ({ meta: [{ title: "Palackok – Gáz Veled" }] }),
  component: Cylinders,
});

const GAS_TYPES = ["Acetilén", "Argon", "Stargon", "Széndioxid", "Nitrogén", "Oxigén"];
const STANDARD_SIZES = ["10 L", "20 L", "40 L", "50 L"];
const CO2_SIZES = ["1-5 kg", "5 kg", "10 kg", "15 kg", "20 kg", "30 kg", "37,5 kg"];
const LOCATION_TYPES = ["warehouse_full", "warehouse_empty", "customer", "siad", "own_supplier"];
const STATUSES = ["full", "empty", "service"];

function getAvailableSizes(gasType: string): string[] {
  return gasType === "Széndioxid" ? CO2_SIZES : STANDARD_SIZES;
}

function Cylinders() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [circ, setCirc] = useState<string>("all");
  const [loc, setLoc] = useState<string>("all");
  const [openNew, setOpenNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingForm, setEditingForm] = useState<Partial<CylinderRow> | null>(null);
  const [formBusy, setFormBusy] = useState(false);

  const [newForm, setNewForm] = useState({ barcode: "", gas_type: "CO2", size: "10kg", circulation: "own" as "own" | "siad" });

  const { data } = useQuery({
    queryKey: ["cylinders", q, circ, loc],
    queryFn: async () => {
      let qb = supabase.from("cylinders").select("*").order("barcode");
      if (q) qb = qb.ilike("barcode", `%${q}%`);
      if (circ !== "all") qb = qb.eq("circulation", circ as "siad" | "own");
      if (loc !== "all") qb = qb.eq("location_type", loc as "warehouse_full" | "warehouse_empty" | "customer" | "siad" | "own_supplier");
      const { data } = await qb;
      return data ?? [];
    },
  });

  async function createNew() {
    if (!newForm.barcode) return;
    const { error } = await supabase.from("cylinders").insert(newForm);
    if (error) { toast.error(error.message); return; }
    toast.success("Palack hozzáadva");
    setNewForm({ barcode: "", gas_type: "CO2", size: "10kg", circulation: "own" });
    setOpenNew(false);
    qc.invalidateQueries({ queryKey: ["cylinders"] });
  }

  async function saveEdit() {
    if (!editingForm || !editingId) return;
    if (!editingForm.barcode?.trim()) {
      toast.error("Vonalkód kötelező");
      return;
    }
    if (!editingForm.gas_type?.trim()) {
      toast.error("Gáz típusa kötelező");
      return;
    }
    if (!editingForm.size?.trim()) {
      toast.error("Palack mérete kötelező");
      return;
    }

    setFormBusy(true);
    try {
      await updateCylinder(editingId, {
        barcode: editingForm.barcode,
        gas_type: editingForm.gas_type,
        size: editingForm.size,
        circulation: editingForm.circulation as "own" | "siad" | "other",
        owner: editingForm.owner as "own" | "siad" | "other",
        status: editingForm.status as "full" | "empty" | "service",
        location_type: editingForm.location_type as any,
        location_partner_id: editingForm.location_partner_id,
        location_supplier_id: editingForm.location_supplier_id,
      });

      toast.success("Palack frissítve");
      setEditingId(null);
      setEditingForm(null);
      qc.invalidateQueries({ queryKey: ["cylinders"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFormBusy(false);
    }
  }

  function startEdit(cyl: CylinderRow) {
    setEditingId(cyl.id);
    setEditingForm({ ...cyl });
  }

  const editAvailableSizes = editingForm ? getAvailableSizes(editingForm.gas_type || "Argon") : STANDARD_SIZES;

  return (
    <AppShell title="Palackok">
      <div className="mb-3 flex gap-2">
        <Input placeholder="Vonalkód keresése…" value={q} onChange={(e) => setQ(e.target.value)} className="font-mono" />
        <Dialog open={openNew} onOpenChange={setOpenNew}>
          <DialogTrigger asChild><Button size="icon"><Plus className="h-4 w-4" /></Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Új palack</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Vonalkód</Label><Input value={newForm.barcode} onChange={(e) => setNewForm({ ...newForm, barcode: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Gáz</Label><Input value={newForm.gas_type} onChange={(e) => setNewForm({ ...newForm, gas_type: e.target.value })} /></div>
                <div><Label>Méret</Label><Input value={newForm.size} onChange={(e) => setNewForm({ ...newForm, size: e.target.value })} /></div>
              </div>
              <div>
                <Label>Körforgás</Label>
                <Select value={newForm.circulation} onValueChange={(v) => setNewForm({ ...newForm, circulation: v as "own" | "siad" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="own">Saját</SelectItem>
                    <SelectItem value="siad">SIAD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={createNew} className="w-full">Mentés</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <Select value={circ} onValueChange={setCirc}>
          <SelectTrigger><SelectValue placeholder="Körforgás" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Minden körforgás</SelectItem>
            <SelectItem value="siad">SIAD</SelectItem>
            <SelectItem value="own">Saját</SelectItem>
          </SelectContent>
        </Select>
        <Select value={loc} onValueChange={setLoc}>
          <SelectTrigger><SelectValue placeholder="Helyszín" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Minden helyszín</SelectItem>
            {Object.entries(locationLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {(data ?? []).map((c) => (
          <div key={c.id}>
            {editingId === c.id && editingForm ? (
              // EDIT MODE
              <Card className="p-4 border-primary/50 bg-primary/5">
                <div className="space-y-3">
                  <div>
                    <Label>Vonalkód</Label>
                    <Input
                      value={editingForm.barcode || ""}
                      onChange={(e) => setEditingForm({ ...editingForm, barcode: e.target.value })}
                      className="font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Gáz típusa</Label>
                      <Select
                        value={editingForm.gas_type || "Argon"}
                        onValueChange={(v) => {
                          const newSize = getAvailableSizes(v)[0] || "20 L";
                          setEditingForm({ ...editingForm, gas_type: v, size: newSize });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {GAS_TYPES.map((gas) => (
                            <SelectItem key={gas} value={gas}>{gas}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Méret</Label>
                      <Select value={editingForm.size || "20 L"} onValueChange={(v) => setEditingForm({ ...editingForm, size: v })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {editAvailableSizes.map((size) => (
                            <SelectItem key={size} value={size}>{size}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Körforgás</Label>
                      <Select value={editingForm.circulation || "own"} onValueChange={(v) => setEditingForm({ ...editingForm, circulation: v as any })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="own">Saját</SelectItem>
                          <SelectItem value="siad">SIAD</SelectItem>
                          <SelectItem value="other">Egyéb</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Tulajdonos</Label>
                      <Select value={editingForm.owner || "own"} onValueChange={(v) => setEditingForm({ ...editingForm, owner: v as any })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="own">Saját</SelectItem>
                          <SelectItem value="siad">SIAD</SelectItem>
                          <SelectItem value="other">Egyéb</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Helyszín</Label>
                      <Select value={editingForm.location_type || "warehouse_full"} onValueChange={(v) => setEditingForm({ ...editingForm, location_type: v as any })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LOCATION_TYPES.map((lt) => (
                            <SelectItem key={lt} value={lt}>{locationLabels[lt]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Státusz</Label>
                      <Select value={editingForm.status || "empty"} onValueChange={(v) => setEditingForm({ ...editingForm, status: v as any })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label>Partner ID (opcionális)</Label>
                    <Input
                      value={editingForm.location_partner_id || ""}
                      onChange={(e) => setEditingForm({ ...editingForm, location_partner_id: e.target.value || null })}
                      placeholder="UUID vagy üres"
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" onClick={() => { setEditingId(null); setEditingForm(null); }} className="flex-1">Mégsem</Button>
                    <Button onClick={saveEdit} disabled={formBusy} className="flex-1">Mentés</Button>
                  </div>
                </div>
              </Card>
            ) : (
              // VIEW MODE
              <Link to="/cylinders/$id" params={{ id: c.id }}>
                <Card className="p-3 transition-colors hover:bg-accent/50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-mono text-sm font-semibold">{c.barcode}</div>
                      <div className="text-xs text-muted-foreground">{c.gas_type} · {c.size}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge style={{ backgroundColor: c.circulation === "siad" ? "var(--siad)" : "var(--own)" }} className="text-background text-[10px]">
                        {circulationLabels[c.circulation]}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{statusLabels[c.status]} · {locationLabels[c.location_type]}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-2"
                      onClick={(e) => {
                        e.preventDefault();
                        startEdit(c);
                      }}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              </Link>
            )}
          </div>
        ))}
        {data && data.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">Nincs találat</div>}
      </div>
    </AppShell>
  );
}
