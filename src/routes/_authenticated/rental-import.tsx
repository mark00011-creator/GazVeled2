import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileSpreadsheet, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  executeRentalImport,
  parseRentalImportFile,
  type RentalImportPreview,
  type RentalImportResult,
} from "@/lib/rental-import";
import { rentalStatusLabels } from "@/lib/labels";

export const Route = createFileRoute("/_authenticated/rental-import")({
  head: () => ({ meta: [{ title: "Bérlet import – Gáz Veled" }] }),
  component: RentalImportPage,
});

function RentalImportPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RentalImportPreview | null>(null);
  const [result, setResult] = useState<RentalImportResult | null>(null);

  async function handleFileChange(file: File | null) {
    if (!file) return;
    setResult(null);
    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = await parseRentalImportFile(buffer, file.name);
      setPreview(parsed);
      if (parsed.rentalCount === 0) {
        toast.warning("Nincs importálható bérlet – ellenőrizd a hibalistát");
      } else {
        toast.success("Előnézet kész");
      }
    } catch (e) {
      toast.error((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    if (!preview || preview.rentalCount === 0) return;
    if (
      !confirm(
        `Biztosan importálod?\n\n${preview.rentalCount} bérlet\n${preview.cylinderCount} új palack\n\nA meglévő készlet nem módosul.`,
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      const importResult = await executeRentalImport(preview);
      setResult(importResult);
      if (importResult.rentalsCreated > 0) {
        toast.success(
          `${importResult.rentalsCreated} bérlet, ${importResult.cylindersCreated} palack importálva`,
        );
        await qc.invalidateQueries({ queryKey: ["rentals"] });
        await qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      }
      if (importResult.errors.length > 0) {
        toast.error(`${importResult.errors.length} hiba történt az import során`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Bérlet import">
      <Card className="mb-4 border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-semibold">Egyszer használatos migrációs eszköz</p>
            <p className="mt-1 text-muted-foreground">
              A „Palack bérlések.xlsx” fájlból új bérleteket és ideiglenes palackokat hoz létre. A
              meglévő készlet és cylinder rekordok nem módosulnak. Minden palack{" "}
              <code className="text-xs">TEMP-000001</code> formátumú új rekord lesz, bérletben
              (ügyfélnél), <code className="text-xs">is_temporary = true</code>.
            </p>
          </div>
        </div>
      </Card>

      <Card className="mb-4 p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <FileSpreadsheet className="h-4 w-4" />
          Excel feltöltés
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Elvárt oszlopok: <strong>Partner</strong>, <strong>Palack típus</strong> (opcionális:
          kezdet, lejárat, vége, kaució). Partnernév egyezés a <code>partners.name</code> mezővel.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="mr-2 h-4 w-4" />
          {busy ? "Feldolgozás…" : "Palack bérlések.xlsx kiválasztása"}
        </Button>
        {preview && (
          <p className="mt-2 text-xs text-muted-foreground">Fájl: {preview.fileName}</p>
        )}
      </Card>

      {preview && (
        <Card className="mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold">Import előnézet</h2>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-3 text-center">
              <div className="text-2xl font-bold">{preview.rentalCount}</div>
              <div className="text-xs text-muted-foreground">Bérlet (rentals)</div>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <div className="text-2xl font-bold">{preview.cylinderCount}</div>
              <div className="text-xs text-muted-foreground">Palack (cylinders)</div>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <div className="text-2xl font-bold">{preview.cylinderCount}</div>
              <div className="text-xs text-muted-foreground">Kapcsolat (rental_cylinders)</div>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <div className="text-2xl font-bold">{preview.partnerCount}</div>
              <div className="text-xs text-muted-foreground">Partner</div>
            </div>
          </div>

          <p className="mb-3 text-sm text-muted-foreground">
            Összes sor: {preview.totalRows} · Importálható palack: {preview.validRows} · Hibák:{" "}
            {preview.errors.length}
          </p>

          {preview.rentals.length > 0 && (
            <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80">
                  <tr>
                    <th className="p-2 text-left font-medium">Partner</th>
                    <th className="p-2 text-left font-medium">Kezdet</th>
                    <th className="p-2 text-left font-medium">Lejárat</th>
                    <th className="p-2 text-right font-medium">Kaució</th>
                    <th className="p-2 text-center font-medium">Palack</th>
                    <th className="p-2 text-left font-medium">Státusz</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rentals.map((r) => (
                    <tr key={r.partner_id} className="border-t">
                      <td className="p-2">{r.partnerName}</td>
                      <td className="p-2">{r.start_date}</td>
                      <td className="p-2">{r.expiry_date ?? "—"}</td>
                      <td className="p-2 text-right">{r.deposit.toLocaleString("hu-HU")} Ft</td>
                      <td className="p-2 text-center">{r.cylinders.length}</td>
                      <td className="p-2">
                        <Badge variant={r.status === "active" ? "default" : "secondary"}>
                          {rentalStatusLabels[r.status] ?? r.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.errors.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-semibold text-destructive">Hibalista</h3>
              <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                {preview.errors.map((err, i) => (
                  <li key={`${err.row}-${i}`} className="text-destructive">
                    {err.row > 0 ? `Sor ${err.row}` : "Fájl"}
                    {err.partner ? ` (${err.partner})` : ""}: {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.missingPartners.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-semibold">Nem található partnerek</h3>
              <ul className="text-sm text-muted-foreground">
                {preview.missingPartners.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </div>
          )}

          <Button
            size="lg"
            disabled={busy || preview.rentalCount === 0}
            onClick={handleImport}
          >
            <CheckCircle2 className="mr-2 h-5 w-5" />
            Import végrehajtása
          </Button>
        </Card>
      )}

      {result && (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Import napló</h2>
          <ul className="mb-4 space-y-1 text-sm">
            <li>
              Importált partnerek: <strong>{result.partnersImported}</strong>
            </li>
            <li>
              Létrehozott bérletek: <strong>{result.rentalsCreated}</strong>
            </li>
            <li>
              Létrehozott palackok: <strong>{result.cylindersCreated}</strong>
            </li>
            <li>
              Létrehozott bérlet–palack kapcsolatok:{" "}
              <strong>{result.rentalCylindersCreated}</strong>
            </li>
            <li>
              Nem található partnerek: <strong>{result.missingPartners.length}</strong>
            </li>
          </ul>

          {result.missingPartners.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                Hiányzó partnerek
              </div>
              <ul className="text-sm">
                {result.missingPartners.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          {result.errors.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase text-destructive">Import hibák</div>
              <ul className="text-sm text-destructive">
                {result.errors.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </AppShell>
  );
}
