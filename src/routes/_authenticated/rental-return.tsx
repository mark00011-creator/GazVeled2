import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { fmtDate, rentalStatusLabels } from "@/lib/labels";
import {
  fetchRentalCylinderDetails,
  returnRentalCylinders,
  rentalNumber,
  type RentalCylinderDetail,
} from "@/lib/rental-ops";
import {
  fetchRentalQuantityItems,
  RENTAL_QUANTITY_KIND_LABELS,
  type RentalQuantityItem,
} from "@/lib/rental-quantity-stock";

export const Route = createFileRoute("/_authenticated/rental-return")({
  validateSearch: (s: Record<string, unknown>) => ({
    rentalId: typeof s.rentalId === "string" ? s.rentalId : "",
    cylinderId: typeof s.cylinderId === "string" ? s.cylinderId : "",
  }),
  head: () => ({ meta: [{ title: "Bérlet visszavétel – Gáz Veled" }] }),
  component: RentalReturn,
});

function CylinderRow({
  cyl,
  checked,
  onToggle,
}: {
  cyl: RentalCylinderDetail;
  checked: boolean;
  onToggle: (id: string) => void;
}) {
  const id = `cyl-${cyl.cylinder_id}`;
  return (
    <div className="flex items-center gap-3 rounded-md border border-border/60 p-2">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={() => onToggle(cyl.cylinder_id)}
        className="h-4 w-4 shrink-0 cursor-pointer rounded border border-primary"
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <div className="font-mono text-sm font-semibold">{cyl.barcode}</div>
        <div className="text-xs text-muted-foreground">
          {cyl.gas_type} · {cyl.size} · {cyl.status === "full" ? "Teli → telephely" : "Üres → telephely"}
        </div>
      </label>
    </div>
  );
}

function QuantityItemRow({
  item,
  returnQty,
  onChange,
}: {
  item: RentalQuantityItem;
  returnQty: number;
  onChange: (id: string, qty: number) => void;
}) {
  const kind =
    RENTAL_QUANTITY_KIND_LABELS[item.stock_kind as keyof typeof RENTAL_QUANTITY_KIND_LABELS] ??
    item.stock_kind;
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border border-border/60 p-2 sm:grid-cols-[minmax(0,1fr)_5rem_5rem]">
      <div className="min-w-0">
        <div className="text-sm font-medium">{kind}</div>
        <div className="text-xs text-muted-foreground">
          {item.gas_type} · {item.size}
        </div>
      </div>
      <div className="text-center text-xs text-muted-foreground">
        <div className="font-medium text-foreground">{item.quantity} db</div>
        <div>nála</div>
      </div>
      <div>
        <Label className="sr-only" htmlFor={`qty-${item.id}`}>
          Visszavétel
        </Label>
        <Input
          id={`qty-${item.id}`}
          type="number"
          min={0}
          max={item.quantity}
          value={returnQty}
          onChange={(e) => {
            const raw = Number(e.target.value);
            if (!Number.isFinite(raw)) return;
            const clamped = Math.max(0, Math.min(item.quantity, Math.round(raw)));
            onChange(item.id, clamped);
          }}
          className="h-9"
        />
      </div>
    </div>
  );
}

function RentalReturn() {
  const { rentalId: initialRentalId, cylinderId: initialCylinderId } = Route.useSearch();
  const qc = useQueryClient();
  const [rentalId, setRentalId] = useState(initialRentalId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qtyReturns, setQtyReturns] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialRentalId) setRentalId(initialRentalId);
  }, [initialRentalId]);

  const {
    data: rentals,
    isLoading: rentalsLoading,
    isError: rentalsError,
  } = useQuery({
    queryKey: ["rentals-returnable"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rentals")
        .select("id, partner_id, monthly_fee, deposit, start_date, status, partners(name, company_name)")
        .in("status", ["active", "expired", "cancelled"])
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const rental = (rentals ?? []).find((r) => r.id === rentalId);

  const {
    data: cylLinks,
    isLoading: cylsLoading,
    isError: cylsError,
    isFetching: cylsFetching,
  } = useQuery({
    queryKey: ["rental-return-cyls", rentalId],
    enabled: !!rentalId,
    queryFn: () => fetchRentalCylinderDetails(rentalId),
  });

  const {
    data: qtyItems,
    isLoading: qtyLoading,
    isError: qtyError,
    isFetching: qtyFetching,
  } = useQuery({
    queryKey: ["rental-return-qty", rentalId],
    enabled: !!rentalId,
    queryFn: () => fetchRentalQuantityItems(rentalId),
  });

  useEffect(() => {
    setSelected(new Set());
    setQtyReturns({});
  }, [rentalId]);

  useEffect(() => {
    if (!cylsFetching && cylLinks) {
      if (initialCylinderId && cylLinks.some((l) => l.cylinder_id === initialCylinderId)) {
        setSelected(new Set([initialCylinderId]));
      } else {
        setSelected(new Set(cylLinks.map((l) => l.cylinder_id)));
      }
    }
  }, [cylLinks, cylsFetching, initialCylinderId]);

  useEffect(() => {
    if (!qtyFetching && qtyItems) {
      const init: Record<string, number> = {};
      for (const item of qtyItems) init[item.id] = 0;
      setQtyReturns(init);
    }
  }, [qtyItems, qtyFetching]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const qtyReturnCount = useMemo(
    () => Object.values(qtyReturns).reduce((sum, q) => sum + (q > 0 ? q : 0), 0),
    [qtyReturns],
  );

  const quantityReturns = useMemo(
    () =>
      Object.entries(qtyReturns)
        .filter(([, q]) => q > 0)
        .map(([item_id, quantity]) => ({ item_id, quantity })),
    [qtyReturns],
  );

  const canSubmit = selected.size > 0 || qtyReturnCount > 0;

  async function submit() {
    if (!rental) return;
    if (!canSubmit) {
      toast.error("Válassz legalább egy palackot vagy darabszámú tételt");
      return;
    }
    setBusy(true);
    try {
      await returnRentalCylinders({
        rental_id: rental.id,
        cylinder_ids: selected.size > 0 ? [...selected] : [],
        quantity_returns: quantityReturns,
        note: note.trim() || null,
      });
      toast.success("Visszavétel rögzítve");
      setNote("");
      await qc.invalidateQueries({ queryKey: ["rental-return-cyls", rental.id] });
      await qc.invalidateQueries({ queryKey: ["rental-return-qty", rental.id] });
      await qc.invalidateQueries({ queryKey: ["rentals-returnable"] });
      await qc.invalidateQueries({ queryKey: ["rentals"] });
      await qc.invalidateQueries({ queryKey: ["rental", rental.id] });
      await qc.invalidateQueries({ queryKey: ["rental-cyls", rental.id] });
      await qc.invalidateQueries({ queryKey: ["rental-qty-items"] });
      await qc.invalidateQueries({ queryKey: ["rental-qty-summaries"] });
      await qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      await qc.invalidateQueries({ queryKey: ["partner-rental-summaries"] });
      await qc.invalidateQueries({ queryKey: ["partner-rental-overview"] });
      await qc.invalidateQueries({ queryKey: ["chinese-stock"] });
      await qc.invalidateQueries({ queryKey: ["flaga-pb-stock"] });
      await qc.invalidateQueries({ queryKey: ["prima-pb-stock"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const submitLabel =
    selected.size > 0 && qtyReturnCount > 0
      ? `Visszavétel (${selected.size} palack, ${qtyReturnCount} db)`
      : selected.size > 0
        ? `Visszavétel (${selected.size} palack)`
        : `Visszavétel (${qtyReturnCount} db)`;

  return (
    <AppShell title="Bérlet visszavétel">
      <Card className="mb-3 p-4">
        <Label className="mb-2 block">Bérlet</Label>
        {rentalsLoading ? (
          <div className="text-sm text-muted-foreground">Betöltés…</div>
        ) : rentalsError ? (
          <div className="text-sm text-destructive">Bérletek betöltése sikertelen</div>
        ) : (
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={rentalId}
            onChange={(e) => setRentalId(e.target.value)}
          >
            <option value="">Válassz…</option>
            {(rentals ?? []).map((r) => {
              const p = (r as { partners?: { name?: string } }).partners;
              return (
                <option key={r.id} value={r.id}>
                  {p?.name ?? "—"} · {rentalNumber(r.id)} · {rentalStatusLabels[r.status] ?? r.status}
                </option>
              );
            })}
          </select>
        )}
        {rental && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">Kezdés: {fmtDate(rental.start_date)}</Badge>
            <Badge variant="secondary">Kaució: {Number(rental.deposit ?? 0).toLocaleString("hu-HU")} Ft</Badge>
          </div>
        )}
      </Card>

      {rentalId && !rental && !rentalsLoading && (
        <div className="py-4 text-center text-sm text-muted-foreground">Bérlet nem található</div>
      )}

      {rental && (
        <>
          <Card className="mb-3 p-4">
            <Label className="mb-3 block">Visszavételre kerülő palackok</Label>
            {cylsLoading || cylsFetching ? (
              <div className="text-sm text-muted-foreground">Palackok betöltése…</div>
            ) : cylsError ? (
              <div className="text-sm text-destructive">Palackok betöltése sikertelen</div>
            ) : (cylLinks ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">Nincs kint lévő sorszámos palack</div>
            ) : (
              <div className="space-y-2">
                {(cylLinks ?? []).map((c) => (
                  <CylinderRow
                    key={c.cylinder_id}
                    cyl={c}
                    checked={selected.has(c.cylinder_id)}
                    onToggle={toggle}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card className="mb-3 p-4">
            <Label className="mb-3 block">Darabszámos bérelt tételek</Label>
            {qtyLoading || qtyFetching ? (
              <div className="text-sm text-muted-foreground">Tételek betöltése…</div>
            ) : qtyError ? (
              <div className="text-sm text-destructive">Tételek betöltése sikertelen</div>
            ) : (qtyItems ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">Nincs kint lévő darabszámos tétel</div>
            ) : (
              <div className="space-y-2">
                <div className="hidden grid-cols-[minmax(0,1fr)_5rem_5rem] gap-2 px-2 text-xs text-muted-foreground sm:grid">
                  <span>Tétel</span>
                  <span className="text-center">Nála</span>
                  <span>Visszavétel</span>
                </div>
                {(qtyItems ?? []).map((item) => (
                  <QuantityItemRow
                    key={item.id}
                    item={item}
                    returnQty={qtyReturns[item.id] ?? 0}
                    onChange={(id, qty) => setQtyReturns((prev) => ({ ...prev, [id]: qty }))}
                  />
                ))}
              </div>
            )}
          </Card>

          <Input className="mb-3" placeholder="Megjegyzés (opcionális)" value={note} onChange={(e) => setNote(e.target.value)} />

          <Button
            size="lg"
            className="w-full"
            disabled={busy || !canSubmit || cylsLoading || qtyLoading}
            onClick={submit}
          >
            <Check className="mr-2 h-5 w-5" />
            {submitLabel}
          </Button>
        </>
      )}

      {!rentalId && !rentalsLoading && (
        <div className="py-8 text-center text-sm text-muted-foreground">Válassz bérletet a visszavételhez</div>
      )}
    </AppShell>
  );
}
