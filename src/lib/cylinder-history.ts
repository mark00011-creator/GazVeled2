import { supabase } from "@/integrations/supabase/client";
import {
  circulationLabels,
  formatPressureTestYear,
  locationLabels,
  manufacturerLabels,
  statusLabels,
  type Circulation,
  type Manufacturer,
} from "@/lib/labels";
import type { CylinderRow } from "@/lib/cylinder-ops";

export type CylinderHistoryEventType =
  | "cylinder_created"
  | "cylinder_edited"
  | "quick_exchange"
  | "forced_substitution"
  | "circulation_difference_created"
  | "circulation_difference_partial_settlement"
  | "circulation_difference_closed"
  | "chinese_brought"
  | "chinese_take"
  | "partner_issue"
  | "partner_return"
  | "rental_start"
  | "rental_extend"
  | "rental_close"
  | "warehouse_arrival"
  | "warehouse_departure"
  | "location_change"
  | "status_change"
  | "manufacturer_change"
  | "owner_change"
  | "gas_type_change"
  | "size_change"
  | "pressure_test_year_change"
  | "loan_issue"
  | "loan_return_empty"
  | "loan_return_full"
  | "supplier_exchange"
  | "temp_to_serial"
  | "temp_to_chinese"
  | "barcode_change"
  | "complaint";

export const cylinderHistoryEventLabels: Record<CylinderHistoryEventType, string> = {
  cylinder_created: "Palack létrehozása",
  cylinder_edited: "Palack szerkesztése",
  quick_exchange: "Gyors csere",
  forced_substitution: "Kényszerhelyettesítés",
  circulation_difference_created: "Körforgás-eltérés létrehozva",
  circulation_difference_partial_settlement: "Körforgás-eltérés részben rendezve",
  circulation_difference_closed: "Körforgás-eltérés lezárva",
  chinese_brought: "Hozott kínai",
  chinese_take: "Kínait visz",
  partner_issue: "Partnerhez kiadás",
  partner_return: "Partnertől visszavétel",
  rental_start: "Bérbeadás",
  rental_extend: "Bérlet hosszabbítás",
  rental_close: "Bérlet lezárása",
  warehouse_arrival: "Telephelyre érkezés",
  warehouse_departure: "Telephelyről kiadás",
  location_change: "Helyszín módosítása",
  status_change: "Státusz módosítás",
  manufacturer_change: "Gyártó módosítása",
  owner_change: "Tulajdonos módosítása",
  gas_type_change: "Gáz típusa módosítása",
  size_change: "Méret módosítása",
  pressure_test_year_change: "Nyomáspróba módosítás",
  loan_issue: "Kölcsön kiadás",
  loan_return_empty: "Kölcsön visszavétel (üres)",
  loan_return_full: "Kölcsön visszavétel (teli)",
  supplier_exchange: "Szolgáltatói csere",
  temp_to_serial: "TEMP → valós sorszám",
  temp_to_chinese: "TEMP → kínai tétel",
  barcode_change: "Vonalkód módosítás",
  complaint: "Reklamáció",
};

export type CylinderHistoryRow = {
  id: string;
  cylinder_id: string;
  event_type: CylinderHistoryEventType;
  description: string | null;
  partner_id: string | null;
  old_value: string | null;
  new_value: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
  partners?: { name: string } | null;
};

type LogEntry = {
  cylinder_id: string;
  event_type: CylinderHistoryEventType;
  description?: string | null;
  partner_id?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  metadata?: Record<string, unknown>;
  created_by?: string | null;
};

const WAREHOUSE_LOCS = new Set(["warehouse_full", "warehouse_empty"]);

function formatLocation(loc: string | null | undefined, partnerId?: string | null): string {
  if (!loc) return "—";
  const label = locationLabels[loc] ?? loc;
  return partnerId ? `${label} (partner)` : label;
}

function formatStatus(s: string | null | undefined): string {
  if (!s) return "—";
  return statusLabels[s] ?? s;
}

function formatOwner(o: string | null | undefined): string {
  if (!o) return "—";
  return circulationLabels[o as Circulation] ?? o;
}

function formatManufacturer(m: string | null | undefined): string {
  if (!m) return "—";
  return manufacturerLabels[m as Manufacturer] ?? m;
}

function formatYear(y: number | null | undefined): string {
  return formatPressureTestYear(y);
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function currentUserLabel(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  if (!u) return null;
  return u.email ?? u.id;
}

export async function logCylinderHistory(entry: LogEntry): Promise<void> {
  const created_by = entry.created_by ?? (await currentUserId());
  const user_label = await currentUserLabel();
  const metadata = {
    ...(entry.metadata ?? {}),
    ...(user_label ? { user_label } : {}),
  };
  const { error } = await supabase.from("cylinder_history").insert({
    cylinder_id: entry.cylinder_id,
    event_type: entry.event_type,
    description: entry.description ?? null,
    partner_id: entry.partner_id ?? null,
    old_value: entry.old_value ?? null,
    new_value: entry.new_value ?? null,
    metadata,
    created_by,
  });
  if (error) throw new Error(error.message);
}

export async function fetchCylinderHistory(cylinderId: string): Promise<CylinderHistoryRow[]> {
  const { data, error } = await supabase
    .from("cylinder_history")
    .select("id, cylinder_id, event_type, description, partner_id, old_value, new_value, metadata, created_at, created_by, partners:partner_id(name)")
    .eq("cylinder_id", cylinderId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((row): row is NonNullable<typeof row> => row != null && typeof row.id === "string")
    .map((row) => ({
      ...row,
      description: row.description ?? null,
      partner_id: row.partner_id ?? null,
      old_value: row.old_value ?? null,
      new_value: row.new_value ?? null,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      created_at: row.created_at ?? new Date(0).toISOString(),
      created_by: row.created_by ?? null,
      partners: row.partners ?? null,
    })) as CylinderHistoryRow[];
}

export async function logCylinderCreated(cyl: CylinderRow, description?: string): Promise<void> {
  await logCylinderHistory({
    cylinder_id: cyl.id,
    event_type: "cylinder_created",
    description: description ?? `Palack felvéve: ${cyl.barcode}`,
    new_value: `${cyl.gas_type} · ${cyl.size}`,
    metadata: { barcode: cyl.barcode },
  });
}

type UpdateOptions = { skipHistory?: boolean; partnerId?: string | null };

export async function logCylinderUpdateDiff(
  before: CylinderRow,
  after: CylinderRow,
  options?: UpdateOptions,
): Promise<void> {
  if (options?.skipHistory) return;

  const partnerId = options?.partnerId ?? after.location_partner_id ?? before.location_partner_id;

  if (before.status !== after.status) {
    await logCylinderHistory({
      cylinder_id: after.id,
      event_type: "status_change",
      partner_id: partnerId,
      old_value: formatStatus(before.status),
      new_value: formatStatus(after.status),
    });
  }

  if (before.manufacturer !== after.manufacturer) {
    await logCylinderHistory({
      cylinder_id: after.id,
      event_type: "manufacturer_change",
      partner_id: partnerId,
      old_value: formatManufacturer(before.manufacturer),
      new_value: formatManufacturer(after.manufacturer),
    });
  }

  if (before.owner !== after.owner) {
    await logCylinderHistory({
      cylinder_id: after.id,
      event_type: "owner_change",
      partner_id: partnerId,
      old_value: formatOwner(before.owner),
      new_value: formatOwner(after.owner),
    });
  }

  if (before.gas_type !== after.gas_type) {
    await logCylinderHistory({
      cylinder_id: after.id,
      event_type: "gas_type_change",
      partner_id: partnerId,
      old_value: before.gas_type,
      new_value: after.gas_type,
    });
  }

  if (before.size !== after.size) {
    await logCylinderHistory({
      cylinder_id: after.id,
      event_type: "size_change",
      partner_id: partnerId,
      old_value: before.size,
      new_value: after.size,
    });
  }

  if (before.pressure_test_year !== after.pressure_test_year) {
    await logCylinderHistory({
      cylinder_id: after.id,
      event_type: "pressure_test_year_change",
      partner_id: partnerId,
      old_value: formatYear(before.pressure_test_year),
      new_value: formatYear(after.pressure_test_year),
    });
  }

  const locChanged =
    before.location_type !== after.location_type ||
    before.location_partner_id !== after.location_partner_id ||
    before.location_supplier_id !== after.location_supplier_id;

  if (locChanged) {
    const fromWh = WAREHOUSE_LOCS.has(before.location_type);
    const toWh = WAREHOUSE_LOCS.has(after.location_type);
    const fromCustomer = before.location_type === "customer";
    const toCustomer = after.location_type === "customer";

    let eventType: CylinderHistoryEventType = "location_change";
    if (toCustomer && after.location_partner_id) eventType = "partner_issue";
    else if (fromCustomer && toWh) eventType = "partner_return";
    else if (fromWh && toCustomer) eventType = "warehouse_departure";
    else if (!fromWh && toWh) eventType = "warehouse_arrival";

    await logCylinderHistory({
      cylinder_id: after.id,
      event_type: eventType,
      partner_id: partnerId,
      old_value: formatLocation(before.location_type, before.location_partner_id),
      new_value: formatLocation(after.location_type, after.location_partner_id),
    });
  }

  if (before.barcode !== after.barcode || before.circulation !== after.circulation) {
    if (before.barcode !== after.barcode) {
      await logCylinderHistory({
        cylinder_id: after.id,
        event_type: "barcode_change",
        partner_id: partnerId,
        old_value: before.barcode,
        new_value: after.barcode,
      });
    }
    if (before.circulation !== after.circulation) {
      await logCylinderHistory({
        cylinder_id: after.id,
        event_type: "cylinder_edited",
        partner_id: partnerId,
        description: `Körforgás: ${formatOwner(before.circulation)} → ${formatOwner(after.circulation)}`,
      });
    }
  }
}

export async function logQuickExchange(args: {
  incoming_id: string;
  outgoing_id: string;
  partner_id: string;
  incoming_barcode: string;
  outgoing_barcode: string;
  partner_name?: string;
}): Promise<void> {
  const desc = [
    args.partner_name ? `Partner: ${args.partner_name}` : null,
    `Leadott: ${args.incoming_barcode}`,
    `Kapott: ${args.outgoing_barcode}`,
  ]
    .filter(Boolean)
    .join("\n");

  const meta = {
    incoming_barcode: args.incoming_barcode,
    outgoing_barcode: args.outgoing_barcode,
    partner_name: args.partner_name,
  };

  await logCylinderHistory({
    cylinder_id: args.incoming_id,
    event_type: "quick_exchange",
    partner_id: args.partner_id,
    description: desc,
    metadata: meta,
  });
  await logCylinderHistory({
    cylinder_id: args.outgoing_id,
    event_type: "quick_exchange",
    partner_id: args.partner_id,
    description: desc,
    metadata: meta,
  });
}

export async function logPartnerIssue(
  cylinderId: string,
  partnerId: string,
  barcode: string,
  partnerName?: string,
): Promise<void> {
  await logCylinderHistory({
    cylinder_id: cylinderId,
    event_type: "partner_issue",
    partner_id: partnerId,
    description: partnerName ? `Partner: ${partnerName}` : undefined,
    new_value: barcode,
  });
}

export async function logPartnerReturn(
  cylinderId: string,
  partnerId: string,
  barcode: string,
  partnerName?: string,
): Promise<void> {
  await logCylinderHistory({
    cylinder_id: cylinderId,
    event_type: "partner_return",
    partner_id: partnerId,
    description: partnerName ? `Partner: ${partnerName}` : undefined,
    old_value: barcode,
  });
}

export async function logRentalStart(
  cylinderId: string,
  partnerId: string,
  rentalId: string,
  partnerName?: string,
): Promise<void> {
  await logCylinderHistory({
    cylinder_id: cylinderId,
    event_type: "rental_start",
    partner_id: partnerId,
    description: partnerName ? `Partner: ${partnerName}` : "Bérletbe kiadva",
    metadata: { rental_id: rentalId },
  });
}

export async function logRentalExtend(
  cylinderId: string,
  partnerId: string,
  rentalId: string,
  oldExpiry: string | null,
  newExpiry: string | null,
): Promise<void> {
  await logCylinderHistory({
    cylinder_id: cylinderId,
    event_type: "rental_extend",
    partner_id: partnerId,
    old_value: oldExpiry ?? "—",
    new_value: newExpiry ?? "—",
    metadata: { rental_id: rentalId },
  });
}

export async function logRentalClose(
  cylinderId: string,
  partnerId: string,
  rentalId: string,
  partnerName?: string,
): Promise<void> {
  await logCylinderHistory({
    cylinder_id: cylinderId,
    event_type: "rental_close",
    partner_id: partnerId,
    description: partnerName ? `Partner: ${partnerName}` : "Bérlet lezárva",
    metadata: { rental_id: rentalId },
  });
}

export async function logLoanIssue(
  cylinderId: string,
  partnerId: string,
  barcode: string,
  loanId: string,
  partnerName?: string,
): Promise<void> {
  await logCylinderHistory({
    cylinder_id: cylinderId,
    event_type: "loan_issue",
    partner_id: partnerId,
    description: partnerName ? `Partner: ${partnerName}` : "Kölcsön kiadva",
    new_value: barcode,
    metadata: { loan_id: loanId },
  });
}

export async function logLoanReturn(args: {
  cylinderId: string;
  partnerId: string;
  barcode: string;
  loanId: string;
  mode: "empty" | "full";
  partnerName?: string;
  note?: string | null;
}): Promise<void> {
  await logCylinderHistory({
    cylinder_id: args.cylinderId,
    event_type: args.mode === "full" ? "loan_return_full" : "loan_return_empty",
    partner_id: args.partnerId,
    description: [args.partnerName ? `Partner: ${args.partnerName}` : null, args.note?.trim() || null]
      .filter(Boolean)
      .join("\n"),
    old_value: args.barcode,
    metadata: { loan_id: args.loanId, return_mode: args.mode },
  });
}

export async function logSupplierExchangeForCylinder(args: {
  cylinderId: string;
  supplierId: string;
  supplierName: string;
  role: "returned" | "received";
  barcode: string;
  pairedBarcodes: string[];
  exchangeId: string;
  note?: string | null;
}): Promise<void> {
  const paired = args.pairedBarcodes.filter(Boolean);
  await logCylinderHistory({
    cylinder_id: args.cylinderId,
    event_type: "supplier_exchange",
    description: [
      `Szolgáltató: ${args.supplierName}`,
      args.role === "returned"
        ? `Visszaadott palack: ${args.barcode}`
        : `Átvett palack: ${args.barcode}`,
      paired.length > 0 ? `Párban: ${paired.join(", ")}` : null,
      args.note?.trim() ? `Megjegyzés: ${args.note.trim()}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    old_value: args.role === "returned" ? args.barcode : paired[0] ?? null,
    new_value: args.role === "received" ? args.barcode : paired[0] ?? null,
    metadata: {
      supplier_id: args.supplierId,
      supplier_name: args.supplierName,
      supplier_exchange_id: args.exchangeId,
      role: args.role,
    },
  });
}

export async function logTempToSerial(args: {
  cylinderId: string;
  oldBarcode: string;
  newBarcode: string;
  rentalId?: string | null;
}): Promise<void> {
  await logCylinderHistory({
    cylinder_id: args.cylinderId,
    event_type: "temp_to_serial",
    old_value: args.oldBarcode,
    new_value: args.newBarcode,
    metadata: { rental_id: args.rentalId ?? null },
  });
}

export async function logTempToChinese(args: {
  cylinderId: string;
  tempBarcode: string;
  rentalId: string;
  gas_type: string;
  size: string;
  quantity: number;
}): Promise<void> {
  await logCylinderHistory({
    cylinder_id: args.cylinderId,
    event_type: "temp_to_chinese",
    old_value: args.tempBarcode,
    new_value: `${args.gas_type} · ${args.size} · ${args.quantity} db`,
    metadata: { rental_id: args.rentalId },
  });
}

export async function fetchPartnerName(partnerId: string): Promise<string | undefined> {
  const { data } = await supabase.from("partners").select("name").eq("id", partnerId).maybeSingle();
  return data?.name ?? undefined;
}

export async function logCirculationDifferenceEvents(args: {
  exchange_id: string;
  partner_id: string;
  incoming_id?: string;
  outgoing_id?: string;
  incoming_barcode?: string;
  outgoing_barcode?: string;
  partner_name?: string;
  incoming_side: { key: string; gas_type: string; size: string };
  outgoing_side: { key: string; gas_type: string; size: string };
  reason?: string | null;
  settlement_only?: boolean;
}): Promise<void> {
  const forced =
    args.incoming_side.key !== args.outgoing_side.key ||
    args.incoming_side.gas_type !== args.outgoing_side.gas_type;

  const { data: createdDiff } = await supabase
    .from("circulation_differences")
    .select("*")
    .eq("exchange_id", args.exchange_id)
    .maybeSingle();

  const { data: settlements } = await supabase
    .from("circulation_difference_settlements")
    .select("*, circulation_differences(*)")
    .eq("settling_exchange_id", args.exchange_id);

  const warnText = createdDiff
    ? `${formatExchangeCirculationLabel(createdDiff.incoming_exchange_circulation)} ${createdDiff.incoming_gas_type} ${createdDiff.size} helyett ${formatExchangeCirculationLabel(createdDiff.outgoing_exchange_circulation)} ${createdDiff.outgoing_gas_type} ${createdDiff.size} lett kiadva.`
    : null;

  if (forced && !args.settlement_only && createdDiff) {
    const meta = {
      difference_id: createdDiff.id,
      incoming_key: args.incoming_side.key,
      outgoing_key: args.outgoing_side.key,
    };
    if (args.incoming_id) {
      await logCylinderHistory({
        cylinder_id: args.incoming_id,
        event_type: "circulation_difference_created",
        partner_id: args.partner_id,
        description: warnText ?? undefined,
        metadata: meta,
      });
      await logCylinderHistory({
        cylinder_id: args.incoming_id,
        event_type: "forced_substitution",
        partner_id: args.partner_id,
        description: args.reason ? `Indok: ${args.reason}` : warnText ?? undefined,
        metadata: meta,
      });
    }
    if (args.outgoing_id) {
      await logCylinderHistory({
        cylinder_id: args.outgoing_id,
        event_type: "circulation_difference_created",
        partner_id: args.partner_id,
        description: warnText ?? undefined,
        metadata: meta,
      });
    }
  }

  for (const s of settlements ?? []) {
    const diff = (s as { circulation_differences?: { id: string; status: string } })
      .circulation_differences;
    if (!diff) continue;
    const eventType =
      diff.status === "closed"
        ? "circulation_difference_closed"
        : "circulation_difference_partial_settlement";
    const targetId = args.incoming_id ?? args.outgoing_id;
    if (!targetId) continue;
    await logCylinderHistory({
      cylinder_id: targetId,
      event_type: eventType,
      partner_id: args.partner_id,
      description: `Rendezve: ${s.quantity_settled} db`,
      metadata: { difference_id: diff.id, settling_exchange_id: args.exchange_id },
    });
  }
}

function formatExchangeCirculationLabel(key: string): string {
  const labels: Record<string, string> = {
    siad_rental: "SIAD bérpalack",
    own_siad: "SIAD saját",
    linde: "LINDE",
    messer: "MESSER",
    other: "Egyéb",
    chinese: "Kínai",
    flaga_pb: "FLAGA PB",
    prima_pb: "PRÍMA PB",
  };
  return labels[key] ?? key;
}
