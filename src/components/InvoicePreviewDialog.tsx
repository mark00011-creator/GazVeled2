import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatProfit } from "@/lib/dashboard-stats";
import {
  fetchInvoiceDocument,
  updateInvoiceDraftItems,
  type InvoiceDraftItemInput,
} from "@/lib/invoice-drafts";
import { finalizeSzamlazzInvoice } from "@/lib/api/szamlazz.functions";
import { useAuth } from "@/lib/auth";

type Props = {
  documentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFinalized?: () => void;
};

export function InvoicePreviewDialog({ documentId, open, onOpenChange, onFinalized }: Props) {
  const { organization } = useAuth();
  const qc = useQueryClient();
  const [editItems, setEditItems] = useState<InvoiceDraftItemInput[]>([]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["invoice-document", documentId],
    enabled: open && !!documentId,
    queryFn: () => fetchInvoiceDocument(documentId!),
  });

  useEffect(() => {
    if (!data) return;
    setEditItems(
      data.items.map((it) => ({
        exchangeId: it.exchange_id,
        name: it.name,
        quantity: Number(it.quantity),
        unit: it.unit,
        netUnitPrice: it.net_unit_price,
        vatRate: it.vat_rate,
        note: it.note,
      })),
    );
  }, [data]);

  const saveItems = useMutation({
    mutationFn: async () => {
      if (!documentId || !organization?.id) throw new Error("Nincs dokumentum");
      await updateInvoiceDraftItems(documentId, organization.id, editItems);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice-document", documentId] });
      toast.success("Tételek mentve");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const finalize = useMutation({
    mutationFn: async () => {
      if (!documentId) throw new Error("Nincs dokumentum");
      if (organization?.id) {
        await updateInvoiceDraftItems(documentId, organization.id, editItems);
      }
      return finalizeSzamlazzInvoice({ data: { documentId, previewOnly: false } });
    },
    onSuccess: (res) => {
      toast.success(
        res.invoiceNumber
          ? `Számla kész: ${res.invoiceNumber}`
          : "Számla véglegesítve",
      );
      if (res.pdfBase64) {
        try {
          const bin = atob(res.pdfBase64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
          window.open(url, "_blank", "noopener,noreferrer");
        } catch {
          /* ignore */
        }
      }
      qc.invalidateQueries({ queryKey: ["uninvoiced-exchanges"] });
      onFinalized?.();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const grossPreview = editItems.reduce((s, it) => {
    const qty = it.quantity ?? 1;
    const net = (it.netUnitPrice || 0) * qty;
    const vatN = Number(it.vatRate);
    const vat = Number.isFinite(vatN) ? (net * vatN) / 100 : 0;
    return s + net + vat;
  }, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Számla előnézet</DialogTitle>
        </DialogHeader>

        {isLoading && <p className="text-sm text-muted-foreground">Betöltés…</p>}
        {isError && <p className="text-sm text-destructive">Nem sikerült betölteni</p>}

        {data && (
          <div className="space-y-3">
            <p className="text-sm">
              Partner: <span className="font-semibold">{data.partnerName}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Ellenőrizd a tételeket, majd véglegesítsd. A számla ekkor készül el a
              Számlázz.hu-n (API).
            </p>

            <div className="space-y-3">
              {editItems.map((it, idx) => (
                <div key={idx} className="space-y-2 rounded-lg border p-3">
                  <div>
                    <Label className="text-xs">Megnevezés</Label>
                    <Input
                      value={it.name}
                      onChange={(e) => {
                        const next = [...editItems];
                        next[idx] = { ...it, name: e.target.value };
                        setEditItems(next);
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs">Mennyiség</Label>
                      <Input
                        type="number"
                        min={0.001}
                        step="any"
                        value={it.quantity ?? 1}
                        onChange={(e) => {
                          const next = [...editItems];
                          next[idx] = { ...it, quantity: Number(e.target.value) || 1 };
                          setEditItems(next);
                        }}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Nettó egységár</Label>
                      <Input
                        type="number"
                        value={it.netUnitPrice}
                        onChange={(e) => {
                          const next = [...editItems];
                          next[idx] = {
                            ...it,
                            netUnitPrice: Math.round(Number(e.target.value) || 0),
                          };
                          setEditItems(next);
                        }}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">ÁFA</Label>
                      <Input
                        value={it.vatRate}
                        onChange={(e) => {
                          const next = [...editItems];
                          next[idx] = { ...it, vatRate: e.target.value };
                          setEditItems(next);
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between text-sm font-semibold">
              <span>Végösszeg (becsült)</span>
              <span>{formatProfit(Math.round(grossPreview))}</span>
            </div>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            variant="outline"
            disabled={saveItems.isPending || !data}
            onClick={() => saveItems.mutate()}
          >
            Tételek mentése
          </Button>
          <Button
            disabled={finalize.isPending || !data || data.document.status === "finalized"}
            onClick={() => finalize.mutate()}
          >
            {finalize.isPending ? "Küldés…" : "Számla véglegesítése"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
