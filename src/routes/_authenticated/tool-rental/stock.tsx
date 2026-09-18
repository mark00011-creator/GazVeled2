import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AlertTriangle, PackagePlus, Pencil, Plus, ShoppingCart, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { isAdminRole } from "@/lib/roles";
import { isModuleEnabled } from "@/lib/organization";
import {
  displayGrossFromNet,
  effectiveVatRate,
  getTaxSettings,
  isVatRegistered,
  priceBasisHint,
  priceFieldLabel,
} from "@/lib/org-tax";
import { authDiag } from "@/lib/auth-diag";
import { supabase } from "@/integrations/supabase/client";
import {
  useRouteScrollRestoration,
  useRouteStatePersistence,
} from "@/hooks/use-route-state-persistence";
import {
  formatMarginPercent,
  formatSupplyHuf,
  grossFromNet,
  lineProfit,
  lineTotals,
  marginPercent,
  parseSupplyPriceInput,
  profitPerUnit,
  salePriceFromMarginPercent,
  salePriceFromProfitFt,
} from "@/lib/supply-pricing";
import {
  BILLING_STATUS_LABELS,
  billingSummaryStatus,
  createSupplyProduct,
  deactivateSupplyProduct,
  fetchSupplyMovements,
  fetchSupplyProducts,
  fetchSupplySales,
  partnerDisplayName,
  parsePositiveInt,
  receiveSupplyStock,
  recordSupplySaleBatch,
  suggestSupplyNaturalKey,
  SUPPLY_MOVEMENT_LABELS,
  updateSupplyProduct,
  updateSupplyProductPrices,
  type SupplyProduct,
  type SupplySale,
  type SupplySaleLineInput,
} from "@/lib/supply-stock";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/tool-rental/stock")({
  head: () => ({ meta: [{ title: "Eszközök és fogyóanyagok – Gáz Veled" }] }),
  component: SupplyStockPage,
});

type PartnerRow = { id: string; name: string; company_name: string | null };
type SupplierRow = { id: string; name: string };

function SupplyStockPage() {
  const { profile, loading, orgSettings } = useAuth();
  const admin = isAdminRole(profile?.role);
  const moduleOn = isModuleEnabled(orgSettings, "tool_rental");

  authDiag({
    route: "tool-rental/stock",
    loading,
    profile: profile
      ? { role: profile.role, is_active: profile.is_active, email: profile.email }
      : null,
    role: profile?.role ?? null,
    isAdminRole: admin,
    moduleOn,
    redirectReason: loading ? "LOADING" : !admin ? "ROLE_DENIED" : !moduleOn ? "MODULE_OFF" : "ALLOW",
  });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Betöltés…
      </div>
    );
  }

  if (!admin) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!moduleOn) {
    return (
      <AppShell title="Eszközök és fogyóanyagok">
        <Card className="p-4 text-sm text-muted-foreground">
          Ez a modul ki van kapcsolva a cég beállításaiban. Kapcsold be:{" "}
          <strong>Több → Cég beállítások → Eszköz / fogyóanyag</strong>.
        </Card>
      </AppShell>
    );
  }

  return <SupplyStockAdmin />;
}

function SupplyStockAdmin() {
  const qc = useQueryClient();
  const { organization } = useAuth();
  const { state, patch, storageKey } = useRouteStatePersistence<{ tab: string }>({ tab: "stock" });
  const tab = state.tab;
  const setTab = (value: string) => patch({ tab: value });
  const [busy, setBusy] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [priceProduct, setPriceProduct] = useState<SupplyProduct | null>(null);
  const [receiveProduct, setReceiveProduct] = useState<SupplyProduct | null>(null);
  const [detailProduct, setDetailProduct] = useState<SupplyProduct | null>(null);
  const [saleDetail, setSaleDetail] = useState<SupplySale | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<SupplyProduct | null>(null);

  const productsQuery = useQuery({ queryKey: ["supply-products"], queryFn: fetchSupplyProducts });
  const salesQuery = useQuery({ queryKey: ["supply-sales"], queryFn: fetchSupplySales });
  const partnersQuery = useQuery({
    queryKey: ["supply-partners"],
    queryFn: async () =>
      ((await supabase.from("partners").select("id,name,company_name").order("name")).data ??
        []) as PartnerRow[],
  });
  const suppliersQuery = useQuery({
    queryKey: ["supply-suppliers"],
    queryFn: async () =>
      ((await supabase.from("suppliers").select("id,name").order("name")).data ?? []) as SupplierRow[],
  });

  const products = productsQuery.data ?? [];
  const sales = salesQuery.data ?? [];

  useRouteScrollRestoration(
    storageKey,
    tab === "stock"
      ? productsQuery.isFetched || productsQuery.isError
      : salesQuery.isFetched || salesQuery.isError,
  );

  async function refreshAll() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["supply-products"] }),
      qc.invalidateQueries({ queryKey: ["supply-sales"] }),
    ]);
  }

  return (
    <AppShell title="Eszközök és fogyóanyagok">
      <p className="mb-3 text-xs text-muted-foreground">{priceBasisHint(organization?.settings)}</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          className="gap-2"
          variant="outline"
          onClick={() => {
            setEditProduct(null);
            setEditorOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Új tétel
        </Button>
        <Button className="gap-2" onClick={() => setSaleOpen(true)}>
          <ShoppingCart className="h-4 w-4" />
          Gyors értékesítés
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 grid w-full grid-cols-2">
          <TabsTrigger value="stock">Készlet</TabsTrigger>
          <TabsTrigger value="sales">Korábbi értékesítések</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="space-y-3">
          {productsQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Készlet betöltése…</p>
          )}
          {productsQuery.isError && (
            <p className="text-sm text-destructive">Nem sikerült betölteni a készletet.</p>
          )}
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              onEdit={() => {
                setEditProduct(p);
                setEditorOpen(true);
              }}
              onPrice={() => setPriceProduct(p)}
              onReceive={() => setReceiveProduct(p)}
              onDetail={() => setDetailProduct(p)}
            />
          ))}
        </TabsContent>

        <TabsContent value="sales" className="space-y-3">
          {salesQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Értékesítések betöltése…</p>
          )}
          {sales.length === 0 && !salesQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Még nincs értékesítés.</p>
          )}
          {sales.map((s) => (
            <Card
              key={s.id}
              className="cursor-pointer p-3 transition-colors hover:bg-accent/40"
              onClick={() => setSaleDetail(s)}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">
                    {s.partner ? partnerDisplayName(s.partner) : "Partner"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(s.created_at).toLocaleString("hu-HU")} ·{" "}
                    {(s.items ?? []).length} tétel
                  </div>
                </div>
                <Badge variant="outline">
                  {BILLING_STATUS_LABELS[billingSummaryStatus(s.billing)] ??
                    billingSummaryStatus(s.billing)}
                </Badge>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {isVatRegistered(organization?.settings) ? (
                  <>
                    <span>Nettó: {formatSupplyHuf(s.total_net)}</span>
                    <span>Bruttó: {formatSupplyHuf(s.total_gross)}</span>
                  </>
                ) : (
                  <span>Összeg: {formatSupplyHuf(s.total_net)}</span>
                )}
                <span>Beszerzés: {formatSupplyHuf(s.total_purchase_value)}</span>
                <span>Haszon: {formatSupplyHuf(s.total_profit)}</span>
              </div>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      <QuickSaleDialog
        open={saleOpen}
        onOpenChange={setSaleOpen}
        products={products.filter((p) => p.is_active && p.is_sellable)}
        partners={partnersQuery.data ?? []}
        busy={busy}
        setBusy={setBusy}
        onSuccess={async () => {
          await refreshAll();
          setSaleOpen(false);
        }}
      />

      <PriceDialog
        product={priceProduct}
        onClose={() => setPriceProduct(null)}
        busy={busy}
        setBusy={setBusy}
        onSuccess={async () => {
          await refreshAll();
          setPriceProduct(null);
        }}
      />

      <ReceiveDialog
        product={receiveProduct}
        suppliers={suppliersQuery.data ?? []}
        onClose={() => setReceiveProduct(null)}
        busy={busy}
        setBusy={setBusy}
        onSuccess={async () => {
          await refreshAll();
          setReceiveProduct(null);
        }}
      />

      <ProductDetailSheet product={detailProduct} onClose={() => setDetailProduct(null)} />

      <SaleDetailDialog sale={saleDetail} onClose={() => setSaleDetail(null)} />

      <ProductEditorDialog
        open={editorOpen}
        product={editProduct}
        busy={busy}
        setBusy={setBusy}
        onClose={() => {
          setEditorOpen(false);
          setEditProduct(null);
        }}
        onSuccess={async () => {
          await refreshAll();
          setEditorOpen(false);
          setEditProduct(null);
        }}
      />
    </AppShell>
  );
}

function ProductCard({
  product: p,
  onEdit,
  onPrice,
  onReceive,
  onDetail,
}: {
  product: SupplyProduct;
  onEdit: () => void;
  onPrice: () => void;
  onReceive: () => void;
  onDetail: () => void;
}) {
  const { organization } = useAuth();
  const vatOn = isVatRegistered(organization?.settings);
  const rate = effectiveVatRate(organization?.settings, p.vat_rate);
  const saleGross = displayGrossFromNet(p.sale_price, organization?.settings, p.vat_rate);
  const profit = profitPerUnit(p.purchase_price, p.sale_price);
  const margin = marginPercent(p.purchase_price, p.sale_price);
  const lowStock =
    p.stock_kind === "quantity" &&
    p.current_stock != null &&
    p.current_stock <= p.minimum_stock;

  return (
    <Card className={`p-3 ${!p.is_active ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{p.name}</div>
          <div className="text-xs text-muted-foreground">
            {[p.category, p.specification, p.packaging].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-bold ${lowStock ? "text-amber-600" : ""}`}>
            {p.current_stock ?? "—"} {p.unit_of_measure}
          </div>
          {lowStock && (
            <span className="text-[10px] text-amber-600">Alacsony készlet</span>
          )}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
        <span>Beszerzés: {formatSupplyHuf(p.purchase_price)}</span>
        <span>
          Eladás{vatOn ? " nettó" : ""}:{" "}
          {p.sale_price != null ? formatSupplyHuf(p.sale_price) : "—"}
        </span>
        {vatOn && (
          <span>Eladás bruttó: {saleGross != null ? formatSupplyHuf(saleGross) : "—"}</span>
        )}
        <span>Haszon: {formatSupplyHuf(profit)}</span>
        <span>Árrés: {formatMarginPercent(margin)}</span>
        {vatOn && <span>ÁFA: {rate}%</span>}
        <span>
          Min: {p.minimum_stock} {p.unit_of_measure}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {!p.is_active && <Badge variant="secondary">Inaktív</Badge>}
        {p.is_sellable ? (
          p.sale_price == null ? (
            <Badge variant="outline" className="border-amber-500 text-amber-700">
              Eladási ár beállítása szükséges
            </Badge>
          ) : (
            <Badge variant="outline">Eladható</Badge>
          )
        ) : (
          <Badge variant="secondary">Nem eladható</Badge>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil className="mr-1 h-3 w-3" />
          Szerkesztés
        </Button>
        <Button size="sm" variant="outline" onClick={onPrice}>
          <TrendingUp className="mr-1 h-3 w-3" />
          Ár
        </Button>
        <Button size="sm" variant="outline" onClick={onReceive}>
          <PackagePlus className="mr-1 h-3 w-3" />
          Bevételezés
        </Button>
        <Button size="sm" variant="ghost" onClick={onDetail}>
          Mozgások
        </Button>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Módosítva: {new Date(p.updated_at).toLocaleString("hu-HU")}
      </p>
    </Card>
  );
}

function ProductEditorDialog({
  open,
  product,
  busy,
  setBusy,
  onClose,
  onSuccess,
}: {
  open: boolean;
  product: SupplyProduct | null;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const isEdit = product != null;
  const [name, setName] = useState("");
  const [naturalKey, setNaturalKey] = useState("");
  const [category, setCategory] = useState("");
  const [specification, setSpecification] = useState("");
  const [packaging, setPackaging] = useState("");
  const [unit, setUnit] = useState("db");
  const [minStock, setMinStock] = useState("0");
  const [initialStock, setInitialStock] = useState("0");
  const [isSellable, setIsSellable] = useState(true);
  const [isRentable, setIsRentable] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [note, setNote] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (product) {
      setName(product.name);
      setNaturalKey(product.natural_key);
      setCategory(product.category ?? "");
      setSpecification(product.specification ?? "");
      setPackaging(product.packaging ?? "");
      setUnit(product.unit_of_measure);
      setMinStock(String(product.minimum_stock));
      setInitialStock("0");
      setIsSellable(product.is_sellable);
      setIsRentable(product.is_rentable);
      setIsActive(product.is_active);
      setNote(product.note ?? "");
      setKeyTouched(true);
    } else {
      setName("");
      setNaturalKey("");
      setCategory("");
      setSpecification("");
      setPackaging("");
      setUnit("db");
      setMinStock("0");
      setInitialStock("0");
      setIsSellable(true);
      setIsRentable(false);
      setIsActive(true);
      setNote("");
      setKeyTouched(false);
    }
  }, [open, product?.id]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Tétel szerkesztése" : "Új tétel"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Név, kategória, mértékegység, eladhatóság. Készletszám: Bevételezés."
              : "Új anyag / eszköz a darabszámos készlethez."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const trimmedName = name.trim();
            if (!trimmedName) {
              toast.error("A név kötelező");
              return;
            }
            const unitTrim = unit.trim() || "db";
            let min = 0;
            try {
              min = Number(minStock.replace(/\s/g, ""));
              if (!Number.isFinite(min) || min < 0 || !Number.isInteger(min)) {
                throw new Error("A minimum készletnek nemnegatív egésznek kell lennie");
              }
            } catch (err) {
              toast.error((err as Error).message);
              return;
            }

            setBusy(true);
            try {
              if (isEdit && product) {
                await updateSupplyProduct({
                  productId: product.id,
                  name: trimmedName,
                  category,
                  specification,
                  packaging,
                  unitOfMeasure: unitTrim,
                  minimumStock: min,
                  isSellable,
                  isRentable,
                  isActive,
                  note,
                });
                toast.success("Tétel mentve");
              } else {
                let init = 0;
                try {
                  init = Number(initialStock.replace(/\s/g, ""));
                  if (!Number.isFinite(init) || init < 0 || !Number.isInteger(init)) {
                    throw new Error("Az induló készletnek nemnegatív egésznek kell lennie");
                  }
                } catch (err) {
                  toast.error((err as Error).message);
                  setBusy(false);
                  return;
                }
                const key = (naturalKey.trim() || suggestSupplyNaturalKey(trimmedName)).slice(0, 80);
                await createSupplyProduct({
                  name: trimmedName,
                  naturalKey: key,
                  unitOfMeasure: unitTrim,
                  category: category || undefined,
                  specification: specification || undefined,
                  packaging: packaging || undefined,
                  minimumStock: min,
                  initialStock: init,
                  isSellable,
                  isRentable,
                  note: note || undefined,
                });
                toast.success("Új tétel létrehozva");
              }
              await onSuccess();
            } catch (err) {
              toast.error((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <Label>Név *</Label>
            <Input
              value={name}
              onChange={(e) => {
                const v = e.target.value;
                setName(v);
                if (!isEdit && !keyTouched) setNaturalKey(suggestSupplyNaturalKey(v));
              }}
              required
            />
          </div>
          {!isEdit && (
            <div>
              <Label>Belső kulcs</Label>
              <Input
                value={naturalKey}
                onChange={(e) => {
                  setKeyTouched(true);
                  setNaturalKey(e.target.value);
                }}
                placeholder="supply:..."
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Egyedi azonosító. Üresen hagyva a névből képződik.
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Kategória</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div>
              <Label>Mértékegység *</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Specifikáció</Label>
              <Input
                value={specification}
                onChange={(e) => setSpecification(e.target.value)}
                placeholder="pl. 1,0 mm"
              />
            </div>
            <div>
              <Label>Kiszerelés</Label>
              <Input
                value={packaging}
                onChange={(e) => setPackaging(e.target.value)}
                placeholder="pl. 15 kg-os tekercs"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Minimum készlet</Label>
              <Input value={minStock} onChange={(e) => setMinStock(e.target.value)} inputMode="numeric" />
            </div>
            {!isEdit && (
              <div>
                <Label>Induló készlet</Label>
                <Input
                  value={initialStock}
                  onChange={(e) => setInitialStock(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            )}
          </div>
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label>Eladható</Label>
              <Switch checked={isSellable} onCheckedChange={setIsSellable} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label>Bérbe adható</Label>
              <Switch checked={isRentable} onCheckedChange={setIsRentable} />
            </div>
            {isEdit && (
              <div className="flex items-center justify-between gap-3">
                <Label>Aktív</Label>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            )}
          </div>
          <div>
            <Label>Megjegyzés</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            {isEdit && product?.is_active && (
              <Button
                type="button"
                variant="destructive"
                className="sm:mr-auto"
                disabled={busy}
                onClick={async () => {
                  if (!confirm(`Inaktiválod: ${product.name}?`)) return;
                  setBusy(true);
                  try {
                    await deactivateSupplyProduct(product.id);
                    toast.success("Tétel inaktiválva");
                    await onSuccess();
                  } catch (err) {
                    toast.error((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Inaktiválás
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Mégse
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Mentés…" : isEdit ? "Mentés" : "Létrehozás"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PriceDialog({
  product,
  onClose,
  busy,
  setBusy,
  onSuccess,
}: {
  product: SupplyProduct | null;
  onClose: () => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onSuccess: () => Promise<void>;
}) {
  const { organization } = useAuth();
  const vatOn = isVatRegistered(organization?.settings);
  const [mode, setMode] = useState<"profit" | "margin" | "manual">("profit");
  const [purchase, setPurchase] = useState("");
  const [profitFt, setProfitFt] = useState("");
  const [marginPct, setMarginPct] = useState("");
  const [sale, setSale] = useState("");
  const [vat, setVat] = useState("27");

  const purchaseNum = parseSupplyPriceInput(purchase);
  const saleNum = parseSupplyPriceInput(sale);
  const vatNum = vatOn
    ? (parseSupplyPriceInput(vat) ?? getTaxSettings(organization?.settings).default_rate)
    : 0;

  const computedSale = useMemo(() => {
    if (mode === "profit" && purchaseNum != null && parseSupplyPriceInput(profitFt) != null) {
      return salePriceFromProfitFt(purchaseNum, parseSupplyPriceInput(profitFt)!);
    }
    if (mode === "margin" && purchaseNum != null && parseSupplyPriceInput(marginPct) != null) {
      return salePriceFromMarginPercent(purchaseNum, parseSupplyPriceInput(marginPct)!);
    }
    return saleNum;
  }, [mode, purchaseNum, profitFt, marginPct, saleNum]);

  const summary = useMemo(() => {
    if (computedSale == null || computedSale <= 0) return null;
    const p = purchaseNum;
    const prof = profitPerUnit(p, computedSale);
    const m = marginPercent(p, computedSale);
    const gross = grossFromNet(computedSale, vatNum);
    return { prof, m, gross };
  }, [computedSale, purchaseNum, vatNum]);

  function resetFromProduct(p: SupplyProduct) {
    setPurchase(p.purchase_price != null ? String(p.purchase_price) : "");
    setSale(p.sale_price != null ? String(p.sale_price) : "");
    setVat(String(vatOn ? p.vat_rate || getTaxSettings(organization?.settings).default_rate : 0));
    setProfitFt("");
    setMarginPct("");
    setMode("manual");
  }

  useEffect(() => {
    if (product) resetFromProduct(product);
  }, [product?.id, vatOn]);

  return (
    <Dialog
      open={product != null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ár beállítása</DialogTitle>
          <DialogDescription>
            {product?.name}
            <span className="mt-1 block text-xs">{priceBasisHint(organization?.settings)}</span>
          </DialogDescription>
        </DialogHeader>
        {product && (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (purchaseNum != null && purchaseNum < 0) {
                toast.error("A beszerzési ár nem lehet negatív");
                return;
              }
              if (computedSale == null || computedSale <= 0) {
                toast.error(
                  isVatRegistered(organization?.settings)
                    ? "Érvényes eladási nettó árat adj meg"
                    : "Érvényes eladási árat adj meg",
                );
                return;
              }
              setBusy(true);
              try {
                await updateSupplyProductPrices({
                  productId: product.id,
                  purchasePrice: purchaseNum,
                  salePrice: computedSale,
                  vatRate: vatNum,
                });
                toast.success("Ár mentve");
                await onSuccess();
              } catch (err) {
                toast.error((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div>
              <Label>{priceFieldLabel(organization?.settings, "purchase")}</Label>
              <Input value={purchase} onChange={(e) => setPurchase(e.target.value)} inputMode="numeric" />
            </div>
            <div>
              <Label>Számítás módja</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="profit">Beszerzés + haszon (Ft)</SelectItem>
                  <SelectItem value="margin">Beszerzés + árrés (%)</SelectItem>
                  <SelectItem value="manual">Kézi eladási ár</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mode === "profit" && (
              <div>
                <Label>Kívánt haszon (Ft / egység)</Label>
                <Input value={profitFt} onChange={(e) => setProfitFt(e.target.value)} inputMode="numeric" />
              </div>
            )}
            {mode === "margin" && (
              <div>
                <Label>Kívánt árrés (%)</Label>
                <Input value={marginPct} onChange={(e) => setMarginPct(e.target.value)} inputMode="decimal" />
              </div>
            )}
            {mode === "manual" && (
              <div>
                <Label>{priceFieldLabel(organization?.settings, "sale")}</Label>
                <Input value={sale} onChange={(e) => setSale(e.target.value)} inputMode="numeric" />
              </div>
            )}
            {vatOn && (
              <div>
                <Label>ÁFA (%)</Label>
                <Input value={vat} onChange={(e) => setVat(e.target.value)} inputMode="numeric" />
              </div>
            )}
            {computedSale != null && (
              <Card className="bg-muted/40 p-3 text-sm">
                <div className="font-medium">Összefoglaló</div>
                <div className="mt-1 grid gap-1 text-xs">
                  <span>Beszerzés: {formatSupplyHuf(purchaseNum)}</span>
                  <span>Eladás{vatOn ? " nettó" : ""}: {formatSupplyHuf(computedSale)}</span>
                  {vatOn && (
                    <>
                      <span>ÁFA: {vatNum}%</span>
                      <span>Eladási bruttó: {formatSupplyHuf(summary?.gross ?? null)}</span>
                    </>
                  )}
                  <span>Haszon: {formatSupplyHuf(summary?.prof ?? null)}</span>
                  <span>Árrés: {formatMarginPercent(summary?.m ?? null)}</span>
                </div>
              </Card>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Mégse
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Mentés…" : "Ár mentése"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReceiveDialog({
  product,
  suppliers,
  onClose,
  busy,
  setBusy,
  onSuccess,
}: {
  product: SupplyProduct | null;
  suppliers: SupplierRow[];
  onClose: () => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onSuccess: () => Promise<void>;
}) {
  const [qty, setQty] = useState("1");
  const [purchase, setPurchase] = useState("");
  const [updatePurchase, setUpdatePurchase] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [docNo, setDocNo] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  const purchaseNum = parseSupplyPriceInput(purchase);
  const profitHint =
    product && product.sale_price != null && purchaseNum != null
      ? profitPerUnit(purchaseNum, product.sale_price)
      : null;

  return (
    <Dialog open={product != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bevételezés</DialogTitle>
          <DialogDescription>{product?.name}</DialogDescription>
        </DialogHeader>
        {product && (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              let quantity: number;
              try {
                quantity = parsePositiveInt(qty);
              } catch (err) {
                toast.error((err as Error).message);
                return;
              }
              if (updatePurchase && purchaseNum != null && purchaseNum < 0) {
                toast.error("A beszerzési ár nem lehet negatív");
                return;
              }
              setBusy(true);
              try {
                await receiveSupplyStock({
                  productId: product.id,
                  quantity,
                  purchasePrice: updatePurchase ? purchaseNum : undefined,
                  supplierId: supplierId || undefined,
                  documentNumber: docNo || undefined,
                  purchaseDate: date || undefined,
                  note: note || undefined,
                });
                toast.success("Bevételezés rögzítve");
                await onSuccess();
              } catch (err) {
                toast.error((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div>
              <Label>Mennyiség ({product.unit_of_measure})</Label>
              <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" />
            </div>
            <div>
              <Label>Beszerzési nettó egységár (Ft)</Label>
              <Input value={purchase} onChange={(e) => setPurchase(e.target.value)} inputMode="numeric" />
              <label className="mt-1 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={updatePurchase}
                  onChange={(e) => setUpdatePurchase(e.target.checked)}
                />
                Termék beszerzési árának frissítése
              </label>
            </div>
            {profitHint != null && product.sale_price != null && (
              <p className="text-xs text-muted-foreground">
                Jelenlegi eladási ár mellett haszon: {formatSupplyHuf(profitHint)} / {product.unit_of_measure}
              </p>
            )}
            <div>
              <Label>Beszállító (opcionális)</Label>
              <Select value={supplierId || "_none"} onValueChange={(v) => setSupplierId(v === "_none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">—</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Bizonylatszám</Label>
              <Input value={docNo} onChange={(e) => setDocNo(e.target.value)} />
            </div>
            <div>
              <Label>Vásárlás dátuma</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Megjegyzés</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Mégse
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Mentés…" : "Bevételezés"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuickSaleDialog({
  open,
  onOpenChange,
  products,
  partners,
  busy,
  setBusy,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: SupplyProduct[];
  partners: PartnerRow[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  onSuccess: () => Promise<void>;
}) {
  const { organization } = useAuth();
  const vatOn = isVatRegistered(organization?.settings);
  const [partnerId, setPartnerId] = useState("");
  const [lines, setLines] = useState<SupplySaleLineInput[]>([]);
  const [note, setNote] = useState("");
  const [confirmNoPurchase, setConfirmNoPurchase] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const missingSalePrice = lines.some((line) => {
    const p = products.find((x) => x.id === line.product_id);
    return p != null && p.sale_price == null && line.unit_price == null;
  });
  const missingPurchase = lines.some((line) => {
    const p = products.find((x) => x.id === line.product_id);
    return p != null && p.purchase_price == null;
  });

  const totals = useMemo(() => {
    let net = 0;
    let vat = 0;
    let gross = 0;
    let purchase = 0;
    let profit = 0;
    for (const line of lines) {
      const p = products.find((x) => x.id === line.product_id);
      if (!p) continue;
      const unit = line.unit_price ?? p.sale_price;
      if (unit == null) continue;
      const t = lineTotals(unit, line.quantity, effectiveVatRate(organization?.settings, p.vat_rate));
      const lp = lineProfit(p.purchase_price, unit, line.quantity);
      net += t.net;
      vat += t.vat;
      gross += t.gross;
      if (lp.linePurchaseValue != null) purchase += lp.linePurchaseValue;
      if (lp.lineProfit != null) profit += lp.lineProfit;
    }
    return { net, vat, gross, purchase, profit };
  }, [lines, products, organization?.settings]);

  function addLine(productId: string) {
    if (lines.some((l) => l.product_id === productId)) return;
    setLines((prev) => [...prev, { product_id: productId, quantity: 1 }]);
  }

  function updateLine(productId: string, patch: Partial<SupplySaleLineInput>) {
    setLines((prev) => prev.map((l) => (l.product_id === productId ? { ...l, ...patch } : l)));
  }

  function removeLine(productId: string) {
    setLines((prev) => prev.filter((l) => l.product_id !== productId));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gyors értékesítés</DialogTitle>
          <DialogDescription>Partner és termékek kiválasztása</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!partnerId) {
              toast.error("Partner megadása kötelező");
              return;
            }
            if (lines.length === 0) {
              toast.error("Legalább egy termék szükséges");
              return;
            }
            for (const line of lines) {
              const p = products.find((x) => x.id === line.product_id);
              if (!p) continue;
              if (line.quantity <= 0) {
                toast.error("Minden mennyiségnek pozitívnak kell lennie");
                return;
              }
              if (p.current_stock != null && line.quantity > p.current_stock) {
                toast.error(
                  `Nincs elegendő készlet (${p.name}): elérhető ${p.current_stock} ${p.unit_of_measure}`,
                );
                return;
              }
              if (p.sale_price == null && line.unit_price == null) {
                toast.error(`Eladási ár beállítása szükséges: ${p.name}`);
                return;
              }
            }
            if (missingPurchase && !confirmNoPurchase) {
              toast.error("Erősítsd meg az értékesítést beszerzési ár nélkül");
              return;
            }
            setBusy(true);
            try {
              await recordSupplySaleBatch({
                partnerId,
                items: lines,
                note: note || undefined,
                idempotencyKey,
              });
              toast.success("Értékesítés rögzítve");
              setLines([]);
              setPartnerId("");
              setNote("");
              setConfirmNoPurchase(false);
              await onSuccess();
            } catch (err) {
              toast.error((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <Label>Partner *</Label>
            <Select value={partnerId || "_none"} onValueChange={(v) => setPartnerId(v === "_none" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Válassz partnert" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">—</SelectItem>
                {partners.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {partnerDisplayName(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Termék hozzáadása</Label>
            <Select
              value="_add"
              onValueChange={(v) => {
                if (v !== "_add") addLine(v);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Válassz terméket" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_add">—</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.current_stock ?? 0} {p.unit_of_measure})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {lines.map((line) => {
            const p = products.find((x) => x.id === line.product_id)!;
            const unit = line.unit_price ?? p.sale_price ?? 0;
            const t =
              p.sale_price != null
                ? lineTotals(unit, line.quantity, effectiveVatRate(organization?.settings, p.vat_rate))
                : null;
            const lp = lineProfit(p.purchase_price, unit, line.quantity);
            return (
              <Card key={line.product_id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium">{p.name}</div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeLine(line.product_id)}>
                    ✕
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Mennyiség</Label>
                    <Input
                      value={String(line.quantity)}
                      onChange={(e) => {
                        try {
                          updateLine(line.product_id, { quantity: parsePositiveInt(e.target.value) });
                        } catch {
                          updateLine(line.product_id, { quantity: 0 });
                        }
                      }}
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{priceFieldLabel(organization?.settings, "unit")}</Label>
                    <Input
                      value={line.unit_price != null ? String(line.unit_price) : p.sale_price != null ? String(p.sale_price) : ""}
                      onChange={(e) => {
                        const v = parseSupplyPriceInput(e.target.value);
                        updateLine(line.product_id, { unit_price: v ?? undefined });
                      }}
                      inputMode="numeric"
                      placeholder={p.sale_price != null ? String(p.sale_price) : "Ár szükséges"}
                    />
                  </div>
                </div>
                {p.sale_price == null && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                    <AlertTriangle className="h-3 w-3" />
                    Eladási ár beállítása szükséges
                  </p>
                )}
                {p.purchase_price == null && (
                  <p className="mt-1 text-xs text-amber-700">Beszerzési ár nincs megadva – haszon nem számítható</p>
                )}
                {t && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {vatOn ? (
                      <>
                        Nettó: {formatSupplyHuf(t.net)} · Bruttó: {formatSupplyHuf(t.gross)}
                      </>
                    ) : (
                      <>Összeg: {formatSupplyHuf(t.net)}</>
                    )}
                    {" · "}Haszon: {formatSupplyHuf(lp.lineProfit)}
                  </div>
                )}
              </Card>
            );
          })}

          {missingPurchase && lines.length > 0 && (
            <label className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
              <input
                type="checkbox"
                checked={confirmNoPurchase}
                onChange={(e) => setConfirmNoPurchase(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Egyes termékeknél nincs beszerzési ár – az értékesítés engedélyezése haszon számítás nélkül.
              </span>
            </label>
          )}

          {lines.length > 0 && (
            <Card className="bg-muted/40 p-3 text-sm">
              <div className="font-medium">Összesen</div>
              <div className="mt-1 grid gap-1 text-xs">
                {vatOn ? (
                  <>
                    <span>Nettó: {formatSupplyHuf(totals.net)}</span>
                    <span>ÁFA: {formatSupplyHuf(totals.vat)}</span>
                    <span>Bruttó: {formatSupplyHuf(totals.gross)}</span>
                  </>
                ) : (
                  <span>Összeg: {formatSupplyHuf(totals.net)}</span>
                )}
                <span>Beszerzési érték: {formatSupplyHuf(totals.purchase || null)}</span>
                <span>Teljes haszon: {formatSupplyHuf(totals.profit || null)}</span>
              </div>
            </Card>
          )}

          <div>
            <Label>Megjegyzés</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Mégse
            </Button>
            <Button type="submit" disabled={busy || missingSalePrice}>
              {busy ? "Mentés…" : "Értékesítés mentése"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProductDetailSheet({
  product,
  onClose,
}: {
  product: SupplyProduct | null;
  onClose: () => void;
}) {
  const movementsQuery = useQuery({
    queryKey: ["supply-movements", product?.id],
    queryFn: () => fetchSupplyMovements(product!.id),
    enabled: !!product,
  });

  return (
    <Sheet open={product != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{product?.name}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-2">
          {movementsQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Mozgások betöltése…</p>
          )}
          {(movementsQuery.data ?? []).map((m) => (
            <Card key={m.id} className="p-2 text-xs">
              <div className="font-medium">
                {SUPPLY_MOVEMENT_LABELS[m.movement_type] ?? m.movement_type}
              </div>
              <div className="text-muted-foreground">
                {new Date(m.created_at).toLocaleString("hu-HU")}
              </div>
              <div>
                {m.quantity} db · {m.stock_before} → {m.stock_after}
              </div>
              {m.unit_price != null && <div>Egységár: {formatSupplyHuf(m.unit_price)}</div>}
              {m.note && <div className="mt-1 italic">{m.note}</div>}
            </Card>
          ))}
          {!movementsQuery.isLoading && (movementsQuery.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Nincs mozgás.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SaleDetailDialog({ sale, onClose }: { sale: SupplySale | null; onClose: () => void }) {
  const { organization } = useAuth();
  const vatOn = isVatRegistered(organization?.settings);
  return (
    <Dialog open={sale != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Értékesítés részletei</DialogTitle>
          <DialogDescription>
            {sale?.partner ? partnerDisplayName(sale.partner) : ""} ·{" "}
            {sale && new Date(sale.created_at).toLocaleString("hu-HU")}
          </DialogDescription>
        </DialogHeader>
        {sale && (
          <div className="space-y-3">
            {(sale.items ?? []).map((item) => (
              <Card key={item.id} className="p-3 text-sm">
                <div className="font-medium">{item.product_name ?? "Termék"}</div>
                <div className="text-xs text-muted-foreground">
                  {[item.specification, item.packaging].filter(Boolean).join(" · ")}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                  <span>
                    {item.quantity} {item.unit_of_measure}
                  </span>
                  <span>Eladás: {formatSupplyHuf(item.unit_price)}</span>
                  <span>Beszerzés: {formatSupplyHuf(item.purchase_unit_price)}</span>
                  <span>Haszon: {formatSupplyHuf(item.line_profit)}</span>
                  <span>Árrés: {formatMarginPercent(item.margin_percent)}</span>
                  {vatOn && <span>Bruttó: {formatSupplyHuf(item.line_gross)}</span>}
                </div>
              </Card>
            ))}
            <Card className="bg-muted/40 p-3 text-xs">
              {vatOn ? (
                <>
                  <div>Nettó összesen: {formatSupplyHuf(sale.total_net)}</div>
                  <div>Bruttó összesen: {formatSupplyHuf(sale.total_gross)}</div>
                </>
              ) : (
                <div>Összeg: {formatSupplyHuf(sale.total_net)}</div>
              )}
              <div>Beszerzési érték: {formatSupplyHuf(sale.total_purchase_value)}</div>
              <div>Teljes haszon: {formatSupplyHuf(sale.total_profit)}</div>
              {sale.note && <div className="mt-1 italic">{sale.note}</div>}
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
