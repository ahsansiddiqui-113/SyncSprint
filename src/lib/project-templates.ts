import type { ProjectTemplatePayload } from "@/db/schema";

/**
 * Built-in project templates (like ClickUp templates / Azure DevOps process templates).
 * Each one sets up statuses (with WIP limits where they help), custom fields, tags and
 * starter tasks so a team can begin without a blank page.
 */
export type BuiltinTemplate = { id: string; name: string; description: string; icon: string; payload: ProjectTemplatePayload };

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: "scrum",
    name: "Software sprint (Scrum)",
    description: "Backlog, sprint board with review and testing, story points and bug tracking.",
    icon: "🏃",
    payload: {
      columns: [
        { title: "Backlog", color: "#64748b" },
        { title: "To Do", color: "#3f7cb8" },
        { title: "In Progress", color: "#7b68ee", wipLimit: 5 },
        { title: "Code Review", color: "#dd6b00", wipLimit: 3 },
        { title: "Testing", color: "#0891b2", wipLimit: 3 },
        { title: "Done", color: "#0f9d74" },
      ],
      fields: [
        { name: "Component", type: "select", options: ["Frontend", "Backend", "Mobile", "Infrastructure"] },
        { name: "Release", type: "text" },
      ],
      tags: [{ name: "tech-debt", color: "#a16207" }, { name: "customer", color: "#e44a8a" }],
      tasks: [
        { title: "Set up the repository and CI", type: "task", priority: "high", column: 1, storyPoints: 3, checklist: ["Create repo", "Add lint and tests to CI", "Protect the main branch"] },
        { title: "User sign-in", type: "story", priority: "high", column: 0, storyPoints: 5, subtasks: ["Sign-in form", "Password reset", "Session handling"] },
        { title: "Dashboard first version", type: "story", priority: "medium", column: 0, storyPoints: 8 },
        { title: "Crash on empty search", type: "bug", priority: "urgent", column: 1, storyPoints: 2, tags: ["customer"] },
        { title: "Upgrade the database driver", type: "task", priority: "low", column: 0, storyPoints: 1, tags: ["tech-debt"] },
      ],
    },
  },
  {
    id: "kanban-bugs",
    name: "Bug tracking (Kanban)",
    description: "Triage, fix and verify bugs with severity, environment and WIP limits.",
    icon: "🐞",
    payload: {
      columns: [
        { title: "Triage", color: "#e44a8a" },
        { title: "Confirmed", color: "#dd6b00" },
        { title: "Fixing", color: "#7b68ee", wipLimit: 4 },
        { title: "Verify", color: "#0891b2", wipLimit: 4 },
        { title: "Closed", color: "#0f9d74" },
      ],
      fields: [
        { name: "Severity", type: "select", options: ["S1 Critical", "S2 Major", "S3 Minor", "S4 Cosmetic"] },
        { name: "Environment", type: "select", options: ["Production", "Staging", "Development"] },
        { name: "Reported by", type: "text" },
      ],
      tags: [{ name: "regression", color: "#e44a8a" }, { name: "needs-info", color: "#64748b" }],
      tasks: [
        { title: "Example: checkout button does nothing on Safari", type: "bug", priority: "high", column: 0, tags: ["regression"], checklist: ["Reproduce", "Find the cause", "Add a test"] },
        { title: "Example: typo on the pricing page", type: "bug", priority: "low", column: 1 },
      ],
    },
  },
  {
    id: "marketing",
    name: "Marketing campaign",
    description: "Plan, create, review and launch campaign content across channels.",
    icon: "📣",
    payload: {
      columns: [
        { title: "Ideas", color: "#64748b" },
        { title: "Planned", color: "#3f7cb8" },
        { title: "In Production", color: "#7b68ee" },
        { title: "Review", color: "#dd6b00" },
        { title: "Scheduled", color: "#0891b2" },
        { title: "Live", color: "#0f9d74" },
      ],
      fields: [
        { name: "Channel", type: "select", options: ["Blog", "Email", "LinkedIn", "Instagram", "YouTube", "Paid ads"] },
        { name: "Budget", type: "number" },
        { name: "Publish date", type: "date" },
      ],
      tags: [{ name: "launch", color: "#7b68ee" }],
      tasks: [
        { title: "Campaign brief and goals", type: "task", priority: "high", column: 1, checklist: ["Audience", "Key message", "Success metric", "Budget"] },
        { title: "Launch blog post", type: "task", priority: "medium", column: 0, tags: ["launch"], subtasks: ["Draft", "Images", "SEO check"] },
        { title: "Email announcement", type: "task", priority: "medium", column: 0, tags: ["launch"] },
        { title: "Social posts for launch week", type: "task", priority: "medium", column: 0 },
      ],
    },
  },
  {
    id: "client-onboarding",
    name: "Client onboarding",
    description: "A repeatable checklist from signed contract to a happy, live customer.",
    icon: "🤝",
    payload: {
      columns: [
        { title: "Kick-off", color: "#3f7cb8" },
        { title: "Setup", color: "#7b68ee" },
        { title: "Training", color: "#dd6b00" },
        { title: "Go-live", color: "#0891b2" },
        { title: "Completed", color: "#0f9d74" },
      ],
      fields: [
        { name: "Client", type: "text" },
        { name: "Contract value", type: "number" },
        { name: "Account manager", type: "person" },
      ],
      tags: [{ name: "blocked-by-client", color: "#dd6b00" }],
      tasks: [
        { title: "Kick-off call", type: "task", priority: "high", column: 0, checklist: ["Agenda sent", "Goals agreed", "Contacts collected"] },
        { title: "Account and data setup", type: "task", priority: "high", column: 0, subtasks: ["Create accounts", "Import data", "Configure settings"] },
        { title: "Admin training session", type: "task", priority: "medium", column: 0 },
        { title: "Go-live review", type: "task", priority: "medium", column: 0 },
      ],
    },
  },
  {
    id: "roadmap",
    name: "Product roadmap",
    description: "Epics by quarter, with now / next / later and effort estimates.",
    icon: "🗺️",
    payload: {
      columns: [
        { title: "Later", color: "#64748b" },
        { title: "Next", color: "#3f7cb8" },
        { title: "Now", color: "#7b68ee", wipLimit: 6 },
        { title: "Shipped", color: "#0f9d74" },
      ],
      fields: [
        { name: "Quarter", type: "select", options: ["Q1", "Q2", "Q3", "Q4"] },
        { name: "Effort", type: "select", options: ["S", "M", "L", "XL"] },
        { name: "Impact", type: "number" },
      ],
      tags: [],
      tasks: [
        { title: "Mobile app", type: "epic", priority: "high", column: 1 },
        { title: "Self-serve billing", type: "epic", priority: "high", column: 2 },
        { title: "Public API", type: "epic", priority: "medium", column: 0 },
      ],
    },
  },
];

export const builtinTemplate = (id: string) => BUILTIN_TEMPLATES.find((t) => t.id === id) ?? null;
