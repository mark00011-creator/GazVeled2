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
  onYes: () => void;
  onNo: () => void;
};

/** Csere után: szállítólevél készítése? */
export function DeliveryNoteAskDialog({
  open,
  onOpenChange,
  partnerName,
  itemCount,
  onYes,
  onNo,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Szállítólevél?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {partnerName ? (
            <>
              <span className="font-medium text-foreground">{partnerName}</span>
              {" · "}
            </>
          ) : null}
          {itemCount} tétel – ADR / palackcsere bizonylat
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
