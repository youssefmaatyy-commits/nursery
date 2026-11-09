# Database

Hosted on Supabase (Postgres 17). Everything below is created by the eleven
migrations in `supabase/migrations/` — there are **no manual, unrecorded
changes** to the schema.

- Project ref: `<project-ref>` (see the handover report; kept out of git)
- Region: `eu-central-1`
- Timezone: `Africa/Cairo` (set per request by `0011_timezone_and_hardening.sql`)
- Currency: `EGP`, stored as `numeric(12,2)`

## Entity groups

### 1. Core & tenancy (11 tables)

`branches`, `profiles`, `roles`, `permissions`, `role_permissions`,
`user_roles` (carries `branch_id`), `user_branches` (view-backed helper),
`system_settings`, `notifications`, `uploaded_files`, `audit_logs`.

`profiles` mirrors `auth.users` one-to-one (trigger `handle_new_user`). A user's
effective permissions are resolved by `has_permission(code)`, which joins
`user_roles → role_permissions → permissions` and short-circuits for
`super_admin`. `user_roles` may be branch-scoped, which is how a Branch Manager
of one branch is prevented from touching another.

### 2. Children & guardians (7 tables)

`children` (22 columns: codes, bilingual names, DOB, gender, nationality, blood
type, allergies, medical flags, photo, status, branch), `parents` (15),
`child_guardians` (relationship, custody, primary flag), `authorized_pickups`
(name, national ID, phone, relationship, photo, ID document), `child_documents`,
`medical_notes`, `child_duplicates`-style search is done through
`find_duplicate_child()` (name + DOB + guardian phone similarity).

Deleting a child is not permitted; `status` moves between `active`,
`inactive`, `graduated`, `withdrawn`. Documents keep a `deleted_at` soft delete.

### 3. Operations (11 tables)

`classrooms`, `classroom_children`, `classroom_teachers`, `nursery_enrollments`,
`nursery_attendance`, `activities`, `events`, `holidays`, `daily_child_reports`,
`kids_area_sessions`, `pricing_rules`.

`kids_area_sessions` is the heart of the Kids Area: one row per visit with
`started_at`, `ended_at`, `billable_minutes`, `amount_due`, `rule_id`,
`subscription_id`, `status` (`open`/`closed`/`cancelled`). A partial unique index
on `(child_id) where status = 'open'` makes a duplicate check-in **physically
impossible**, not merely checked in code.

### 4. Financial (9 tables)

`invoices` (22 columns incl. `idempotency_key`, `tax_rate`, `discount_amount`,
`balance_due`, `status`), `invoice_items`, `payments`, `refunds`,
`cash_registers`, `cash_shifts`, `cash_movements`, `expenses`,
`expense_categories`.

Immutability: `payments`, `refunds` and closed `invoices` reject UPDATE/DELETE
through triggers; corrections are new rows (refund, void + reissue).

### 5. Inventory & procurement (6 tables)

`products`, `product_categories`, `inventory_movements`, `suppliers`,
`purchases`, `purchase_items`. Stock is never edited directly — `receive_purchase()`
writes both the purchase and the movement, and `create_invoice()` decrements
stock with a matching movement row.

### 6. Subscriptions (3 tables)

`packages` (minutes, sessions, price, validity, branch), `subscriptions`
(status, remaining balance, dates), `subscription_usage` (one row per deduction).
Usage inside a subscription can bill `0` to the customer while still recording
minutes consumed.

### 7. HR (2 tables) and sync (1 table)

`employees`, `employee_attendance`, `sync_operations` (the offline replay log;
unique on `idempotency_key`).

## Column conventions

| Column | Present on | Meaning |
| --- | --- | --- |
| `id uuid default gen_random_uuid()` | all | primary key |
| `branch_id uuid not null` | all business tables | tenant key used by RLS |
| `created_at`, `updated_at timestamptz default now()` | all | audit timestamps |
| `created_by uuid default auth.uid()` | most | actor (default, not trigger, because generated columns reject volatile defaults) |
| `deleted_at timestamptz` | documents, soft-deletable tables | soft delete |
| `idempotency_key text` | invoices, payments, sync_operations | replay safety |

Business dates (`attendance_date`, `expense_date`, `shift_date`) are `date` and
computed in Cairo local time, so a shift that starts at 23:30 on 5 May is booked
to 5 May even though the server clock is UTC.

## Functions

94 functions in `public`. Groups:

**Context / authz** — `my_context()`, `is_staff()`, `is_super_admin()`,
`has_permission(text)`, `has_any_permission(text[])`, `branch_ids()`,
`can_access_branch(uuid)`, `is_parent()`, `is_parent_of(uuid)`,
`current_parent_ids()`, `current_parent_child_ids()`.

**Children** — `search_children(query, branch, limit)`,
`find_duplicate_child(...)`, `children_inside(branch)`, `child_profile(uuid)`.

**Operations** — `check_in_child(...)` (returns existing session or raises
`duplicate_check_in`), `quote_kids_area(service, minutes)` (pure pricing, no
write), `close_kids_session(session, minutes?, subscription?)`,
`check_out_nursery(...)`, `mark_absence(child, date, reason)`,
`apply_sync_operation(operation, payload)`.

**Financial** — `create_invoice(branch, items, customer, discount, type, notes,
idempotency_key)`, `record_payment(invoice, amount, method, reference,
idempotency_key)`, `refund_payment(payment, amount, reason)`,
`open_shift`, `close_shift`, `add_cash_movement`, `receive_purchase`,
`create_expense`.

**Subscriptions** — `create_subscription`, `renew_subscription`,
`set_subscription_status`, `deduct_subscription_usage`, `run_expiry_jobs`.

**Reporting** — `dashboard_metrics(branch)`, `report_revenue(branch, from, to,
group_by)`, `report_attendance`, `report_outstanding`, `report_profit_loss`,
`report_kids_area_sessions`, `report_inventory`, `report_cash_shifts`.

All RPCs are `security definer`, `set search_path = public`, and re-check
permissions themselves — RLS on the underlying tables is a second line of
defence, not the only one.

## Pricing model

`pricing_rules` (23 columns) is a data-driven engine, never a constant:

| rule_type | Uses | Behaviour |
| --- | --- | --- |
| `hourly` | `price`, `unit_minutes=60` | ceil(billable/60) × price |
| `half_hour` | `unit_minutes=30` | ceil(billable/30) × price |
| `per_minute` | `unit_minutes=1` | billable × price |
| `fixed_ticket` | `base_price` | flat |
| `day_pass` | `base_price` | flat, whole day |
| `package` | `included_minutes`, `base_price`, `price` | base + ceil(overage/unit) × price |
| `family` | `family_discount_pct` | per-child with family cap |

Rules also carry `min_charge`, `grace_minutes`, `day_of_week` (a Saturday
day-pass can coexist with a weekday hourly rule), `valid_from`, `valid_to`,
`branch_id` and `active`. Precedence is most-specific-first
(branch + service + day + date window), resolved in `quote_kids_area()`.

Ordering inside the calculation: `billable = max(0, minutes − grace)`, then
round units **up**, then apply `min_charge`, then user discount, then family
cap. Covered by `tests/pricing.test.ts`.

## RLS

RLS is enabled on all 49 tables; 114 policies exist. Shape of the rules:

```sql
-- staff of the branch can read children there
using (public.is_staff()
       and public.can_access_branch(branch_id)
       and public.has_permission('children.view'))

-- parents read only their own children
using (public.is_parent_of(id))

-- parents can never write
-- (no policy for insert/update/delete → denied by default)
```

Sensitive checks worth knowing:

- `medical_notes` requires `children.medical.view` in addition to branch access.
- `child_documents` requires `documents.view`; the storage object is private and
  reached through a signed URL.
- `audit_logs` is insert-only for triggers, select-only for `super_admin`.
- `payments`/`refunds` have select + insert policies only — no update/delete
  policy exists at all, so immutability holds even if a trigger were dropped.

`npm run test:rls` and the CI `rls` job assert that the anon key sees zero rows
on 30 protected tables and cannot execute 5 protected RPCs.

## Migrations

| # | Name | Notes |
| --- | --- | --- |
| 0001 | core_foundation | branches, profiles, RBAC, settings, audit |
| 0002 | children_parents | children, guardians, pickups, documents |
| 0003 | operations_schema | classrooms, enrollments, sessions, pricing tables |
| 0004 | operations_functions | check-in/out, pricing engine |
| 0005 | financial_schema | invoices, payments, cash, expenses, inventory |
| 0006 | financial_functions | invoice/payment/refund/shift/purchase RPCs |
| 0007 | rls_policies | RLS + all policies |
| 0008 | seed_reference_data | branch MAIN, services, rules, packages, classrooms |
| 0009 | subscriptions | packages/subscriptions/usage + lifecycle RPCs |
| 0010 | dashboard | reporting RPCs |
| 0011 | timezone_and_hardening | Africa/Cairo, indexes, extra guards |
| 0012 | scheduled_jobs | pg_cron: daily expiry sweep, audit retention, `scheduled_jobs` view |

Migration files are append-only. To change the schema, add `0013_*.sql`.

## Scheduled jobs

`0012_scheduled_jobs.sql` registers two pg_cron jobs (both verified running):

| Job | Schedule (UTC) | Cairo time | Action |
| --- | --- | --- | --- |
| `erp-daily-expiry-sweep` | `0 4 * * *` | 06:00 | `run_expiry_jobs()` — expires subscriptions past `end_date`, creates expiry-soon and low-stock notifications |
| `erp-audit-retention` | `15 2 * * *` | 04:15 | `prune_old_audit_logs(24)` — deletes audit rows older than 24 months |

Check job health:

```sql
select jobname, schedule, active, last_run_at, last_status from public.scheduled_jobs;
```

Both functions are idempotent and safe to re-run manually. `run_expiry_jobs()`
was exercised against the live project: a subscription 5 days from expiry
produced 1 notification, and one moved to yesterday's date was flipped to
`expired` (`expired: 1`).
