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

## Phase 4 — Customization
- ⬜ Custom statuses per project (add/rename/reorder/color columns)
- ⬜ **Custom fields** (text, number, dropdown, date, people)
- ⬜ Table view (spreadsheet-like inline editing)
- ⬜ Saved views and filters per user, with group-by and sort options
- ⬜ Multiple assignees, watchers

## Phase 5 — Collaboration & productivity
- ⬜ @mentions + in-app notifications inbox
- ⬜ Time tracking (start/stop timer, estimates vs actuals)
- ⬜ File attachments
- ⬜ Docs / wiki pages linked to tasks
- ⬜ Goals / OKRs with progress from linked tasks

## Phase 6 — Automation & scale
- ⬜ Automations ("when status changes to Done → notify / assign / move")
- ⬜ Recurring tasks
- ⬜ Workload view (capacity per person per week)
- ⬜ Mind map / whiteboard view
- ⬜ Public API + webhooks, import from CSV/Jira
- ⬜ Horizontal scaling of real-time (Redis / Postgres LISTEN-NOTIFY)
