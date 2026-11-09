# Deployment

## 1. Frontend → Vercel

The repo already contains `vercel.json`:

- framework `vite`, build `npm run build`, output `dist`
- install uses `npm ci --legacy-peer-deps`
- SPA rewrite to `index.html` for everything except `assets/`, `icons/`,
  `sw.js`, `workbox-*` and `manifest`
- security headers (nosniff, frame options, referrer policy, HSTS,
  permissions policy limited to the camera used for QR/barcode scanning)
- immutable caching for hashed assets, `no-store` for the service worker

### Steps

1. Push the repo to GitHub (already at
   `https://github.com/youssefmaatyy-commits/nursery`).
2. In Vercel: **Add New → Project → Import Git Repository → nursery**.
3. Framework preset is detected as Vite. Keep the commands from `vercel.json`.
4. Add environment variables for **Production, Preview and Development**:

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | publishable/anon key |

5. Deploy. Note the assigned domains, e.g.
   `https://nursery.vercel.app` and `https://nursery-git-develop-<team>.vercel.app`.
6. Add every real origin to **Supabase → Authentication → URL Configuration**
   (Site URL + Redirect URLs), otherwise password-reset links are rejected.
   Preview wildcards (`https://*.vercel.app/**`) are already allow-listed for
   evaluation and **must be removed before production**.

### Equivalent hosting

Any static host with SPA fallback works (Netlify, Cloudflare Pages, GitHub
Pages behind a CDN). The only requirements are:

- rewrite unknown paths to `/index.html`
- serve `.js`/`.css` with long cache, `sw.js` with `no-cache`
- HTTPS (service worker and camera APIs require a secure context)

## 2. Backend → Supabase

Migrations live in `supabase/migrations/`. Apply with the CLI:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

`supabase/config.toml` is intentionally minimal; nothing needs to be changed for
a standard hosted project.

### Post-deploy configuration checklist

| Setting | Value |
| --- | --- |
| Authentication → Email | enabled |
| Authentication → Sign-ups | **disabled** (staff accounts are provisioned by an admin) |
| Authentication → Confirm email | enabled |
| Authentication → Password min length | 12 (raise in dashboard; API field not exposed by the connector) |
| Site URL | production domain |
| Redirect allow-list | production domain + exact preview domains |
| Storage | all 5 buckets private |
| Database → Backups | daily backups enabled on paid plans |

### Edge Functions

The system is designed so that no business logic requires an Edge Function —
everything is a database RPC. Edge Functions are optional and reserved for
outbound integration (SMS/WhatsApp reminders). To add one:

```bash
supabase functions new send-absence-reminder
supabase functions deploy send-absence-reminder --project-ref <project-ref>
```

Service-role secrets belong in `supabase secrets set`, never in the repo.

## 3. Continuous integration

`.github/workflows/ci.yml` runs on every push to `main`, `develop` and any
`arena/**` branch:

1. `npm ci --legacy-peer-deps`
2. `npm run typecheck`
3. `npm run lint`
4. `npm test`
5. `npm run build` + artefact presence check (`dist/index.html`, `dist/sw.js`)
6. upload `dist` as a workflow artefact
7. on `main` only: `node scripts/test-rls.mjs` against the live project

Required repository secrets:

| Secret | Used by |
| --- | --- |
| `VITE_SUPABASE_URL` | build step |
| `VITE_SUPABASE_ANON_KEY` | build step, RLS probe |

If the secrets are missing the build step still succeeds (Vite inlines empty
values) but the app will show a configuration error at runtime — set them before
the first production deploy.

## 4. Branching and release flow

```
main      ← production, protected, deployed by Vercel
develop   ← integration, previews
feature/* ← per module (children, pos, nursery…)
```

Merges to `main` go through a pull request with the CI check green. No direct
pushes to `main`.

## 5. Rollback

- **Frontend**: Vercel → Deployments → previous deployment → *Promote to
  Production*. Instant, no rebuild.
- **Database**: migrations are forward-only. To undo a schema change, write a
  new migration — never edit an applied file. For data loss, restore the
  snapshot described in `docs/BACKUP_RESTORE.md`.

## 6. Post-deploy smoke test (5 minutes)

1. Sign in as administrator → dashboard loads with figures.
2. Check in a child → session opens; check in the same child again → rejected
   as duplicate.
3. Check out → invoice generated with backend-computed amount.
4. Take a payment (cash) → invoice balance drops; payment row immutable.
5. Open a cash shift → add a movement → close shift → expected cash reported.
6. Switch language to English and back → RTL/LTR switch, no data change.
7. Open `/portal` with the parent account → only that parent's children visible.
8. Turn off the network, attempt a check-in → queued in `/sync`; reconnect →
   replayed exactly once.
