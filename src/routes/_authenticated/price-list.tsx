import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { GAS_TYPES, getAvailableSizes } from "@/lib/gas-cylinder-form";
import {
  deleteProductPrice,
  fetchProductPrices,
  productLabel,
  upsertProductPrice,
  type ProductPrice,
} from "@/lib/product-prices";
import { formatHuf } from "@/lib/gas-order-prices";

export const Route = createFileRoute("/_authenticated/price-list")({
  head: () => ({ meta: [{ title: "Árlista – Gáz Veled" }] }),
  component: PriceListPage,
});

function parseFt(value: string): number {
  return Number(value.replace(/\s/g, ""));
}

function PriceListPage() {
  const qc = useQueryClient();
  const [gasType, setGasType] = useState("Argon");
  const [size, setSize] = useState("20 L");
  const [beszerzesiAr, setBeszerzesiAr] = useState("");
  const [arres, setArres] = useState("");
  const [productCode, setProductCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ProductPrice | null>(null);

  const sizes = getAvailableSizes(gasType);

  const beszerzesiNum = parseFt(beszerzesiAr);
  const arresNum = parseFt(arres);
  const eladasiAr =
    Number.isFinite(beszerzesiNum) && Number.isFinite(arresNum) ? beszerzesiNum + arresNum : null;

  const {
    data: prices = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["product-prices"],
    queryFn: () => fetchProductPrices(false),
  });

  function resetForm() {
    setEditing(null);
    setGasType("Argon");
    setSize("20 L");
    setBeszerzesiAr("");
    setArres("");
    setProductCode("");
    setNote("");
  }

  function startEdit(row: ProductPrice) {
    setEditing(row);
    setGasType(row.gas_type);
    setSize(row.size);
    setBeszerzesiAr(String(row.beszerzesi_ar));
    setArres(String(row.arres));
    setProductCode(row.product_code ?? "");
    setNote(row.note ?? "");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(beszerzesiNum) || beszerzesiNum < 0) {
      toast.error("Érvényes beszerzési árat adj meg (Ft)");
      return;
    }
    if (!Number.isFinite(arresNum) || arresNum < 0) {
      toast.error("Érvényes árrést adj meg (Ft)");
      return;
    }
    setBusy(true);
    try {
      await upsertProductPrice({
        id: editing?.id,
        gas_type: gasType,
        size,
        beszerzesi_ar: beszerzesiNum,
        arres: arresNum,
        product_code: productCode,
        note,
      });
      await qc.invalidateQueries({ queryKey: ["product-prices"] });
      toast.success(editing ? "Ár frissítve" : "Ár hozzáadva");
      resetForm();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(row: ProductPrice) {
    if (!confirm(`Törlöd: ${productLabel(row.gas_type, row.size)}?`)) return;
    setBusy(true);
    try {
      await deleteProductPrice(row.id);
      await qc.invalidateQueries({ queryKey: ["product-prices"] });
      toast.success("Ár törölve");
      if (editing?.id === row.id) resetForm();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Árlista">
      <p className="mb-4 text-sm text-muted-foreground">
        Beszerzési ár, árrés és eladási ár (Ft/db, bruttó). A gáz rendelés a beszerzési árat
        használja.
      </p>

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold">{editing ? "Ár szerkesztése" : "Új ár"}</h2>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Gáz</Label>
              <Select
                value={gasType}
                onValueChange={(v) => {
                  setGasType(v);
                  setSize(getAvailableSizes(v)[0] ?? "");
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
              <Select value={size} onValueChange={setSize}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sizes.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Beszerzési ár (Ft)</Label>
              <Input
                type="number"
                min={0}
                step={100}
                value={beszerzesiAr}
                onChange={(e) => setBeszerzesiAr(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Árrés (Ft)</Label>
              <Input
                type="number"
                min={0}
                step={100}
                value={arres}
                onChange={(e) => setArres(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Eladási ár (Ft)</Label>
              <Input
                type="text"
                readOnly
                value={eladasiAr != null ? formatHuf(eladasiAr) : "—"}
                className="bg-muted"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Termékkód (opcionális)</Label>
              <Input
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                placeholder="számlázáshoz később"
              />
            </div>
            <div>
              <Label>Megjegyzés</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              <Plus className="mr-2 h-4 w-4" />
              {editing ? "Mentés" : "Hozzáadás"}
            </Button>
            {editing && (
              <Button type="button" variant="outline" onClick={resetForm} disabled={busy}>
                Mégse
              </Button>
            )}
          </div>
        </form>
      </Card>

      {isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Betöltés…</div>}
      {isError && (
        <div className="py-8 text-center text-sm text-destructive">
          Árlista betöltése sikertelen. Futtasd a migrációt: product_prices tábla.
        </div>
      )}

      {!isLoading && !isError && (
        <Card className="overflow-hidden">
          <div className="border-b px-4 py-3 text-sm font-semibold">Aktuális árak</div>
          {prices.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Még nincs ár felvéve.</div>
          ) : (
            <ul className="divide-y">
              {prices.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <div className="min-w-[120px] flex-1 font-medium">
                    {productLabel(row.gas_type, row.size)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    B: {formatHuf(row.beszerzesi_ar)} · Árrés: {formatHuf(row.arres)}
                  </div>
                  <div className="font-mono font-medium">{formatHuf(row.eladasi_ar)}</div>
                  {row.product_code && (
                    <div className="text-xs text-muted-foreground">{row.product_code}</div>
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => startEdit(row)}
                    disabled={busy}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDelete(row)}
                    disabled={busy}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Beszerzési ár →{" "}
        <Link to="/gas-order" className="underline hover:text-foreground">
          Gáz rendelés
        </Link>
        . Eladási ár (beszerzési + árrés) → gyors csere, árajánlat, profit, számlázás.
      </p>
    </AppShell>
  );
}
