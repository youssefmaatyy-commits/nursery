# Kids Area & Nursery ERP

A bilingual (Arabic / English), multi-branch ERP for a business that runs **both** a kids play area and a nursery.
React + TypeScript + Vite frontend, Supabase (PostgreSQL) backend, row-level security for every protected table,
server-side money math, offline-first PWA, and a separate secure parent portal.

```
┌──────────────────────────────────────────────────────────────────────┐
│  React 18 + TS + Vite + Tailwind v4 + React Query + i18next (ar/en)  │
│  PWA + IndexedDB offline queue  ←→  Supabase JS client (anon key)     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ HTTPS (JWT)
┌───────────────────────────────▼──────────────────────────────────────┐
│ Supabase                                                             │
│  • Auth (email/password, password reset, session refresh)            │
│  • PostgreSQL 17: 49 tables, 114 RLS policies, 90+ functions/views   │
│  • Storage: 5 private buckets (signed / policy-gated access)         │
│  • SECURITY DEFINER RPCs for every money & attendance mutation       │
└──────────────────────────────────────────────────────────────────────┘
```

## Modules

| Area | What works |
|---|---|
| Dashboard | Live KPIs straight from the DB: children, inside now, revenue today/month, outstanding, expiring subscriptions, cash shift state |
| Children | Registration (AR+EN names, DOB→auto age), duplicate detection, guardian linking, allergies/medical notes, authorized pickups, QR code, archive |
| Parents & guardians | Multi-child/multi-guardian relationships, financial responsibility, parent-portal account linkage |
| Check-in / check-out | Kids-area sessions with duplicate prevention, nursery attendance, live "inside now" board, pickup verification, offline queuing |
| Kids area pricing | Hourly / half-hour / per-minute / fixed ticket / day pass / packages, grace period, rounding, minimum charge, day-of-week & time-window rules |
| Nursery | Enrollments (daily/weekly/monthly), classrooms with capacity & age bands, teacher assignment, daily child reports |
| Subscriptions | Time & session packages, usage tracking that never resets, renewal, suspend/resume, expiry job + notifications |
| POS & invoices | Product + service cart, tax, discounts, idempotent invoice creation, stock deduction, split/partial payments |
| Payments & refunds | Server-side payment recording, over-payment rejection, immutable rows, reversal-only refunds |
| Cash register | Open/close shifts, float, deposits/withdrawals, expected vs counted cash with a discrepancy notification |
| Expenses | Categorised expenses, receipts, P&L reporting |
| Inventory & suppliers | Products, barcodes, low-stock alerts, journalled stock movements, purchases that update stock + supplier balance |
| HR | Employee profiles, salaries, employment status, attendance |
| Administration | Roles & permissions matrix, settings, branches, audit log (append-only triggers) |
| Reports | Revenue, P&L, attendance, kids-area sessions, outstanding, inventory, cash shifts — CSV export + print |
| Offline & sync | IndexedDB queue → `apply_sync_operation` RPC with per-operation idempotency keys, retry + failure reporting |
| Parent portal | Children, attendance, daily reports, invoices, balances, subscriptions, absence notifications — strictly scoped by RLS |

## Quick start

```bash
npm install
cp .env.example .env      # fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev               # http://localhost:5173
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build (emits PWA service worker) |
| `npm run typecheck` | `tsc -b` only |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit suite (pricing, invoice math, subscriptions, i18n parity, RBAC, formatting) |
| `npm run test:rls` | Anonymous-access probe against a live project (needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`) |

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design, data model, security model
- [docs/INSTALLATION.md](docs/INSTALLATION.md) — fresh install from zero
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Vercel + Supabase production setup
- [docs/DATABASE.md](docs/DATABASE.md) — every migration and what it creates
- [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) — backup, verification and restore drills
- [docs/TESTING.md](docs/TESTING.md) — test inventory and results
- [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) — first-run admin checklist

## Security posture

- No service-role key anywhere in the frontend; the browser only ever holds the publishable key.
- RLS enabled on **every** table in `public`, with `anon` grants revoked.
- All money math, stock movement and attendance changes go through `SECURITY DEFINER` functions that re-check
  permissions (`has_permission`), branch scope (`can_access_branch`) and idempotency keys.
- `payments` / `invoices` / `refunds` rows cannot be updated destructively or deleted (`prevent_financial_mutation`).
- Child documents live in private buckets; access is granted through storage policies tied to staff permission or
  a parent's own children.

## License

Proprietary — built for the operating business.
