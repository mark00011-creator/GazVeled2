import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, CalendarPlus, FileDown, Pencil, RotateCcw, ArrowRightLeft } from "lucide-react";
import {
  circulationLabels,
  cylinderExpiryDate,
  fmtDate,
  formatPressureTestYear,
  isRentalExpired,
  rentalDisplayStatus,
  rentalStatusLabels,
  rentalTypeLabels,
  type RentalType,
} from "@/lib/labels";
import {
  advanceRentalBilling,
  convertTempRentalCylinderToChinese,
  extendRentalCylinder,
  extendRentalQuantityItem,
  fetchRentalCylinderDetails,
  fetchRentalWithPartner,
  isTempRentalCylinder,
  rentalNumber,
  updateRentalCylinderExpiry,
  updateRentalQuantityItemExpiry,
} from "@/lib/rental-ops";
import { logSupabaseError } from "@/lib/supabase-error";
import { convertTempCylinderToRealSerial, updateCylinderBarcode } from "@/lib/cylinder-ops";
import { daysUntil, invoiceUrgency } from "@/lib/rental-billing";
import {
  buildContractLines,
  downloadPdf,
  generateRentalContractPdf,
} from "@/lib/rental-contract-pdf";
import {
  fetchRentalQuantityItems,
  quantityItemExpiryDate,
  quantityItemStartDate,
  RENTAL_QUANTITY_KIND_LABELS,
  toContractStockItems,
} from "@/lib/rental-quantity-stock";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { PhoneLink } from "@/components/PhoneLink";
import { GAS_TYPES, getAvailableSizes } from "@/lib/gas-cylinder-form";

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
  const [cylinderExpiryEdits, setCylinderExpiryEdits] = useState<Record<string, string>>({});
  const [qtyExpiryEdits, setQtyExpiryEdits] = useState<Record<string, string>>({});
  const [convertTarget, setConvertTarget] = useState<{ cylinder_id: string; barcode: string } | null>(null);
  const [convertGas, setConvertGas] = useState("Stargon");
  const [convertSize, setConvertSize] = useState("20 L");
  const [convertQty, setConvertQty] = useState("1");
  const barcodeSaveInFlightRef = useRef<string | null>(null);

  const {
    data: rental,
    isLoading,
    isError,
    refetch: refetchRental,
  } = useQuery({
    queryKey: ["rental", id],
    queryFn: async () => {
      try {
        return await fetchRentalWithPartner(id);
      } catch (e) {
        logSupabaseError("rental adatlap → fetchRentalWithPartner", null, {
          rentalId: id,
          thrown: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
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
    queryFn: async () => {
      try {
        return await fetchRentalCylinderDetails(id);
      } catch (e) {
        logSupabaseError("rental adatlap → fetchRentalCylinderDetails", null, {
          rentalId: id,
          thrown: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    },
  });

  const {
    data: qtyItems,
    isLoading: qtyLoading,
    refetch: refetchQty,
  } = useQuery({
    queryKey: ["rental-qty-items", id],
    enabled: !!rental,
    queryFn: () => fetchRentalQuantityItems(id),
  });

  useEffect(() => {
    if (!cylLinks) return;
    const next: Record<string, string> = {};
    for (const c of cylLinks) {
      const expiry = cylinderExpiryDate(c);
      if (expiry) next[c.cylinder_id] = expiry;
    }
    setCylinderExpiryEdits(next);
  }, [cylLinks]);

  useEffect(() => {
    if (!qtyItems) return;
    const next: Record<string, string> = {};
    for (const item of qtyItems) {
      next[item.id] = quantityItemExpiryDate(item);
    }
    setQtyExpiryEdits(next);
  }, [qtyItems]);

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

  async function invalidateRentalQueries() {
    await Promise.all([
      refetchRental(),
      refetchCyls(),
      refetchQty(),
      qc.invalidateQueries({ queryKey: ["rentals"] }),
      qc.invalidateQueries({ queryKey: ["rental-qty-items", id] }),
      qc.invalidateQueries({ queryKey: ["rental-qty-summaries"] }),
      qc.invalidateQueries({ queryKey: ["rental-cyl-summaries"] }),
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] }),
      qc.invalidateQueries({ queryKey: ["partner-rental-overview"] }),
      qc.invalidateQueries({ queryKey: ["partner-rental-summaries"] }),
      qc.invalidateQueries({ queryKey: ["history"] }),
    ]);
  }

  async function saveTempToChinese() {
    if (!convertTarget) return;
    const qty = Number(convertQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Érvényes darabszámot adj meg");
      return;
    }
    setBusyId(`convert-${convertTarget.cylinder_id}`);
    try {
      await convertTempRentalCylinderToChinese({
        rental_id: id,
        cylinder_id: convertTarget.cylinder_id,
        gas_type: convertGas,
        size: convertSize,
        quantity: qty,
      });
      toast.success("TEMP palack átalakítva kínai tétellé");
      setConvertTarget(null);
      await invalidateRentalQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const convertSizes = getAvailableSizes(convertGas);

  async function doExtendCylinder(cylinderId: string) {
    setBusyId(`extend-${cylinderId}`);
    try {
      await extendRentalCylinder(id, cylinderId);
      toast.success("Palack bérlete meghosszabbítva");
      await invalidateRentalQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function saveCylinderExpiry(cylinderId: string) {
    const expiry = cylinderExpiryEdits[cylinderId];
    if (!expiry) {
      toast.error("Add meg a lejárati dátumot");
      return;
    }
    setBusyId(`expiry-${cylinderId}`);
    try {
      await updateRentalCylinderExpiry(id, cylinderId, expiry);
      toast.success("Palack lejárata mentve");
      await invalidateRentalQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function doExtendQuantityItem(itemId: string) {
    setBusyId(`extend-qty-${itemId}`);
    try {
      await extendRentalQuantityItem(id, itemId);
      toast.success("Darabszámos tétel bérlete meghosszabbítva");
      await invalidateRentalQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function saveQuantityItemExpiry(itemId: string) {
    const expiry = qtyExpiryEdits[itemId];
    if (!expiry) {
      toast.error("Add meg a lejárati dátumot");
      return;
    }
    setBusyId(`expiry-qty-${itemId}`);
    try {
      await updateRentalQuantityItemExpiry(id, itemId, expiry);
      toast.success("Darabszámos tétel lejárata mentve");
      await invalidateRentalQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function saveBarcode(cylinderId: string, rawBarcode?: string) {
    const busyKey = `barcode-${cylinderId}`;
    console.log("[TEMP-BARCODE-DIAG] saveBarcode entered", {
      cylinderId,
      busyId,
      busyKey,
      inFlight: barcodeSaveInFlightRef.current,
      rawBarcode,
    });
    if (barcodeSaveInFlightRef.current === cylinderId) {
      console.log("[TEMP-BARCODE-DIAG] saveBarcode blocked: in-flight ref", { cylinderId });
      toast.message("Mentés folyamatban…");
      return;
    }
    if (busyId === busyKey) {
      console.log("[TEMP-BARCODE-DIAG] saveBarcode blocked: busyId match", { busyId, busyKey });
      toast.message("Mentés folyamatban…");
      return;
    }

    const newBarcode = (rawBarcode ?? barcodeEdits[cylinderId] ?? "").trim();
    console.log("[TEMP-BARCODE-DIAG] saveBarcode normalized input", { newBarcode });
    if (!newBarcode) {
      toast.error("Add meg a vonalkódot");
      return;
    }
    const cyl = (cylLinks ?? []).find((c) => c.cylinder_id === cylinderId);
    console.log("[TEMP-BARCODE-DIAG] saveBarcode cylinder row", {
      found: !!cyl,
      isTemp: cyl ? isTempRentalCylinder(c) : null,
      barcode: cyl?.barcode,
    });
    barcodeSaveInFlightRef.current = cylinderId;
    setBusyId(busyKey);
    try {
      if (cyl && isTempRentalCylinder(c)) {
        console.log("[TEMP-BARCODE-DIAG] calling convertTempCylinderToRealSerial", {
          temp_cylinder_id: cylinderId,
          new_barcode: newBarcode,
          rental_id: id,
        });
        const mode = await convertTempCylinderToRealSerial({
          temp_cylinder_id: cylinderId,
          new_barcode: newBarcode,
          rental_id: id,
        });
        console.log("[TEMP-BARCODE-DIAG] convertTempCylinderToRealSerial done", { mode });
        toast.success(
          mode === "migrated"
            ? "TEMP palack átmigrálva valódi sorszámra"
            : "TEMP palack valódi sorszámmá alakítva",
        );
      } else {
        console.log("[TEMP-BARCODE-DIAG] calling updateCylinderBarcode", { cylinderId, newBarcode });
        await updateCylinderBarcode(cylinderId, newBarcode);
        console.log("[TEMP-BARCODE-DIAG] updateCylinderBarcode done");
        toast.success("Vonalkód mentve");
      }
      setEditingBarcodeId(null);
      setBarcodeEdits((prev) => {
        const next = { ...prev };
        delete next[cylinderId];
        return next;
      });
      await invalidateRentalQueries();
    } catch (e) {
      console.error("[TEMP-BARCODE-DIAG] saveBarcode error", e);
      toast.error((e as Error).message);
    } finally {
      barcodeSaveInFlightRef.current = null;
      setBusyId(null);
      console.log("[TEMP-BARCODE-DIAG] saveBarcode finally");
    }
  }

  async function generatePdf() {
    if (!rental) return;
    setPdfBusy(true);
    try {
      const partner = rental.partners;
      const bytes = await generateRentalContractPdf({
        rentalId: id,
        contractNumber: rental.contract_number,
        rentalType: (rental.rental_type ?? "yearly") as RentalType,
        partner: {
          name: partner?.name ?? "—",
          company_name: partner?.company_name,
          address: partner?.address,
          phone: partner?.phone,
          email: partner?.email,
          tax_number: partner?.tax_number,
          contact_person: partner?.contact_person,
          birth_place: partner?.birth_place,
          birth_date: partner?.birth_date,
          mother_name: partner?.mother_name,
          id_number: partner?.id_number,
          address_card_number: partner?.address_card_number,
        },
        startDate: rental.start_date,
        monthlyFee: Number(rental.monthly_fee),
        deposit: Number(rental.deposit),
        depositType: rental.deposit_type,
        lines: buildContractLines(
          (cylLinks ?? []).map((c) => ({
            barcode: c.barcode,
            gas_type: c.gas_type,
            size: c.size,
            manufacturer: c.manufacturer,
            factory_serial: c.factory_serial,
            owner: c.owner,
            circulation: c.circulation,
            replacement_value: c.replacement_value,
            pressure_test_year: c.pressure_test_year,
            expiry_date: c.expiry_date,
            rental_end_date: c.rental_end_date,
          })),
          toContractStockItems(qtyItems ?? []),
        ),
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

  const partner = rental.partners;
  const rentalType = (rental.rental_type ?? "yearly") as RentalType;
  const displayStatus = rentalDisplayStatus(rental.status);
  const days = rentalType === "monthly" ? daysUntil(rental.next_invoice_date) : null;
  const urgency = invoiceUrgency(days);
  const hasActiveCylinders = (cylLinks ?? []).length > 0;
  const hasActiveQtyItems = (qtyItems ?? []).length > 0;
  const canExtend = rental.status !== "closed" && (hasActiveCylinders || hasActiveQtyItems);
  const canReturn = rental.status !== "closed" && (hasActiveCylinders || hasActiveQtyItems);

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

      <Card className="mb-4 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">{rentalNumber(rental.id)}</span>
          <Badge variant="default">
            {rentalStatusLabels[displayStatus] ?? displayStatus}
          </Badge>
          <Badge variant="outline">{rentalTypeLabels[rentalType]}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Info label="Státusz" value={rentalStatusLabels[displayStatus] ?? displayStatus} />
          <Info label="Partner" value={partner?.name ?? "—"} bold />
          {partner?.phone && (
            <div>
              <div className="text-xs text-muted-foreground">Telefon</div>
              <div className="mt-0.5">
                <PhoneLink phone={partner.phone} />
              </div>
            </div>
          )}
          <Info label="Bérlet típusa" value={rentalTypeLabels[rentalType]} />
          <Info label="Kezdő dátum" value={fmtDate(rental.start_date)} />
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
          <Button
            className="mt-4 w-full"
            variant="outline"
            size="sm"
            disabled={busyId === "invoice"}
            onClick={markInvoiced}
          >
            Számlázás rögzítve – következő hónap
          </Button>
        )}
        <Button
          className="mt-2 w-full"
          variant="outline"
          size="sm"
          disabled={pdfBusy}
          onClick={generatePdf}
        >
          <FileDown className="mr-2 h-4 w-4" /> PDF szerződés generálása
        </Button>
      </Card>

      <Card className="mb-4 overflow-hidden p-0">
        <h2 className="border-b px-4 py-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Darabszám alapú tételek ({(qtyItems ?? []).length})
        </h2>
        {qtyLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Betöltés…</div>
        ) : (qtyItems ?? []).length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Nincs darabszám alapú tétel</div>
        ) : (
          <div>
            {(qtyItems ?? []).map((item) => {
              const itemStart = quantityItemStartDate(item);
              const itemExpiry = quantityItemExpiryDate(item);
              const itemExpired = isRentalExpired(itemExpiry);
              const kind =
                RENTAL_QUANTITY_KIND_LABELS[item.stock_kind as keyof typeof RENTAL_QUANTITY_KIND_LABELS] ??
                item.stock_kind;

              return (
              <div
                key={item.id}
                className={`border-b border-border/40 p-4 last:border-b-0 ${itemExpired ? "border-l-4 border-l-destructive bg-destructive/5" : ""}`}
              >
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-4">
                  <div>
                    <div className="text-muted-foreground">Típus</div>
                    <div className="font-semibold">{kind}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Gáz</div>
                    <div>{item.gas_type}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Méret</div>
                    <div>{item.size}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Darabszám</div>
                    <div className="font-bold">{item.quantity} db</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Kezdet</div>
                    <div>{fmtDate(itemStart)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Lejárat</div>
                    {canExtend ? (
                      <div className="mt-1 flex gap-1">
                        <Input
                          type="date"
                          className="h-8 text-xs"
                          value={qtyExpiryEdits[item.id] ?? itemExpiry}
                          onChange={(e) =>
                            setQtyExpiryEdits((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                        />
                        <Button
                          size="sm"
                          className="h-8 shrink-0 px-2 text-xs"
                          disabled={busyId === `expiry-qty-${item.id}`}
                          onClick={() => saveQuantityItemExpiry(item.id)}
                        >
                          Mentés
                        </Button>
                      </div>
                    ) : (
                      <div className={itemExpired ? "font-medium text-destructive" : ""}>
                        {fmtDate(itemExpiry)}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-muted-foreground">Státusz</div>
                    <div className={itemExpired ? "font-medium text-destructive" : ""}>
                      {itemExpired ? "Lejárt" : "Aktív"}
                    </div>
                  </div>
                </div>
                {itemExpired && (
                  <Badge variant="destructive" className="mt-2">
                    LEJÁRT
                  </Badge>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {canExtend && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === `extend-qty-${item.id}`}
                      onClick={() => doExtendQuantityItem(item.id)}
                    >
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
              const cylStart = c.rental_start_date ?? c.added_at.slice(0, 10);
              const cylExpiry = cylinderExpiryDate(c);
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
                            autoComplete="off"
                            onChange={(e) =>
                              setBarcodeEdits((prev) => ({
                                ...prev,
                                [c.cylinder_id]: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              console.log("[TEMP-BARCODE-DIAG] Enter in barcode input", {
                                cylinderId: c.cylinder_id,
                              });
                              void saveBarcode(c.cylinder_id, barcodeEdits[c.cylinder_id] ?? editValue);
                            }}
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="h-8 shrink-0 px-2 text-xs"
                            aria-busy={busyId === `barcode-${c.cylinder_id}`}
                            onClick={() => {
                              console.log("[TEMP-BARCODE-DIAG] Mentés button click", {
                                cylinderId: c.cylinder_id,
                                busyId,
                                editValue,
                                barcodeEdit: barcodeEdits[c.cylinder_id],
                              });
                              void saveBarcode(
                                c.cylinder_id,
                                barcodeEdits[c.cylinder_id] ?? editValue,
                              );
                            }}
                          >
                            {busyId === `barcode-${c.cylinder_id}` ? "Mentés…" : "Mentés"}
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
                    <div>
                      <div className="text-muted-foreground">Nyomáspróba</div>
                      <div>{formatPressureTestYear(c.pressure_test_year)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Kezdet</div>
                      <div>{fmtDate(cylStart)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Lejárat</div>
                      {canExtend ? (
                        <div className="mt-1 flex gap-1">
                          <Input
                            type="date"
                            className="h-8 text-xs"
                            value={cylinderExpiryEdits[c.cylinder_id] ?? cylExpiry ?? ""}
                            onChange={(e) =>
                              setCylinderExpiryEdits((prev) => ({
                                ...prev,
                                [c.cylinder_id]: e.target.value,
                              }))
                            }
                          />
                          <Button
                            type="button"
                            size="sm"
                            className="h-8 shrink-0 px-2 text-xs"
                            disabled={busyId === `expiry-${c.cylinder_id}`}
                            onClick={() => saveCylinderExpiry(c.cylinder_id)}
                          >
                            Mentés
                          </Button>
                        </div>
                      ) : (
                        <div className={cylExpired ? "font-medium text-destructive" : ""}>
                          {fmtDate(cylExpiry)}
                        </div>
                      )}
                    </div>
                  </div>
                  {cylExpired && (
                    <Badge variant="destructive" className="mt-2">
                      LEJÁRT
                    </Badge>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
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
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === `extend-${c.cylinder_id}`}
                        onClick={() => doExtendCylinder(c.cylinder_id)}
                      >
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
                    {isTempRentalCylinder(c) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setConvertTarget({ cylinder_id: c.cylinder_id, barcode: c.barcode });
                          setConvertGas(c.gas_type !== "ISMERETLEN" ? c.gas_type : "Stargon");
                          setConvertSize(c.size !== "—" ? c.size : "20 L");
                          setConvertQty("1");
                        }}
                      >
                        <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> Átalakítás kínai palackká
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Dialog open={!!convertTarget} onOpenChange={(open) => !open && setConvertTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Átalakítás kínai palackká</DialogTitle>
          </DialogHeader>
          {convertTarget && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                TEMP palack: <span className="font-mono">{convertTarget.barcode}</span>
              </p>
              <div>
                <Label>Gáz</Label>
                <Select
                  value={convertGas}
                  onValueChange={(v) => {
                    setConvertGas(v);
                    setConvertSize(getAvailableSizes(v)[0] ?? "20 L");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GAS_TYPES.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Méret</Label>
                <Select value={convertSize} onValueChange={setConvertSize}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {convertSizes.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Darabszám</Label>
                <Input
                  type="number"
                  min={1}
                  value={convertQty}
                  onChange={(e) => setConvertQty(e.target.value)}
                />
              </div>
              <Button
                type="button"
                className="w-full"
                disabled={busyId === `convert-${convertTarget.cylinder_id}`}
                onClick={saveTempToChinese}
              >
                Mentés
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
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
