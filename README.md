# Regency–Shalina Project Manager

Internal operations workspace for Regency’s Shalina Healthcare work. It turns approved campaign budget plans into assigned Post, Boost, and Report tasks while retaining the full content workflow and brand hierarchy.

## Run locally

Requires Node.js — nothing else. Do not double-click `index.html`; browsers refuse ES module imports from a `file://` page, so the app needs a real origin.

```powershell
./start-project-manager.bat
```

Then open `http://localhost:4173`. To use a different port: `node dev-server.mjs 4174`.

`config.js` carries the public Supabase URL and publishable key, so the app connects to the shared workspace and asks you to sign in. Blank either value to fall back to local demo mode, which needs no credentials and stores nothing.

```powershell
npm test
```

## What is implemented

- Shalina Consumer/OTX brand, market, approver, and TikTok eligibility rules.
- 14-stage Regency role workflow template.
- Excel import preview that skips totals and validates imported activation rows.
- Linked Post → Boost → Report task generation. The Report is due three business days after boost launch.
- Task filters, live-link/result capture, overdue and due-today views, local demo persistence, and a Supabase persistence hook.
- SQL schema plus Edge Function source for Supermetrics reports, Resend reminders, and FluxPlanner plan/date sync.

## Deploy to Supabase

1. Run [`supabase/schema.sql`](supabase/schema.sql) in the existing FluxPlanner project’s SQL editor, then every file in [`supabase/migrations/`](supabase/migrations) in numeric order. The migrations are the source of truth — `schema.sql` alone leaves the permissive RLS policies in place.
2. Deploy `report-sync`, `dispatch-reminders`, and `fluxplanner-sync` from `supabase/functions/`.
3. Add secrets: `SUPERMETRICS_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM`, and the supplied Supabase defaults. Configure a daily Cron trigger for `dispatch-reminders`.
4. Verify `regency.global` in Resend and use the configured sender, e.g. `socalpr@regency.global` or a dedicated `notifications@regency.global` address.
5. In Supermetrics, connect each paid-media account, create saved queries, and add corresponding `pm_reporting_mappings` rows.
6. Update FluxPlanner so every activation has an immutable `id` and every generated plan row has `rowKey = activationId + ':' + platform`; then deploy `fluxplanner-sync`.
7. Add the Project Manager’s GitHub Pages URL to any relevant Supabase/Auth allowed-origin list.

## Teams

The workspace exposes Teams as a configuration-ready notification channel. Do not add credentials to browser code. After IT approves a scoped Teams app/channel sender, store its secret configuration in Supabase and invoke it from `dispatch-reminders`; email and in-app notifications already work independently.

## Security note

`config.js` holds only public Supabase connection values. Supermetrics, Resend, and Teams secrets must only be stored in Supabase Edge Function secrets.
