-- 0012_scheduled_jobs.sql
-- Scheduled maintenance: subscription expiry, expiry reminders and low-stock
-- alerts. All logic already exists in public.run_expiry_jobs(); this migration
-- only schedules it, so the work is inspectable and version-controlled instead
-- of being a manual dashboard click.
--
-- Requires the pg_cron extension (available on all Supabase plans except the
-- smallest compute add-ons). The extension lives in the `cron` schema.

create extension if not exists pg_cron with schema cron;

-- ---------------------------------------------------------------------------
-- 1. Daily sweep at 06:00 Africa/Cairo.
--    pg_cron schedules in UTC on Supabase, so 06:00 Cairo (UTC+2 / UTC+3 in DST)
--    is expressed as 04:00 UTC. Running at 04:00 UTC also means the sweep lands
--    after midnight Cairo, so "expires today" is judged on the local date.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'erp-daily-expiry-sweep',
  '0 4 * * *',
  $$select public.run_expiry_jobs()$$
);

-- ---------------------------------------------------------------------------
-- 2. Audit retention: keep 24 months of audit_logs, nightly at 02:15 UTC.
--    Financial rows are never touched — audit_logs is append-only and only
--    pruned by age.
-- ---------------------------------------------------------------------------
create or replace function public.prune_old_audit_logs(p_keep_months int default 24)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted bigint;
begin
  delete from public.audit_logs
   where created_at < now() - make_interval(months => greatest(coalesce(p_keep_months, 24), 12));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke all on function public.prune_old_audit_logs(int) from public;
grant execute on function public.prune_old_audit_logs(int) to service_role;

select cron.schedule(
  'erp-audit-retention',
  '15 2 * * *',
  $$select public.prune_old_audit_logs(24)$$
);

-- ---------------------------------------------------------------------------
-- 3. Observation helper for operators: what is scheduled and did it run?
--    Exposed as a view so support can check job health without cron privileges.
-- ---------------------------------------------------------------------------
create or replace view public.scheduled_jobs as
  select j.jobid,
         j.jobname,
         j.schedule,
         j.command,
         j.active,
         (select max(r.start_time) from cron.job_run_details r where r.jobid = j.jobid) as last_run_at,
         (select r.status from cron.job_run_details r
           where r.jobid = j.jobid order by r.start_time desc limit 1) as last_status
    from cron.job j;

comment on view public.scheduled_jobs is
  'pg_cron jobs registered by the ERP, with last run time and status.';

-- Only staff who can see the audit trail may inspect job health.
alter view public.scheduled_jobs set (security_invoker = true);
revoke all on public.scheduled_jobs from anon;
grant select on public.scheduled_jobs to authenticated, service_role;
