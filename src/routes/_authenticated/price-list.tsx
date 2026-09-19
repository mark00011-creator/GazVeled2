import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PRICE_LIST_GAS_TYPES, getPriceListSizes } from "@/lib/product-prices";
import {
  deleteProductPrice,
  fetchProductPrices,
  productLabel,
  upsertProductPrice,
  type ProductPrice,
} from "@/lib/product-prices";
import { formatHuf } from "@/lib/gas-order-prices";
import { useAuth } from "@/lib/auth";
import { isVatRegistered, priceBasisHint } from "@/lib/org-tax";
import { usePersistedFormState } from "@/hooks/use-persisted-form-state";

export const Route = createFileRoute("/_authenticated/price-list")({
  head: () => ({ meta: [{ title: "Árlista – Gáz Veled" }] }),
  component: PriceListPage,
});

function parseFt(value: string): number {
  return Number(value.replace(/\s/g, ""));
}

type AddForm = {
  gasType: string;
  size: string;
  beszerzesiAr: string;
  arres: string;
  productCode: string;
  note: string;
};

const ADD_DEFAULTS: AddForm = {
  gasType: "Argon",
  size: "20 L",
  beszerzesiAr: "",
  arres: "",
  productCode: "",
  note: "",
};

function PriceListPage() {
  const qc = useQueryClient();
  const { organization } = useAuth();
  const vatOn = isVatRegistered(organization?.settings);
  const { state: add, patch: patchAdd, reset: resetAdd } = usePersistedFormState(ADD_DEFAULTS, {
    formKey: "add",
  });
  const { gasType, size, beszerzesiAr, arres, productCode, note } = add;
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ProductPrice | null>(null);
  const [editBeszerzesiAr, setEditBeszerzesiAr] = useState("");
  const [editArres, setEditArres] = useState("");
  const [editProductCode, setEditProductCode] = useState("");
  const [editNote, setEditNote] = useState("");

  const sizes = getPriceListSizes(gasType);

  const beszerzesiNum = parseFt(beszerzesiAr);
  const arresNum = parseFt(arres);
  const eladasiAr =
    Number.isFinite(beszerzesiNum) && Number.isFinite(arresNum) ? beszerzesiNum + arresNum : null;

  const editBeszerzesiNum = parseFt(editBeszerzesiAr);
  const editArresNum = parseFt(editArres);
  const editEladasiAr =
    Number.isFinite(editBeszerzesiNum) && Number.isFinite(editArresNum)
      ? editBeszerzesiNum + editArresNum
      : null;

  const {
    data: prices = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["product-prices"],
    queryFn: () => fetchProductPrices(false),
  });

  function resetAddForm() {
    resetAdd();
  }

  function startEdit(row: ProductPrice) {
    setEditing(row);
    setEditBeszerzesiAr(String(row.beszerzesi_ar ?? row.unit_price ?? 0));
    setEditArres(String(row.arres ?? 0));
    setEditProductCode(row.product_code ?? "");
    setEditNote(row.note ?? "");
  }

  function closeEditDialog() {
    setEditing(null);
    setEditBeszerzesiAr("");
    setEditArres("");
    setEditProductCode("");
    setEditNote("");
  }

  async function handleAdd(e: React.FormEvent) {
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
        gas_type: gasType,
        size,
        beszerzesi_ar: beszerzesiNum,
        arres: arresNum,
        product_code: productCode,
        note,
      });
      await qc.invalidateQueries({ queryKey: ["product-prices"] });
      toast.success("Ár hozzáadva");
      resetAddForm();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (!Number.isFinite(editBeszerzesiNum) || editBeszerzesiNum < 0) {
      toast.error("Érvényes beszerzési árat adj meg (Ft)");
      return;
    }
    if (!Number.isFinite(editArresNum) || editArresNum < 0) {
      toast.error("Érvényes árrést adj meg (Ft)");
      return;
    }
    setBusy(true);
    try {
      await upsertProductPrice({
        id: editing.id,
        gas_type: editing.gas_type,
        size: editing.size,
        beszerzesi_ar: editBeszerzesiNum,
        arres: editArresNum,
        product_code: editProductCode,
        note: editNote,
      });
      await qc.invalidateQueries({ queryKey: ["product-prices"] });
      toast.success("Ár frissítve");
      closeEditDialog();
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
      if (editing?.id === row.id) closeEditDialog();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Árlista">
      <p className="mb-2 text-sm text-muted-foreground">
        Beszerzési ár, árrés és eladási ár (Ft/db
        {vatOn ? ", nettó" : ", bruttó"}). A gáz rendelés a beszerzési árat használja.
      </p>
      <p className="mb-4 text-xs text-muted-foreground">{priceBasisHint(organization?.settings)}</p>

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold">Új ár</h2>
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Gáz</Label>
              <Select
                value={gasType}
                onValueChange={(v) => {
                  patchAdd({ gasType: v, size: getPriceListSizes(v)[0] ?? "" });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRICE_LIST_GAS_TYPES.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Méret</Label>
              <Select value={size} onValueChange={(v) => patchAdd({ size: v })}>
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
                onChange={(e) => patchAdd({ beszerzesiAr: e.target.value })}
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
                onChange={(e) => patchAdd({ arres: e.target.value })}
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
                onChange={(e) => patchAdd({ productCode: e.target.value })}
                placeholder="számlázáshoz később"
              />
            </div>
            <div>
              <Label>Megjegyzés</Label>
              <Input value={note} onChange={(e) => patchAdd({ note: e.target.value })} />
            </div>
          </div>
          <Button type="submit" disabled={busy}>
            <Plus className="mr-2 h-4 w-4" />
            Hozzáadás
          </Button>
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
                    aria-label={`${productLabel(row.gas_type, row.size)} szerkesztése`}
                    onClick={() => startEdit(row)}
                    disabled={busy}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`${productLabel(row.gas_type, row.size)} törlése`}
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

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) closeEditDialog();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ár szerkesztése</DialogTitle>
            <DialogDescription>
              {editing ? productLabel(editing.gas_type, editing.size) : ""}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSave} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="edit-beszerzesi-ar">Beszerzési ár (Ft)</Label>
                <Input
                  id="edit-beszerzesi-ar"
                  type="number"
                  min={0}
                  step={100}
                  value={editBeszerzesiAr}
                  onChange={(e) => setEditBeszerzesiAr(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit-arres">Árrés (Ft)</Label>
                <Input
                  id="edit-arres"
                  type="number"
                  min={0}
                  step={100}
                  value={editArres}
                  onChange={(e) => setEditArres(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit-eladasi-ar">Eladási ár (Ft)</Label>
                <Input
                  id="edit-eladasi-ar"
                  type="text"
                  readOnly
                  value={editEladasiAr != null ? formatHuf(editEladasiAr) : "—"}
                  className="bg-muted"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="edit-product-code">Termékkód (opcionális)</Label>
                <Input
                  id="edit-product-code"
                  value={editProductCode}
                  onChange={(e) => setEditProductCode(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="edit-note">Megjegyzés</Label>
                <Input
                  id="edit-note"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={closeEditDialog} disabled={busy}>
                Mégse
              </Button>
              <Button type="submit" disabled={busy}>
                Mentés
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
