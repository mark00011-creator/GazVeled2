import { supabase } from "@/integrations/supabase/client";
import { formatSupabaseError, formatUserFacingError } from "@/lib/supabase-error";
import {
  ADR_RULESET_VERSION,
  ADR_UNVERIFIED_STARGON_C18,
  ADR_VERIFIED_SEEDS,
  calculateAdr1136,
  type AdrLineInput,
  type AdrProductData,
  type AdrCalculationResult,
} from "@/lib/adr/types-and-calc";
import { gasTypeToAdrKey, parseNetGasMassKg, parseWaterCapacityLitres } from "@/lib/adr/physical";
import {
  downloadDeliveryNotePdf,
  generateDeliveryNotePdfFromSnapshots,
  pdfBase64ToBytes,
  pdfBytesToBase64,
} from "@/lib/delivery-notes/pdf";
import type { DeliveryNoteBusinessSnapshot } from "@/lib/delivery-notes/snapshot";
import type {
  DeliveryNoteHeaderInput,
  DeliveryNoteItemInput,
  DeliveryNoteRow,
  DeliveryNoteStatus,
} from "@/lib/delivery-notes/types";
import { encodeCylinderMeta, parseCylinderMeta } from "@/lib/delivery-notes/cylinder-meta";
import {
  isDeliveryNotesEnabled,
  parseOrganizationSettings,
} from "@/lib/organization";

async function assertDeliveryNotesModule(organizationId: string): Promise<void> {
  const { data: orgRow, error } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw new Error(formatSupabaseError(error, "Cég beállítások"));
  const settings = parseOrganizationSettings(
    (orgRow as { settings?: unknown } | null)?.settings,
  );
  if (!isDeliveryNotesEnabled(settings)) {
    throw new Error("A szállítólevél modul nincs bekapcsolva ennél a cégnél");
  }
}

async function enrichBusinessSnapshotCylinderMeta(
  snap: DeliveryNoteBusinessSnapshot,
): Promise<DeliveryNoteBusinessSnapshot> {
  const barcodes = [
    ...new Set(
      (snap.items ?? [])
        .map((i) => i.barcode)
        .filter((b): b is string => !!b && b.trim().length > 0),
    ),
  ];
  if (barcodes.length === 0) return snap;

  const { data: cyls } = await supabase
    .from("cylinders")
    .select("barcode, manufacturer, circulation")
    .in("barcode", barcodes);
  const map = new Map((cyls ?? []).map((c) => [c.barcode, c]));

  return {
    ...snap,
    items: snap.items.map((it) => {
      const fromNote = parseCylinderMeta(it.note);
      const cyl = it.barcode ? map.get(it.barcode) : undefined;
      const manufacturer = it.manufacturer ?? fromNote.manufacturer ?? cyl?.manufacturer ?? null;
      const circulation = it.circulation ?? fromNote.circulation ?? cyl?.circulation ?? null;
      return {
        ...it,
        manufacturer,
        circulation,
        note:
          it.note?.startsWith("DNMETA:") || (!manufacturer && !circulation)
            ? it.note
            : encodeCylinderMeta({ manufacturer, circulation }, fromNote.userNote),
      };
    }),
  };
}

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

export async function resolveAdrProduct(
  gasType: string | null | undefined,
): Promise<AdrProductData> {
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
    /* tábla még nincs */
  }
  return fallbackProduct(key);
}

function enrichItem(item: DeliveryNoteItemInput): DeliveryNoteItemInput {
  return {
    ...item,
    waterCapacityL: item.waterCapacityL ?? parseWaterCapacityLitres(item.size),
    netGasMassKg: item.netGasMassKg ?? parseNetGasMassKg(item.size),
    adrProductKey: item.adrProductKey ?? gasTypeToAdrKey(item.gasType),
  };
}

export async function buildAdrForItems(items: DeliveryNoteItemInput[]) {
  const enriched = items.map(enrichItem);
  const products: AdrProductData[] = [];
  const lines: AdrLineInput[] = [];
  for (const it of enriched) {
    const product = await resolveAdrProduct(it.gasType);
    products.push(product);
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
  return { enriched, products, adr, adrReady };
}

export async function listDeliveryNotes(limit = 50): Promise<DeliveryNoteRow[]> {
  const { data, error } = await db
    .from("delivery_notes")
    .select(
      "id, organization_id, document_number, status, issued_at, partner_id, supplier_id, source_type, source_id, shipper_name, shipper_address, consignee_name, consignee_address, delivery_address, vehicle_plate, driver_name, adr_ruleset_version, adr_snapshot, business_snapshot, adr_total_points, adr_within_116, created_at, finalized_at, cancelled_at, cancellation_reason, pdf_base64",
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
  await assertDeliveryNotesModule(header.organizationId);
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
    note:
      it.note?.startsWith("DNMETA:")
        ? it.note
        : encodeCylinderMeta(
            { manufacturer: it.manufacturer ?? null, circulation: it.circulation ?? null },
            it.note ?? null,
          ),
    sort_order: i,
  }));

  const { error: itemErr } = await db.from("delivery_note_items").insert(rows);
  if (itemErr) {
    await db.from("delivery_notes").delete().eq("id", note.id).eq("status", "draft");
    throw new Error(formatSupabaseError(itemErr, "Szállítólevél tételek"));
  }

  return { id: note.id as string, adrReady };
}

type FinalizeRpcResult = {
  id: string;
  document_number: string;
  status: DeliveryNoteStatus;
  issued_at: string;
  finalized_at: string;
  adr_snapshot: AdrCalculationResult;
  business_snapshot: DeliveryNoteBusinessSnapshot;
  adr_total_points: number;
  adr_within_116: boolean;
  cancellation_reason?: string | null;
};

/**
 * Finalize via single SECURITY DEFINER RPC.
 * Authority: server builds ADR + business snapshots from DB (items + master + partner/org).
 * Client preview ADR is NOT sent and MUST NOT influence finalized data.
 * PDF is generated from RPC-returned snapshots only, then attached once.
 */
export async function finalizeDeliveryNote(noteId: string): Promise<{
  documentNumber: string;
  pdfBytes: Uint8Array;
  adrReady: boolean;
  status: DeliveryNoteStatus;
}> {
  const { data: note, error } = await db
    .from("delivery_notes")
    .select("*")
    .eq("id", noteId)
    .single();
  if (error || !note) throw new Error(formatSupabaseError(error, "Szállítólevél betöltése"));
  if (note.status === "finalized") throw new Error("A szállítólevél már véglegesítve van");
  if (note.status === "cancelled")
    throw new Error("Érvénytelenített szállítólevél nem véglegesíthető");
  if (note.status !== "draft") throw new Error("Csak piszkozat véglegesíthető");

  const { data: rpcData, error: rpcErr } = await db.rpc("finalize_delivery_note", {
    p_delivery_note_id: noteId,
  });

  if (rpcErr) throw new Error(formatSupabaseError(rpcErr, "Szállítólevél véglegesítés"));
  if (!rpcData?.document_number || rpcData.status !== "finalized") {
    throw new Error("Finalize RPC nem adott vissza véglegesített dokumentumot");
  }
  if (!rpcData.adr_snapshot || !rpcData.business_snapshot) {
    throw new Error("Finalize RPC nem adott vissza szerveroldali snapshotot");
  }

  const fin = rpcData as FinalizeRpcResult;
  const serverAdrReady = (fin.adr_snapshot?.blockingWarnings?.length ?? 0) === 0;
  const business = await enrichBusinessSnapshotCylinderMeta(fin.business_snapshot);
  const pdfBytes = await generateDeliveryNotePdfFromSnapshots({
    documentNumber: fin.document_number,
    issuedAtIso: fin.issued_at ?? fin.finalized_at,
    status: "finalized",
    sourceType: (note as { source_type?: string }).source_type ?? business.sourceType ?? null,
    business,
    adr: fin.adr_snapshot,
  });

  const { error: pdfErr } = await db.rpc("attach_delivery_note_pdf", {
    p_note_id: noteId,
    p_pdf_base64: pdfBytesToBase64(pdfBytes),
  });
  if (pdfErr) throw new Error(formatSupabaseError(pdfErr, "PDF csatolás"));

  return {
    documentNumber: fin.document_number,
    pdfBytes,
    adrReady: serverAdrReady,
    status: "finalized",
  };
}

export async function cancelDeliveryNote(
  noteId: string,
  reason: string,
): Promise<{ documentNumber: string; pdfBytes: Uint8Array }> {
  if (!reason.trim()) throw new Error("Az érvénytelenítés indoka kötelező");

  const { data: note, error } = await db
    .from("delivery_notes")
    .select(
      "id, status, source_type, document_number, issued_at, finalized_at, adr_snapshot, business_snapshot, cancellation_reason",
    )
    .eq("id", noteId)
    .single();
  if (error || !note) throw new Error(formatSupabaseError(error, "Szállítólevél"));
  if (note.status !== "finalized")
    throw new Error("Csak véglegesített szállítólevél érvényteleníthető");

  const business = note.business_snapshot as DeliveryNoteBusinessSnapshot;
  const adr = note.adr_snapshot as AdrCalculationResult;
  if (!business || !adr || !note.document_number) {
    throw new Error(
      "Hiányzó ADR/üzleti snapshot – érvénytelenítés nem lehetséges. A bizonylat adatbázisból admin törlést igényel.",
    );
  }

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateDeliveryNotePdfFromSnapshots({
      documentNumber: note.document_number,
      issuedAtIso: note.issued_at ?? note.finalized_at,
      status: "cancelled",
      cancellationReason: reason.trim(),
      sourceType: note.source_type,
      business: await enrichBusinessSnapshotCylinderMeta(business),
      adr,
    });
  } catch (e) {
    throw new Error(
      formatUserFacingError(e, "Érvénytelenített PDF előállítása sikertelen"),
    );
  }

  const { data: rpcData, error: rpcErr } = await db.rpc("cancel_delivery_note", {
    p_note_id: noteId,
    p_reason: reason.trim(),
    p_pdf_base64: pdfBytesToBase64(pdfBytes),
  });
  if (rpcErr) throw new Error(formatSupabaseError(rpcErr, "Érvénytelenítés"));
  if (!rpcData || rpcData.status !== "cancelled") {
    throw new Error("Cancel RPC nem adott vissza érvénytelenített dokumentumot");
  }

  return { documentNumber: rpcData.document_number as string, pdfBytes };
}

export async function downloadStoredDeliveryNotePdf(noteId: string): Promise<void> {
  const { data: note, error } = await db
    .from("delivery_notes")
    .select(
      "document_number, status, source_type, pdf_base64, issued_at, finalized_at, cancelled_at, cancellation_reason, adr_snapshot, business_snapshot",
    )
    .eq("id", noteId)
    .single();
  if (error || !note) throw new Error(formatSupabaseError(error, "Szállítólevél"));
  if (note.status === "draft") throw new Error("Piszkozathoz még nincs végleges PDF");

  let bytes: Uint8Array;
  if (note.pdf_base64) {
    bytes = pdfBase64ToBytes(note.pdf_base64 as string);
  } else {
    const business = await enrichBusinessSnapshotCylinderMeta(
      note.business_snapshot as DeliveryNoteBusinessSnapshot,
    );
    const adr = note.adr_snapshot as AdrCalculationResult;
    if (!business || !adr || !note.document_number) {
      throw new Error("Hiányzó snapshot/PDF");
    }
    bytes = await generateDeliveryNotePdfFromSnapshots({
      documentNumber: note.document_number,
      issuedAtIso: note.issued_at ?? note.finalized_at,
      status: note.status === "cancelled" ? "cancelled" : "finalized",
      cancellationReason: note.cancellation_reason,
      sourceType: note.source_type,
      business,
      adr,
    });
  }
  downloadDeliveryNotePdf(bytes, `${note.document_number ?? "SZL"}.pdf`);
}

export async function createAndFinalizeFromSupplierExchange(args: {
  organizationId: string;
  organizationName: string;
  supplierExchangeId: string;
  shipperAddress?: string | null;
}): Promise<{ documentNumber: string; pdfBytes: Uint8Array; adrReady: boolean; noteId: string }> {
  const { data: ex, error } = await db
    .from("supplier_exchanges")
    .select("*, suppliers(name, address, tax_number)")
    .eq("id", args.supplierExchangeId)
    .single();
  if (error || !ex) throw new Error(formatSupabaseError(error, "Beszállítói csere"));

  // Prefer an already-finalized note for this exchange (PDF re-download).
  const { data: existingFinal } = await db
    .from("delivery_notes")
    .select("id, document_number, status")
    .eq("organization_id", args.organizationId)
    .eq("source_type", "supplier_exchange")
    .eq("source_id", args.supplierExchangeId)
    .eq("status", "finalized")
    .order("finalized_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingFinal?.id) {
    const pdfBytes = await downloadExistingDeliveryNotePdf(existingFinal.id);
    return {
      documentNumber: existingFinal.document_number ?? "SZL",
      pdfBytes,
      adrReady: true,
      noteId: existingFinal.id,
    };
  }

  // Drop orphan drafts so we always rebuild with barcode · manufacturer · gas · size · circulation.
  const { data: orphanDrafts } = await db
    .from("delivery_notes")
    .select("id")
    .eq("organization_id", args.organizationId)
    .eq("source_type", "supplier_exchange")
    .eq("source_id", args.supplierExchangeId)
    .eq("status", "draft");
  for (const d of orphanDrafts ?? []) {
    if (!d?.id) continue;
    await db.from("delivery_note_items").delete().eq("delivery_note_id", d.id);
    await db.from("delivery_notes").delete().eq("id", d.id).eq("status", "draft");
  }

  const returnedIds = (ex.returned_cylinder_ids as string[]) ?? [];
  const receivedIds = (ex.received_cylinder_ids as string[]) ?? [];
  const allIds = [...returnedIds, ...receivedIds];
  const { data: cyls } = await supabase
    .from("cylinders")
    .select("id, barcode, gas_type, size, manufacturer, circulation")
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
      manufacturer: c?.manufacturer ?? null,
      circulation: c?.circulation ?? null,
      note: encodeCylinderMeta({
        manufacturer: c?.manufacturer ?? null,
        circulation: c?.circulation ?? null,
      }),
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
      manufacturer: c?.manufacturer ?? null,
      circulation: c?.circulation ?? null,
      note: encodeCylinderMeta({
        manufacturer: c?.manufacturer ?? null,
        circulation: c?.circulation ?? null,
      }),
    });
  }

  const supplier = (ex as {
    suppliers?: { name?: string; address?: string | null; tax_number?: string | null };
  }).suppliers;
  const supplierName = supplier?.name ?? "Beszállító";
  const supplierAddress = supplier?.address ?? null;

  const created = await createDeliveryNoteDraft(
    {
      organizationId: args.organizationId,
      sourceType: "supplier_exchange",
      sourceId: args.supplierExchangeId,
      supplierId: ex.supplier_id,
      shipperName: args.organizationName,
      shipperAddress: args.shipperAddress ?? null,
      consigneeName: supplierName,
      consigneeAddress: supplierAddress,
      consigneeTaxNumber: supplier?.tax_number ?? null,
    },
    items,
  );
  const noteId = created.id;

  try {
    const fin = await finalizeDeliveryNote(noteId);
    downloadDeliveryNotePdf(fin.pdfBytes, `${fin.documentNumber}.pdf`);
    return { ...fin, noteId };
  } catch (err) {
    console.error("Szállítólevél finalize/PDF hiba (beszállítói csere)", {
      supplierExchangeId: args.supplierExchangeId,
      noteId,
      err,
    });
    throw new Error(
      formatUserFacingError(
        err,
        "A szállítólevél véglegesítése sikertelen. Nyisd meg a Szállítólevelek oldalt.",
      ),
    );
  }
}

async function downloadExistingDeliveryNotePdf(noteId: string): Promise<Uint8Array> {
  const { data: note, error } = await db
    .from("delivery_notes")
    .select(
      "document_number, status, source_type, pdf_base64, issued_at, finalized_at, cancellation_reason, adr_snapshot, business_snapshot",
    )
    .eq("id", noteId)
    .single();
  if (error || !note) throw new Error(formatSupabaseError(error, "Szállítólevél betöltése"));
  if (note.status === "draft") throw new Error("Piszkozathoz még nincs végleges PDF");

  let bytes: Uint8Array;
  if (note.pdf_base64) {
    bytes = pdfBase64ToBytes(note.pdf_base64 as string);
  } else {
    const business = await enrichBusinessSnapshotCylinderMeta(
      note.business_snapshot as DeliveryNoteBusinessSnapshot,
    );
    const adr = note.adr_snapshot as AdrCalculationResult;
    if (!business || !adr || !note.document_number) {
      throw new Error("Hiányzó snapshot/PDF");
    }
    bytes = await generateDeliveryNotePdfFromSnapshots({
      documentNumber: note.document_number,
      issuedAtIso: note.issued_at ?? note.finalized_at,
      status: note.status === "cancelled" ? "cancelled" : "finalized",
      cancellationReason: note.cancellation_reason,
      sourceType: note.source_type,
      business,
      adr,
    });
    const { error: pdfErr } = await db.rpc("attach_delivery_note_pdf", {
      p_note_id: noteId,
      p_pdf_base64: pdfBytesToBase64(bytes),
    });
    if (pdfErr) console.warn("PDF csatolás sikertelen (újratöltés után mégis letölthető)", pdfErr);
  }
  downloadDeliveryNotePdf(bytes, `${note.document_number ?? "SZL"}.pdf`);
  return bytes;
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
      "id, note, operation_type, incoming: cylinders!exchanges_incoming_cylinder_id_fkey ( id, barcode, gas_type, size ), outgoing: cylinders!exchanges_outgoing_cylinder_id_fkey ( id, barcode, gas_type, size )",
    )
    .in("id", args.exchangeIds);
  if (error) throw new Error(formatSupabaseError(error, "Csere tételek"));

  const items: DeliveryNoteItemInput[] = [];
  for (const row of rows ?? []) {
    const out = row.outgoing as {
      id: string;
      barcode: string;
      gas_type: string;
      size: string;
    } | null;
    const inn = row.incoming as {
      id: string;
      barcode: string;
      gas_type: string;
      size: string;
    } | null;
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
    // Darabszámos kínai: nincs cylinder FK – note-ból
    if (!out && !inn) {
      const note = String((row as { note?: string | null }).note ?? "");
      const m = note.match(
        /Kínai csere:\s*([^·]+?)\s+([^·]+?)\s*·\s*teli ki\s+(\d+)\s*·\s*üres vissza\s+(\d+)/i,
      );
      if (m) {
        const gasType = m[1].trim();
        const size = m[2].trim();
        const fullOut = Number(m[3]);
        const emptyIn = Number(m[4]);
        if (fullOut > 0) {
          items.push({
            lineRole: "outgoing_full",
            cylinderState: "FULL",
            gasType,
            size,
            quantity: fullOut,
            barcode: null,
            cylinderId: null,
            note: "kínai / darabszámos",
          });
        }
        if (emptyIn > 0) {
          items.push({
            lineRole: "incoming_empty",
            cylinderState: "EMPTY_UNCLEANED",
            gasType,
            size,
            quantity: emptyIn,
            barcode: null,
            cylinderId: null,
            note: "kínai / darabszámos",
          });
        }
      }
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
