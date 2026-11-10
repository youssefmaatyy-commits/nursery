# Architecture

## 1. Shape of the system

```
                    ┌──────────────────────────────────────────┐
                    │            Browser (PWA)                │
                    │  React 18 + TS + Vite + Tailwind 4      │
                    │  React Router · React Query · Dexie     │
                    │  i18next (ar RTL / en LTR)              │
                    └───────────────┬──────────────────────────┘
                                    │  supabase-js (publishable key)
                                    │  HTTPS only, JWT in memory/storage
                    ┌───────────────▼──────────────────────────┐
                    │                 Supabase                 │
                    │                                          │
                    │  Auth (JWT, refresh rotation)            │
                    │  PostgREST  ── tables, views, RPCs       │
                    │  Postgres   ── 49 tables, 94 functions   │
                    │              114 RLS policies, triggers │
                    │  Storage    ── 5 private buckets         │
                    │  Edge Functions (optional, ES256)        │
                    └──────────────────────────────────────────┘
```

There is **no separate application server**. Every business operation is a
Postgres function executed inside the database, so it is atomic, permission
checked, and impossible to bypass from the browser.

## 2. Why business logic lives in the database

The requirements forbid trusting the client for money and personal data. The
frontend therefore never computes a price, a balance, or a permission.

| Concern | Where it is enforced |
| --- | --- |
| Authentication | Supabase Auth; `auth.uid()` inside every policy |
| Authorisation | RLS policies + `has_permission()` / `can_access_branch()` inside RPCs |
| Pricing | `pricing_rules`, `package_plans`, `quote_kids_area()`, `close_kids_session()` |
| Invoice totals | `create_invoice()` recomputes line totals, tax, discount server-side |
| Payment idempotency | `idempotency_key` unique index + `record_payment()` lookup |
| Immutability | `BEFORE UPDATE/DELETE` triggers raising on `payments`, `refunds`, `invoices` |
| Audit trail | `audit_logs` written by triggers on every privileged mutation |
| Timezone | `Africa/Cairo` set per-request; all business dates in local time |
| Offline replay | `apply_sync_operation()` re-validates each queued mutation |

Money is stored as `numeric(12,2)` — never floats. Rounding happens once, inside
the function, with `round(x, 2)`.

## 3. Frontend layers

```
src/
  main.tsx                 QueryClient + AuthProvider + ToastProvider + Router
  App.tsx                  Lazy routes, RequireAuth guard, layout shell
  pages/                   23 screens, one per module
  components/ui/           Button, Input, Select, Modal, Table, Badge, Alert…
  components/CrudPage.tsx  Config-driven CRUD (used by 5 reference tables)
  components/AppLayout.tsx Sidebar, language switcher, branch switcher
  hooks/                   useAuth (context), useOnline, useBranch
  lib/supabase.ts          Single client instance, env validation
  lib/offline.ts           Dexie queue + replay via apply_sync_operation
  lib/utils.ts             Money/date formatting, CSV, print, idempotency keys
  i18n/                    ar.json-like TS dicts, en dicts, i18n bootstrap
```

State strategy:

- **Server state** → React Query (`staleTime` 30 s, retries skip auth errors,
  cache invalidated after every mutation).
- **Session state** → `AuthProvider` context, hydrated once from
  `auth.getSession()` + `my_context()`.
- **Offline state** → Dexie table `pending_operations`; the Sync screen shows
  the queue and replays it when connectivity returns.

Code splitting: every page is `React.lazy`, so the initial bundle contains only
the shell, the login screen and the shared UI kit.

## 4. Routing map

| Path | Module |
| --- | --- |
| `/login`, `/reset-password` | Auth |
| `/` | Dashboard |
| `/children`, `/children/:id` | Children, profile + QR badge + documents + medical |
| `/parents` | Guardians |
| `/operations` | Check-in / check-out board, walk-in, family, QR scan |
| `/kids-area` | Live sessions + pricing quote |
| `/nursery`, `/classrooms` | Enrollments, attendance, capacity |
| `/daily-reports` | Daily child reports |
| `/subscriptions` | Packages, usage, renew/suspend/cancel/upgrade |
| `/pos`, `/invoices` | Point of sale, invoices, payments, refunds |
| `/cash-register` | Shifts, cash movements, reconciliation |
| `/expenses`, `/inventory`, `/suppliers` | Back office |
| `/employees`, `/roles`, `/settings` | HR admin, permission matrix, configuration |
| `/reports` | 7 report families, filters, CSV/print |
| `/audit-log`, `/notifications`, `/sync` | Governance + operations |
| `/portal` | Parent portal (separate, RLS-isolated) |

## 5. Multi-branch design

Every business table carries `branch_id`. `branch_ids()` resolves the caller's
branches from `user_branches` (super admins get all). `can_access_branch(id)` is
used both in RLS policies and at the top of every mutation RPC, which returns
`branch_forbidden` instead of silently writing across tenants.

The UI keeps an active branch in context; all queries pass `p_branch`
explicitly so a manager of two branches sees one at a time, never a mix.

## 6. Offline mode

1. Reads are cached by React Query (persisted in memory per session).
2. Writes attempted while offline are appended to Dexie with a client-generated
   `idempotency_key` and the operation name.
3. On reconnect (or manual retry) each row is sent to
   `apply_sync_operation(p_operation, p_payload)`.
4. The RPC re-runs the same validated function used online, so an offline
   payment cannot create a second payment, and an offline check-in still
   respects the no-duplicate rule.

## 7. Security posture

- Publishable key only in the browser; the service-role key never appears in the
  repo, the bundle, or CI logs.
- RLS enabled on all 49 tables; 114 policies; anon role has no table grant.
- Storage buckets are private; documents are served through short-lived signed
  URLs generated after an RLS-checked lookup.
- Every privileged mutation is recorded in `audit_logs` with actor, branch,
  before/after payload.
- Auth: sign-ups disabled, redirect allow-list restricted, refresh rotation on.

## 8. Deployment topology

- Frontend: Vercel static build (`dist/`) with SPA rewrites and hardened headers
  (`vercel.json`).
- Backend: hosted Supabase project; schema shipped as 11 SQL migrations in
  `supabase/migrations/`.
- CI: GitHub Actions — typecheck, lint, unit tests, production build, artefact
  upload, and a live RLS probe on `main`.
