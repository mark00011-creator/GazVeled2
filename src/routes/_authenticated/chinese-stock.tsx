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
import { GAS_TYPES, getAvailableSizes } from "@/lib/gas-cylinder-form";
import {
  adjustChineseStock,
  CHINESE_MOVEMENT_LABELS,
  CHINESE_UI_MOVEMENTS,
  chineseStockLabel,
  fetchChineseStock,
  parseStockQuantityInput,
  type ChineseMovementType,
} from "@/lib/chinese-stock";

export const Route = createFileRoute("/_authenticated/chinese-stock")({
  head: () => ({ meta: [{ title: "Kínai készlet – Gáz Veled" }] }),
  component: ChineseStockPage,
});

function ChineseStockPage() {
  const qc = useQueryClient();
  const [gasType, setGasType] = useState("Széndioxid");
  const [size, setSize] = useState("5 kg");
  const [quantity, setQuantity] = useState("1");
  const [movementType, setMovementType] = useState<ChineseMovementType>("purchase");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const sizes = getAvailableSizes(gasType);

  const {
    data: stock = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["chinese-stock"],
    queryFn: fetchChineseStock,
  });

  async function handleMovement(e: React.FormEvent) {
    e.preventDefault();
    let qty: number;
    try {
      qty = parseStockQuantityInput(quantity);
    } catch (err) {
      toast.error((err as Error).message);
      return;
    }
    setBusy(true);
    try {
      await adjustChineseStock({
        gas_type: gasType,
        size,
        movement_type: movementType,
        quantity: qty,
        note: note.trim() || undefined,
      });
      await qc.invalidateQueries({ queryKey: ["chinese-stock"] });
      await qc.invalidateQueries({ queryKey: ["chinese-empty-summary"] });
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
    <AppShell title="Kínai készlet">
      <p className="mb-4 text-sm text-muted-foreground">
        Kínai palackok darabszám alapú készlete. Nem sorszámozott — csak teli/üres darabszám.
      </p>

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold">Készletmozgás</h2>
        <form onSubmit={handleMovement} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Gáz</Label>
              <Select
                value={gasType}
                onValueChange={(v) => {
                  setGasType(v);
                  setSize(getAvailableSizes(v)[0] ?? "20 L");
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Mozgás típusa</Label>
              <Select
                value={movementType}
                onValueChange={(v) => setMovementType(v as ChineseMovementType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHINESE_UI_MOVEMENTS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {CHINESE_MOVEMENT_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Darabszám</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <Label>Megjegyzés (opcionális)</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            Rögzítés
          </Button>
        </form>
      </Card>

      {isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Betöltés…</div>}
      {isError && (
        <div className="py-8 text-center text-sm text-destructive">
          Készlet betöltése sikertelen
        </div>
      )}

      {!isLoading && !isError && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Boxes className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Aktuális készlet</h2>
          </div>
          {visibleStock.length === 0 ? (
            <div className="text-sm text-muted-foreground">Még nincs kínai készlet rögzítve.</div>
          ) : (
            <ul className="space-y-2 text-sm">
              {visibleStock.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <span className="font-medium">{chineseStockLabel(row.gas_type, row.size)}</span>
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
