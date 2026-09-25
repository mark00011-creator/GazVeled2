/**
 * Server-side finalize authority mirror (unit tests + docs).
 * Runtime authority lives in Postgres:
 *   public.finalize_delivery_note(p_delivery_note_id uuid)
 *   + helpers in 20260924120000_delivery_notes_server_side_finalize.sql
 *
 * Client-provided ADR/business snapshots / totals MUST NOT influence finalized data.
 */
import {
  ADR_RULESET_VERSION,
  calculateAdr1136,
  type AdrCalculationResult,
  type AdrCylinderState,
  type AdrLineInput,
  type AdrProductData,
  type AdrQuantityBasis,
  type AdrTransportCategory,
} from "@/lib/adr/types-and-calc";
import { gasTypeToAdrKey, parseNetGasMassKg, parseWaterCapacityLitres } from "@/lib/adr/physical";
import {
  buildAdrSnapshot,
  freezeAdrProduct,
  type DeliveryNoteAdrSnapshot,
  type DeliveryNoteBusinessSnapshot,
} from "@/lib/delivery-notes/snapshot";
import type { DeliveryNoteItemInput } from "@/lib/delivery-notes/types";

/** DB-shaped ADR master row (snake_case). */
export type AdrMasterRow = {
  organization_id: string | null;
  gas_type_key: string;
  ruleset_version: string;
  un_number: string | null;
  proper_shipping_name_hu: string | null;
  technical_name_hu: string | null;
  adr_class: string | null;
  classification_code: string | null;
  hazard_labels: string[] | null;
  packing_group: string | null;
  tunnel_restriction_code: string | null;
  transport_category: number | null;
  multiplier: number | null;
  quantity_basis: string | null;
  transport_document_text: string | null;
  verified: boolean;
  verified_at: string | null;
  source: string | null;
};

export type DeliveryNoteDbRow = {
  id: string;
  organization_id: string;
  partner_id: string | null;
  supplier_id: string | null;
  shipper_name: string | null;
  shipper_address: string | null;
  consignee_name: string | null;
  consignee_address: string | null;
  delivery_address: string | null;
  vehicle_plate: string | null;
  driver_name: string | null;
  adr_ruleset_version: string | null;
};

export type DeliveryNoteItemDbRow = {
  id: string;
  line_role: DeliveryNoteItemInput["lineRole"];
  cylinder_state: AdrCylinderState;
  gas_type: string | null;
  size: string | null;
  quantity: number;
  barcode: string | null;
  cylinder_id: string | null;
  water_capacity_l: number | null;
  net_gas_mass_kg: number | null;
  adr_product_key: string | null;
  note: string | null;
  sort_order: number;
};

export type PartnerDbRow = { id: string; name: string; address: string | null };
export type SupplierDbRow = { id: string; name: string };
export type OrganizationDbRow = { id: string; name: string };

/** Client tampering attempt — ignored by authority. */
export type ClientFinalizeTamperAttempt = {
  p_adr_snapshot?: unknown;
  p_business_snapshot?: unknown;
  p_adr_total_points?: number;
  p_adr_within_116?: boolean;
  unNumber?: string;
  verified?: boolean;
  transportCategory?: number;
  partnerName?: string;
  consigneeName?: string;
};

export type ServerFinalizeAuthorityInput = {
  note: DeliveryNoteDbRow;
  items: DeliveryNoteItemDbRow[];
  masters: AdrMasterRow[];
  organization: OrganizationDbRow | null;
  partner: PartnerDbRow | null;
  supplier: SupplierDbRow | null;
  /** Must be ignored — present only to prove tampering resistance. */
  clientAttempt?: ClientFinalizeTamperAttempt | null;
};

export type ServerFinalizeAuthorityResult = {
  adr_snapshot: DeliveryNoteAdrSnapshot;
  business_snapshot: DeliveryNoteBusinessSnapshot;
  adr_total_points: number;
  adr_within_116: boolean;
  adr_ruleset_version: string;
  /** Explicitly discarded client fields (for tests). */
  ignoredClientAuthority: string[];
};

function mapMaster(row: AdrMasterRow): AdrProductData {
  return {
    rulesetVersion: row.ruleset_version || ADR_RULESET_VERSION,
    unNumber: row.un_number,
    properShippingNameHu: row.proper_shipping_name_hu,
    technicalNameHu: row.technical_name_hu,
    adrClass: row.adr_class,
    classificationCode: row.classification_code,
    hazardLabels: row.hazard_labels ?? [],
    packingGroup: row.packing_group,
    tunnelRestrictionCode: row.tunnel_restriction_code,
    transportCategory: (row.transport_category as AdrTransportCategory | null) ?? null,
    multiplier: row.multiplier != null ? Number(row.multiplier) : null,
    quantityBasis: (row.quantity_basis as AdrQuantityBasis) ?? "water_capacity_l",
    verified: !!row.verified,
    verifiedAt: row.verified_at,
    source: row.source,
    transportDocumentText: row.transport_document_text,
  };
}

function emptyUnverifiedProduct(ruleset: string): AdrProductData {
  return {
    rulesetVersion: ruleset,
    unNumber: null,
    properShippingNameHu: null,
    technicalNameHu: null,
    adrClass: null,
    classificationCode: null,
    hazardLabels: [],
    packingGroup: null,
    tunnelRestrictionCode: null,
    transportCategory: null,
    multiplier: null,
    quantityBasis: "not_applicable",
    verified: false,
    verifiedAt: null,
    source: null,
  };
}

/** Prefer org-specific master, then global (organization_id IS NULL). */
export function resolveAdrMasterFromDb(
  masters: AdrMasterRow[],
  organizationId: string,
  gasTypeKey: string,
  rulesetVersion: string,
): AdrMasterRow | null {
  if (!gasTypeKey) return null;
  const candidates = masters.filter(
    (m) =>
      m.gas_type_key === gasTypeKey &&
      m.ruleset_version === rulesetVersion &&
      (m.organization_id === organizationId || m.organization_id == null),
  );
  candidates.sort((a, b) => {
    const ao = a.organization_id ? 1 : 0;
    const bo = b.organization_id ? 1 : 0;
    return bo - ao;
  });
  return candidates[0] ?? null;
}

function resolveHeaderNames(input: ServerFinalizeAuthorityInput) {
  const orgName = input.organization?.name?.trim() || null;
  const partnerName = input.partner?.name?.trim() || null;
  const partnerAddress = input.partner?.address ?? null;
  const supplierName = input.supplier?.name?.trim() || null;

  const shipperName = orgName || input.note.shipper_name || "";
  const shipperAddress = input.note.shipper_address ?? null;

  let consigneeName = input.note.consignee_name || "";
  let consigneeAddress = input.note.consignee_address ?? null;
  if (partnerName) {
    consigneeName = partnerName;
    consigneeAddress = partnerAddress;
  } else if (supplierName && !partnerName) {
    consigneeName = supplierName;
  }

  return {
    shipperName,
    shipperAddress,
    consigneeName,
    consigneeAddress,
    deliveryAddress: input.note.delivery_address ?? null,
    vehiclePlate: input.note.vehicle_plate ?? null,
    driverName: input.note.driver_name ?? null,
  };
}

/**
 * Build finalized snapshots exclusively from DB-shaped rows.
 * Any clientAttempt payload is recorded as ignored and never applied.
 */
export function computeServerFinalizeAuthority(
  input: ServerFinalizeAuthorityInput,
): ServerFinalizeAuthorityResult {
  const ignored: string[] = [];
  const attempt = input.clientAttempt;
  if (attempt) {
    for (const k of Object.keys(attempt)) {
      if (attempt[k as keyof ClientFinalizeTamperAttempt] !== undefined) {
        ignored.push(k);
      }
    }
  }

  const ruleset = input.note.adr_ruleset_version || ADR_RULESET_VERSION;
  const header = resolveHeaderNames(input);
  const sorted = [...input.items].sort((a, b) => a.sort_order - b.sort_order);

  const products: AdrProductData[] = [];
  const lines: AdrLineInput[] = [];
  const itemInputs: DeliveryNoteItemInput[] = [];

  for (const it of sorted) {
    const key = (it.adr_product_key && it.adr_product_key.trim()) || gasTypeToAdrKey(it.gas_type);
    const master = resolveAdrMasterFromDb(input.masters, input.note.organization_id, key, ruleset);
    const product = master ? mapMaster(master) : emptyUnverifiedProduct(ruleset);

    const water =
      it.water_capacity_l != null && Number(it.water_capacity_l) > 0
        ? Number(it.water_capacity_l)
        : parseWaterCapacityLitres(it.size);
    const net =
      it.net_gas_mass_kg != null && Number(it.net_gas_mass_kg) > 0
        ? Number(it.net_gas_mass_kg)
        : parseNetGasMassKg(it.size);

    products.push(product);
    itemInputs.push({
      lineRole: it.line_role,
      cylinderState: it.cylinder_state,
      gasType: it.gas_type,
      size: it.size,
      quantity: it.quantity,
      barcode: it.barcode,
      cylinderId: it.cylinder_id,
      waterCapacityL: water,
      netGasMassKg: net,
      adrProductKey: key || null,
      note: it.note,
    });
    lines.push({
      id: it.id,
      state: it.cylinder_state,
      quantity: it.quantity,
      product,
      physical: { waterCapacityLitres: water, netGasMassKg: net },
      businessLabel: `${it.gas_type ?? "?"} ${it.size ?? ""}`.trim(),
    });
  }

  const adr: AdrCalculationResult = calculateAdr1136(lines);

  const business: DeliveryNoteBusinessSnapshot = {
    version: 1,
    shipperName: header.shipperName,
    shipperAddress: header.shipperAddress,
    consigneeName: header.consigneeName,
    consigneeAddress: header.consigneeAddress,
    deliveryAddress: header.deliveryAddress,
    vehiclePlate: header.vehiclePlate,
    driverName: header.driverName,
    items: itemInputs.map((it, i) => ({
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
      adrProduct: products[i] ? freezeAdrProduct(products[i]!) : null,
      adrLine: adr.lines[i] ?? null,
    })),
  };

  return {
    adr_snapshot: buildAdrSnapshot(adr),
    business_snapshot: business,
    adr_total_points: adr.totalPoints,
    adr_within_116: adr.within116Exemption,
    adr_ruleset_version: ruleset,
    ignoredClientAuthority: ignored,
  };
}
