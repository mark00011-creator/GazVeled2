import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import { detectManufacturerFromBarcode } from "@/lib/barcode-manufacturer";
import {
  CIRCULATION_OPTIONS,
  parsePressureTestYearInput,
  SERIALIZED_MANUFACTURER_OPTIONS,
  type Circulation,
  type Manufacturer,
} from "@/lib/labels";
import {
  defaultNewCylinderForm,
  getAvailableSizes,
  GAS_TYPES,
  isNewCylinderFormValid,
  type NewCylinderFormState,
} from "@/lib/gas-cylinder-form";
import { PressureTestYearField, pressureTestYearSaveError } from "@/components/PressureTestYearField";
import { createNewCylinder, type CylinderRow } from "@/lib/cylinder-ops";

type LocType = "warehouse_full" | "warehouse_empty" | "customer" | "siad" | "own_supplier";

export function NewCylinderDialog({
  open,
  onOpenChange,
  barcode,
  barcodeEditable = false,
  status = "empty",
  locationType = "warehouse_empty",
  locationSupplierId = null,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  barcode: string;
  /** Manuális felvételnél (Palackok oldal) szerkeszthető vonalkód. */
  barcodeEditable?: boolean;
  status?: "full" | "empty";
  locationType?: LocType;
  locationSupplierId?: string | null;
  onCreated: (cyl: CylinderRow) => void | Promise<void>;
}) {
  const [form, setForm] = useState<NewCylinderFormState>(defaultNewCylinderForm(barcode));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm(defaultNewCylinderForm(barcode));
  }, [open, barcode]);

  const availableSizes = getAvailableSizes(form.gasType);

  async function save() {
    if (!isNewCylinderFormValid(form)) {
      toast.error("Töltsd ki a kötelező mezőket");
      return;
    }
    const yearErr = pressureTestYearSaveError(form.pressureTestYear);
    if (yearErr) {
      toast.error(yearErr);
      return;
    }
    setBusy(true);
    try {
      const cyl = await createNewCylinder({
        barcode: form.barcode,
        gas_type: form.gasType,
        size: form.size,
        circulation: form.owner,
        owner: form.owner,
        manufacturer: form.manufacturer,
        status,
        location_type: locationType,
        location_supplier_id: locationSupplierId,
        note: form.note.trim() || undefined,
        pressure_test_year: parsePressureTestYearInput(form.pressureTestYear),
      });
      toast.success("Új palack felvéve");
      await onCreated(cyl);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Új palack</DialogTitle>
          <DialogDescription>
            {barcodeEditable
              ? "Új palack manuális felvétele a nyilvántartásba."
              : "Ismeretlen vonalkód esetén új palack adatainak megadása."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Vonalkód</Label>
            <Input
              value={form.barcode}
              disabled={!barcodeEditable}
              className="font-mono"
              onChange={
                barcodeEditable
                  ? (e) => {
                      const bc = e.target.value;
                      setForm({
                        ...form,
                        barcode: bc,
                        manufacturer: detectManufacturerFromBarcode(bc),
                      });
                    }
                  : undefined
              }
            />
          </div>

          <PressureTestYearField
            id="new-pressure-test-year"
            value={form.pressureTestYear}
            onChange={(pressureTestYear) => setForm({ ...form, pressureTestYear })}
          />

          <div>
            <Label className="mb-2 block">Tulajdonos típusa *</Label>
            <Select
              value={form.owner}
              onValueChange={(v) => setForm({ ...form, owner: v as Circulation })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CIRCULATION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-2 block">Gyártó *</Label>
            <Select
              value={form.manufacturer}
              onValueChange={(v) => setForm({ ...form, manufacturer: v as Manufacturer })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERIALIZED_MANUFACTURER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-2 block">Gáz típusa *</Label>
            <Select
              value={form.gasType}
              onValueChange={(v) => {
                const size = getAvailableSizes(v)[0] || "20 L";
                setForm({ ...form, gasType: v, size });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GAS_TYPES.map((gas) => (
                  <SelectItem key={gas} value={gas}>
                    {gas}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-2 block">Palack mérete *</Label>
            <Select value={form.size} onValueChange={(v) => setForm({ ...form, size: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableSizes.map((size) => (
                  <SelectItem key={size} value={size}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Megjegyzés (opcionális)</Label>
            <Input
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Pl.: Párósító sérült"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              Mégsem
            </Button>
            <Button
              onClick={save}
              disabled={!isNewCylinderFormValid(form) || busy}
              className="flex-1"
            >
              Mentés
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
