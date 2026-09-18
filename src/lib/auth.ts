import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/roles";
import { canAccessApp, isAdminRole, isExchangeOperatorRole } from "@/lib/roles";
import { authDiag } from "@/lib/auth-diag";
import {
  parseOrganizationSettings,
  type Organization,
  type OrganizationSettings,
} from "@/lib/organization";

export type UserProfile = {
  role: AppRole;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
  organization_id: string | null;
};

async function fetchOrganization(orgId: string): Promise<Organization | null> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, slug, logo_url, settings, is_active")
    .eq("id", orgId)
    .maybeSingle();

  if (error || !data) {
    authDiag({
      fn: "fetchOrganization",
      orgId,
      ok: false,
      message: error?.message ?? "missing_org",
    });
    return null;
  }
  if (data.is_active === false) {
    authDiag({ fn: "fetchOrganization", orgId, ok: false, message: "inactive_org" });
    return null;
  }
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    logo_url: data.logo_url,
    is_active: data.is_active,
    settings: parseOrganizationSettings(data.settings),
  };
}

async function fetchProfile(userId: string): Promise<{
  profile: UserProfile;
  organization: Organization | null;
} | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role, email, full_name, is_active, organization_id")
    .eq("id", userId)
    .single();

  if (error || !data?.role) {
    authDiag({
      fn: "fetchProfile",
      userId,
      ok: false,
      postgrestCode: error?.code ?? null,
      status: (error as { status?: number } | null)?.status ?? null,
      message: error?.message ?? (!data?.role ? "missing_role_or_row" : null),
      hasData: Boolean(data),
      role: data?.role ?? null,
      is_active: data?.is_active ?? null,
    });
    return null;
  }
  if (data.is_active === false) {
    authDiag({
      fn: "fetchProfile",
      userId,
      ok: false,
      role: data.role,
      is_active: false,
      message: "inactive_profile",
    });
    return null;
  }
  if (!data.organization_id) {
    authDiag({
      fn: "fetchProfile",
      userId,
      ok: false,
      role: data.role,
      message: "missing_organization",
    });
    return null;
  }

  const organization = await fetchOrganization(data.organization_id);
  if (!organization) {
    authDiag({
      fn: "fetchProfile",
      userId,
      ok: false,
      role: data.role,
      message: "organization_unavailable",
    });
    return null;
  }

  authDiag({
    fn: "fetchProfile",
    userId,
    ok: true,
    role: data.role,
    is_active: data.is_active ?? true,
    organization_id: data.organization_id,
  });

  return {
    profile: {
      role: data.role as AppRole,
      email: data.email,
      full_name: data.full_name,
      is_active: data.is_active ?? true,
      organization_id: data.organization_id,
    },
    organization,
  };
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load(sessionUser: User | null) {
      if (!sessionUser) {
        if (active) {
          setProfile(null);
          setOrganization(null);
          setLoading(false);
        }
        return;
      }
      const result = await fetchProfile(sessionUser.id);
      if (active) {
        setProfile(result?.profile ?? null);
        setOrganization(result?.organization ?? null);
        setLoading(false);
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      void load(data.session?.user ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      authDiag({
        fn: "onAuthStateChange",
        event,
        userId: session?.user?.id ?? null,
        email: session?.user?.email ?? null,
      });
      setUser(session?.user?.id ? session.user : null);
      if (!session?.user) {
        setProfile(null);
        setOrganization(null);
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

  const orgSettings: OrganizationSettings | null = organization?.settings ?? null;

  return {
    user,
    profile,
    organization,
    orgSettings,
    loading,
    role: profile?.role ?? null,
    isAdmin: isAdminRole(profile?.role),
    isExchangeOperator: isExchangeOperatorRole(profile?.role),
    canAccessApp: canAccessApp(profile?.role) && !!organization,
  };
}

export async function signOut() {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (userId) {
    const { clearUserWorkflowDrafts } = await import("@/lib/workflow-draft-storage");
    clearUserWorkflowDrafts(userId);
  }
  const { clearAllRouteStates } = await import("@/lib/route-state-storage");
  clearAllRouteStates();
  await supabase.auth.signOut();
}
