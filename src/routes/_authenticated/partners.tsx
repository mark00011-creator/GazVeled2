import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Phone, Building2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/partners")({
  head: () => ({ meta: [{ title: "Partnerek – Gáz Veled" }] }),
  component: Partners,
});

const empty = { type: "company" as "company" | "private", name: "", company_name: "", tax_number: "", address: "", phone: "", email: "", contact_person: "", note: "" };

function Partners() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);

  const { data } = useQuery({
    queryKey: ["partners", q],
    queryFn: async () => {
      let qb = supabase.from("partners").select("*").order("name");
      if (q) qb = qb.or(`name.ilike.%${q}%,company_name.ilike.%${q}%,phone.ilike.%${q}%`);
      return (await qb).data ?? [];
    },
  });

  async function save() {
    if (!form.name) return;
    const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === "" ? null : v]));
    const { error } = await supabase.from("partners").insert(payload as never);
    if (error) { toast.error(error.message); return; }
    toast.success("Partner mentve"); setForm(empty); setOpen(false);
    qc.invalidateQueries({ queryKey: ["partners"] });
  }

  return (
    <AppShell title="Partnerek">
      <div className="mb-3 flex gap-2">
        <Input placeholder="Név, cég, telefon…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="icon"><Plus className="h-4 w-4" /></Button></DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Új partner</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Típus</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as "company" | "private" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="company">Cég</SelectItem>
                    <SelectItem value="private">Magánszemély</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Név</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              {form.type === "company" && (<>
                <div><Label>Cégnév</Label><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></div>
                <div><Label>Adószám</Label><Input value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} /></div>
                <div><Label>Kapcsolattartó</Label><Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
              </>)}
              <div><Label>Telefon</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><Label>Cím</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <Button onClick={save} className="w-full">Mentés</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {(data ?? []).map((p) => (
          <Card key={p.id} className="p-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold">{p.name}</div>
                {p.company_name && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Building2 className="h-3 w-3" /> {p.company_name}</div>}
                {p.phone && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3 w-3" /> {p.phone}</div>}
              </div>
            </div>
          </Card>
        ))}
        {data && data.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">Nincs partner</div>}
      </div>
    </AppShell>
  );
}
