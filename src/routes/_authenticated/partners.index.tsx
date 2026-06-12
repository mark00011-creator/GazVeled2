import { createFileRoute, Link } from "@tanstack/react-router";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useState } from "react";

import { supabase } from "@/integrations/supabase/client";

import { AppShell } from "@/components/AppShell";

import { Card } from "@/components/ui/card";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { Plus, Building2, ChevronRight } from "lucide-react";

import { toast } from "sonner";

import { fetchPartnerRentalSummaries } from "@/lib/rental-ops";



export const Route = createFileRoute("/_authenticated/partners/")({

  head: () => ({ meta: [{ title: "Partnerek – Gáz Veled" }] }),

  component: PartnersList,

});



const empty = {

  type: "company" as "company" | "private",

  name: "",

  company_name: "",

  tax_number: "",

  address: "",

  phone: "",

  email: "",

  contact_person: "",

  note: "",

};



function PartnersList() {

  const qc = useQueryClient();

  const [q, setQ] = useState("");

  const [open, setOpen] = useState(false);

  const [form, setForm] = useState(empty);



  const { data, isLoading, isError } = useQuery({

    queryKey: ["partners", q],

    queryFn: async () => {

      let qb = supabase.from("partners").select("*").order("name");

      if (q) {

        const esc = q.replace(/[%_,]/g, "");

        if (esc) qb = qb.or(`name.ilike.%${esc}%,company_name.ilike.%${esc}%,phone.ilike.%${esc}%`);

      }

      const { data: rows, error } = await qb;

      if (error) throw error;

      return rows ?? [];

    },

  });



  const { data: rentalSummaries } = useQuery({

    queryKey: ["partner-rental-summaries"],

    queryFn: fetchPartnerRentalSummaries,

  });



  async function save() {

    if (!form.name) return;

    const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === "" ? null : v]));

    const { error } = await supabase.from("partners").insert(payload as never);

    if (error) {

      toast.error(error.message);

      return;

    }

    toast.success("Partner mentve");

    setForm(empty);

    setOpen(false);

    qc.invalidateQueries({ queryKey: ["partners"] });

    qc.invalidateQueries({ queryKey: ["partners-min"] });

  }



  return (

    <AppShell title="Partnerek">

      <div className="mb-3 flex gap-2">

        <Input placeholder="Név, cég, telefon…" value={q} onChange={(e) => setQ(e.target.value)} />

        <Dialog open={open} onOpenChange={setOpen}>

          <DialogTrigger asChild>

            <Button size="icon">

              <Plus className="h-4 w-4" />

            </Button>

          </DialogTrigger>

          <DialogContent className="max-h-[90vh] overflow-y-auto">

            <DialogHeader>

              <DialogTitle>Új partner</DialogTitle>

              <DialogDescription>Új partner felvétele a nyilvántartásba.</DialogDescription>

            </DialogHeader>

            <div className="space-y-3">

              <div>

                <Label>Típus</Label>

                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as "company" | "private" })}>

                  <SelectTrigger>

                    <SelectValue />

                  </SelectTrigger>

                  <SelectContent>

                    <SelectItem value="company">Cég</SelectItem>

                    <SelectItem value="private">Magánszemély</SelectItem>

                  </SelectContent>

                </Select>

              </div>

              <div>

                <Label>Név</Label>

                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />

              </div>

              {form.type === "company" && (

                <>

                  <div>

                    <Label>Cégnév</Label>

                    <Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />

                  </div>

                  <div>

                    <Label>Adószám</Label>

                    <Input value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} />

                  </div>

                  <div>

                    <Label>Kapcsolattartó</Label>

                    <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />

                  </div>

                </>

              )}

              <div>

                <Label>Telefon</Label>

                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />

              </div>

              <div>

                <Label>Email</Label>

                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />

              </div>

              <div>

                <Label>Cím</Label>

                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />

              </div>

              <Button onClick={save} className="w-full">

                Mentés

              </Button>

            </div>

          </DialogContent>

        </Dialog>

      </div>



      {isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Betöltés…</div>}

      {isError && <div className="py-8 text-center text-sm text-destructive">Partnerek betöltése sikertelen</div>}



      <div className="space-y-2">

        {(data ?? []).map((p) => {

          const summary = rentalSummaries?.[p.id];

          return (

            <Link key={p.id} to="/partners/$id" params={{ id: p.id }}>

              <Card className="flex items-center gap-3 p-3 transition-colors hover:bg-accent/50">

                <div className="min-w-0 flex-1">

                  <div className="font-semibold">{p.name}</div>

                  {p.company_name && (

                    <div className="flex items-center gap-1 text-xs text-muted-foreground">

                      <Building2 className="h-3 w-3" /> {p.company_name}

                    </div>

                  )}

                  {summary && summary.length > 0 && (

                    <div className="mt-1">

                      <div className="text-xs font-medium text-muted-foreground">Bérelt palackok:</div>

                      <div className="mt-0.5 space-y-0.5">

                        {summary.map((line) => (

                          <div key={line} className="text-xs text-primary">{line}</div>

                        ))}

                      </div>

                    </div>

                  )}

                </div>

                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />

              </Card>

            </Link>

          );

        })}

        {!isLoading && !isError && data && data.length === 0 && (

          <div className="py-8 text-center text-sm text-muted-foreground">Nincs partner</div>

        )}

      </div>

    </AppShell>

  );

}

