import { supabase } from "@/integrations/supabase/client";
import { formatSupabaseError } from "@/lib/supabase-error";
import {
  ADR_RULESET_VERSION,
  ADR_UNVERIFIED_STARGON_C18,
  ADR_VERIFIED_SEEDS,
  calculateAdr1136,
  type AdrLineInput,
  type AdrProductData,
} from "@/lib/adr/types-and-calc";
import { gasTypeToAdrKey, parseNetGasMassKg, parseWaterCapacityLitres } from "@/lib/adr/physical";
import { generateDeliveryNotePdf, downloadDeliveryNotePdf } from "@/lib/delivery-notes/pdf";
import type {
  DeliveryNoteHeaderInput,
  DeliveryNoteItemInput,
  DeliveryNoteRow,
} from "@/lib/delivery-notes/types";

/** Typed access before generated Database types include delivery_notes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function fallbackProduct(key: string): AdrProductData {
  const k = key.toLowerCase();
  if (k === "argon") return ADR_VERIFIED_SEEDS.ARGON_COMPRESSED;
  if (k === "oxigén" || k === "oxygen") return ADR_VERIFIED_SEEDS.OXYGEN_COMPRESSED;
  if (k === "nitrogén" || k === "nitrogen") return ADR_VERIFIED_SEEDS.NITROGEN_COMPRESSED;
  if (k === "hélium" || k === "helium") return ADR_VERIFIED_SEEDS.HELIUM_COMPRESSED;
  if (k === "szén-dioxid" || k === "co2") return ADR_VERIFIED_SEEDS.CARBON_DIOXIDE;
  if (k === "stargon") return ADR_UNVERIFIED_STARGON_C18;
  return {
    rulesetVersion: ADR_RULESET_VERSION,
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

function mapMasterRow(row: Record<string, unknown>): AdrProductData {
  return {
    rulesetVersion: String(row.ruleset_version ?? ADR_RULESET_VERSION),
    unNumber: (row.un_number as string) ?? null,
    properShippingNameHu: (row.proper_shipping_name_hu as string) ?? null,
    technicalNameHu: (row.technical_name_hu as string) ?? null,
    adrClass: (row.adr_class as string) ?? null,
    classificationCode: (row.classification_code as string) ?? null,
    hazardLabels: (row.hazard_labels as string[]) ?? [],
    packingGroup: (row.packing_group as string) ?? null,
    tunnelRestrictionCode: (row.tunnel_restriction_code as string) ?? null,
    transportCategory: (row.transport_category as 0 | 1 | 2 | 3 | 4) ?? null,
    multiplier: row.multiplier != null ? Number(row.multiplier) : null,
    quantityBasis: (row.quantity_basis as AdrProductData["quantityBasis"]) ?? "water_capacity_l",
    verified: !!row.verified,
    verifiedAt: (row.verified_at as string) ?? null,
    source: (row.source as string) ?? null,
    transportDocumentText: (row.transport_document_text as string) ?? null,
  };
}

export async function resolveAdrProduct(gasType: string | null | undefined): Promise<AdrProductData> {
  const key = gasTypeToAdrKey(gasType);
  if (!key) return fallbackProduct("");
  try {
    const { data, error } = await db
      .from("adr_product_master")
      .select("*")
      .eq("gas_type_key", key)
      .eq("ruleset_version", ADR_RULESET_VERSION)
      .order("organization_id", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) return mapMasterRow(data);
  } catch {
    /* tábla még nincs – seed fallback */
  }
  return fallbackProduct(key);
}

function enrichItem(item: DeliveryNoteItemInput): DeliveryNoteItemInput {
  const water =
    item.waterCapacityL ?? parseWaterCapacityLitres(item.size);
  const net = item.netGasMassKg ?? parseNetGasMassKg(item.size);
  return {
    ...item,
    waterCapacityL: water,
    netGasMassKg: net,
    adrProductKey: item.adrProductKey ?? gasTypeToAdrKey(item.gasType),
  };
}

export async function buildAdrForItems(items: DeliveryNoteItemInput[]) {
  const enriched = items.map(enrichItem);
  const lines: AdrLineInput[] = [];
  for (const it of enriched) {
    const product = await resolveAdrProduct(it.gasType);
    lines.push({
      id: `${it.lineRole}-${it.barcode ?? it.gasType ?? "x"}-${it.size ?? ""}`,
      state: it.cylinderState,
      quantity: it.quantity,
      product,
      physical: {
        waterCapacityLitres: it.waterCapacityL ?? null,
        netGasMassKg: it.netGasMassKg ?? null,
      },
      businessLabel: `${it.gasType ?? "?"} ${it.size ?? ""}`.trim(),
    });
  }
  const adr = calculateAdr1136(lines);
  const adrReady = adr.blockingWarnings.length === 0;
  return { enriched, adr, adrReady };
}

export async function listDeliveryNotes(limit = 50): Promise<DeliveryNoteRow[]> {
  const { data, error } = await db
    .from("delivery_notes")
    .select(
      "id, organization_id, document_number, status, issued_at, partner_id, supplier_id, source_type, source_id, shipper_name, shipper_address, consignee_name, consignee_address, delivery_address, vehicle_plate, driver_name, adr_ruleset_version, adr_snapshot, business_snapshot, adr_total_points, adr_within_116, created_at, finalized_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(formatSupabaseError(error, "Szállítólevelek"));
  return (data ?? []) as DeliveryNoteRow[];
}

export async function createDeliveryNoteDraft(
  header: DeliveryNoteHeaderInput,
  items: DeliveryNoteItemInput[],
): Promise<{ id: string; adrReady: boolean }> {
  if (items.length === 0) throw new Error("Legalább egy tétel kell a szállítólevélhez");
  const { enriched, adr, adrReady } = await buildAdrForItems(items);

  const { data: auth } = await supabase.auth.getUser();
  const { data: note, error } = await db
    .from("delivery_notes")
    .insert({
      organization_id: header.organizationId,
      status: "draft",
      partner_id: header.partnerId ?? null,
      supplier_id: header.supplierId ?? null,
      source_type: header.sourceType,
      source_id: header.sourceId ?? null,
      shipper_name: header.shipperName,
      shipper_address: header.shipperAddress ?? null,
      shipper_tax_number: header.shipperTaxNumber ?? null,
      consignee_name: header.consigneeName,
      consignee_address: header.consigneeAddress ?? null,
      consignee_tax_number: header.consigneeTaxNumber ?? null,
      delivery_address: header.deliveryAddress ?? null,
      vehicle_plate: header.vehiclePlate ?? null,
      driver_name: header.driverName ?? null,
      journey_meta: header.journeyMeta ?? {},
      adr_ruleset_version: ADR_RULESET_VERSION,
      adr_snapshot: adr,
      business_snapshot: { items: enriched },
      adr_total_points: adr.totalPoints,
      adr_within_116: adr.within116Exemption,
      created_by: auth.user?.id ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(formatSupabaseError(error, "Szállítólevél létrehozása"));

  const rows = enriched.map((it, i) => ({
    delivery_note_id: note.id,
    organization_id: header.organizationId,
    line_role: it.lineRole,
    cylinder_state: it.cylinderState,
    gas_type: it.gasType,
    size: it.size,
    quantity: it.quantity,
    barcode: it.barcode ?? null,
    cylinder_id: it.cylinderId ?? null,
    water_capacity_l: it.waterCapacityL ?? null,
    net_gas_mass_kg: it.netGasMassKg ?? null,
    adr_product_key: it.adrProductKey ?? null,
    note: it.note ?? null,
    sort_order: i,
  }));

  const { error: itemErr } = await db.from("delivery_note_items").insert(rows);
  if (itemErr) {
    await db.from("delivery_notes").delete().eq("id", note.id);
    throw new Error(formatSupabaseError(itemErr, "Szállítólevél tételek"));
  }

  return { id: note.id as string, adrReady };
}

export async function finalizeDeliveryNote(noteId: string): Promise<{
  documentNumber: string;
  pdfBytes: Uint8Array;
  adrReady: boolean;
}> {
  const { data: note, error } = await db.from("delivery_notes").select("*").eq("id", noteId).single();
  if (error || !note) throw new Error(formatSupabaseError(error, "Szállítólevél betöltése"));
  if (note.status === "finalized") throw new Error("A szállítólevél már véglegesítve van");

  const { data: items, error: iErr } = await db
    .from("delivery_note_items")
    .select("*")
    .eq("delivery_note_id", noteId)
    .order("sort_order");
  if (iErr) throw new Error(formatSupabaseError(iErr, "Szállítólevél tételek"));

  const itemInputs: DeliveryNoteItemInput[] = (items ?? []).map(
    (it: Record<string, unknown>) => ({
      lineRole: it.line_role as DeliveryNoteItemInput["lineRole"],
      cylinderState: it.cylinder_state as DeliveryNoteItemInput["cylinderState"],
      gasType: (it.gas_type as string) ?? null,
      size: (it.size as string) ?? null,
      quantity: Number(it.quantity),
      barcode: (it.barcode as string) ?? null,
      cylinderId: (it.cylinder_id as string) ?? null,
      waterCapacityL: it.water_capacity_l != null ? Number(it.water_capacity_l) : null,
      netGasMassKg: it.net_gas_mass_kg != null ? Number(it.net_gas_mass_kg) : null,
      adrProductKey: (it.adr_product_key as string) ?? null,
      note: (it.note as string) ?? null,
    }),
  );

  const { adr, adrReady, enriched } = await buildAdrForItems(itemInputs);

  let documentNumber = note.document_number as string | null;
  if (!documentNumber) {
    const { data: num, error: nErr } = await db.rpc("next_delivery_note_number", {
      p_organization_id: note.organization_id,
    });
    if (nErr) throw new Error(formatSupabaseError(nErr, "Szállítólevél sorszám"));
    documentNumber = num as string;
  }

  const issuedAt = new Date().toISOString();
  const pdfBytes = await generateDeliveryNotePdf({
    documentNumber,
    issuedAtIso: issuedAt,
    shipperName: note.shipper_name ?? "",
    shipperAddress: note.shipper_address,
    consigneeName: note.consignee_name ?? "",
    consigneeAddress: note.consignee_address,
    deliveryAddress: note.delivery_address,
    vehiclePlate: note.vehicle_plate,
    driverName: note.driver_name,
    items: enriched,
    adr,
    adrReady,
  });

  const { data: auth } = await supabase.auth.getUser();
  let b64: string;
  if (typeof Buffer !== "undefined") {
    b64 = Buffer.from(pdfBytes).toString("base64");
  } else {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < pdfBytes.length; i += chunk) {
      binary += String.fromCharCode(...pdfBytes.subarray(i, i + chunk));
    }
    b64 = btoa(binary);
  }

  const { error: updErr } = await db
    .from("delivery_notes")
    .update({
      status: "finalized",
      document_number: documentNumber,
      issued_at: issuedAt,
      finalized_at: issuedAt,
      finalized_by: auth.user?.id ?? null,
      adr_snapshot: adr,
      business_snapshot: {
        items: enriched,
        partner: { name: note.consignee_name, address: note.consignee_address },
        shipper: { name: note.shipper_name, address: note.shipper_address },
      },
      adr_total_points: adr.totalPoints,
      adr_within_116: adr.within116Exemption,
      pdf_base64: b64,
    })
    .eq("id", noteId)
    .eq("status", "draft");

  if (updErr) throw new Error(formatSupabaseError(updErr, "Szállítólevél véglegesítés"));

  return { documentNumber, pdfBytes, adrReady };
}

export async function createAndFinalizeFromSupplierExchange(args: {
  organizationId: string;
  organizationName: string;
  supplierExchangeId: string;
  shipperAddress?: string | null;
}): Promise<{ documentNumber: string; pdfBytes: Uint8Array; adrReady: boolean; noteId: string }> {
  const { data: ex, error } = await db
    .from("supplier_exchanges")
    .select("*, suppliers(name)")
    .eq("id", args.supplierExchangeId)
    .single();
  if (error || !ex) throw new Error(formatSupabaseError(error, "Beszállítói csere"));

  const returnedIds = (ex.returned_cylinder_ids as string[]) ?? [];
  const receivedIds = (ex.received_cylinder_ids as string[]) ?? [];
  const allIds = [...returnedIds, ...receivedIds];
  const { data: cyls } = await supabase
    .from("cylinders")
    .select("id, barcode, gas_type, size")
    .in("id", allIds.length ? allIds : ["00000000-0000-0000-0000-000000000000"]);
  const map = new Map((cyls ?? []).map((c) => [c.id, c]));

  const items: DeliveryNoteItemInput[] = [];
  for (const id of returnedIds) {
    const c = map.get(id);
    items.push({
      lineRole: "incoming_empty",
      cylinderState: "EMPTY_UNCLEANED",
      gasType: c?.gas_type ?? null,
      size: c?.size ?? null,
      quantity: 1,
      barcode: c?.barcode ?? null,
      cylinderId: id,
    });
  }
  for (const id of receivedIds) {
    const c = map.get(id);
    items.push({
      lineRole: "outgoing_full",
      cylinderState: "FULL",
      gasType: c?.gas_type ?? null,
      size: c?.size ?? null,
      quantity: 1,
      barcode: c?.barcode ?? null,
      cylinderId: id,
    });
  }

  const supplierName =
    (ex as { suppliers?: { name: string } }).suppliers?.name ?? "Beszállító";

  const { id } = await createDeliveryNoteDraft(
    {
      organizationId: args.organizationId,
      sourceType: "supplier_exchange",
      sourceId: args.supplierExchangeId,
      supplierId: ex.supplier_id,
      shipperName: args.organizationName,
      shipperAddress: args.shipperAddress ?? null,
      consigneeName: supplierName,
      consigneeAddress: null,
    },
    items,
  );

  const fin = await finalizeDeliveryNote(id);
  downloadDeliveryNotePdf(fin.pdfBytes, `${fin.documentNumber}.pdf`);
  return { ...fin, noteId: id };
}

export async function createAndFinalizeFromExchangeBatch(args: {
  organizationId: string;
  organizationName: string;
  partnerId: string;
  partnerName: string;
  partnerAddress?: string | null;
  batchId: string | null;
  exchangeIds: string[];
  shipperAddress?: string | null;
}): Promise<{ documentNumber: string; pdfBytes: Uint8Array; adrReady: boolean; noteId: string }> {
  const { data: rows, error } = await supabase
    .from("exchanges")
    .select(
      "id, incoming: cylinders!exchanges_incoming_cylinder_id_fkey ( id, barcode, gas_type, size ), outgoing: cylinders!exchanges_outgoing_cylinder_id_fkey ( id, barcode, gas_type, size )",
    )
    .in("id", args.exchangeIds);
  if (error) throw new Error(formatSupabaseError(error, "Csere tételek"));

  const items: DeliveryNoteItemInput[] = [];
  for (const row of rows ?? []) {
    const out = row.outgoing as { id: string; barcode: string; gas_type: string; size: string } | null;
    const inn = row.incoming as { id: string; barcode: string; gas_type: string; size: string } | null;
    if (out) {
      items.push({
        lineRole: "outgoing_full",
        cylinderState: "FULL",
        gasType: out.gas_type,
        size: out.size,
        quantity: 1,
        barcode: out.barcode,
        cylinderId: out.id,
      });
    }
    if (inn) {
      items.push({
        lineRole: "incoming_empty",
        cylinderState: "EMPTY_UNCLEANED",
        gasType: inn.gas_type,
        size: inn.size,
        quantity: 1,
        barcode: inn.barcode,
        cylinderId: inn.id,
      });
    }
  }

  const { id } = await createDeliveryNoteDraft(
    {
      organizationId: args.organizationId,
      sourceType: args.batchId ? "exchange_batch" : "quick_exchange",
      sourceId: args.batchId ?? args.exchangeIds[0] ?? null,
      partnerId: args.partnerId,
      shipperName: args.organizationName,
      shipperAddress: args.shipperAddress ?? null,
      consigneeName: args.partnerName,
      consigneeAddress: args.partnerAddress ?? null,
    },
    items,
  );

  const fin = await finalizeDeliveryNote(id);
  downloadDeliveryNotePdf(fin.pdfBytes, `${fin.documentNumber}.pdf`);
  return { ...fin, noteId: id };
}
