import type { CylinderRow } from "@/lib/cylinder-ops";

export const SUPPLIER_EXCHANGE_DRAFT_KEY = "gazveeled:workflow-draft:supplier-exchange";
export const SUPPLIER_EXCHANGE_DRAFT_VERSION = 1;

export type SupplierExchangeWorkflowStep =
  | "select_supplier"
  | "add_returned"
  | "add_received"
  | "review";

export type SupplierExchangeDraft = {
  version: typeof SUPPLIER_EXCHANGE_DRAFT_VERSION;
  draftId: string;
  savedAt?: string;
  supplierId: string;
  returnBc: string;
  receiveBc: string;
  returned: CylinderRow[];
  received: CylinderRow[];
  note: string;
  workflowStep: SupplierExchangeWorkflowStep;
};

export function supplierExchangeWorkflowStep(args: {
  supplierId: string;
  returnedCount: number;
  receivedCount: number;
}): SupplierExchangeWorkflowStep {
  if (!args.supplierId) return "select_supplier";
  if (args.returnedCount === 0) return "add_returned";
  if (args.receivedCount === 0) return "add_received";
  return "review";
}

export function isSupplierExchangeDraftEmpty(draft: SupplierExchangeDraft): boolean {
  return (
    !draft.supplierId &&
    draft.returned.length === 0 &&
    draft.received.length === 0 &&
    !draft.note.trim() &&
    !draft.returnBc.trim() &&
    !draft.receiveBc.trim()
  );
}

export function isSupplierExchangeDraft(value: unknown): value is SupplierExchangeDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as SupplierExchangeDraft;
  if (d.version !== SUPPLIER_EXCHANGE_DRAFT_VERSION) return false;
  if (typeof d.draftId !== "string") return false;
  if (typeof d.supplierId !== "string") return false;
  if (typeof d.returnBc !== "string" || typeof d.receiveBc !== "string") return false;
  if (typeof d.note !== "string") return false;
  if (!Array.isArray(d.returned) || !Array.isArray(d.received)) return false;
  const cylOk = (c: unknown) =>
    !!c &&
    typeof c === "object" &&
    typeof (c as CylinderRow).id === "string" &&
    typeof (c as CylinderRow).barcode === "string";
  return d.returned.every(cylOk) && d.received.every(cylOk);
}
