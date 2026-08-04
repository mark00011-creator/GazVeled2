import { createFileRoute, Outlet, Navigate, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { defaultHomeForRole, isAdminOnlyPath } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: Layout,
});

function Layout() {
  const { user, loading, profile, canAccessApp } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Betöltés…
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  if (!profile || !canAccessApp) {
    return <Navigate to="/no-access" replace />;
  }

  if (profile.role === "exchange_operator" && isAdminOnlyPath(location.pathname)) {
    return <Navigate to="/quick-exchange" replace />;
  }

  if (profile.role === "admin" && location.pathname === "/quick-exchange") {
    // Admin may use quick exchange – no redirect
  }

  return <Outlet />;
}

export function AuthenticatedHomeRedirect() {
  const { profile, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={defaultHomeForRole(profile?.role)} replace />;
}
