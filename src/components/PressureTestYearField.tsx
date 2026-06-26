import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parsePressureTestYearInput } from "@/lib/labels";

type Props = {
  value: string;
  onChange: (value: string) => void;
  id?: string;
};

/** Opcionális nyomáspróba év — gépelés közben string marad, mentéskor parse-oljuk. */
export function PressureTestYearField({ value, onChange, id = "pressure-test-year" }: Props) {
  return (
    <div>
      <Label htmlFor={id}>Nyomáspróba éve</Label>
      <p className="mb-1.5 text-xs text-muted-foreground">Opcionális · csak évszám (1900–2100)</p>
      <Input
        id={id}
        type="number"
        min={1900}
        max={2100}
        step={1}
        inputMode="numeric"
        placeholder="pl. 2028"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function pressureTestYearSaveError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (parsePressureTestYearInput(trimmed) != null) return null;
  return "Érvényes évszámot adj meg (1900–2100), vagy hagyd üresen.";
}
