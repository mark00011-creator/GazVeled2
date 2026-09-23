import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partnerName?: string;
  itemCount: number;
  totalSaleValue: number;
  formatMoney: (n: number) => string;
  onYes: () => void;
  onNo: () => void;
};

/** Csere után: „Számlázzam?” – igen → előnézet, nem → queue. */
export function InvoiceAskDialog({
  open,
  onOpenChange,
  partnerName,
  itemCount,
  totalSaleValue,
  formatMoney,
  onYes,
  onNo,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Számlázzam?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {partnerName ? (
            <>
              <span className="font-medium text-foreground">{partnerName}</span>
              {" · "}
            </>
          ) : null}
          {itemCount} tétel · {formatMoney(totalSaleValue)}
        </p>
        <p className="text-xs text-muted-foreground">
          Igen: előnézet, majd te véglegesíted a számlát. Nem: megjegyezzük
          számlázatlanul.
        </p>
        <DialogFooter className="grid grid-cols-2 gap-2 sm:space-x-0">
          <Button
            variant="outline"
            onClick={() => {
              onNo();
              onOpenChange(false);
            }}
          >
            Nem
          </Button>
          <Button
            onClick={() => {
              onYes();
              onOpenChange(false);
            }}
          >
            Igen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
