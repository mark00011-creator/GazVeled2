import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/rentals")({
  component: RentalsLayout,
});

function RentalsLayout() {
  return <Outlet />;
}
