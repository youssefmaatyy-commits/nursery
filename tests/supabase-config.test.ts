import { afterEach, describe, expect, it } from 'vitest';
import { assertNotServiceKey, clearRuntimeConfig, resolveConfig, saveRuntimeConfig } from '@/lib/supabase';

/**
 * The runtime configuration store is the only place a browser can be pointed at
 * a database. These tests lock down the one rule that matters: a service-role
 * key must never be accepted, because it would bypass every RLS policy.
 */

const b64 = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/=+$/, '');

// A syntactically valid JWT-shaped legacy anon key (role: anon) for control cases.
const legacyAnonKey = `eyJhbGciOiJIUzI1NiJ9.${b64({ role: 'anon', iss: 'supabase' })}.signature`;

describe('service-role key guard', () => {
  it('rejects the new-format secret key prefix', () => {
    expect(() => assertNotServiceKey('sb_secret_abcdefghijklmnop')).toThrow('refused_service_role_key');
  });

  it('rejects a legacy JWT whose role claim is service_role', () => {
    const serviceJwt = `eyJhbGciOiJIUzI1NiJ9.${b64({ role: 'service_role' })}.sig`;
    expect(() => assertNotServiceKey(serviceJwt)).toThrow('refused_service_role_key');
  });

  it('rejects the literal service_role prefix', () => {
    expect(() => assertNotServiceKey('service_role_key_value')).toThrow('refused_service_role_key');
  });

  it('accepts publishable and legacy anon keys', () => {
    expect(() => assertNotServiceKey('sb_publishable_6JJEkKFCsBmmWY2d4VQ9aA_DwDEar8H')).not.toThrow();
    expect(() => assertNotServiceKey(legacyAnonKey)).not.toThrow();
  });

  it('does not throw on malformed input (it is simply not a service key)', () => {
    expect(() => assertNotServiceKey('not-a-jwt')).not.toThrow();
    expect(() => assertNotServiceKey('a.b.c')).not.toThrow();
  });
});

describe('runtime configuration store', () => {
  afterEach(() => clearRuntimeConfig());

  it('refuses to persist a service-role key', () => {
    expect(() => saveRuntimeConfig('https://example.supabase.co', 'sb_secret_x')).toThrow(
      'refused_service_role_key',
    );
  });

  it('refuses a non-http(s) url', () => {
    expect(() => saveRuntimeConfig('javascript:alert(1)', 'sb_publishable_x')).toThrow('invalid_url');
    expect(() => saveRuntimeConfig('ftp://example.com', 'sb_publishable_x')).toThrow('invalid_url');
  });

  it('refuses an empty key', () => {
    expect(() => saveRuntimeConfig('https://example.supabase.co', '   ')).toThrow('invalid_key');
  });

  it('persists valid credentials and strips trailing slashes', () => {
    saveRuntimeConfig('https://example.supabase.co///', 'sb_publishable_abc');
    expect(localStorage.getItem('erp.supabase.url')).toBe('https://example.supabase.co');
    expect(localStorage.getItem('erp.supabase.key')).toBe('sb_publishable_abc');
  });

  it('clears the stored configuration', () => {
    saveRuntimeConfig('https://example.supabase.co', 'sb_publishable_abc');
    clearRuntimeConfig();
    expect(localStorage.getItem('erp.supabase.url')).toBeNull();
    expect(localStorage.getItem('erp.supabase.key')).toBeNull();
  });

  it('always reports a coherent source for the resolved configuration', () => {
    // Vitest loads `.env` the same way Vite does, so in a configured checkout the
    // source is "build"; in a bare checkout it falls through to "runtime" (if a
    // value was stored) or "none". Whatever the case, the source must agree with
    // whether credentials are actually present.
    const cfg = resolveConfig();
    expect(['build', 'runtime', 'none']).toContain(cfg.source);
    if (cfg.source === 'none') {
      expect(cfg.url).toBe('');
      expect(cfg.key).toBe('');
    } else {
      expect(cfg.url).toMatch(/^https:/);
      expect(cfg.key.length).toBeGreaterThan(10);
    }
  });
});
