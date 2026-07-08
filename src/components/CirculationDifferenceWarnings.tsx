import { Card } from "@/components/ui/card";
import { AlertTriangle, Sparkles } from "lucide-react";
import { formatCirculationDifferenceWarning } from "@/lib/exchange-circulation";
import type { CirculationDifferenceRow } from "@/lib/circulation-differences";

export function CirculationDifferenceWarnings({
  differences,
  settleable,
}: {
  differences: CirculationDifferenceRow[];
  settleable?: CirculationDifferenceRow[];
}) {
  if (differences.length === 0) return null;

  return (
    <>
      <Card className="mb-3 border-amber-500/50 bg-amber-500/10 p-4">
        <div className="mb-2 flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div className="text-sm font-bold uppercase">Nyitott körforgás-eltérések</div>
        </div>
        <ul className="space-y-1 text-sm text-amber-900 dark:text-amber-200">
          {differences.map((d) => (
            <li key={d.id}>{formatCirculationDifferenceWarning(d)}</li>
          ))}
        </ul>
      </Card>

      {(settleable?.length ?? 0) > 0 && (
        <Card className="mb-3 border-primary/50 bg-primary/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-primary">
            <Sparkles className="h-4 w-4 shrink-0" />
            <div className="text-sm font-semibold">Elsődleges javaslat: eltérés rendezése</div>
          </div>
          <ul className="space-y-1 text-sm">
            {settleable!.map((d) => (
              <li key={d.id}>
                Rendezhető: {formatCirculationDifferenceWarning(d)} Visszahozott körforgás:{" "}
                {d.outgoing_gas_type} {d.size} → Kiadandó: {d.incoming_gas_type} {d.size}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
