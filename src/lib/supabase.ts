import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client.
 *
 * Configuration order:
 *  1. Build-time environment (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`).
 *     This is the normal path: Vercel / CI inject the values at build time.
 *  2. Runtime override store (`/env.json` or the in-app configuration screen).
 *     Lets a deployment that was built without secrets still be configured by an
 *     administrator WITHOUT rebuilding — the values live in that browser's
 *     localStorage only.
 *
 * What is stored is the publishable/anon key: it is designed to be public, and
 * every table is protected by Row Level Security. A service-role key is never
 * accepted here — see `assertNotServiceKey`.
 */

const BUILD_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const BUILD_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

const RUNTIME_URL_KEY = 'erp.supabase.url';
const RUNTIME_KEY_KEY = 'erp.supabase.key';

export interface SupabaseConfig {
  url: string;
  key: string;
  source: 'build' | 'runtime' | 'none';
}

function readRuntime(): { url?: string; key?: string } {
  try {
    return {
      url: localStorage.getItem(RUNTIME_URL_KEY) ?? undefined,
      key: localStorage.getItem(RUNTIME_KEY_KEY) ?? undefined,
    };
  } catch {
    return {};
  }
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost';
  } catch {
    return false;
  }
}

/**
 * Refuses any key that is not a publishable/anon key. A service-role key in the
 * browser would bypass RLS entirely, so this guard exists even though the UI
 * never offers such a field.
 */
export function assertNotServiceKey(key: string): void {
  if (key.startsWith('sb_secret_') || key.startsWith('service_role')) {
    throw new Error('refused_service_role_key');
  }
  // Legacy service-role JWTs carry a "role":"service_role" claim.
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.role === 'service_role') throw new Error('refused_service_role_key');
    } catch (err) {
      if ((err as Error).message === 'refused_service_role_key') throw err;
    }
  }
}

export function resolveConfig(): SupabaseConfig {
  if (BUILD_URL && BUILD_KEY) return { url: BUILD_URL, key: BUILD_KEY, source: 'build' };
  const runtime = readRuntime();
  if (runtime.url && runtime.key) return { url: runtime.url, key: runtime.key, source: 'runtime' };
  return { url: '', key: '', source: 'none' };
}

const initial = resolveConfig();

if (initial.source === 'none') {
  console.error(
    '[supabase] Not configured. Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY at build time, ' +
      'or open /setup and enter them once in this browser.',
  );
}

export const supabase: SupabaseClient = createClient(
  initial.url || 'http://localhost',
  initial.key || 'public-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'erp.auth.session',
    },
    global: { headers: { 'x-application-name': 'kids-nursery-erp' } },
    db: { schema: 'public' },
  },
);

export const isSupabaseConfigured = initial.source !== 'none';

/** Where the active configuration came from — shown on the setup screen. */
export const configSource = initial.source;

/**
 * Persist a runtime configuration and reload so the client is rebuilt with it.
 * The caller must present the values; nothing is fetched over the network.
 */
export function saveRuntimeConfig(url: string, key: string): void {
  const cleanUrl = url.trim().replace(/\/+$/, '');
  const cleanKey = key.trim();
  if (!isValidUrl(cleanUrl)) throw new Error('invalid_url');
  if (!cleanKey) throw new Error('invalid_key');
  assertNotServiceKey(cleanKey);
  localStorage.setItem(RUNTIME_URL_KEY, cleanUrl);
  localStorage.setItem(RUNTIME_KEY_KEY, cleanKey);
}

export function clearRuntimeConfig(): void {
  localStorage.removeItem(RUNTIME_URL_KEY);
  localStorage.removeItem(RUNTIME_KEY_KEY);
}

/** Verify the credentials actually work before saving them. */
export async function testConnection(url: string, key: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const probe = createClient(url.trim().replace(/\/+$/, ''), key.trim(), {
      auth: { persistSession: false },
    });
    const { error } = await probe.auth.getSession();
    if (error) return { ok: false, message: error.message };
    // Unauthenticated RPC: must be reachable (and, correctly, returns no data).
    const { error: rpcError } = await probe.rpc('my_context');
    if (rpcError && !/permission|jwt|unauthor/i.test(rpcError.message)) {
      return { ok: false, message: rpcError.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
