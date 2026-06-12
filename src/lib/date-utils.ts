/** Parse YYYY-MM-DD as local calendar date (timezone-safe). */
export function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Format Date as YYYY-MM-DD in local timezone. */
export function formatDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayLocal(): string {
  return formatDateOnly(new Date());
}

export function addYears(dateStr: string, years: number): string {
  const d = parseDateOnly(dateStr);
  d.setFullYear(d.getFullYear() + years);
  return formatDateOnly(d);
}

export function addMonthsLocal(dateStr: string, months: number): string {
  const d = parseDateOnly(dateStr);
  d.setMonth(d.getMonth() + months);
  return formatDateOnly(d);
}

export function daysUntilDate(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const today = parseDateOnly(todayLocal());
  const target = parseDateOnly(dateStr);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}
