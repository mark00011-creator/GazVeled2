import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import {
  cylinderHistoryEventLabels,
  fetchCylinderHistory,
  type CylinderHistoryRow,
} from "@/lib/cylinder-history";
import { fmtDateTime } from "@/lib/labels";

function resolvePartnerName(row: CylinderHistoryRow): string | null {
  if (row.partners?.name) return row.partners.name;
  const meta = row.metadata ?? {};
  if (typeof meta.partner_name === "string" && meta.partner_name.trim()) {
    return meta.partner_name;
  }
  return null;
}

function HistoryCard({ row }: { row: CylinderHistoryRow }) {
  const label =
    cylinderHistoryEventLabels[row.event_type as keyof typeof cylinderHistoryEventLabels] ??
    row.event_type;
  const partnerName = resolvePartnerName(row);
  const meta = row.metadata ?? {};
  const incoming = typeof meta.incoming_barcode === "string" ? meta.incoming_barcode : null;
  const outgoing = typeof meta.outgoing_barcode === "string" ? meta.outgoing_barcode : null;
  const hasOld = row.old_value != null && row.old_value !== "";
  const hasNew = row.new_value != null && row.new_value !== "";
  const dateTime = row.created_at ? fmtDateTime(row.created_at) : "—";
  const [datePart, ...timeParts] = dateTime.split(" ");

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm">{label}</div>
        <div className="shrink-0 text-right text-xs text-muted-foreground">
          <div>{datePart}</div>
          {timeParts.length > 0 && <div>{timeParts.join(" ")}</div>}
        </div>
      </div>

      <div className="mt-2 text-xs">
        <span className="text-muted-foreground">Felhasználó: </span>
        {typeof meta.user_label === "string" && meta.user_label ? meta.user_label : "—"}
      </div>

      <div className="mt-2 text-xs">
        <span className="text-muted-foreground">Partner: </span>
        {partnerName ?? "Nincs partner"}
      </div>

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

      {hasOld && hasNew && (
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

  const rows = (data ?? []).filter((row): row is CylinderHistoryRow => row != null && !!row.id);

  return (
    <div className="border-t pt-4">
      <h3 className="mb-3 text-sm font-semibold">Palack előélete</h3>
      {isLoading && <div className="text-sm text-muted-foreground">Betöltés…</div>}
      {isError && <div className="text-sm text-destructive">Előélet betöltése sikertelen</div>}
      {!isLoading && !isError && (
        <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
          {rows.map((row) => (
            <HistoryCard key={row.id} row={row} />
          ))}
          {rows.length === 0 && (
            <div className="py-4 text-center text-sm text-muted-foreground">
              Ehhez a palackhoz még nem tartozik naplózott esemény.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
