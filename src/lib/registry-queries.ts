import { supabase } from "@/integrations/supabase/client";

export type CylinderCustodyRow = {
  cylinder_id: string;
  barcode: string;
  gas_type: string;
  size: string;
  status: string;
  circulation: string;
  owner: string;
  location_type: string;
  partner_id: string | null;
  partner_name: string | null;
  rental_id: string | null;
  rental_status: string | null;
  rental_cylinder_expiry_date: string | null;
  replacement_value: number;
  is_missing_or_inconsistent: boolean;
};

export type RentalStatusOverviewRow = {
  id: string;
  partner_id: string;
  partner_name: string | null;
  start_date: string;
  expiry_date: string | null;
  rental_type: string;
  monthly_fee: number;
  deposit: number;
  deposit_type: string;
  status: string;
  computed_status: "active" | "expired" | "soon" | "closed" | "cancelled" | string;
  days_until_expiry: number | null;
};

export async function fetchCylinderCustody(cylinderId: string): Promise<CylinderCustodyRow | null> {
  const { data, error } = await supabase
    .from("v_cylinder_custody")
    .select("*")
    .eq("cylinder_id", cylinderId)
    .maybeSingle();
  if (error) throw error;
  return data as CylinderCustodyRow | null;
}

export async function fetchPartnerCylinderCustody(
  partnerId: string,
): Promise<CylinderCustodyRow[]> {
  const { data, error } = await supabase
    .from("v_cylinder_custody")
    .select("*")
    .eq("partner_id", partnerId)
    .order("barcode");
  if (error) throw error;
  return (data ?? []) as CylinderCustodyRow[];
}

export async function fetchActiveRentals(): Promise<RentalStatusOverviewRow[]> {
  return fetchRentalsByComputedStatus("active");
}

export async function fetchExpiredRentals(): Promise<RentalStatusOverviewRow[]> {
  return fetchRentalsByComputedStatus("expired");
}

export async function fetchSoonExpiringRentals(): Promise<RentalStatusOverviewRow[]> {
  return fetchRentalsByComputedStatus("soon");
}

export async function fetchOutCylinders(): Promise<CylinderCustodyRow[]> {
  const { data, error } = await supabase
    .from("v_cylinder_custody")
    .select("*")
    .eq("location_type", "customer")
    .order("partner_name")
    .order("barcode");
  if (error) throw error;
  return (data ?? []) as CylinderCustodyRow[];
}

export async function fetchMissingCylinders(): Promise<CylinderCustodyRow[]> {
  const { data, error } = await supabase
    .from("v_cylinder_custody")
    .select("*")
    .eq("is_missing_or_inconsistent", true)
    .order("barcode");
  if (error) throw error;
  return (data ?? []) as CylinderCustodyRow[];
}

async function fetchRentalsByComputedStatus(status: string): Promise<RentalStatusOverviewRow[]> {
  const { data, error } = await supabase
    .from("v_rental_status_overview")
    .select("*")
    .eq("computed_status", status)
    .order("expiry_date");
  if (error) throw error;
  return (data ?? []) as RentalStatusOverviewRow[];
}
