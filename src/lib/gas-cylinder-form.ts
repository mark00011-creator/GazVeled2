import type { Circulation } from "@/lib/labels";

export const GAS_TYPES = ["Acetilén", "Argon", "Stargon", "Széndioxid", "Nitrogén", "Oxigén"];
export const STANDARD_SIZES = ["10 L", "20 L", "40 L", "50 L"];
export const CO2_SIZES = ["1-5 kg", "5 kg", "10 kg", "15 kg", "20 kg", "30 kg", "37,5 kg"];

export function getAvailableSizes(gasType: string): string[] {
  return gasType === "Széndioxid" ? CO2_SIZES : STANDARD_SIZES;
}

export type NewCylinderFormState = {
  barcode: string;
  owner: Circulation;
  gasType: string;
  size: string;
  note: string;
};

export function defaultNewCylinderForm(barcode: string): NewCylinderFormState {
  return {
    barcode,
    owner: "own",
    gasType: "Argon",
    size: "20 L",
    note: "",
  };
}

export function isNewCylinderFormValid(form: NewCylinderFormState): boolean {
  return !!(form.barcode.trim() && form.gasType && form.size && form.owner);
}
