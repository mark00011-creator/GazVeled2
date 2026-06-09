import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
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
import { Camera, ArrowRight, AlertTriangle, Check, Sparkles, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { circulationLabels, fmtDateTime, locationLabels } from "@/lib/labels";
import { findOrCreateCylinder, recordExchange, type CylinderRow } from "@/lib/cylinder-ops";

export const Route = createFileRoute("/_authenticated/quick-exchange")({
  head: () => ({ meta: [{ title: "Gyors csere – Gáz Veled" }] }),
  component: QuickExchange,
});

type IncomingKind = "rental" | "own" | "new";

function QuickExchange() {
  const qc = useQueryClient();
  const [partnerId, setPartnerId] = useState<string>("");
  const [scanning, setScanning] = useState<"in" | "out" | null>(null);
  const [incomingBc, setIncomingBc] = useState("");
  const [outgoingBc, setOutgoingBc] = useState("");
  const [incoming, setIncoming] = useState<CylinderRow | null>(null);
  const [incomingCreated, setIncomingCreated] = useState(false);
  const [outgoing, setOutgoing] = useState<CylinderRow | null>(null);
const [outgoingCreated, setOutgoingCreated] = useState(false);
  const [newGasType, setNewGasType] = useState("Stargon");
  const [newSize, setNewSize] = useState("20L");
  const [newOwner, setNewOwner] = useState<"own" | "siad">("own");
  const [reassign, setReassign] = useState<"yes" | "no" | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: partners } = useQuery({
    queryKey: ["partners-min"],
    queryFn: async () => (await supabase.from("partners").select("id,name,company_name").order("name")).data ?? [],
  });

  const { data: activeRentals } = useQuery({
    queryKey: ["active-rentals", partnerId],
    enabled: !!partnerId,
    queryFn: async () => {
      const { data } = await supabase
        .from("rentals")
        .select("id, monthly_fee, current_cylinder_id, original_cylinder_id, circulation, deposit, start_date")
        .eq("partner_id", partnerId)
        .eq("status", "active");
      return data ?? [];
    },
  });

  const rentedCylIds = useMemo(
    () => (activeRentals ?? []).map((r) => r.current_cylinder_id).filter(Boolean) as string[],
    [activeRentals],
  );

  const { data: rentedCyls } = useQuery({
    queryKey: ["rented-cyls", rentedCylIds],
    enabled: rentedCylIds.length > 0,
    queryFn: async () => (await supabase.from("cylinders").select("id,barcode").in("id", rentedCylIds)).data ?? [],
  });

  const incomingKind: IncomingKind | null = useMemo(() => {
    if (!incoming) return null;
    if (incomingCreated) return "new";
    if (rentedCylIds.includes(incoming.id)) return "rental";
    return "own";
  }, [incoming, incomingCreated, rentedCylIds]);

  const { data: history } = useQuery({
    queryKey: ["history", incoming?.id],
    enabled: !!incoming?.id,
    queryFn: async () => {
      const { data } = await supabase.from("movements").select("*").eq("cylinder_id", incoming!.id).order("created_at", { ascending: false }).limit(5);
      return data ?? [];
    },
  });

  async function lookupIncoming() {
    if (!incomingBc.trim()) return;
    try {
      const { cyl, created } = await findOrCreateCylinder(incomingBc);
      setIncoming(cyl); setIncomingCreated(created);
      if (created) toast.success("Új palack rögzítve – első nyomon követett tranzakció");
    } catch (e) { toast.error((e as Error).message); }
  }
  async function lookupOutgoing() {
    if (!outgoingBc.trim()) return;
    try {
      const { cyl, created } = await findOrCreateCylinder(outgoingBc, { status: "full", location_type: "warehouse_full" });
      setOutgoing(cyl); setOutgoingCreated(created);
      if (created) toast.success("Új palack rögzítve – első nyomon követett tranzakció");
    } catch (e) { toast.error((e as Error).message); }
  }

  const isForced = incoming && outgoing && incoming.circulation !== outgoing.circulation;
  const needsRentalQuestion =
    (activeRentals?.length ?? 0) > 0 && incoming && outgoing && reassign === null;

  async function complete() {
    if (!incoming || !outgoing || !partnerId) { toast.error("Hiányzó adat"); return; }
    if (isForced && !reason.trim()) { toast.error("Add meg a kényszerhelyettesítés okát"); return; }
    if ((activeRentals?.length ?? 0) > 0 && reassign === null) { toast.error("Döntsd el az újrarendelés kérdést"); return; }

    setBusy(true);

try {

  if (outgoingCreated) {
    const { error } = await supabase
      .from("cylinders")
      .update({
        gas_type: newGasType,
        size: newSize,
        owner: newOwner,
        circulation: newOwner,
      })
      .eq("id", outgoing.id);

    if (error) throw error;
  }

  const activeRental = (activeRentals ?? [])[0];
  const reassignYes = !!(activeRental && reassign === "yes");

  await recordExchange({
    partner_id: partnerId,
    incoming_id: incoming.id,
    outgoing_id: outgoing.id,
    reason: isForced ? reason : null,
    note: note || null,
    rental_id: activeRental?.id ?? null,
    reassign_rental: reassignYes,
  });

  toast.success("Csere rögzítve");

  setIncomingBc("");
  setOutgoingBc("");
  setIncoming(null);
  setOutgoing(null);
  setIncomingCreated(false);
  setOutgoingCreated(false);
  setNote("");
  setReason("");
  setReassign(null);

  qc.invalidateQueries();

} catch (e) {
  toast.error((e as Error).message);
} finally {
  setBusy(false);
}

}

  return (
    <AppShell title="Gyors csere">
      {scanning && (
        <BarcodeScanner
          onResult={(t) => {
            if (scanning === "in") { setIncomingBc(t); }
            else { setOutgoingBc(t); }
            setScanning(null);
          }}
          onClose={() => setScanning(null)}
        />
      )}

      {/* 1. PARTNER */}
      <Card className="mb-3 p-4">
        <Label className="mb-2 block">1. Partner</Label>
        <Select value={partnerId} onValueChange={(v) => { setPartnerId(v); setReassign(null); }}>
          <SelectTrigger><SelectValue placeholder="Válassz partnert…" /></SelectTrigger>
          <SelectContent>
            {(partners ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}{p.company_name ? ` · ${p.company_name}` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      {/* 2. AKTÍV BÉRLETEK */}
      {partnerId && (activeRentals?.length ?? 0) > 0 && (
        <Card className="mb-3 border-destructive/50 bg-destructive/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            <div className="text-sm font-bold uppercase tracking-wide">Aktív bérelt palackok</div>
          </div>
          <div className="space-y-1">
            {(rentedCyls ?? []).map((c) => (
              <div key={c.id} className="font-mono text-sm text-destructive">{c.barcode}</div>
            ))}
            {(rentedCyls?.length ?? 0) === 0 && (
              <div className="text-xs text-destructive/80">Bérlet aktív, de a jelenlegi palack nincs hozzárendelve.</div>
            )}
          </div>
        </Card>
      )}
      {partnerId && (activeRentals?.length ?? 0) === 0 && (
        <Card className="mb-3 p-3 text-xs text-muted-foreground">Nincs aktív bérlet ennél a partnernél.</Card>
      )}

      {/* 3. BEÉRKEZŐ */}
      {partnerId && (
        <Card className="mb-3 p-4">
          <div className="mb-2 flex items-center justify-between">
            <Label>2. Beérkező ÜRES palack</Label>
            <Button size="sm" variant="secondary" onClick={() => setScanning("in")}><Camera className="mr-1 h-4 w-4" /> Scan</Button>
          </div>
          <div className="flex gap-2">
            <Input placeholder="Vonalkód" value={incomingBc} onChange={(e) => { setIncomingBc(e.target.value); setIncoming(null); }} onBlur={lookupIncoming} className="font-mono" />
            <Button variant="outline" onClick={lookupIncoming}>OK</Button>
          </div>
          {incoming && (
            <div className="mt-3 space-y-2">
              <KindBadge kind={incomingKind!} />
              <div className="flex flex-wrap gap-2">
                <Badge style={{ backgroundColor: incoming.circulation === "siad" ? "var(--siad)" : "var(--own)" }} className="text-background">
                  {circulationLabels[incoming.circulation]}
                </Badge>
                <Badge variant="outline">{incoming.gas_type} · {incoming.size}</Badge>
                <Badge variant="secondary">{locationLabels[incoming.location_type]}</Badge>
              </div>
              {history && history.length > 0 && (
                <div className="rounded-md bg-muted/40 p-2 text-xs">
                  <div className="mb-1 font-medium text-muted-foreground">Előélet (utolsó 5)</div>
                  {history.map((h) => (
                    <div key={h.id} className="flex justify-between border-t border-border/50 py-1">
                      <span>{locationLabels[h.from_location ?? ""] ?? "—"} → {locationLabels[h.to_location]}</span>
                      <span className="text-muted-foreground">{fmtDateTime(h.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* 4. KIADANDÓ */}
      {incoming && (
        <Card className="mb-3 p-4">
          <div className="mb-2 flex items-center justify-between">
            <Label>3. Kiadásra kerülő TELI palack</Label>
            <Button size="sm" variant="secondary" onClick={() => setScanning("out")}><Camera className="mr-1 h-4 w-4" /> Scan</Button>
          </div>
          <div className="flex gap-2">
            <Input placeholder="Vonalkód" value={outgoingBc} onChange={(e) => { setOutgoingBc(e.target.value); setOutgoing(null); }} onBlur={lookupOutgoing} className="font-mono" />
            <Button variant="outline" onClick={lookupOutgoing}>OK</Button>
          </div>
          {outgoing && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge style={{ backgroundColor: outgoing.circulation === "siad" ? "var(--siad)" : "var(--own)" }} className="text-background">
                {circulationLabels[outgoing.circulation]}
              </Badge>
              <Badge variant="outline">{outgoing.gas_type} · {outgoing.size}</Badge>
              {outgoingCreated && <Badge className="bg-orange-500 text-white">Új palack</Badge>}
            </div>
          )}
          {outgoingCreated && (
  <Card className="mt-3 border-orange-500/50 bg-orange-50 dark:bg-orange-950/20 p-3">
    <div className="mb-3 font-semibold">
      Új palack adatai
    </div>

    <div className="grid gap-3">
      <div>
        <Label>Gáz típusa</Label>
        <Select value={newGasType} onValueChange={setNewGasType}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Stargon">Stargon</SelectItem>
            <SelectItem value="Acetilén">Acetilén</SelectItem>
            <SelectItem value="Oxigén">Oxigén</SelectItem>
            <SelectItem value="Argon">Argon</SelectItem>
            <SelectItem value="CO2">CO₂</SelectItem>
            <SelectItem value="Nitrogén">Nitrogén</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Méret</Label>
        <Select value={newSize} onValueChange={setNewSize}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10L">10L</SelectItem>
            <SelectItem value="20L">20L</SelectItem>
            <SelectItem value="40L">40L</SelectItem>
            <SelectItem value="50L">50L</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Tulajdonos</Label>
        <Select
          value={newOwner}
          onValueChange={(v) => setNewOwner(v as "own" | "siad")}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="own">Saját</SelectItem>
            <SelectItem value="siad">SIAD</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  </Card>
)}
{isForced && (
            <div className="mt-3 space-y-2 rounded-md bg-warning/15 p-2 text-xs text-warning">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <div>Kényszerhelyettesítés: {circulationLabels[incoming.circulation]} → {circulationLabels[outgoing!.circulation]}</div>
              </div>
              <Input placeholder="Indoklás (kötelező)" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
        </Card>
      )}

      {/* 5. BÉRLET ÚJRARENDELÉS KÉRDÉS */}
      {needsRentalQuestion && (
        <Card className="mb-3 border-primary/50 bg-primary/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-primary">
            <Sparkles className="h-4 w-4" />
            <div className="text-sm font-semibold">Az új palack legyen a bérlet aktív palackja?</div>
          </div>
          <div className="mb-2 text-xs text-muted-foreground">
            Jelenlegi bérelt palack: <span className="font-mono">{rentedCyls?.[0]?.barcode ?? "—"}</span> → új: <span className="font-mono">{outgoing!.barcode}</span>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => setReassign("yes")} variant={reassign === "yes" ? "default" : "outline"}>IGEN</Button>
            <Button className="flex-1" onClick={() => setReassign("no")} variant={reassign === "no" ? "default" : "outline"}>NEM</Button>
          </div>
        </Card>
      )}

      {incoming && outgoing && (
        <>
          <Input className="mb-3" placeholder="Megjegyzés (opcionális)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="lg" className="w-full" disabled={busy} onClick={complete}>
            <Check className="mr-2 h-5 w-5" /> Csere rögzítése <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </>
      )}
    </AppShell>
  );
}

function KindBadge({ kind }: { kind: IncomingKind }) {
  const map = {
    rental: { label: "Bérelt palack", cls: "bg-red-500 text-white" },
    own: { label: "Saját palack", cls: "bg-green-600 text-white" },
    new: { label: "Új palack – első tranzakció", cls: "bg-orange-500 text-white" },
  } as const;
  const { label, cls } = map[kind];
  return <Badge className={cls}>{label}</Badge>;
}
