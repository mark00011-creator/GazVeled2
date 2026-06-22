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
  adjustPrimaPbStock,
  PRIMA_PB_CATALOG,
  primaPbStockLabel,
  fetchPrimaPbStock,
  PB_MOVEMENT_LABELS,
  type PbMovementType,
} from "@/lib/prima-pb-stock";

export const Route = createFileRoute("/_authenticated/prima-pb-stock")({
  head: () => ({ meta: [{ title: "PRÍMA PB készlet – Gáz Veled" }] }),
  component: PrimaPbStockPage,
});

function PrimaPbStockPage() {
  const qc = useQueryClient();
  const item = PRIMA_PB_CATALOG[0];
  const [quantity, setQuantity] = useState("1");
  const [movementType, setMovementType] = useState<PbMovementType>("purchase");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: stock = [], isLoading, isError } = useQuery({
    queryKey: ["prima-pb-stock"],
    queryFn: fetchPrimaPbStock,
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
      await adjustPrimaPbStock({
        gas_type: item.gas_type,
        size: item.size,
        movement_type: movementType,
        quantity: qty,
        note: note.trim() || undefined,
      });
      await qc.invalidateQueries({ queryKey: ["prima-pb-stock"] });
      await qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Készlet frissítve");
      setNote("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const row = stock[0];
  const visible = row && (row.full_count > 0 || row.empty_count > 0);

  return (
    <AppShell title="PRÍMA PB készlet">
      <p className="mb-4 text-sm text-muted-foreground">
        PRÍMA PB körforgásos palack darabszám alapú készlete. Nem sorszámozott.
      </p>

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold">Készletmozgás – {primaPbStockLabel(item.gas_type, item.size)}</h2>
        <form onSubmit={handleMovement} className="space-y-3">
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
          {!visible ? (
            <div className="text-sm text-muted-foreground">Még nincs PRÍMA PB készlet rögzítve.</div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
              <span className="font-medium">{primaPbStockLabel(row.gas_type, row.size)}</span>
              <span className="text-muted-foreground">
                Teli: <strong className="text-foreground">{row.full_count}</strong>
                {" · "}
                Üres: <strong className="text-foreground">{row.empty_count}</strong>
              </span>
            </div>
          )}
        </Card>
      )}
    </AppShell>
  );
}
