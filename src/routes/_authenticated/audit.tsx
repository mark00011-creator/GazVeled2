import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { fmtDateTime } from "@/lib/labels";

export const Route = createFileRoute("/_authenticated/audit")({
  head: () => ({ meta: [{ title: "Audit napló – Gáz Veled" }] }),
  component: Audit,
});

function Audit() {
  const [q, setQ] = useState("");
  const { data } = useQuery({
    queryKey: ["audit", q],
    queryFn: async () => {
      let qb = supabase
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (q.trim()) qb = qb.ilike("entity_type", `%${q}%`);
      return (await qb).data ?? [];
    },
  });

  return (
    <AppShell title="Audit napló">
      <Input
        className="mb-3"
        placeholder="Szűrés entitástípusra (pl. exchanges, rentals)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
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
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                id: {row.entity_id}
              </div>
            )}
          </Card>
        ))}
        {(data ?? []).length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">Nincs bejegyzés</div>
        )}
      </div>
    </AppShell>
  );
}
