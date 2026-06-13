import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ProfileRole = "admin" | "viewer";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { user, loading };
}

export async function signOut() {
  await supabase.auth.signOut();
}

export function useCurrentProfile() {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: ["current-profile", user?.id],
    enabled: !authLoading && !!user,
    queryFn: async () => {
      if (!user) return null;

      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, role")
        .eq("id", user.id)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });
}

export function usePermissions() {
  const { user, loading: authLoading } = useAuth();
  const profile = useQuery({
    queryKey: ["current-profile", user?.id],
    enabled: !authLoading && !!user,
    queryFn: async () => {
      if (!user) return null;

      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, role")
        .eq("id", user.id)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  const role: ProfileRole = profile.data?.role === "admin" ? "admin" : "viewer";

  return {
    role,
    canWrite: role === "admin",
    isAdmin: role === "admin",
    loading: authLoading || (!!user && profile.isLoading),
    profile: profile.data ?? null,
  };
}
