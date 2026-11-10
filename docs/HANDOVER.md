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
| Edge Function | ✅ deployed **and booting** | slug `absence-reminder`; unauthenticated call → `401 {"error":"unauthorized"}` |
| Deployment config | ✅ | `vercel.json`, `.github/workflows/ci.yml` |
| Vercel production deploy | ✅ built & READY | `dpl_2CvwX84peuFwbr4QX4gXQveS6Pxs`, env vars baked in |
| Reproducible install | ✅ | `npm ci --legacy-peer-deps` → 623 packages from committed lockfile |

### URLs

- **Repository:** https://github.com/youssefmaatyy-commits/nursery
- **Pull request (open):** https://github.com/youssefmaatyy-commits/nursery/pull/1
- **Vercel production deployment:** `https://nursery-youssef-maaty.vercel.app`
  (deployment `dpl_2CvwX84peuFwbr4QX4gXQveS6Pxs`, state **READY**, target
  **production**, alias assigned). Built from `f44c12b` with
  `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` present, so the bundle is wired
  to the database — no `/setup` step is needed.
- **Preview:** `https://nursery-git-arena-3fdc8dda-nursery-youssef-maaty.vercel.app`
- ⚠️ **Both URLs currently answer with a Vercel login page.** The project has
  `ssoProtection.deploymentType = "all_except_custom_domains"`. Verified by
  creating a throwaway project: a **new** project on this team is created with
  the identical setting, so it is a team-level deployment-protection default, not
  a per-project mistake. The connector's `update_project` schema has no
  protection field, and the team has no custom domain (which would be exempt).
  The only fix is a UI/API action: **Vercel → Team Settings → Deployment
  Protection → Vercel Authentication: Disabled**, or add a custom domain to the
  project.
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
13. `0013_absence_reminder_cron` — pg_net trigger for the absence-reminder function

### Scheduled jobs (live)

| Job | UTC | Cairo | Action |
| --- | --- | --- | --- |
| `erp-daily-expiry-sweep` | `0 4 * * *` | 06:00 | expires subscriptions, sends expiry/low-stock notifications |
| `erp-audit-retention` | `15 2 * * *` | 04:15 | prunes audit rows older than 24 months |
| `erp-absence-reminder` | `0 10 * * *` | 12:00 | POSTs to the `absence-reminder` function (skips until the Vault secret exists) |

### Edge Functions (live)

| Slug | Purpose | Auth | Runtime |
| --- | --- | --- | --- |
| `absence-reminder` | WhatsApp/SMS for today's absences | `x-cron-secret` header or staff JWT with `settings.manage` | ✅ booting, returns 401 when unauthenticated |

The function initially returned `BOOT_ERROR` for every function on the project
(including a 3-line healthcheck on a fresh slug). That was a transient
platform-side fault which cleared on its own: the runtime now boots and
correctly rejects anonymous callers. No WhatsApp/Twilio credentials are configured yet, so no message has
been delivered — see the activation steps below.

**To activate messaging:**
1. `supabase secrets set CRON_SECRET=<random> WHATSAPP_TOKEN=… WHATSAPP_PHONE_ID=…` (or the Twilio trio).
2. `select vault.create_secret('<same random value>', 'absence_reminder_cron_secret');`
   — `0013_absence_reminder_cron.sql` reads it from Vault, so no credential is in
   the repo, and the daily 10:00 UTC (12:00 Cairo) job starts firing instead of
   skipping with `vault_secret_missing`.

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
7. **No messaging provider configured.** `absence-reminder` boots and rejects
   anonymous calls, but without WhatsApp/Twilio secrets and the Vault secret it
   sends nothing (the cron job exits with `vault_secret_missing`).
8. **Password minimum length is 6** (Supabase default). The connector's schema
   has no such field (confirmed at the input-schema level), so this can only be
   changed in **Supabase → Authentication → Providers → Email → Minimum password
   length**. The client-side reset form now enforces 12 regardless.
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

## 5c. Staff accounts & role permissions (migration 0014)

Before 0014 the system had **no way to create a user account**. `employees` rows
existed with a `profile_id` column, but nothing in `src/` ever called
`auth.users`, `user_roles` or any invite flow — so "adding an employee" produced
an HR record that could not log in.

`0014_staff_accounts.sql` adds seven SECURITY DEFINER RPCs. All are gated and
audited; the browser never needs a service-role key.

| RPC | Permission gate | Notes |
| --- | --- | --- |
| `admin_list_staff_accounts()` | `employees.manage` or `roles.manage` | profiles ⋈ auth.users ⋈ employees, roles as JSON |
| `admin_create_staff_account(...)` | `employees.manage` | creates auth user + identity + profile + role (+ employee row) |
| `admin_set_user_role(user, role_code, branch)` | `roles.manage` | super_admin only by a super admin |
| `admin_remove_user_role(user, role_id)` | `roles.manage` | refuses to remove the last super admin |
| `admin_set_user_active(user, active)` | `employees.manage` | `profiles.is_active` is what `has_permission()` checks |
| `admin_reset_user_password(user, password)` | `employees.manage` | min 12 chars |
| `admin_set_role_permission(role, perm, enabled)` | `roles.manage` | super_admin not editable (it bypasses the check) |

### Two traps found while building this

1. **`gen_salt()` / `crypt()` live in the `extensions` schema**, not `public`.
   A function with `set search_path = public` fails with
   `42883: function gen_salt(unknown, integer) does not exist`. Use
   `set search_path = public, extensions` and qualify the calls.
2. **`profiles.email` is `citext`.** A `RETURNS TABLE (... email text ...)`
   function must cast (`p.email::text`) or it raises
   `42804: structure of query does not match function result type`.

## 5d. Guardians, deletion, and forced password change (migration 0015)

### Multiple guardians per child
`child_guardians` was already a many-to-many table, but the UI could only ever
write **one** row — created inline when a child was registered. `ChildDetail`
showed the guardians and then linked to `/parents`, which did not attach anything.

- `child_guardian_upsert(...)` — attaches or edits a guardian. Promoting one to
  primary demotes the rest, so exactly one primary can exist.
- `child_guardian_unlink(link)` — refuses with
  `child_needs_at_least_one_guardian` if it would leave a child with nobody.
- `ChildDetail` now has a real "add guardian" modal and an unlink button per row.

### Deleting a child or a parent
Seven tables reference `children` **without** `ON DELETE CASCADE` (invoices,
subscriptions, kids area sessions, nursery attendance, enrolments, daily
reports, subscription usage), so a hard delete either fails or would orphan
financial history. The rule is enforced in the database, not the UI:

| Action | Behaviour |
| --- | --- |
| Archive child | `status = 'archived'`; keeps all history. Restorable. |
| Hard-delete child | super admin only; **refused** with the blocking counts if any history exists |
| Deactivate parent | `status = 'inactive'`; disappears from pickers, keeps invoices |
| Hard-delete parent | super admin only; refused if linked to children or invoices |

`child_history_counts()` returns the counts so the UI can explain the refusal
instead of failing silently.

Verified live: `admin_delete_child(..., hard => true)` on a child with 2
invoices + 1 subscription + 2 sessions returned
`has_history_use_archive: {"invoices": 2, "subscriptions": 1, ...}`; the archive
path succeeded; `admin_delete_parent(hard)` on a linked parent returned
`parent_has_children_unlink_first`; `child_guardian_unlink` on a child's only
guardian returned `child_needs_at_least_one_guardian`.

### Forced first-login password change
`Login.tsx` used to print "the bootstrap password must be changed on first
sign-in" while **nothing enforced it**. Now:

- `profiles.must_change_password` exists; `admin_create_staff_account()` sets it.
- `change_own_password(text)` (SECURITY DEFINER) rotates the password and clears
  the flag for the caller — no service-role key needed in the browser.
- `RequireAuth` renders `<ChangePassword forced />` instead of the app whenever
  the flag is set, so a temporary password cannot be kept in use.

Verified live: a new account came back with `must_change_password = true` and
`my_context()` exposed it; calling `change_own_password` flipped it to `false`.

### No more raw database codes in the UI
20 call sites showed `e.message` verbatim — which is why a super admin without a
branch saw the bare word `branch_forbidden` as the whole page. They now go
through `humanizeError()`, which maps ~22 stable codes to AR/EN sentences and
expands `has_history_use_archive` into readable counts. `RequireAuth` also shows
an explanatory screen instead of the raw error when an account has no branch.

A unit test caught a real ordering bug here: `'forbidden'` is a substring of
`'branch_forbidden'`, so the map matched the wrong message. The lookup now sorts
candidates longest-first — see `tests/errors.test.ts`.

### Admin UI added
- **`/staff`** — list every account with its roles; create a staff account
  (email, temporary password, role, employee code, job, salary); add/remove a
  role; reset a password; activate/deactivate.
- **`/roles`** — the permission matrix is now interactive. `super_admin` is shown
  as always-granted and is not editable (it short-circuits `has_permission`).
