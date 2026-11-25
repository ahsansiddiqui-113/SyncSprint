CREATE TYPE "public"."sprint_status" AS ENUM('planned', 'active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."work_item_type" AS ENUM('epic', 'story', 'task', 'bug');--> statement-breakpoint
CREATE TABLE "sprint_snapshots" (
	"organization_id" uuid NOT NULL,
	"sprint_id" uuid NOT NULL,
	"day" date NOT NULL,
	"scope_points" integer NOT NULL,
	"completed_points" integer NOT NULL,
	"scope_tasks" integer NOT NULL,
	"completed_tasks" integer NOT NULL,
	CONSTRAINT "sprint_snapshots_sprint_id_day_pk" PRIMARY KEY("sprint_id","day")
);
--> statement-breakpoint
CREATE TABLE "sprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"goal" text,
	"start_date" date,
	"end_date" date,
	"status" "sprint_status" DEFAULT 'planned' NOT NULL,
	"committed_points" integer,
	"completed_points" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sprints_dates_order" CHECK ("sprints"."start_date" is null or "sprints"."end_date" is null or "sprints"."start_date" <= "sprints"."end_date")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "type" "work_item_type" DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sprint_id" uuid;--> statement-breakpoint
ALTER TABLE "sprint_snapshots" ADD CONSTRAINT "sprint_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprint_snapshots" ADD CONSTRAINT "sprint_snapshots_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sprints_project_idx" ON "sprints" USING btree ("organization_id","project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sprints_one_active_idx" ON "sprints" USING btree ("project_id") WHERE "sprints"."status" = 'active';--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sprint_id_sprints_id_fk" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_sprint_idx" ON "tasks" USING btree ("sprint_id");