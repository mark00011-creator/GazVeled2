import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { NewCylinderDialog } from "@/components/NewCylinderDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Camera,
  ArrowRight,
  AlertTriangle,
  Check,
  Sparkles,
  ShieldAlert,
  ShoppingCart,
  PackageMinus,
  RefreshCw,
  HandCoins,
} from "lucide-react";
import { toast } from "sonner";
import {
  circulationLabels,
  fmtDateTime,
  locationLabels,
  type Circulation,
} from "@/lib/labels";
import {
  findCylinderByBarcode,
  normalizeBarcode,
  recordExchange,
  recordSale,
  recordEmptyReturn,
  recordChineseSale,
  recordFlagaPbSale,
  recordPrimaPbSale,
  type CylinderRow,
  type PartnerOperationType,
} from "@/lib/cylinder-ops";
import { recordCylinderLoan } from "@/lib/loan-ops";
import { findActiveRentalIdForCylinder } from "@/lib/rental-ops";
import { PhoneLink } from "@/components/PhoneLink";
import { GAS_TYPES, getAvailableSizes } from "@/lib/gas-cylinder-form";
import {
  FLAGA_PB_CATALOG,
  flagaPbProductKey,
  flagaPbStockLabel,
} from "@/lib/flaga-pb-stock";
import { PRIMA_PB_CATALOG, primaPbProductKey } from "@/lib/prima-pb-stock";

export const Route = createFileRoute("/_authenticated/quick-exchange")({
  head: () => ({ meta: [{ title: "Gyors csere – Gáz Veled" }] }),
  component: QuickExchange,
});

type IncomingKind = "rental" | "own" | "new";
type SaleMode = "barcode" | "chinese" | "flaga_pb" | "prima_pb";

const OP_LABELS: Record<PartnerOperationType, string> = {
  exchange: "Csere",
  sale: "Eladás",
  empty_return: "Üres visszavétel",
  loan: "Kölcsön",
  chinese_sale: "Kínai eladás",
  flaga_sale: "FLAGA eladás",
  flaga_pb_sale: "FLAGA PB eladás",
  prima_pb_sale: "PRÍMA PB eladás",
};

function QuickExchange() {
  const qc = useQueryClient();
  const [operation, setOperation] = useState<PartnerOperationType>("exchange");
  const [saleMode, setSaleMode] = useState<SaleMode>("barcode");
  const [partnerId, setPartnerId] = useState<string>("");
  const [scanning, setScanning] = useState<"in" | "out" | null>(null);
  const [incomingBc, setIncomingBc] = useState("");
  const [outgoingBc, setOutgoingBc] = useState("");
  const [incoming, setIncoming] = useState<CylinderRow | null>(null);
  const [incomingCreated, setIncomingCreated] = useState(false);
  const [outgoing, setOutgoing] = useState<CylinderRow | null>(null);
  const [outgoingCreated, setOutgoingCreated] = useState(false);

  const [newCylDialog, setNewCylDialog] = useState(false);
  const [newCylPhase, setNewCylPhase] = useState<"incoming" | "outgoing">("incoming");
  const [newCylBarcode, setNewCylBarcode] = useState("");

  const [chineseGas, setChineseGas] = useState("Széndioxid");
  const [chineseSize, setChineseSize] = useState("10 kg");
  const [chineseQty, setChineseQty] = useState("1");

  const [flagaPbKey, setFlagaPbKey] = useState(
    flagaPbProductKey(FLAGA_PB_CATALOG[0].gas_type, FLAGA_PB_CATALOG[0].size),
  );
  const [flagaPbQty, setFlagaPbQty] = useState("1");

  const [primaPbKey, setPrimaPbKey] = useState(
    primaPbProductKey(PRIMA_PB_CATALOG[0].gas_type, PRIMA_PB_CATALOG[0].size),
  );
  const [primaPbQty, setPrimaPbQty] = useState("1");

  const selectedFlagaPb =
    FLAGA_PB_CATALOG.find((i) => flagaPbProductKey(i.gas_type, i.size) === flagaPbKey) ??
    FLAGA_PB_CATALOG[0];
  const selectedPrimaPb =
    PRIMA_PB_CATALOG.find((i) => primaPbProductKey(i.gas_type, i.size) === primaPbKey) ??
    PRIMA_PB_CATALOG[0];

  const [reassign, setReassign] = useState<"yes" | "no" | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");

  const { data: partners } = useQuery({
    queryKey: ["partners-min"],
    queryFn: async () =>
      (await supabase.from("partners").select("id,name,company_name,phone").order("name")).data ?? [],
  });

  const selectedPartner = useMemo(
    () => (partners ?? []).find((p) => p.id === partnerId),
    [partners, partnerId],
  );

  const { data: activeRentals } = useQuery({
    queryKey: ["active-rentals", partnerId],
    enabled: !!partnerId,
    queryFn: async () => {
      const { data } = await supabase
        .from("rentals")
        .select(
          "id, monthly_fee, current_cylinder_id, original_cylinder_id, circulation, deposit, start_date",
        )
        .eq("partner_id", partnerId)
        .eq("status", "active");
      return data ?? [];
    },
  });

  const rentalIds = useMemo(() => (activeRentals ?? []).map((r) => r.id), [activeRentals]);

  const { data: rentedCyls } = useQuery({
    queryKey: ["rental-cyl-links", rentalIds],
    enabled: rentalIds.length > 0,
    queryFn: async () => {
      const { data: links, error: linkErr } = await supabase
        .from("rental_cylinders")
        .select("cylinder_id")
        .in("rental_id", rentalIds)
        .is("removed_at", null);
      if (linkErr) throw linkErr;
      const ids = (links ?? []).map((l) => l.cylinder_id);
      if (ids.length === 0) return [];
      const { data: cyls, error: cylErr } = await supabase
        .from("cylinders")
        .select("id, barcode")
        .in("id", ids);
      if (cylErr) throw cylErr;
      return cyls ?? [];
    },
  });

  const rentedCylIds = useMemo(() => (rentedCyls ?? []).map((c) => c.id), [rentedCyls]);

  const { data: incomingRentalId } = useQuery({
    queryKey: ["incoming-rental", incoming?.id],
    enabled: !!incoming?.id && !incomingCreated && operation !== "sale",
    queryFn: () => findActiveRentalIdForCylinder(incoming!.id),
  });

  const incomingKind: IncomingKind | null = useMemo(() => {
    if (!incoming) return null;
    if (incomingCreated) return "new";
    if (incomingRentalId || rentedCylIds.includes(incoming.id)) return "rental";
    return "own";
  }, [incoming, incomingCreated, rentedCylIds, incomingRentalId]);

  const { data: history } = useQuery({
    queryKey: ["history", incoming?.id],
    enabled: !!incoming?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("movements")
        .select("*")
        .eq("cylinder_id", incoming!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  function resetCylinders() {
    setIncomingBc("");
    setOutgoingBc("");
    setIncoming(null);
    setOutgoing(null);
    setIncomingCreated(false);
    setOutgoingCreated(false);
    setReassign(null);
    setReason("");
  }

  function switchOperation(op: PartnerOperationType) {
    setOperation(op);
    resetCylinders();
    if (op === "sale") setSaleMode("barcode");
  }

  async function lookupIncoming() {
    if (!incomingBc.trim()) return;
    try {
      const cyl = await findCylinderByBarcode(incomingBc);
      setIncoming(cyl);
      setIncomingCreated(false);
    } catch {
      setNewCylBarcode(incomingBc);
      setNewCylPhase("incoming");
      setNewCylDialog(true);
    }
  }

  async function lookupOutgoing() {
    if (!outgoingBc.trim()) return;
    try {
      const cyl = await findCylinderByBarcode(outgoingBc);
      setOutgoing(cyl);
      setOutgoingCreated(false);
    } catch {
      setNewCylBarcode(outgoingBc);
      setNewCylPhase("outgoing");
      setNewCylDialog(true);
    }
  }

  const isForced =
    operation === "exchange" &&
    incoming &&
    outgoing &&
    incoming.circulation !== outgoing.circulation;
  const needsRentalQuestion =
    operation === "exchange" &&
    incomingKind === "rental" &&
    incoming &&
    outgoing &&
    reassign === null;

  const showIncoming = operation === "exchange" || operation === "empty_return";
  const showOutgoing =
    operation === "exchange" ||
    operation === "loan" ||
    (operation === "sale" && saleMode === "barcode");

  const canComplete =
    partnerId &&
    ((operation === "exchange" && incoming && outgoing) ||
      (operation === "loan" && outgoing) ||
      (operation === "sale" && saleMode === "barcode" && outgoing) ||
      (operation === "sale" && saleMode === "chinese" && Number(chineseQty) > 0) ||
      (operation === "sale" && saleMode === "flaga_pb" && Number(flagaPbQty) > 0) ||
      (operation === "sale" && saleMode === "prima_pb" && Number(primaPbQty) > 0) ||
      (operation === "empty_return" && incoming));

  async function complete() {
    if (!partnerId) {
      toast.error("Válassz partnert");
      return;
    }

    setBusy(true);
    try {
      if (operation === "exchange") {
        if (!incoming || !outgoing) {
          toast.error("Cserehez bejövő és kimenő palack is kell");
          return;
        }
        if (incoming.id === outgoing.id) {
          toast.error("A beérkező és kiadott palack nem lehet ugyanaz");
          return;
        }
        if (isForced && !reason.trim()) {
          toast.error("Add meg a kényszerhelyettesítés okát");
          return;
        }
        if (needsRentalQuestion) {
          toast.error("Döntsd el az újrarendelés kérdést");
          return;
        }
        const rentalId = incomingRentalId ?? (activeRentals ?? [])[0]?.id ?? null;
        const reassignYes = !!(rentalId && reassign === "yes");
        await recordExchange({
          partner_id: partnerId,
          incoming_id: incoming.id,
          outgoing_id: outgoing.id,
          reason: isForced ? reason : null,
          note: note || null,
          rental_id: rentalId,
          reassign_rental: reassignYes,
        });
        toast.success("Csere rögzítve");
      } else if (operation === "sale") {
        if (saleMode === "chinese") {
          const qty = Number(chineseQty);
          if (!Number.isFinite(qty) || qty <= 0) {
            toast.error("Érvényes darabszámot adj meg");
            return;
          }
          await recordChineseSale({
            partner_id: partnerId,
            gas_type: chineseGas,
            size: chineseSize,
            quantity: qty,
            note: note || null,
          });
          toast.success("Kínai eladás rögzítve");
        } else if (saleMode === "flaga_pb") {
          const qty = Number(flagaPbQty);
          if (!Number.isFinite(qty) || qty <= 0) {
            toast.error("Érvényes darabszámot adj meg");
            return;
          }
          await recordFlagaPbSale({
            partner_id: partnerId,
            gas_type: selectedFlagaPb.gas_type,
            size: selectedFlagaPb.size,
            quantity: qty,
            note: note || null,
          });
          toast.success("FLAGA PB eladás rögzítve");
        } else if (saleMode === "prima_pb") {
          const qty = Number(primaPbQty);
          if (!Number.isFinite(qty) || qty <= 0) {
            toast.error("Érvényes darabszámot adj meg");
            return;
          }
          await recordPrimaPbSale({
            partner_id: partnerId,
            gas_type: selectedPrimaPb.gas_type,
            size: selectedPrimaPb.size,
            quantity: qty,
            note: note || null,
          });
          toast.success("PRÍMA PB eladás rögzítve");
        } else {
          if (!outgoing) {
            toast.error("Válassz kiadandó palackot");
            return;
          }
          await recordSale({
            partner_id: partnerId,
            outgoing_id: outgoing.id,
            note: note || null,
          });
          toast.success("Eladás rögzítve");
        }
      } else if (operation === "empty_return") {
        if (!incoming) {
          toast.error("Válassz visszavett üres palackot");
          return;
        }
        await recordEmptyReturn({
          partner_id: partnerId,
          incoming_id: incoming.id,
          note: note || null,
        });
        toast.success("Üres visszavétel rögzítve");
      } else if (operation === "loan") {
        if (!outgoing) {
          toast.error("Válassz kiadandó palackot");
          return;
        }
        await recordCylinderLoan({
          partner_id: partnerId,
          outgoing_id: outgoing.id,
          note: note || null,
        });
        toast.success("Kölcsön rögzítve");
      }

      resetCylinders();
      setNote("");
      invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function invalidateQueries() {
    qc.invalidateQueries({ queryKey: ["cylinders"] });
    qc.invalidateQueries({ queryKey: ["active-rentals"] });
    qc.invalidateQueries({ queryKey: ["rental-cyl-links"] });
    qc.invalidateQueries({ queryKey: ["incoming-rental"] });
    qc.invalidateQueries({ queryKey: ["partner-rented-cyl-ids"] });
    qc.invalidateQueries({ queryKey: ["partner-cylinders"] });
    qc.invalidateQueries({ queryKey: ["rental-cyls"] });
    qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    qc.invalidateQueries({ queryKey: ["uninvoiced-exchanges"] });
    qc.invalidateQueries({ queryKey: ["history"] });
    qc.invalidateQueries({ queryKey: ["chinese-stock"] });
    qc.invalidateQueries({ queryKey: ["chinese-empty-summary"] });
    qc.invalidateQueries({ queryKey: ["flaga-pb-stock"] });
    qc.invalidateQueries({ queryKey: ["prima-pb-stock"] });
    qc.invalidateQueries({ queryKey: ["loaned-cylinders"] });
  }

  const chineseSizes = getAvailableSizes(chineseGas);

  return (
    <AppShell title="Gyors csere">
      {scanning && (
        <BarcodeScanner
          onResult={async (t) => {
            const bc = normalizeBarcode(t);
            const phase = scanning;
            setScanning(null);
            if (phase === "in") {
              setIncomingBc(bc);
              try {
                setIncoming(await findCylinderByBarcode(bc));
                setIncomingCreated(false);
              } catch {
                setNewCylBarcode(bc);
                setNewCylPhase("incoming");
                setNewCylDialog(true);
              }
            } else {
              setOutgoingBc(bc);
              try {
                setOutgoing(await findCylinderByBarcode(bc));
                setOutgoingCreated(false);
              } catch {
                setNewCylBarcode(bc);
                setNewCylPhase("outgoing");
                setNewCylDialog(true);
              }
            }
          }}
          onClose={() => setScanning(null)}
        />
      )}

      <NewCylinderDialog
        open={newCylDialog}
        onOpenChange={setNewCylDialog}
        barcode={newCylBarcode}
        status={newCylPhase === "outgoing" ? "full" : "empty"}
        locationType={newCylPhase === "outgoing" ? "warehouse_full" : "warehouse_empty"}
        onCreated={async (cyl) => {
          if (newCylPhase === "incoming") {
            setIncoming(cyl);
            setIncomingCreated(true);
          } else {
            setOutgoing(cyl);
            setOutgoingCreated(true);
          }
        }}
      />

      <Tabs
        value={operation}
        onValueChange={(v) => switchOperation(v as PartnerOperationType)}
        className="mb-4"
      >
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="exchange" className="gap-1 text-xs sm:text-sm">
            <RefreshCw className="h-3.5 w-3.5" />
            {OP_LABELS.exchange}
          </TabsTrigger>
          <TabsTrigger value="loan" className="gap-1 text-xs sm:text-sm">
            <HandCoins className="h-3.5 w-3.5" />
            {OP_LABELS.loan}
          </TabsTrigger>
          <TabsTrigger value="sale" className="gap-1 text-xs sm:text-sm">
            <ShoppingCart className="h-3.5 w-3.5" />
            {OP_LABELS.sale}
          </TabsTrigger>
          <TabsTrigger value="empty_return" className="gap-1 text-xs sm:text-sm">
            <PackageMinus className="h-3.5 w-3.5" />
            {OP_LABELS.empty_return}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <p className="mb-3 text-xs text-muted-foreground">
        {operation === "exchange" && "Üres be + teli ki. Mindkét palack kötelező."}
        {operation === "loan" &&
          "0 üres → 1 teli: partner kölcsön kap teli palackot üres visszahozatal nélkül. A bérleti készlet külön folyamat."}
        {operation === "sale" && "Teli palack kiadása bejövő nélkül. Kínai vagy FLAGA palack darabszámmal is."}
        {operation === "empty_return" && "Üres palack visszavétele a partnertől, kiadás nélkül."}
      </p>

      <Card className="mb-3 p-4">
        <Label className="mb-2 block">Partner</Label>
        <Select
          value={partnerId}
          onValueChange={(v) => {
            setPartnerId(v);
            setReassign(null);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Válassz partnert…" />
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
        {selectedPartner?.phone && (
          <div className="mt-2 text-sm text-muted-foreground">
            Telefon: <PhoneLink phone={selectedPartner.phone} />
          </div>
        )}
      </Card>

      {partnerId && operation === "exchange" && (activeRentals?.length ?? 0) > 0 && (
        <Card className="mb-3 border-destructive/50 bg-destructive/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            <div className="text-sm font-bold uppercase">Aktív bérelt palackok</div>
          </div>
          {(rentedCyls ?? []).map((c) => (
            <div key={c.id} className="font-mono text-sm text-destructive">
              {c.barcode}
            </div>
          ))}
        </Card>
      )}

      {partnerId && operation === "sale" && (
        <Card className="mb-3 p-4">
          <Label className="mb-2 block">Eladás típusa</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant={saleMode === "barcode" ? "default" : "outline"}
              className="flex-1"
              onClick={() => setSaleMode("barcode")}
            >
              Vonalkódos palack
            </Button>
            <Button
              type="button"
              variant={saleMode === "chinese" ? "default" : "outline"}
              className="flex-1"
              onClick={() => {
                setSaleMode("chinese");
                setOutgoing(null);
              }}
            >
              Kínai készlet
            </Button>
            <Button
              type="button"
              variant={saleMode === "flaga_pb" ? "default" : "outline"}
              className="flex-1"
              onClick={() => {
                setSaleMode("flaga_pb");
                setOutgoing(null);
              }}
            >
              FLAGA PB
            </Button>
            <Button
              type="button"
              variant={saleMode === "prima_pb" ? "default" : "outline"}
              className="flex-1"
              onClick={() => {
                setSaleMode("prima_pb");
                setOutgoing(null);
              }}
            >
              PRÍMA PB
            </Button>
          </div>
        </Card>
      )}

      {partnerId && showIncoming && (
        <Card className="mb-3 p-4">
          <div className="mb-2 flex items-center justify-between">
            <Label>Beérkező ÜRES palack</Label>
            <Button size="sm" variant="secondary" onClick={() => setScanning("in")}>
              <Camera className="mr-1 h-4 w-4" /> Scan
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Vonalkód"
              value={incomingBc}
              onChange={(e) => {
                setIncomingBc(e.target.value);
                setIncoming(null);
              }}
              onBlur={lookupIncoming}
              className="font-mono"
            />
            <Button variant="outline" onClick={lookupIncoming}>
              OK
            </Button>
          </div>
          {incoming && (
            <div className="mt-3 space-y-2">
              {operation === "exchange" && incomingKind && <KindBadge kind={incomingKind} />}
              <div className="flex flex-wrap gap-2">
                <Badge
                  style={{
                    backgroundColor: incoming.circulation === "siad" ? "var(--siad)" : "var(--own)",
                  }}
                  className="text-background"
                >
                  {circulationLabels[incoming.circulation]}
                </Badge>
                <Badge variant="outline">
                  {incoming.gas_type} · {incoming.size}
                </Badge>
                <Badge variant="secondary">{locationLabels[incoming.location_type]}</Badge>
              </div>
              {history && history.length > 0 && (
                <div className="rounded-md bg-muted/40 p-2 text-xs">
                  <div className="mb-1 font-medium text-muted-foreground">Előélet</div>
                  {history.map((h) => (
                    <div key={h.id} className="flex justify-between border-t border-border/50 py-1">
                      <span>
                        {locationLabels[h.from_location ?? ""] ?? "—"} →{" "}
                        {locationLabels[h.to_location]}
                      </span>
                      <span className="text-muted-foreground">{fmtDateTime(h.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {partnerId && showOutgoing && (
        <Card className="mb-3 p-4">
          <div className="mb-2 flex items-center justify-between">
            <Label>
              {operation === "loan" ? "Kölcsönbe adott TELI palack" : "Kiadandó TELI palack"}
            </Label>
            <Button size="sm" variant="secondary" onClick={() => setScanning("out")}>
              <Camera className="mr-1 h-4 w-4" /> Scan
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Vonalkód"
              value={outgoingBc}
              onChange={(e) => {
                setOutgoingBc(e.target.value);
                setOutgoing(null);
              }}
              onBlur={lookupOutgoing}
              className="font-mono"
            />
            <Button variant="outline" onClick={lookupOutgoing}>
              OK
            </Button>
          </div>
          {outgoing && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge
                style={{
                  backgroundColor: outgoing.circulation === "siad" ? "var(--siad)" : "var(--own)",
                }}
                className="text-background"
              >
                {circulationLabels[outgoing.circulation]}
              </Badge>
              <Badge variant="outline">
                {outgoing.gas_type} · {outgoing.size}
              </Badge>
              {outgoingCreated && <Badge className="bg-orange-500 text-white">Új palack</Badge>}
            </div>
          )}
          {isForced && (
            <div className="mt-3 space-y-2 rounded-md bg-warning/15 p-2 text-xs text-warning">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <div>
                  Kényszerhelyettesítés: {circulationLabels[incoming!.circulation]} →{" "}
                  {circulationLabels[outgoing!.circulation]}
                </div>
              </div>
              <Input
                placeholder="Indoklás (kötelező)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}
        </Card>
      )}

      {partnerId && operation === "sale" && saleMode === "chinese" && (
        <Card className="mb-3 p-4">
          <Label className="mb-2 block">Kínai palack eladás</Label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Gáz</Label>
              <Select value={chineseGas} onValueChange={(v) => setChineseGas(v)}>
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
              <Label className="text-xs">Méret</Label>
              <Select value={chineseSize} onValueChange={setChineseSize}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {chineseSizes.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Darabszám</Label>
              <Input
                type="number"
                min={1}
                value={chineseQty}
                onChange={(e) => setChineseQty(e.target.value)}
              />
            </div>
          </div>
        </Card>
      )}

      {partnerId && operation === "sale" && saleMode === "flaga_pb" && (
        <Card className="mb-3 p-4">
          <Label className="mb-2 block">FLAGA PB palack eladás</Label>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Tétel</Label>
              <Select value={flagaPbKey} onValueChange={setFlagaPbKey}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FLAGA_PB_CATALOG.map((item) => {
                    const key = flagaPbProductKey(item.gas_type, item.size);
                    return (
                      <SelectItem key={key} value={key}>
                        {flagaPbStockLabel(item.gas_type, item.size)}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Darabszám</Label>
              <Input
                type="number"
                min={1}
                value={flagaPbQty}
                onChange={(e) => setFlagaPbQty(e.target.value)}
              />
            </div>
          </div>
        </Card>
      )}

      {partnerId && operation === "sale" && saleMode === "prima_pb" && (
        <Card className="mb-3 p-4">
          <Label className="mb-2 block">PRÍMA PB palack eladás</Label>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Tétel</Label>
              <Select value={primaPbKey} onValueChange={setPrimaPbKey}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIMA_PB_CATALOG.map((item) => {
                    const key = primaPbProductKey(item.gas_type, item.size);
                    return (
                      <SelectItem key={key} value={key}>
                        {item.size} {item.gas_type}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label className="text-xs">Darabszám</Label>
              <Input
                type="number"
                min={1}
                value={primaPbQty}
                onChange={(e) => setPrimaPbQty(e.target.value)}
              />
            </div>
          </div>
        </Card>
      )}

      {needsRentalQuestion && (
        <Card className="mb-3 border-primary/50 bg-primary/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-primary">
            <Sparkles className="h-4 w-4" />
            <div className="text-sm font-semibold">
              Az új palack legyen a bérlet aktív palackja?
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => setReassign("yes")}
              variant={reassign === "yes" ? "default" : "outline"}
            >
              IGEN
            </Button>
            <Button
              className="flex-1"
              onClick={() => setReassign("no")}
              variant={reassign === "no" ? "default" : "outline"}
            >
              NEM
            </Button>
          </div>
        </Card>
      )}

      {partnerId && canComplete && (
        <>
          <Input
            className="mb-3"
            placeholder="Megjegyzés (opcionális)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button size="lg" className="w-full" disabled={busy} onClick={complete}>
            <Check className="mr-2 h-5 w-5" />
            {OP_LABELS[operation]} rögzítése
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </>
      )}
    </AppShell>
  );
}

function KindBadge({ kind }: { kind: IncomingKind }) {
  const map = {
    rental: { label: "Bérelt palack", cls: "bg-red-500 text-white" },
    own: { label: "Saját palack", cls: "bg-green-600 text-white" },
    new: { label: "Új palack", cls: "bg-orange-500 text-white" },
  } as const;
  const { label, cls } = map[kind];
  return <Badge className={cls}>{label}</Badge>;
}
