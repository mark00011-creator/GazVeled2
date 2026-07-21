import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { PhoneLink } from "@/components/PhoneLink";
import { Camera, Check, HandCoins, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { fmtDateTime } from "@/lib/labels";
import {
  fetchActiveLoansByPartner,
  returnCylinderLoan,
  type LoanedCylinderDetail,
  type PartnerLoanSummary,
} from "@/lib/loan-ops";
import { findCylinderByBarcode, normalizeBarcode } from "@/lib/cylinder-ops";

export const Route = createFileRoute("/_authenticated/loaned-cylinders")({
  head: () => ({ meta: [{ title: "Kölcsönadott – Gáz Veled" }] }),
  component: LoanedCylinders,
});

function ReturnForm({
  loan,
  partnerId,
  onDone,
}: {
  loan: LoanedCylinderDetail;
  partnerId: string;
  onDone: () => void;
}) {
  const [returnBc, setReturnBc] = useState(loan.barcode);
  const [note, setNote] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [returnMode, setReturnMode] = useState<"empty" | "full">("empty");
  const [preview, setPreview] = useState<{ barcode: string; gas_type: string; size: string } | null>(
    null,
  );

  async function lookupBarcode() {
    if (!returnBc.trim()) return;
    try {
      const cyl = await findCylinderByBarcode(returnBc);
      setPreview({ barcode: cyl.barcode, gas_type: cyl.gas_type, size: cyl.size });
    } catch {
      setPreview(null);
      toast.error("Palack nem található");
    }
  }

  async function submit() {
    if (!returnBc.trim()) {
      toast.error("Add meg a visszahozott palack vonalkódját");
      return;
    }
    setBusy(true);
    try {
      await returnCylinderLoan({
        loan_id: loan.loan_id,
        returned_barcode: returnBc,
        partner_id: partnerId,
        note: note.trim() || null,
        return_mode: returnMode,
      });
      toast.success("Kölcsön visszavéve");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border/60 bg-muted/30 p-3">
      {scanning && (
        <BarcodeScanner
          onResult={async (t) => {
            const bc = normalizeBarcode(t);
            setScanning(false);
            setReturnBc(bc);
            try {
              const cyl = await findCylinderByBarcode(bc);
              setPreview({ barcode: cyl.barcode, gas_type: cyl.gas_type, size: cyl.size });
            } catch {
              setPreview(null);
            }
          }}
          onClose={() => setScanning(false)}
        />
      )}

      <div className="text-xs text-muted-foreground">
        Kiadott palack: <span className="font-mono font-medium text-foreground">{loan.barcode}</span>
        {returnBc !== loan.barcode && (
          <span className="ml-2 text-amber-700 dark:text-amber-400">(helyettesítő visszavétel)</span>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <Label className="text-xs">Visszahozott palack vonalkódja</Label>
          <Button type="button" size="sm" variant="secondary" onClick={() => setScanning(true)}>
            <Camera className="mr-1 h-3.5 w-3.5" /> Scan
          </Button>
        </div>
        <div className="flex gap-2">
          <Input
            value={returnBc}
            onChange={(e) => {
              setReturnBc(e.target.value);
              setPreview(null);
            }}
            onBlur={lookupBarcode}
            className="font-mono"
            placeholder="Vonalkód (eltérhet a kiadottól)"
          />
          <Button type="button" variant="outline" onClick={lookupBarcode}>
            OK
          </Button>
        </div>
        {preview && (
          <div className="mt-2 text-xs text-muted-foreground">
            {preview.gas_type} · {preview.size}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Visszavétel módja</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            size="sm"
            variant={returnMode === "empty" ? "default" : "outline"}
            className="flex-1"
            onClick={() => setReturnMode("empty")}
          >
            Üresen hozta vissza
          </Button>
          <Button
            type="button"
            size="sm"
            variant={returnMode === "full" ? "default" : "outline"}
            className="flex-1"
            onClick={() => setReturnMode("full")}
          >
            Teli hozta vissza
          </Button>
        </div>
        {returnMode === "full" && (
          <p className="text-xs text-muted-foreground">
            Telephelyi teli készletbe kerül; a kölcsön nem jelenik meg nem számlázott tételek között.
          </p>
        )}
      </div>

      <Input
        placeholder="Megjegyzés (opcionális)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <Button className="w-full" disabled={busy} onClick={submit}>
        <Check className="mr-2 h-4 w-4" />
        Visszavétel rögzítése
      </Button>
    </div>
  );
}

function LoanRow({
  loan,
  partnerId,
  onReturned,
}: {
  loan: LoanedCylinderDetail;
  partnerId: string;
  onReturned: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md border border-border/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm font-semibold">{loan.barcode}</div>
          <div className="text-xs text-muted-foreground">
            {loan.gas_type} · {loan.size}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Kölcsön: {fmtDateTime(loan.loaned_at)}
          </div>
          {loan.note && <div className="mt-1 text-xs italic text-muted-foreground">{loan.note}</div>}
        </div>
        <Button
          type="button"
          size="sm"
          variant={open ? "secondary" : "outline"}
          onClick={() => setOpen((v) => !v)}
        >
          Visszavétel
          {open ? <ChevronUp className="ml-1 h-3.5 w-3.5" /> : <ChevronDown className="ml-1 h-3.5 w-3.5" />}
        </Button>
      </div>
      {open && (
        <ReturnForm
          loan={loan}
          partnerId={partnerId}
          onDone={() => {
            setOpen(false);
            onReturned();
          }}
        />
      )}
    </div>
  );
}

function PartnerCard({
  summary,
  onReturned,
}: {
  summary: PartnerLoanSummary;
  onReturned: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex-1">
          <div className="font-semibold">{summary.partner_name}</div>
          {summary.company_name && (
            <div className="text-sm text-muted-foreground">{summary.company_name}</div>
          )}
          {summary.phone && (
            <div className="text-sm text-muted-foreground">
              <PhoneLink phone={summary.phone} />
            </div>
          )}
        </div>
        <Badge variant="secondary">{summary.loans.length} kölcsön</Badge>
      </div>
      <div className="space-y-2">
        {summary.loans.map((loan) => (
          <LoanRow key={loan.loan_id} loan={loan} partnerId={summary.partner_id} onReturned={onReturned} />
        ))}
      </div>
    </Card>
  );
}

function LoanedCylinders() {
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["loaned-cylinders"],
    queryFn: fetchActiveLoansByPartner,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["loaned-cylinders"] });
    qc.invalidateQueries({ queryKey: ["cylinders"] });
    qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    qc.invalidateQueries({ queryKey: ["history"] });
    qc.invalidateQueries({ queryKey: ["uninvoiced-exchanges"] });
  }

  return (
    <AppShell title="Kölcsönadott">
      <div className="mb-4 flex items-center gap-2 text-muted-foreground">
        <HandCoins className="h-5 w-5 text-primary" />
        <p className="text-sm">
          Partnerek, akiknek jelenleg van kiadott kölcsön palackja. A visszavételnél megadható más
          vonalkód is, ha a partner máshol cserélte a palackot.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Betöltés…</p>}
      {isError && (
        <Card className="p-4 text-sm text-destructive">
          Nem sikerült betölteni a kölcsönadott palackokat.
          <Button variant="link" className="px-1" onClick={() => refetch()}>
            Újra
          </Button>
        </Card>
      )}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Jelenleg nincs aktív kölcsönadott palack.
        </Card>
      )}

      <div className="space-y-4">
        {(data ?? []).map((summary) => (
          <PartnerCard key={summary.partner_id} summary={summary} onReturned={invalidate} />
        ))}
      </div>
    </AppShell>
  );
}
