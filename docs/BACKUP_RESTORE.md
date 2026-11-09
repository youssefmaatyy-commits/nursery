# Backup & Restore

This system holds children's identity, medical and family data, plus all
financial records. Treat a backup as mandatory, not optional, and test the
restore before you need it.

## 1. What must be backed up

| Object | Contains | Method |
| --- | --- | --- |
| Postgres data | 49 tables: children, guardians, invoices, payments, … | `pg_dump` / Supabase backups |
| Roles & functions | RLS policies, 94 functions, triggers | same dump (schema included) |
| Storage objects | child documents, photos, ID scans (5 buckets) | `storage` API export |
| Auth users | staff and parent accounts | **not** in `pg_dump` of `public` — see §4 |
| Frontend code | the repo itself | GitHub |
| Secrets | `.env` values | password manager, never git |

## 2. Automated backups (Supabase)

- **Free plan**: no automatic backups. Rely on §3 and do it manually, daily.
- **Pro plan**: Database → Backups → daily snapshots, 7-day retention; enable
  PITR (point-in-time recovery) for financial production use.
- Backups are encrypted at rest by Supabase. They do **not** include storage
  objects or auth users — handle those as in §3 and §4.

## 3. Manual logical backup

### Connect

Get the connection string from **Project Settings → Database → Connection
string (URI)**. Keep the password in your password manager and export it into
the environment of the shell only:

```bash
export PGPASSWORD='<db-password>'
export PGURL='postgresql://postgres.<project-ref>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'
```

Do not put the password on the command line (it lands in shell history) and
never commit it.

### Dump

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p backups

# schema + data, everything except Supabase-managed schemas
pg_dump "$PGURL" \
  --schema=public --schema=auth --schema=storage \
  --no-owner --no-privileges \
  --format=custom --compress=9 \
  --file="backups/kidsnursery-${STAMP}.dump"

# sanity check: the dump must contain our tables
pg_restore --list "backups/kidsnursery-${STAMP}.dump" | grep -c 'TABLE DATA'   # ≈ 49+
sha256sum "backups/kidsnursery-${STAMP}.dump" > "backups/kidsnursery-${STAMP}.sha256"
```

Keep three generations: daily for 7 days, weekly for 8 weeks, monthly for
12 months. Store at least one copy off-site (encrypted, e.g. `age` or `gpg`):

```bash
age -r <recipient> -o "backups/kidsnursery-${STAMP}.dump.age" "backups/kidsnursery-${STAMP}.dump"
```

### Storage objects

```bash
# per bucket, using the service-role key from your password manager
for BUCKET in child-documents child-photos pickup-photos expense-receipts; do
  supabase storage download --recursive "$BUCKET" "./backups/storage/$BUCKET" \
    --project-ref "$SUPABASE_PROJECT_REF"
done
```

## 4. Auth users

`auth.users` rows are in the `auth` schema and are included by the command in
§3. The `encrypted_password` column is hashed and portable, so restoring the
`auth` schema preserves passwords. If you restore into a *different* project,
verify that `auth.uid()` references in `public.profiles` still line up
(`profiles.id = auth.users.id`).

## 5. Restore

> Restore into a **staging project first**. Never restore over production
> without an explicit decision and a fresh backup of the current state.

```bash
# 1. fresh project, migrations applied (or let pg_restore create them)
supabase link --project-ref <target-ref>

# 2. restore
pg_restore --dbname "$TARGET_PGURL" \
  --clean --if-exists --no-owner --no-privileges \
  --jobs=4 "backups/kidsnursery-<STAMP>.dump"
```

`--clean --if-exists` drops existing objects first; omit it when restoring into
an empty project.

### Post-restore verification

```sql
-- row counts match the source
select 'children' t, count(*) from children
union all select 'invoices', count(*) from invoices
union all select 'payments', count(*) from payments;

-- RLS still active on everything
select count(*) from pg_tables
 where schemaname='public' and not rowsecurity;             -- must be 0

-- policies intact
select count(*) from pg_policies where schemaname='public'; -- 114

-- functions intact
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public';                                  -- 94

-- no orphaned children
select count(*) from children c
 where not exists (select 1 from child_guardians g where g.child_id=c.id); -- 0
```

Then:

1. Re-upload the storage objects to the matching buckets and confirm they are
   **private** (`storage.buckets.public = false`).
2. Sign in as administrator, open the dashboard, confirm figures match.
3. Open a test invoice and verify its balance equals the source system.
4. Update `.env` / Vercel env vars only if the project ref changed.

## 6. Partial recovery

| Need | Approach |
| --- | --- |
| One deleted child | restore the dump into staging, `copy` the rows back with a script; never hand-edit IDs |
| One wrong invoice | do **not** restore; issue a refund or a correcting invoice — instalments are immutable by design |
| Corrupt reference data | re-run `0008_seed_reference_data.sql` (it upserts on code) |
| Rolled-back deploy | promote the previous Vercel deployment |

## 7. Backup cadence checklist

| Frequency | Action | Owner |
| --- | --- | --- |
| Daily | confirm Supabase automated backup succeeded (Pro) or run §3 script | IT |
| Weekly | copy dump off-site, verify checksum | IT |
| Monthly | full restore drill into staging, record row counts | IT + Manager |
| Before any migration | take an on-demand dump | developer |
| Before go-live | dump + documented restore rehearsal | IT |

## 8. Retention & privacy

Children's data is confidential. Backups inherit that classification:

- encrypt every off-site copy; no plain dumps on a laptop or in a repo
- restrict access to the password manager entry and the storage bucket
- delete dumps past retention (12 months) deliberately
- when a data-deletion request is honoured in the live system, delete the
  affected rows from backups too, or document why the backup is retained under
  a legal-basis exemption
