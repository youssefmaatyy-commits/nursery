# Installation

## Prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | 20 LTS or 22 | `node -v` |
| npm | 10+ | `npm -v` |
| Git | any recent | `git --version` |
| Supabase CLI (optional) | 1.200+ | `supabase --version` |

You also need a Supabase project (free tier is enough to evaluate). No local
Docker or Postgres install is required — the app talks to hosted Supabase.

## 1. Clone

```bash
git clone https://github.com/youssefmaatyy-commits/nursery.git
cd nursery
git switch develop        # integration branch; main is production
```

## 2. Install dependencies

```bash
npm install --legacy-peer-deps
```

`--legacy-peer-deps` is required because `vite-plugin-pwa` declares a peer range
that predates Vite 6.

## 3. Configure environment

```bash
cp .env.example .env
```

Fill in the two browser-safe values from **Supabase → Project Settings → API**:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable or anon key>
```

Never put the `service_role` key in `.env` if that file is used to build the
frontend — it would be bundled. The template keeps service-role variables in a
separate, clearly marked block for scripts only.

`.env`, `.env.local` and `.env.*.local` are git-ignored.

## 4. Apply the database schema

### Option A — Supabase CLI (recommended)

```bash
supabase link --project-ref <project-ref>
supabase db push          # applies supabase/migrations/0001…0011 in order
```

### Option B — SQL editor

Open **SQL Editor** in the dashboard and run the files in
`supabase/migrations/` **in numeric order**. Each file is idempotent-safe in the
sense that it is only meant to be run once; do not reorder them, because later
files depend on functions created earlier.

| File | Contents |
| --- | --- |
| `0001_core_foundation.sql` | branches, profiles, roles, permissions, settings, audit |
| `0002_children_parents.sql` | children, guardians, link table, pickups, documents, medical |
| `0003_operations.sql` | classrooms, enrollments, attendance, sessions, pricing tables |
| `0004_operations_functions.sql` | check-in/out, pricing engine, session close |
| `0005_financial.sql` | invoices, payments, refunds, expenses, cash, inventory |
| `0006_financial_functions.sql` | create_invoice, record_payment, refunds, shifts, purchases |
| `0007_rls_policies.sql` | RLS enablement + policies for every table |
| `0008_seed_reference_data.sql` | branch, services, pricing, packages, classrooms |
| `0009_subscriptions.sql` | packages, subscriptions, usage, renewal/expiry |
| `0010_dashboard.sql` | reporting RPCs and dashboard metrics |
| `0011_timezone_and_hardening.sql` | Africa/Cairo, extra indexes, immutability checks |

Verify afterwards:

```sql
select count(*) from pg_tables where schemaname = 'public';   -- 49
select count(*) from pg_policies where schemaname = 'public'; -- 114
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public';                                 -- 94
```

## 5. Create the first administrator

Sign-ups are intentionally disabled. Create the account one of two ways:

**Dashboard** — Authentication → Users → *Add user*, set email + password,
confirm the email, then:

```sql
insert into user_roles (user_id, role_id)
select '<user-uuid>', id from roles where code = 'super_admin';

insert into user_branches (user_id, branch_id)
select '<user-uuid>', id from branches where code = 'MAIN';
```

**SQL only** — if you prefer to keep everything in migrations, create the user
with the Admin API from a script and assign the role with the statements above.

## 6. Run

```bash
npm run dev        # http://localhost:5173
```

Other scripts:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server, hot reload |
| `npm run build` | Production build (emits `dist/` + service worker) |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | `tsc -b`, zero errors expected |
| `npm run lint` | ESLint 9, zero errors expected |
| `npm test` | Vitest suite (38 tests) |
| `npm run test:rls` | Anonymous-access probe against a live project |

## 7. First-run checklist

1. Sign in with the administrator account.
2. **Settings** → confirm branch name, currency `EGP`, timezone `Africa/Cairo`,
   tax rate.
3. **Roles** → review the permission matrix; adjust per role.
4. **Settings → Services & Pricing** → replace demo prices with real ones. No
   price is hardcoded in the frontend.
5. **Cameras/Printers** → the check-in screen uses the device camera via
   `BarcodeDetector` where available and falls back to manual entry.
6. **Backups** → follow `docs/BACKUP_RESTORE.md` before entering real data.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank page, console `supabaseUrl is required` | missing `.env` | copy `.env.example`, restart dev server |
| `permission denied for table …` | RLS reachable but no role granted | assign a role in `user_roles`, then sign out/in |
| `branch_forbidden` from an RPC | user not linked to the branch | add a row to `user_branches` |
| `npm install` peer error | strict peer resolution | add `--legacy-peer-deps` |
| Sign-in says *Signups not allowed* | `disable_signup = true` | create users from the dashboard, not the client |
