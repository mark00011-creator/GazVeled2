import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatSupabaseError } from "@/lib/supabase-error";
import { fmtDate, rentalTypeLabels, type RentalType } from "@/lib/labels";
import { rentalNumber } from "@/lib/rental-ops";
import { formatProfit } from "@/lib/dashboard-stats";
import { fetchSzamlazzPublicSettings } from "@/lib/invoice-drafts";

type FeeDueRental = {
  id: string;
  rental_type: RentalType | null;
  monthly_fee: number;
  start_date: string;
  partners: { name: string } | null;
};

type CylInfo = { gas_type: string; size: string; barcode: string };

export function UninvoicedRentalFeesCard() {
  const qc = useQueryClient();

  const { data: rows, isLoading, isError } = useQuery({
    queryKey: ["uninvoiced-rental-fees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rentals")
        .select("id, rental_type, monthly_fee, start_date, partners(name)")
        .eq("status", "active")
        .eq("initial_fee_invoiced", false)
        .gt("monthly_fee", 0)
        .order("start_date", { ascending: false })
        .limit(20);
      if (error) throw new Error(formatSupabaseError(error, "Bérleti díj emlékeztető"));
      return (data ?? []) as FeeDueRental[];
    },
  });

  const rentalIds = (rows ?? []).map((r) => r.id);

  const { data: gasByRental } = useQuery({
    queryKey: ["uninvoiced-rental-gas", rentalIds],
    enabled: rentalIds.length > 0,
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from("rental_cylinders")
        .select("rental_id, cylinders(barcode, gas_type, size)")
        .in("rental_id", rentalIds)
        .is("removed_at", null);
      if (error) throw new Error(formatSupabaseError(error, "Bérleti gáz tételek"));

      const map = new Map<string, CylInfo[]>();
      for (const link of links ?? []) {
        const cyl = (
          link as {
            rental_id: string;
            cylinders: CylInfo | CylInfo[] | null;
          }
        ).cylinders;
        const one = Array.isArray(cyl) ? cyl[0] : cyl;
        if (!one) continue;
        const list = map.get(link.rental_id) ?? [];
        list.push(one);
        map.set(link.rental_id, list);
      }

      const { data: qty, error: qErr } = await supabase
        .from("rental_quantity_items")
        .select("rental_id, gas_type, size, quantity")
        .in("rental_id", rentalIds);
      if (!qErr) {
        for (const row of qty ?? []) {
          const list = map.get(row.rental_id) ?? [];
          list.push({
            barcode: `${row.quantity} db`,
            gas_type: row.gas_type,
            size: row.size,
          });
          map.set(row.rental_id, list);
        }
      }

      return map;
    },
  });

  const { data: szSettings } = useQuery({
    queryKey: ["szamlazz-settings"],
    queryFn: fetchSzamlazzPublicSettings,
  });

  const markDone = useMutation({
    mutationFn: async (rentalId: string) => {
      const { error } = await supabase.rpc("mark_rental_initial_fee_invoiced", {
        p_rental_id: rentalId,
      });
      if (error) throw new Error(formatSupabaseError(error, "Számlázás rögzítése"));
    },
    onSuccess: () => {
      toast.success("Bérleti díj + gáz számlázása rögzítve");
      qc.invalidateQueries({ queryKey: ["uninvoiced-rental-fees"] });
      qc.invalidateQueries({ queryKey: ["uninvoiced-rental-gas"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || isError || !rows?.length) return null;

  const hasSzamlazz = !!szSettings?.has_agent_key;

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Bell className="h-4 w-4 text-warning" />
        <div className="text-sm font-semibold">Számlázandó bérlet (gáz + díj)</div>
        <Badge variant="outline">{rows.length}</Badge>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Új bérbeadásnál a gáztartalom és a bérleti díj is számlázandó
        {hasSzamlazz
          ? " – van Számlázz integráció, állítsd ki a számlát, majd rögzítsd."
          : " – emlékeztető: számlázd ki kézzel (gáz + díj), majd jelöld késznek."}
      </p>
      <div className="space-y-2">
        {rows.map((r) => {
          const type = (r.rental_type ?? "yearly") as RentalType;
          const feeLabel = type === "monthly" ? "Havi díj" : type === "yearly" ? "Éves díj" : "Díj";
          const gases = gasByRental?.get(r.id) ?? [];
          return (
            <div
              key={r.id}
              className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to="/rentals/$id" params={{ id: r.id }} className="font-semibold hover:underline">
                  {r.partners?.name ?? "—"}
                </Link>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {rentalNumber(r.id)}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {rentalTypeLabels[type]} · kezdés {fmtDate(r.start_date)} · {feeLabel}:{" "}
                <span className="font-medium text-foreground">
                  {formatProfit(Number(r.monthly_fee))}
                </span>
              </div>
              {gases.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    Számlázandó gáz / palack
                  </div>
                  {gases.map((g, i) => (
                    <div key={`${g.barcode}-${i}`} className="rounded-md bg-background/50 px-2 py-1 text-[11px]">
                      <span className="font-mono">{g.barcode}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {g.gas_type} {g.size}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <Button
                size="sm"
                variant="outline"
                className="mt-2 w-full"
                disabled={markDone.isPending}
                onClick={() => markDone.mutate(r.id)}
              >
                Gáz + díj számlázva – kész
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
