# absence-reminder Edge Function

> **Status: deployed but not booting.** Every function on project
> `wpprnexfdzteeqkmqhir` returns `BOOT_ERROR`, including a minimal healthcheck on
> a fresh slug — a platform-side failure. The code is ready; redeploy when the
> runtime works.

Sends WhatsApp/SMS messages for today's nursery absences.

## Deploy

```bash
supabase functions deploy absence-reminder --project-ref <project-ref>
```

## Secrets (never committed)

```bash
supabase secrets set \
  WHATSAPP_TOKEN=... WHATSAPP_PHONE_ID=... \
  CRON_SECRET=$(openssl rand -hex 32) \
  --project-ref <project-ref>
# or for SMS:
supabase secrets set TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM=+20... --project-ref <project-ref>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

## Invoke

```bash
# dry run — counts messages without sending
curl -H "x-cron-secret: $CRON_SECRET" \
  "https://<ref>.functions.supabase.co/absence-reminder?channel=whatsapp&dry_run=1"

# real send
curl -H "x-cron-secret: $CRON_SECRET" \
  "https://<ref>.functions.supabase.co/absence-reminder?channel=whatsapp"
```

Authorisation accepts either the `x-cron-secret` header or a user JWT whose
`my_context().permissions` contains `settings.manage` / `notifications.send`.
Unauthenticated calls get 401 — the function is never publicly usable.

## Schedule

Add to `cron.schedule` via `pg_net`, or trigger from an external scheduler at
13:00 Cairo daily (after the morning register closes).
