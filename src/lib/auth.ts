import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthChangeEvent, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/roles";
import { canAccessApp, isAdminRole, isExchangeOperatorRole } from "@/lib/roles";
import { authDiag } from "@/lib/auth-diag";
import {
  parseOrganizationSettings,
  type Organization,
  type OrganizationSettings,
} from "@/lib/organization";

export type AccessDenialReason =
  | "inactive"
  | "missing_organization"
  | "organization_unavailable"
  | "viewer"
  | "missing_profile"
  | null;

export type UserProfile = {
  role: AppRole;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
  organization_id: string | null;
  is_platform_admin: boolean;
};

type AuthValue = {
  user: User | null;
  profile: UserProfile | null;
  organization: Organization | null;
  orgSettings: OrganizationSettings | null;
  denialReason: AccessDenialReason;
  loading: boolean;
  role: AppRole | null;
  isAdmin: boolean;
  isPlatformAdmin: boolean;
  isExchangeOperator: boolean;
  canAccessApp: boolean;
};

const AuthContext = createContext<AuthValue | null>(null);

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
  profile: UserProfile | null;
  organization: Organization | null;
  denialReason: AccessDenialReason;
}> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role, email, full_name, is_active, organization_id, is_platform_admin")
    .eq("id", userId)
    .maybeSingle();

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
    return { profile: null, organization: null, denialReason: "missing_profile" };
  }

  const profile: UserProfile = {
    role: data.role as AppRole,
    email: data.email,
    full_name: data.full_name,
    is_active: data.is_active ?? true,
    organization_id: data.organization_id,
    is_platform_admin: data.is_platform_admin === true,
  };

  if (data.is_active === false) {
    authDiag({
      fn: "fetchProfile",
      userId,
      ok: false,
      role: data.role,
      is_active: false,
      message: "inactive_profile",
    });
    return { profile, organization: null, denialReason: "inactive" };
  }

  if (!data.organization_id) {
    authDiag({
      fn: "fetchProfile",
      userId,
      ok: false,
      role: data.role,
      message: "missing_organization",
    });
    return { profile, organization: null, denialReason: "missing_organization" };
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
    return { profile, organization: null, denialReason: "organization_unavailable" };
  }

  if (!canAccessApp(profile.role)) {
    authDiag({
      fn: "fetchProfile",
      userId,
      ok: false,
      role: data.role,
      message: "viewer_or_denied",
    });
    return { profile, organization, denialReason: "viewer" };
  }

  authDiag({
    fn: "fetchProfile",
    userId,
    ok: true,
    role: data.role,
    is_active: data.is_active ?? true,
    organization_id: data.organization_id,
  });

  return { profile, organization, denialReason: null };
}

/** Ablakváltáskori token refresh – NE takarja el az oldalt (formállapot megmarad). */
function shouldBlockUiForAuthEvent(
  event: AuthChangeEvent,
  nextUserId: string | null,
  hydratedUserId: string | null,
): boolean {
  if (!nextUserId) return false;
  if (!hydratedUserId) return true;
  if (hydratedUserId !== nextUserId) return true;
  if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return false;
  // Ugyanaz a user, session újrajelzés (pl. tab focus) – háttérben frissítünk
  if (event === "SIGNED_IN" || event === "INITIAL_SESSION") return false;
  return false;
}

function useAuthState(): AuthValue {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [denialReason, setDenialReason] = useState<AccessDenialReason>(null);
  const [loading, setLoading] = useState(true);
  const hydratedUserIdRef = useRef<string | null>(null);
  const loadGenRef = useRef(0);

  const applySession = useCallback(async (sessionUser: User | null, blockUi: boolean) => {
    const gen = ++loadGenRef.current;
    if (!sessionUser) {
      hydratedUserIdRef.current = null;
      setUser(null);
      setProfile(null);
      setOrganization(null);
      setDenialReason(null);
      setLoading(false);
      return;
    }

    setUser(sessionUser);
    if (blockUi) setLoading(true);

    const result = await fetchProfile(sessionUser.id);
    if (gen !== loadGenRef.current) return;

    setProfile(result.profile);
    setOrganization(result.organization);
    setDenialReason(result.denialReason);
    hydratedUserIdRef.current = sessionUser.id;
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const u = data.session?.user ?? null;
      void applySession(u, true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      const nextUser = session?.user ?? null;
      authDiag({
        fn: "onAuthStateChange",
        event,
        userId: nextUser?.id ?? null,
        email: nextUser?.email ?? null,
        quiet: !shouldBlockUiForAuthEvent(event, nextUser?.id ?? null, hydratedUserIdRef.current),
      });

      if (!nextUser) {
        void applySession(null, false);
        return;
      }

      const blockUi = shouldBlockUiForAuthEvent(
        event,
        nextUser.id,
        hydratedUserIdRef.current,
      );
      void applySession(nextUser, blockUi);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [applySession]);

  const orgSettings: OrganizationSettings | null = organization?.settings ?? null;

  return useMemo(
    () => ({
      user,
      profile,
      organization,
      orgSettings,
      denialReason,
      loading,
      role: profile?.role ?? null,
      isAdmin: isAdminRole(profile?.role),
      isPlatformAdmin: profile?.is_platform_admin === true,
      isExchangeOperator: isExchangeOperatorRole(profile?.role),
      canAccessApp: canAccessApp(profile?.role) && !!organization && denialReason === null,
    }),
    [user, profile, organization, orgSettings, denialReason, loading],
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useAuthState();
  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth csak AuthProvider-en belül használható");
  }
  return ctx;
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
