import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileText, Plus, Download, AlertTriangle, Ban, Check } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/labels";
import {
  cancelDeliveryNote,
  createDeliveryNoteDraft,
  downloadStoredDeliveryNotePdf,
  finalizeDeliveryNote,
  listDeliveryNotes,
} from "@/lib/delivery-notes/ops";
import { downloadDeliveryNotePdf } from "@/lib/delivery-notes/pdf";
import type { DeliveryNoteItemInput, DeliveryNoteStatus } from "@/lib/delivery-notes/types";

export const Route = createFileRoute("/_authenticated/delivery-notes")({
  head: () => ({ meta: [{ title: "Szállítólevelek – Gáz Veled" }] }),
  component: DeliveryNotesPage,
});

function statusBadge(status: DeliveryNoteStatus) {
  if (status === "finalized") return <Badge>FINALIZED</Badge>;
  if (status === "cancelled") return <Badge variant="destructive">CANCELLED</Badge>;
  return <Badge variant="outline">DRAFT</Badge>;
}

function DeliveryNotesPage() {
  const { organization } = useAuth();
  const qc = useQueryClient();
  const [manualOpen, setManualOpen] = useState(false);
  const [consignee, setConsignee] = useState("");
  const [consigneeAddress, setConsigneeAddress] = useState("");
  const [gasType, setGasType] = useState("");
  const [size, setSize] = useState("");
  const [qty, setQty] = useState("1");
  const [role, setRole] = useState<"outgoing_full" | "incoming_empty">("incoming_empty");
  const [barcode, setBarcode] = useState("");
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["delivery-notes"],
    queryFn: () => listDeliveryNotes(80),
  });

  const createDraft = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("Nincs aktív cég");
      if (!consignee.trim()) throw new Error("Címzett kötelező");
      const quantity = Math.max(1, Number(qty) || 1);
      const items: DeliveryNoteItemInput[] = [
        {
          lineRole: role,
          cylinderState: role === "incoming_empty" ? "EMPTY_UNCLEANED" : "FULL",
          gasType: gasType.trim() || null,
          size: size.trim() || null,
          quantity,
          barcode: barcode.trim() || null,
        },
      ];
      return createDeliveryNoteDraft(
        {
          organizationId: organization.id,
          sourceType: "manual",
          shipperName: organization.name,
          consigneeName: consignee.trim(),
          consigneeAddress: consigneeAddress.trim() || null,
        },
        items,
      );
    },
    onSuccess: () => {
      toast.success("Piszkozat mentve – véglegesítheted a listából");
      setManualOpen(false);
      qc.invalidateQueries({ queryKey: ["delivery-notes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const finalizeMut = useMutation({
    mutationFn: async (id: string) => {
      const fin = await finalizeDeliveryNote(id);
      downloadDeliveryNotePdf(fin.pdfBytes, `${fin.documentNumber}.pdf`);
      return fin;
    },
    onSuccess: (fin) => {
      toast.success(
        fin.adrReady
          ? `Véglegesítve: ${fin.documentNumber}`
          : `Véglegesítve (ADR figyelmeztetés): ${fin.documentNumber}`,
      );
      qc.invalidateQueries({ queryKey: ["delivery-notes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: async () => {
      if (!cancelId) throw new Error("Nincs kiválasztott bizonylat");
      if (!cancelReason.trim()) throw new Error("Az érvénytelenítés indoka kötelező");
      const res = await cancelDeliveryNote(cancelId, cancelReason.trim());
      downloadDeliveryNotePdf(res.pdfBytes, `${res.documentNumber}-ERV.pdf`);
      return res;
    },
    onSuccess: (res) => {
      toast.success(`Érvénytelenítve: ${res.documentNumber}`);
      setCancelId(null);
      setCancelReason("");
      qc.invalidateQueries({ queryKey: ["delivery-notes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pdfMut = useMutation({
    mutationFn: (id: string) => downloadStoredDeliveryNotePdf(id),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Szállítólevelek">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Saját sorszámos szállítólevél / palackcsere bizonylat (ADR-2025). DRAFT → FINALIZED →
          CANCELLED.
        </p>
        <Button size="sm" onClick={() => setManualOpen((v) => !v)}>
          <Plus className="mr-1 h-4 w-4" /> Új szállítólevél
        </Button>
      </div>

      {manualOpen && (
        <Card className="mb-4 space-y-3 p-4">
          <div className="text-sm font-semibold">Kézi piszkozat</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label>Címzett *</Label>
              <Input value={consignee} onChange={(e) => setConsignee(e.target.value)} />
            </div>
            <div>
              <Label>Címzett cím</Label>
              <Input value={consigneeAddress} onChange={(e) => setConsigneeAddress(e.target.value)} />
            </div>
            <div>
              <Label>Gáztípus</Label>
              <Input value={gasType} onChange={(e) => setGasType(e.target.value)} placeholder="pl. Oxigén" />
            </div>
            <div>
              <Label>Méret</Label>
              <Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="pl. 50 L" />
            </div>
            <div>
              <Label>Darab</Label>
              <Input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min={1} />
            </div>
            <div>
              <Label>Sorszám (opcionális)</Label>
              <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={role === "incoming_empty" ? "default" : "outline"}
              onClick={() => setRole("incoming_empty")}
            >
              Üres (EMPTY_UNCLEANED)
            </Button>
            <Button
              size="sm"
              variant={role === "outgoing_full" ? "default" : "outline"}
              onClick={() => setRole("outgoing_full")}
            >
              Teli
            </Button>
          </div>
          <Button className="w-full" disabled={createDraft.isPending} onClick={() => createDraft.mutate()}>
            Piszkozat mentése
          </Button>
        </Card>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Betöltés…</p>}
      {isError && (
        <Card className="border-warning/40 bg-warning/5 p-4 text-sm">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" /> Szállítólevél tábla / migráció
          </div>
          <p className="text-xs text-muted-foreground">
            {(error as Error)?.message ??
              "Futtasd a delivery_notes migrációkat (local/staging). Production apply tiltva."}
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {(data ?? []).map((n) => (
          <Card key={n.id} className="p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="font-mono text-sm font-semibold">
                    {n.document_number ?? "Piszkozat"}
                  </span>
                  {statusBadge(n.status)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {n.consignee_name ?? "—"} · {fmtDateTime(n.issued_at ?? n.created_at)}
                </div>
                {n.adr_total_points != null && (
                  <div className="mt-1 text-xs">
                    ADR pont: {n.adr_total_points} / 1000
                    {n.adr_within_116 === false && (
                      <span className="ml-1 text-destructive">túllépés</span>
                    )}
                  </div>
                )}
                {n.status === "cancelled" && n.cancellation_reason && (
                  <div className="mt-1 text-xs text-destructive">
                    Érvénytelenítés oka: {n.cancellation_reason}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {n.status === "draft" && (
                  <Button
                    size="sm"
                    disabled={finalizeMut.isPending}
                    onClick={() => finalizeMut.mutate(n.id)}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" /> Véglegesítés
                  </Button>
                )}
                {(n.status === "finalized" || n.status === "cancelled") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pdfMut.isPending}
                    onClick={() => pdfMut.mutate(n.id)}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" /> PDF
                  </Button>
                )}
                {n.status === "finalized" && (
                  <Button size="sm" variant="destructive" onClick={() => setCancelId(n.id)}>
                    <Ban className="mr-1 h-3.5 w-3.5" /> Érvénytelenítés
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
        {!isLoading && !isError && (data?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">Még nincs szállítólevél.</p>
        )}
      </div>

      <Dialog
        open={!!cancelId}
        onOpenChange={(o) => {
          if (!o) {
            setCancelId(null);
            setCancelReason("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Szállítólevél érvénytelenítése</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            A bizonylatszám megmarad, a PDF „ÉRVÉNYTELENÍTVE” jelzést kap. Az indok kötelező.
          </p>
          <div>
            <Label>Indok *</Label>
            <Input
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="pl. Hibás partneradat"
            />
          </div>
          <DialogFooter className="grid grid-cols-2 gap-2 sm:space-x-0">
            <Button
              variant="outline"
              onClick={() => {
                setCancelId(null);
                setCancelReason("");
              }}
            >
              Mégse
            </Button>
            <Button
              variant="destructive"
              disabled={cancelMut.isPending || !cancelReason.trim()}
              onClick={() => cancelMut.mutate()}
            >
              Érvénytelenítés
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
