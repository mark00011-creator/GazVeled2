# Supabase migráció – ellenőrző jelentés

**Projekt:** `snmiwsgtnokvqlnwvfwf`  
**Dátum:** 2026-06-22  
**Állapot:** Az agent sessionből **nem ellenőrizhető** (MCP offline). Futtasd a lenti SQL-t a Supabase SQL Editorban.

---

## 1. PB készlet táblák létezése

```sql
SELECT
  to_regclass('public.flaga_pb_stock') AS flaga_pb_stock,
  to_regclass('public.flaga_pb_stock_movements') AS flaga_pb_movements,
  to_regclass('public.prima_pb_stock') AS prima_pb_stock,
  to_regclass('public.prima_pb_stock_movements') AS prima_pb_movements,
  to_regclass('public.rental_quantity_items') AS rental_quantity_items;
```

**Várt eredmény:** minden oszlop **nem NULL** (pl. `flaga_pb_stock`).

Ha **NULL** → futtasd: `supabase/migrations/20260621120000_flaga_prima_pb_stock.sql`

---

## 2. RPC függvények

```sql
SELECT proname
FROM pg_proc
JOIN pg_namespace n ON n.oid = pg_proc.pronamespace
WHERE n.nspname = 'public'
  AND proname IN ('adjust_flaga_pb_stock', 'adjust_prima_pb_stock');
```

**Várt:** 2 sor.

---

## 3. Katalógus seed (FLAGA PB)

```sql
SELECT gas_type, size, full_count, empty_count
FROM public.flaga_pb_stock
ORDER BY gas_type, size;
```

**Várt 5 sor:**
| gas_type | size |
|----------|------|
| Motorüzemű Flaga | 11 kg |
| Propán-Bután | 11,5 kg |
| Propán-Bután | 23 kg |
| Propán | 10,5 kg |
| Kompozit | 7,5 kg |

---

## 4. PRÍMA PB seed

```sql
SELECT gas_type, size FROM public.prima_pb_stock;
```

**Várt:** `Motor` / `12,5 kg`

---

## 5. Gáz rendelés quantity (új funkció)

```sql
SELECT to_regclass('public.gas_order_quantity_items') AS qty_items;
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'gas_orders' AND column_name = 'order_kind';
```

Ha **NULL** / nincs `order_kind` → futtasd: `supabase/migrations/20260622120000_gas_order_quantity.sql`

---

## 6. Alkalmazandó migrációk sorrendben (ha semmi nincs)

1. `20260621120000_flaga_prima_pb_stock.sql` – FLAGA PB + PRÍMA PB készlet
2. `20260622120000_gas_order_quantity.sql` – gáz rendelés darabszám tételek

**NE futtasd:** `20260620130000_flaga_cylinder_stock.sql` (duplikált FLAGA modul, törölve az appból)

---

## 7. enum bővítés (exchange)

```sql
SELECT unnest(enum_range(NULL::public.exchange_operation_type))::text AS op
WHERE unnest(enum_range(NULL::public.exchange_operation_type))::text IN ('flaga_pb_sale', 'prima_pb_sale');
```

Ha üres → a `20260621120000` migráció végén lévő `ALTER TYPE` blokkok futtatása szükséges.
