# Fejlesztési alapelvek

- Egy prompt = egy üzleti funkció.
- Ne próbálj egyszerre több külön fejlesztést megvalósítani.
- Ha a felhasználó több funkciót kér egyszerre, bontsd külön feladatokra.
- Mindig csak az aktuális feladatot implementáld.

# Implementálás

- Ne készíts feleslegesen hosszú elemzést vagy fejlesztési tervet a munka elején.
- Közvetlenül implementálj.
- A végső jelentés csak bizonyított eredményeket tartalmazhat (lásd Jelentés).

# Projekt bejárása

- Ne keress végig feleslegesen a teljes projektben.
- Csak az érintett fájlokat nyisd meg.
- Csak akkor nyiss meg új fájlt, ha arra valóban szükség van.

# Refaktor

- Ne refaktorálj működő kódot.
- Ne optimalizálj olyan részt, amit a feladat nem érint.
- Ne nevezz át fájlokat indokolatlanul.
- Ne mozgass fájlokat indokolatlanul.

# UI

- Csak azt a képernyőt módosítsd, amelyet a feladat érint.
- Ne változtass működő UI elemeket.
- Ne módosíts design elemeket, ha a feladat nem igényli.

# Üzleti logika

- A rendszer ne tiltson.
- Inkább figyelmeztessen.
- A felhasználó mindig felülbírálhatja a rendszert.
- Minden fontos esemény kerüljön naplózásra.

# GazVeled speciális szabályok

- A rendszer elsődleges célja a valós üzleti folyamatok támogatása.
- A rendszer ne akadályozza a munkát.
- Minden fontos esemény legyen strukturált objektumként tárolva (későbbi AI elemzéshez).

# 1. Alapelv – mikor kész egy feladat

## Implementálva ≠ bizonyítva

**Implementálva ≠ bizonyítva.** Ez kötelező alapelv minden fejlesztésre.

Egy feladat **nem** tekinthető késznek attól, hogy:

- a kód elkészült,
- a fájl létrejött,
- a build sikeres,
- a tesztek sikeresek,
- a migrációs fájl bekerült a repóba,
- a migration history tartalmazza,
- a commit és push megtörtént,
- a Vercel deploy READY.

Egy feladat **csak akkor bizonyítottan kész**, ha:

- minden eredeti követelmény implementálva van,
- az önrevízió PASS,
- a Red Team ellenőrzés PASS,
- a production adatbázis objektum-audit PASS,
- az RPC-aláírás audit PASS (ha érintett),
- a production funkcionális teszt PASS,
- nincs nyitott ERROR vagy WARNING a kötelező ellenőrzéseknél,
- nincs nem ellenőrzött kritikus ág,
- nincs PARTIAL állapot.

Ha ezek közül **bármelyik hiányzik**, a végső státusz **nem lehet PASS**.

A feladat továbbra is csak akkor kész, ha:

- a kód működik,
- az adatbázis-változás ténylegesen alkalmazva van,
- a production környezet a várt verziót használja,
- az eredmény megegyezik a feladat üzleti követelményeivel.

Localhost önmagában nem elegendő.

**Minden közös projektre** ugyanez a szigorú ellenőrzési rendszer kötelező.

# 2. Kötelező feladat-végrehajtási folyamat

Minden feladatot az alábbi sorrendben hajts végre:

1. Olvasd el a teljes feladatot.
2. Írd össze belső ellenőrzőlistában az összes követelményt.
3. **Műveletbesorolás:** elsődleges / másodlagos műveletek, blokkoló / nem blokkoló hibák, rollback/kompenzáció (lásd §6.1).
4. Vizsgáld meg a jelenlegi implementációt.
5. Ellenőrizd a production adatbázis és production kód tényleges állapotát.
6. Azonosítsd a módosítandó fájlokat és adatbázis-objektumokat.
7. Implementáld a változtatást.
8. Végezz saját kódrevíziót (§3).
9. **Red Team ellenőrzés** (§3.1) – aktívan keresd a hibát, ne igazold a megoldást.
10. Futtasd a buildet (`npm run build`).
11. Futtasd a teszteket (`npm test`).
12. Ellenőrizd a git diffet.
13. Alkalmazd a szükséges migrációkat productionön.
14. Auditáld a production adatbázist.
15. Commit.
16. Push `origin/main`.
17. Várd meg a Vercel Production READY állapotot.
18. Ellenőrizd, hogy a deploy commit SHA megegyezik a pusholt commit SHA-val.
19. Végezz production funkcionális tesztet (§7).
20. Hasonlítsd össze az eredményt az eredeti követelménylistával.
21. Ha bármely pont hibás, javítsd ki, majd ismételd meg az ellenőrzési folyamatot.
22. Csak teljes PASS (vagy PASS WITH TELEMETRY WARNING, lásd §12) után jelentsd késznek.

# 3. Kötelező önrevízió

Minden implementáció után külön revíziós lépést kell végrehajtani.

Ellenőrizd:

- minden felhasználói követelmény megvalósult-e,
- nincs-e kihagyott ág,
- nincs-e rossz változónév,
- nincs-e rossz adatbázis-típus,
- nincs-e nem létező oszlop vagy enum,
- nincs-e hibás RPC-aláírás,
- nincs-e régi RPC-overload,
- a frontend és az RPC ugyanazokat a paramétereket használja-e,
- a Supabase generált típusok megfelelnek-e a production sémának,
- minden adatbázis-művelet után megfelelő query invalidation történik-e,
- nincs-e csendben elnyelt kritikus hiba,
- a funkció hibás állapotban nem jelez-e hamis sikert.

A revízió után készíts PASS/FAIL eredményt.

FAIL esetén ne állj meg és ne kérdezd meg, hogy javítsd-e. Javítsd ki automatikusan, majd ismételd meg a revíziót.

# 3.1 Red Team ellenőrzés (kötelező, önrevízió után)

Minden implementáció után **külön Red Team ellenőrzést** kell végrehajtani.

A cél **nem** az, hogy igazold a saját megoldásodat, hanem hogy **aktívan megpróbáld bizonyítani**, hogy hibás vagy hiányos.

Kötelezően ellenőrizd:

- maradt-e régi RPC overload,
- maradt-e régi vagy hibás enum,
- maradt-e hibás függvényverzió,
- a migration history eltér-e a tényleges adatbázis-objektumoktól,
- a production és a fejlesztői adatbázis sémája eltér-e,
- a frontend valóban azt az RPC-t hívja-e, amelyet ellenőriztél,
- a frontend paraméternevei és típusai egyeznek-e a production RPC aláírásával,
- a PostgREST ugyanazt az RPC-aláírást exportálja-e,
- van-e nem létező oszlopra vagy típusra hivatkozás,
- van-e csendben elnyelt kritikus hiba,
- működik-e a funkció új adatokkal,
- működik-e meglévő adatokkal,
- működik-e szélsőértékeknél,
- működik-e ismételt végrehajtásnál,
- keletkezik-e duplikáció,
- marad-e árva rekord,
- rollback vagy teszt-tranzakció után konzisztens marad-e az adatbázis,
- a UI-ban látható eredmény megegyezik-e a production adatbázis tényleges állapotával.

Ha bármely ellenőrzés ellentmond annak, hogy a feladat kész, a státusz automatikusan **FAIL**.

FAIL esetén:

1. keresd meg a pontos okot,
2. javítsd ki,
3. futtasd újra a buildet,
4. futtasd újra a teszteket,
5. alkalmazd vagy javítsd a migrációt,
6. auditáld újra a production adatbázist,
7. ismételd meg a production funkcionális tesztet,
8. ismételd meg a Red Team ellenőrzést.

Ne kérdezd meg, hogy javítsd-e. Az eredeti feladat részeként javítsd automatikusan.

A Red Team után készíts PASS/FAIL eredményt.

- Csak akkor készíts migrációt, ha valóban szükséges.
- Ha már létezik megfelelő mező vagy tábla, használd azt.
- Ne hozz létre duplikált struktúrákat.
- `IF NOT EXISTS` / `DROP … IF EXISTS` használata kötelező (idempotens migráció).

## 4.1 Migrációk kötelező szabályai

Egy migráció csak **egyetlen logikai változást** tartalmazhat.

Külön migrációba kerüljenek:

- táblák és oszlopok,
- enumok,
- RPC-k,
- RLS policy-k,
- GRANT-ok,
- indexek,
- teljesítményjavítások,
- egymástól független modulok.

Minden migrációnál kötelező sorrend:

1. Csak olvasó előellenőrző SQL.
2. PASS/FAIL értékelés.
3. Egyetlen logikai változást végző migráció.
4. Migráció tényleges alkalmazása.
5. Külön csak olvasó audit SQL.
6. PASS/FAIL értékelés.
7. Csak teljes PASS után folytatható a következő migráció.

Minden migrációhoz tartozzon:

- cél,
- jelenlegi állapot,
- elvárt állapot,
- PASS feltétel,
- FAIL feltétel,
- leállási pont,
- audit SQL.

## 4.2 A migration history nem bizonyíték

A `supabase_migrations.schema_migrations` bejegyzése önmagában **nem bizonyítja**, hogy a migráció minden objektuma sikeresen létrejött.

Minden migráció után közvetlenül ellenőrizd:

- az objektum ténylegesen létezik-e,
- az oszlopok típusa helyes-e,
- az RPC aláírása helyes-e,
- az enum típusa helyes-e,
- a függvény törzse a várt logikát tartalmazza-e,
- a régi overload eltűnt-e,
- az indexek létrejöttek-e,
- az RLS aktív-e,
- a policy-k léteznek-e,
- a GRANT-ok helyesek-e.

RPC esetén kötelező ellenőrzés:

- `pg_proc`
- `pg_get_function_identity_arguments()`
- `pg_get_functiondef()`
- PostgREST által elérhető paraméterlista
- régi, hibás overloadok keresése

Ha a migration history szerint alkalmazott, de az objektum hiányzik vagy hibás: készíts **külön javító migrációt**. Ne módosíts kizárólag egy korábban már alkalmazott migrációt, mert az productionön nem fut le újra.

# 5. Production Supabase projekt

Minden adatbázis-művelet előtt ellenőrizd a Supabase projektazonosítót.

**Gáz Veled production projekt:** `snmiwsgtnokvqlnwvfwf`

Ha a csatlakoztatott projektazonosító ettől eltér:

- állj le,
- ne alkalmazz migrációt,
- ne módosíts adatot,
- jelezd a hibát.

A projektazonosító ellenőrzése **minden migráció előtt** kötelező, nem csak session elején.

# 6. Hibák kezelése és műveletbesorolás

## 6.1 Elsődleges és másodlagos műveletek (kötelező feladat elején)

Minden új feladat elején készíts belső listát:

- mely műveletek **elsődlegesek**,
- mely műveletek **másodlagosak**,
- mely hibák **blokkolják** a teljes folyamatot,
- mely hibák lehetnek **nem blokkolók**,
- milyen rollback vagy kompenzáció szükséges.

A végső jelentésben röviden tüntesd fel: elsődleges műveletek, másodlagos műveletek, blokkoló hibák, nem blokkoló hibák.

### Elsődleges üzleti művelet

Példák: palack státusz/hely módosítása, kölcsön/bérlet lezárása, készlet változás, csere, számlázási állapot, partner kiadás/visszavétel, TEMP átalakítás, **kötelező** auditnapló (`cylinder_history` stb.).

Elsődleges művelet hibája esetén:

- a teljes művelet legyen sikertelen,
- ne jelenjen meg hamis sikerüzenet,
- tranzakció esetén rollback,
- ne maradjon részlegesen módosított üzleti állapot,
- a feladat státusza **FAIL**.

Elsődleges üzleti hibát **tilos** kizárólag `console.error` segítségével elnyelni.

### Másodlagos telemetria vagy analitikai naplózás

Példák: Global Event Engine `events` tábla, opcionális analitika, AI elemzéshez használt másodlagos esemény, opcionális webhook/stat.

Másodlagos művelet lehet nem blokkoló, ha:

- az elsődleges üzleti művelet teljesen és helyesen végrehajtódott,
- a másodlagos hiba nem okoz adatinkonzisztenciát,
- a hiba nincs elrejtve, strukturáltan naplózva van,
- diagnosztika/health check jelezni tudja,
- a felhasználó nem kap hamis állítást a másodlagos napló sikeréről.

Minden nem blokkoló másodlagos műveletnél **kommenttel dokumentáld**:

- miért nem blokkoló,
- mi az elsődleges üzleti művelet,
- hol ellenőrizhető a másodlagos hiba,
- milyen helyreállítás/újrapróbálás lehetséges.

A `logEvent()` nem blokkoló működése elfogadható, ha: kötelező auditnapló sikeres, elsődleges művelet sikeres, events hiba strukturáltan naplózódik, `event_engine_health` jelezni tudja, nincs hamis siker az events naplózásról.

## 6.2 Hamis siker tiltása

Tilos sikerüzenet vagy PASS, ha:

- az elsődleges üzleti művelet bármely része hibás,
- az adatbázis csak részben frissült,
- az RPC nem a várt verzió,
- a production adatbázis nem a várt sémát használja,
- a kötelező auditnapló nem jött létre,
- a UI és az adatbázis állapota eltér,
- a funkcionális teszt nem futott le,
- a Red Team ellenőrzés nem futott le.

Másodlagos eseménynaplózási hiba esetén a fő művelet lehet sikeres, de a jelentésben kötelező:

**PARTIAL TELEMETRY FAILURE** – mely naplózás hibázott, elsődleges művelet sikerült-e, adatvesztés van-e, szükséges-e pótlás.

## 6.3 Általános hibakezelés

Tilos kritikus üzleti vagy adatbázis-hibát kizárólag `console.error` segítségével elnyelni.

Ha egy **elsődleges** naplózás, RPC, adatbázis-módosítás vagy üzleti művelet hibás:

- a felhasználó ne kapjon hamis sikerüzenetet,
- a művelet ne legyen késznek tekintve,
- a hiba kerüljön naplózásra,
- a hiba legyen látható a fejlesztési ellenőrzésben,
- szükség esetén a teljes tranzakció álljon vissza.

Csak **dokumentált** másodlagos telemetria hibája lehet nem blokkoló.

# 7. Production funkcionális teszt

HTTP 200 vagy a bejelentkező oldal betöltése **nem** production funkcionális teszt.

A production UI tesztnek az adott funkció **teljes folyamatát** kell ellenőriznie.

Külön ellenőrizd:

- **elsődleges** üzleti állapot előtte és utána,
- kötelező auditnapló létrejött-e,
- másodlagos `events` napló létrejött vagy dokumentáltan hibázott,
- nincs részleges adatállapot,
- nincs duplikáció,
- nincs árva rekord,
- nincs böngészőkonzol-hiba,
- nincs Network 400, 404, 409, 42501 vagy 500 hiba,
- a frontend cache frissült (React Query invalidation),
- hard refresh után is helyes az állapot.

Ha nincs bejelentkezett production session, a feladat **nem** jelenthető teljesen ellenőrzöttnek. Ilyenkor:

**PARTIAL – production auth funkcionális teszt szükséges**

Nem írható helyette, hogy „production ellenőrzés kész”.

# 8. Üzleti állapot előtte és utána

Minden adatot módosító production tesztnél rögzítsd:

**Teszt előtt:** érintett rekord azonosítója, státusz, hely, kapcsolatok, számlázási állapot, kapcsolódó naplók száma.

**Teszt után:** új státusz, új hely, lezárt kapcsolatok, számlázási állapot, létrejött audit- és event-sorok, duplikációellenőrzés.

A teszt csak akkor PASS, ha az előtte és utána állapot megfelel az üzleti követelménynek.

# 9. Automatikus javítás

Ha a build, teszt, migráció, audit vagy production teszt hibát talál:

- keresd meg a pontos okot,
- javítsd ki,
- futtasd újra az összes érintett ellenőrzést,
- ne állj meg az első javítás után,
- ne jelentsd késznek addig, amíg minden ellenőrzés PASS.

Ne kérdezd meg, hogy javítsd-e, ha a javítás a feladat eredeti követelményeinek része.

Csak akkor állj meg és kérdezz, ha:

- adatvesztés veszélye áll fenn,
- visszafordíthatatlan production művelet szükséges,
- az üzleti szabály valóban nem egyértelmű,
- felhasználói döntés szükséges két eltérő működés között.

# 10. Tiltott viselkedések

Tilos:

- csak a fájlok alapján késznek jelenteni a funkciót,
- csak a build alapján késznek jelenteni,
- csak a migration history alapján késznek jelenteni,
- alkalmazatlan migrációval production kész állapotot jelenteni,
- nem ellenőrzött RPC-t működőnek tekinteni,
- a production UI helyett csak a `/auth` oldalt ellenőrizni,
- hibát elrejteni `console.error` mögött,
- régi migráció módosítását elegendő javításnak tekinteni,
- production adatbázis-audit nélkül továbbhaladni,
- PARTIAL eredményt PASS-ként jelenteni,
- PASS-t adni Red Team vagy funkcionális teszt nélkül,
- olyan következő fejlesztést javasolni, amikor az aktuális feladat még nincs teljesen ellenőrizve.

# 11. Git és deploy

Minden új fájl legyen Gitben. Ellenőrizd: `git status`.

Feladat végén commit + `push origin/main` (kivéve ha a felhasználó megtiltja).

Push után: várd meg a production deploy végét. Csak READY állapot után tekintsd deployoltnak.

Ha hibát találsz: javítás → build → teszt → commit → push → deploy → ellenőrzés újra.

# 12. Jelentési formátum és végső státuszok

A végső jelentés csak bizonyított eredményeket tartalmazhat.

## 12.1 Végső státuszok (csak ezek használhatók)

**PASS**

- minden elsődleges követelmény teljesült,
- minden kötelező audit PASS,
- production funkcionális teszt PASS,
- Red Team PASS,
- nincs kritikus hiba.

**PASS WITH TELEMETRY WARNING**

- minden elsődleges üzleti művelet és kötelező audit PASS,
- csak dokumentált, másodlagos telemetria/analitika hibázott,
- nincs üzleti adatvesztés vagy inkonzisztencia.

**PARTIAL**

- valamely kötelező production ellenőrzés nem futott le,
- nincs bejelentkezett session,
- nincs bizonyítva a teljes működés.

**FAIL**

- valamely elsődleges üzleti művelet hibás,
- adatinkonzisztencia van,
- migráció vagy RPC hibás,
- kötelező audit hiányzik,
- Red Team hibát talált.

## 12.2 Kötelező mezők

- eredeti követelmények száma
- teljesített követelmények száma
- nem teljesített követelmények
- **elsődleges műveletek / másodlagos műveletek**
- **blokkoló / nem blokkoló hibák**
- önrevízió eredménye (PASS/FAIL)
- **Red Team eredménye (PASS/FAIL)**
- production Supabase projektazonosító
- migrációk
- migration history
- tényleges adatbázis-objektum audit
- RPC aláírás audit (ha érintett)
- build
- tesztek
- commit SHA
- push
- Vercel deploy SHA
- Vercel READY
- production funkcionális teszt
- production adatbázis előtte/utána állapot (ha érintett)
- konzol- és Network-ellenőrzés
- **végső státusz: PASS / PASS WITH TELEMETRY WARNING / PARTIAL / FAIL**

PASS csak teljes bizonyítottság esetén. PARTIAL-t soha ne jelents PASS-ként. FAIL esetén javíts és csak új ellenőrzés után jelents.
