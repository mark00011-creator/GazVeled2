import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { FileDown, Plus, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { GAS_TYPES, getAvailableSizes } from "@/lib/gas-cylinder-form";
import { formatHuf } from "@/lib/gas-order-prices";
import { fetchProductPrices } from "@/lib/product-prices";
import { downloadQuotePdf, generateQuotePdf } from "@/lib/quote-pdf";
import {
  calcOfferPrice,
  deleteQuote,
  DISCOUNT_OPTIONS,
  draftFromPrice,
  fetchQuote,
  fetchQuotes,
  lookupBeszerzesiAr,
  nextQuoteNumber,
  quoteItemLabel,
  quoteTotal,
  saveQuote,
  type QuoteItemDraft,
} from "@/lib/quotes";
import { fmtDate } from "@/lib/labels";

export const Route = createFileRoute("/_authenticated/quotes")({
  head: () => ({ meta: [{ title: "Árajánlat – Gáz Veled" }] }),
  component: QuotesPage,
});

function QuotesPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState("");
  const [quoteNumber, setQuoteNumber] = useState("");
  const [quoteDate, setQuoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [items, setItems] = useState<QuoteItemDraft[]>([]);
  const [gasType, setGasType] = useState("Argon");
  const [size, setSize] = useState("20 L");
  const [quantity, setQuantity] = useState("1");
  const [discount, setDiscount] = useState<string>("0");
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [belowCostWarnings, setBelowCostWarnings] = useState<string[]>([]);

  const sizes = getAvailableSizes(gasType);

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ["quotes"],
    queryFn: fetchQuotes,
  });

  const { data: partners = [] } = useQuery({
    queryKey: ["partners-list"],
    queryFn: async () =>
      (await supabase.from("partners").select("id,name,company_name").order("name")).data ?? [],
  });

  const { data: priceRows = [] } = useQuery({
    queryKey: ["product-prices"],
    queryFn: () => fetchProductPrices(true),
  });

  function resetEditor() {
    setEditingId(null);
    setPartnerId("");
    setQuoteNumber(nextQuoteNumber(quotes));
    setQuoteDate(new Date().toISOString().slice(0, 10));
    setNote("");
    setItems([]);
    setBelowCostWarnings([]);
  }

  function startNew() {
    resetEditor();
    setQuoteNumber(nextQuoteNumber(quotes));
    setView("edit");
  }

  async function startEdit(id: string) {
    setBusy(true);
    try {
      const { quote, items: rows } = await fetchQuote(id);
      setEditingId(quote.id);
      setPartnerId(quote.partner_id);
      setQuoteNumber(quote.quote_number);
      setQuoteDate(quote.quote_date);
      setNote(quote.note ?? "");
      setItems(
        rows.map((r) => ({
          gas_type: r.gas_type,
          size: r.size,
          quantity: r.quantity,
          list_price: r.list_price,
          discount_percent: Number(r.discount_percent),
          unit_price: r.unit_price,
          is_custom_price: r.is_custom_price,
        })),
      );
      setView("edit");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addItem() {
    const qty = parseInt(quantity, 10);
    const disc = parseFloat(discount);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Érvényes mennyiség");
      return;
    }
    const draft = draftFromPrice(gasType, size, qty, priceRows, disc);
    if (!draft) {
      toast.error("Nincs eladási ár az árlistában ehhez a termékhez");
      return;
    }
    setItems((prev) => [...prev, draft]);
  }

  function updateItemPrice(index: number, unitPrice: number) {
    setItems((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, unit_price: Math.round(unitPrice), is_custom_price: true } : item,
      ),
    );
  }

  function updateItemDiscount(index: number, discountPercent: number) {
    setItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? {
              ...item,
              discount_percent: discountPercent,
              unit_price: calcOfferPrice(item.list_price, discountPercent),
              is_custom_price: false,
            }
          : item,
      ),
    );
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const total = useMemo(() => quoteTotal(items), [items]);

  async function handleSave() {
    if (!partnerId) {
      toast.error("Válassz partnert");
      return;
    }
    if (!quoteNumber.trim()) {
      toast.error("Add meg az árajánlat számát");
      return;
    }
    if (items.length === 0) {
      toast.error("Adj hozzá legalább egy tételt");
      return;
    }

    const warnings: string[] = [];
    for (const item of items) {
      const cost = await lookupBeszerzesiAr(item.gas_type, item.size, priceRows);
      if (cost != null && item.unit_price < cost) {
        warnings.push(
          `${quoteItemLabel(item)}: ajánlati ár (${formatHuf(item.unit_price)}) < beszerzési ár (${formatHuf(cost)})`,
        );
      }
    }
    setBelowCostWarnings(warnings);

    setBusy(true);
    try {
      const id = await saveQuote({
        id: editingId ?? undefined,
        partner_id: partnerId,
        quote_number: quoteNumber,
        quote_date: quoteDate,
        note,
        items,
      });
      await qc.invalidateQueries({ queryKey: ["quotes"] });
      toast.success(
        warnings.length > 0 ? "Mentve (figyelmeztetés: alacsony ár)" : "Árajánlat mentve",
      );
      setEditingId(id);
      if (warnings.length === 0) setView("list");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePdf() {
    if (!editingId) {
      toast.error("Előbb mentsd az árajánlatot");
      return;
    }
    setPdfBusy(true);
    try {
      const { quote, items: rows } = await fetchQuote(editingId);
      const bytes = await generateQuotePdf(quote, rows);
      downloadQuotePdf(bytes, `arajanlat-${quote.quote_number.replace(/\//g, "-")}.pdf`);
      toast.success("PDF letöltve");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPdfBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Törlöd az árajánlatot?")) return;
    try {
      await deleteQuote(id);
      await qc.invalidateQueries({ queryKey: ["quotes"] });
      toast.success("Törölve");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (view === "edit") {
    return (
      <AppShell title="Árajánlat">
        <Button variant="ghost" size="sm" className="mb-3" onClick={() => setView("list")}>
          ← Vissza a listához
        </Button>

        <Card className="mb-4 space-y-3 p-4">
          <div>
            <Label>Partner</Label>
            <Select value={partnerId} onValueChange={setPartnerId}>
              <SelectTrigger>
                <SelectValue placeholder="Válassz partnert" />
              </SelectTrigger>
              <SelectContent>
                {partners.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.company_name || p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Árajánlat szám</Label>
              <Input value={quoteNumber} onChange={(e) => setQuoteNumber(e.target.value)} />
            </div>
            <div>
              <Label>Dátum</Label>
              <Input type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Megjegyzés</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </Card>

        <Card className="mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold">Új tétel</h2>
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
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <Label>Mennyiség</Label>
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div>
              <Label>Kedvezmény</Label>
              <Select value={discount} onValueChange={setDiscount}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISCOUNT_OPTIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d === 0 ? "0%" : `${d}%`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="button" onClick={addItem} className="w-full">
                <Plus className="mr-2 h-4 w-4" /> Hozzáadás
              </Button>
            </div>
          </div>
        </Card>

        {items.length > 0 && (
          <Card className="mb-4 overflow-hidden">
            <div className="border-b px-4 py-3 text-sm font-semibold">Tételek</div>
            <ul className="divide-y">
              {items.map((item, i) => (
                <li key={i} className="space-y-2 px-4 py-3 text-sm">
                  <div className="font-medium">
                    {quoteItemLabel(item)} × {item.quantity} db
                  </div>
                  {item.discount_percent > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      Listaár: {formatHuf(item.list_price)} · Kedvezmény: {item.discount_percent}% ·
                      Ajánlati ár: {formatHuf(item.unit_price)}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Ajánlati ár: {formatHuf(item.unit_price)}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Select
                      value={String(item.discount_percent)}
                      onValueChange={(v) => updateItemDiscount(i, parseFloat(v))}
                    >
                      <SelectTrigger className="w-[100px] h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DISCOUNT_OPTIONS.map((d) => (
                          <SelectItem key={d} value={String(d)}>
                            {d}%
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      className="h-8 w-28"
                      value={item.unit_price}
                      onChange={(e) => updateItemPrice(i, Number(e.target.value))}
                    />
                    <Button type="button" size="icon" variant="ghost" onClick={() => removeItem(i)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t px-4 py-3 text-right font-semibold">
              Összesen: {formatHuf(total)}
            </div>
          </Card>
        )}

        {belowCostWarnings.length > 0 && (
          <Card className="mb-4 border-warning/50 bg-warning/10 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning">
              <AlertTriangle className="h-4 w-4" /> Alacsony ajánlati ár
            </div>
            <ul className="space-y-1 text-xs">
              {belowCostWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Card>
        )}

        <div className="flex flex-col gap-2">
          <Button size="lg" disabled={busy} onClick={handleSave}>
            Mentés
          </Button>
          {editingId && (
            <Button size="lg" variant="outline" disabled={pdfBusy} onClick={handlePdf}>
              <FileDown className="mr-2 h-5 w-5" /> PDF export
            </Button>
          )}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Árajánlat">
      <Button className="mb-4" onClick={startNew}>
        <Plus className="mr-2 h-4 w-4" /> Új árajánlat
      </Button>

      {isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Betöltés…</div>}

      {!isLoading && quotes.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">Még nincs árajánlat.</div>
      )}

      <ul className="space-y-2">
        {quotes.map((q) => (
          <li key={q.id}>
            <Card className="flex items-center gap-3 p-3">
              <div className="flex-1">
                <div className="font-medium">{q.quote_number}</div>
                <div className="text-xs text-muted-foreground">
                  {q.partners?.company_name || q.partners?.name} · {fmtDate(q.quote_date)}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => startEdit(q.id)}>
                Szerkesztés
              </Button>
              <Button size="icon" variant="ghost" onClick={() => handleDelete(q.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </Card>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
