import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Receipt } from "lucide-react";
import { toast } from "sonner";
import { fmtDateTime } from "@/lib/labels";
import {
  fetchUninvoicedExchanges,
  formatProfit,
  markUninvoicedGroupInvoiced,
  type UninvoicedExchangeSummary,
} from "@/lib/dashboard-stats";

export function UninvoicedExchangesCard() {
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["uninvoiced-exchanges"],
    queryFn: () => fetchUninvoicedExchanges(5),
  });

  const markInvoiced = useMutation({
    mutationFn: markUninvoicedGroupInvoiced,
    onMutate: async (group) => {
      await qc.cancelQueries({ queryKey: ["uninvoiced-exchanges"] });
      const prev = qc.getQueryData<UninvoicedExchangeSummary>(["uninvoiced-exchanges"]);
      if (prev) {
        const removed = prev.recent.find((r) => r.id === (group.batchId ?? group.exchangeIds[0]));
        qc.setQueryData<UninvoicedExchangeSummary>(["uninvoiced-exchanges"], {
          count: Math.max(0, prev.count - (removed ? 1 : 0)),
          totalSaleValue: Math.max(0, prev.totalSaleValue - (removed?.eladasi_ar ?? 0)),
          recent: prev.recent.filter((r) => r.id !== (group.batchId ?? group.exchangeIds[0])),
        });
      }
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(["uninvoiced-exchanges"], ctx.prev);
      toast.error((err as Error).message);
    },
    onSuccess: () => {
      toast.success("Kiszámlázva");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["uninvoiced-exchanges"] });
    },
  });

  if (isLoading) return null;
  if (isError) return null;
  if (!data || data.count === 0) return null;

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-warning" />
          <div className="text-sm font-semibold">Számlázásra váró gyors cserék</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">{data.count} db</div>
          <div className="text-sm text-muted-foreground">{formatProfit(data.totalSaleValue)}</div>
        </div>
      </div>

      <div className="space-y-3">
        {data.recent.map((row) => (
          <div
            key={row.id}
            className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{fmtDateTime(row.created_at)}</span>
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
                </div>
              ))}
              {row.pairCount > 1 && (
                <div className="pt-1 text-muted-foreground">{row.pairCount} tétel egy emlékeztetőben</div>
              )}
              <div className="flex justify-between gap-2 pt-1">
                <span>
                  Eladási ár: <span className="font-medium">{formatProfit(row.eladasi_ar)}</span>
                </span>
                <span>
                  Profit: <span className="font-medium">{formatProfit(row.profit)}</span>
                </span>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 w-full"
              disabled={markInvoiced.isPending}
              onClick={() =>
                markInvoiced.mutate({
                  batchId: row.batchId,
                  exchangeIds: row.exchangeIds,
                })
              }
            >
              Kiszámlázva
            </Button>
          </div>
        ))}
      </div>

      {data.count > data.recent.length && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          +{data.count - data.recent.length} további számlázatlan csere
        </p>
      )}
    </Card>
  );
}
