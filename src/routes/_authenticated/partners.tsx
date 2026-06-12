import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/partners")({
  component: PartnersLayout,
});

/** Layout route – child routes (index list, $id detail) render in Outlet. */
function PartnersLayout() {
  return <Outlet />;
}
