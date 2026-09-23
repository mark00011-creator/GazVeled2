import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FileText, Plus, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/labels";
import {
  createDeliveryNoteDraft,
  finalizeDeliveryNote,
  listDeliveryNotes,
} from "@/lib/delivery-notes/ops";
import { downloadDeliveryNotePdf } from "@/lib/delivery-notes/pdf";
import type { DeliveryNoteItemInput } from "@/lib/delivery-notes/types";

export const Route = createFileRoute("/_authenticated/delivery-notes")({
  head: () => ({ meta: [{ title: "Szállítólevelek – Gáz Veled" }] }),
  component: DeliveryNotesPage,
});

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

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["delivery-notes"],
    queryFn: () => listDeliveryNotes(80),
  });

  const createManual = useMutation({
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
      const draft = await createDeliveryNoteDraft(
        {
          organizationId: organization.id,
          sourceType: "manual",
          shipperName: organization.name,
          consigneeName: consignee.trim(),
          consigneeAddress: consigneeAddress.trim() || null,
        },
        items,
      );
      const fin = await finalizeDeliveryNote(draft.id);
      downloadDeliveryNotePdf(fin.pdfBytes, `${fin.documentNumber}.pdf`);
      return fin;
    },
    onSuccess: (fin) => {
      toast.success(
        fin.adrReady
          ? `Szállítólevél kész: ${fin.documentNumber}`
          : `Szállítólevél kész (ADR figyelmeztetéssel): ${fin.documentNumber}`,
      );
      setManualOpen(false);
      qc.invalidateQueries({ queryKey: ["delivery-notes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const finalizeExisting = useMutation({
    mutationFn: async (id: string) => {
      const fin = await finalizeDeliveryNote(id);
      downloadDeliveryNotePdf(fin.pdfBytes, `${fin.documentNumber}.pdf`);
      return fin;
    },
    onSuccess: (fin) => {
      toast.success(`Véglegesítve: ${fin.documentNumber}`);
      qc.invalidateQueries({ queryKey: ["delivery-notes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Szállítólevelek">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Saját sorszámos szállítólevél / palackcsere bizonylat (ADR-2025). Számlázz Agent szállító
          később.
        </p>
        <Button size="sm" onClick={() => setManualOpen((v) => !v)}>
          <Plus className="mr-1 h-4 w-4" /> Új szállítólevél
        </Button>
      </div>

      {manualOpen && (
        <Card className="mb-4 space-y-3 p-4">
          <div className="text-sm font-semibold">Kézi szállítólevél</div>
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
              <Input value={gasType} onChange={(e) => setGasType(e.target.value)} placeholder="pl. Argon" />
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
          <Button
            className="w-full"
            disabled={createManual.isPending}
            onClick={() => createManual.mutate()}
          >
            Kiállítás és PDF
          </Button>
        </Card>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Betöltés…</p>}
      {isError && (
        <Card className="border-warning/40 bg-warning/5 p-4 text-sm">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" /> Szállítólevél tábla még nincs elérhető
          </div>
          <p className="text-xs text-muted-foreground">
            {(error as Error)?.message ??
              "Futtasd a migrációt (local/staging). Production apply ehhez a sprinthöz nincs engedélyezve."}
          </p>
        </Card>
      )}

      <div className="space-y-2">
        {(data ?? []).map((n) => (
          <Card key={n.id} className="p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="font-mono text-sm font-semibold">
                    {n.document_number ?? "Piszkozat"}
                  </span>
                  <Badge variant="outline">{n.status}</Badge>
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
              </div>
              <div className="flex gap-2">
                {n.status === "draft" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={finalizeExisting.isPending}
                    onClick={() => finalizeExisting.mutate(n.id)}
                  >
                    Véglegesítés
                  </Button>
                )}
                {n.status === "finalized" && (
                  <Button size="sm" variant="ghost" asChild>
                    <Link to="/delivery-notes">
                      <Download className="h-4 w-4" />
                    </Link>
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
    </AppShell>
  );
}
