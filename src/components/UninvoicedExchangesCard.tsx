import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Receipt, Wrench } from "lucide-react";
import { toast } from "sonner";
import { fmtDateTime } from "@/lib/labels";
import {
  fetchUninvoicedExchanges,
  formatProfit,
  type UninvoicedExchange,
} from "@/lib/dashboard-stats";
import { useAuth } from "@/lib/auth";
import {
  buildDraftItemsFromUninvoicedGroup,
  createInvoiceDraft,
  fetchSzamlazzPublicSettings,
} from "@/lib/invoice-drafts";
import { InvoicePreviewDialog } from "@/components/InvoicePreviewDialog";
import { ExchangeOutgoingCorrectionDialog } from "@/components/ExchangeOutgoingCorrectionDialog";

export function UninvoicedExchangesCard() {
  const qc = useQueryClient();
  const { organization } = useAuth();
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [correctItem, setCorrectItem] = useState<{
    exchangeId: string;
    outgoingLabel: string;
  } | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["uninvoiced-exchanges"],
    queryFn: () => fetchUninvoicedExchanges(5),
  });

  const { data: szSettings } = useQuery({
    queryKey: ["szamlazz-settings"],
    queryFn: fetchSzamlazzPublicSettings,
  });

  const startInvoice = useMutation({
    mutationFn: async (group: UninvoicedExchange) => {
      if (!organization?.id) throw new Error("Nincs aktív cég");
      if (!szSettings?.has_agent_key) {
        throw new Error(
          "Nincs Számla Agent kulcs. Állítsd be a Cég beállításokban (teszt fiók ajánlott).",
        );
      }
      const tax = organization.settings.tax;
      const items = buildDraftItemsFromUninvoicedGroup({
        items: group.items.map((it) => ({
          exchangeId: it.exchangeId,
          outgoingLabel: it.outgoingLabel,
          eladasi_ar: it.eladasi_ar,
        })),
        taxRegime: tax.regime,
        defaultVatRate: tax.default_rate,
      });
      return createInvoiceDraft({
        organizationId: organization.id,
        partnerId: group.partnerId,
        batchId: group.batchId,
        items,
        paymentMethod: szSettings.payment_method,
      });
    },
    onSuccess: (docId) => {
      setPreviewDocId(docId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return null;
  if (isError) return null;
  if (!data || data.count === 0) return null;

  return (
    <>
      <Card className="mb-4 p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-warning" />
            <div className="text-sm font-semibold">Számlázatlan cserék</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold">{data.count} db</div>
            <div className="text-sm text-muted-foreground">
              {formatProfit(data.totalSaleValue)}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {data.recent.map((row) => (
            <div
              key={row.id}
              className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {fmtDateTime(row.created_at)}
                </span>
                <span className="font-semibold">{row.partnerName}</span>
              </div>
              <div className="space-y-1 text-xs">
                {row.items.map((item) => (
                  <div key={item.exchangeId} className="rounded-md bg-background/40 px-2 py-1.5">
                    <div>
                      <span className="text-muted-foreground">Átadott: </span>
                      <span className="font-mono">{item.outgoingLabel}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Átvett: </span>
                      <span className="font-mono">{item.incomingLabel}</span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="mt-1 h-7 px-2 text-xs"
                      onClick={() =>
                        setCorrectItem({
                          exchangeId: item.exchangeId,
                          outgoingLabel: item.outgoingLabel,
                        })
                      }
                    >
                      <Wrench className="mr-1 h-3 w-3" /> Téves kiadás javítása
                    </Button>
                  </div>
                ))}
                {row.pairCount > 1 && (
                  <div className="pt-1 text-muted-foreground">
                    {row.pairCount} tétel egy csoportban
                  </div>
                )}
                <div className="flex justify-between gap-2 pt-1">
                  <span>
                    Eladási ár:{" "}
                    <span className="font-medium">{formatProfit(row.eladasi_ar)}</span>
                  </span>
                  <span>
                    Profit: <span className="font-medium">{formatProfit(row.profit)}</span>
                  </span>
                </div>
              </div>
              <Button
                size="sm"
                className="mt-2 w-full"
                disabled={startInvoice.isPending}
                onClick={() => startInvoice.mutate(row)}
              >
                Számlázás…
              </Button>
            </div>
          ))}
        </div>

        {data.count > data.recent.length && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            +{data.count - data.recent.length} további csoport
          </p>
        )}
      </Card>

      <InvoicePreviewDialog
        documentId={previewDocId}
        open={!!previewDocId}
        onOpenChange={(o) => {
          if (!o) setPreviewDocId(null);
        }}
        onFinalized={() => {
          qc.invalidateQueries({ queryKey: ["uninvoiced-exchanges"] });
        }}
      />

      <ExchangeOutgoingCorrectionDialog
        exchangeId={correctItem?.exchangeId ?? ""}
        wrongOutgoingLabel={correctItem?.outgoingLabel ?? ""}
        open={!!correctItem}
        onOpenChange={(o) => {
          if (!o) setCorrectItem(null);
        }}
      />
    </>
  );
}
