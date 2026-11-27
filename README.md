# SyncSprint

Multi-tenant B2B project & Kanban workspace with strict tenant isolation, role-based access control (RBAC), real-time WebSocket sync, fractional indexing, optimistic concurrency control, immutable audit logs and free-tier AI — built with Next.js 16, TypeScript, Drizzle ORM, PostgreSQL and Better Auth.

> **Try it in 10 seconds:** run the app and click **Launch interactive demo** on `/`. You get a private "Acme Engineering" workspace with seeded teammates in every role. Use **Demo · act as role** in the sidebar to test RBAC, open a second tab to watch real-time sync, or click **Simulate teammate** to see live updates and conflict handling on your own.

**Workload & capacity:** owners/admins set working hours (workspace default 40h/week, per-person overrides, time off, holidays). Tasks carry hour estimates; the Workload view shows each person's load vs capacity per day across all projects, and assigning work to someone who would be over capacity shows a warning — it never blocks the assignment.

**Customization:** custom statuses, custom fields (text, number, dropdown, date, person), a Table view with inline editing, saved views with sort and group-by, co-assignees and watchers.

**Sprints:** backlog and sprint planning with drag-and-drop, sprint start/complete with carry-over, burndown, burnup and velocity charts, and Epic / Story / Task / Bug work item types.

**Work breakdown:** subtasks with progress roll-up, checklists, color-coded tags, and blocked-by / blocking dependencies (with arrows on the Timeline).

**Views** (ClickUp-style, all sharing one search/filter bar and live updates):
**Board** (drag-and-drop) · **List** (grouped by status) · **Calendar** (drag to reschedule) · **Timeline** (Gantt; drag or resize bars, baselines with slip, critical path) · **Dashboard** (KPIs, workload, created-vs-completed) · **Whiteboards** (notes, shapes, arrows, live task cards, and mind maps that turn into tasks).

**Enterprise & reach (Phase 9):** Microsoft and company SSO (OIDC/SAML) with domain verification, two-step sign-in (and "require it"), IP allow-lists, SCIM provisioning, audit export and retention, full workspace export; project and task templates; Ctrl/Cmd+K search; WIP limits, swimlanes, cumulative flow and cycle time; public intake forms; reminders; push (installable app), email, digests, WhatsApp, Slack/Teams/Discord/Google Chat alerts, a calendar feed and email-to-task; GitHub/GitLab links that close tasks on merge; and a free guest role for clients. Every outside channel is optional and configured in `.env` (see `.env.example`); without keys, messages land in a developer outbox.

**Visual planning:** a **Portfolio** page shows every project's health, progress against time, overdue work, sprint and status updates. **Scheduled automations** run before due dates, when work goes overdue, or every day / weekday / week at a set hour (set `CRON_SECRET` for the Vercel cron at `/api/cron/automations`).
See [ROADMAP.md](ROADMAP.md) for the phased plan toward ClickUp / Azure Boards parity.

---

## Quick start

```bash
npm install
cp .env.example .env          # then set BETTER_AUTH_SECRET
npm run dev                   # http://localhost:3000 (Next.js + WebSocket server)
```

With no further setup, `DATABASE_URL=pglite://./.pglite` runs an **embedded Postgres (PGlite)** on disk, and migrations are applied on boot. For a real database (Neon/Supabase free tiers work), set `DATABASE_URL=postgres://…`.

| Script | Purpose |
| --- | --- |
| `npm run dev` | Custom server (`server.ts`): Next.js + `/ws` WebSocket endpoint, auto-migrates |
| `npm test` | Vitest suite against an in-memory Postgres (no external DB needed) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` / `npm start` | Production build / server |
| `npm run db:generate` | Generate SQL migrations from `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Create a sign-in-able demo account (`demo@syncsprint.dev`) with a seeded workspace |

AI keys (`OPENROUTER_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GROQ_API_KEY`) are all optional. Without them, every AI feature falls back to deterministic logic.

---

## Architecture

```
+-----------------------------------------------------------------------------------+
|                                CLIENT (BROWSER)                                   |
|  Kanban / List views (@dnd-kit)   Presence bar + "editing…"   Activity feed       |
|  - fractional positions           - per-card soft locks       - filter by actor   |
|  - optimistic reducer + rollback  - reconnect → resync        - cursor paging     |
+----------------|----------------------------|------------------------|------------+
        Server Actions                 WebSocket /ws?orgId           RSC fetch
                 |                            |                        |
+----------------v----------------------------v------------------------v------------+
|                               SERVER (server.ts)                                  |
|  requireOrgPermission()      RealtimeHub (globalThis)       AI router             |
|  actor = session, never      room = org:{orgId}             OpenRouter → Gemini   |
|  the payload                 handshake: cookie + member     → Groq → fallback     |
+----------------|----------------------------^------------------------|------------+
                 |  db.transaction(): OCC UPDATE + audit row           |
                 v                            | broadcast after commit |
+-----------------------------------------------------------------------------------+
|  PostgreSQL (Drizzle)                                                             |
|  organizations 1─* org_members *─1 users      organizations 1─* org_invites       |
|  organizations 1─* projects 1─* board_columns 1─* tasks 1─* task_comments         |
|  organizations 1─* audit_logs                 organizations 1─* ai_usage (quota)  |
+-----------------------------------------------------------------------------------+
```

### Data model

Every workspace table carries `organization_id`, with composite indexes that lead with it (`(organization_id, project_id)`, `(organization_id, created_at)`, …). Tasks have a `double precision` **position** and an integer **version**. `projects.task_counter` mints `ENG-1, ENG-2…` atomically with `UPDATE … RETURNING`, so there is no `MAX()+1` race. Better Auth's `users / sessions / accounts / verifications` tables live in the same schema (`src/db/schema.ts`).

---

## Engineering decisions

### 1. Tenant isolation and RBAC: one guard, enforced on the server
`src/lib/rbac.ts` → `requireOrgPermission(userId, orgId, minRole)` runs first in every service. The role hierarchy is `owner (4) > admin (3) > member (2) > viewer (1)`.

- **The actor comes from the session cookie, never from the payload.** No server action accepts a `userId`.
- **Passing the membership check isn't enough.** Each query is also filtered by `organization_id`, so sending your own org id with another tenant's task or column id returns `NOT_FOUND` (the "id smuggling" tests cover this).
- A missing org and someone else's org return the **same** error (and pages return 404), so slugs can't be probed.
- Ownership rules: only owners grant or revoke `owner`, and the last owner can never be demoted or removed.
- The UI hides controls for convenience only. The server is the authority, and the demo role switcher rewrites the *real* membership row.

### 2. Fractional indexing (`src/lib/fractional-index.ts`)
A drop computes the midpoint between its neighbours, so **exactly one row is written per move**. When a gap falls below `0.001`, the server re-spaces that column (`1024, 2048, …`) inside the same transaction and broadcasts `COLUMN_REBALANCED`. This takes about 20 consecutive inserts at the same spot, so rebalances are rare and the cost amortises to O(1).

### 3. Optimistic concurrency and an atomic audit log (`src/server/services/tasks.ts`)
```sql
UPDATE tasks SET …, version = version + 1
 WHERE id = $id AND organization_id = $org AND version = $expectedVersion
RETURNING *;   -- 0 rows → { ok: false, code: "VERSION_CONFLICT", current }
```
The version bump and the `audit_logs` insert share one `db.transaction()`. A rejected write leaves no audit row. Edits record exact `{from, to}` values; the "before" snapshot is guaranteed correct because the version matched.

### 4. Real-time sync
- `server.ts` hosts Next.js and a `ws` server on one port. The handshake validates the Better Auth cookie, the **Origin** header (to block cross-site WebSocket hijacking) and org membership before the socket joins `org:{orgId}`.
- Events are published only **after commit**, so peers never see writes that might roll back.
- Clients ignore stale or duplicate packets (`incoming.version <= local.version`). After a reconnect they re-fetch a snapshot, because missed events are not replayed.
- Presence (`{projectId, activeTaskId, editing}`) is ephemeral and never written to Postgres. Removing a member evicts their live sockets.
- **Several servers?** Set `REALTIME_FANOUT=postgres` (with a direct, unpooled `DATABASE_URL_UNPOOLED`): each instance delivers to its own sockets and relays to the others over Postgres `LISTEN/NOTIFY`. Task events too big for a NOTIFY payload (8 KB) are sent as a reference and re-read from the database by the receiver.

### 5. Optimistic UI and rollback
Drag → the reducer moves the card immediately → the server action runs. On `VERSION_CONFLICT` the client restores the server's row, re-syncs the board and shows a toast explaining **what** changed (for example *"Alex moved ENG-4 to Review and changed priority from medium to high 12s ago"*). The task drawer keeps your unsaved edits on conflict and offers "load their version".

### 6. $0 AI with guardrails (`src/lib/ai-router.ts`, `src/server/ai/features.ts`)
| Feature | Where |
| --- | --- |
| Subtask decomposer (3–6 subtasks + story points, one-click add) | Task drawer |
| Standup / sprint digest from the board + audit log | "AI standup" |
| Triage: suggested priority + starting column, user can override | New task dialog |
| Conflict and change explainer | Conflict toasts |

- Providers are tried in order: OpenRouter `openrouter/free` → Gemini `gemini-2.5-flash-lite` → Groq `openai/gpt-oss-20b`. `maxRetries: 0` plus a timeout, so the next provider *is* the retry. Output is validated with Zod; any failure falls through to a **deterministic fallback**.
- **Tenant scope before prompting:** context is queried only after RBAC and only for that `organization_id`.
- **Prompt-injection fencing:** user text is wrapped in `<task_input>` tags (attempts to close the tag are stripped) and the model is told to treat it as data.
- **Per-org daily quota** (`ai_usage`, an atomic UPSERT) stops one visitor from draining the shared free tier.
- The conflict explainer only **rephrases facts from the audit log**; it never invents changes.

---

## Tests (`src/tests`, 236 tests)

Each file gets a fresh in-memory PGlite Postgres, migrated from the real SQL migrations.

- **Tenant isolation:** cross-org reads and writes are rejected, id smuggling returns `NOT_FOUND`, cross-tenant assignees are refused, and audit rows stay inside their tenant.
- **RBAC:** viewers can't create, move, edit, delete, comment or use AI; members can't change roles, invite or create projects; admins can't grant ownership; the last-owner invariant holds; invites are email-bound and single-use.
- **Concurrency:** a stale version gets `VERSION_CONFLICT` with no side effects; of two simultaneous writers exactly one wins; edits record before/after values; conflict explanations come from audit facts.
- **Fractional indexing:** a move updates only one row, rebalancing triggers and keeps order, and task numbers stay sequential under concurrency.
- **Capacity:** even spreading over working days, weekends/time off skipped, multi-assignee split (including when only one person is computed), overdue work lands on today, remaining days only, part-time overrides, workspace holidays, per-day-first status, work on a non-working day, unestimated/undated counts, thresholds, viewer-local "today" within ±1 day, admin-only settings, tenant isolation, warnings returned without blocking, co-assignee rebalancing clears a warning, time off creating an overload, quarter-hour estimates, demo seed.
- **Customization:** statuses (add before Done, Done stays last, rename/recolor, delete with task move, tenant isolation), custom fields (per-type validation, clearing, option removal clears values, cross-project/tenant refusal), co-assignees, watchers (viewers allowed), saved views (personal vs shared, owner/admin edit rules, view validation).
- **Sprints:** admin-only lifecycle, default naming and dates, start-early moves dates to today, one active sprint per project (service check + partial unique index), snapshots updated by moves, point edits, sprint changes and deletes, report series with ideal line, completion with carry-over, velocity, frozen completed sprints, tenant/project isolation, work item type validation, demo seed.
- **Work breakdown:** subtasks are one level deep, same project and tenant, and cascade on delete; checklist roll-up and permissions; tags are per-tenant and case-insensitive; dependency cycles, duplicates, cross-tenant links and self-links (also blocked by a database CHECK) are rejected; the demo seed produces consistent data.
- **Planning:** start/due/points validation (incl. impossible dates and partial edits checked against the stored row), reschedule under OCC, viewer can't reschedule, dashboard series counts + tenant isolation, UTC date maths, filters.
- **Collaboration:** notifications skip the actor, dedupe per person (mention beats comment), never reach other tenants, fire on assignment / reassignment / new co-assignees / Done; inbox is personal and mark-read only touches your own; manager capacity alerts once per person per day; one running timer (service + unique index), manual entries, totals, delete rules; attachment name/type sanitising, size limits, membership-checked reads, uploader/admin delete; docs search, task links, OCC conflict on concurrent saves; goal progress for numeric (incl. decreasing) and task-based key results; mention encoding and duration parsing; demo seed.
- **Automation:** trigger matching, admin-only management, references checked against the project/tenant, actions in one change (assign the mover, tag, labelled comment, notify), conditions and disabled rules, no automation loops while Done side effects still happen, failed runs when a target was deleted, automation-set assignees get notified; recurring date maths (weekdays, month-end clamp, catch-up), next occurrence copies people/tags/unchecked checklist and moves the rule, no duplicates on re-completion.
- **Integrations:** API keys (hash only, revoke, orphaned keys), rate limiting; REST routes end to end (auth, read-only scope, create by status name and assignee email, get by ref, move + edit with `expectedVersion` → 409 on stale, unknown fields rejected, comments, filtered list, delete, tenant isolation, demoted owner loses write); webhook SSRF guards (private/loopback/link-local/metadata, http, credentials, odd ports), signature verify incl. replay window, subscribed delivery, auto-off after 15 failures, redirects not followed; CSV parsing and formula neutralising, Jira preview mapping with warnings, atomic import with parents and labels, export round trip, limits; sprint capacity; cross-instance realtime fan-out with oversized-event reload.
- **Billing & business:** lifecycle states (trial, grace, read-only, locked, ending, canceled, suspended, comped, demo), prices and plan fit, seat limits with 7-day grace, the guard refusing writes when read-only and everything when locked (billing still reachable by admins), viewers free, Polar Standard Webhooks signatures (tamper, replay, wrong secret), webhook idempotency, past-due → grace → recovery → revoked, manual suspension never lifted by a payment, dev simulator, platform owner detection (ids, verified emails in production), provisioning without membership, support access read-only and revocable; groups (admin/lead rules, cross-tenant refusals, queue, tracking, @group mentions, automations), share links (admin-only, scopes, hashing, no emails, revoke/expiry/lock, password + rate limit).
- **Visual planning:** critical path (chains, slack, weekends, finished blockers, cycles), baselines (admin only, slip in days, limits), portfolio health and tenant isolation, scheduler (time zones, each occasion fires once, conditions checked first, weekly schedules, paused while read-only, lease), whiteboards (versions and conflicts, arrows and branches removed with their items, note → task, mind-map branch → task with subtasks).
- **Security (Phase 9):** IP allow-list parsing (v4/v6/CIDR) and enforcement per request, require-2FA, lockout protection, audit retention and CSV formula safety, export without secrets, SSO domain proof and "require SSO", SCIM create/filter/deactivate/last-admin/tenant scoping.
- **Templates & search:** built-in and saved project templates (statuses, WIP, fields, tags, subtasks, checklists), cleanup on failure, task templates, onboarding, Ctrl+K search by ref/title with tenant isolation and literal % _.
- **Board power:** WIP limit rules, flow analytics (pure + from audit log), intake forms (validation, tags, custom fields, notifications, honeypot, rate limit, read-only pause, link rotation), reminders (once only, personal).
- **Reach:** sealed secrets, chat URL host allow-list, per-project delivery, auto-off, notification fan-out once per preference, digests, ICS feed (escaping, folding, rotation), inbound email (provider shapes, quoted replies, members only), GitHub/GitLab signatures, linking, auto-close on merged "fixes", re-delivery idempotence, cross-tenant safety.
- **Guests:** free, invitable, refused by regular services, per-project access, comments only in their projects.
- **Units:** midpoint maths, prompt-injection fencing, AI fallback, keyword triage, and the client reducer ignoring stale packets.

---

## Project layout

```
server.ts                     Next.js + WebSocket server (auto-migrates on boot)
drizzle/                      SQL migrations
src/db/                       schema, driver (postgres-js | PGlite), migrate, seed
src/lib/                      rbac, fractional-index, ai-router, auth, errors, realtime protocol
src/server/services/          tenant-scoped business logic (tasks, workspace, demo)
src/server/ai/                AI features + quota
src/server/realtime-hub.ts    org rooms / presence fan-out
src/server/ws-server.ts       authenticated WebSocket handshake
src/actions/                  thin "use server" wrappers: session → service → broadcast
src/app/                      routes: /, /sign-in, /w/[orgSlug]/{projects/[key],activity,settings/members}, /invite/[token]
src/components/board/         Kanban + List views, drawer, AI panels, realtime hook, reducer
src/tests/                    Vitest suite
```

## Notes and trade-offs
- **PGlite** is for zero-setup local development and tests. It is single-process, so use Postgres for anything shared or deployed. Stop the dev server with **Ctrl+C**: the server closes PGlite cleanly so it writes a final checkpoint. A hard kill can leave `.pglite` unable to restart; if that happens, move the folder aside and restart (it is recreated and re-migrated).
- **Dates** are stored as date-only `YYYY-MM-DD` and computed in UTC, so a due date never shifts a day between time zones.
- **Chart colors** (status palette) were checked with a palette validator for colorblind separation and contrast; every chart also has a table view.
- The WebSocket server needs a long-lived Node process (Railway, Fly, Render, a VM). On serverless hosting, swap the hub for a managed pub/sub such as PartyKit, Ably or Supabase Realtime.
- UI primitives are hand-rolled in the shadcn/ui style (`src/components/ui`) rather than generated by the CLI.
