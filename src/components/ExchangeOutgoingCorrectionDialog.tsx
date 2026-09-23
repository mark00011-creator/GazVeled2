import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { formatSupabaseError } from "@/lib/supabase-error";
import { toast } from "sonner";

type Props = {
  exchangeId: string;
  wrongOutgoingLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ExchangeOutgoingCorrectionDialog({
  exchangeId,
  wrongOutgoingLabel,
  open,
  onOpenChange,
}: Props) {
  const qc = useQueryClient();
  const [barcode, setBarcode] = useState("");

  const correct = useMutation({
    mutationFn: async () => {
      const code = barcode.trim();
      if (!code) throw new Error("Add meg a helyes teli palack vonalkódját");

      const { data: cyl, error: cylErr } = await supabase
        .from("cylinders")
        .select("id, barcode, gas_type, size, status, location_type")
        .eq("barcode", code)
        .maybeSingle();
      if (cylErr) throw new Error(formatSupabaseError(cylErr, "Palack keresés"));
      if (!cyl) throw new Error("Nincs ilyen vonalkód");
      if (cyl.location_type !== "warehouse_full" || cyl.status !== "full") {
        throw new Error("A helyes palacknak teli kalodában, teli státusszal kell lennie");
      }

      const { error } = await supabase.rpc("correct_exchange_outgoing", {
        p_exchange_id: exchangeId,
        p_new_outgoing_id: cyl.id,
      });
      if (error) throw new Error(formatSupabaseError(error, "Kiadás javítása"));
      return cyl;
    },
    onSuccess: (cyl) => {
      toast.success(`Javítva: ${cyl.barcode} · ${cyl.gas_type} ${cyl.size}`);
      setBarcode("");
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["uninvoiced-exchanges"] });
      qc.invalidateQueries({ queryKey: ["cylinders"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Téves kiadás javítása</DialogTitle>
          <DialogDescription>
            A partnernél lévő téves teli palack visszakerül a teli kalodába, a megadott helyes
            palack pedig a partnerhez.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <span className="text-muted-foreground">Jelenlegi (téves) kiadás: </span>
            <span className="font-mono">{wrongOutgoingLabel}</span>
          </div>
          <div>
            <Label>Helyes teli palack vonalkódja</Label>
            <Input
              className="mt-1.5 font-mono"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="pl. 34831101368731"
              autoFocus
            />
          </div>
          <Button
            className="w-full"
            disabled={correct.isPending}
            onClick={() => correct.mutate()}
          >
            {correct.isPending ? "Javítás…" : "Kiadás javítása"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
