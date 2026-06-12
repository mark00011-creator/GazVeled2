import { addMonthsLocal, daysUntilDate } from "@/lib/date-utils";

export type InvoiceUrgency = "green" | "yellow" | "red";

export function daysUntil(date: string | null | undefined): number | null {
  return daysUntilDate(date);
}

export function invoiceUrgency(days: number | null): InvoiceUrgency {
  if (days === null) return "green";
  if (days < 0) return "red";
  if (days <= 5) return "yellow";
  return "green";
}

export function addMonths(dateStr: string, months: number): string {
  return addMonthsLocal(dateStr, months);
}

export function formatInvoiceWarning(partnerName: string, days: number): string {
  if (days < 0) {
    return `Figyelem! ${partnerName} bérleti számlázása ${Math.abs(days)} napja lejárt.`;
  }
  if (days === 0) {
    return `Figyelem! ${partnerName} bérleti számlázása ma esedékes.`;
  }
  return `Figyelem! ${partnerName} bérleti számlázása ${days} nap múlva esedékes.`;
}

export function formatExpiryWarning(partnerName: string, days: number): string {
  if (days < 0) {
    return `${partnerName} éves bérlete ${Math.abs(days)} napja lejárt.`;
  }
  if (days === 0) {
    return `${partnerName} éves bérlete ma jár le.`;
  }
  return `${partnerName} éves bérlete ${days} nap múlva jár le.`;
}
