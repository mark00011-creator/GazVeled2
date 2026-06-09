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
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { circulationLabels, locationLabels, statusLabels } from "@/lib/labels";

export const Route = createFileRoute("/_authenticated/cylinders")({
  head: () => ({ meta: [{ title: "Palackok – Gáz Veled" }] }),
  component: Cylinders,
});

function Cylinders() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [circ, setCirc] = useState<string>("all");
  const [loc, setLoc] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ barcode: "", gas_type: "CO2", size: "10kg", circulation: "own" as "own" | "siad" });

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

  async function create() {
    if (!form.barcode) return;
    const { error } = await supabase.from("cylinders").insert(form);
    if (error) { toast.error(error.message); return; }
    toast.success("Palack hozzáadva");
    setForm({ barcode: "", gas_type: "CO2", size: "10kg", circulation: "own" });
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["cylinders"] });
  }

  return (
    <AppShell title="Palackok">
      <div className="mb-3 flex gap-2">
        <Input placeholder="Vonalkód keresése…" value={q} onChange={(e) => setQ(e.target.value)} className="font-mono" />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="icon"><Plus className="h-4 w-4" /></Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Új palack</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Vonalkód</Label><Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Gáz</Label><Input value={form.gas_type} onChange={(e) => setForm({ ...form, gas_type: e.target.value })} /></div>
                <div><Label>Méret</Label><Input value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} /></div>
              </div>
              <div>
                <Label>Körforgás</Label>
                <Select value={form.circulation} onValueChange={(v) => setForm({ ...form, circulation: v as "own" | "siad" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="own">Saját</SelectItem>
                    <SelectItem value="siad">SIAD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={create} className="w-full">Mentés</Button>
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
          <Link key={c.id} to="/cylinders/$id" params={{ id: c.id }}>
            <Card className="p-3 transition-colors hover:bg-accent/50">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-mono text-sm font-semibold">{c.barcode}</div>
                  <div className="text-xs text-muted-foreground">{c.gas_type} · {c.size}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge style={{ backgroundColor: c.circulation === "siad" ? "var(--siad)" : "var(--own)" }} className="text-background text-[10px]">
                    {circulationLabels[c.circulation]}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">{statusLabels[c.status]} · {locationLabels[c.location_type]}</span>
                </div>
              </div>
            </Card>
          </Link>
        ))}
        {data && data.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">Nincs találat</div>}
      </div>
    </AppShell>
  );
}
