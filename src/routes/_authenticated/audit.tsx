import { createFileRoute } from "@tanstack/react-router";
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

function Audit() {
  const { state, patch, storageKey } = useRouteStatePersistence<{ q: string }>({ q: "" });
  const q = state.q;
  const { data, isFetched, isError } = useQuery({
    queryKey: ["audit", q],
    queryFn: async () => {
      let qb = supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(200);
      if (q.trim()) qb = qb.ilike("entity_type", `%${q}%`);
      return (await qb).data ?? [];
    },
  });

  useRouteScrollRestoration(storageKey, isFetched || isError);

  return (
    <AppShell title="Audit napló">
      <Input
        className="mb-3"
        placeholder="Szűrés entitástípusra (pl. exchanges, rentals)"
        value={q}
        onChange={(e) => patch({ q: e.target.value })}
      />
      <div className="space-y-2">
        {(data ?? []).map((row) => (
          <Card key={row.id} className="p-3 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{row.entity_type}</Badge>
                <Badge>{row.action}</Badge>
              </div>
              <div className="text-muted-foreground">{fmtDateTime(row.created_at)}</div>
            </div>
            {row.entity_id && (
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">id: {row.entity_id}</div>
            )}
            {row.details != null && (
              <pre className="mt-2 overflow-x-auto rounded bg-muted/50 p-2 text-[10px]">
                {JSON.stringify(row.details, null, 2)}
              </pre>
            )}
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
