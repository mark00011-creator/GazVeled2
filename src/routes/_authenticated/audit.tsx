import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { fmtDateTime } from "@/lib/labels";
import {
  useRouteScrollRestoration,
  useRouteStatePersistence,
} from "@/hooks/use-route-state-persistence";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({ meta: [{ title: "Audit napló – Gáz Veled" }] }),
  component: Audit,
});

const ENTITY_LABELS: Record<string, string> = {
  exchanges: "Csere",
  rentals: "Bérlet",
  cylinders: "Palack",
  partners: "Partner",
  suppliers: "Beszállító",
  movements: "Mozgás",
  events: "Esemény",
  supply_products: "Készlet termék",
  supply_sales: "Készlet eladás",
  cylinder_loans: "Kölcsön",
  gas_orders: "Gáz rendelés",
  quotes: "Árajánlat",
};

const ACTION_LABELS: Record<string, string> = {
  insert: "Létrehozás",
  update: "Módosítás",
  delete: "Törlés",
};

const FIELD_LABELS: Record<string, string> = {
  invoiced: "Számlázva",
  note: "Megjegyzés",
  profit: "Haszon",
  eladasi_ar: "Eladási ár",
  beszerzesi_ar: "Beszerzési ár",
  status: "Státusz",
  location_type: "Hely",
  partner_id: "Partner",
  rental_id: "Bérlet",
  batch_id: "Csoport",
  organization_id: "Cég",
  full_name: "Név",
  role: "Szerepkör",
  is_active: "Aktív",
  name: "Név",
  barcode: "Vonalkód",
  gas_type: "Gáz",
  size: "Méret",
  quantity: "Mennyiség",
};

type JsonMap = Record<string, unknown>;

function asMap(value: unknown): JsonMap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonMap;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "igen" : "nem";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value || "—";
  return JSON.stringify(value);
}

function diffFields(oldValue: unknown, newValue: unknown): { key: string; from: string; to: string }[] {
  const oldMap = asMap(oldValue) ?? {};
  const newMap = asMap(newValue) ?? {};
  const keys = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
  const skip = new Set(["updated_at", "created_at", "organization_id"]);
  const out: { key: string; from: string; to: string }[] = [];
  for (const key of keys) {
    if (skip.has(key)) continue;
    const from = oldMap[key];
    const to = newMap[key];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    out.push({ key, from: formatValue(from), to: formatValue(to) });
  }
  return out;
}

function summaryLine(action: string, entityType: string, oldValue: unknown, newValue: unknown): string {
  const diffs = diffFields(oldValue, newValue);
  if (action === "update" && diffs.length > 0) {
    const short = diffs.slice(0, 3).map((d) => {
      const label = FIELD_LABELS[d.key] ?? d.key;
      return `${label}: ${d.from} → ${d.to}`;
    });
    return short.join(" · ") + (diffs.length > 3 ? ` · +${diffs.length - 3}` : "");
  }
  const row = asMap(newValue) ?? asMap(oldValue);
  if (!row) return ENTITY_LABELS[entityType] ?? entityType;
  const bits = [
    row.barcode && `sorszám ${row.barcode}`,
    row.name && String(row.name),
    row.note && String(row.note),
    row.gas_type && row.size && `${row.gas_type} ${row.size}`,
    row.invoiced === true && "számlázva",
    row.invoiced === false && "nincs számlázva",
  ].filter(Boolean);
  return bits.length > 0 ? bits.join(" · ") : ENTITY_LABELS[entityType] ?? entityType;
}

function Audit() {
  const { state, patch, storageKey } = useRouteStatePersistence<{ q: string }>({ q: "" });
  const q = state.q;
  const { data, isFetched, isError } = useQuery({
    queryKey: ["audit", q],
    queryFn: async () => {
      let qb = supabase
        .from("audit_log")
        .select("id, user_id, action, entity_type, entity_id, old_value, new_value, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (q.trim()) qb = qb.ilike("entity_type", `%${q}%`);
      const { data: rows, error } = await qb;
      if (error) throw error;
      return rows ?? [];
    },
  });

  const userIds = useMemo(
    () => [...new Set((data ?? []).map((r) => r.user_id).filter(Boolean))] as string[],
    [data],
  );

  const { data: profileMap } = useQuery({
    queryKey: ["audit-profiles", userIds],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds);
      if (error) throw error;
      const map = new Map<string, string>();
      for (const p of profiles ?? []) {
        map.set(p.id, p.full_name?.trim() || p.email || p.id.slice(0, 8));
      }
      return map;
    },
  });

  useRouteScrollRestoration(storageKey, isFetched || isError);

  return (
    <AppShell title="Audit napló">
      <p className="mb-3 text-xs text-muted-foreground">
        Technikai változásnapló: táblák létrehozása/módosítása/törlése (pl. csere számlázva jelölés). A
        napi üzleti nyomkövetés (ki cserélt kinek) a palack előélet / események felé tartozik.
      </p>
      <Input
        className="mb-3"
        placeholder="Szűrés entitástípusra (pl. exchanges, rentals)"
        value={q}
        onChange={(e) => patch({ q: e.target.value })}
      />
      <div className="space-y-2">
        {(data ?? []).map((row) => {
          const diffs = row.action === "update" ? diffFields(row.old_value, row.new_value) : [];
          const who = row.user_id ? profileMap?.get(row.user_id) : null;
          return (
            <Card key={row.id} className="p-3 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {ENTITY_LABELS[row.entity_type] ?? row.entity_type}
                  </Badge>
                  <Badge>{ACTION_LABELS[row.action] ?? row.action}</Badge>
                  {who && <span className="text-muted-foreground">{who}</span>}
                </div>
                <div className="shrink-0 text-muted-foreground">{fmtDateTime(row.created_at)}</div>
              </div>
              <div className="mt-2 text-sm text-foreground">
                {summaryLine(row.action, row.entity_type, row.old_value, row.new_value)}
              </div>
              {diffs.length > 0 && (
                <div className="mt-2 space-y-1 rounded-md bg-muted/40 px-2 py-1.5">
                  {diffs.slice(0, 8).map((d) => (
                    <div key={d.key} className="flex flex-wrap gap-x-2 text-[11px]">
                      <span className="font-medium text-muted-foreground">
                        {FIELD_LABELS[d.key] ?? d.key}
                      </span>
                      <span className="text-muted-foreground">{d.from}</span>
                      <span>→</span>
                      <span>{d.to}</span>
                    </div>
                  ))}
                  {diffs.length > 8 && (
                    <div className="text-[10px] text-muted-foreground">+{diffs.length - 8} további mező</div>
                  )}
                </div>
              )}
              {row.entity_id && (
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  rekord: {row.entity_id}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
