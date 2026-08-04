import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { defaultHomeForRole } from "@/lib/roles";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gáz Veled – Palack Manager" },
      { name: "description", content: "Ipari gázpalack nyilvántartó és bérletkezelő rendszer." },
    ],
  }),
  component: Index,
});

function Index() {
  const { user, loading, profile } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Betöltés…
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  return <Navigate to={defaultHomeForRole(profile?.role)} replace />;
}
