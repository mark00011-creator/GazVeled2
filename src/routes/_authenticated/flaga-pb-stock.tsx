import { createFileRoute } from "@tanstack/react-router";
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
import { Boxes } from "lucide-react";
import { toast } from "sonner";
import {
  adjustFlagaPbStock,
  FLAGA_PB_CATALOG,
  flagaPbProductKey,
  flagaPbStockLabel,
  fetchFlagaPbStock,
  PB_MOVEMENT_LABELS,
  type PbMovementType,
} from "@/lib/flaga-pb-stock";

export const Route = createFileRoute("/_authenticated/flaga-pb-stock")({
  head: () => ({ meta: [{ title: "FLAGA PB készlet – Gáz Veled" }] }),
  component: FlagaPbStockPage,
});

function FlagaPbStockPage() {
  const qc = useQueryClient();
  const [productKey, setProductKey] = useState(flagaPbProductKey(FLAGA_PB_CATALOG[0].gas_type, FLAGA_PB_CATALOG[0].size));
  const [quantity, setQuantity] = useState("1");
  const [movementType, setMovementType] = useState<PbMovementType>("purchase");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const selected =
    FLAGA_PB_CATALOG.find((i) => flagaPbProductKey(i.gas_type, i.size) === productKey) ??
    FLAGA_PB_CATALOG[0];

  const { data: stock = [], isLoading, isError } = useQuery({
    queryKey: ["flaga-pb-stock"],
    queryFn: fetchFlagaPbStock,
  });

  async function handleMovement(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Érvényes darabszámot adj meg");
      return;
    }
    if (movementType === "adjustment" && !note.trim()) {
      toast.error("Korrekciónál megjegyzés kötelező");
      return;
    }
    setBusy(true);
    try {
      await adjustFlagaPbStock({
        gas_type: selected.gas_type,
        size: selected.size,
        movement_type: movementType,
        quantity: qty,
        note: note.trim() || undefined,
      });
      await qc.invalidateQueries({ queryKey: ["flaga-pb-stock"] });
      await qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Készlet frissítve");
      setNote("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const visibleStock = stock.filter((r) => r.full_count > 0 || r.empty_count > 0);

  return (
    <AppShell title="FLAGA PB készlet">
      <p className="mb-4 text-sm text-muted-foreground">
        FLAGA PB körforgásos palackok darabszám alapú készlete. Nem sorszámozott.
      </p>

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold">Készletmozgás</h2>
        <form onSubmit={handleMovement} className="space-y-3">
          <div>
            <Label>Tétel</Label>
            <Select value={productKey} onValueChange={setProductKey}>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Mozgás típusa</Label>
              <Select value={movementType} onValueChange={(v) => setMovementType(v as PbMovementType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PB_MOVEMENT_LABELS) as PbMovementType[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {PB_MOVEMENT_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Darabszám</Label>
              <Input type="number" min={1} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
            </div>
          </div>
          <div>
            <Label>Megjegyzés {movementType === "adjustment" ? "(kötelező)" : "(opcionális)"}</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            Rögzítés
          </Button>
        </form>
      </Card>

      {isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Betöltés…</div>}
      {isError && <div className="py-8 text-center text-sm text-destructive">Készlet betöltése sikertelen</div>}

      {!isLoading && !isError && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Boxes className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Aktuális készlet</h2>
          </div>
          {visibleStock.length === 0 ? (
            <div className="text-sm text-muted-foreground">Még nincs FLAGA PB készlet rögzítve.</div>
          ) : (
            <ul className="space-y-2 text-sm">
              {visibleStock.map((row) => (
                <li key={row.id} className="flex items-center justify-between rounded-lg border p-3">
                  <span className="font-medium">{flagaPbStockLabel(row.gas_type, row.size)}</span>
                  <span className="text-muted-foreground">
                    Teli: <strong className="text-foreground">{row.full_count}</strong>
                    {" · "}
                    Üres: <strong className="text-foreground">{row.empty_count}</strong>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </AppShell>
  );
}
