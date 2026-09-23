# PRE audit – szállítólevél / ADR / kapcsolódó hibák

**Dátum:** 2026-09-23  
**Repo:** GazVeled2  

## Meglévő állapot

| Terület | Állapot |
|---------|---------|
| Szállítólevél | **Nincs** implementáció |
| Bérleti szerződés PDF | Van (`rental-contract-pdf.ts`) – mintázat újrahasználható |
| Számlázz Agent | WIP számla; szállítólevél Agent flag később |
| Beszállítói csere | `/suppliers` + `supplier_exchanges` |
| Gyorscsere | `/quick-exchange` + `exchanges` |
| Vonalkód | `@zxing/browser` `BarcodeScanner.tsx` – kamera getUserMedia |
| Horváth OCR | **Nincs elérhető kód** ezen a gépen |
| Bérleti díj emlékeztető | `initial_fee_invoiced` + `UninvoicedRentalFeesCard` (előző nap) |
| Nyereség | `yearProfit` számolva, UI-n nem havi lebontás |

## Konzol „permission denied”

A screenshotok részben **más app** (`gazveled.vercel.app` / Firebase) jeleit is mutatják.  
GazVeled2-ben a scanner tipikus hibája: böngésző **kamera NotAllowedError** („Permission denied”).  
Javítás: egyértelmű HU üzenet + HTTPS / jogosultság útmutató + jobb kamera constraints.

## ADR / adatmodell döntés

- Új táblák: `adr_product_master`, `delivery_notes`, `delivery_note_items` (+ snapshot JSON).
- Üres visszavétel default: `EMPTY_UNCLEANED`.
- Számítás: `src/lib/adr/` (UI-tól független).
