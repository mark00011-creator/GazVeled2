/**
 * Számlázz.hu Agent – teszt fiók beállítás (díjmentes API)
 *
 * 1. Hozz létre / állíts teszt üzembe egy Számlázz.hu fiókot:
 *    https://tudastar.szamlazz.hu/gyik/how-do-i-establish-a-test-connection-with-invoice-agent
 * 2. Vezérlőpult → Számla Agent kulcsok → generálj kulcsot
 * 3. GazVeled → Cég beállítások → Számlázz.hu Agent → illeszd be a kulcsot
 * 4. E-számla kapcsolót hagyd KI (#free / teszt papír számlához)
 *
 * Éles kulcs:
 * - Csak production org-on, soha ne commiteld
 * - organization_invoicing_secrets tábla – authenticated SELECT tiltva
 * - Véglegesítés: createServerFn (Vercel) vagy Edge Function szamlazz-create-invoice
 *
 * Agent díj (éles): 1–50 db/hó → 2690 Ft+áfa; teszt fiókban 0 Ft.
 */

export const SZAMLAZZ_TEST_SETUP_CHECKLIST = [
  "Teszt fiók létrehozva / teszt üzem",
  "Agent kulcs a Cég beállításokban",
  "Gyors csere → Számlázzam? → előnézet → véglegesítés",
  "exchanges.invoiced = true + external_invoice_number kitöltve",
] as const;
