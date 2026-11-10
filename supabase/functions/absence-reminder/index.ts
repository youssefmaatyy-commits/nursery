// Supabase Edge Function: absence-reminder
//
// Sends WhatsApp/SMS notifications for today's nursery absences and for
// subscriptions that expire within 3 days. Designed to be triggered by pg_cron
// (via pg_net) or manually by an administrator.
//
// Secrets required (set with `supabase secrets set ...`):
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID   — Meta Cloud API
//   or TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
//   CRON_SECRET                         — shared secret for non-JWT callers
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// Nothing here is reachable from the browser: the service-role key stays inside
// the function runtime.

import { createClient } from 'npm:@supabase/supabase-js@2.47.10';

type Channel = 'whatsapp' | 'sms';

interface Outgoing {
  to: string;
  body: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

function normalisePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0')) return `+20${digits.slice(1)}`; // Egypt
  if (digits.startsWith('20')) return `+${digits}`;
  return digits.length > 10 ? `+${digits}` : null;
}

async function sendWhatsApp(msg: Outgoing): Promise<boolean> {
  const token = Deno.env.get('WHATSAPP_TOKEN');
  const phoneId = Deno.env.get('WHATSAPP_PHONE_ID');
  if (!token || !phoneId) return false;
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: msg.to.replace('+', ''),
      type: 'text',
      text: { body: msg.body },
    }),
  });
  return res.ok;
}

async function sendSms(msg: Outgoing): Promise<boolean> {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from = Deno.env.get('TWILIO_FROM');
  if (!sid || !token || !from) return false;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: msg.to, From: from, Body: msg.body }),
  });
  return res.ok;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const channel = (url.searchParams.get('channel') ?? 'whatsapp') as Channel;
  const dryRun = url.searchParams.get('dry_run') === '1';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // Authenticate: either a valid Supabase JWT with settings permission, or the
  // shared cron secret. Never accept an unauthenticated call.
  const cronSecret = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('x-cron-secret');
  let authorised = Boolean(cronSecret && provided && provided === cronSecret);

  if (!authorised) {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (jwt) {
      const { data } = await supabase.auth.getUser(jwt);
      if (data.user) {
        const { data: ctx } = await supabase.rpc('my_context');
        const perms: string[] = (ctx as { permissions?: string[] } | null)?.permissions ?? [];
        authorised = perms.includes('settings.manage') || perms.includes('notifications.send');
      }
    }
  }

  if (!authorised) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  // 1. Absent children today, with their primary guardian's phone.
  const { data: absences, error: absenceErr } = await supabase
    .from('nursery_attendance')
    .select('child_id, children(full_name_ar, full_name_en), absence_reason')
    .eq('attendance_date', today)
    .eq('status', 'absent');

  if (absenceErr) {
    return new Response(JSON.stringify({ error: absenceErr.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const messages: Outgoing[] = [];
  const skipped: Array<{ child: string; reason: string }> = [];

  for (const row of absences ?? []) {
    const child = row.children as unknown as { full_name_ar: string; full_name_en: string } | null;
    const { data: guardian } = await supabase
      .from('child_guardians')
      .select('parents(full_name_ar, phone)')
      .eq('child_id', row.child_id)
      .eq('is_primary', true)
      .maybeSingle();

    const parent = (guardian?.parents ?? null) as { full_name_ar: string; phone: string } | null;
    const phone = normalisePhone(parent?.phone ?? null);
    if (!phone) {
      skipped.push({ child: child?.full_name_en ?? row.child_id, reason: 'no_guardian_phone' });
      continue;
    }
    messages.push({
      to: phone,
      body:
        `مرحباً ${parent?.full_name_ar ?? ''}، نلاحظ غياب ${child?.full_name_ar ?? ''} اليوم. ` +
        `يرجى إبلاغ الحضانة بسبب الغياب. — الحضانة`,
    });
  }

  const results = { sent: 0, failed: 0, skipped: skipped.length, dry_run: dryRun };
  for (const msg of messages) {
    if (dryRun) {
      results.sent++;
      continue;
    }
    const ok = channel === 'sms' ? await sendSms(msg) : await sendWhatsApp(msg);
    if (ok) results.sent++;
    else results.failed++;
  }

  return new Response(
    JSON.stringify({ ...results, channel, date: today, skipped_detail: skipped }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } },
  );
});
