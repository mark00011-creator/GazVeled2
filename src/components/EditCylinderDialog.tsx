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
  getAvailableSizes,
  GAS_TYPES,
} from "@/lib/gas-cylinder-form";
import {
  locationLabels,
  parsePressureTestYearInput,
  SERIALIZED_MANUFACTURER_OPTIONS,
  statusLabels,
  type Circulation,
  type Manufacturer,
} from "@/lib/labels";
import { updateCylinder, type CylinderRow } from "@/lib/cylinder-ops";
import { PressureTestYearField, pressureTestYearSaveError } from "@/components/PressureTestYearField";
import { CylinderHistorySection } from "@/components/CylinderHistorySection";
import { useQueryClient } from "@tanstack/react-query";

const LOCATION_TYPES = ["warehouse_full", "warehouse_empty", "customer", "siad", "own_supplier"] as const;
const STATUSES = ["full", "empty", "service"] as const;

export type CylinderEditSource = {
  id: string;
  barcode: string;
  gas_type: string;
  size: string;
  circulation: Circulation;
  owner?: Circulation;
  manufacturer?: Manufacturer;
  pressure_test_year?: number | null;
  status: string;
  location_type: string;
  location_partner_id?: string | null;
  location_supplier_id?: string | null;
};

type EditFormState = {
  barcode: string;
  gas_type: string;
  size: string;
  circulation: Circulation;
  owner: Circulation;
  manufacturer: Manufacturer;
  pressureTestYear: string;
  status: CylinderRow["status"];
  location_type: CylinderRow["location_type"];
  location_partner_id: string | null;
  location_supplier_id: string | null;
};

function toFormState(cyl: CylinderEditSource): EditFormState {
  return {
    barcode: cyl.barcode,
    gas_type: cyl.gas_type,
    size: cyl.size,
    circulation: cyl.circulation,
    owner: cyl.owner ?? cyl.circulation,
    manufacturer: cyl.manufacturer ?? "other",
    pressureTestYear: cyl.pressure_test_year != null ? String(cyl.pressure_test_year) : "",
    status: cyl.status as CylinderRow["status"],
    location_type: cyl.location_type as CylinderRow["location_type"],
    location_partner_id: cyl.location_partner_id ?? null,
    location_supplier_id: cyl.location_supplier_id ?? null,
  };
}

export function EditCylinderDialog({
  open,
  onOpenChange,
  cylinder,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cylinder: CylinderEditSource | null;
  onSaved?: () => void;
}) {
  const [form, setForm] = useState<EditFormState | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (!open || !cylinder) {
      setForm(null);
      return;
    }
    setForm(toFormState(cylinder));
  }, [open, cylinder]);

  const availableSizes = form ? getAvailableSizes(form.gas_type || "Argon") : [];

  async function save() {
    if (!form || !cylinder) return;
    if (!form.barcode.trim()) {
      toast.error("Vonalkód kötelező");
      return;
    }
    const yearErr = pressureTestYearSaveError(form.pressureTestYear);
    if (yearErr) {
      toast.error(yearErr);
      return;
    }

    const cylinderId = cylinder.id;
    const pressure_test_year = parsePressureTestYearInput(form.pressureTestYear);

    setBusy(true);
    try {
      await updateCylinder(cylinderId, {
        barcode: form.barcode,
        gas_type: form.gas_type,
        size: form.size,
        circulation: form.circulation,
        owner: form.owner,
        manufacturer: form.manufacturer,
        pressure_test_year,
        status: form.status,
        location_type: form.location_type,
        location_partner_id: form.location_partner_id,
        location_supplier_id: form.location_supplier_id,
      });
      toast.success("Palack frissítve");
      await qc.invalidateQueries({ queryKey: ["cylinder-history", cylinderId] });
      setForm(null);
      onOpenChange(false);
      onSaved?.();
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
          <DialogTitle>Palack szerkesztése</DialogTitle>
          <DialogDescription>Módosítsd a palack adatait, majd mentsd.</DialogDescription>
        </DialogHeader>

        {form && (
          <div className="space-y-4">
            <div>
              <Label>Vonalkód</Label>
              <Input
                value={form.barcode}
                onChange={(e) => {
                  const barcode = e.target.value;
                  setForm({
                    ...form,
                    barcode,
                    manufacturer: detectManufacturerFromBarcode(barcode),
                  });
                }}
                className="font-mono"
              />
            </div>

            <PressureTestYearField
              id="edit-pressure-test-year"
              value={form.pressureTestYear}
              onChange={(pressureTestYear) => setForm({ ...form, pressureTestYear })}
            />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Gáz típusa</Label>
                <Select
                  value={form.gas_type}
                  onValueChange={(v) => {
                    const size = getAvailableSizes(v)[0] || "20 L";
                    setForm({ ...form, gas_type: v, size });
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
                <Label>Méret</Label>
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
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Körforgás</Label>
                <Select
                  value={form.circulation}
                  onValueChange={(v) => setForm({ ...form, circulation: v as Circulation })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="own">Saját</SelectItem>
                    <SelectItem value="siad">SIAD</SelectItem>
                    <SelectItem value="berpalack">Egyéb</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Tulajdonos</Label>
                <Select
                  value={form.owner}
                  onValueChange={(v) => setForm({ ...form, owner: v as Circulation })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="own">Saját</SelectItem>
                    <SelectItem value="siad">SIAD</SelectItem>
                    <SelectItem value="berpalack">Egyéb</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Gyártó</Label>
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

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Helyszín</Label>
                <Select
                  value={form.location_type}
                  onValueChange={(v) =>
                    setForm({ ...form, location_type: v as CylinderRow["location_type"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCATION_TYPES.map((lt) => (
                      <SelectItem key={lt} value={lt}>
                        {locationLabels[lt]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Státusz</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v as CylinderRow["status"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {statusLabels[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Partner ID (opcionális)</Label>
              <Input
                value={form.location_partner_id || ""}
                onChange={(e) =>
                  setForm({ ...form, location_partner_id: e.target.value || null })
                }
                placeholder="UUID vagy üres"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
                Mégsem
              </Button>
              <Button onClick={save} disabled={busy} className="flex-1">
                Mentés
              </Button>
            </div>

            {cylinder && (
              <CylinderHistorySection cylinderId={cylinder.id} enabled={open && !!cylinder} />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
