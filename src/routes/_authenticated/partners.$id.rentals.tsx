import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Building2, CalendarPlus, RotateCcw } from "lucide-react";
import {
  circulationLabels,
  cylinderExpiryDate,
  fmtDate,
  formatRentalDuration,
  isRentalExpired,
  rentalDisplayStatus,
  rentalHasExpiredCylinder,
  rentalStatusLabels,
  rentalTypeLabels,
  summarizeRentalCylinders,
  type RentalType,
} from "@/lib/labels";
import { extendRentalCylinder, fetchPartnerRentalOverview, rentalNumber } from "@/lib/rental-ops";
import { summarizeRentalQuantityItems } from "@/lib/rental-quantity-stock";
import { PhoneLink } from "@/components/PhoneLink";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/partners/$id/rentals")({
  head: () => ({ meta: [{ title: "Bérleti partner – Gáz Veled" }] }),
  component: PartnerRentalsPage,
});

function PartnerRentalsPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: partner, isLoading: partnerLoading } = useQuery({
    queryKey: ["partner", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("partners").select("id, name, company_name, address, phone").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: overview, isLoading, isError } = useQuery({
    queryKey: ["partner-rental-overview", id],
    enabled: !!partner,
    queryFn: () => fetchPartnerRentalOverview(id),
  });

  async function extendCylinder(rentalId: string, cylinderId: string) {
    setBusyId(cylinderId);
    try {
      await extendRentalCylinder(rentalId, cylinderId);
      toast.success("Palack bérlete meghosszabbítva (+1 év)");
      qc.invalidateQueries({ queryKey: ["partner-rental-overview", id] });
      qc.invalidateQueries({ queryKey: ["rentals"] });
      qc.invalidateQueries({ queryKey: ["rental", rentalId] });
      qc.invalidateQueries({ queryKey: ["rental-cyls", rentalId] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (partnerLoading || isLoading) {
    return (
      <AppShell title="Bérleti partner">
        <div className="py-8 text-center text-sm text-muted-foreground">Betöltés…</div>
      </AppShell>
    );
  }

  if (!partner) {
    return (
      <AppShell title="Bérleti partner">
        <div className="py-8 text-center text-sm text-destructive">Partner nem található</div>
      </AppShell>
    );
  }

  const allCylinders = (overview ?? []).flatMap((o) => o.cylinders);
  const allQtyItems = (overview ?? []).flatMap((o) => o.quantity_items);
  const summary = summarizeRentalCylinders(allCylinders);
  const qtySummary = summarizeRentalQuantityItems(allQtyItems);

  return (
    <AppShell title={partner.name}>
      <Link to="/rentals">
        <Button variant="ghost" size="sm" className="mb-2">
          <ArrowLeft className="mr-1 h-4 w-4" /> Bérletek
        </Button>
      </Link>
      <Link to="/partners/$id" params={{ id }}>
        <Button variant="ghost" size="sm" className="mb-3">
          <ArrowLeft className="mr-1 h-4 w-4" /> Partner adatlap
        </Button>
      </Link>

      <Card className="mb-4 p-4">
        <div className="font-semibold text-lg">{partner.name}</div>
        {partner.company_name && (
          <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" /> {partner.company_name}
          </div>
        )}
        {partner.phone && (
          <div className="mt-1 text-sm text-muted-foreground">
            Telefon: <PhoneLink phone={partner.phone} />
          </div>
        )}
        {(summary.length > 0 || qtySummary.length > 0) && (
          <div className="mt-3">
            <div className="text-xs font-medium text-muted-foreground">Bérelt tételek összesen:</div>
            <div className="mt-1 space-y-0.5">
              {summary.map((line) => (
                <div key={line} className="text-sm text-primary">{line}</div>
              ))}
              {qtySummary.map((line) => (
                <div key={line} className="text-sm text-primary">{line}</div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {isError && <div className="py-4 text-center text-sm text-destructive">Bérleti adatok betöltése sikertelen</div>}

      <div className="space-y-4">
        {(overview ?? []).map(({ rental, cylinders, quantity_items }) => {
          const type = (rental.rental_type ?? "yearly") as RentalType;
          const hasExpiredCylinder = rentalHasExpiredCylinder(cylinders);
          const displayStatus = rentalDisplayStatus(rental.status);
          const qtyLines = summarizeRentalQuantityItems(quantity_items);

          return (
            <Card key={rental.id} className="overflow-hidden p-0">
              <div className={`border-b p-4 ${hasExpiredCylinder ? "border-destructive/40 bg-destructive/5" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Link to="/rentals/$id" params={{ id: rental.id }} className="font-mono text-sm font-semibold hover:underline">
                    {rentalNumber(rental.id)}
                  </Link>
                  <Badge variant={displayStatus === "expired" ? "destructive" : "default"}>
                    {rentalStatusLabels[displayStatus] ?? displayStatus}
                  </Badge>
                  {hasExpiredCylinder && <Badge variant="destructive">LEJÁRT PALACK</Badge>}
                  <Badge variant="outline">{rentalTypeLabels[type]}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>Kezdete: {fmtDate(rental.start_date)}</span>
                  {cylinders.length > 0 && (
                    <span className="text-muted-foreground">{cylinders.length} palack</span>
                  )}
                  {qtyLines.length > 0 && (
                    <span className="text-muted-foreground">{qtyLines.length} darabszám tétel</span>
                  )}
                </div>
                {qtyLines.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {qtyLines.map((line) => (
                      <div key={line} className="text-xs text-primary">{line}</div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-0">
                {cylinders.map((c) => {
                  const cylExpiry = cylinderExpiryDate(c);
                  const cylExpired = isRentalExpired(cylExpiry);
                  const owner = (c.owner ?? c.circulation ?? "own") as keyof typeof circulationLabels;
                  return (
                    <div
                      key={c.cylinder_id}
                      className={`border-b border-border/40 p-4 last:border-b-0 ${cylExpired ? "border-l-4 border-l-destructive bg-destructive/5" : ""}`}
                    >
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
                        <div>
                          <div className="text-muted-foreground">Vonalkód</div>
                          <div className="font-mono font-semibold">{c.barcode}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Gáz / méret</div>
                          <div>{c.gas_type} · {c.size}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Tulajdonos</div>
                          <div>{circulationLabels[owner] ?? owner}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Bérlet ideje</div>
                          <div>{formatRentalDuration(c.added_at)}</div>
                          <div className={cylExpired ? "font-medium text-destructive" : "text-muted-foreground"}>
                            Lejár: {fmtDate(cylExpiry)}
                          </div>
                        </div>
                      </div>
                      {cylExpired && <Badge variant="destructive" className="mt-2">LEJÁRT</Badge>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === c.cylinder_id}
                          onClick={() => extendCylinder(rental.id, c.cylinder_id)}
                        >
                          <CalendarPlus className="mr-1 h-3.5 w-3.5" /> Palack hosszabbítás
                        </Button>
                        <Button size="sm" variant="secondary" asChild>
                          <Link
                            to="/rental-return"
                            search={{ rentalId: rental.id, cylinderId: c.cylinder_id }}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Palack visszavétel
                          </Link>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>

      {!isLoading && !isError && (overview ?? []).length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">Nincs aktív bérelt palack ennél a partnernél</div>
      )}
    </AppShell>
  );
}
