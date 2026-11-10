import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export interface AppContext {
  user_id: string;
  profile: {
    id: string; full_name_en: string | null; full_name_ar: string | null; email: string | null;
    phone: string | null; locale: 'ar' | 'en'; default_branch_id: string | null; is_active: boolean;
  } | null;
  roles: string[];
  permissions: string[];
  branches: Array<{ id: string; code: string; name_en: string; name_ar: string; currency: string; timezone: string; tax_rate: number }>;
  is_super_admin: boolean;
  is_parent: boolean;
  parent_children: Array<{ id: string; name_en: string; name_ar: string; code: string }>;
}

interface AuthState {
  session: Session | null;
  context: AppContext | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  can: (permission: string | string[]) => boolean;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [context, setContext] = useState<AppContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadContext = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('my_context');
    if (rpcError) {
      setError(rpcError.message);
      setContext(null);
      return;
    }
    setContext((data as unknown as AppContext) ?? null);
    setError(null);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (data.session) await loadContext();
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'SIGNED_OUT' || !next) {
        setContext(null);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        void loadContext();
      }
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [loadContext]);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      throw signInError;
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setContext(null);
    setSession(null);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (resetError) throw resetError;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) throw updateError;
  }, []);

  const can = useCallback(
    (permission: string | string[]) => {
      if (!context) return false;
      if (context.is_super_admin) return true;
      const list = Array.isArray(permission) ? permission : [permission];
      return list.some((p) => context.permissions.includes(p));
    },
    [context],
  );

  const value = useMemo<AuthState>(
    () => ({ session, context, loading, error, signIn, signOut, resetPassword, updatePassword, can, refresh: loadContext }),
    [session, context, loading, error, signIn, signOut, resetPassword, updatePassword, can, loadContext],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
