import type { CylinderRow, PartnerOperationType } from "@/lib/cylinder-ops";

export const QUICK_EXCHANGE_DRAFT_KEY = "gazveeled:workflow-draft:quick-exchange";
export const QUICK_EXCHANGE_DRAFT_VERSION = 2;

export type QuickExchangeIncomingKind = "rental" | "own" | "new";
export type QuickExchangeSaleMode = "barcode" | "chinese" | "flaga_pb" | "prima_pb";
export type QuickExchangeExchangeMode = "barcode" | "chinese_brought" | "chinese_take";
export type QuickExchangeChineseBroughtOutKind = "serial" | "chinese" | "";

export type QuickExchangePairDraft = {
  incoming: CylinderRow;
  outgoing: CylinderRow;
  incomingCreated: boolean;
  outgoingCreated: boolean;
  reassign: "yes" | "no" | null;
};

export type QuickExchangeDraft = {
  version: typeof QUICK_EXCHANGE_DRAFT_VERSION;
  draftId: string;
  savedAt?: string;
  operation: PartnerOperationType;
  exchangeMode: QuickExchangeExchangeMode;
  saleMode: QuickExchangeSaleMode;
  partnerId: string;
  incomingBc: string;
  outgoingBc: string;
  incoming: CylinderRow | null;
  incomingCreated: boolean;
  outgoing: CylinderRow | null;
  outgoingCreated: boolean;
  pairs: QuickExchangePairDraft[];
  chineseGas: string;
  chineseSize: string;
  chineseQty: string;
  chineseBroughtOutKind: QuickExchangeChineseBroughtOutKind;
  chineseOutGas: string;
  chineseOutSize: string;
  chineseOutQty: string;
  flagaPbKey: string;
  flagaPbQty: string;
  primaPbKey: string;
  primaPbQty: string;
  reassign: "yes" | "no" | null;
  note: string;
  workflowStep: string;
};

function isCylinderRow(value: unknown): value is CylinderRow {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as CylinderRow).id === "string" &&
    typeof (value as CylinderRow).barcode === "string" &&
    typeof (value as CylinderRow).gas_type === "string"
  );
}

function isPairDraft(value: unknown): value is QuickExchangePairDraft {
  if (!value || typeof value !== "object") return false;
  const p = value as QuickExchangePairDraft;
  return isCylinderRow(p.incoming) && isCylinderRow(p.outgoing);
}

export function isQuickExchangeDraft(value: unknown): value is QuickExchangeDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as QuickExchangeDraft;
  if (d.version !== QUICK_EXCHANGE_DRAFT_VERSION) return false;
  if (typeof d.draftId !== "string") return false;
  if (typeof d.operation !== "string") return false;
  if (typeof d.partnerId !== "string") return false;
  if (typeof d.note !== "string") return false;
  if (d.incoming !== null && !isCylinderRow(d.incoming)) return false;
  if (d.outgoing !== null && !isCylinderRow(d.outgoing)) return false;
  if (!Array.isArray(d.pairs) || !d.pairs.every(isPairDraft)) return false;
  return true;
}

export function isQuickExchangeDraftEmpty(draft: QuickExchangeDraft): boolean {
  return (
    !draft.partnerId &&
    !draft.incoming &&
    !draft.outgoing &&
    draft.pairs.length === 0 &&
    !draft.note.trim() &&
    !draft.incomingBc.trim() &&
    !draft.outgoingBc.trim()
  );
}

export function quickExchangeWorkflowStep(args: {
  partnerId: string;
  operation: PartnerOperationType;
  exchangeMode: QuickExchangeExchangeMode;
  saleMode: QuickExchangeSaleMode;
  hasIncoming: boolean;
  hasOutgoing: boolean;
  pairsCount?: number;
}): string {
  if (!args.partnerId) return "select_partner";
  if (args.operation === "exchange") {
    if (args.exchangeMode === "barcode") {
      if ((args.pairsCount ?? 0) > 0 && !args.hasIncoming && !args.hasOutgoing) return "review_pairs";
      if (!args.hasIncoming) return "scan_incoming";
      if (!args.hasOutgoing) return "scan_outgoing";
      return "confirm_pair_or_submit";
    }
    if (args.exchangeMode === "chinese_brought") return "chinese_brought_form";
    if (args.exchangeMode === "chinese_take") return "chinese_take_form";
  }
  if (args.operation === "sale") return `sale_${args.saleMode}`;
  if (args.operation === "loan") return args.hasOutgoing ? "confirm_loan" : "scan_outgoing";
  if (args.operation === "empty_return") return args.hasIncoming ? "confirm_empty_return" : "scan_incoming";
  return "in_progress";
}
