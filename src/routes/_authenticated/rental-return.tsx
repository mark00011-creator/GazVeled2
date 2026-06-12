import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
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

function RentalReturn() {
  const { rentalId: initialRentalId, cylinderId: initialCylinderId } = Route.useSearch();
  const qc = useQueryClient();
  const [rentalId, setRentalId] = useState(initialRentalId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  useEffect(() => {
    setSelected(new Set());
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

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function submit() {
    if (!rental) return;
    if (selected.size === 0) {
      toast.error("Válassz legalább egy palackot");
      return;
    }
    setBusy(true);
    try {
      await returnRentalCylinders({
        rental_id: rental.id,
        cylinder_ids: [...selected],
        note: note.trim() || null,
      });
      toast.success("Palackok visszavéve");
      setNote("");
      await qc.invalidateQueries({ queryKey: ["rental-return-cyls", rental.id] });
      await qc.invalidateQueries({ queryKey: ["rentals-returnable"] });
      await qc.invalidateQueries({ queryKey: ["rentals"] });
      await qc.invalidateQueries({ queryKey: ["rental", rental.id] });
      await qc.invalidateQueries({ queryKey: ["rental-cyls", rental.id] });
      await qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      await qc.invalidateQueries({ queryKey: ["partner-rental-summaries"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
              <div className="text-sm text-muted-foreground">Nincs kint lévő palack</div>
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

          <Input className="mb-3" placeholder="Megjegyzés (opcionális)" value={note} onChange={(e) => setNote(e.target.value)} />

          <Button size="lg" className="w-full" disabled={busy || selected.size === 0 || cylsLoading} onClick={submit}>
            <Check className="mr-2 h-5 w-5" />
            Visszavétel ({selected.size} palack)
          </Button>
        </>
      )}

      {!rentalId && !rentalsLoading && (
        <div className="py-8 text-center text-sm text-muted-foreground">Válassz bérletet a visszavételhez</div>
      )}
    </AppShell>
  );
}
