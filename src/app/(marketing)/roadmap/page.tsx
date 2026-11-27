import type { Metadata } from "next";
import { Check, Circle, Loader } from "lucide-react";
import { DocPage } from "@/components/marketing/site-header";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Roadmap — SyncSprint", description: "What we've shipped and what's coming next." };

type Status = "shipped" | "next" | "planned";
const PHASES: { name: string; status: Status; items: string[] }[] = [
  {
    name: "Foundation",
    status: "shipped",
    items: ["Workspaces, members, roles and invites", "Board and List views", "Live presence and instant updates", "Activity history", "AI subtasks, triage and standups"],
  },
  {
    name: "Planning & visualization",
    status: "shipped",
    items: ["Start dates, due dates and story points", "Search and filters across every view", "Calendar with drag-to-reschedule", "Timeline (Gantt) with drag and resize", "Project dashboards"],
  },
  {
    name: "Work breakdown",
    status: "shipped",
    items: ["Subtasks with progress roll-up", "Checklists inside tasks", "Color-coded tags and tag filters", "Blocked-by / blocking dependencies", "Dependency arrows on the Timeline"],
  },
  {
    name: "Sprints & agile",
    status: "shipped",
    items: ["Sprints with goals and dates", "Backlog and sprint planning", "Burndown and burnup charts", "Velocity across sprints", "Epics, stories, tasks and bugs"],
  },
  {
    name: "Customization & workload",
    status: "shipped",
    items: ["Custom statuses and custom fields", "Spreadsheet-style table view", "Saved views with sort and grouping", "Multiple assignees and watchers", "Workload view with capacity warnings"],
  },
  {
    name: "Collaboration",
    status: "shipped",
    items: ["@mentions and notifications inbox", "Time tracking", "File attachments", "Docs linked to tasks", "Goals and OKRs"],
  },
  {
    name: "Automation & integrations",
    status: "shipped",
    items: ["Automations (when this happens, do that)", "Recurring tasks", "Sprint capacity planning", "Import from CSV and Jira", "REST API and webhooks"],
  },
  {
    name: "Business & sharing",
    status: "shipped",
    items: ["Plans with a free trial", "Admin, member and free viewer roles", "Groups like QA, Developers, Marketing", "Read-only share links", "Workload tracking per group"],
  },
  {
    name: "Visual planning",
    status: "shipped",
    items: ["Whiteboards and mind maps", "Gantt baselines and critical path", "Portfolio view across projects", "Scheduled automations"],
  },
  {
    name: "Enterprise & reach",
    status: "shipped",
    items: ["Single sign-on, two-step sign-in and user provisioning", "Project and task templates, Ctrl+K search", "WIP limits, swimlanes, flow analytics, intake forms", "Slack, Teams, Discord, email, push, calendar, WhatsApp", "GitHub and GitLab links, guest access for clients"],
  },
  {
    name: "Deeper integrations",
    status: "next",
    items: ["Two-way Slack and Teams apps", "Custom roles", "Native mobile apps", "More languages"],
  },
];

const STATUS: Record<Status, { label: string; icon: typeof Check; pill: string; dot: string }> = {
  shipped: { label: "Shipped", icon: Check, pill: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-[#0f9d74] text-white" },
  next: { label: "Up next", icon: Loader, pill: "bg-primary-soft text-primary border-primary/25", dot: "bg-primary text-white" },
  planned: { label: "Planned", icon: Circle, pill: "bg-surface-2 text-muted border-border", dot: "bg-white text-subtle border-2 border-border-strong" },
};

export default function RoadmapPage() {
  return (
    <DocPage
      eyebrow="Roadmap"
      title="What we're building"
      intro="SyncSprint grows one focused release at a time. Here's what's already live and what's coming next."
    >
      <ol className="relative space-y-6 before:absolute before:bottom-6 before:left-[19px] before:top-6 before:w-0.5 before:bg-border">
        {PHASES.map((p, i) => {
          const s = STATUS[p.status];
          return (
            <li key={p.name} className="relative grid gap-4 pl-14 lg:grid-cols-[300px_1fr]">
              <span className={cn("absolute left-0 top-1 flex h-10 w-10 items-center justify-center rounded-full text-[15px] font-bold", s.dot)}>
                {p.status === "shipped" ? <Check className="h-5 w-5" strokeWidth={3} /> : i + 1}
              </span>
              <div>
                <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] font-semibold", s.pill)}>
                  <s.icon className="h-3.5 w-3.5" /> {s.label}
                </span>
                <h2 className="mt-2 text-2xl font-extrabold tracking-tight">{p.name}</h2>
              </div>
              <ul className="grid gap-2.5 rounded-2xl border border-border bg-white p-6 shadow-card sm:grid-cols-2">
                {p.items.map((it) => (
                  <li key={it} className="flex items-start gap-2.5 text-[15px]">
                    {p.status === "shipped" ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#0f9d74]" strokeWidth={3} />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-border-strong" />
                    )}
                    <span className={cn(p.status === "shipped" ? "text-foreground" : "text-muted")}>{it}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </DocPage>
  );
}
