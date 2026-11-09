# Testing

Three layers: pure unit tests (fast, no network), authenticated end-to-end
scenarios executed against the live database, and an anonymous-access RLS probe.

## 1. Unit tests — `npm test`

Vitest + jsdom. 7 files, **38 tests**, all passing, no network required.

| File | Covers |
| --- | --- |
| `tests/pricing.test.ts` | Kids Area engine: grace period, ceil rounding on 30/60-minute units, minimum charge, flat ticket/day pass, package base+overage, floor at zero |
| `tests/invoice-math.test.ts` | Line totals, tax, discount order, rounding to 2 decimals, balance after partial payments, split payments summing to total |
| `tests/subscription.test.ts` | Remaining minutes, overage, expiry boundary, suspend/cancel transitions, renewal resets |
| `tests/permissions.test.ts` | Role matrix: which of the 8 seeded roles hold each permission; super-admin bypass |
| `tests/i18n.test.ts` | Every Arabic key exists in English and vice versa — no untranslated string can ship |
| `tests/money.test.ts` | EGP formatting, Arabic/Latin digits, negative amounts, rounding edge cases |
| `tests/render.test.tsx` | The real `Login` page renders in jsdom: Arabic `dir="rtl"` greeting, labelled inputs, language switch to English `dir="ltr"` without reload, and a guard that no raw i18n key (`auth.x`, `common.x`, `nav.x`) leaks to the DOM |

Run one file: `npx vitest run tests/pricing.test.ts`
Watch mode: `npx vitest`

These tests mirror the server rules deliberately. They are a regression net, not
proof — the authoritative implementation is the SQL function, which is covered by
layer 2.

## 2. End-to-end scenarios against the live database

Executed as an authenticated user, exactly as the UI does (RLS applies). Verified
on the deployed project:

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 1 | `quote_kids_area('KIDS-HOURLY', 40)` | grace 5 → 35 billable → 2 half-units = 70 | ✅ |
| 2 | `quote_kids_area(..., 66)` | 3 units = 105 (not 70) | ✅ |
| 3 | Check in a child twice | second call raises `duplicate_check_in` | ✅ |
| 4 | Close a 120-minute session | `INV-001001`, amount 120, balance 20 after 100 paid | ✅ |
| 5 | `record_payment` replayed with the same idempotency key | one payment row only | ✅ |
| 6 | Overpay an invoice | rejected — amount must not exceed balance | ✅ |
| 7 | Refund part of a payment | refund row created, invoice balance recalculated, original payment untouched | ✅ |
| 8 | Update a payment row | blocked by immutability trigger `42501` | ✅ |
| 9 | `create_invoice` with a product line | stock 100 → 98, one `inventory_movements` row | ✅ |
| 10 | Replay the same invoice idempotency key | still one invoice, stock unchanged | ✅ |
| 11 | `receive_purchase` then `report_profit_loss` | expenses include the purchase; profit −250.50 | ✅ |
| 12 | `close_shift` with movements | expected cash = float + sales − payouts | ✅ |
| 13 | Nursery enrollment 2,200 + 200 | fee total 2,400, capacity enforced | ✅ |
| 14 | Check-in / inside list / check-out for nursery | child appears in `children_inside`, then leaves | ✅ |
| 15 | `create_subscription` (PKG-10H, 50 discount) | 400 EGP, 600 minutes | ✅ |
| 16 | Kids session inside a subscription (45 min) | billed 0, `minutes_used` 45 | ✅ |
| 17 | `mark_absence` for a date outside enrollment | rejected | ✅ |
| 18 | `dashboard_metrics('MAIN')` | non-zero revenue, children present, open sessions listed | ✅ |

## 3. RLS probe — `npm run test:rls`

`scripts/test-rls.mjs` uses **only the publishable (anon) key**, like an
unauthenticated browser.

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_ANON_KEY=<publishable key> \
npm run test:rls
```

It asserts:

- 30 protected tables return **zero rows** (or a permission error) to anon
- 5 protected RPCs (`my_context`, `dashboard_metrics`, `children_inside`,
  `search_children`, `report_profit_loss`) are rejected
- no table grant leaks to the `anon` role

Equivalent checks run manually against the live project during development:

| Check | Result |
| --- | --- |
| anon `select * from children` | denied (0 rows / 42501) |
| authenticated with no JWT claims | 0 rows on children, invoices, parents |
| parent A reading parent B's child | 0 rows |
| parent inserting a child | blocked by policy |
| parent reading own children + their invoices | allowed (portal works) |
| staff without `finance.view` calling `report_profit_loss` | `forbidden` |
| staff of branch A reading branch B | `branch_forbidden` / 0 rows |
| `update payments set amount = 1` | immutability trigger |

In the CI workflow this job runs only on `main` and only when the two project
secrets exist.

## 4. CI

`.github/workflows/ci.yml` → `verify` job on every push:

```
install → typecheck (0 errors) → lint (0 errors, 0 warnings) → test (38/38) → build → artefact check
```

The workflow fails the build if `dist/index.html` or `dist/sw.js` is missing, so
a broken PWA build cannot be deployed.

## 5. What is not covered automatically

Be explicit about the gaps so the next team does not assume coverage:

- **No browser E2E** (Playwright/Cypress) — the sandbox has no browser binary and
  the network policy blocks the download. `tests/render.test.tsx` covers the
  critical render path in jsdom instead.
- **No load testing** — concurrent check-in contention is protected by a partial
  unique index, but throughput has not been measured.
- **No visual regression** testing.
- **Camera QR scanning** cannot be tested headlessly; manual QR/badge test
  required on a real device.
- **PDF/print output** is exercised manually; layout depends on the browser's
  print engine.
- **Offline replay** is unit-tested at the queue level and manually verified by
  toggling the network; a Docker-based offline E2E suite is a recommended next
  step.

## 6. Adding tests

- Unit → `tests/*.test.ts`, imported from `src` via the `@` alias.
- RLS/scenario checks → extend `scripts/test-rls.mjs` with a `PROTECTED_TABLES`
  or `PROTECTED_RPCS` entry; never commit keys.
- Seed helpers for a fresh environment: `supabase/migrations/0008…` plus the
  bootstrap steps in `docs/INSTALLATION.md`.
