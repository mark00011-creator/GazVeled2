import { supabase } from "@/integrations/supabase/client";

/** Központi eseménytípusok (events tábla). */
export type GlobalEventType =
  | "quick_exchange"
  | "supplier_exchange"
  | "temp_to_real"
  | "temp_to_chinese";

export type GlobalEntityType = "cylinder" | "rental" | "partner" | "supplier" | "exchange";

export type LogEventInput = {
  event_type: GlobalEventType;
  event_group_id?: string | null;
  entity_type: GlobalEntityType;
  entity_id: string;
  related_entity_type?: GlobalEntityType | null;
  related_entity_id?: string | null;
  user_id?: string | null;
  supplier_id?: string | null;
  partner_id?: string | null;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

async function resolveUserId(explicit?: string | null): Promise<string | null> {
  if (explicit) return explicit;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * Központi üzleti esemény napló.
 * Hiba esetén nem dob — a cylinder_history és fő folyamat érintetlen marad.
 */
export async function logEvent(input: LogEventInput): Promise<void> {
  try {
    const user_id = await resolveUserId(input.user_id);
    const { error } = await supabase.from("events").insert({
      event_type: input.event_type,
      event_group_id: input.event_group_id ?? null,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      related_entity_type: input.related_entity_type ?? null,
      related_entity_id: input.related_entity_id ?? null,
      user_id,
      supplier_id: input.supplier_id ?? null,
      partner_id: input.partner_id ?? null,
      payload: input.payload ?? {},
      metadata: { source: "gazveeled", ...(input.metadata ?? {}) },
    });
    if (error) {
      console.error("[logEvent] insert failed:", error.message, input.event_type);
    }
  } catch (err) {
    console.error("[logEvent] unexpected error:", err);
  }
}
