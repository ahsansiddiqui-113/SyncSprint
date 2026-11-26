import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  jsonb,
  date,
  pgEnum,
  index,
  uniqueIndex,
  primaryKey,
  check,
  customType,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const orgRoleEnum = pgEnum("org_role", ["owner", "admin", "member", "viewer"]);
export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high", "urgent"]);
export const inviteStatusEnum = pgEnum("invite_status", ["pending", "accepted", "revoked"]);
export const sprintStatusEnum = pgEnum("sprint_status", ["planned", "active", "completed"]);
export const customFieldTypeEnum = pgEnum("custom_field_type", ["text", "number", "select", "date", "person"]);
export const timeOffKindEnum = pgEnum("time_off_kind", ["vacation", "sick", "holiday", "other"]);
export const notificationKindEnum = pgEnum("notification_kind", ["mention", "assigned", "comment", "completed", "capacity", "automation"]);
export const keyResultKindEnum = pgEnum("key_result_kind", ["number", "tasks"]);
export const recurrenceFrequencyEnum = pgEnum("recurrence_frequency", ["daily", "weekdays", "weekly", "monthly"]);
export const apiKeyScopeEnum = pgEnum("api_key_scope", ["read", "write"]);
/** trial: 14-day free trial · payg: monthly per active user · team: yearly, up to 50 · business: yearly, 51-100 · comped: free, granted by the platform owner */
export const planEnum = pgEnum("plan", ["trial", "payg", "team", "business", "comped"]);
export const billingStatusEnum = pgEnum("billing_status", ["trialing", "active", "past_due", "canceled", "suspended"]);
/** Manual project status update (portfolio), like Asana / Jira status reports. */
export const projectStatusEnum = pgEnum("project_status", ["on_track", "at_risk", "off_track", "on_hold", "complete"]);
export const whiteboardKindEnum = pgEnum("whiteboard_kind", ["whiteboard", "mindmap"]);
export const whiteboardItemKindEnum = pgEnum("whiteboard_item_kind", ["note", "rect", "ellipse", "text", "arrow", "task", "node"]);

/** Postgres bytea for small attachments (kept in the database so serverless hosts need no extra storage). */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});
/** Work item types (Azure Boards / Jira style). Hierarchy uses parentId (one level). */
export const workItemTypeEnum = pgEnum("work_item_type", ["epic", "story", "task", "bug"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
};

/* -------------------------------------------------------------------------- */
/*                         Identity (shared with Better Auth)                  */
/* -------------------------------------------------------------------------- */

// 1. Users. Better Auth's `image` field is mapped to `avatarUrl` in src/lib/auth.ts.
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    avatarUrl: text("avatar_url"),
    emailVerified: boolean("email_verified").default(false).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)]
);

// Better Auth: sessions, linked accounts (password hash / OAuth tokens), verification tokens.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("sessions_token_idx").on(t.token), index("sessions_user_idx").on(t.userId)]
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)]
);

export const verifications = pgTable("verifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* -------------------------------------------------------------------------- */
/*                                   Tenancy                                  */
/* -------------------------------------------------------------------------- */

// 2. Organizations (tenants)
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    isDemo: boolean("is_demo").default(false).notNull(),
    // ---- billing (src/lib/billing-rules.ts turns these into an access level) ----
    plan: planEnum("plan").default("trial").notNull(),
    billingStatus: billingStatusEnum("billing_status").default("trialing").notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    /** Paid through this moment (from the payment provider). */
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    /** When a failed payment's grace ends (full access until then). */
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: varchar("suspended_reason", { length: 200 }),
    /** Seats paid for on the current subscription. */
    seatsPurchased: integer("seats_purchased"),
    /** First moment billable members exceeded the plan limit (7-day grace for new invites). */
    seatOverageSince: timestamp("seat_overage_since", { withTimezone: true }),
    polarCustomerId: varchar("polar_customer_id", { length: 80 }),
    polarSubscriptionId: varchar("polar_subscription_id", { length: 80 }),
    /** Customer admins can let the platform owner look in (read-only) until this time. */
    supportAccessUntil: timestamp("support_access_until", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("orgs_slug_idx").on(t.slug), index("orgs_polar_sub_idx").on(t.polarSubscriptionId)]
);

// 3. Memberships — the single source of truth for RBAC.
export const orgMembers = pgTable(
  "org_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgRoleEnum("role").default("member").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("org_member_unique_idx").on(t.organizationId, t.userId),
    index("org_members_user_idx").on(t.userId),
  ]
);

// 4. Invites (token links, role pre-assigned)
export const orgInvites = pgTable(
  "org_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    role: orgRoleEnum("role").default("member").notNull(),
    token: varchar("token", { length: 128 }).notNull(),
    status: inviteStatusEnum("status").default("pending").notNull(),
    invitedById: uuid("invited_by_id").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("invites_token_idx").on(t.token),
    index("invites_org_idx").on(t.organizationId, t.status),
  ]
);

/* -------------------------------------------------------------------------- */
/*                               Workspace data                               */
/* -------------------------------------------------------------------------- */

// 5. Projects
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    key: varchar("key", { length: 10 }).notNull(), // e.g. "ENG"
    description: text("description"),
    // Monotonic counter used to mint ENG-1, ENG-2, ... race-free (UPDATE ... RETURNING).
    taskCounter: integer("task_counter").default(0).notNull(),
    /** Latest manual status update for the portfolio (null = not reported yet). */
    status: projectStatusEnum("status"),
    statusNote: varchar("status_note", { length: 500 }),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }),
    statusUpdatedById: uuid("status_updated_by_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("project_org_key_idx").on(t.organizationId, t.key),
    index("projects_org_idx").on(t.organizationId),
  ]
);

// 6. Board columns
export const boardColumns = pgTable(
  "board_columns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 80 }).notNull(),
    position: doublePrecision("position").notNull(),
    /** Custom status color; null = default palette by position. */
    color: varchar("color", { length: 7 }),
  },
  (t) => [index("columns_project_idx").on(t.organizationId, t.projectId)]
);

// 7. Tasks — fractional `position` + optimistic-lock `version`
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Subtasks: one level deep (a subtask cannot have subtasks), same project as the parent.
    parentId: uuid("parent_id").references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    type: workItemTypeEnum("type").default("task").notNull(),
    // Removing a sprint sends its tasks back to the backlog.
    sprintId: uuid("sprint_id").references((): AnyPgColumn => sprints.id, { onDelete: "set null" }),
    /** Assigned to a group (QA, Devs...): sits in that group's queue until someone takes it. */
    teamId: uuid("team_id").references((): AnyPgColumn => teams.id, { onDelete: "set null" }),
    columnId: uuid("column_id")
      .notNull()
      .references(() => boardColumns.id, { onDelete: "cascade" }),
    taskNumber: integer("task_number").notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description"),
    priority: taskPriorityEnum("priority").default("medium").notNull(),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    position: doublePrecision("position").notNull(),
    version: integer("version").default(1).notNull(),
    // Planning fields (date-only, "YYYY-MM-DD": no timezone drift between clients).
    startDate: date("start_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    storyPoints: integer("story_points"),
    /** Time estimate in hours (drives workload/capacity; separate from story points). */
    estimateHours: doublePrecision("estimate_hours"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (t) => [
    index("tasks_org_project_idx").on(t.organizationId, t.projectId),
    index("tasks_column_pos_idx").on(t.columnId, t.position),
    uniqueIndex("tasks_project_number_idx").on(t.projectId, t.taskNumber),
    index("tasks_org_due_idx").on(t.organizationId, t.dueDate),
    index("tasks_parent_idx").on(t.parentId),
    index("tasks_sprint_idx").on(t.sprintId),
  ]
);

// 7a. Sprints (iterations) and their daily snapshots (burndown / burnup / velocity)
export const sprints = pgTable(
  "sprints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    goal: text("goal"),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    status: sprintStatusEnum("status").default("planned").notNull(),
    /** Points in the sprint when it started (the commitment). */
    committedPoints: integer("committed_points"),
    /** Points done when it was completed. */
    completedPoints: integer("completed_points"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("sprints_project_idx").on(t.organizationId, t.projectId, t.status),
    // At most one active sprint per project, enforced by the database.
    uniqueIndex("sprints_one_active_idx").on(t.projectId).where(sql`${t.status} = 'active'`),
    check("sprints_dates_order", sql`${t.startDate} is null or ${t.endDate} is null or ${t.startDate} <= ${t.endDate}`),
  ]
);

export const sprintSnapshots = pgTable(
  "sprint_snapshots",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sprintId: uuid("sprint_id")
      .notNull()
      .references(() => sprints.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    scopePoints: integer("scope_points").notNull(),
    completedPoints: integer("completed_points").notNull(),
    scopeTasks: integer("scope_tasks").notNull(),
    completedTasks: integer("completed_tasks").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sprintId, t.day] })]
);

// 7b. Checklist items (lightweight to-dos inside a task; not tasks themselves)
export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    text: varchar("text", { length: 300 }).notNull(),
    done: boolean("done").default(false).notNull(),
    position: doublePrecision("position").notNull(),
    ...timestamps,
  },
  (t) => [index("checklist_task_idx").on(t.organizationId, t.taskId, t.position)]
);

// 7c. Tags (workspace-wide labels) and the task<->tag join
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 40 }).notNull(),
    color: varchar("color", { length: 7 }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("tags_org_name_idx").on(t.organizationId, t.name)]
);

export const taskTags = pgTable(
  "task_tags",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagId] }), index("task_tags_org_idx").on(t.organizationId, t.tagId)]
);

// 7d. Dependencies: `blocker` must finish before `blocked` can proceed
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index("deps_org_blocked_idx").on(t.organizationId, t.blockedId),
    check("deps_no_self", sql`${t.blockerId} <> ${t.blockedId}`),
  ]
);

// 7e. Custom fields (per project) and their values per task
export type SelectOption = { id: string; label: string; color: string };
export const customFields = pgTable(
  "custom_fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 60 }).notNull(),
    type: customFieldTypeEnum("type").notNull(),
    options: jsonb("options").$type<SelectOption[]>().default([]).notNull(),
    position: doublePrecision("position").notNull(),
    ...timestamps,
  },
  (t) => [index("custom_fields_project_idx").on(t.organizationId, t.projectId), uniqueIndex("custom_fields_name_idx").on(t.projectId, t.name)]
);

export const taskFieldValues = pgTable(
  "task_field_values",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => customFields.id, { onDelete: "cascade" }),
    /** text: string · number: number · select: option id · date: "YYYY-MM-DD" · person: user id */
    value: jsonb("value").$type<string | number>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.fieldId] }), index("field_values_org_idx").on(t.organizationId, t.fieldId)]
);

// 7f. Co-assignees (the primary assignee stays on tasks.assignee_id) and watchers
export const taskAssignees = pgTable(
  "task_assignees",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] }), index("task_assignees_user_idx").on(t.organizationId, t.userId)]
);

export const taskWatchers = pgTable(
  "task_watchers",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] }), index("task_watchers_user_idx").on(t.organizationId, t.userId)]
);

// 7h. Capacity: workspace work schedule, per-person overrides and time off
/** Hours per weekday, Monday first: [mon, tue, wed, thu, fri, sat, sun]. */
export type WeekHours = [number, number, number, number, number, number, number];

export const workSchedules = pgTable("work_schedules", {
  organizationId: uuid("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  hours: jsonb("hours").$type<WeekHours>().notNull(),
  /** Load at or above this % of capacity is "near capacity". */
  nearThreshold: integer("near_threshold").default(85).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const memberCapacity = pgTable(
  "member_capacity",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    hours: jsonb("hours").$type<WeekHours>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })]
);

/** Full days off. userId null = a workspace-wide holiday. */
export const timeOff = pgTable(
  "time_off",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: timeOffKindEnum("kind").default("vacation").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    note: varchar("note", { length: 120 }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("time_off_org_dates_idx").on(t.organizationId, t.startDate, t.endDate),
    check("time_off_dates_order", sql`${t.startDate} <= ${t.endDate}`),
  ]
);

// 7g. Saved views (personal by default; can be shared with the project)
export type SavedViewConfig = {
  view: string;
  filters: Record<string, unknown>;
  sort?: { key: string; dir: "asc" | "desc" } | null;
  groupBy?: string | null;
};
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 60 }).notNull(),
    config: jsonb("config").$type<SavedViewConfig>().notNull(),
    shared: boolean("shared").default(false).notNull(),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("saved_views_project_idx").on(t.organizationId, t.projectId)]
);

// 7i. Notifications (in-app inbox)
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    kind: notificationKindEnum("kind").notNull(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    body: varchar("body", { length: 300 }),
    /** Where clicking the notification goes (app-relative path). */
    link: varchar("link", { length: 300 }),
    /** Optional dedupe key, e.g. one capacity alert per person per day. */
    dedupeKey: varchar("dedupe_key", { length: 120 }),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("notifications_inbox_idx").on(t.organizationId, t.userId, t.createdAt),
    uniqueIndex("notifications_dedupe_idx").on(t.userId, t.dedupeKey),
  ]
);

// 7j. Time tracking: one running timer per person (endedAt null)
export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Duration in minutes (set when stopped or for manual entries). */
    minutes: integer("minutes"),
    note: varchar("note", { length: 200 }),
    manual: boolean("manual").default(false).notNull(),
    ...timestamps,
  },
  (t) => [
    index("time_entries_task_idx").on(t.organizationId, t.taskId),
    index("time_entries_user_idx").on(t.organizationId, t.userId, t.startedAt),
    uniqueIndex("time_entries_one_running_idx").on(t.userId).where(sql`${t.endedAt} is null`),
    check("time_entries_minutes_range", sql`${t.minutes} is null or (${t.minutes} >= 0 and ${t.minutes} <= 1440)`),
  ]
);

// 7k. Attachments (stored in Postgres; small files only)
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    filename: varchar("filename", { length: 200 }).notNull(),
    contentType: varchar("content_type", { length: 120 }).notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    ...timestamps,
  },
  (t) => [index("attachments_task_idx").on(t.organizationId, t.taskId)]
);

// 7l. Docs (wiki pages, markdown) linked to tasks
export const docs = pgTable(
  "docs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 160 }).notNull(),
    content: text("content").default("").notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    version: integer("version").default(1).notNull(),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("docs_org_updated_idx").on(t.organizationId, t.updatedAt)]
);

export const docTasks = pgTable(
  "doc_tasks",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    docId: uuid("doc_id")
      .notNull()
      .references(() => docs.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.docId, t.taskId] }), index("doc_tasks_task_idx").on(t.organizationId, t.taskId)]
);

// 7m. Goals (OKRs): key results are numeric targets or progress of linked tasks
export const goals = pgTable(
  "goals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 160 }).notNull(),
    description: text("description"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    dueDate: date("due_date", { mode: "string" }),
    ...timestamps,
  },
  (t) => [index("goals_org_idx").on(t.organizationId)]
);

export const keyResults = pgTable(
  "key_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 160 }).notNull(),
    kind: keyResultKindEnum("kind").notNull(),
    startValue: doublePrecision("start_value").default(0).notNull(),
    targetValue: doublePrecision("target_value").default(100).notNull(),
    currentValue: doublePrecision("current_value").default(0).notNull(),
    unit: varchar("unit", { length: 20 }),
    position: doublePrecision("position").notNull(),
  },
  (t) => [index("key_results_goal_idx").on(t.organizationId, t.goalId)]
);

export const keyResultTasks = pgTable(
  "key_result_tasks",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    keyResultId: uuid("key_result_id")
      .notNull()
      .references(() => keyResults.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.keyResultId, t.taskId] }), index("kr_tasks_task_idx").on(t.organizationId, t.taskId)]
);

// 7n. Automations: "when <trigger> and <conditions> then <actions>", per project
export type AutomationTrigger =
  | { kind: "task_created" }
  | { kind: "status_changed"; toColumnId: string | null }
  | { kind: "assignee_changed" }
  | { kind: "priority_changed"; to: "low" | "medium" | "high" | "urgent" | null }
  /** Scheduled: once per task when its due date is within N days (0 = due today). */
  | { kind: "due_soon"; days: number }
  /** Scheduled: once per task when it passes its due date unfinished. */
  | { kind: "overdue" }
  /** Scheduled: at a local time, for every open task matching the conditions. weekday: 0 = Monday. */
  | { kind: "schedule"; every: "day" | "weekday" | "week"; weekday?: number; hour: number; timezone: string };
export type AutomationCondition = { field: "priority" | "type" | "assignee" | "tag" | "team" | "status"; op: "is" | "is_not"; value: string | null };
export type AutomationAction =
  | { type: "move_to_status"; columnId: string }
  | { type: "set_assignee"; userId: string | "actor" | null }
  | { type: "set_priority"; priority: "low" | "medium" | "high" | "urgent" }
  | { type: "add_tag"; tagId: string }
  | { type: "assign_to_team"; teamId: string | null }
  | { type: "set_due_in_days"; days: number }
  | { type: "add_comment"; body: string }
  | { type: "notify"; target: "assignee" | "watchers" | "user"; userId?: string | null; message: string };

export const automations = pgTable(
  "automations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    trigger: jsonb("trigger").$type<AutomationTrigger>().notNull(),
    conditions: jsonb("conditions").$type<AutomationCondition[]>().default([]).notNull(),
    actions: jsonb("actions").$type<AutomationAction[]>().notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    runCount: integer("run_count").default(0).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("automations_project_idx").on(t.organizationId, t.projectId)]
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    ok: boolean("ok").notNull(),
    detail: varchar("detail", { length: 300 }).notNull(),
    ...timestamps,
  },
  (t) => [index("automation_runs_idx").on(t.automationId, t.createdAt)]
);

// 7o. Recurring tasks: when the task reaches Done, the next occurrence is created and the rule moves to it
export const taskRecurrences = pgTable(
  "task_recurrences",
  {
    taskId: uuid("task_id")
      .primaryKey()
      .references(() => tasks.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    frequency: recurrenceFrequencyEnum("frequency").notNull(),
    interval: integer("interval").default(1).notNull(),
    /** How many occurrences have been created so far (for "3rd time" context). */
    occurrences: integer("occurrences").default(0).notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [check("task_recurrences_interval", sql`${t.interval} between 1 and 12`)]
);

// 7p. Public API keys (hashed; the token is shown once) and outgoing webhooks
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The key acts as this person, capped at its scope. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    prefix: varchar("prefix", { length: 16 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    scope: apiKeyScopeEnum("scope").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("api_keys_hash_idx").on(t.tokenHash), index("api_keys_org_idx").on(t.organizationId)]
);

export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    url: varchar("url", { length: 500 }).notNull(),
    /** Shared signing secret (HMAC-SHA256); needed in clear to sign, like Stripe/GitHub. */
    secret: varchar("secret", { length: 80 }).notNull(),
    events: jsonb("events").$type<string[]>().notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
    lastStatus: integer("last_status"),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("webhooks_org_idx").on(t.organizationId)]
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 60 }).notNull(),
    statusCode: integer("status_code"),
    ok: boolean("ok").notNull(),
    durationMs: integer("duration_ms").notNull(),
    error: varchar("error", { length: 300 }),
    ...timestamps,
  },
  (t) => [index("webhook_deliveries_idx").on(t.webhookId, t.createdAt)]
);

// 7q. Groups (teams): QA, Developers, Marketing... with an optional lead
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 60 }).notNull(),
    /** Short handle for @mentions, e.g. "qa" for @qa. */
    handle: varchar("handle", { length: 40 }).notNull(),
    color: varchar("color", { length: 7 }).notNull(),
    description: varchar("description", { length: 300 }),
    leadId: uuid("lead_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("teams_org_handle_idx").on(t.organizationId, t.handle), uniqueIndex("teams_org_name_idx").on(t.organizationId, t.name)]
);

export const teamMembers = pgTable(
  "team_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] }), index("team_members_user_idx").on(t.organizationId, t.userId)]
);

// 7r. Read-only share links (no sign-in). Only a hash of the token is stored.
export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** null = the whole workspace (an admin must opt in). */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 80 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    passwordHash: varchar("password_hash", { length: 200 }),
    includeComments: boolean("include_comments").default(false).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    viewCount: integer("view_count").default(0).notNull(),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("share_links_hash_idx").on(t.tokenHash), index("share_links_org_idx").on(t.organizationId)]
);

// 7s. Billing event log: payment-provider webhooks (idempotent by externalId) and platform-owner actions.
export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    source: varchar("source", { length: 20 }).notNull(),
    type: varchar("type", { length: 80 }).notNull(),
    /** Provider event id (webhook-id header): makes webhook handling idempotent. */
    externalId: varchar("external_id", { length: 120 }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    summary: varchar("summary", { length: 300 }),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [uniqueIndex("billing_events_external_idx").on(t.externalId), index("billing_events_org_idx").on(t.organizationId, t.createdAt)]
);

// 7t. Scheduled automations: one row per firing so a rule never fires twice for the same occasion.
export const automationFires = pgTable(
  "automation_fires",
  {
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    /** Task id, or "run" for a schedule occurrence. */
    subject: varchar("subject", { length: 40 }).notNull(),
    /** Occasion, e.g. "due:2026-12-01" or "sch:2026-12-01". */
    occasion: varchar("occasion", { length: 40 }).notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.automationId, t.subject, t.occasion] })]
);

/** A lease so only one server instance runs the scheduler at a time. */
export const schedulerLeases = pgTable("scheduler_leases", {
  name: varchar("name", { length: 40 }).primaryKey(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
});

// 7u. Gantt baselines: a frozen copy of every task's dates to compare plan vs actual.
export const baselines = pgTable(
  "baselines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("baselines_project_idx").on(t.organizationId, t.projectId)]
);

export const baselineTasks = pgTable(
  "baseline_tasks",
  {
    baselineId: uuid("baseline_id")
      .notNull()
      .references(() => baselines.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    startDate: date("start_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
  },
  (t) => [primaryKey({ columns: [t.baselineId, t.taskId] })]
);

// 7v. Whiteboards and mind maps (per project). "revision" bumps on every change so clients know to refetch.
export const whiteboards = pgTable(
  "whiteboards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    kind: whiteboardKindEnum("kind").notNull(),
    revision: integer("revision").default(1).notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("whiteboards_project_idx").on(t.organizationId, t.projectId)]
);

export const whiteboardItems = pgTable(
  "whiteboard_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    boardId: uuid("board_id")
      .notNull()
      .references(() => whiteboards.id, { onDelete: "cascade" }),
    kind: whiteboardItemKindEnum("kind").notNull(),
    x: doublePrecision("x").default(0).notNull(),
    y: doublePrecision("y").default(0).notNull(),
    w: doublePrecision("w").default(200).notNull(),
    h: doublePrecision("h").default(120).notNull(),
    text: varchar("text", { length: 2000 }).default("").notNull(),
    color: varchar("color", { length: 7 }).default("#fff4b8").notNull(),
    /** Arrows connect two items; deleting either end deletes the arrow. */
    fromId: uuid("from_id").references((): AnyPgColumn => whiteboardItems.id, { onDelete: "cascade" }),
    toId: uuid("to_id").references((): AnyPgColumn => whiteboardItems.id, { onDelete: "cascade" }),
    /** Mind-map parent; deleting a node deletes its branch. */
    parentId: uuid("parent_id").references((): AnyPgColumn => whiteboardItems.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    z: doublePrecision("z").default(0).notNull(),
    collapsed: boolean("collapsed").default(false).notNull(),
    version: integer("version").default(1).notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("whiteboard_items_board_idx").on(t.boardId), index("whiteboard_items_task_idx").on(t.taskId)]
);

// 8. Task comments
export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    /** Set when an automation wrote the comment (shown as the automation, not a person). */
    automationId: uuid("automation_id").references((): AnyPgColumn => automations.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    ...timestamps,
  },
  (t) => [index("comments_task_idx").on(t.organizationId, t.taskId, t.createdAt)]
);

// 9. Immutable audit log (append-only; written in the same tx as the mutation)
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 80 }).notNull(),
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
    ...timestamps,
  },
  (t) => [
    index("audit_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_org_entity_idx").on(t.organizationId, t.entityId),
  ]
);

// 10. Per-org daily AI quota (protects shared free-tier limits)
export const aiUsage = pgTable(
  "ai_usage",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    count: integer("count").default(0).notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.day] })]
);

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type OrgMember = typeof orgMembers.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type BoardColumn = typeof boardColumns.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type OrgRole = (typeof orgRoleEnum.enumValues)[number];
export type TaskPriority = (typeof taskPriorityEnum.enumValues)[number];
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Sprint = typeof sprints.$inferSelect;
export type SprintStatus = (typeof sprintStatusEnum.enumValues)[number];
export type WorkItemType = (typeof workItemTypeEnum.enumValues)[number];
export type CustomField = typeof customFields.$inferSelect;
export type CustomFieldType = (typeof customFieldTypeEnum.enumValues)[number];
export type SavedView = typeof savedViews.$inferSelect;
export type TimeOff = typeof timeOff.$inferSelect;
export type TimeOffKind = (typeof timeOffKindEnum.enumValues)[number];
export type Notification = typeof notifications.$inferSelect;
export type NotificationKind = (typeof notificationKindEnum.enumValues)[number];
export type TimeEntry = typeof timeEntries.$inferSelect;
export type Doc = typeof docs.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type KeyResult = typeof keyResults.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type RecurrenceFrequency = (typeof recurrenceFrequencyEnum.enumValues)[number];
export type ApiKey = typeof apiKeys.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type Plan = (typeof planEnum.enumValues)[number];
export type BillingStatus = (typeof billingStatusEnum.enumValues)[number];
export type Team = typeof teams.$inferSelect;
export type ShareLink = typeof shareLinks.$inferSelect;
export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];
export type Whiteboard = typeof whiteboards.$inferSelect;
export type WhiteboardItem = typeof whiteboardItems.$inferSelect;
export type WhiteboardItemKind = (typeof whiteboardItemKindEnum.enumValues)[number];
