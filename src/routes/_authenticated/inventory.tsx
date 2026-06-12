import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipboardList, Check } from "lucide-react";
import { toast } from "sonner";
import { CIRCULATION_OPTIONS, type Circulation } from "@/lib/labels";
import {
  GAS_TYPES,
  getAvailableSizes,
} from "@/lib/gas-cylinder-form";
import {
  INVENTORY_PLACE_OPTIONS,
  INVENTORY_STATUS_OPTIONS,
  parseBulkBarcodes,
  type InventoryEntry,
  type InventoryPlace,
} from "@/lib/inventory";
import { registerInventoryCylinders, type InventoryRegisterResult } from "@/lib/cylinder-ops";

export const Route = createFileRoute("/_authenticated/inventory")({
  head: () => ({ meta: [{ title: "Leltár – Gáz Veled" }] }),
  component: Inventory,
});

type SharedDefaults = {
  gasType: string;
  size: string;
  owner: Circulation;
  status: "full" | "empty";
  place: InventoryPlace;
  partnerId: string;
  supplierId: string;
};

const DEFAULTS: SharedDefaults = {
  gasType: "Argon",
  size: "20 L",
  owner: "own",
  status: "empty",
  place: "warehouse",
  partnerId: "",
  supplierId: "",
};

function Inventory() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("single");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InventoryRegisterResult | null>(null);

  const [singleBarcode, setSingleBarcode] = useState("");
  const [shared, setShared] = useState<SharedDefaults>(DEFAULTS);
  const [bulkText, setBulkText] = useState("");

  const { data: partners } = useQuery({
    queryKey: ["partners-min"],
    queryFn: async () =>
      (await supabase.from("partners").select("id,name,company_name").order("name")).data ?? [],
  });

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name,kind").order("name")).data ?? [],
  });

  const availableSizes = useMemo(() => getAvailableSizes(shared.gasType), [shared.gasType]);
  const bulkCount = useMemo(() => parseBulkBarcodes(bulkText).length, [bulkText]);

  function updateShared<K extends keyof SharedDefaults>(key: K, value: SharedDefaults[K]) {
    setShared((prev) => ({ ...prev, [key]: value }));
  }

  function entryFromShared(barcode: string): InventoryEntry {
    return {
      barcode,
      gas_type: shared.gasType,
      size: shared.size,
      owner: shared.owner,
      status: shared.status,
      place: shared.place,
      partner_id: shared.place === "partner" ? shared.partnerId || null : null,
      supplier_id: shared.place === "supplier" ? shared.supplierId || null : null,
    };
  }

  function validatePlace(): string | null {
    if (shared.place === "partner" && !shared.partnerId) return "Válassz partnert";
    if (shared.place === "supplier" && !shared.supplierId) return "Válassz beszállítót";
    return null;
  }

  async function submitSingle() {
    const placeErr = validatePlace();
    if (placeErr) {
      toast.error(placeErr);
      return;
    }
    if (!singleBarcode.trim()) {
      toast.error("Add meg a vonalkódot");
      return;
    }

    setBusy(true);
    setResult(null);
    try {
      const res = await registerInventoryCylinders([entryFromShared(singleBarcode)]);
      setResult(res);
      if (res.created.length > 0) {
        toast.success(`${res.created.length} palack felvéve`);
        setSingleBarcode("");
        qc.invalidateQueries({ queryKey: ["cylinders"] });
      }
      if (res.skipped.length > 0) {
        toast.warning(`Kihagyva: ${res.skipped[0].barcode} – ${res.skipped[0].reason}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitBulk() {
    const placeErr = validatePlace();
    if (placeErr) {
      toast.error(placeErr);
      return;
    }

    const barcodes = parseBulkBarcodes(bulkText);
    if (barcodes.length === 0) {
      toast.error("Adj meg legalább egy vonalkódot (soronként egy)");
      return;
    }

    setBusy(true);
    setResult(null);
    try {
      const entries = barcodes.map((bc) => entryFromShared(bc));
      const res = await registerInventoryCylinders(entries);
      setResult(res);
      if (res.created.length > 0) {
        toast.success(`${res.created.length} palack felvéve`);
        setBulkText("");
        qc.invalidateQueries({ queryKey: ["cylinders"] });
      }
      if (res.skipped.length > 0 && res.created.length === 0) {
        toast.warning(`Mind kihagyva (${res.skipped.length}) – már létező vagy duplikált vonalkódok`);
      } else if (res.skipped.length > 0) {
        toast.info(`${res.skipped.length} vonalkód kihagyva (már létezik vagy duplikált)`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Leltár">
      <Card className="mb-4 border-primary/30 bg-primary/5 p-4">
        <div className="flex items-start gap-3">
          <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm">
            <p className="font-semibold">Meglévő állomány feltöltése</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Egyedi vagy tömeges felvitel. A már létező vonalkódok automatikusan kihagyásra kerülnek – duplikáció nem keletkezik.
            </p>
          </div>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 grid w-full grid-cols-2">
          <TabsTrigger value="single">Egyedi felvitel</TabsTrigger>
          <TabsTrigger value="bulk">Tömeges felvitel</TabsTrigger>
        </TabsList>

        <SharedFields
          shared={shared}
          updateShared={updateShared}
          availableSizes={availableSizes}
          partners={partners ?? []}
          suppliers={suppliers ?? []}
        />

        <TabsContent value="single" className="mt-4 space-y-4">
          <Card className="p-4">
            <Label className="mb-2 block">Vonalkód</Label>
            <Input
              className="font-mono"
              placeholder="Pl. abc123"
              value={singleBarcode}
              onChange={(e) => setSingleBarcode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitSingle()}
            />
          </Card>
          <Button className="w-full" size="lg" disabled={busy} onClick={submitSingle}>
            <Check className="mr-2 h-5 w-5" />
            Palack felvétele
          </Button>
        </TabsContent>

        <TabsContent value="bulk" className="mt-4 space-y-4">
          <Card className="p-4">
            <Label className="mb-2 block">Vonalkódok (soronként egy)</Label>
            <Textarea
              className="min-h-[160px] font-mono text-sm"
              placeholder={"vonalkód1\nvonalkód2\nvonalkód3"}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {bulkCount} vonalkód a listában. Mind ugyanazokkal a beállításokkal kerül fel.
            </p>
          </Card>
          <Button className="w-full" size="lg" disabled={busy || bulkCount === 0} onClick={submitBulk}>
            <Check className="mr-2 h-5 w-5" />
            {bulkCount > 0 ? `${bulkCount} palack felvétele` : "Palackok felvétele"}
          </Button>
        </TabsContent>
      </Tabs>

      {result && <ResultSummary result={result} />}
    </AppShell>
  );
}

function SharedFields({
  shared,
  updateShared,
  availableSizes,
  partners,
  suppliers,
}: {
  shared: SharedDefaults;
  updateShared: <K extends keyof SharedDefaults>(key: K, value: SharedDefaults[K]) => void;
  availableSizes: string[];
  partners: { id: string; name: string; company_name: string | null }[];
  suppliers: { id: string; name: string; kind: string }[];
}) {
  return (
    <Card className="space-y-4 p-4">
      <div>
        <Label className="mb-2 block">Gáz típusa</Label>
        <Select
          value={shared.gasType}
          onValueChange={(v) => {
            updateShared("gasType", v);
            updateShared("size", getAvailableSizes(v)[0] || "20 L");
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GAS_TYPES.map((gas) => (
              <SelectItem key={gas} value={gas}>
                {gas}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="mb-2 block">Méret</Label>
        <Select value={shared.size} onValueChange={(v) => updateShared("size", v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableSizes.map((size) => (
              <SelectItem key={size} value={size}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="mb-2 block">Tulajdonos</Label>
        <Select value={shared.owner} onValueChange={(v) => updateShared("owner", v as Circulation)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CIRCULATION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="mb-2 block">Állapot</Label>
        <Select value={shared.status} onValueChange={(v) => updateShared("status", v as "full" | "empty")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INVENTORY_STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="mb-2 block">Hely</Label>
        <Select
          value={shared.place}
          onValueChange={(v) => {
            updateShared("place", v as InventoryPlace);
            if (v !== "partner") updateShared("partnerId", "");
            if (v !== "supplier") updateShared("supplierId", "");
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INVENTORY_PLACE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {shared.place === "partner" && (
        <div>
          <Label className="mb-2 block">Partner *</Label>
          <Select value={shared.partnerId} onValueChange={(v) => updateShared("partnerId", v)}>
            <SelectTrigger>
              <SelectValue placeholder="Válassz partnert…" />
            </SelectTrigger>
            <SelectContent>
              {partners.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {p.company_name ? ` · ${p.company_name}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {shared.place === "supplier" && (
        <div>
          <Label className="mb-2 block">Beszállító *</Label>
          <Select value={shared.supplierId} onValueChange={(v) => updateShared("supplierId", v)}>
            <SelectTrigger>
              <SelectValue placeholder="Válassz beszállítót…" />
            </SelectTrigger>
            <SelectContent>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </Card>
  );
}

function ResultSummary({ result }: { result: InventoryRegisterResult }) {
  return (
    <Card className="mt-4 p-4">
      <h3 className="mb-2 text-sm font-semibold">Eredmény</h3>
      <div className="mb-3 flex gap-2">
        <Badge className="bg-green-600">{result.created.length} felvéve</Badge>
        {result.skipped.length > 0 && <Badge variant="secondary">{result.skipped.length} kihagyva</Badge>}
      </div>
      {result.created.length > 0 && (
        <div className="mb-3 max-h-32 overflow-y-auto rounded-md bg-muted/40 p-2 text-xs font-mono">
          {result.created.map((c) => (
            <div key={c.id}>{c.barcode}</div>
          ))}
        </div>
      )}
      {result.skipped.length > 0 && (
        <div className="max-h-32 overflow-y-auto space-y-1 text-xs">
          {result.skipped.map((s) => (
            <div key={s.barcode} className="flex justify-between gap-2 rounded-md bg-muted/40 px-2 py-1">
              <span className="font-mono">{s.barcode}</span>
              <span className="text-muted-foreground">{s.reason}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
