import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, CalendarPlus, FileDown, Pencil, RotateCcw } from "lucide-react";
import {
  circulationLabels,
  effectiveRentalExpiry,
  fmtDate,
  isRentalExpired,
  rentalDisplayStatus,
  rentalStatusLabels,
  rentalTypeLabels,
  type RentalType,
} from "@/lib/labels";
import {
  advanceRentalBilling,
  extendRental,
  fetchRentalCylinderDetails,
  rentalNumber,
} from "@/lib/rental-ops";
import { updateCylinderBarcode } from "@/lib/cylinder-ops";
import { daysUntil, invoiceUrgency } from "@/lib/rental-billing";
import { downloadPdf, generateRentalContractPdf } from "@/lib/rental-contract-pdf";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/rentals/$id")({
  head: () => ({ meta: [{ title: "Bérlet – Gáz Veled" }] }),
  component: RentalDetail,
});

function RentalDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [editingBarcodeId, setEditingBarcodeId] = useState<string | null>(null);
  const [barcodeEdits, setBarcodeEdits] = useState<Record<string, string>>({});

  const { data: rental, isLoading, isError, refetch: refetchRental } = useQuery({
    queryKey: ["rental", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rentals")
        .select("*, partners(id, name, phone, email, address, company_name, tax_number)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const {
    data: cylLinks,
    isLoading: cylsLoading,
    isError: cylsError,
    refetch: refetchCyls,
  } = useQuery({
    queryKey: ["rental-cyls", id],
    enabled: !!rental,
    queryFn: () => fetchRentalCylinderDetails(id),
  });

  async function markInvoiced() {
    setBusyId("invoice");
    try {
      await advanceRentalBilling(id);
      toast.success("Következő számlázás frissítve");
      await refetchRental();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function doExtend() {
    setBusyId("extend");
    try {
      await extendRental(id);
      toast.success("Bérlet meghosszabbítva");
      await Promise.all([
        refetchRental(),
        refetchCyls(),
        qc.invalidateQueries({ queryKey: ["rentals"] }),
        qc.invalidateQueries({ queryKey: ["dashboard-stats"] }),
        qc.invalidateQueries({ queryKey: ["partner-rental-overview"] }),
        qc.invalidateQueries({ queryKey: ["partner-rental-summaries"] }),
      ]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function saveBarcode(cylinderId: string) {
    const newBarcode = barcodeEdits[cylinderId];
    if (!newBarcode?.trim()) {
      toast.error("Add meg a vonalkódot");
      return;
    }
    setBusyId(`barcode-${cylinderId}`);
    try {
      await updateCylinderBarcode(cylinderId, newBarcode);
      toast.success("Vonalkód mentve");
      setEditingBarcodeId(null);
      setBarcodeEdits((prev) => {
        const next = { ...prev };
        delete next[cylinderId];
        return next;
      });
      await refetchCyls();
      qc.invalidateQueries({ queryKey: ["cylinders"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function generatePdf() {
    if (!rental) return;
    setPdfBusy(true);
    try {
      const partner = (
        rental as {
          partners?: {
            name: string;
            company_name?: string | null;
            address?: string | null;
            phone?: string | null;
            email?: string | null;
            tax_number?: string | null;
          };
        }
      ).partners;
      const bytes = await generateRentalContractPdf({
        rentalId: id,
        rentalType: (rental.rental_type ?? "yearly") as RentalType,
        partner: {
          name: partner?.name ?? "—",
          company_name: partner?.company_name,
          address: partner?.address,
          phone: partner?.phone,
          email: partner?.email,
          tax_number: partner?.tax_number,
        },
        startDate: rental.start_date,
        expiryDate: rental.expiry_date,
        monthlyFee: Number(rental.monthly_fee),
        deposit: Number(rental.deposit),
        cylinders: (cylLinks ?? []).map((c) => ({ barcode: c.barcode, gas_type: c.gas_type, size: c.size })),
      });
      downloadPdf(bytes, `berlet-${rentalNumber(id)}.pdf`);
      toast.success("PDF letöltve");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPdfBusy(false);
    }
  }

  if (isLoading) {
    return (
      <AppShell title="Bérlet">
        <div className="py-8 text-center text-sm text-muted-foreground">Betöltés…</div>
      </AppShell>
    );
  }

  if (isError || !rental) {
    return (
      <AppShell title="Bérlet">
        <div className="py-8 text-center text-sm text-destructive">Bérlet nem található</div>
      </AppShell>
    );
  }

  const partner = (rental as { partners?: { id: string; name: string } }).partners;
  const rentalType = (rental.rental_type ?? "yearly") as RentalType;
  const rentalExpiry = effectiveRentalExpiry(rental.start_date, rental.expiry_date);
  const expired = isRentalExpired(rentalExpiry);
  const displayStatus = rentalDisplayStatus(rental.status, rentalExpiry);
  const days = rentalType === "monthly" ? daysUntil(rental.next_invoice_date) : null;
  const urgency = invoiceUrgency(days);
  const canExtend = rental.status !== "closed";
  const canReturn = ["active", "expired", "cancelled"].includes(rental.status);

  return (
    <AppShell title="Bérlet adatlap">
      <Link to="/rentals">
        <Button variant="ghost" size="sm" className="mb-3">
          <ArrowLeft className="mr-1 h-4 w-4" /> Vissza
        </Button>
      </Link>

      {partner && (
        <Link to="/partners/$id/rentals" params={{ id: partner.id }}>
          <Button variant="outline" size="sm" className="mb-3 w-full">
            {partner.name} – bérleti áttekintés
          </Button>
        </Link>
      )}

      {rental.status !== "closed" && (
        <Card
          className={`mb-4 p-4 text-center text-sm font-semibold ${
            expired ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-primary/30 bg-primary/5"
          }`}
        >
          {expired ? (
            "LEJÁRT"
          ) : (
            <>Hosszabbítás szükséges: {fmtDate(rentalExpiry)}</>
          )}
        </Card>
      )}

      <Card className="mb-4 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">{rentalNumber(rental.id)}</span>
          <Badge variant={displayStatus === "expired" ? "destructive" : "default"}>
            {rentalStatusLabels[displayStatus] ?? displayStatus}
          </Badge>
          {expired && rental.status !== "closed" && <Badge variant="destructive">LEJÁRT</Badge>}
          <Badge variant="outline">{rentalTypeLabels[rentalType]}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Info label="Státusz" value={rentalStatusLabels[displayStatus] ?? displayStatus} />
          <Info label="Partner" value={partner?.name ?? "—"} bold />
          <Info label="Bérlet típusa" value={rentalTypeLabels[rentalType]} />
          <Info label="Kezdő dátum" value={fmtDate(rental.start_date)} />
          <Info label="Lejárati dátum" value={fmtDate(rentalExpiry)} highlight={expired} highlightTone="red" />
          {rental.next_invoice_date && (
            <Info
              label="Következő számlázás"
              value={fmtDate(rental.next_invoice_date)}
              highlight={rentalType === "monthly" && urgency !== "green"}
              highlightTone={rentalType === "monthly" ? urgency : undefined}
            />
          )}
          <Info
            label={rentalType === "monthly" ? "Havi díj" : "Díj"}
            value={`${Number(rental.monthly_fee).toLocaleString("hu-HU")} Ft${rentalType === "monthly" ? "/hó" : ""}`}
          />
          <Info label="Kaució" value={`${Number(rental.deposit).toLocaleString("hu-HU")} Ft`} />
          {rental.end_date && <Info label="Lezárva" value={fmtDate(rental.end_date)} />}
        </div>

        {rental.status === "active" && rentalType === "monthly" && rental.next_invoice_date && (
          <Button className="mt-4 w-full" variant="outline" size="sm" disabled={busyId === "invoice"} onClick={markInvoiced}>
            Számlázás rögzítve – következő hónap
          </Button>
        )}
        <Button className="mt-2 w-full" variant="outline" size="sm" disabled={pdfBusy} onClick={generatePdf}>
          <FileDown className="mr-2 h-4 w-4" /> PDF szerződés generálása
        </Button>
      </Card>

      <Card className="mb-4 overflow-hidden p-0">
        <h2 className="border-b px-4 py-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Bérelt palackok ({(cylLinks ?? []).length})
        </h2>

        {cylsLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Betöltés…</div>
        ) : cylsError ? (
          <div className="p-4 text-sm text-destructive">Palackok betöltése sikertelen</div>
        ) : (cylLinks ?? []).length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Nincs palack hozzárendelve</div>
        ) : (
          <div>
            {(cylLinks ?? []).map((c) => {
              const cylExpiry = c.expiry_date ?? rentalExpiry;
              const cylExpired = isRentalExpired(cylExpiry);
              const owner = (c.owner ?? c.circulation ?? "own") as keyof typeof circulationLabels;
              const isEditing = editingBarcodeId === c.cylinder_id;
              const editValue = barcodeEdits[c.cylinder_id] ?? c.barcode;

              return (
                <div
                  key={c.cylinder_id}
                  className={`border-b border-border/40 p-4 last:border-b-0 ${cylExpired ? "border-l-4 border-l-destructive bg-destructive/5" : ""}`}
                >
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
                    <div>
                      <div className="text-muted-foreground">Vonalkód</div>
                      <div className="font-mono font-semibold">{c.barcode}</div>
                      {isEditing && (
                        <div className="mt-2 flex gap-1">
                          <Input
                            className="h-8 font-mono text-xs"
                            value={editValue}
                            onChange={(e) =>
                              setBarcodeEdits((prev) => ({ ...prev, [c.cylinder_id]: e.target.value }))
                            }
                          />
                          <Button
                            size="sm"
                            className="h-8 shrink-0 px-2 text-xs"
                            disabled={busyId === `barcode-${c.cylinder_id}`}
                            onClick={() => saveBarcode(c.cylinder_id)}
                          >
                            Mentés
                          </Button>
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-muted-foreground">Gáz</div>
                      <div>{c.gas_type}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Méret</div>
                      <div>{c.size}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Tulajdonos</div>
                      <div>{circulationLabels[owner] ?? owner}</div>
                    </div>
                  </div>
                  {cylExpired && <Badge variant="destructive" className="mt-2">LEJÁRT</Badge>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingBarcodeId(isEditing ? null : c.cylinder_id);
                        setBarcodeEdits((prev) => ({ ...prev, [c.cylinder_id]: c.barcode }));
                      }}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Vonalkód szerkesztése
                    </Button>
                    {canExtend && (
                      <Button size="sm" variant="outline" disabled={busyId === "extend"} onClick={doExtend}>
                        <CalendarPlus className="mr-1 h-3.5 w-3.5" /> Tovább bérli
                      </Button>
                    )}
                    {canReturn && (
                      <Button size="sm" variant="secondary" asChild>
                        <Link to="/rental-return" search={{ rentalId: id }}>
                          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Visszahozta
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </AppShell>
  );
}

function Info({
  label,
  value,
  bold,
  highlight,
  highlightTone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
  highlightTone?: "green" | "yellow" | "red";
}) {
  const cls =
    highlight && highlightTone === "red"
      ? "text-destructive font-medium"
      : highlight && highlightTone === "yellow"
        ? "text-warning font-medium"
        : bold
          ? "font-semibold"
          : "";
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cls}>{value}</div>
    </div>
  );
}
