import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import {
  cylinderHistoryEventLabels,
  fetchCylinderHistory,
  type CylinderHistoryRow,
} from "@/lib/cylinder-history";
import { fmtDateTime } from "@/lib/labels";

function HistoryCard({ row }: { row: CylinderHistoryRow }) {
  const label =
    cylinderHistoryEventLabels[row.event_type as keyof typeof cylinderHistoryEventLabels] ??
    row.event_type;
  const partnerName =
    row.partners?.name ??
    (typeof row.metadata?.partner_name === "string" ? row.metadata.partner_name : null);
  const incoming =
    typeof row.metadata?.incoming_barcode === "string" ? row.metadata.incoming_barcode : null;
  const outgoing =
    typeof row.metadata?.outgoing_barcode === "string" ? row.metadata.outgoing_barcode : null;

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm">{label}</div>
        <div className="shrink-0 text-right text-xs text-muted-foreground">
          <div>{fmtDateTime(row.created_at).split(" ")[0]}</div>
          <div>{fmtDateTime(row.created_at).split(" ").slice(1).join(" ")}</div>
        </div>
      </div>

      {partnerName && (
        <div className="mt-2 text-xs">
          <span className="text-muted-foreground">Partner: </span>
          {partnerName}
        </div>
      )}

      {row.description && (
        <div className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{row.description}</div>
      )}

      {incoming && outgoing && row.event_type === "quick_exchange" && (
        <div className="mt-2 space-y-0.5 text-xs">
          <div>
            <span className="text-muted-foreground">Leadott: </span>
            <span className="font-mono">{incoming}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Kapott: </span>
            <span className="font-mono">{outgoing}</span>
          </div>
        </div>
      )}

      {row.old_value != null && row.new_value != null && (
        <div className="mt-2 text-xs font-medium">
          {row.old_value} → {row.new_value}
        </div>
      )}
    </Card>
  );
}

export function CylinderHistorySection({
  cylinderId,
  enabled = true,
}: {
  cylinderId: string | null | undefined;
  enabled?: boolean;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["cylinder-history", cylinderId],
    enabled: enabled && !!cylinderId,
    queryFn: () => fetchCylinderHistory(cylinderId!),
  });

  if (!cylinderId) return null;

  return (
    <div className="border-t pt-4">
      <h3 className="mb-3 text-sm font-semibold">Palack előélete</h3>
      {isLoading && <div className="text-sm text-muted-foreground">Betöltés…</div>}
      {isError && <div className="text-sm text-destructive">Előélet betöltése sikertelen</div>}
      {!isLoading && !isError && (
        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {(data ?? []).map((row) => (
            <HistoryCard key={row.id} row={row} />
          ))}
          {(data ?? []).length === 0 && (
            <div className="py-4 text-center text-sm text-muted-foreground">Még nincs esemény</div>
          )}
        </div>
      )}
    </div>
  );
}
