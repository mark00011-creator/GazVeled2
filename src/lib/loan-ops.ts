import { supabase } from "@/integrations/supabase/client";
import {
  fetchPartnerName,
  logLoanIssue,
  logLoanReturn,
  logPartnerIssue,
  logPartnerReturn,
} from "@/lib/cylinder-history";
import {
  findCylinderByBarcode,
  normalizeBarcode,
  type CylinderRow,
} from "@/lib/cylinder-ops";
import { locationLabels } from "@/lib/labels";
import { fetchProductPrices, lookupProductPrice } from "@/lib/product-prices";
import { formatSupabaseError } from "@/lib/supabase-error";

const LOAN_RECORD_FAILURE = "A kölcsön rögzítése nem sikerült.";

export type CylinderLoanStatus = "active" | "returned";

export type CylinderLoanRow = {
  id: string;
  partner_id: string;
  cylinder_id: string;
  returned_cylinder_id: string | null;
  exchange_id: string | null;
  loaned_at: string;
  returned_at: string | null;
  status: CylinderLoanStatus;
  created_by: string | null;
  note: string | null;
  return_note: string | null;
  created_at: string;
  updated_at: string;
};

export type LoanedCylinderDetail = {
  loan_id: string;
  loaned_at: string;
  note: string | null;
  cylinder_id: string;
  barcode: string;
  gas_type: string;
  size: string;
  status: string;
};

export type PartnerLoanSummary = {
  partner_id: string;
  partner_name: string;
  company_name: string | null;
  phone: string | null;
  loans: LoanedCylinderDetail[];
};

function parseDbError(message: string): string {
  if (message.includes("Missing cylinder")) return "Palack nem található az adatbázisban";
  if (message.includes("Missing partner")) return "Hiányzó partner";
  if (message.includes("Kölcsön rekord")) return message;
  if (message.includes("már kölcsönadott")) return "A palack már kölcsönadott";
  if (message.includes("aktív bérletben")) return "A palack aktív bérletben van";
  if (message.includes("telephelyi teli")) return "A kölcsön palacknak a telephelyi teli készletből kell jönnie";
  if (message.includes("teli állapotúnak")) return "A kiadott palacknak teli állapotúnak kell lennie";
  return message;
}

function loanFailureError(detail: string): Error {
  return new Error(`${LOAN_RECORD_FAILURE} ${detail}`);
}

/** Kölcsön kiadáshoz csak telephelyi teli készletből választható palack. */
export function getLoanOutgoingValidationError(cyl: CylinderRow): string | null {
  if (cyl.status !== "full") {
    return "A kiadott palacknak teli állapotúnak kell lennie (telephelyi teli készlet).";
  }
  if (cyl.location_type !== "warehouse_full") {
    const loc = locationLabels[cyl.location_type] ?? cyl.location_type;
    return `A kölcsön palacknak a telephelyi teli készletből kell jönnie (jelenleg: ${loc}).`;
  }
  return null;
}

/** Kölcsön kiadás: 0 üres → 1 teli (gyors csere). */
export async function recordCylinderLoan(args: {
  partner_id: string;
  outgoing_id: string;
  note?: string | null;
}): Promise<string> {
  const { data: fresh, error: fetchErr } = await supabase
    .from("cylinders")
    .select("*")
    .eq("id", args.outgoing_id)
    .single();

  if (fetchErr || !fresh) {
    throw loanFailureError(parseDbError(fetchErr?.message ?? "Palack nem található az adatbázisban"));
  }

  const validationErr = getLoanOutgoingValidationError(fresh as CylinderRow);
  if (validationErr) throw loanFailureError(validationErr);

  const trimmedNote = args.note?.trim();
  const { data, error } = await supabase.rpc("record_cylinder_loan", {
    p_partner_id: args.partner_id,
    p_outgoing_id: args.outgoing_id,
    ...(trimmedNote ? { p_note: trimmedNote } : {}),
  });

  if (error) {
    throw loanFailureError(parseDbError(formatSupabaseError(error)));
  }
  if (!data) throw loanFailureError("Ismeretlen hiba.");

  const loanId = data as string;

  const { data: loanRow } = await supabase
    .from("cylinder_loans")
    .select("exchange_id")
    .eq("id", loanId)
    .single();

  if (loanRow?.exchange_id) {
    try {
      await storeExchangeProfitFromLoan(loanRow.exchange_id, args.outgoing_id);
    } catch (profitErr) {
      console.warn("[loan-ops] Ár/profit frissítés sikertelen, a kölcsön rögzítve:", profitErr);
    }
  }

  const [{ data: cyl }, partnerName] = await Promise.all([
    supabase.from("cylinders").select("barcode").eq("id", args.outgoing_id).single(),
    fetchPartnerName(args.partner_id),
  ]);
  if (cyl) {
    await logPartnerIssue(args.outgoing_id, args.partner_id, cyl.barcode, partnerName);
    await logLoanIssue(args.outgoing_id, args.partner_id, cyl.barcode, loanId, partnerName);
  }

  return loanId;
}

async function storeExchangeProfitFromLoan(exchangeId: string, outgoingId: string): Promise<void> {
  const { data: cyl, error: cylErr } = await supabase
    .from("cylinders")
    .select("gas_type, size")
    .eq("id", outgoingId)
    .single();
  if (cylErr || !cyl) throw new Error(parseDbError(cylErr?.message ?? "Palack nem található"));

  const prices = await fetchProductPrices(true);
  const price = lookupProductPrice(cyl.gas_type, cyl.size, prices);
  if (!price) throw new Error(`Nincs árlista bejegyzés: ${cyl.gas_type} ${cyl.size}`);

  const { error } = await supabase
    .from("exchanges")
    .update({
      beszerzesi_ar: price.beszerzesi_ar,
      eladasi_ar: price.eladasi_ar,
      profit: price.eladasi_ar - price.beszerzesi_ar,
    })
    .eq("id", exchangeId);

  if (error) throw new Error(parseDbError(error.message));
}

/** Kölcsön visszavétel – a visszahozott palack eltérhet a kiadottól. */
export async function returnCylinderLoan(args: {
  loan_id: string;
  returned_barcode: string;
  partner_id: string;
  note?: string | null;
  return_mode?: "empty" | "full";
}): Promise<void> {
  const returned = await findCylinderByBarcode(args.returned_barcode);
  const mode = args.return_mode ?? "empty";

  const { error } = await supabase.rpc("return_cylinder_loan", {
    p_loan_id: args.loan_id,
    p_returned_cylinder_id: returned.id,
    p_note: args.note ?? undefined,
    p_return_mode: mode,
  });

  if (error) throw new Error(parseDbError(error.message));

  const partnerName = await fetchPartnerName(args.partner_id);
  await logPartnerReturn(returned.id, args.partner_id, returned.barcode, partnerName);
  await logLoanReturn({
    cylinderId: returned.id,
    partnerId: args.partner_id,
    barcode: returned.barcode,
    loanId: args.loan_id,
    mode,
    partnerName,
    note: args.note,
  });
}

/** Aktív kölcsönök partnerek szerint csoportosítva. */
export async function fetchActiveLoansByPartner(): Promise<PartnerLoanSummary[]> {
  const { data: loans, error } = await supabase
    .from("cylinder_loans")
    .select("id, partner_id, cylinder_id, loaned_at, note")
    .eq("status", "active")
    .order("loaned_at", { ascending: false });

  if (error) throw new Error(formatSupabaseError(error, "Kölcsönadott palackok lekérdezése"));
  if (!loans?.length) return [];

  const partnerIds = [...new Set(loans.map((l) => l.partner_id))];
  const cylinderIds = [...new Set(loans.map((l) => l.cylinder_id))];

  const [{ data: partners, error: pErr }, { data: cylinders, error: cErr }] = await Promise.all([
    supabase.from("partners").select("id, name, company_name, phone").in("id", partnerIds),
    supabase
      .from("cylinders")
      .select("id, barcode, gas_type, size, status")
      .in("id", cylinderIds),
  ]);

  if (pErr) throw new Error(formatSupabaseError(pErr, "Partnerek lekérdezése"));
  if (cErr) throw new Error(formatSupabaseError(cErr, "Palackok lekérdezése"));

  const partnerMap = new Map((partners ?? []).map((p) => [p.id, p]));
  const cylMap = new Map((cylinders ?? []).map((c) => [c.id, c]));
  const byPartner = new Map<string, PartnerLoanSummary>();

  for (const loan of loans) {
    const partner = partnerMap.get(loan.partner_id);
    const cyl = cylMap.get(loan.cylinder_id);
    if (!partner || !cyl) continue;

    let summary = byPartner.get(partner.id);
    if (!summary) {
      summary = {
        partner_id: partner.id,
        partner_name: partner.name,
        company_name: partner.company_name,
        phone: partner.phone,
        loans: [],
      };
      byPartner.set(partner.id, summary);
    }

    summary.loans.push({
      loan_id: loan.id,
      loaned_at: loan.loaned_at,
      note: loan.note,
      cylinder_id: cyl.id,
      barcode: cyl.barcode,
      gas_type: cyl.gas_type,
      size: cyl.size,
      status: cyl.status,
    });
  }

  return [...byPartner.values()].sort((a, b) =>
    a.partner_name.localeCompare(b.partner_name, "hu"),
  );
}

export async function resolveReturnedCylinder(barcode: string): Promise<CylinderRow> {
  return findCylinderByBarcode(normalizeBarcode(barcode));
}
