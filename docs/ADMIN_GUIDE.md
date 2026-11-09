# Administrator guide

Day-to-day operation of the ERP for a Kids Area + Nursery branch. Arabic is the
default UI; every screen switches to English from the sidebar.

## 1. Roles and what they can do

Permissions are enforced in the database, so a hidden button is not what stops
someone — a missing permission is.

| Role | Typical holder | Can |
| --- | --- | --- |
| **Super Admin** | owner / IT | everything, all branches, settings, roles, audit log |
| **Branch Manager** | branch director | all operations inside their branch, staff, reports, discounts, refunds (per policy) |
| **Receptionist** | front desk | check-in/out, register children & guardians, view balances, take bookings |
| **Cashier** | till | POS, invoices, payments, cash shift, end-of-day close |
| **Nursery Teacher** | classroom | presence, daily reports, activities, child medical notes (read) |
| **Accountant** | finance | invoices, payments, refunds, expenses, suppliers, P&L, outstanding |
| **Inventory Manager** | store | products, stock, purchases, suppliers |
| **Parent** | portal only | own children's attendance, invoices, daily reports, subscriptions, absence notice |

Custom roles: **Roles** screen → *New role* → tick permissions (41 to choose
from) → assign to users. A role can be branch-scoped when assigning, which limits
that user to that branch only.

## 2. First-run configuration

1. **Settings**
   - Branch name (AR + EN), phone, address, currency `EGP`, timezone
     `Africa/Cairo`, tax rate (0 unless you charge VAT), invoice prefix.
   - Working hours and the age range accepted by the Nursery.
2. **Services & pricing** (Settings / Kids Area)
   - Services: hourly, half-hour, per-minute, fixed ticket, day pass, package,
     family.
   - Rules: price, unit minutes, minimum charge, grace minutes, day-of-week
     overrides, validity window. **No price exists in the frontend** — if a
     number is wrong, it is fixed here.
3. **Packages** — name (AR/EN), included minutes or sessions, price, validity
   days. Seeded: `PKG-10H`, `PKG-20H`, `PKG-10S`, `PKG-FAMILY`.
4. **Classrooms** — name, capacity, age range, assigned teacher(s).
5. **Cash registers** — one per till (`MAIN-01` seeded), float amount.
6. **Users** — create in Supabase Authentication (sign-ups are disabled), then
   assign a role and branch here.

## 3. Registering a family

**Children → New child**

- Required: code (auto `CH-xxxxx`), full name AR and EN, date of birth, gender,
  branch.
- Recommended: national ID, photo, allergies, blood type, medical notes,
  emergency contact.
- The form warns on possible duplicates (`find_duplicate_child` compares name,
  DOB and guardian phone) before saving.

Then link at least one guardian:

- **Parents → New guardian** → name, relation, phone, national ID, address,
  occupation; select the children.
- Mark one guardian **primary** (billing contact) and set custody where relevant.
- **Authorized pickups** — anyone allowed to collect the child besides the
  guardians: name, relation, national ID, phone, photo. Reception verifies
  against this list; a person not on it cannot take the child.

**Documents** — upload birth certificate, vaccination record, ID copies, consents
on the child profile. Files land in a private bucket and are served through
short-lived signed links; only roles with `documents.view` can request them.

## 4. Kids Area daily operations

1. Parent arrives → **Operations** → scan the child's QR badge (camera) or search
   by name/phone/code.
2. **Check in** → a session opens. If the child already has an open session the
   database refuses a second one.
3. The screen shows every child currently inside, with elapsed time and the
   running estimate.
4. On collection: verify the pickup person against **authorized pickups** →
   **Check out**.
5. The backend computes the amount (grace → units → minimum → discount →
   package/subscription deduction) and issues the invoice.
6. Take payment at the desk or leave it on the account.

Walk-ins (no registration) can be served with a name + phone only; they are
stored as a light record so the session still has an owner.

## 5. Nursery operations

- **Enrollment** — child + classroom + plan + start date + monthly fee. Capacity
  is enforced: a full classroom rejects new enrollments.
- **Attendance** — daily list per classroom: present / absent / late / early
  pick-up. `mark_absence` records a reason (sick, travel, other).
- **Daily report** — per child per day: meals, nap, mood, toilet, activities,
  notes, photos. Visible to that child's parent in the portal.
- **Activities & events** — plan for a classroom or the branch; holidays block
  attendance and shift billing dates.
- **Late/early** — recorded on the attendance row; late-pickup fees are a pricing
  rule, not a hardcoded value.

## 6. Subscriptions & packages

- Sell a package at the desk: child + package + optional discount → subscription
  with remaining minutes/sessions and an expiry date.
- Usage is deducted automatically at check-out; a covered session bills **0** to
  the customer while minutes are still tracked.
- Lifecycle: **renew** (tops up), **suspend** (pauses use), **cancel**,
  **upgrade** (moves remaining balance to a bigger package), **expiry**
  (scheduled job `run_expiry_jobs`).
- The Subscriptions screen shows remaining balance, expiry and the usage history
  per child.

## 7. Money

**POS** — pick services/products, apply a discount (permission-gated), choose
customer, pay cash/card/transfer or split across methods, or leave part unpaid.

**Invoices** — search, filter by status, print or save as PDF, record a further
payment, refund, and see the immutable payment history. A correction is a new
document; nothing is edited or deleted.

**Cash register** — open a shift with a float, record payouts/collections, close
the shift; the system reports expected cash vs counted and any variance.

**Expenses** — category, supplier (optional), amount, date, receipt image,
payment method. Categories: rent, salaries, utilities, supplies, maintenance,
marketing, transport, other.

**Refunds** — always against an existing payment, with a reason; the original is
untouched.

## 8. Reports

**Reports** screen, 7 families, all filtered by branch and date range:

| Report | Shows |
| --- | --- |
| Revenue | net revenue grouped by day / method / service |
| Attendance | nursery presence, absences, late arrivals |
| Outstanding | unpaid and partially paid invoices with ageing |
| Profit & loss | gross revenue, refunds, net revenue, expenses by category, profit |
| Kids Area sessions | visits, minutes, amounts, package coverage |
| Inventory | stock on hand, value, low-stock alerts |
| Cash shifts | float, sales, payouts, expected vs counted |

Each can be exported to CSV and printed (browser → *Save as PDF*).

## 9. Notifications & audit

- **Notifications** — in-app alerts for absence, overdue invoice, expiring
  package, low stock. Delivery channels (SMS/WhatsApp) are an integration point,
  not enabled by default.
- **Audit log** — every privileged change with actor, branch, table, before/after
  and timestamp. Filter by user, table, date. Only Super Admin can read it.

## 10. Offline behaviour

The app is a PWA. If the internet drops:

- the shell still loads, cached reads stay visible
- check-ins, payments and other writes are queued locally (IndexedDB) with an
  idempotency key
- the **Sync** screen lists the queue, shows errors, and lets you retry
- on reconnect the queue replays through `apply_sync_operation` — each operation
  runs the same validated database function, so nothing is duplicated and no
  card payment is confirmed without a real confirmation

## 11. Routine maintenance

| Cadence | Task |
| --- | --- |
| Daily | close the cash shift; review the dashboard; check the sync queue |
| Daily | confirm the automated backup ran (see `BACKUP_RESTORE.md`) |
| Weekly | review outstanding invoices and expiring packages; run `run_expiry_jobs` if not scheduled |
| Weekly | check low-stock list and raise a purchase |
| Monthly | P&L review; reconcile supplier payments; restore-drill into staging |
| Quarterly | review the role/permission matrix; rotate the demo/test accounts; review audit log for anomalies |

## 12. Escalation

| Problem | First action |
| --- | --- |
| Cannot sign in | confirm the account exists in Supabase Auth; sign-ups are disabled by design |
| "Forbidden" on a screen | the role is missing the permission — Roles screen |
| "Branch forbidden" | user not linked to that branch — assign the role per branch |
| Wrong price charged | fix the pricing rule; do **not** edit the invoice — refund and reissue |
| Duplicate check-in error | the child already has an open session; find it in Operations |
| Data loss | stop, do not write, follow the restore procedure in `BACKUP_RESTORE.md` |
