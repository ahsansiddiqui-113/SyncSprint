CREATE TYPE "public"."custom_field_type" AS ENUM('text', 'number', 'select', 'date', 'person');--> statement-breakpoint
CREATE TYPE "public"."time_off_kind" AS ENUM('vacation', 'sick', 'holiday', 'other');--> statement-breakpoint
CREATE TABLE "custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(60) NOT NULL,
	"type" "custom_field_type" NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_capacity" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"hours" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_capacity_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(60) NOT NULL,
	"config" jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_assignees" (
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "task_assignees_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "task_field_values" (
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "task_field_values_task_id_field_id_pk" PRIMARY KEY("task_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "task_watchers" (
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_watchers_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" time_off_kind DEFAULT 'vacation' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"note" varchar(120),
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_off_dates_order" CHECK ("time_off"."start_date" <= "time_off"."end_date")
);
--> statement-breakpoint
CREATE TABLE "work_schedules" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"hours" jsonb NOT NULL,
	"near_threshold" integer DEFAULT 85 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_columns" ADD COLUMN "color" varchar(7);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "estimate_hours" double precision;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_capacity" ADD CONSTRAINT "member_capacity_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_capacity" ADD CONSTRAINT "member_capacity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_field_values" ADD CONSTRAINT "task_field_values_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_field_values" ADD CONSTRAINT "task_field_values_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_field_values" ADD CONSTRAINT "task_field_values_field_id_custom_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_fields_project_idx" ON "custom_fields" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_name_idx" ON "custom_fields" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "saved_views_project_idx" ON "saved_views" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "task_assignees_user_idx" ON "task_assignees" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "field_values_org_idx" ON "task_field_values" USING btree ("organization_id","field_id");--> statement-breakpoint
CREATE INDEX "task_watchers_user_idx" ON "task_watchers" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "time_off_org_dates_idx" ON "time_off" USING btree ("organization_id","start_date","end_date");