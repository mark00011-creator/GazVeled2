# Gáz Veled – üzleti integritás ellenőrzés

Hivatalos, **read-only** üzleti integritás audit a napi munkához.

| | |
|---|---|
| **SQL script** | [`sql/check_business_invariants.sql`](../sql/check_business_invariants.sql) |
| **Futtatás** | Supabase SQL Editor (production vagy staging), psql, vagy bármely read-only kliens |
| **Módosít** | Semmit – kizárólag SELECT |
| **Mikor** | Minden fejlesztés / migráció / hibajavítás után; rendszeres időközönként is (pl. havonta) |

---

## Összefoglaló értelmezés

A script végén megjelenő **Overall** mező:

| Overall | Jelentés |
|---------|----------|
| **PASS** | Minden kötelező üzleti invariáns teljesül |
| **WARNING** | Nincs FAIL, de figyelmezendő eltérés (pl. negatív kínai készlet, törölhető TEMP, audit gap) |
| **FAIL** | Legalább egy kötelező invariáns sérült – vizsgálat szükséges |

---

## 1. Palack integritás

### 1.1 Duplikált sorszám (nem TEMP)

| | |
|---|---|
| **Invariáns** | Ugyanaz a sorszámos vonalkód nem szerepelhet kétszer aktív, nem TEMP rekordon |
| **Miért fontos** | Egy fizikai palack = egy rekord; duplikátum készlet- és hely-ütközést okoz |
| **PASS** | 0 duplikált barcode |
| **FAIL** | ≥1 duplikált barcode – azonnali vizsgálat |
| **Üzleti következmény** | Rossz partnerhez rendelt csere, hibás készletszám |

### 1.2 Ugyanaz a sorszám két partnernél

| | |
|---|---|
| **Invariáns** | Ugyanaz a vonalkód nem lehet egyszerre két különböző partnernél (`customer`) |
| **PASS** | 0 ütközés |
| **FAIL** | ≥1 vonalkód több partnernél |
| **Üzleti következmény** | „Egy palack két helyen” – sérti az alapszabályt |

### 1.3 Két aktív kölcsön / két aktív bérlet / kölcsön+bérlet ütközés

| | |
|---|---|
| **Invariáns** | Sorszámos palack: max 1 aktív kölcsön, max 1 aktív bérlet, nem lehet egyszerre mindkettő |
| **PASS** | 0 ütközés mindhárom ellenőrzésben |
| **FAIL** | Bármelyik > 0 |
| **Üzleti következmény** | Hibás nyilvántartás, számlázási/készlet eltérés |

### 1.4 Hely és állapot értelmezhetősége

| | |
|---|---|
| **Invariáns** | `location_type` és `status` mindig kitöltött; partner csak `customer` esetén; supplier csak beszállítói helyen |
| **PASS** | 0 ellentmondás |
| **FAIL** | NULL hely/állapot, vagy rossz FK-kombináció |
| **Üzleti következmény** | „Eltűnt palack” – nem mondható meg, hol van |

### 1.5 `v_cylinder_custody` összhang

| | |
|---|---|
| **Invariáns** | Aktív palackok custody view szerint konzisztensek (customer + partner, bérlet/hely egyezés) |
| **PASS** | `is_missing_or_inconsistent = false` minden aktív palackra |
| **FAIL** | ≥1 inkonzisztens sor |

---

## 2. Bérletek

### 2.1 Aktív bérlet – partner

| | |
|---|---|
| **Invariáns** | Minden `status = 'active'` bérlethez létezik érvényes partner |
| **PASS** | 0 hiányzó partner |
| **FAIL** | ≥1 aktív bérlet partner nélkül |

### 2.2 Két aktív bérlet ugyanarra a palackra

| | |
|---|---|
| **Invariáns** | `rental_cylinders` (removed_at IS NULL) + aktív rental; illetve `current_cylinder_id` ütközés |
| **PASS** | 0 ütközés |
| **FAIL** | ≥1 palack több aktív bérletben |

### 2.3 Darabszámos bérlet

| | |
|---|---|
| **Invariáns** | Aktív darabszámos bérlet (`rental_quantity_items`, `removed_at IS NULL`) érvényes mennyiséggel és partnerrel rendelkezik; `current_cylinder_id` NULL megengedett |
| **PASS** | 0 érvénytelen quantity sor (quantity ≤ 0, hiányzó partner) |
| **FAIL** | Érvénytelen quantity rekord |

### 2.4 TEMP bérlet

| | |
|---|---|
| **Invariáns** | TEMP palack aktív bérletben = **üzletileg helyes** (ismeretlen sorszám partnernél) |
| **PASS** | Nincs TEMP-specifikus FAIL (csak strukturális hiba, pl. TEMP customer helyen partner nélkül) |
| **WARNING** | – |
| **Megjegyzés** | Aktív TEMP bérlet **nem hiba** |

---

## 3. Kölcsönök

### 3.1 Aktív kölcsön – partner és palack

| | |
|---|---|
| **Invariáns** | Aktív kölcsönhöz létezik partner és palack rekord |
| **PASS** | 0 hiányzó hivatkozás |
| **FAIL** | ≥1 törött FK |

### 3.2 Aktív kölcsön helye

| | |
|---|---|
| **Invariáns** | Aktív kölcsönnél a kiadott palack `customer` helyen, a kölcsön partnerénél |
| **PASS** | 0 eltérés |
| **FAIL** | Palack telephelyen vagy más partnernél |

### 3.3 Lezárt kölcsön konzisztencia

| | |
|---|---|
| **Invariáns** | `returned` státusz → `returned_at` kitöltve; visszahozott palack nem marad customer helyen |
| **PASS** | 0 inkonzisztens lezárt kölcsön |
| **FAIL** | Lezárt kölcsön adat ellentmondás |

---

## 4. Gyors csere (exchanges)

### 4.1 Palack hivatkozások

| | |
|---|---|
| **Invariáns** | Exchange incoming/outgoing palack ID-k létező `cylinders` rekordokra mutatnak (ahol nem NULL) |
| **PASS** | 0 törött hivatkozás |
| **FAIL** | ≥1 nem létező palack ID |

### 4.2 Invoiced mező

| | |
|---|---|
| **Invariáns** | `invoiced = true` → `invoiced_at` kitöltve (ahol az oszlop létezik) |
| **PASS** | 0 ellentmondás |
| **FAIL** | Kiszámlázott de dátum nélkül |
| **Megjegyzés** | A számlázási modul hiánya **nem FAIL** – az `invoiced = false` tételek üzletileg normálisak |

---

## 5. Beszállítói csere

### 5.1 Aktív palack hivatkozások

| | |
|---|---|
| **Invariáns** | `supplier_exchanges` UUID tömbjeiben minden ID létező palack (aktuális készlet szempontjából) |
| **PASS** | 0 hiányzó palack az utolsó 90 napban; régebbi: WARNING |
| **FAIL** | Friss (90 nap) exchange törött hivatkozással |
| **WARNING** | Régi exchange törött hivatkozás (audit gap, nem aktuális készlet hiba) |

### 5.2 Beszállító

| | |
|---|---|
| **Invariáns** | Minden supplier_exchange-hez létezik supplier |
| **PASS** | 0 hiányzó supplier |
| **FAIL** | ≥1 törött supplier FK |

---

## 6. History (cylinder_history)

### 6.1 Palack létezik

| | |
|---|---|
| **Invariáns** | Minden history sorhoz létezik palack |
| **PASS** | 0 orphan history |
| **FAIL** | ≥1 orphan (FK sérülés) |

### 6.2 Időrend

| | |
|---|---|
| **Invariáns** | Ugyanazon palack history sorai `created_at` szerint nem negatív időbeli ugrást mutatnak extrém esetben |
| **PASS** | 0 sor jövőbeli dátummal; 0 duplikált azonos millisec burst (opcionális INFO) |
| **WARNING** | Jövőbeli `created_at` (óra eltérés) |

### 6.3 Event type

| | |
|---|---|
| **Invariáns** | Ismert `event_type` értékek listája (kódban használt) |
| **PASS** | 0 ismeretlen típus |
| **WARNING** | Ismeretlen típus (új funkció előtt frissítsd a listát) |

### 6.4 Kapcsolódó entitások

| | |
|---|---|
| **Invariáns** | `related_*` UUID mezők, ha kitöltve, létező rekordra mutatnak |
| **PASS** | 0 törött related hivatkozás |
| **FAIL** | ≥1 törött related FK |

---

## 7. Events (Global Event Engine)

| | |
|---|---|
| **Invariáns** | `event_engine_health()` és kapcsolódó ellenőrzések: nincs orphan event, nincs missing link az új (event_group_id-s) eseményeknél |
| **PASS** | `healthy = true`, ERROR szintű diagnostic = 0 |
| **WARNING** | WARNING szintű diagnostic > 0; historikus events gap (régi history nélkül events) |
| **FAIL** | ERROR diagnostic > 0; orphan_events > 0; missing_links > 0 |
| **Megjegyzés** | Régi history events nélkül = **nem FAIL** (engine után érkező funkció) |

---

## 8. TEMP palackok

| | |
|---|---|
| **Üzleti szabály** | TEMP = partnernél lévő, ismeretlen sorszámú palack. **Nem hiba.** |
| **Üzletileg helyes TEMP** | TEMP jellegű rekord + `customer` + `location_partner_id` kitöltve (vagy aktív bérlet/kölcsön kapcsolat) |
| **Valóban árva TEMP** | `list_orphan_temp_cylinders(true)` ahol `deletable = true` – technikai takarítási jelölt, **nem üzleti FAIL** |
| **PASS** | 0 TEMP customer helyen partner nélkül |
| **WARNING** | ≥1 törölhető (deletable) árva TEMP – opcionális takarítás |
| **FAIL** | TEMP strukturális ellentmondás (pl. warehouse + TEMP + nincs üzleti magyarázat) |

---

## 9. Kínai készlet

| | |
|---|---|
| **Invariáns** | `full_count` / `empty_count` NULL nélkül |
| **PASS** | Nincs NULL |
| **WARNING** | Negatív érték – **üzletileg megengedett** bizonyos helyzetekben (pl. kölcsön); nem FAIL |
| **INFO** | Negatív sorok listája ok/kontextussal |
| **FAIL** | NULL count |

---

## 10. Dashboard számlálók

| | |
|---|---|
| **Cél** | A dashboard által használt lekérdezések eredménye összhangban van-e az adatbázis aggregátumokkal |
| **Ellenőrzés** | Aktív palackok, aktív bérletek, bérletben lévő palackok, aktív kölcsönök, uninvoiced count (profit NOT NULL szűrővel), kényszer-csere count |
| **PASS** | Belső összhang (subquery-k egyeznek) |
| **INFO** | Számlálók kiírása – manuális összevetéshez a UI-val |
| **FAIL** | Ellentmondó aggregátum ugyanazon adaton |

---

## 11. Eszköz- és fogyóanyag-készlet

| | |
|---|---|
| **Cél** | Darabszámos eszköz/fogyóanyag készlet konzisztens, auditálható, seed helyes |
| **Ellenőrzés** | Negatív készlet, duplikált natural_key, movement stock_before/after, mozgás-összeg vs készlet, eladás partner/movement/billing, ár nélküli sale, inaktív termék sale, seed 3+2+2 |
| **PASS** | 0 violations minden 11.x checkben és fail_11 summary |
| **FAIL** | Bármely supply invariáns sérül |
| **Megjegyzés** | A palackos/kínai készlet táblák ebben a szekcióban nem érintettek |

---

## Futtatási útmutató

1. Nyisd meg a Supabase SQL Editort a production projekten (`snmiwsgtnokvqlnwvfwf`).
2. Másold be a teljes `sql/check_business_invariants.sql` tartalmát.
3. Futtasd **Run** – csak olvasó lekérdezések futnak.
4. Görgess a **végső összefoglaló** táblához (`Business invariant check`).
5. Ha **Overall: FAIL** → futtasd a részletes blokk SELECT-eket a sérült szekcióban (violations > 0).
6. Ha **Overall: WARNING** → értékeld: elfogadható-e üzletileg (negatív készlet, takarítható TEMP, régi audit gap).

### CI / automatizálás (később)

A summary utolsó sorában az `Overall` érték olvasható. Egy egyszerű wrapper script ellenőrizheti, hogy nincs-e `FAIL` string.

---

## Kapcsolódó auditok

| Script | Cél |
|--------|-----|
| `supabase/check_event_engine.sql` | Event Engine részletes diagnostic |
| `sql/check_business_invariants.sql` | **Üzleti integritás (ez)** |

---

## Karbantartás

- Új `event_type` a history-ban → frissítsd a known listát az SQL-ben.
- Új dashboard számláló → vedd fel a Dashboard szekcióba.
- Üzleti szabály változás → először e dokumentum, aztán az SQL.
