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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Camera, Check, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { circulationLabels, fmtDateTime, locationLabels } from "@/lib/labels";
import {
  normalizeBarcode,
  resolveCylinderForSupplierReceive,
  resolveCylinderForSupplierReturn,
  submitSupplierExchange,
  tryFindCylinderByBarcode,
  type CylinderRow,
} from "@/lib/cylinder-ops";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { NewCylinderDialog } from "@/components/NewCylinderDialog";
import { usePermissions } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/suppliers")({
  head: () => ({ meta: [{ title: "Beszállítói csere – Gáz Veled" }] }),
  component: Suppliers,
});

type SupKind = "siad" | "own_supplier";
type DialogPhase = "return" | "receive";

function Suppliers() {
  const qc = useQueryClient();
  const { canWrite } = usePermissions();
  const [supplierId, setSupplierId] = useState("");
  const [returnBc, setReturnBc] = useState("");
  const [receiveBc, setReceiveBc] = useState("");
  const [returned, setReturned] = useState<CylinderRow[]>([]);
  const [received, setReceived] = useState<CylinderRow[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState<"return" | "receive" | null>(null);
  const [newCylDialog, setNewCylDialog] = useState(false);
  const [dialogPhase, setDialogPhase] = useState<DialogPhase>("receive");
  const [pendingBc, setPendingBc] = useState("");
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<SupKind>("siad");

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => (await supabase.from("suppliers").select("*").order("name")).data ?? [],
  });

  const { data: history } = useQuery({
    queryKey: ["supex"],
    queryFn: async () =>
      (
        await supabase
          .from("supplier_exchanges")
          .select("*, suppliers(name,kind)")
          .order("created_at", { ascending: false })
          .limit(20)
      ).data ?? [],
  });

  const selectedSupplier = (suppliers ?? []).find((s) => s.id === supplierId);
  const supplierKind = (selectedSupplier?.kind ?? "siad") as SupKind;

  function alreadyInList(list: CylinderRow[], id: string) {
    return list.some((c) => c.id === id);
  }

  async function handleDialogCreated(cyl: CylinderRow) {
    const isReturn = dialogPhase === "return";
    const list = isReturn ? returned : received;

    if (alreadyInList(list, cyl.id) || alreadyInList(isReturn ? received : returned, cyl.id)) {
      toast.error("A palack már a listában van");
      return;
    }

    if (isReturn) {
      setReturned((prev) => [...prev, cyl]);
      setReturnBc("");
    } else {
      setReceived((prev) => [...prev, cyl]);
      setReceiveBc("");
    }

    setPendingBc("");
    toast.success(`${cyl.barcode} hozzáadva`);
  }

  async function addReturned() {
    if (!returnBc.trim()) return;
    if (!supplierId) {
      toast.error("Előbb válassz beszállítót");
      return;
    }
    const bc = normalizeBarcode(returnBc);
    try {
      const existing = await tryFindCylinderByBarcode(bc);
      if (!existing) {
        setPendingBc(bc);
        setDialogPhase("return");
        setNewCylDialog(true);
        return;
      }
      const cyl = await resolveCylinderForSupplierReturn(bc, supplierId);
      if (alreadyInList(returned, cyl.id)) {
        toast.error("A palack már a listában van");
        return;
      }
      setReturned((prev) => [...prev, cyl]);
      setReturnBc("");
      toast.success(`${cyl.barcode} hozzáadva`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function addReceived() {
    if (!receiveBc.trim()) return;
    if (!supplierId) {
      toast.error("Előbb válassz beszállítót");
      return;
    }
    const bc = normalizeBarcode(receiveBc);
    try {
      const existing = await tryFindCylinderByBarcode(bc);
      if (!existing) {
        setPendingBc(bc);
        setDialogPhase("receive");
        setNewCylDialog(true);
        return;
      }
      const cyl = await resolveCylinderForSupplierReceive(bc, supplierId);
      if (alreadyInList(received, cyl.id)) {
        toast.error("A palack már a listában van");
        return;
      }
      setReceived((prev) => [...prev, cyl]);
      setReceiveBc("");
      toast.success(`${cyl.barcode} hozzáadva`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function addSupplier() {
    if (!newName.trim()) return;
    const { error } = await supabase.from("suppliers").insert({ name: newName, kind: newKind });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewName("");
    qc.invalidateQueries({ queryKey: ["suppliers"] });
    toast.success("Beszállító mentve");
  }

  async function submit() {
    if (!supplierId) {
      toast.error("Válassz beszállítót");
      return;
    }
    if (returned.length === 0 && received.length === 0) {
      toast.error("Adj hozzá legalább egy palackot");
      return;
    }
    setBusy(true);
    try {
      await submitSupplierExchange({
        supplier_id: supplierId,
        returned,
        received,
        note: note || null,
      });
      toast.success(`Rögzítve – ${returned.length} üres vissza, ${received.length} teli átvét`);
      setReturned([]);
      setReceived([]);
      setNote("");
      setReturnBc("");
      setReceiveBc("");
      qc.invalidateQueries({ queryKey: ["supex"] });
      qc.invalidateQueries({ queryKey: ["cylinders"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Beszállítói csere">
      {canWrite && scanning && (
        <BarcodeScanner
          onResult={async (t) => {
            const bc = normalizeBarcode(t);
            const phase = scanning;
            setScanning(null);
            if (phase === "return") {
              setReturnBc(bc);
              if (!supplierId) {
                toast.error("Előbb válassz beszállítót");
                return;
              }
              try {
                const existing = await tryFindCylinderByBarcode(bc);
                if (!existing) {
                  setPendingBc(bc);
                  setDialogPhase("return");
                  setNewCylDialog(true);
                  return;
                }
                const cyl = await resolveCylinderForSupplierReturn(bc, supplierId);
                if (alreadyInList(returned, cyl.id) || alreadyInList(received, cyl.id)) {
                  toast.error("A palack már a listában van");
                  return;
                }
                setReturned((prev) => [...prev, cyl]);
                setReturnBc("");
                toast.success(`${cyl.barcode} hozzáadva`);
              } catch (e) {
                toast.error((e as Error).message);
              }
            } else if (phase === "receive") {
              setReceiveBc(bc);
              if (!supplierId) {
                toast.error("Előbb válassz beszállítót");
                return;
              }
              try {
                const existing = await tryFindCylinderByBarcode(bc);
                if (!existing) {
                  setPendingBc(bc);
                  setDialogPhase("receive");
                  setNewCylDialog(true);
                  return;
                }
                const cyl = await resolveCylinderForSupplierReceive(bc, supplierId);
                if (alreadyInList(received, cyl.id) || alreadyInList(returned, cyl.id)) {
                  toast.error("A palack már a listában van");
                  return;
                }
                setReceived((prev) => [...prev, cyl]);
                setReceiveBc("");
                toast.success(`${cyl.barcode} hozzáadva`);
              } catch (e) {
                toast.error((e as Error).message);
              }
            }
          }}
          onClose={() => setScanning(null)}
        />
      )}

      {canWrite && (
        <NewCylinderDialog
          open={newCylDialog}
          onOpenChange={setNewCylDialog}
          barcode={pendingBc}
          status={dialogPhase === "return" ? "empty" : "full"}
          locationType={dialogPhase === "return" ? supplierKind : "warehouse_full"}
          locationSupplierId={dialogPhase === "return" ? supplierId : null}
          onCreated={handleDialogCreated}
        />
      )}

      {canWrite && (
        <Card className="mb-3 p-4">
          <Label className="mb-2 block">Beszállító</Label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger>
              <SelectValue placeholder="Válassz…" />
            </SelectTrigger>
            <SelectContent>
              {(suppliers ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({locationLabels[s.kind]})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="mt-3 flex gap-2">
            <Input
              placeholder="Új beszállító neve"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Select value={newKind} onValueChange={(v) => setNewKind(v as SupKind)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="siad">SIAD</SelectItem>
                <SelectItem value="own_supplier">Saját szolgáltató</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={addSupplier}>
              +
            </Button>
          </div>
        </Card>
      )}

      {canWrite && supplierId && (
        <>
          <Card className="mb-3 p-4">
            <div className="mb-2 flex items-center justify-between">
              <Label>1. Üres palackok visszaadása a beszállítónak</Label>
              <Button size="sm" variant="secondary" onClick={() => setScanning("return")}>
                <Camera className="mr-1 h-4 w-4" /> Scan
              </Button>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              Meglévő üres palack vonalkódja, vagy ismeretlen kód esetén új palack felvétele. A
              palack a beszállítóhoz kerül, nem törlődik.
            </p>
            <div className="flex gap-2">
              <Input
                className="font-mono"
                placeholder="Vonalkód"
                value={returnBc}
                onChange={(e) => setReturnBc(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addReturned()}
              />
              <Button variant="outline" onClick={addReturned}>
                Hozzáad
              </Button>
            </div>
            {returned.length > 0 && (
              <div className="mt-3 space-y-1">
                {returned.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1 text-xs"
                  >
                    <span className="font-mono">{c.barcode}</span>
                    <span className="text-muted-foreground">
                      {c.gas_type} · {circulationLabels[c.owner ?? c.circulation]}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => setReturned((p) => p.filter((x) => x.id !== c.id))}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="mb-3 p-4">
            <div className="mb-2 flex items-center justify-between">
              <Label>2. Teli palackok átvétele (opcionális)</Label>
              <Button size="sm" variant="secondary" onClick={() => setScanning("receive")}>
                <Camera className="mr-1 h-4 w-4" /> Scan
              </Button>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              Meglévő palack vonalkódja (pl. korábban üresen kiadott) vagy ismeretlen kód esetén új
              palack felvétele.
            </p>
            <div className="flex gap-2">
              <Input
                className="font-mono"
                placeholder="Vonalkód"
                value={receiveBc}
                onChange={(e) => setReceiveBc(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addReceived()}
              />
              <Button variant="outline" onClick={addReceived}>
                Hozzáad
              </Button>
            </div>
            {received.length > 0 && (
              <div className="mt-3 space-y-1">
                {received.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1 text-xs"
                  >
                    <span className="font-mono">{c.barcode}</span>
                    <span className="text-muted-foreground">
                      {c.gas_type} · {c.size} · {circulationLabels[c.owner ?? c.circulation]}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => setReceived((p) => p.filter((x) => x.id !== c.id))}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Input
            className="mb-3"
            placeholder="Megjegyzés (opcionális)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <Button className="w-full" size="lg" disabled={busy} onClick={submit}>
            <Check className="mr-2 h-5 w-5" />
            Tranzakció rögzítése ({returned.length} vissza, {received.length} átvét)
          </Button>
        </>
      )}

      {!canWrite && (
        <Card className="mb-4 p-4 text-sm text-muted-foreground">
          Viewer jogosultsággal beszállítói csere nem rögzíthető.
        </Card>
      )}

      <h2 className="mt-6 mb-2 text-sm font-semibold">Előzmények</h2>
      <div className="space-y-2">
        {(history ?? []).map((h) => (
          <Card key={h.id} className="p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">
                {(h as { suppliers?: { name: string } }).suppliers?.name ?? "—"}
              </div>
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
