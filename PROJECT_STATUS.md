# Regencyâ€“Shalina Project Manager â€” Project Status & Delivery Record

**Status:** Foundation implemented; local-first release preparation in progress  
**Repository:** [ElvisFalcao/GSD-Regency](https://github.com/ElvisFalcao/GSD-Regency)  
**Primary users (v1):** Regency Global staff working on Shalina Healthcare  
**Timezone:** Africa/Johannesburg  
**Last updated:** 24 July 2026

## 1. Project goal

Build an internal, Regency-owned project-management workspace for the Shalina Healthcare account. The product is designed to work alongside FluxPlanner rather than replace it:

- **FluxPlanner** is the source of truth for campaign plans, platform rows, budgets and durations.
- **Regencyâ€“Shalina Project Manager** is the operational source of truth for the people and work around those plans: production workflow, approvals, post publication, boosting, reports, deadlines, reminders, and individual to-dos.

The end result should feel like a focused, account-specific version of Asana: everyone can see what needs doing, who owns it, when it is due, and what is blocked. It must support campaign work as well as everyday Regency work that does not belong to a campaign.

## 2. Business rules captured so far

### Brand and market hierarchy

| Division | Brand | Valid markets |
| --- | --- | --- |
| Consumer | Germol | Angola, South Africa |
| Consumer | Flodent | Angola, South Africa |
| Consumer | Aco | Angola |
| OTX | Shaltoux | Nigeria, Ghana, Zambia, Angola |
| OTX | Shalâ€™Artem | Nigeria, Ghana |
| OTX | Ibucap | Nigeria only (Kenya is not operational yet) |

### Publishing and paid-media rules

- Supported platforms: Facebook, Instagram, TikTok and YouTube.
- TikTok is valid only for **Nigeria** and **South Africa**. It must be rejected for Angola, Ghana and Zambia.
- A valid imported platform row creates three linked operational tasks:
  1. **Post** â€” due on the scheduled launch date.
  2. **Boost** â€” due on the same launch date.
  3. **Report** â€” due three Johannesburg business days after the boost launch. Business days are Mondayâ€“Friday.
- Imported Post, Boost and Report tasks default to the workspace Paid Media Owner until reassigned.
- The workspace also supports standalone **To-do** tasks, with optional delegation, so non-campaign responsibilities appear in the same workload overview.

## 3. What is implemented locally

### Product interface

- An internal single-page Project Manager interface with campaign tasks, standalone to-dos, a team workload overview, filters, task ownership, dates, status and task detail capture.
- A Circle-dashboard-inspired UI refresh: dark teal navigation shell, rounded white workspace, aqua/peach/sand analytics cards, responsive layouts and editorial typography. The visual work was guided by a frontend-design workflow while preserving the existing interaction IDs and application behaviour.
- â€œAdd taskâ€ supports tasks not tied to a campaign, as well as delegated work.
- Team view gives a practical overview of what each person is working on and task counts by assignee.

### Spreadsheet import and operational automation

- Spreadsheet preview/import logic for the supplied Shalâ€™Artem budget plan.
- Heading mapping for Date, Activation, Asset Type, Platform, Country, Duration, Objective, Budget, Actual Spend and Completion.
- Subtotal/total rows are ignored.
- Brand/market/platform eligibility is validated before tasks are created.
- Post â†’ Boost â†’ Report dependencies and due-date rules are generated automatically.
- Local demo persistence is available through browser storage. A Supabase persistence hook is also present for shared use after configuration.

### Supabase implementation

The existing **FluxPlanner-Pro** Supabase project is being reused. The following project-manager tables are now installed in its `public` schema:

- `pm_workspaces`
- `pm_members`
- `pm_campaigns`
- `pm_tasks`
- `pm_task_activity`
- `pm_sync_conflicts`
- `pm_reporting_mappings`
- `pm_notification_settings`
- `pm_meetings`
- `pm_workspace_snapshots`

Row Level Security is enabled on these tables. The initial policies are deliberately limited to authenticated Regency staff; before expanding beyond the internal team, replace these broad internal policies with explicit workspace-membership checks.

### Edge Functions

| Function | Purpose | Current state |
| --- | --- | --- |
| `report-sync` | Retrieve and normalise configured Supermetrics report data, with manual-report fallback | Source created; deployment still required |
| `dispatch-reminders` | Produce in-app/email reminder events; Teams is configuration-ready | Source created; deployment and schedule still required |
| `fluxplanner-sync` | Coordinate immutable activation/platform date updates and flag conflicts | Source created; deployment/integration still required |
| `granola-task-sync` | Turn Granola meeting actions into created or updated standalone tasks | **Deployed and active** in FluxPlanner-Pro |

### Granola meeting-note sync

The deployed `granola-task-sync` function accepts a meeting payload from an approved Granola automation or middleware. It:

1. Upserts the meeting into `pm_meetings` using the Granola meeting ID.
2. Accepts a structured `actions` array, or extracts actions from `ACTION:`, `TODO:` and `- [ ]` lines in the notes.
3. Matches an action owner to a Regency team member by display name when possible.
4. Creates a standalone `To-do`, or updates the matching one on a later sync instead of duplicating it.
5. Retains the source meeting and action keys for auditability.

The endpoint is:

```text
https://yqiufyruxwfnjlcwmfvy.supabase.co/functions/v1/granola-task-sync
```

It has custom request protection rather than Supabase JWT enforcement because it is designed for an external automation. It will reject requests unless the `x-granola-sync-secret` header matches the `GRANOLA_SYNC_SECRET` Supabase secret.

Example payload:

```json
{
  "workspaceId": "regency-shalina",
  "meetingId": "granola-meeting-unique-id",
  "title": "Shalâ€™Artem weekly status",
  "meetingDate": "2026-07-24T09:00:00+02:00",
  "notes": "ACTION: Sian: confirm post copy due 2026-07-28",
  "sourceUrl": "https://granola.ai/..."
}
```

The Codex Granola connection can read meeting notes during assisted work; it is not embedded in the product. Continuous syncing requires Granola to call this endpoint via its own automation capability or a small approved middleware service.

## 4. Technology used

| Area | Technology | Why it is used |
| --- | --- | --- |
| Front end | HTML, CSS, vanilla JavaScript modules | Lightweight internal tool with no build step required for the first release |
| Local server | Python static HTTP server | Allows ES modules to run locally; opening `index.html` directly via `file://` will not work reliably |
| Unit testing | Node.js built-in test runner | Tests the eligibility, business-day, task-generation and import-mapping rules without extra test dependencies |
| Shared backend | Supabase Postgres + Row Level Security | Reuses FluxPlanner infrastructure and supplies the shared data model |
| Server automation | Supabase Edge Functions using Deno and `@supabase/supabase-js` | Keeps privileged keys and third-party integrations out of the browser |
| Reporting | Supermetrics API design | Connects paid-media reporting queries with per-platform/per-market mappings; not yet configured with real credentials |
| Email | Resend design | Intended for transactional due/overdue reminders from a verified `regency.global` sender |
| Collaboration | GitHub repository | Version control and the shared source of record after local validation |
| Meeting integration | Granola + protected webhook-style Edge Function | Converts meeting actions into trackable, delegated Project Manager tasks |

## 5. Local-first working agreement

This project must follow this release order:

1. **Make and inspect the change locally** in `C:\Users\denyf\Documents\Codex\Project Manager`.
2. **Run targeted checks locally**: syntax checks, automated tests and browser verification where the UI changes.
3. **Review the files and result** before treating the work as ready.
4. **Push the verified source to GitHub** only after the local version is confirmed.
5. **Deploy backend changes deliberately** to Supabase, then validate the deployed function/table state.

This avoids GitHub becoming the place where untested work first appears and provides a recoverable, auditable workflow.

## 6. Validation completed

The local automated tests pass:

```text
4 tests passed, 0 failed
```

They verify:

- TikTok is blocked outside Nigeria and South Africa.
- Valid platform rows create linked Post, Boost and Report tasks.
- The report date skips weekends and lands three business days after boost launch.
- Import headings map correctly and total/subtotal rows are ignored.

The deployed Supabase verification confirms that the Project Manager tables exist and have RLS enabled, and that `granola-task-sync` is `ACTIVE` (version 1).

## 7. Errors and constraints encountered

| Situation | Cause | Resolution / current position |
| --- | --- | --- |
| Local app appeared not to work when opened directly | Browser security prevents module code from loading correctly through `file://` | Use `start-project-manager.bat` and open `http://localhost:4173` |
| Original GitHub command-line authentication failed | The local GitHub CLI token for the account was invalid | Used the authenticated GitHub connector with confirmed push permission; source is now in the supplied repository |
| Direct Supermetrics connection link was considered | It is an interactive connection URL, not a server-side API credential | It is not stored in the app; use API key and saved query IDs only as Edge Function secrets/configuration |
| Teams reminders are not active | IT approval and least-privilege channel permissions are still needed | Email and in-app reminder paths remain the first operational channels; Teams stays disabled until approved |
| A continuous Granola sync cannot be completed from the desktop connector alone | The connector can read meeting material but is not a background webhook service | The secure receiving function is deployed; configure Granola automation or middleware and the secret to activate it |
| Granola function cannot yet create real tasks | `GRANOLA_SYNC_SECRET` has not yet been stored in the Supabase project | Add the secret, configure the caller header, then send a test payload |
| Local documentation patching briefly hit a Codex usage limit | The tool environment temporarily rejected an edit request | This document was then created locally as the requested durable project record before publication |

## 8. Remaining work

### Required before the team uses shared production data

- [ ] Add real Regency staff to `pm_members` and map workflow role slots to them.
- [ ] Configure `config.js` with the FluxPlanner-Pro public Supabase URL and publishable key.
- [ ] Replace initial broad authenticated policies with workspace-membership RLS policies.
- [ ] Deploy and test `report-sync`, `dispatch-reminders` and `fluxplanner-sync`.
- [ ] Set `GRANOLA_SYNC_SECRET` in Supabase.
- [ ] Configure Granola automation/middleware to call `granola-task-sync` with the matching secret.
- [ ] Send one controlled Granola meeting payload and verify create, update, ownership matching and no-duplicate behaviour.
- [ ] Set up Resend, verify the Regency sender address and configure reminder schedules.
- [ ] Connect Supermetrics paid accounts, add API key as a Supabase secret, create saved queries and populate `pm_reporting_mappings`.
- [ ] Agree the FluxPlanner campaign/activation identifier contract, then test date changes in both directions and intentional conflict handling.

### Product improvements after the foundation

- [ ] Add authenticated login and per-user â€œMy tasksâ€ view.
- [ ] Add task comments, attachments and approval history.
- [ ] Add task recurrence for repeated monthly reporting or posting activities.
- [ ] Add a calendar/timeline view.
- [ ] Add richer notification preferences, escalation reminders and email templates.
- [ ] Add import error download/export and an activity audit view.
- [ ] Build a secure admin screen for Supermetrics mappings and role-slot assignments.
- [ ] Add a deployment pipeline and GitHub Actions checks.
- [ ] Perform an accessibility review of the refreshed interface with real Regency users.

## 9. How to run and test locally

From the project folder:

```powershell
./start-project-manager.bat
```

Open `http://localhost:4173` in a browser.

Run automated tests:

```powershell
node --test
```

Run a syntax check:

```powershell
node --check app.js
```

## 10. Key project files

| File | Responsibility |
| --- | --- |
| `index.html` | Application structure and UI skin |
| `styles.css` | Main application styles |
| `app.js` | Front-end state, interface behaviour, filters, tasks and imports |
| `lib/automation.js` | Task generation, validation, date and spreadsheet-mapping logic |
| `test/automation.test.js` | Automated business-rule tests |
| `supabase/schema.sql` | Project Manager data model and RLS setup |
| `supabase/functions/granola-task-sync/index.ts` | Deployed Granola task-sync function source |
| `supabase/functions/report-sync/index.ts` | Supermetrics reporting integration source |
| `supabase/functions/dispatch-reminders/index.ts` | Reminder dispatch source |
| `supabase/functions/fluxplanner-sync/index.ts` | FluxPlanner date/campaign sync source |

## 11. Immediate recommended next action

Set `GRANOLA_SYNC_SECRET` in the FluxPlanner-Pro Supabase project, then provide or configure the Granola automation/middleware endpoint credentials. Once that is done, run one test meeting through the endpoint and confirm the created task in the Project Manager task list. This is the shortest path from a deployed integration to a working, demonstrable Granola-to-task flow.

