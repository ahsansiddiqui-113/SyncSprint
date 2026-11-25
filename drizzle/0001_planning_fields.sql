ALTER TABLE "tasks" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "story_points" integer;--> statement-breakpoint
CREATE INDEX "tasks_org_due_idx" ON "tasks" USING btree ("organization_id","due_date");