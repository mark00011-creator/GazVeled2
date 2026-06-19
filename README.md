# Gáz Veled

Gázpalack-nyilvántartás és cserefolyamatok kezelése magyar viszonteladóknak.

## Funkciók

- **Áttekintés** – készlet, SIAD kockázat, bérleti bevétel
- **Gyors csere** – partneri palackcsere vonalkód-olvasóval
- **Palackok** – lista, inline szerkesztés, részletek
- **Partnerek** – ügyfélnyilvántartás
- **Bérletek** – aktív és lezárt bérletek, új bérlet felvétele
- **Beszállítói cserék** – SIAD / saját szolgáltató
- **Bérlet visszavétel** – aktív bérlet lezárása
- **Audit napló** – műveleti előzmények

## Technológia

- React 19 + TanStack Start/Router + Vite
- Supabase (Auth, Postgres, RLS)
- shadcn/ui + Tailwind CSS 4

## Helyi futtatás

### 1. Függőségek

```bash
npm install --legacy-peer-deps
```

### 2. Környezeti változók

Másold az `.env.example` fájlt `.env.local` néven, és töltsd ki a Supabase adataiddal:

```bash
cp .env.example .env.local
```

Szükséges változók:

- `VITE_SUPABASE_URL` – pl. `https://snmiwsgtnokvqlnwvfwf.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY` – Supabase publishable (anon) kulcs

> A `.env.local` fájl **ne kerüljön** verziókezelésbe.

### 3. Fejlesztői szerver

```bash
npm run dev
```

### 4. Build ellenőrzés

```bash
npm run build
npm run lint
```

**TanStack Start – „Crawling result not available”**

Ez nem alkalmazás-logika hiba, hanem a TanStack Router plugin átmeneti állapota: a `routeTree.gen.ts` betöltésekor a route-fájlok crawl eredménye még nem áll rendelkezésre.

- **Vercel éles build:** rendben (utolsó deployok ~34–43 s, Ready).
- **Helyi `npm run build`:** jelenleg sikeres; korábbi hiba valószínűleg a kézi `routeTree.gen.ts` szerkesztés + új route fájl (`chinese-stock.tsx`) közötti inkonzisztenciából adódott.
- **Prerender:** nincs engedélyezve (`prerender.enabled` alapértelmezetten ki).

Ha újra előjön:

1. Ne szerkeszd kézzel a `src/routeTree.gen.ts` fájlt – csak új route fájlokat adj hozzá a `src/routes/` alá.
2. Futtasd egyszer: `npm run dev` (route tree újragenerálás), majd `npm run build`.
3. Ha továbbra is hibázik: zárd be a dev szervert, töröld a `.vercel/output` mappát, és build újra.

A `src/routes/README.md` is rögzíti: a route tree automatikusan generált.

## Supabase

A séma migrációk a `supabase/migrations/` mappában találhatók. A távoli projekt ref: `snmiwsgtnokvqlnwvfwf`.

## Megjegyzések

- Bejelentkezés Supabase Auth-tal (email/jelszó)
- Első felhasználó automatikusan `user` szerepkört kap
- Admin szerepkör: `user_roles` táblában manuálisan állítható
