CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"text" varchar(300) NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(40) NOT NULL,
	"color" varchar(7) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"organization_id" uuid NOT NULL,
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "deps_no_self" CHECK ("task_dependencies"."blocker_id" <> "task_dependencies"."blocked_id")
);
--> statement-breakpoint
CREATE TABLE "task_tags" (
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "task_tags_task_id_tag_id_pk" PRIMARY KEY("task_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocker_id_tasks_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocked_id_tasks_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_task_idx" ON "checklist_items" USING btree ("organization_id","task_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_org_name_idx" ON "tags" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "deps_org_blocked_idx" ON "task_dependencies" USING btree ("organization_id","blocked_id");--> statement-breakpoint
CREATE INDEX "task_tags_org_idx" ON "task_tags" USING btree ("organization_id","tag_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_id");