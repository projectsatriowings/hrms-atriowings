"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthUser, LoginSuccessResponse, Role } from "@hrms/shared";
import { apiGet, apiPost, getAccessToken, restoreSessionFromCookie, setAccessToken } from "@/lib/api";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string, companyCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
  /** Short-lived MFA challenge token, set by login() on an mfa_required response. */
  pendingMfaToken: string | null;
  /** Completes the MFA challenge; returns true if a forced password change is pending. */
  completeMfaLogin: (code: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingMfaToken, setPendingMfaToken] = useState<string | null>(null);
  const router = useRouter();

  const refreshUser = useCallback(async () => {
    const u = await apiGet<AuthUser>("/auth/me");
    setUser(u);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // A13: the access token lives in memory only, so a reload always
        // starts with no token. Restore via the httpOnly refresh cookie;
        // a failed refresh is just the logged-out state (no crash, no loop).
        if (!getAccessToken()) await restoreSessionFromCookie();
        if (getAccessToken()) await refreshUser();
      } catch {
        setAccessToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshUser]);

  const login = useCallback(
    async (email: string, password: string, companyCode?: string) => {
      // Loose shape (not the strict union): the MFA branch is detected by
      // the mfaRequired flag, and TS does not reliably narrow the strict
      // union past the never-resolving early return below.
      const data = await apiPost<{
        mfaRequired?: boolean; mfaToken?: string;
        accessToken?: string; user?: AuthUser; mustChangePassword?: boolean;
      }>("/auth/login", { email, password, companyCode });
      if (data.mfaRequired && data.mfaToken) {
        // NOTE — login-page constraint: app/(auth)/login/page.tsx is owned by
        // another workstream and does `await login(...); router.push("/dashboard")`.
        // We must not let that push run for a step-up flow, and we cannot
        // edit that page. So: navigate ourselves, then return a
        // never-resolving promise. The caller's `await` never continues, so
        // its router.push("/dashboard") never executes. Same below for the
        // forced-change-password step.
        setPendingMfaToken(data.mfaToken);
        router.push("/mfa");
        await new Promise<void>(() => {});
        return;
      }
      setAccessToken(data.accessToken as string);
      setUser(data.user as AuthUser);
      setPendingMfaToken(null);
      if (data.mustChangePassword) {
        router.push("/change-password");
        await new Promise<void>(() => {});
        return;
      }
    },
    [router],
  );

  const completeMfaLogin = useCallback(async (code: string) => {
    if (!pendingMfaToken) throw new Error("MFA session expired. Please log in again.");
    const data = await apiPost<LoginSuccessResponse>("/auth/mfa/verify", { mfaToken: pendingMfaToken, code });
    setAccessToken(data.accessToken);
    setUser(data.user);
    setPendingMfaToken(null);
    return data.mustChangePassword;
  }, [pendingMfaToken]);

  const logout = useCallback(async () => {
    try {
      await apiPost("/auth/logout");
    } catch {
      /* best effort */
    }
    setAccessToken(null);
    setUser(null);
    setPendingMfaToken(null);
    router.replace("/login");
  }, [router]);

  const hasRole = useCallback((...roles: Role[]) => (user ? roles.includes(user.role) : false), [user]);

  const value = useMemo(
    () => ({ user, loading, login, logout, refreshUser, hasRole, pendingMfaToken, completeMfaLogin }),
    [user, loading, login, logout, refreshUser, hasRole, pendingMfaToken, completeMfaLogin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Redirects to /login when the session is resolved and there is no user. */
export function useRequireAuth(): AuthUser | null {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);
  return user;
}
