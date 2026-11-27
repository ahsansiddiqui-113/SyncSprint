/**
 * The "How it works" tour, head to toe. Each slide names the screen to draw,
 * the spot to point at (a data-spot inside that screen) and where to find it in the real app.
 */
export type Screen =
  | "signup" | "workspaces" | "home" | "palette" | "newProject"
  | "board" | "boardWip" | "boardLanes" | "boardFilters" | "boardLive"
  | "drawer" | "list" | "table" | "sprints" | "calendar" | "timeline" | "workload" | "dashboard" | "whiteboards"
  | "automations" | "forms" | "email" | "more" | "customize"
  | "docs" | "goals" | "portfolio" | "groups" | "activity" | "inbox"
  | "members" | "guest" | "integrations" | "share" | "security" | "billing"
  | "account" | "accountSecurity" | "notifications" | "calendarFeed";

export type Slide = {
  id: string;
  title: string;
  body: string;
  where: string[];
  screen: Screen;
  spot: string;
  url: string;
};

export type Chapter = { id: string; title: string; color: string; slides: Slide[] };

export const CHAPTERS: Chapter[] = [
  {
    id: "start",
    title: "Getting started",
    color: "#7b68ee",
    slides: [
      { id: "sign-up", title: "Create your account", body: "Sign up with Google, Microsoft or your email. If your company uses single sign-on, choose \"Sign in with company SSO\" and use your work email.", where: ["syncsprint.app", "Sign up"], screen: "signup", spot: "oauth", url: "/sign-up" },
      { id: "workspace", title: "Make a workspace", body: "A workspace is your company's home. Everything inside it — projects, docs, goals, people — belongs to that workspace only. You can belong to several and switch any time.", where: ["Your workspaces", "Create workspace"], screen: "workspaces", spot: "create-ws", url: "/w" },
      { id: "home", title: "Your workspace home", body: "Home is where you land. The getting-started checklist walks you through the first steps, and below it you see your projects and the work assigned to you.", where: ["Sidebar", "Home"], screen: "home", spot: "checklist", url: "/w/acme" },
    ],
  },
  {
    id: "find",
    title: "Finding your way",
    color: "#49ccf9",
    slides: [
      { id: "switcher", title: "The workspace switcher", body: "The top of the sidebar shows which workspace you are in. Click it to jump to another workspace or see all of them.", where: ["Sidebar", "Top"], screen: "home", spot: "switcher", url: "/w/acme" },
      { id: "sidebar", title: "The main menu", body: "Home, Inbox, Docs, Portfolio, Goals, Groups and Activity cover the whole workspace. The number on Inbox is how many notifications you haven't read.", where: ["Sidebar", "Main menu"], screen: "home", spot: "nav", url: "/w/acme" },
      { id: "spaces", title: "Spaces are your projects", body: "Every project is listed under Spaces with its task count. Click one to open its board. The + button creates a new project.", where: ["Sidebar", "Spaces"], screen: "home", spot: "spaces", url: "/w/acme" },
      { id: "search", title: "Search everything with Ctrl+K", body: "Press Ctrl+K (Cmd+K on Mac) anywhere. Type a task name or a key like ENG-12, a project, a doc, a goal, a person or a page, then press Enter to go there.", where: ["Sidebar", "Search", "or Ctrl+K"], screen: "palette", spot: "palette", url: "/w/acme" },
      { id: "settings-menu", title: "Workspace settings", body: "Admins see a Workspace section in the sidebar: Members, Billing & plan, Share links, Integrations and Security. Members only see Members.", where: ["Sidebar", "Workspace"], screen: "home", spot: "settings", url: "/w/acme" },
    ],
  },
  {
    id: "projects",
    title: "Projects",
    color: "#ff9800",
    slides: [
      { id: "new-project", title: "Start from a template", body: "Create a project from scratch or from a template: Scrum, Bug tracking, Marketing campaign, Client onboarding or Product roadmap. Templates bring their statuses, fields, tags and starter tasks.", where: ["Home", "New project"], screen: "newProject", spot: "template", url: "/w/acme" },
      { id: "project-header", title: "The project toolbar", body: "At the top of every project: the breadcrumb back to the workspace, who else is looking right now, and the buttons for Customize, Automate, more actions, AI standup, templates and Add Task.", where: ["Spaces", "Engineering", "Top bar"], screen: "board", spot: "toolbar", url: "/w/acme/projects/ENG" },
      { id: "views", title: "One project, many views", body: "The tabs under the title show the same tasks in different ways: Board, List, Table, Sprints, Calendar, Timeline, Workload, Dashboard and Whiteboards. Switching never loses anything.", where: ["Project", "View tabs"], screen: "board", spot: "views", url: "/w/acme/projects/ENG" },
      { id: "customize", title: "Make it yours", body: "Customize lets you rename and reorder statuses, pick their colours, set WIP limits, and add custom fields such as Client, Budget or Story type.", where: ["Project", "Customize"], screen: "customize", spot: "custom-fields", url: "/w/acme/projects/ENG" },
    ],
  },
  {
    id: "board",
    title: "The board",
    color: "#2db87d",
    slides: [
      { id: "board-drag", title: "Drag cards across", body: "Each column is a status. Drag a card to the next column to move it forward. Everyone else sees the move instantly — no refresh.", where: ["Project", "Board"], screen: "board", spot: "card", url: "/w/acme/projects/ENG" },
      { id: "wip", title: "WIP limits", body: "A column can have a limit on how many tasks it holds. When it's full the counter turns amber, then red — a nudge to finish work before starting more. It never blocks you.", where: ["Board", "Column header"], screen: "boardWip", spot: "wip", url: "/w/acme/projects/ENG" },
      { id: "swimlanes", title: "Swimlanes", body: "Split the board into rows by assignee, priority or type. Drag a card to another row and that field changes too — a quick way to hand work over.", where: ["Board", "Swimlanes"], screen: "boardLanes", spot: "lanes", url: "/w/acme/projects/ENG" },
      { id: "filters", title: "Filters and saved views", body: "Filter by person, priority, tag, sprint or due date. Group and sort, then save the setup as a view — just for you or shared with the team.", where: ["Board", "Filter bar"], screen: "boardFilters", spot: "filters", url: "/w/acme/projects/ENG" },
      { id: "live", title: "Working live together", body: "The green dot means you're connected. Faces in the top bar show who else is in this project, and their changes appear as they make them.", where: ["Project", "Top bar"], screen: "boardLive", spot: "presence", url: "/w/acme/projects/ENG" },
    ],
  },
  {
    id: "tasks",
    title: "Inside a task",
    color: "#e44a8a",
    slides: [
      { id: "drawer", title: "Open any task", body: "Click a card to open its panel on the right. Set status, assignee, sprint, dates, estimate, priority and custom fields. Every change saves by itself.", where: ["Click a card", "Task panel"], screen: "drawer", spot: "fields", url: "/w/acme/projects/ENG?task=ENG-12" },
      { id: "subtasks", title: "Subtasks and checklists", body: "Break big work into subtasks (each a real task) or a simple checklist. The progress bar fills as items are ticked.", where: ["Task panel", "Break into subtasks"], screen: "drawer", spot: "subtasks", url: "/w/acme/projects/ENG?task=ENG-12" },
      { id: "time", title: "Track time", body: "Start the timer on a task and it keeps running in the sidebar while you work anywhere else. Logged time rolls up to sprints and the workload view.", where: ["Task panel", "Time"], screen: "drawer", spot: "timer", url: "/w/acme/projects/ENG?task=ENG-12" },
      { id: "remind", title: "Remind me", body: "Set a reminder for later today, tomorrow or a date you pick. It lands in your inbox — and by push or email if you turned those on.", where: ["Task panel", "Remind me"], screen: "drawer", spot: "remind", url: "/w/acme/projects/ENG?task=ENG-12" },
      { id: "dev", title: "Development links", body: "Mention ENG-12 in a commit, branch or pull request on GitHub or GitLab and it shows up here. Merging a pull request that says \"fixes ENG-12\" moves the task to Done.", where: ["Task panel", "Development"], screen: "drawer", spot: "dev", url: "/w/acme/projects/ENG?task=ENG-12" },
      { id: "comments", title: "Comments and @mentions", body: "Talk about the work where it lives. Type @ to mention someone — they get a notification. The activity log under comments shows every change and who made it.", where: ["Task panel", "Comments"], screen: "drawer", spot: "comments", url: "/w/acme/projects/ENG?task=ENG-12" },
    ],
  },
  {
    id: "plan",
    title: "Planning views",
    color: "#f5a623",
    slides: [
      { id: "list", title: "List", body: "Tasks grouped by status (or assignee, priority, type, sprint) in neat rows. Great for scanning and quick edits.", where: ["Project", "List"], screen: "list", spot: "list", url: "/w/acme/projects/ENG?view=list" },
      { id: "table", title: "Table", body: "A spreadsheet of tasks with every field as a column, including your custom fields. Sort by any column and edit in place.", where: ["Project", "Table"], screen: "table", spot: "table", url: "/w/acme/projects/ENG?view=table" },
      { id: "sprints", title: "Sprints and capacity", body: "Plan sprints from the backlog. Capacity bars show each person's hours against their availability (time off included), and the burndown shows if you'll finish on time.", where: ["Project", "Sprints"], screen: "sprints", spot: "capacity", url: "/w/acme/projects/ENG?view=sprints" },
      { id: "calendar", title: "Calendar", body: "Tasks on their due dates, month by month. Drag a task to another day to reschedule it.", where: ["Project", "Calendar"], screen: "calendar", spot: "cal", url: "/w/acme/projects/ENG?view=calendar" },
      { id: "timeline", title: "Timeline", body: "A Gantt chart: bars from start to due date, arrows for dependencies. Save a baseline to compare against the plan, and the critical path in red shows what can't slip.", where: ["Project", "Timeline"], screen: "timeline", spot: "critical", url: "/w/acme/projects/ENG?view=timeline" },
      { id: "workload", title: "Workload", body: "Who has too much? Each person's hours per week, coloured from light to overloaded, so you can rebalance before anyone burns out.", where: ["Project", "Workload"], screen: "workload", spot: "workload", url: "/w/acme/projects/ENG?view=workload" },
      { id: "dashboard", title: "Dashboard and flow", body: "Charts for status, priority and people, plus flow analytics: cumulative flow, cycle time with 50th/85th percentiles, lead time and weekly throughput.", where: ["Project", "Dashboard"], screen: "dashboard", spot: "flow", url: "/w/acme/projects/ENG?view=dashboard" },
      { id: "whiteboards", title: "Whiteboards and mind maps", body: "Brainstorm with sticky notes, shapes and mind maps. Turn any sticky into a real task with one click.", where: ["Project", "Whiteboards"], screen: "whiteboards", spot: "canvas", url: "/w/acme/projects/ENG?view=whiteboards" },
    ],
  },
  {
    id: "workspace",
    title: "Across the workspace",
    color: "#7b68ee",
    slides: [
      { id: "inbox", title: "Inbox", body: "Mentions, assignments, reminders, form responses and pull-request news collect here. Mark them read one by one or all at once.", where: ["Sidebar", "Inbox"], screen: "inbox", spot: "inbox", url: "/w/acme/inbox" },
      { id: "docs", title: "Docs", body: "Write specs, meeting notes and wikis next to the work, and link the tasks they talk about.", where: ["Sidebar", "Docs"], screen: "docs", spot: "doc", url: "/w/acme/docs" },
      { id: "goals", title: "Goals", body: "Set goals with key results and link tasks to them. Progress updates by itself as the linked work gets done.", where: ["Sidebar", "Goals"], screen: "goals", spot: "goal", url: "/w/acme/goals" },
      { id: "portfolio", title: "Portfolio", body: "Every project on one page: progress, health, overdue work and dates — the view for managers and leads.", where: ["Sidebar", "Portfolio"], screen: "portfolio", spot: "portfolio", url: "/w/acme/portfolio" },
      { id: "groups", title: "Groups", body: "Teams of people, such as Design or Support. Send work to a group, see what nobody has picked up yet, and check each person's workload and logged time.", where: ["Sidebar", "Groups"], screen: "groups", spot: "group", url: "/w/acme/groups" },
      { id: "activity", title: "Activity", body: "A full history of what changed in the workspace, who changed it and when. Filter by person, project or kind of change.", where: ["Sidebar", "Activity"], screen: "activity", spot: "activity", url: "/w/acme/activity" },
    ],
  },
  {
    id: "automate",
    title: "Automate and connect",
    color: "#2db87d",
    slides: [
      { id: "automations", title: "Automations", body: "\"When a task moves to Review, assign it to Sam and post in Slack.\" Pick a trigger, add conditions and actions — or run it on a schedule, like every Monday at 9.", where: ["Project", "Automate"], screen: "automations", spot: "rule", url: "/w/acme/projects/ENG" },
      { id: "more-menu", title: "More project actions", body: "The ••• menu holds intake forms, email-to-task, CSV import and export, read-only share links and \"Save project as template\".", where: ["Project", "•••"], screen: "more", spot: "more-menu", url: "/w/acme/projects/ENG" },
      { id: "forms", title: "Intake forms", body: "Build a public form for bug reports or requests. Share the link — every response becomes a task in this project, with the status, assignee and tags you chose.", where: ["Project", "•••", "Forms"], screen: "forms", spot: "form-link", url: "/w/acme/projects/ENG" },
      { id: "email", title: "Email to task", body: "Each project has its own email address. Forward an email to it and it becomes a task, created as you, with the email as the description.", where: ["Project", "•••", "Email to task"], screen: "email", spot: "email-addr", url: "/w/acme/projects/ENG" },
      { id: "integrations", title: "Integrations", body: "Send alerts to Slack, Microsoft Teams, Discord or Google Chat. Connect GitHub or GitLab repositories. Developers get webhooks and API keys.", where: ["Sidebar", "Workspace", "Integrations"], screen: "integrations", spot: "chat", url: "/w/acme/settings/integrations" },
      { id: "share", title: "Share links", body: "Show a project to someone outside the company with a read-only link. Set an expiry, and turn it off any time.", where: ["Sidebar", "Workspace", "Share links"], screen: "share", spot: "share", url: "/w/acme/settings/sharing" },
    ],
  },
  {
    id: "people",
    title: "People and access",
    color: "#e44a8a",
    slides: [
      { id: "members", title: "Invite your team", body: "Invite people by email and pick a role. Admins manage everything, Members do the work, Viewers can look but not change. Guests are free.", where: ["Sidebar", "Workspace", "Members"], screen: "members", spot: "invite", url: "/w/acme/settings/members" },
      { id: "guests", title: "Guests (clients)", body: "Give a client access to only the projects you tick. They see a simple read-only board and can comment — nothing else in your workspace.", where: ["Members", "Guest access"], screen: "guest", spot: "guest-board", url: "/w/acme/guest/WEB" },
      { id: "security", title: "Security", body: "Admins can require two-step sign-in for everyone, set up company SSO (OIDC or SAML), limit access to office networks, connect SCIM, and export or keep the audit log.", where: ["Sidebar", "Workspace", "Security"], screen: "security", spot: "require2fa", url: "/w/acme/settings/security" },
      { id: "billing", title: "Billing & plan", body: "Every workspace starts with a 14-day free trial. Then choose Pay as you go, Team or Business. You only pay for people, never for guests.", where: ["Sidebar", "Workspace", "Billing & plan"], screen: "billing", spot: "plans", url: "/w/acme/settings/billing" },
    ],
  },
  {
    id: "you",
    title: "Your account",
    color: "#49ccf9",
    slides: [
      { id: "account", title: "Your account", body: "The gear next to your name at the bottom of the sidebar opens your account: sign-in and security, notifications and your calendar feed. These settings follow you into every workspace.", where: ["Sidebar", "Your name", "Gear"], screen: "account", spot: "account-nav", url: "/account/security" },
      { id: "twofa", title: "Two-step sign-in", body: "Protect your account with an authenticator app. Save the backup codes somewhere safe. You can also see every device you're signed in on and sign the others out.", where: ["Account", "Security"], screen: "accountSecurity", spot: "twofa", url: "/account/security" },
      { id: "notifications", title: "How we reach you", body: "Choose per workspace: push notifications on this device, instant emails, a daily or weekly digest, or WhatsApp. Turn any of them off whenever you like.", where: ["Account", "Notifications"], screen: "notifications", spot: "channels", url: "/account/notifications" },
      { id: "calendar-feed", title: "Your calendar feed", body: "Copy your private calendar link into Google, Outlook or Apple Calendar to see your due dates and time off next to your meetings.", where: ["Account", "Calendar"], screen: "calendarFeed", spot: "ics", url: "/account/calendar" },
      { id: "done", title: "That's the whole tour", body: "You've seen it all, top to bottom. Press Ctrl+K whenever you're lost, and come back to this tour from the sidebar any time.", where: ["Sidebar", "How it works"], screen: "home", spot: "help", url: "/w/acme" },
    ],
  },
];

export const SLIDES: (Slide & { chapter: Chapter; chapterIndex: number })[] = CHAPTERS.flatMap((c, ci) =>
  c.slides.map((s) => ({ ...s, chapter: c, chapterIndex: ci }))
);

/** Reading time for a slide: long enough to read (or hear) it, never rushed. */
export function slideDuration(s: Slide): number {
  const words = (s.title + " " + s.body).split(/\s+/).length;
  return Math.min(14000, Math.max(6500, 2400 + words * 300));
}
