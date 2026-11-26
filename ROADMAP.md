# SyncSprint → ClickUp / Azure Boards parity roadmap

The goal is to grow SyncSprint toward ClickUp-level visualization and planning one phase at a time.
Each phase ships in a working state with tests and keeps the core guarantees: tenant isolation, server-side RBAC, optimistic concurrency, an atomic audit log and real-time sync.

Legend: ✅ done · 🚧 in progress · ⬜ planned

---

## Phase 0 — Foundation ✅
- ✅ Workspaces (tenants), members, roles (owner/admin/member/viewer), invites
- ✅ Projects ("Spaces") with status columns
- ✅ Tasks: title, description, priority (flags), assignee, comments
- ✅ **Board view** (drag-and-drop, fractional ordering) and **List view** grouped by status
- ✅ Real-time presence, "editing…" indicators, live updates, conflict rollback
- ✅ Activity / audit log with filters
- ✅ AI: subtask breakdown, triage, standup digest, conflict explainer

## Phase 1 — Planning & visualization ✅
- ✅ Task **start date**, **due date**, **story points** (sizing, like Azure Boards "effort")
- ✅ Overdue / due-soon indicators on cards and rows
- ✅ **Search + filter bar** (text, assignee, priority, "me", hide done), shared by every view
- ✅ **Calendar view**: month grid by due date, drag a task to reschedule, unscheduled tray
- ✅ **Timeline (Gantt) view**: bars from start → due, today marker, grouped by status
- ✅ **Dashboard view**: KPIs, status/priority breakdown, workload by assignee, points, 14-day activity
- ✅ View is kept in the URL (`?view=calendar`) so links are shareable

## Phase 2 — Work breakdown ✅
- ✅ **Subtasks** (one level deep, same project) with roll-up progress on the parent card
- ✅ **Checklists** inside tasks, with progress on cards
- ✅ **Tags** (workspace-wide, case-insensitive, colored) with a tag filter
- ✅ **Dependencies**: blocked by / blocking, cycle prevention, "Blocked" badges
- ✅ **Dependency arrows** on the Timeline (red when the blocked task starts before its blocker ends)
- ↪ Multiple assignees and watchers moved to Phase 4 (they change the core task model)

## Phase 3 — Sprints & Agile (Azure Boards style) ✅
- ✅ **Sprints** with goal and dates; planned → active → completed; one active sprint per project (also enforced by a partial unique index)
- ✅ **Sprints view**: drag tasks between backlog and sprints; start early (moves dates to today); complete with carry-over to backlog or the next sprint
- ✅ **Daily snapshots** recorded in the same transaction as every task change
- ✅ **Burndown** (remaining vs ideal) and **burnup** (scope vs completed), with table view
- ✅ **Velocity** (committed vs completed per sprint)
- ✅ **Work item types**: Epic, Story, Task, Bug (icons, picker, filter). Hierarchy uses subtasks (one level); a deeper Epic → Feature → Story tree is a later step
- ⬜ Sprint capacity per person (moved to Phase 6 with the Workload view)

## Phase 4 — Customization, workload & capacity ✅
- ✅ **Custom statuses** per project: add (before Done), rename, recolor, reorder, delete with task move. The last status always means Done
- ✅ **Custom fields**: text, number, dropdown (colored options), date, person — validated per type
- ✅ **Table view**: spreadsheet-style inline editing of every field, sortable columns
- ✅ **Saved views** (personal or shared) with filters, sort and List group-by (status, assignee, priority, type, sprint)
- ✅ **Multiple assignees** (co-assignees) and **watchers**
- ✅ **Workload & capacity** (researched against Azure Boards, ClickUp, Asana, Jira, Wrike, Smartsheet):
  - owners/admins set a workspace schedule (default Mon–Fri 8h = 40h/week), per-person hours per weekday, time off and workspace holidays
  - tasks get hour estimates, spread evenly over the assignee's working days and split between assignees; done work doesn't count; overdue work lands on today
  - load counts across all projects; checked per day first (a 12h day is over even if the week fits)
  - near (≥ 85%, configurable) and over (> 100%) shown with icon + text, never color alone
  - **warnings never block**: assignee pickers show this week's load, forms show a heads-up before saving, and saves return a warning naming the day and the overage
  - **Workload view**: people × days grid with load vs capacity, task breakdown per cell, unestimated / undated counts

## Phase 5 — Collaboration & productivity ✅
- ✅ **Inbox**: notifications for @mentions, assignments (incl. co-assignees), comments on tasks you own or watch, and tasks reaching Done. Never notifies the person who acted; one notification per person per event (a mention beats a plain comment); only current members of the workspace receive anything. Unread badge in the sidebar, live toast, mark one/all read, filters
- ✅ **Workload alerts**: when an assignment pushes someone over capacity, owners and admins are notified, at most once per person per day (database-enforced dedupe). The assignment itself is still never blocked
- ✅ **@mentions**: type @ in a comment to pick a teammate; mentions are highlighted (yours stand out)
- ✅ **Time tracking**: start/stop timer (one running timer per person, enforced by a partial unique index; starting another stops the first), manual entries ("1h 30m", "45m", "1:15"), tracked vs estimate bar, running timer pill in the sidebar. Only the author or an admin deletes an entry
- ✅ **Attachments**: up to 4 MB per file, 200 MB per workspace, stored in Postgres so they work on serverless hosts. Membership checked on every download; only raster images render inline, everything else is forced to download with `nosniff` and a sandbox CSP
- ✅ **Docs**: markdown wiki pages (tables, checklists, code) rendered without raw HTML; live preview, autosave, and conflict-safe saving (a second writer gets a choice instead of overwriting); link pages to tasks, shown in the task drawer
- ✅ **Goals / OKRs**: key results measured by a number (supports decreasing targets, e.g. latency) or by linked tasks finished; goal progress is the average of its key results. Admins set goals, members check in values and link work
- ✅ `?task=` links open a task's drawer directly (used by notifications, docs and goals)

## Phase 6 — Automation & scale ✅
- ✅ **Automations** per project: *when* a task is created / its status, assignee or priority changes, *if* priority / type / assignee / tag match, *then* move, assign (including "whoever made the change"), set priority, tag, set a due date, comment or notify. Plain-English summaries, templates, on/off switch, run history
  - run inside the same transaction as the change; an automation's own changes never trigger other automations (no loops); a rule whose status/person/tag was deleted records a failed run and the person's change still saves
  - automation comments are labelled with the rule, not a person
- ✅ **Recurring tasks** (daily, weekdays, weekly, monthly, every N): finishing one creates the next with dates moved forward (start keeps its distance to due, monthly clamps to month end, late completions skip ahead), carrying over people, tags and an unchecked checklist. The rule moves to the new task, so re-completing never duplicates
- ✅ **Sprint capacity** (Azure Boards style): hours each person has in the sprint (schedule − time off − holidays) vs open estimated work assigned to them, split between co-assignees; unassigned work called out; over-commitment flagged, never blocked
- ✅ **CSV export and import**, Jira-compatible: maps Summary / Issue Type / Status / Priority / Assignee (email or name) / Labels (repeated columns) / Story Points / Original Estimate (seconds) / dates (ISO or Jira format) / Parent; preview with per-row warnings before anything is created; one transaction; formula-injection-safe export; round-trips with our own export
- ✅ **REST API** `/api/v1`: personal API keys (hashed, shown once, read or read & write, act as their creator and lose access when the creator does), 120 req/min per key, consistent JSON errors, tasks by id or `ENG-12`, status by name, `expectedVersion` for safe concurrent updates. Same services as the app, so RBAC, OCC, audit, automations and realtime all apply
- ✅ **Webhooks**: `task.created`, `task.updated`, `task.deleted`, `comment.created`, signed with HMAC-SHA256 (`SyncSprint-Signature: t=…,v1=…`), delivered after the response (Next `after`), https + public addresses only (checked after DNS, again at delivery), no redirects, 5 s timeout, delivery log, test button, auto-off after 15 failures
- ✅ **Horizontal realtime**: optional Postgres `LISTEN/NOTIFY` fan-out (`REALTIME_FANOUT=postgres`) so several app servers share live updates; oversized task events are re-read from the database by receivers

## Phase 7 — Business: roles, groups, billing, sharing ✅
- ✅ **Roles**: the customer's top role is **Admin** (the person the workspace is handed to; adds members, manages billing). Existing owners were migrated to admin; the last admin can never be removed or demoted. Members do the work; **viewers** see everything, change nothing, and are free
- ✅ **Platform owner** (the vendor) is not a workspace role. Recognised by `PLATFORM_ADMIN_USER_IDS` or `PLATFORM_ADMIN_EMAILS` (verified emails only in production). Console at `/platform`: every company's plan, status, seats and revenue; suspend / reactivate, extend trial or grace, complimentary plan, cancel at period end or now, provision a company with an admin invite, event history. No access to customer work unless the company's admin turns on time-limited, read-only **support access**
- ✅ **Plans** (about half the price of ClickUp, Jira, Asana, monday.com): Pay as you go $5/person/month; Team (1-50) $3.50/person/month yearly; Business (51-100) $3/person/month yearly; viewers free; 14-day trial; above 100 contact us
- ✅ **Billing lifecycle**: trial → active; failed payment → 7-day grace (full access, banner) → read-only for 14 days (view and export) → locked (admins can still reach Billing); canceled → access until the paid period ends; platform suspension locks at once and is never lifted by a payment; data kept 90 days after locking. Enforced in the one server-side guard every action and the API go through; outgoing webhooks pause too
- ✅ **Seats**: admins and members are paid seats; going over a plan's limit gives a 7-day grace with an upgrade prompt, then paid invites are refused; the subscription's seat count follows the team automatically (prorated)
- ✅ **Polar** (merchant of record: tax, invoices, payouts incl. Pakistan): hosted checkout for seat-based products, customer portal, seat sync, Standard Webhooks signature verification, idempotent event handling, billing history. A local-only simulator runs the same code without a card
- ✅ **Groups** (QA, Developers, Marketing...): lead + members, admins or the lead manage members; assign tasks to a group (its queue until someone takes them); @group mentions notify everyone; group pages track open work, queue, overdue, finished per week, hours logged and this week's workload; automations can filter by and send to a group
- ✅ **Share links**: read-only links for people without an account. Admin-only, one project by default or the whole workspace on purpose, optional expiry and password (scrypt, 10 tries per 15 minutes), optional comments, hashed tokens, view counts, revocable; never shows emails; no indexing, framing or referrer leaks; stop working while a workspace is locked

## Phase 8 — Visual planning ✅
- ✅ **Gantt baselines**: admins save a snapshot of every dated task (up to 10 per project); the Timeline draws the saved plan as a grey bar under each task, a +Nd / −Nd chip where dates moved, and a "vs. baseline" summary (how many slipped, worst slip)
- ✅ **Critical path** (CPM in working days over open tasks and "blocked by" links): toggle on the Timeline to highlight the chain in red, dim everything with slack, show slack per task in its tooltip and the earliest possible finish date
- ✅ **Portfolio** (`/w/…/portfolio`): every project on one page with health worked out from the data (on track / at risk / late / done / not scheduled), progress against time used, open and overdue work, points, dates, active sprint, and admin-written status updates (on track, at risk, off track, on hold, complete + note)
- ✅ **Scheduled automations**: "a due date is coming up" (N days before), "a task becomes overdue", and "on a schedule" (every day / weekday / chosen weekday at an hour in the creator's time zone). Each firing is recorded once (rule + task + occasion) so retries and several servers never double-fire; paused while a workspace is read-only or locked; runs every minute on a long-running server, from a Vercel cron (`/api/cron/automations`, `CRON_SECRET`), and is nudged by active users on serverless
- ✅ **Whiteboards** (new project view): sticky notes, rectangles, ellipses, text, arrows that follow the items they connect, and live task cards; pan / zoom, colours, resize; turn any note into a task (the card then shows the live task). Every item is versioned so two people dragging the same note never overwrite each other silently
- ✅ **Mind maps**: automatic left-to-right layout, Tab adds a child, Enter a sibling, collapse branches; "branch to tasks" turns each branch into a task and the ideas under it into subtasks (safe to run again after adding ideas)
- ✅ **Breadcrumbs** on every workspace page (workspace › section › page)

## Phase 9 — Enterprise & reach (proposed)
- ⬜ SSO (SAML / OIDC) and SCIM user provisioning
- ⬜ Mobile-friendly PWA with offline read and queued edits
- ⬜ Advanced reporting: custom dashboards and scheduled email reports
- ⬜ Slack / Teams / GitHub integrations (link PRs to tasks, notifications to channels)
- ⬜ Data residency and audit-log export for compliance
