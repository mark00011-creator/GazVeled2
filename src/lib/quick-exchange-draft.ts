import type { CylinderRow, PartnerOperationType } from "@/lib/cylinder-ops";

export const QUICK_EXCHANGE_DRAFT_KEY = "gazveeled:workflow-draft:quick-exchange";
export const QUICK_EXCHANGE_DRAFT_VERSION = 3;

export type QuickExchangeIncomingKind = "rental" | "own" | "new";
export type QuickExchangeSaleMode = "barcode" | "chinese" | "flaga_pb" | "prima_pb";
export type QuickExchangeExchangeMode = "barcode" | "chinese_brought" | "chinese_take";
export type QuickExchangeChineseBroughtOutKind = "serial" | "chinese" | "";

/** Egy palack a beszállítóihoz hasonló listában (beérkező üres / kiadandó teli). */
export type QuickExchangeListItem = {
  cylinder: CylinderRow;
  created: boolean;
  isRental: boolean;
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
  /** Egyszeres műveletekhez (kölcsön, eladás, üres visszavétel, kínai). */
  incoming: CylinderRow | null;
  incomingCreated: boolean;
  outgoing: CylinderRow | null;
  outgoingCreated: boolean;
  incomingList: QuickExchangeListItem[];
  outgoingList: QuickExchangeListItem[];
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

function isListItem(value: unknown): value is QuickExchangeListItem {
  if (!value || typeof value !== "object") return false;
  const item = value as QuickExchangeListItem;
  return (
    isCylinderRow(item.cylinder) &&
    typeof item.created === "boolean" &&
    typeof item.isRental === "boolean" &&
    (item.reassign === null || item.reassign === "yes" || item.reassign === "no")
  );
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
  if (!Array.isArray(d.incomingList) || !d.incomingList.every(isListItem)) return false;
  if (!Array.isArray(d.outgoingList) || !d.outgoingList.every(isListItem)) return false;
  return true;
}

export function isQuickExchangeDraftEmpty(draft: QuickExchangeDraft): boolean {
  return (
    !draft.partnerId &&
    !draft.incoming &&
    !draft.outgoing &&
    draft.incomingList.length === 0 &&
    draft.outgoingList.length === 0 &&
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
  incomingCount?: number;
  outgoingCount?: number;
}): string {
  if (!args.partnerId) return "select_partner";
  if (args.operation === "exchange") {
    if (args.exchangeMode === "barcode") {
      const inN = args.incomingCount ?? 0;
      const outN = args.outgoingCount ?? 0;
      if (inN > 0 || outN > 0) return "review_lists";
      return "scan_lists";
    }
    if (args.exchangeMode === "chinese_brought") return "chinese_brought_form";
    if (args.exchangeMode === "chinese_take") return "chinese_take_form";
  }
  if (args.operation === "sale") return `sale_${args.saleMode}`;
  if (args.operation === "loan") return args.hasOutgoing ? "confirm_loan" : "scan_outgoing";
  if (args.operation === "empty_return") return args.hasIncoming ? "confirm_empty_return" : "scan_incoming";
  return "in_progress";
}

export function zipExchangeLists(
  incomingList: QuickExchangeListItem[],
  outgoingList: QuickExchangeListItem[],
): { incoming: CylinderRow; outgoing: CylinderRow; incomingCreated: boolean; outgoingCreated: boolean; reassign: "yes" | "no" | null }[] {
  const n = Math.min(incomingList.length, outgoingList.length);
  const pairs = [];
  for (let i = 0; i < n; i++) {
    pairs.push({
      incoming: incomingList[i].cylinder,
      outgoing: outgoingList[i].cylinder,
      incomingCreated: incomingList[i].created,
      outgoingCreated: outgoingList[i].created,
      reassign: incomingList[i].reassign,
    });
  }
  return pairs;
}
