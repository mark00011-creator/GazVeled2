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

Egy feladat **nem** tekinthető késznek attól, hogy:

- a kód elkészült,
- a build sikeres,
- a migrációs fájl létrejött,
- a commit és push megtörtént,
- a Vercel deploy READY.

A feladat **csak akkor kész**, ha:

- a kód működik,
- az adatbázis-változás ténylegesen alkalmazva van,
- a production környezet a várt verziót használja,
- az adatbázis audit PASS,
- a production UI vagy API teszt PASS,
- az eredmény megegyezik a feladat üzleti követelményeivel.

Localhost önmagában nem elegendő.

# 2. Kötelező feladat-végrehajtási folyamat

Minden feladatot az alábbi sorrendben hajts végre:

1. Olvasd el a teljes feladatot.
2. Írd össze belső ellenőrzőlistában az összes követelményt.
3. Vizsgáld meg a jelenlegi implementációt.
4. Ellenőrizd a production adatbázis és production kód tényleges állapotát.
5. Azonosítsd a módosítandó fájlokat és adatbázis-objektumokat.
6. Implementáld a változtatást.
7. Végezz saját kódrevíziót.
8. Futtasd a buildet (`npm run build`).
9. Futtasd a teszteket (`npm test`).
10. Ellenőrizd a git diffet.
11. Alkalmazd a szükséges migrációkat productionön.
12. Auditáld a production adatbázist.
13. Commit.
14. Push `origin/main`.
15. Várd meg a Vercel Production READY állapotot.
16. Ellenőrizd, hogy a deploy commit SHA megegyezik a pusholt commit SHA-val.
17. Végezz production funkcionális tesztet.
18. Hasonlítsd össze az eredményt az eredeti követelménylistával.
19. Ha bármely pont hibás, javítsd ki, majd ismételd meg az ellenőrzési folyamatot.
20. Csak teljes PASS után jelentsd késznek.

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

# 4. Adatbázis – alapelvek

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

# 6. Hibák kezelése

Tilos kritikus üzleti vagy adatbázis-hibát kizárólag `console.error` segítségével elnyelni.

Ha egy kötelező naplózás, RPC, adatbázis-módosítás vagy üzleti művelet hibás:

- a felhasználó ne kapjon hamis sikerüzenetet,
- a művelet ne legyen késznek tekintve,
- a hiba kerüljön naplózásra,
- a hiba legyen látható a fejlesztési ellenőrzésben,
- szükség esetén a teljes tranzakció álljon vissza.

Csak valóban opcionális telemetria vagy másodlagos naplózás hibája lehet nem blokkoló. Ezt a kódban egyértelműen dokumentálni kell.

# 7. Production funkcionális teszt

HTTP 200 vagy a bejelentkező oldal betöltése **nem** production funkcionális teszt.

A production UI tesztnek az adott funkció **teljes folyamatát** kell ellenőriznie.

Ha nincs bejelentkezett production session, a feladat **nem** jelenthető teljesen ellenőrzöttnek. Ilyenkor az eredmény státusza:

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
- olyan következő fejlesztést javasolni, amikor az aktuális feladat még nincs teljesen ellenőrizve.

# 11. Git és deploy

Minden új fájl legyen Gitben. Ellenőrizd: `git status`.

Feladat végén commit + `push origin/main` (kivéve ha a felhasználó megtiltja).

Push után: várd meg a production deploy végét. Csak READY állapot után tekintsd deployoltnak.

Ha hibát találsz: javítás → build → teszt → commit → push → deploy → ellenőrzés újra.

# 12. Jelentési formátum

A végső jelentés csak bizonyított eredményeket tartalmazhat.

Kötelező mezők:

- eredeti követelmények száma
- teljesített követelmények száma
- nem teljesített követelmények
- önrevízió eredménye (PASS/FAIL)
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
- **végső státusz: PASS / PARTIAL / FAIL**

PASS csak akkor használható, ha minden követelmény ellenőrizve és működőképes.

PARTIAL esetén pontosan írd le, mi nincs ellenőrizve.

FAIL esetén írd le a hibát, javítsd ki, és csak az új ellenőrzés után készíts végső jelentést.
