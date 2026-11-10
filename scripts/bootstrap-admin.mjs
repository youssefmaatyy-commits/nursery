#!/usr/bin/env node
/**
 * Bootstrap (or rotate) the first administrator.
 *
 * Uses the SERVICE ROLE key, which must never reach the browser or the repo.
 * Run it from a trusted machine, with the key supplied through the environment:
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
 *   BOOTSTRAP_ADMIN_PASSWORD='a-long-unique-password' \
 *   node scripts/bootstrap-admin.mjs
 *
 * Optional:
 *   BOOTSTRAP_ADMIN_NAME="Branch Owner"
 *   BOOTSTRAP_ADMIN_ROLE=super_admin      (default)
 *   BOOTSTRAP_BRANCH_CODE=MAIN            (default: first active branch)
 *
 * The script is idempotent: if the user already exists it only re-asserts the
 * role and branch assignment. It never prints the password back.
 */
const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Refusing to run.');
  process.exit(2);
}
if (KEY.startsWith('sb_publishable') || KEY.length < 40) {
  console.error('That does not look like a service-role key. Refusing to run.');
  process.exit(2);
}

const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!email || !password) {
  console.error('BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required.');
  process.exit(2);
}
if (password.length < 12) {
  console.error('Password must be at least 12 characters.');
  process.exit(2);
}

const roleCode = process.env.BOOTSTRAP_ADMIN_ROLE || 'super_admin';
const branchCode = process.env.BOOTSTRAP_BRANCH_CODE || null;
const fullName = process.env.BOOTSTRAP_ADMIN_NAME || 'Administrator';

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

async function api(path, init = {}) {
  const res = await fetch(`${URL}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

async function findUserByEmail(address) {
  // The admin API has no email filter, so page through users.
  for (let page = 1; page <= 50; page++) {
    const res = await api(`/auth/v1/admin/users?page=${page}&per_page=200`);
    if (!res.ok) throw new Error(`list users failed: ${res.status} ${JSON.stringify(res.body)}`);
    const users = res.body?.users ?? [];
    const hit = users.find((u) => (u.email || '').toLowerCase() === address.toLowerCase());
    if (hit) return hit;
    if (users.length < 200) return null;
  }
  return null;
}

async function main() {
  console.log(`→ project ${URL}`);

  let user = await findUserByEmail(email);
  if (user) {
    console.log(`· user already exists (${user.id}) — resetting password`);
    const res = await api(`/auth/v1/admin/users/${user.id}`, {
      method: 'PUT',
      body: JSON.stringify({ password, email_confirm: true }),
    });
    if (!res.ok) throw new Error(`update user failed: ${res.status} ${JSON.stringify(res.body)}`);
  } else {
    console.log('· creating user');
    const res = await api('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      }),
    });
    if (!res.ok) throw new Error(`create user failed: ${res.status} ${JSON.stringify(res.body)}`);
    user = res.body?.user ?? res.body;
    console.log(`· created ${user.id}`);
  }

  // Assign the role + branch through the SQL helper exposed for bootstrap.
  const rpc = await api('/rest/v1/rpc/assign_user_role', {
    method: 'POST',
    body: JSON.stringify({ p_user: user.id, p_role: roleCode, p_branch_code: branchCode }),
  });

  if (!rpc.ok) {
    console.warn('! assign_user_role RPC unavailable. Run this in the SQL editor instead:\n');
    console.warn(
      [
        `insert into user_roles (user_id, role_id)`,
        `select '${user.id}', id from roles where code = '${roleCode}'`,
        `on conflict do nothing;`,
        branchCode
          ? `update profiles set default_branch_id = (select id from branches where code = '${branchCode}') where id = '${user.id}';`
          : `-- (no branch code supplied)`,
      ].join('\n'),
    );
  } else {
    console.log(`· role ${roleCode}${branchCode ? ` @ ${branchCode}` : ''} assigned`);
  }

  console.log('\n✅ bootstrap complete. Sign in, then change the password from the app.');
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
