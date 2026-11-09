# Handover report — Kids Area & Nursery ERP

**Date:** 8 November 2026
**Repository:** https://github.com/youssefmaatyy-commits/nursery
**Pull request:** https://github.com/youssefmaatyy-commits/nursery/pull/1
**Branch with all work:** `arena/3fdc8dda-nursery` → HEAD `f21f962` (pushed, CI green)

---

## 1. What exists, verified

| Deliverable | Status | Evidence |
| --- | --- | --- |
| Source code in GitHub | ✅ pushed | `git log origin/arena/3fdc8dda-nursery` → `f21f962` |
| CI pipeline | ✅ green | run `42610217923`: *Typecheck · Lint · Test · Build* **pass** in 31 s |
| Vercel integration | ✅ build passes, preview deployed | PR check *Vercel* **pass**; preview URL issued |
| Supabase project | ✅ live, schema applied | project ref below; 49 tables / 114 policies / 94 functions |
| Database migrations | ✅ 11, version-controlled | `supabase/migrations/0001…0011` |
| Frontend build | ✅ | `npm run build` → `dist/`, PWA precache 42 entries / 863.13 KiB |
| Tests | ✅ 38 / 38 | `npm test` → 7 files, 38 passed |
| Typecheck | ✅ 0 errors | `npm run typecheck` |
| Lint | ✅ 0 errors, 0 warnings | `npm run lint` |
| Docs | ✅ 8 guides | `docs/*.md` |
| Scheduled jobs | ✅ 2 cron jobs active | `cron.job`: expiry sweep, audit retention |
| Edge Function | ⚠️ deployed, runtime broken | slug `absence-reminder` v5, `verify_jwt: false`; **every** function returns `BOOT_ERROR` (see limitations) |
| Deployment config | ✅ | `vercel.json`, `.github/workflows/ci.yml` |
| Reproducible install | ✅ | `npm ci --legacy-peer-deps` → 623 packages from committed lockfile |

### URLs

- **Repository:** https://github.com/youssefmaatyy-commits/nursery
- **Pull request (open):** https://github.com/youssefmaatyy-commits/nursery/pull/1
- **Vercel preview:** `https://nursery-git-arena-3fdc8dda-nursery-youssef-maaty.vercel.app`
  — the build **succeeded** and the deployment is *Ready*, but the project has
  **Vercel Authentication (deployment protection) enabled**, so an anonymous
  visitor is redirected to a Vercel login. Disable it in
  **Vercel → Project → Settings → Deployment Protection** to make the URL public.
  There is **no production domain yet** — no merge to `main` has happened.
- **Local dev server:** running in this workspace on port **5173/5174**
  (`https://<port>-<sandboxId>.e2b.app`), `GET /` → 200, Arabic RTL shell.

---

## 2. Supabase

| Item | Value |
| --- | --- |
| Project ref | `wpprnexfdzteeqkmqhir` |
| API URL | `https://wpprnexfdzteeqkmqhir.supabase.co` |
| Region | `eu-central-1`, PostgreSQL 17 |
| Browser key | publishable key only (in `.env`, git-ignored) |
| Service-role key | **never** written to the repo, the bundle or this report |

Live object counts: **49 tables · 114 RLS policies · 94 functions · 41 permissions
· 8 roles · 151 role-permissions · 5 private storage buckets**.

### Migration list (applied, in order)

1. `0001_core_foundation` — branches, profiles, RBAC, settings, audit
2. `0002_children_parents` — children, guardians, pickups, documents, medical
3. `0003_operations` — classrooms, enrollments, attendance, sessions, pricing
4. `0004_operations_functions` — check-in/out, pricing engine, session close
5. `0005_financial` — invoices, payments, refunds, cash, expenses, inventory
6. `0006_financial_functions` — invoice/payment/refund/shift/purchase RPCs
7. `0007_rls_policies` — RLS enablement + 114 policies
8. `0008_seed_reference_data` — MAIN branch, services, rules, packages, classrooms
9. `0009_subscriptions` — packages, subscriptions, usage, lifecycle RPCs
10. `0010_dashboard` — dashboard + 7 reporting RPCs
11. `0011_timezone_and_hardening` — `Africa/Cairo`, indexes, extra guards
12. `0012_scheduled_jobs` — pg_cron expiry sweep + audit retention + `scheduled_jobs` view

### Scheduled jobs (live)

| Job | UTC | Cairo | Action |
| --- | --- | --- | --- |
| `erp-daily-expiry-sweep` | `0 4 * * *` | 06:00 | expires subscriptions, sends expiry/low-stock notifications |
| `erp-audit-retention` | `15 2 * * *` | 04:15 | prunes audit rows older than 24 months |

### Edge Functions (deployed, not running)

| Slug | Purpose | Auth | Runtime |
| --- | --- | --- | --- |
| `absence-reminder` | WhatsApp/SMS for today's absences | `x-cron-secret` header or staff JWT with `settings.manage` | ❌ `BOOT_ERROR` |

**The Edge Functions runtime on this project does not boot any function.** Proven
by deploying a 3-line healthcheck to a brand-new slug — it returned the same
`{"code":"BOOT_ERROR"}`. Auth, REST, Storage, Realtime and the database all report
`ACTIVE_HEALTHY`, so this is isolated to the functions service. The code is
committed and ready; redeploy with
`supabase functions deploy absence-reminder --project-ref <ref>` once Supabase
resolves it. No provider credentials are configured, so no message has ever been
sent regardless.

### Auth configuration (hardened this session)

- Sign-ups **disabled** (staff accounts are provisioned by an admin)
- Email confirmation required
- Site URL `http://localhost:5173`; redirect allow-list
  `http://localhost:5173/**, http://localhost:4173/**, https://*.vercel.app/**`
  → **replace the localhost/wildcard entries with real domains before production**
- Refresh-token rotation on

### Test accounts — passwords rotated 9 Nov 2026

The original demo passwords (`ChangeMe!Admin2026`, `ParentTest!2026`) **no longer
work**; they were replaced with strong random values stored in the operator's
password manager (verified: `crypt()` check passes for the new value and fails
for the old one). Neither new password is written in this repository.

| Role | Email |
| --- | --- |
| Super Admin | `admin@kidsnursery.local` |
| Parent | `parent.test@example.com` |

Both accounts still use a `.local` domain, so password-reset email cannot reach
them — create a real-billing administrator with `npm run bootstrap:admin` before
go-live.

Sample data present: branch `MAIN`, children `CH-01001` (Omar Ahmed) and Layla
Kamal, parent `P-01001`, invoices `INV-001001` + one POS invoice, supplier
`Delta Snacks Co.`, expense `EXP-001010`, 3 payments + 1 refund, one closed cash
shift, package `PKG-10H` (45 of 600 minutes used), product `SNK-CHIPS` (98).

---

## 3. Architecture in one page

```
Browser (React 18 + TS + Vite + Tailwind 4, PWA, i18next ar/en)
   │  supabase-js, publishable key, JWT
   ▼
Supabase: Auth · PostgREST · PostgreSQL 17 · Storage (5 private buckets)
   • all business logic in SECURITY DEFINER RPCs
   • RLS on every table, branch-scoped, permission-checked
   • payments/refunds immutable (triggers + no update/delete policy)
```

- No application server, no client-side pricing: `quote_kids_area`,
  `close_kids_session`, `create_invoice`, `record_payment` etc. run inside the
  database and re-check permission, branch and idempotency key.
- Frontend never holds a secret; the service-role key is not in the repo.
- Full detail: `docs/ARCHITECTURE.md`, `docs/DATABASE.md`.

### Modules delivered (25 screens)

Dashboard · Children (+ profile, QR badge, documents, medical, pickups) ·
Parents · Check-in/check-out board (QR, family, walk-in, duplicate prevention) ·
Kids Area live sessions + pricing quote · Nursery enrollments · Classrooms ·
Daily child reports · Subscriptions/packages · POS · Invoices/payments/refunds ·
Cash register shifts · Expenses · Inventory · Suppliers · Employees · Roles
matrix · Settings · Audit log · Reports (7 families) · Notifications · Sync ·
Parent portal · Login / password reset.

---

## 4. Test report

| Layer | Result |
| --- | --- |
| Unit (Vitest, 7 files) | **38 / 38 pass** — pricing engine, invoice math, subscriptions, RBAC matrix, i18n parity AR↔EN, money formatting, real jsdom render of the login screen (RTL + LTR + no leaked i18n keys) |
| Authenticated DB scenarios | **18 / 18 pass** — see table in `docs/TESTING.md` (duplicate check-in rejected, idempotent payment replay, over-payment rejected, refund recalculates balance, payment UPDATE blocked, stock 100→98 with one movement, replay creates no second invoice, P&L −250.50, shift reconciliation, subscription bills 0 and consumes 45 min, absence rejection, dashboard metrics) |
| RLS / privilege probes | pass — anon denied on 30 protected tables and 5 RPCs; no-JWT session sees 0 rows; parent isolation both read and write; staff without `finance.view` gets `forbidden`; cross-branch gets `branch_forbidden` |
| CI | green (`vercel` + `verify`); the live RLS job is scoped to `main` only |

Reproduce: `npm ci --legacy-peer-deps && npm run typecheck && npm run lint && npm test && npm run build`.

---

## 5. How to run and deploy

Install: `docs/INSTALLATION.md` (clone → install → `.env` → `supabase db push`
→ admin bootstrap → `npm run dev`).
Deploy: `docs/DEPLOYMENT.md` (Vercel import, two env vars, redirect URLs,
post-deploy smoke test).
Backup: `docs/BACKUP_RESTORE.md` (`pg_dump` with `public,auth,storage`, checksum,
off-site encryption, restore drill with SQL verification queries).
Admin: `docs/ADMIN_GUIDE.md` (first-run settings, families, daily operations,
money, reports, maintenance cadence, escalation).

Env template: `.env.example` (browser-safe `VITE_*` block + clearly separated
server-only block).

---

## 6. Known limitations — stated plainly

1. **No public production URL.** The Vercel preview is Ready but protected by
   Vercel Authentication; no merge to `main` has been performed, so no production
   deployment exists. Nothing is claimed beyond what the PR checks show.
2. **No browser E2E suite.** Chromium could not be downloaded in the sandbox
   (network policy). The critical render path is covered in jsdom instead; camera
   QR scanning and print/PDF layout remain manual checks.
3. **No load/performance testing.**
4. **The RLS probe could not run from this sandbox** (no outbound network to
   Supabase). The same assertions were executed as authenticated SQL queries
   against the live project; `npm run test:rls` and the CI `rls` job are ready to
   run from CI or any machine with network access.
5. **The live CI build has no Supabase secrets configured yet**, so the deployed
   bundle has empty `VITE_*` values until you add the two repository secrets —
   the app will then show a configuration error instead of data.
6. **Seed data is demo data** (prices, children, invoices); the account
   passwords have been rotated. Replace the seeded prices/services with real ones.
7. **Edge Functions do not boot.** `absence-reminder` is deployed (v5) but the
   runtime returns `BOOT_ERROR` for every function on the project, including a
   minimal healthcheck on a fresh slug. This is a Supabase-side failure, not a
   code defect — retry deployment later. In-app notifications work fine
   (`run_expiry_jobs` is verified), so nothing depends on the function today.
8. **Password minimum length is 6** (Supabase default); the dashboard should be
   set to 12 — the connector does not expose that field.
9. **Backups**: automatic daily backups require a paid Supabase plan; on free
   tier use the manual procedure in `docs/BACKUP_RESTORE.md`.

## 7. Recommended next steps

1. In Vercel: add `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (GitHub repo
   secrets and Vercel env vars), disable Deployment Protection, open the PR
   preview and click through the smoke test in `docs/DEPLOYMENT.md`.
2. Merge `arena/3fdc8dda-nursery` → `main` (PR #1) once reviewed; Vercel then
   creates the production deployment — record its domain and add it to the
   Supabase redirect allow-list.
3. Rotate the two test accounts; create real staff accounts with
   `npm run bootstrap:admin` and per-role assignments.
4. Replace seeded prices/packages/classrooms with real values in Settings.
5. Schedule `run_expiry_jobs` (Supabase cron / pg_cron) for subscription expiry
   and low-stock/overdue notifications.
6. Add the Playwright E2E suite on a machine with browser access; wire an
   Edge Function for WhatsApp/SMS absence reminders.
