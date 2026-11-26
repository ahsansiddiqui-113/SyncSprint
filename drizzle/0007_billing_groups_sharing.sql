CREATE TYPE "public"."billing_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('trial', 'payg', 'team', 'business', 'comped');--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"source" varchar(20) NOT NULL,
	"type" varchar(80) NOT NULL,
	"external_id" varchar(120),
	"actor_id" uuid,
	"summary" varchar(300),
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"label" varchar(80) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"password_hash" varchar(200),
	"include_comments" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_id" uuid,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"organization_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(60) NOT NULL,
	"handle" varchar(40) NOT NULL,
	"color" varchar(7) NOT NULL,
	"description" varchar(300),
	"lead_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "plan" "plan" DEFAULT 'trial' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_status" "billing_status" DEFAULT 'trialing' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "current_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "grace_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "suspended_reason" varchar(200);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "seats_purchased" integer;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "seat_overage_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "polar_customer_id" varchar(80);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "polar_subscription_id" varchar(80);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "support_access_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_lead_id_users_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_external_idx" ON "billing_events" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "billing_events_org_idx" ON "billing_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "share_links_hash_idx" ON "share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "share_links_org_idx" ON "share_links" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_org_handle_idx" ON "teams" USING btree ("organization_id","handle");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_org_name_idx" ON "teams" USING btree ("organization_id","name");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orgs_polar_sub_idx" ON "organizations" USING btree ("polar_subscription_id");--> statement-breakpoint
-- Backfill: the customer top role is now "admin" (the old "owner" value stays only as a legacy alias).
UPDATE "org_members" SET "role" = 'admin' WHERE "role" = 'owner';--> statement-breakpoint
-- Existing real workspaces start a fresh 14-day trial instead of being locked out on upgrade.
UPDATE "organizations" SET "trial_ends_at" = now() + interval '14 days' WHERE "trial_ends_at" IS NULL AND "is_demo" = false;
