# Fejlesztési alapelvek

- Egy prompt = egy üzleti funkció.
- Ne próbálj egyszerre több külön fejlesztést megvalósítani.
- Ha a felhasználó több funkciót kér egyszerre, bontsd külön feladatokra.
- Mindig csak az aktuális feladatot implementáld.

# Implementálás

- Ne készíts hosszú elemzést.
- Ne írj fejlesztési tervet.
- Ne magyarázd el a feladatot.
- Közvetlenül implementálj.

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

# Adatbázis

- Csak akkor készíts migrációt, ha valóban szükséges.
- Ha már létezik megfelelő mező vagy tábla, használd azt.
- Ne hozz létre duplikált struktúrákat.
- IF NOT EXISTS használata kötelező.

# Üzleti logika

- A rendszer ne tiltson.
- Inkább figyelmeztessen.
- A felhasználó mindig felülbírálhatja a rendszert.
- Minden fontos esemény kerüljön naplózásra.

# Production-first

Minden fejlesztés production használatra kész állapotban készüljön.

A feladat csak akkor tekinthető késznek, ha:

- build sikeres
- production deploy sikeres
- production UI működik

A localhost önmagában nem elegendő.

# Build

Minden feladat végén kötelező:

```
npm run build
```

Ha hibás: javítani kell.

# Git

Minden új fájl legyen Gitben.

Mindig ellenőrizd:

```
git status
```

Soha ne maradjon:

- untracked fájl
- véletlenül kihagyott új fájl

# Commit

Mindig készíts commitot.

Commit után:

```
push origin/main
```

Soha ne hagyj olyan commitot, ami csak lokálisan létezik.

Ha készült commit, annak productionbe is kerülnie kell, kivéve ha a felhasználó ezt külön megtiltja.

# Vercel

Push után: várd meg a production deploy végét.

Csak READY állapot után tekintsd késznek.

# Production UI ellenőrzés

Production környezetben ellenőrizd:

- új funkció működik
- nincs konzolhiba
- nincs runtime hiba
- nincs hiányzó UI
- nincs hiányzó route
- nincs hiányzó mező

Ha hibát találsz: javítsd → build → commit → push → deploy → ellenőrzés újra.

# Jelentés

A végén csak ezt írd le:

- módosított fájlok
- adatbázis változott-e
- migráció készült-e
- build eredmény
- commit SHA
- push sikeres-e
- Vercel READY
- production UI ellenőrzés eredménye

Ne írj több oldalas összefoglalót.

# GazVeled speciális szabályok

- A rendszer elsődleges célja a valós üzleti folyamatok támogatása.
- A rendszer ne akadályozza a munkát.
- A rendszer figyelmeztessen, de ne tiltson.
- Minden fontos esemény kerüljön naplózásra.
- A jövőbeni AI funkciók miatt minden üzleti esemény legyen strukturált objektumként tárolva.
- Új fejlesztésnél mindig gondolj arra, hogy később AI fogja elemezni az adatokat.
