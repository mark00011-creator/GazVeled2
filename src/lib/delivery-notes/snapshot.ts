/**
 * Snapshot builder for delivery notes – freeze ADR + business data at finalize.
 */
import type { AdrCalculationResult, AdrLineResult, AdrProductData } from "@/lib/adr/types-and-calc";
import type { DeliveryNoteItemInput } from "@/lib/delivery-notes/types";

export type DeliveryNoteBusinessLineSnapshot = {
  lineRole: DeliveryNoteItemInput["lineRole"];
  cylinderState: DeliveryNoteItemInput["cylinderState"];
  gasType: string | null;
  size: string | null;
  quantity: number;
  barcode: string | null;
  waterCapacityL: number | null;
  netGasMassKg: number | null;
  adrProductKey: string | null;
  note: string | null;
  /** Frozen ADR product fields used for this line */
  adrProduct: {
    unNumber: string | null;
    properShippingNameHu: string | null;
    adrClass: string | null;
    classificationCode: string | null;
    hazardLabels: string[];
    tunnelRestrictionCode: string | null;
    transportCategory: number | null;
    multiplier: number | null;
    quantityBasis: string;
    verified: boolean;
    rulesetVersion: string;
    transportDocumentText: string | null;
  } | null;
  adrLine: AdrLineResult | null;
};

export type DeliveryNoteBusinessSnapshot = {
  version: 1;
  shipperName: string;
  shipperAddress: string | null;
  consigneeName: string;
  consigneeAddress: string | null;
  deliveryAddress: string | null;
  vehiclePlate: string | null;
  driverName: string | null;
  items: DeliveryNoteBusinessLineSnapshot[];
};

export type DeliveryNoteAdrSnapshot = AdrCalculationResult & {
  frozenAt: string;
};

export function freezeAdrProduct(product: AdrProductData) {
  return {
    unNumber: product.unNumber,
    properShippingNameHu: product.properShippingNameHu,
    adrClass: product.adrClass,
    classificationCode: product.classificationCode,
    hazardLabels: [...product.hazardLabels],
    tunnelRestrictionCode: product.tunnelRestrictionCode,
    transportCategory: product.transportCategory,
    multiplier: product.multiplier,
    quantityBasis: product.quantityBasis,
    verified: product.verified,
    rulesetVersion: product.rulesetVersion,
    transportDocumentText: product.transportDocumentText ?? null,
  };
}

export function buildBusinessSnapshot(args: {
  header: {
    shipperName: string;
    shipperAddress?: string | null;
    consigneeName: string;
    consigneeAddress?: string | null;
    deliveryAddress?: string | null;
    vehiclePlate?: string | null;
    driverName?: string | null;
  };
  items: DeliveryNoteItemInput[];
  products: (AdrProductData | null)[];
  adr: AdrCalculationResult;
}): DeliveryNoteBusinessSnapshot {
  return {
    version: 1,
    shipperName: args.header.shipperName,
    shipperAddress: args.header.shipperAddress ?? null,
    consigneeName: args.header.consigneeName,
    consigneeAddress: args.header.consigneeAddress ?? null,
    deliveryAddress: args.header.deliveryAddress ?? null,
    vehiclePlate: args.header.vehiclePlate ?? null,
    driverName: args.header.driverName ?? null,
    items: args.items.map((it, i) => ({
      lineRole: it.lineRole,
      cylinderState: it.cylinderState,
      gasType: it.gasType,
      size: it.size,
      quantity: it.quantity,
      barcode: it.barcode ?? null,
      waterCapacityL: it.waterCapacityL ?? null,
      netGasMassKg: it.netGasMassKg ?? null,
      adrProductKey: it.adrProductKey ?? null,
      note: it.note ?? null,
      adrProduct: args.products[i] ? freezeAdrProduct(args.products[i]!) : null,
      adrLine: args.adr.lines[i] ?? null,
    })),
  };
}

export function buildAdrSnapshot(adr: AdrCalculationResult): DeliveryNoteAdrSnapshot {
  return { ...adr, frozenAt: new Date().toISOString() };
}

/** Items for PDF from frozen business snapshot (no live master). */
export function itemsFromBusinessSnapshot(
  snap: DeliveryNoteBusinessSnapshot,
): DeliveryNoteItemInput[] {
  return snap.items.map((it) => ({
    lineRole: it.lineRole,
    cylinderState: it.cylinderState,
    gasType: it.gasType,
    size: it.size,
    quantity: it.quantity,
    barcode: it.barcode,
    waterCapacityL: it.waterCapacityL,
    netGasMassKg: it.netGasMassKg,
    adrProductKey: it.adrProductKey,
    note: it.note,
  }));
}
