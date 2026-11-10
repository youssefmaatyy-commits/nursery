-- 0013_absence_reminder_cron.sql
-- Schedules the absence-reminder Edge Function.
--
-- Uses pg_net (available on hosted Supabase) to POST to the function. The shared
-- secret is NOT stored here: it is read from Supabase Vault, so the repository
-- never contains a credential and rotating it does not require a migration.
--
-- Prerequisites, run once by an operator (see supabase/functions/absence-reminder/README.md):
--   select vault.create_secret('<the-cron-secret>', 'absence_reminder_cron_secret');
--   -- and set the same value as the function secret CRON_SECRET
--
-- Until the Vault secret exists, the job is created but exits immediately
-- without calling the function, so nothing fails loudly in production.

create extension if not exists pg_net with schema extensions;

create or replace function public.trigger_absence_reminder()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_url text := 'https://wpprnexfdzteeqkmqhir.supabase.co/functions/v1/absence-reminder?channel=whatsapp';
  v_request_id bigint;
begin
  -- Read the shared secret from Vault; skip quietly when not configured yet.
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'absence_reminder_cron_secret'
   limit 1;

  if v_secret is null or length(v_secret) < 16 then
    return jsonb_build_object('skipped', true, 'reason', 'vault_secret_missing');
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  ) into v_request_id;

  return jsonb_build_object('skipped', false, 'request_id', v_request_id, 'queued_at', now());
end $$;

revoke all on function public.trigger_absence_reminder() from public;
grant execute on function public.trigger_absence_reminder() to service_role;

-- 10:00 UTC = 12:00 Africa/Cairo, after the morning register is taken.
select cron.schedule(
  'erp-absence-reminder',
  '0 10 * * *',
  $$select public.trigger_absence_reminder()$$
);
