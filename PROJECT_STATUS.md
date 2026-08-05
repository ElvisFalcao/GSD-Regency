# Regency–Shalina Project Manager — Project Status & Delivery Record

**Status:** Foundation complete. Real accounts, database-backed data, access control enforced. Not yet in team use.
**Repository:** [ElvisFalcao/GSD-Regency](https://github.com/ElvisFalcao/GSD-Regency) (public)
**Local working copy:** `C:\Users\denyf\Projects\GSD-Regency`
**Primary users (v1):** Regency Global staff working on Shalina Healthcare
**Timezone:** Africa/Johannesburg
**Last updated:** 31 July 2026

## 1. Project goal

An internal, Regency-owned project-management workspace for the Shalina Healthcare account, designed to work alongside FluxPlanner rather than replace it:

- **FluxPlanner** is the source of truth for campaign plans, platform rows, budgets and durations.
- **Regency–Shalina Project Manager** is the operational source of truth for the work around those plans: production workflow, approvals, publication, boosting, reports, deadlines, reminders and individual to-dos.

The result should feel like a focused, account-specific Asana: everyone can see what needs doing, who owns it, when it is due and what is blocked — for campaign work and for everyday work that belongs to no campaign.

## 2. Business rules

### Brand and market hierarchy

| Division | Brand | Valid markets |
| --- | --- | --- |
| Consumer | Germol | Angola, South Africa |
| Consumer | Flodent | Angola, South Africa |
| Consumer | Aco | Angola |
| OTX | Shaltoux | Nigeria, Ghana, Zambia, Angola |
| OTX | Shal’Artem | Nigeria, Ghana |
| OTX | Ibucap | Nigeria only (Kenya is not operational) |

### Publishing and paid-media rules

- Supported platforms: Facebook, Instagram, TikTok, YouTube.
- TikTok is valid only for **Nigeria** and **South Africa**; it is rejected for Angola, Ghana and Zambia.
- A valid imported platform row creates three linked tasks: **Post** (due on the launch date), **Boost** (same date), **Report** (three Johannesburg business days after the boost).
- Imported tasks default to whoever holds the Paid Media Owner role, resolved from the database rather than hardcoded.
- Standalone **To-do** tasks are supported so non-campaign work appears in the same workload view.

## 3. The team

Access level governs what someone may see and do. Roles describe the work they do. They move independently: Sian taking on posts is a role change, Leon not seeing analytics is an access rule.

| Name | Title | Access | Roles |
| --- | --- | --- | --- |
| Shane Killeen | Strategic Director | owner | Strategy, Approval Coordinator |
| Elvis Falcão | Paid Media Owner | admin | Paid Media Owner, Approval Coordinator |
| Zaida Kays | Process Coordinator | admin | Approval Coordinator |
| Kesia Burdett | Creative Lead | member | Creative |
| Tshwaraganyo Lekabe | Creative Lead | member | Creative |
| Leon-Erasmus Maree | Video Producer & Editor | member | Video Editor, Production |
| Sian Touzel | Community Manager | member | Community Manager |
| Nikki Dickson | Bookkeeping | member | Bookkeeping |

Owner and admin have identical capability. `owner` exists so an admin cannot demote or remove Shane.

Capabilities derive from tier **or** role, so access follows a role change instead of needing a second edit:

| Capability | Owner | Admin | Member |
| --- | :--: | :--: | :--: |
| See every task | ✓ | ✓ | ✓ |
| Create, delete, assign, reschedule | ✓ | ✓ | — |
| Progress own task (status, link, notes) | ✓ | ✓ | ✓ |
| Import plans, workspace settings, manage members | ✓ | ✓ | — |
| Reports and analytics | ✓ | ✓ | Community Manager role only |
| Budget and spend | ✓ | ✓ | Bookkeeping role only |

## 4. Architecture

Static HTML/CSS/vanilla-JS front end with no build step, talking directly to Supabase Postgres. Business rules and persistence are separated so the interface can be replaced without rewriting either.

| File | Responsibility |
| --- | --- |
| `index.html` | Structure, sign-in gate, dialogs |
| `styles.css` | All styling |
| `app.js` | Session, rendering, filters, import, membership administration |
| `lib/automation.js` | Eligibility, business days, task generation, spreadsheet mapping |
| `lib/data.js` | Supabase reads and writes, row mapping, capability derivation |
| `dev-server.mjs` | Local static server |
| `supabase/schema.sql` | Original bootstrap — **superseded**, see migrations |
| `supabase/migrations/*.sql` | Source of truth for the database, applied in order |
| `supabase/functions/*/index.ts` | Edge Function sources |
| `test/*.test.js` | 22 automated tests |

### Database

Hosted in the existing **FluxPlanner-Pro** project (`yqiufyruxwfnjlcwmfvy`). Sharing is a cost constraint, not a design choice: the organisation is on the Supabase free plan with both project slots used. Isolation into a Regency-owned organisation on Pro is planned before go-live and before any platform API tokens are stored.

Tables: `pm_workspaces`, `pm_members`, `pm_member_roles`, `pm_campaigns`, `pm_tasks`, `pm_task_financials`, `pm_task_metrics`, `pm_task_activity`, `pm_sync_conflicts`, `pm_reporting_mappings`, `pm_notification_settings`, `pm_meetings`, `pm_workspace_snapshots` (legacy, no policies, awaiting removal).

Budget and pulled analytics live in their own tables rather than on `pm_tasks`. Row-level security cannot hide a column, and everyone can see every task, so the only way to restrict those figures is to put them where a row policy can reach them.

| Migration | Purpose |
| --- | --- |
| `0001_members_and_roles` | Real staff, job titles, many-to-many role assignment |
| `0002_access_model` | Access levels, self-registration gate, RLS helper functions |
| `0003_membership_rls` | Replaced the permissive policies; moved budget and metrics out |
| `0004_function_grants` | Partial attempt to unexpose helpers — **incomplete, see 0005** |
| `0005_function_grants_fix` | Revoked anon execute properly |
| `0006_link_member` | Approving a registration, as one atomic statement |

### Edge Functions

| Function | Purpose | State |
| --- | --- | --- |
| `granola-task-sync` | Turns Granola meeting actions into tasks | Deployed, **never successfully invoked** — `GRANOLA_SYNC_SECRET` is unset |
| `report-sync` | Supermetrics reporting into `pm_task_metrics` | Source only, not deployed |
| `dispatch-reminders` | Due and overdue email via Resend | Source only, not deployed |
| `fluxplanner-sync` | Activation and date reconciliation | Source only, not deployed |

## 5. Local-first working agreement

1. Make and inspect the change locally in `C:\Users\denyf\Projects\GSD-Regency`.
2. Run `npm test` and check the interface in a browser where the UI changed.
3. Review the files and the result before treating the work as ready.
4. Push to GitHub only after the local version is confirmed.
5. Deploy backend changes deliberately, then validate the deployed state.

## 6. How to run and test

Requires Node.js only.

```powershell
./start-project-manager.bat   # then open http://localhost:4173
npm test                      # 22 tests
node --check app.js
```

Blank either Supabase value in `config.js` to fall back to demo mode, which needs no credentials and stores nothing.

## 7. Problems found and resolved

| Situation | Cause | Resolution |
| --- | --- | --- |
| Local `.git` was empty; no version control | Windows Controlled Folder Access silently blocks all writes under `Documents`, and reports a failed *create* as `No such file or directory` | Project moved to `C:\Users\denyf\Projects\GSD-Regency` |
| Every non-ASCII character in the repository was mangled | The original upload went file-by-file through the GitHub connector API, which double-encoded UTF-8 — a consequence of local git being unusable | History reset to one clean baseline; `.gitattributes` added |
| `start-project-manager.bat` never worked | `py` absent and `python.exe` resolves to the Microsoft Store alias stub, which exits without serving | Replaced with `dev-server.mjs` |
| Any authenticated FluxPlanner user could read and delete all Regency data | Policies were `using (true)`; the linter flagged nine | Replaced with membership checks in `0003` |
| Interface and database were disconnected | The app wrote a whole-state JSON blob to `pm_workspace_snapshots` and never read back, so Granola-created tasks could never appear | Rewired onto the real tables |
| Registering would have raised a duplicate-key error | `requestAccess` wrote an email that collides with the seeded member row | Email left null on request; address carried in `display_name` |
| Import button appeared to do nothing | Async click handlers were unawaited promises; a rejection surfaced nowhere | `guard()` routes every failure to the interface |
| Client documents sat in a public repository | No exclusions | `*.xlsx`, `*.docx`, `*.pptx` ignored; they were never pushed |

## 8. Remaining work

### Before the team uses it

- [ ] Confirm the import path works end to end — **currently failing, cause not yet identified**
- [ ] Have a second person register, to prove approval and linking
- [ ] Enable leaked-password protection in Supabase Auth
- [ ] Auth → URL Configuration: Site URL `https://elvisfalcao.github.io/GSD-Regency`, additional redirect URLs `https://elvisfalcao.github.io/GSD-Regency/**`, `https://elvisfalcao.github.io/FluxPlanner-Pro/**`, `http://localhost:4173/**` — reset and confirmation emails bounce off this allow-list
- [ ] Set `GRANOLA_SYNC_SECRET`, then send one controlled payload and verify the task appears
- [ ] Personal `@regency.global` addresses; update `pm_members.email` to match, since reminders go there
- [ ] Deploy and test `report-sync`, `dispatch-reminders`, `fluxplanner-sync`
- [ ] Set up Resend with a verified sender and a daily cron
- [ ] Connect Supermetrics, add the API key as a secret, populate `pm_reporting_mappings`
- [ ] Agree the FluxPlanner activation identifier contract, then test date changes both ways
- [ ] Move to a Regency-owned Supabase organisation on Pro — the free tier auto-pauses after inactivity, which for a workspace sending morning reminders is a silent outage

### Product improvements

- [ ] Richer landing view for approved members; a per-user "My tasks"
- [ ] Task comments, attachments, approval history
- [ ] Recurrence for repeated monthly reporting or posting
- [ ] Calendar and timeline views
- [ ] Escalation reminders and email templates
- [ ] Import error export and an activity audit view
- [ ] Admin screen for Supermetrics mappings
- [ ] Deployment pipeline and GitHub Actions checks
- [ ] Accessibility review with real users
- [ ] Decide whether members may create their own to-dos; `pm_tasks` insert is manager-only today, so they cannot

## 9. Immediate next action

Resolve the import failure. The spreadsheet parses correctly (53 valid rows from the Shal’Artem plan, none rejected, no colliding keys), both CDNs load, and the exact insert succeeds against the database under Elvis's own access level — so neither the data nor the policies are refusing it. The unhandled-rejection fix in `aea9626` should now surface the real cause in the import dialog.
