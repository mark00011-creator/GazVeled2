import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeftRight,
  Box,
  CalendarClock,
  CircleDot,
  Factory,
  Handshake,
  History,
  MapPin,
  Package,
  RefreshCw,
  Truck,
  User,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  cylinderHistoryEventLabels,
  cylinderHistoryEventTheme,
  fetchCylinderHistory,
  type CylinderHistoryEventType,
  type CylinderHistoryRow,
} from "@/lib/cylinder-history";
import { fmtDateTime } from "@/lib/labels";

const toneBorder: Record<
  (typeof cylinderHistoryEventTheme)[CylinderHistoryEventType]["tone"],
  string
> = {
  default: "border-l-primary",
  success: "border-l-emerald-500",
  warning: "border-l-amber-500",
  danger: "border-l-red-500",
  info: "border-l-sky-500",
  muted: "border-l-muted-foreground/40",
};

const eventIcons: Partial<Record<CylinderHistoryEventType, LucideIcon>> = {
  cylinder_created: Package,
  temp_created: Box,
  quick_exchange: ArrowLeftRight,
  chinese_brought: Package,
  chinese_take: Truck,
  partner_issue: Handshake,
  partner_return: Handshake,
  rental_start: CalendarClock,
  rental_extend: CalendarClock,
  rental_expiry_change: CalendarClock,
  rental_close: CalendarClock,
  loan_issue: Handshake,
  loan_return_empty: RefreshCw,
  loan_return_full: RefreshCw,
  supplier_exchange: Factory,
  supplier_received_from: Factory,
  temp_to_serial: RefreshCw,
  temp_to_chinese: RefreshCw,
  complaint_opened: AlertTriangle,
  complaint_closed: AlertTriangle,
  complaint: AlertTriangle,
  status_change: CircleDot,
  location_change: MapPin,
  warehouse_arrival: MapPin,
  warehouse_departure: MapPin,
};

function resolvePartnerName(row: CylinderHistoryRow): string | null {
  if (row.partners?.name) return row.partners.name;
  const meta = row.metadata ?? {};
  if (typeof meta.partner_name === "string" && meta.partner_name.trim()) {
    return meta.partner_name;
  }
  return null;
}

function resolveSupplierName(row: CylinderHistoryRow): string | null {
  const meta = row.metadata ?? {};
  if (typeof meta.supplier_name === "string" && meta.supplier_name.trim()) {
    return meta.supplier_name;
  }
  return null;
}

function resolveBarcode(row: CylinderHistoryRow): string | null {
  const meta = row.metadata ?? {};
  if (typeof meta.barcode === "string" && meta.barcode.trim()) return meta.barcode;
  return null;
}

function resolveNote(row: CylinderHistoryRow): string | null {
  const meta = row.metadata ?? {};
  if (typeof meta.note === "string" && meta.note.trim()) return meta.note.trim();
  return null;
}

function HistoryCard({ row }: { row: CylinderHistoryRow }) {
  const eventType = row.event_type as CylinderHistoryEventType;
  const label = cylinderHistoryEventLabels[eventType] ?? row.event_type;
  const theme = cylinderHistoryEventTheme[eventType] ?? cylinderHistoryEventTheme.cylinder_edited;
  const Icon = eventIcons[eventType] ?? History;

  const partnerName = resolvePartnerName(row);
  const supplierName = resolveSupplierName(row);
  const barcode = resolveBarcode(row);
  const note = resolveNote(row);
  const meta = row.metadata ?? {};
  const incoming = typeof meta.incoming_barcode === "string" ? meta.incoming_barcode : null;
  const outgoing = typeof meta.outgoing_barcode === "string" ? meta.outgoing_barcode : null;
  const hasOld = row.old_value != null && row.old_value !== "";
  const hasNew = row.new_value != null && row.new_value !== "";
  const dateTime = row.created_at ? fmtDateTime(row.created_at) : "—";
  const [datePart, ...timeParts] = dateTime.split(" ");

  return (
    <Card className={cn("border-l-4 p-3", toneBorder[theme.tone])}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="font-medium text-sm">{label}</div>
        </div>
        <div className="shrink-0 text-right text-xs text-muted-foreground">
          <div>{datePart}</div>
          {timeParts.length > 0 && <div>{timeParts.join(" ")}</div>}
        </div>
      </div>

      <div className="mt-2 grid gap-1 text-xs">
        <div className="flex items-center gap-1">
          <User className="h-3 w-3 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">Felhasználó: </span>
          {typeof meta.user_label === "string" && meta.user_label ? meta.user_label : "—"}
        </div>
        {barcode && (
          <div>
            <span className="text-muted-foreground">Vonalkód: </span>
            <span className="font-mono">{barcode}</span>
          </div>
        )}
        <div>
          <span className="text-muted-foreground">Partner: </span>
          {partnerName ?? "—"}
        </div>
        <div>
          <span className="text-muted-foreground">Szolgáltató: </span>
          {supplierName ?? "—"}
        </div>
      </div>

      {row.description && (
        <div className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{row.description}</div>
      )}

      {note && (
        <div className="mt-1 text-xs">
          <span className="text-muted-foreground">Megjegyzés: </span>
          {note}
        </div>
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
