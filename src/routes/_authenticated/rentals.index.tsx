import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, ChevronRight, FileDown } from "lucide-react";
import { toast } from "sonner";
import {
  cylinderExpiryDate,
  fmtDate,
  isRentalExpired,
  rentalDisplayStatus,
  rentalStatusLabels,
  rentalTypeLabels,
  summarizeRentalCylinders,
  RENTAL_STATUS_OPTIONS,
  RENTAL_TYPE_OPTIONS,
  type RentalStatus,
  type RentalType,
} from "@/lib/labels";
import { parseBulkBarcodes } from "@/lib/inventory";
import { addYears, todayLocal } from "@/lib/date-utils";
import {
  createRentalWithCylinders,
  defaultExpiryDate,
  fetchRentalCylinderDetails,
  fetchRentalWithPartner,
  parseRentalCylinderSpecs,
  rentalNumber,
} from "@/lib/rental-ops";
import { daysUntil, invoiceUrgency } from "@/lib/rental-billing";
import { logSupabaseError } from "@/lib/supabase-error";
import {
  buildContractLines,
  downloadPdf,
  generateRentalContractPdf,
} from "@/lib/rental-contract-pdf";
import {
  fetchRentalQuantityItems,
  summarizeRentalQuantityItems,
  toContractStockItems,
  type RentalQuantityItem,
} from "@/lib/rental-quantity-stock";
import {
  RentalQuantityItemsEditor,
  rentalQuantityRowsToInputs,
  type RentalQuantityRowDraft,
} from "@/components/RentalQuantityItemsEditor";

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "expired") return "destructive";
  if (status === "cancelled") return "outline";
  return "secondary";
}

const RENTAL_LIST_STATUS_FILTERS = ["all", "active", "expired", "cancelled", "closed"] as const;
type RentalListStatusFilter = (typeof RENTAL_LIST_STATUS_FILTERS)[number];

function parseRentalListStatusFilter(value: unknown): RentalListStatusFilter | undefined {
  if (typeof value !== "string") return undefined;
  return (RENTAL_LIST_STATUS_FILTERS as readonly string[]).includes(value)
    ? (value as RentalListStatusFilter)
    : undefined;
}

export const Route = createFileRoute("/_authenticated/rentals/")({
  validateSearch: (search: Record<string, unknown>) => ({
    status: parseRentalListStatusFilter(search.status),
  }),
  head: () => ({ meta: [{ title: "Bérletek – Gáz Veled" }] }),
  component: RentalsList,
});

type RentalRow = {
  id: string;
  partner_id: string;
  start_date: string;
  end_date: string | null;
  expiry_date: string | null;
  rental_type: RentalType | null;
  monthly_fee: number;
  deposit: number;
  status: string;
  next_invoice_date: string | null;
  partners: { name: string; company_name: string | null } | null;
};

function makeEmptyForm() {
  const start = todayLocal();
  return {
    partner_id: "",
    rental_type: "yearly" as RentalType,
    start_date: start,
    expiry_date: defaultExpiryDate(start),
    first_invoice_date: start,
    next_invoice_date: start,
    monthly_fee: "",
    deposit: "",
    status: "active" as RentalStatus,
    cylinder_barcodes: "",
    cylinder_specs: "",
    quantity_rows: [] as RentalQuantityRowDraft[],
    note: "",
  };
}

function RentalsList() {
  const { status: searchStatus } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>(searchStatus ?? "all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(makeEmptyForm);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    setStatusFilter(searchStatus ?? "all");
  }, [searchStatus]);

  const {
    data: rentals,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["rentals", statusFilter],
    queryFn: async () => {
      let qb = supabase
        .from("rentals")
        .select(
          "id, partner_id, start_date, end_date, expiry_date, rental_type, monthly_fee, deposit, status, next_invoice_date, partners(name, company_name)",
        )
        .order("start_date", { ascending: false });
      if (statusFilter === "all") {
        qb = qb.neq("status", "closed");
      } else if (statusFilter === "expired") {
        qb = qb.neq("status", "closed");
      } else {
        qb = qb.eq("status", statusFilter);
      }
      const { data, error } = await qb;
      if (error) {
        logSupabaseError("rentals lista → rentals SELECT", error);
        throw new Error(error.message);
      }
      return (data ?? []) as RentalRow[];
    },
  });

  const rentalIds = useMemo(() => (rentals ?? []).map((r) => r.id), [rentals]);

  const { data: rentalCylSummaries } = useQuery({
    queryKey: ["rental-cyl-summaries", rentalIds],
    enabled: rentalIds.length > 0,
    queryFn: async () => {
      const { data: links, error: linkErr } = await supabase
        .from("rental_cylinders")
        .select("rental_id, cylinder_id, expiry_date, rental_end_date")
        .in("rental_id", rentalIds)
        .is("removed_at", null);
      if (linkErr) throw linkErr;
      if (!links?.length) {
        return {
          summaries: {} as Record<string, string[]>,
          rawByRental: {} as Record<string, { gas_type: string; size: string }[]>,
          expired: new Set<string>(),
        };
      }

      const cylIds = [...new Set(links.map((l) => l.cylinder_id))];
      const { data: cyls, error: cylErr } = await supabase
        .from("cylinders")
        .select("id, gas_type, size")
        .in("id", cylIds);
      if (cylErr) throw cylErr;

      const cylMap = new Map((cyls ?? []).map((c) => [c.id, c]));
      const byRental = new Map<string, { gas_type: string; size: string }[]>();
      const expiredRentals = new Set<string>();
      for (const link of links) {
        const cyl = cylMap.get(link.cylinder_id);
        if (!cyl) continue;
        const list = byRental.get(link.rental_id) ?? [];
        list.push({ gas_type: cyl.gas_type, size: cyl.size });
        byRental.set(link.rental_id, list);
        if (isRentalExpired(cylinderExpiryDate(link))) {
          expiredRentals.add(link.rental_id);
        }
      }
      const summaries: Record<string, string[]> = {};
      const rawByRental: Record<string, { gas_type: string; size: string }[]> = {};
      for (const [rid, list] of byRental) {
        summaries[rid] = summarizeRentalCylinders(list);
        rawByRental[rid] = list;
      }
      return { summaries, rawByRental, expired: expiredRentals };
    },
  });

  const rentalCylExpired = rentalCylSummaries?.expired ?? new Set<string>();

  const { data: rentalQtyByRental } = useQuery({
    queryKey: ["rental-qty-summaries", rentalIds],
    enabled: rentalIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_quantity_items")
        .select("rental_id, stock_kind, gas_type, size, quantity")
        .in("rental_id", rentalIds)
        .is("removed_at", null);
      if (error) {
        if (error.code === "42P01" || error.message?.includes("does not exist")) {
          return {} as Record<string, RentalQuantityItem[]>;
        }
        throw error;
      }
      const byRental: Record<string, RentalQuantityItem[]> = {};
      for (const row of data ?? []) {
        const list = byRental[row.rental_id] ?? [];
        list.push(row as RentalQuantityItem);
        byRental[row.rental_id] = list;
      }
      return byRental;
    },
  });

  const { data: partners } = useQuery({
    queryKey: ["partners-min"],
    queryFn: async () =>
      (
        await supabase
          .from("partners")
          .select("id, name, company_name, address, phone, email, tax_number")
          .order("name")
      ).data ?? [],
  });

  const statusFiltered = useMemo(() => {
    const list = rentals ?? [];
    if (statusFilter !== "expired") return list;
    return list.filter((r) => {
      if (r.status === "closed" || r.status === "cancelled") return false;
      return rentalCylExpired.has(r.id) || r.status === "expired";
    });
  }, [rentals, statusFilter, rentalCylExpired]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return statusFiltered;
    return statusFiltered.filter((r) => {
      const p = r.partners;
      const hay = [p?.name, p?.company_name, rentalNumber(r.id)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [statusFiltered, q]);

  const partnerGroups = useMemo(() => {
    const map = new Map<string, RentalRow[]>();
    for (const r of filtered) {
      const list = map.get(r.partner_id) ?? [];
      list.push(r);
      map.set(r.partner_id, list);
    }
    return [...map.entries()]
      .map(([partner_id, rentals]) => {
        const sorted = [...rentals].sort((a, b) => b.start_date.localeCompare(a.start_date));
        const p = sorted[0].partners;
        const allCyls: { gas_type: string; size: string }[] = [];
        const allQty: RentalQuantityItem[] = [];
        for (const r of sorted) {
          allCyls.push(...(rentalCylSummaries?.rawByRental?.[r.id] ?? []));
          allQty.push(...(rentalQtyByRental?.[r.id] ?? []));
        }
        const hasExpiredCylinder = sorted.some((r) => rentalCylExpired.has(r.id));
        const openRentals = sorted.filter((r) => r.status !== "closed" && r.status !== "cancelled");
        const primary = openRentals[0] ?? sorted[0];
        const displayStatus = rentalDisplayStatus(primary.status);
        const earliestStart = sorted.reduce(
          (min, r) => (r.start_date < min ? r.start_date : min),
          sorted[0].start_date,
        );
        const monthlyRental = sorted.find((r) => r.rental_type === "monthly" && r.status === "active");
        const days = monthlyRental ? daysUntil(monthlyRental.next_invoice_date) : null;
        const urgency = invoiceUrgency(days);
        return {
          partner_id,
          partner: p,
          rentals: sorted,
          serialLines: summarizeRentalCylinders(allCyls),
          quantityLines: summarizeRentalQuantityItems(allQty),
          hasExpiredCylinder,
          displayStatus,
          earliestStart,
          monthlyRental,
          days,
          urgency,
        };
      })
      .sort((a, b) => b.rentals[0].start_date.localeCompare(a.rentals[0].start_date));
  }, [filtered, rentalCylSummaries, rentalQtyByRental, rentalCylExpired]);

  function onStartChange(start: string) {
    setForm((f) => ({
      ...f,
      start_date: start,
      first_invoice_date: f.rental_type === "monthly" ? start : f.first_invoice_date,
      next_invoice_date: f.rental_type === "monthly" ? start : f.next_invoice_date,
      expiry_date: addYears(start, 1),
    }));
  }

  function onTypeChange(type: RentalType) {
    const start = form.start_date;
    setForm((f) => ({
      ...f,
      rental_type: type,
      first_invoice_date: type === "monthly" ? start : f.first_invoice_date,
      next_invoice_date: type === "monthly" ? start : f.next_invoice_date,
      expiry_date: addYears(start, 1),
    }));
  }

  async function save() {
    setSaveError(null);
    setLastCreatedId(null);

    if (!form.partner_id) {
      toast.error("Válassz partnert");
      return;
    }
    if (!form.start_date || !form.expiry_date) {
      toast.error("Add meg a dátumokat");
      return;
    }
    if (form.rental_type === "monthly") {
      if (!form.first_invoice_date || !form.next_invoice_date) {
        toast.error("Add meg a számlázási dátumokat");
        return;
      }
      if (!form.monthly_fee || Number(form.monthly_fee) <= 0) {
        toast.error("Havi bérletnél a havi díj kötelező");
        return;
      }
    }

    const barcodes = parseBulkBarcodes(form.cylinder_barcodes);
    const specs = parseRentalCylinderSpecs(form.cylinder_specs);
    const quantityItems = rentalQuantityRowsToInputs(form.quantity_rows);

    for (const row of form.quantity_rows) {
      if (row.quantity <= 0) {
        toast.error("A darabszámnak legalább 1-nek kell lennie");
        return;
      }
    }

    setBusy(true);
    try {
      const id = await createRentalWithCylinders({
        partner_id: form.partner_id,
        start_date: form.start_date,
        expiry_date: form.expiry_date,
        rental_type: form.rental_type,
        first_invoice_date: form.rental_type === "monthly" ? form.first_invoice_date : null,
        next_invoice_date: form.rental_type === "monthly" ? form.next_invoice_date : null,
        monthly_fee: Number(form.monthly_fee) || 0,
        deposit: Number(form.deposit) || 0,
        status: form.status,
        note: form.note.trim() || null,
        cylinder_barcodes: barcodes,
        cylinder_specs: specs,
        quantity_items: quantityItems,
      });

      toast.success("Bérlet létrehozva");
      setLastCreatedId(id);
      setForm(makeEmptyForm());
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["rentals"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      qc.invalidateQueries({ queryKey: ["cylinders"] });
      qc.invalidateQueries({ queryKey: ["partner-rental-summaries"] });
      qc.invalidateQueries({ queryKey: ["flaga-pb-stock"] });
      qc.invalidateQueries({ queryKey: ["prima-pb-stock"] });
      qc.invalidateQueries({ queryKey: ["chinese-stock"] });
      navigate({ to: "/rentals/$id", params: { id } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg);
      toast.error(msg, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  async function generatePdfForRental(rentalId: string) {
    setPdfBusy(true);
    try {
      const rental = await fetchRentalWithPartner(rentalId);
      if (!rental) throw new Error("Bérlet nem található");

      const cyls = await fetchRentalCylinderDetails(rentalId);
      const qtyItems = await fetchRentalQuantityItems(rentalId);
      const partner = rental.partners;

      const bytes = await generateRentalContractPdf({
        rentalId,
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
          cyls.map((c) => ({
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
          toContractStockItems(qtyItems),
        ),
      });

      downloadPdf(bytes, `berlet-${rentalNumber(rentalId)}.pdf`);
      toast.success("PDF letöltve");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPdfBusy(false);
    }
  }

  const activeCount = (rentals ?? []).filter((r) => r.status === "active").length;

  return (
    <AppShell title="Bérletek">
      <div className="mb-3 flex gap-2">
        <Input
          placeholder="Partner, bérlet szám…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Összes</SelectItem>
            <SelectItem value="active">Aktív</SelectItem>
            <SelectItem value="expired">Lejárt</SelectItem>
            <SelectItem value="cancelled">Felmondott</SelectItem>
            <SelectItem value="closed">Lezárt</SelectItem>
          </SelectContent>
        </Select>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) {
              setSaveError(null);
              setLastCreatedId(null);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button size="icon">
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Új bérlet</DialogTitle>
              <DialogDescription>
                Partner bérletének létrehozása és palackok kiadása.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Partner *</Label>
                <Select
                  value={form.partner_id}
                  onValueChange={(v) => setForm({ ...form, partner_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Válassz…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(partners ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.company_name ? ` · ${p.company_name}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Bérlet típusa *</Label>
                <Select
                  value={form.rental_type}
                  onValueChange={(v) => onTypeChange(v as RentalType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RENTAL_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Bérlet kezdete *</Label>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => onStartChange(e.target.value)}
                />
              </div>
              <div>
                <Label>Lejárat dátuma *</Label>
                <Input
                  type="date"
                  value={form.expiry_date}
                  onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                />
              </div>
              {form.rental_type === "monthly" && (
                <>
                  <div>
                    <Label>Első számlázási dátum *</Label>
                    <Input
                      type="date"
                      value={form.first_invoice_date}
                      onChange={(e) => setForm({ ...form, first_invoice_date: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Következő számlázás *</Label>
                    <Input
                      type="date"
                      value={form.next_invoice_date}
                      onChange={(e) => setForm({ ...form, next_invoice_date: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Havi díj (Ft) *</Label>
                    <Input
                      type="number"
                      value={form.monthly_fee}
                      onChange={(e) => setForm({ ...form, monthly_fee: e.target.value })}
                    />
                  </div>
                </>
              )}
              {form.rental_type === "yearly" && (
                <div>
                  <Label>Éves díj / havi díj (Ft)</Label>
                  <Input
                    type="number"
                    value={form.monthly_fee}
                    onChange={(e) => setForm({ ...form, monthly_fee: e.target.value })}
                  />
                </div>
              )}
              <div>
                <Label>Kaució (Ft)</Label>
                <Input
                  type="number"
                  value={form.deposit}
                  onChange={(e) => setForm({ ...form, deposit: e.target.value })}
                />
              </div>
              <div>
                <Label>Státusz</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v as RentalStatus })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RENTAL_STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Palack vonalkódok (opcionális, telephelyi készlet)</Label>
                <Textarea
                  className="min-h-[80px] font-mono text-sm"
                  placeholder={"vonalkód1\nvonalkód2"}
                  value={form.cylinder_barcodes}
                  onChange={(e) => setForm({ ...form, cylinder_barcodes: e.target.value })}
                />
              </div>
              <div>
                <Label>Palackok vonalkód nélkül (gáz,méret soronként)</Label>
                <Textarea
                  className="min-h-[80px] font-mono text-sm"
                  placeholder={"Nitrogén,20 L\nArgon,20 L"}
                  value={form.cylinder_specs}
                  onChange={(e) => setForm({ ...form, cylinder_specs: e.target.value })}
                />
              </div>
              <RentalQuantityItemsEditor
                rows={form.quantity_rows}
                onChange={(quantity_rows) => setForm({ ...form, quantity_rows })}
              />
              <div>
                <Label>Megjegyzés</Label>
                <Input
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
              {saveError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                  <div className="font-semibold">Mentés hiba</div>
                  <div className="mt-1 break-words">{saveError}</div>
                </div>
              )}
              {lastCreatedId && (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={pdfBusy}
                  onClick={() => generatePdfForRental(lastCreatedId)}
                >
                  <FileDown className="mr-2 h-4 w-4" /> PDF szerződés generálása
                </Button>
              )}
              <Button onClick={save} className="w-full" disabled={busy}>
                {busy ? "Mentés…" : "Mentés"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {statusFilter === "all" && (
        <div className="mb-3 text-xs text-muted-foreground">{activeCount} aktív bérlet</div>
      )}

      {isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Betöltés…</div>}
      {isError && (
        <div className="py-8 text-center text-sm text-destructive">
          Bérletek betöltése sikertelen
        </div>
      )}

      <div className="space-y-2">
        {partnerGroups.map((g) => {
          const p = g.partner;
          const singleRental = g.rentals.length === 1;
          const cardTo = singleRental
            ? { to: "/rentals/$id" as const, params: { id: g.rentals[0].id } }
            : { to: "/partners/$id/rentals" as const, params: { id: g.partner_id } };
          const urgencyCls =
            g.urgency === "red"
              ? "bg-destructive/15 text-destructive"
              : g.urgency === "yellow"
                ? "bg-warning/15 text-warning"
                : "bg-green-600/10 text-green-700";

          return (
            <Link key={g.partner_id} {...cardTo}>
              <Card
                className={`p-3 transition-colors hover:bg-accent/50 ${g.hasExpiredCylinder && g.displayStatus !== "closed" ? "border-destructive/30" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{p?.name ?? "—"}</span>
                      <Badge variant={statusVariant(g.displayStatus)}>
                        {rentalStatusLabels[g.displayStatus] ?? g.displayStatus}
                      </Badge>
                      {g.hasExpiredCylinder && g.displayStatus !== "closed" && (
                        <Badge variant="destructive">LEJÁRT PALACK</Badge>
                      )}
                      {g.rentals.some((r) => r.rental_type === "monthly") && (
                        <Badge variant="outline">{rentalTypeLabels.monthly}</Badge>
                      )}
                      {g.rentals.some((r) => r.rental_type === "yearly") && (
                        <Badge variant="outline">{rentalTypeLabels.yearly}</Badge>
                      )}
                    </div>
                    {p?.company_name && (
                      <div className="text-xs text-muted-foreground">{p.company_name}</div>
                    )}
                    {g.hasExpiredCylinder && g.displayStatus !== "closed" && (
                      <div className="mt-1 text-xs font-medium text-destructive">
                        Van lejárt palack
                      </div>
                    )}
                    {g.serialLines.length > 0 && (
                      <div className="mt-2">
                        <div className="text-xs font-medium text-muted-foreground">
                          Sorszámos palackok:
                        </div>
                        <div className="mt-0.5 space-y-0.5">
                          {g.serialLines.map((line) => (
                            <div key={line} className="text-xs text-primary">
                              {line}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {g.quantityLines.length > 0 && (
                      <div className="mt-2">
                        <div className="text-xs font-medium text-muted-foreground">
                          Darabszámos tételek:
                        </div>
                        <div className="mt-0.5 space-y-0.5">
                          {g.quantityLines.map((line) => (
                            <div key={line} className="text-xs text-primary">
                              {line}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Kezdés: {fmtDate(g.earliestStart)}</span>
                      {g.monthlyRental && (
                        <span>
                          {Number(g.monthlyRental.monthly_fee).toLocaleString("hu-HU")} Ft/hó
                        </span>
                      )}
                      {g.monthlyRental?.next_invoice_date && (
                        <span className={`rounded px-1.5 py-0.5 ${urgencyCls}`}>
                          Köv. számlázás: {fmtDate(g.monthlyRental.next_invoice_date)}
                          {g.days !== null &&
                            g.days <= 5 &&
                            ` (${g.days < 0 ? `${Math.abs(g.days)} napja lejárt` : `${g.days} nap`})`}
                        </span>
                      )}
                    </div>
                    {!singleRental && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {g.rentals.map((r) => (
                          <Link
                            key={r.id}
                            to="/rentals/$id"
                            params={{ id: r.id }}
                            className="font-mono text-[10px] text-muted-foreground hover:text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {rentalNumber(r.id)}
                          </Link>
                        ))}
                      </div>
                    )}
                    {singleRental && (
                      <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
                        {rentalNumber(g.rentals[0].id)}
                      </span>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              </Card>
            </Link>
          );
        })}
        {!isLoading && !isError && partnerGroups.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Nincs bérlet a szűrésnek megfelelően
          </div>
        )}
      </div>
    </AppShell>
  );
}
