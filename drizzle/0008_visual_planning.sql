CREATE TYPE "public"."project_status" AS ENUM('on_track', 'at_risk', 'off_track', 'on_hold', 'complete');--> statement-breakpoint
CREATE TYPE "public"."whiteboard_item_kind" AS ENUM('note', 'rect', 'ellipse', 'text', 'arrow', 'task', 'node');--> statement-breakpoint
CREATE TYPE "public"."whiteboard_kind" AS ENUM('whiteboard', 'mindmap');--> statement-breakpoint
CREATE TABLE "automation_fires" (
	"automation_id" uuid NOT NULL,
	"subject" varchar(40) NOT NULL,
	"occasion" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_fires_automation_id_subject_occasion_pk" PRIMARY KEY("automation_id","subject","occasion")
);
--> statement-breakpoint
CREATE TABLE "baseline_tasks" (
	"baseline_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"start_date" date,
	"due_date" date,
	CONSTRAINT "baseline_tasks_baseline_id_task_id_pk" PRIMARY KEY("baseline_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "baselines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduler_leases" (
	"name" varchar(40) PRIMARY KEY NOT NULL,
	"locked_until" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "whiteboard_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"kind" "whiteboard_item_kind" NOT NULL,
	"x" double precision DEFAULT 0 NOT NULL,
	"y" double precision DEFAULT 0 NOT NULL,
	"w" double precision DEFAULT 200 NOT NULL,
	"h" double precision DEFAULT 120 NOT NULL,
	"text" varchar(2000) DEFAULT '' NOT NULL,
	"color" varchar(7) DEFAULT '#fff4b8' NOT NULL,
	"from_id" uuid,
	"to_id" uuid,
	"parent_id" uuid,
	"task_id" uuid,
	"z" double precision DEFAULT 0 NOT NULL,
	"collapsed" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whiteboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"kind" "whiteboard_kind" NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "status" "project_status";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "status_note" varchar(500);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "status_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "status_updated_by_id" uuid;--> statement-breakpoint
ALTER TABLE "automation_fires" ADD CONSTRAINT "automation_fires_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_tasks" ADD CONSTRAINT "baseline_tasks_baseline_id_baselines_id_fk" FOREIGN KEY ("baseline_id") REFERENCES "public"."baselines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baseline_tasks" ADD CONSTRAINT "baseline_tasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_items" ADD CONSTRAINT "whiteboard_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_items" ADD CONSTRAINT "whiteboard_items_board_id_whiteboards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."whiteboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_items" ADD CONSTRAINT "whiteboard_items_from_id_whiteboard_items_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."whiteboard_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_items" ADD CONSTRAINT "whiteboard_items_to_id_whiteboard_items_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."whiteboard_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_items" ADD CONSTRAINT "whiteboard_items_parent_id_whiteboard_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."whiteboard_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_items" ADD CONSTRAINT "whiteboard_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_items" ADD CONSTRAINT "whiteboard_items_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "baselines_project_idx" ON "baselines" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "whiteboard_items_board_idx" ON "whiteboard_items" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "whiteboard_items_task_idx" ON "whiteboard_items" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "whiteboards_project_idx" ON "whiteboards" USING btree ("organization_id","project_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_status_updated_by_id_users_id_fk" FOREIGN KEY ("status_updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;