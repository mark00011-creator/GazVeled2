# Szállítólevél + ADR – végleges megállapodás

**Dátum:** 2026-09-23  
**Projekt:** GazVeled2  
**ADR szabálykészlet:** `ADR-2025`

## Üzleti döntések (egyeztetve)

1. **Hibrid számlázás / szállítólevél**
   - Ha van Számlázz Agent: később Agent szállítólevél (most NEM kötelező implementálni végig).
   - Ha **nincs** Agent: **app-beli** saját sorszámos szállítólevél PDF.

2. **Elsődleges use-case most**
   - **Beszállítói csere előzmények** → tételenként „Szállítólevél” gomb.
   - Dokumentum: elszállítandó **üres** palackok (sorszám + ADR).
   - Emellett: **Szállítólevél menü** (lista + Új kézi), **gyorscsere** után is gomb.

3. **Sorszám**
   - Formátum: `SZL-YYYY-000001`
   - Véglegesített sorszám **nem újrafelhasználható**.
   - Kézi „Új szállítólevél”: sorszám **nem kötelező** draftnál; véglegesítéskor kap sorszámot.

4. **Tesztadat**
   - Mai naptól kezdve (2026-09-23) – visszamenőleges teszt OK.

5. **ADR**
   - Ügyféltől visszavett üres = alapból `EMPTY_UNCLEANED` → fuvarokmány: `ÜRES TARTÁLY, 2`.
   - `EMPTY_CLEAN` csak explicit igazolt.
   - ADR adat **TILOS** terméknévből/AI-ból kitalálni; csak master data.
   - Nem `verified` termék → nincs „jogilag kész” ADR PDF figyelmeztetés nélkül.
   - 1.1.3.6: ≤1000 „határán belül”, >1000 „túllépve” – **TILOS** „nem ADR / mentes” szöveg.

6. **Production**
   - Ezen feladatnál: **ne alkalmazz migrációt production DB-re / Coolify-ra** a felhasználói brief szerint.
   - Migráció fájlok a repóban; local/staging később.

7. **Menetlevél**
   - Most **nem** külön modul; adatmodell ne zárja ki későbbi saját számlás menetlevelet.

## Scope ebben a sprintben

- ADR számítómotor + törzs (verified gázok + Stargon/PB unverified stub).
- `delivery_notes` (+ items, ADR snapshot).
- PDF: `SZÁLLÍTÓLEVÉL / PALACKCSERE BIZONYLAT`.
- UI: menü, beszállítói előzmény gomb, gyorscsere gomb, kézi új.
- Párhuzamos javítások: kamera permission UX, bérleti díj emlékeztető, éves nyereség havi lebontás.

## Expliciten később

- Számlázz Agent szállítólevél végleges kötés.
- SIAD SDS / Flaga SDS hitelesítés (Stargon, PB).
- Teljes menetlevél modul.
