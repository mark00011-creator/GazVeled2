import { createFileRoute, Outlet, Navigate, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { defaultHomeForRole, isAdminOnlyPath } from "@/lib/roles";
import { authDiag } from "@/lib/auth-diag";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: Layout,
});

function Layout() {
  const { user, loading, profile, canAccessApp } = useAuth();
  const location = useLocation();

  const baseDiag = {
    route: "authenticated",
    loading,
    hasUser: Boolean(user),
    hasProfile: Boolean(profile),
    role: profile?.role ?? null,
    is_active: profile?.is_active ?? null,
    canAccess: canAccessApp,
    pathname: location.pathname,
  };

  if (loading) {
    authDiag({ ...baseDiag, redirectReason: "LOADING" });
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Betöltés…
      </div>
    );
  }

  if (!user) {
    authDiag({ ...baseDiag, redirectReason: "NO_USER" });
    return <Navigate to="/auth" replace />;
  }

  if (!profile || !canAccessApp) {
    authDiag({
      ...baseDiag,
      redirectReason: !profile ? "NO_PROFILE" : "ROLE_DENIED",
    });
    return <Navigate to="/no-access" replace />;
  }

  if (profile.role === "exchange_operator" && isAdminOnlyPath(location.pathname)) {
    authDiag({ ...baseDiag, redirectReason: "ALLOW", note: "operator_bounce_to_quick_exchange" });
    return <Navigate to="/quick-exchange" replace />;
  }

  if (profile.role === "admin" && location.pathname === "/quick-exchange") {
    // Admin may use quick exchange – no redirect
  }

  authDiag({ ...baseDiag, redirectReason: "ALLOW" });
  return <Outlet />;
}

export function AuthenticatedHomeRedirect() {
  const { profile, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={defaultHomeForRole(profile?.role)} replace />;
}
