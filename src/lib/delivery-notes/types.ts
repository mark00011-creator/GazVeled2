import type { AdrCalculationResult, AdrCylinderState, AdrProductData } from "@/lib/adr/types-and-calc";

export type DeliveryNoteSourceType =
  | "manual"
  | "supplier_exchange"
  | "exchange_batch"
  | "quick_exchange";

export type DeliveryNoteStatus = "draft" | "finalized" | "cancelled";

export type DeliveryNoteLineRole = "outgoing_full" | "incoming_empty" | "other";

export type DeliveryNoteItemInput = {
  lineRole: DeliveryNoteLineRole;
  cylinderState: AdrCylinderState;
  gasType: string | null;
  size: string | null;
  quantity: number;
  barcode?: string | null;
  cylinderId?: string | null;
  waterCapacityL?: number | null;
  netGasMassKg?: number | null;
  adrProductKey?: string | null;
  note?: string | null;
};

export type DeliveryNoteHeaderInput = {
  organizationId: string;
  sourceType: DeliveryNoteSourceType;
  sourceId?: string | null;
  partnerId?: string | null;
  supplierId?: string | null;
  shipperName: string;
  shipperAddress?: string | null;
  shipperTaxNumber?: string | null;
  consigneeName: string;
  consigneeAddress?: string | null;
  consigneeTaxNumber?: string | null;
  deliveryAddress?: string | null;
  vehiclePlate?: string | null;
  driverName?: string | null;
  journeyMeta?: Record<string, unknown>;
};

export type DeliveryNoteRow = {
  id: string;
  organization_id: string;
  document_number: string | null;
  status: DeliveryNoteStatus;
  issued_at: string | null;
  partner_id: string | null;
  supplier_id: string | null;
  source_type: DeliveryNoteSourceType;
  source_id: string | null;
  shipper_name: string | null;
  shipper_address: string | null;
  consignee_name: string | null;
  consignee_address: string | null;
  delivery_address: string | null;
  vehicle_plate: string | null;
  driver_name: string | null;
  adr_ruleset_version: string;
  adr_snapshot: AdrCalculationResult | null;
  business_snapshot: unknown;
  adr_total_points: number | null;
  adr_within_116: boolean | null;
  created_at: string;
  finalized_at: string | null;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  pdf_base64?: string | null;
};

export type DeliveryNoteItemRow = {
  id: string;
  delivery_note_id: string;
  line_role: DeliveryNoteLineRole;
  cylinder_state: AdrCylinderState;
  gas_type: string | null;
  size: string | null;
  quantity: number;
  barcode: string | null;
  water_capacity_l: number | null;
  net_gas_mass_kg: number | null;
  adr_product_key: string | null;
  note: string | null;
  sort_order: number;
};

export type ResolvedAdrLine = {
  item: DeliveryNoteItemInput;
  product: AdrProductData;
  businessLabel: string;
};
