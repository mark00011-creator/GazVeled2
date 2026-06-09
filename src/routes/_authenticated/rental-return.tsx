import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { closeRental } from "@/lib/cylinder-ops";

export const Route = createFileRoute("/_authenticated/rental-return")({
  head: () => ({ meta: [{ title: "Bérlet visszavétel – Gáz Veled" }] }),
  component: RentalReturn,
});

function RentalReturn() {
  const qc = useQueryClient();
  const [rentalId, setRentalId] = useState("");
  const [bc, setBc] = useState("");
  const [scanning, setScanning] = useState(false);
  const [depositReturned, setDepositReturned] = useState<"yes" | "no">("yes");
  const [closeStatus, setCloseStatus] = useState<"returned" | "closed" | "problematic">("returned");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: rentals } = useQuery({
    queryKey: ["active-rentals-all"],
    queryFn: async () => (await supabase.from("rentals").select("id, partner_id, current_cylinder_id, monthly_fee, deposit, start_date, partners(name, company_name)").eq("status", "active").order("start_date", { ascending: false })).data ?? [],
  });

  const rental = (rentals ?? []).find((r) => r.id === rentalId);

  const { data: currentCyl } = useQuery({
    queryKey: ["cyl-by-id", rental?.current_cylinder_id],
    enabled: !!rental?.current_cylinder_id,
    queryFn: async () => (await supabase.from("cylinders").select("barcode").eq("id", rental!.current_cylinder_id!).maybeSingle()).data,
  });

  const verifyOk = !!rental?.current_cylinder_id && bc.trim() !== "" && currentCyl?.barcode === bc.trim();
  const mismatch = !!rental?.current_cylinder_id && bc.trim() !== "" && !verifyOk;

  async function submit() {
    if (!rental) return;
    setBusy(true);
    try {
      await closeRental({
        rental_id: rental.id,
        returned_barcode: bc.trim() || null,
        deposit_returned: depositReturned === "yes",
        status: closeStatus,
        note: note || null,
      });
      toast.success("Bérlet lezárva");
      setRentalId(""); setBc(""); setNote(""); qc.invalidateQueries();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <AppShell title="Bérlet visszavétel">
      {scanning && <BarcodeScanner onResult={(t) => { setBc(t); setScanning(false); }} onClose={() => setScanning(false)} />}

      <Card className="mb-3 p-4">
        <Label className="mb-2 block">1. Aktív bérlet</Label>
        <Select value={rentalId} onValueChange={setRentalId}>
          <SelectTrigger><SelectValue placeholder="Válassz…" /></SelectTrigger>
          <SelectContent>
            {(rentals ?? []).map((r) => {
              const p = (r as { partners?: { name?: string; company_name?: string } }).partners;
              return <SelectItem key={r.id} value={r.id}>{p?.name ?? "—"}{p?.company_name ? ` · ${p.company_name}` : ""}{r.monthly_fee ? ` · ${Number(r.monthly_fee).toLocaleString("hu-HU")} Ft/hó` : ""}</SelectItem>;
            })}
          </SelectContent>
        </Select>
        {rental && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">Aktuális palack: {currentCyl?.barcode ?? "—"}</Badge>
            <Badge variant="outline">Kaució: {Number(rental.deposit ?? 0).toLocaleString("hu-HU")} Ft</Badge>
          </div>
        )}
      </Card>

      {rental && (
        <Card className="mb-3 p-4">
          <div className="mb-2 flex items-center justify-between">
            <Label>2. Visszaadott palack vonalkód</Label>
            <Button size="sm" variant="secondary" onClick={() => setScanning(true)}><Camera className="mr-1 h-4 w-4" /> Scan</Button>
          </div>
          <Input className="font-mono" value={bc} onChange={(e) => setBc(e.target.value)} placeholder="Vonalkód" />
          {verifyOk && <div className="mt-2 flex items-center gap-2 text-xs text-green-600"><Check className="h-4 w-4" /> Egyezik a bérelt palackkal</div>}
          {mismatch && <div className="mt-2 flex items-center gap-2 text-xs text-warning"><AlertTriangle className="h-4 w-4" /> Nem egyezik a nyilvántartott bérelt palackkal</div>}
        </Card>
      )}

      {rental && (
        <Card className="mb-3 p-4">
          <Label className="mb-2 block">3. Kaució visszafizetve?</Label>
          <div className="mb-3 flex gap-2">
            <Button className="flex-1" variant={depositReturned === "yes" ? "default" : "outline"} onClick={() => setDepositReturned("yes")}>IGEN</Button>
            <Button className="flex-1" variant={depositReturned === "no" ? "default" : "outline"} onClick={() => setDepositReturned("no")}>NEM</Button>
          </div>
          <Label className="mb-2 block">4. Bérlet státusz</Label>
          <Select value={closeStatus} onValueChange={(v) => setCloseStatus(v as "returned" | "closed" | "problematic")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="returned">Visszavéve</SelectItem>
              <SelectItem value="closed">Lezárva</SelectItem>
              <SelectItem value="problematic">Problémás</SelectItem>
            </SelectContent>
          </Select>
          <Input className="mt-3" placeholder="Megjegyzés (opcionális)" value={note} onChange={(e) => setNote(e.target.value)} />
        </Card>
      )}

      {rental && (
        <Button size="lg" className="w-full" disabled={busy} onClick={submit}>
          <Check className="mr-2 h-5 w-5" /> Bérlet lezárása
        </Button>
      )}
    </AppShell>
  );
}


