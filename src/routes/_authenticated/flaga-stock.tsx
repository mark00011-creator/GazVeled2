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
  adjustFlagaStock,
  FLAGA_GAS_TYPES,
  FLAGA_MOVEMENT_LABELS,
  flagaStockLabel,
  fetchFlagaStock,
  getFlagaSizes,
  type FlagaMovementType,
} from "@/lib/flaga-stock";

export const Route = createFileRoute("/_authenticated/flaga-stock")({
  head: () => ({ meta: [{ title: "FLAGA készlet – Gáz Veled" }] }),
  component: FlagaStockPage,
});

function FlagaStockPage() {
  const qc = useQueryClient();
  const [gasType, setGasType] = useState<string>(FLAGA_GAS_TYPES[0]);
  const [size, setSize] = useState(getFlagaSizes(FLAGA_GAS_TYPES[0])[0] ?? "11 kg");
  const [quantity, setQuantity] = useState("1");
  const [movementType, setMovementType] = useState<FlagaMovementType>("purchase");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const sizes = getFlagaSizes(gasType);

  const {
    data: stock = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["flaga-stock"],
    queryFn: fetchFlagaStock,
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
      await adjustFlagaStock({
        gas_type: gasType,
        size,
        movement_type: movementType,
        quantity: qty,
        note: note.trim() || undefined,
      });
      await qc.invalidateQueries({ queryKey: ["flaga-stock"] });
      await qc.invalidateQueries({ queryKey: ["flaga-empty-summary"] });
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
    <AppShell title="FLAGA készlet">
      <p className="mb-4 text-sm text-muted-foreground">
        FLAGA palackok darabszám alapú készlete. Nem sorszámozott — csak teli/üres darabszám.
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
                  setSize(getFlagaSizes(v)[0] ?? "11 kg");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FLAGA_GAS_TYPES.map((g) => (
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
                onValueChange={(v) => setMovementType(v as FlagaMovementType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(FLAGA_MOVEMENT_LABELS) as FlagaMovementType[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {FLAGA_MOVEMENT_LABELS[k]}
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
            <Label>Megjegyzés {movementType === "adjustment" ? "(kötelező)" : "(opcionális)"}</Label>
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
            <div className="text-sm text-muted-foreground">Még nincs FLAGA készlet rögzítve.</div>
          ) : (
            <ul className="space-y-2 text-sm">
              {visibleStock.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <span className="font-medium">{flagaStockLabel(row.gas_type, row.size)}</span>
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
