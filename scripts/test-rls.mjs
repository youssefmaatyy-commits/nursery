#!/usr/bin/env node
/**
 * RLS / privilege test harness.
 * Runs against a live Supabase project using ONLY the publishable (anon) key,
 * exactly like an unauthenticated browser would. Any successful read of
 * protected data is a failure.
 *
 * Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/test-rls.mjs
 */
const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY env vars');
  process.exit(2);
}

const PROTECTED_TABLES = [
  'children', 'parents', 'child_guardians', 'authorized_pickups', 'child_documents',
  'medical_notes', 'invoices', 'invoice_items', 'payments', 'refunds', 'expenses',
  'cash_shifts', 'cash_movements', 'products', 'suppliers', 'purchases', 'employees',
  'employee_attendance', 'subscriptions', 'kids_area_sessions', 'nursery_attendance',
  'daily_child_reports', 'audit_logs', 'profiles', 'user_roles', 'notifications',
  'uploaded_files', 'sync_operations', 'pricing_rules', 'classrooms',
];

const PROTECTED_RPCS = [
  ['dashboard_metrics', {}],
  ['my_context', {}],
  ['children_inside', {}],
  ['report_profit_loss', { p_branch: '00000000-0000-0000-0000-000000000000', p_from: '2026-01-01', p_to: '2026-12-31' }],
  ['search_children', { p_query: 'omar' }],
];

let pass = 0, fail = 0;
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function anonSelect(table) {
  const res = await fetch(`${URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
  });
  const body = await res.text();
  return { status: res.status, body };
}

async function anonRpc(fn, args) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await res.text();
  return { status: res.status, body };
}

function leaks(payload) {
  try {
    const parsed = JSON.parse(payload);
    if (Array.isArray(parsed) && parsed.length > 0) return true;
    if (parsed && !Array.isArray(parsed) && Object.keys(parsed).length > 0) return true;
  } catch { /* empty body = fine */ }
  return false;
}

console.log('\n=== Anonymous access to protected tables ===');
for (const t of PROTECTED_TABLES) {
  const { status, body } = await anonSelect(t);
  const ok = !(status === 200 && leaks(body));
  record(`anon cannot read ${t}`, ok, status === 200 ? 'HTTP 200 empty/no rows' : `HTTP ${status}`);
}

console.log('\n=== Anonymous access to protected RPCs ===');
for (const [fn, args] of PROTECTED_RPCS) {
  const { status, body } = await anonRpc(fn, args);
  const ok = status >= 400 || !leaks(body);
  record(`anon cannot execute ${fn}`, ok, `HTTP ${status}`);
}

console.log('\n=== Authentication guards ===');
{
  const res = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  record('invalid session cannot fetch a user', res.status >= 400, `HTTP ${res.status}`);
}
{
  const res = await fetch(`${URL}/rest/v1/children?select=*`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name_en: 'Hack', full_name_ar: 'اختراق', branch_id: '00000000-0000-0000-0000-000000000000', date_of_birth: '2020-01-01' }),
  });
  record('anon cannot insert a child', res.status >= 400, `HTTP ${res.status}`);
}

console.log('\n=== Storage privacy ===');
for (const bucket of ['child-documents', 'child-photos', 'invoices', 'expense-receipts', 'parent-documents']) {
  const res = await fetch(`${URL}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: '' }),
  });
  const body = await res.text();
  record(`bucket ${bucket} not publicly listable`, !(res.status === 200 && leaks(body)), `HTTP ${res.status}`);
}

console.log(`\n${'='.repeat(60)}\nRLS TEST SUMMARY: ${pass} passed, ${fail} failed\n${'='.repeat(60)}`);
process.exit(fail === 0 ? 0 : 1);
