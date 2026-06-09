import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { fmtDateTime, locationLabels } from "@/lib/labels";
import { recordSupplierExchange } from "@/lib/cylinder-ops";

export const Route = createFileRoute("/_authenticated/suppliers")({
  head: () => ({ meta: [{ title: "Beszállítók – Gáz Veled" }] }),
  component: Suppliers,
});

type SupKind = "siad" | "own_supplier";

function Suppliers() {
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState<string>("");
  const [returnedBcs, setReturnedBcs] = useState("");
  const [receivedBcs, setReceivedBcs] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<SupKind>("siad");

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => (await supabase.from("suppliers").select("*").order("name")).data ?? [],
  });
  const { data: history } = useQuery({
    queryKey: ["supex"],
    queryFn: async () => (await supabase.from("supplier_exchanges").select("*, suppliers(name,kind)").order("created_at", { ascending: false }).limit(20)).data ?? [],
  });

  async function addSupplier() {
    if (!newName.trim()) return;
    const { error } = await supabase.from("suppliers").insert({ name: newName, kind: newKind });
    if (error) { toast.error(error.message); return; }
    setNewName(""); qc.invalidateQueries({ queryKey: ["suppliers"] });
  }

  async function submit() {
    if (!supplierId) { toast.error("Válassz beszállítót"); return; }
    setBusy(true);
    try {
      const parseBcs = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
      const retBcs = parseBcs(returnedBcs);
      const recBcs = parseBcs(receivedBcs);
      await recordSupplierExchange({
        supplier_id: supplierId,
        returned_barcodes: retBcs,
        received_barcodes: recBcs,
        note: note || null,
      });
      toast.success(`Rögzítve – ${retBcs.length} vissza, ${recBcs.length} átvét`);
      setReturnedBcs(""); setReceivedBcs(""); setNote("");
      qc.invalidateQueries();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <AppShell title="Beszállítói csere">
      <Card className="mb-3 p-4">
        <Label className="mb-2 block">Beszállító</Label>
        <Select value={supplierId} onValueChange={setSupplierId}>
          <SelectTrigger><SelectValue placeholder="Válassz…" /></SelectTrigger>
          <SelectContent>
            {(suppliers ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({locationLabels[s.kind]})</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="mt-3 flex gap-2">
          <Input placeholder="Új beszállító neve" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Select value={newKind} onValueChange={(v) => setNewKind(v as SupKind)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="siad">SIAD</SelectItem>
              <SelectItem value="own_supplier">Saját szolgáltató</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={addSupplier}>+</Button>
        </div>
      </Card>
      <Card className="mb-3 p-4">
        <Label className="mb-1 block">Visszavitt ÜRES palackok (vonalkódok, vesszővel/szóközzel)</Label>
        <textarea className="w-full rounded-md border bg-input p-2 font-mono text-sm" rows={3} value={returnedBcs} onChange={(e) => setReturnedBcs(e.target.value)} />
      </Card>
      <Card className="mb-3 p-4">
        <Label className="mb-1 block">Hozott TELI palackok</Label>
        <textarea className="w-full rounded-md border bg-input p-2 font-mono text-sm" rows={3} value={receivedBcs} onChange={(e) => setReceivedBcs(e.target.value)} />
        <Input className="mt-2" placeholder="Megjegyzés" value={note} onChange={(e) => setNote(e.target.value)} />
      </Card>
      <Button className="w-full" size="lg" disabled={busy || !supplierId} onClick={submit}>Tranzakció rögzítése</Button>

      <h2 className="mt-6 mb-2 text-sm font-semibold">Előzmények</h2>
      <div className="space-y-2">
        {(history ?? []).map((h) => (
          <Card key={h.id} className="p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{(h as { suppliers?: { name: string } }).suppliers?.name ?? "—"}</div>
              <div className="text-xs text-muted-foreground">{fmtDateTime(h.created_at)}</div>
            </div>
            <div className="mt-1 flex gap-2 text-xs">
              <Badge variant="secondary">↩ {h.returned_cylinder_ids.length} üres</Badge>
              <Badge variant="secondary">↪ {h.received_cylinder_ids.length} teli</Badge>
            </div>
            {h.note && <div className="mt-1 text-xs text-muted-foreground">{h.note}</div>}
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
