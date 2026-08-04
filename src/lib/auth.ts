import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/roles";
import { canAccessApp, isAdminRole, isExchangeOperatorRole } from "@/lib/roles";

export type UserProfile = {
  role: AppRole;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
};

async function fetchProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role, email, full_name, is_active")
    .eq("id", userId)
    .single();

  if (error || !data?.role) return null;
  if (data.is_active === false) return null;
  return {
    role: data.role as AppRole,
    email: data.email,
    full_name: data.full_name,
    is_active: data.is_active ?? true,
  };
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load(sessionUser: User | null) {
      if (!sessionUser) {
        if (active) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }
      const p = await fetchProfile(sessionUser.id);
      if (active) {
        setProfile(p);
        setLoading(false);
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      void load(data.session?.user ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        setProfile(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      void load(session.user);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return {
    user,
    profile,
    loading,
    role: profile?.role ?? null,
    isAdmin: isAdminRole(profile?.role),
    isExchangeOperator: isExchangeOperatorRole(profile?.role),
    canAccessApp: canAccessApp(profile?.role),
  };
}

export async function signOut() {
  await supabase.auth.signOut();
}
