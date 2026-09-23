# POST audit – szállítólevél / ADR / kapcsolódó javítások

**Dátum:** 2026-09-23  
**Projekt ID (prod, nem érintve):** `snmiwsgtnokvqlnwvfwf`  
**Production DB / Coolify apply:** **NEM** (felhasználói brief)

## 1. PRE állapot

Lásd: `docs/delivery-notes/PRE_AUDIT.md`, `docs/delivery-notes/AGREEMENT.md`.

## 2. Megtalált szállítólevél-architektúra

Korábban **nem volt** szállítólevél modul. Új:

| Réteg | Helyszín |
|-------|----------|
| ADR motor | `src/lib/adr/types-and-calc.ts` |
| Méret parse | `src/lib/adr/physical.ts` |
| Ops | `src/lib/delivery-notes/ops.ts` |
| PDF | `src/lib/delivery-notes/pdf.ts` |
| Migráció | `supabase/migrations/20260923120000_delivery_notes_adr.sql` |
| UI lista/kézi | `/delivery-notes` |
| Beszállítói gomb | `/suppliers` előzmény |
| Gyorscsere | `DeliveryNoteAskDialog` csere után |

## 3. Adatmodell

- `adr_product_master` (ruleset `ADR-2025`, verified flag)
- `delivery_notes` (+ `journey_meta` menetlevél előkészítés)
- `delivery_note_items` (FULL / EMPTY_UNCLEANED / …)
- Snapshot: `adr_snapshot`, `business_snapshot`, `pdf_base64`
- Sorszám: `next_delivery_note_number` → `SZL-YYYY-000001`

## 4. Migrációk

- Fájl a repóban; **production apply tiltva ebben a sprintben**.
- RLS: same_org + can_exchange / is_admin.

## 5. ADR számítómotor

- Központi `calculateAdr1136` – nem UI-ban.
- EMPTY_UNCLEANED → `ÜRES TARTÁLY, 2`, kat. 4, 0 pont.
- EMPTY_CLEAN ki van zárva a dangerous goods-ból.
- PARTIAL = FULL szerinti pont.
- ≤1000 / >1000 státusz; **nincs** „nem ADR / mentes” szöveg.
- Nem verified → blocking warning.

## 6. PDF

- Cím: `SZÁLLÍTÓLEVÉL / PALACKCSERE BIZONYLAT` (pdfSafe ékezetek nélkül Helveticához).
- Üzleti tábla + ADR rész + 1.1.3.6 összesítés + aláírásmezők.
- Oldalszámozás + bizonylatszám láblécben.

## 7. Tesztek

`scripts/adr-1136.test.mjs` – kötelező 1–9 esetek.

## 8. Egyéb javítások

- **Kamera / scan:** `BarcodeScanner` – Permission denied HU üzenet, HTTPS check, jobb constraints.
- **Horváth OCR:** ezen a gépen **nincs** elérhető `horvath-app` kód a workspace-ben – később másik gépről átnézendő.
- **Éves nyereség:** kattintható → havi lebontás dialog.
- **Bérlet emlékeztető:** gáz tételek + díj egy kártyán (`UninvoicedRentalFeesCard`).

## 9. Security / RLS

Migráció policy-k: SELECT same_org; WRITE can_exchange / admin ADR master.  
Production schema audit: **nem futtatva** (apply tiltva) → státusz: **PARTIAL** a DB audit szempontjából.

## 10. Nyitott kérdések

1. **Stargon C18** – `verified=false` amíg SIAD SDS Ch.14 nincs ellenőrizve.
2. **PB / Flaga** – UN 1965/1978/1011 csak ellenőrzött masterrel `verified=true`.
3. Számlázz Agent szállítólevél – későbbi hibrid kötés.
4. Menetlevél modul – csak adatmodell előkészítve.
5. Production migráció apply – külön engedély kell.
