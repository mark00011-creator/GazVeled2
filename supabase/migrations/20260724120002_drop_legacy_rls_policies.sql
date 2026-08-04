-- Régi permissive RLS policy-k eltávolítása (RBAC után)
DROP POLICY IF EXISTS "exchanges read authenticated" ON public.exchanges;
DROP POLICY IF EXISTS "exchanges insert writer" ON public.exchanges;
DROP POLICY IF EXISTS "exchanges update writer" ON public.exchanges;
DROP POLICY IF EXISTS "partners read authenticated" ON public.partners;
DROP POLICY IF EXISTS "partners insert writer" ON public.partners;
DROP POLICY IF EXISTS "partners update writer" ON public.partners;
DROP POLICY IF EXISTS "partners delete admin" ON public.partners;
DROP POLICY IF EXISTS "cylinders read authenticated" ON public.cylinders;
DROP POLICY IF EXISTS "cylinders insert writer" ON public.cylinders;
DROP POLICY IF EXISTS "cylinders update writer" ON public.cylinders;
DROP POLICY IF EXISTS "product_prices read authenticated" ON public.product_prices;
