CREATE TABLE "demo_admin_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"space_id" text,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"target_id" text NOT NULL,
	"prior_version" integer,
	"new_version" integer,
	"reason_code" text NOT NULL,
	"request_id" text NOT NULL,
	"result" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_authorization" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"canonical_phone" jsonb NOT NULL,
	"phone_lookup" text NOT NULL,
	"phone_suffix" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_authorization_organization_id_space_id_id_unique" UNIQUE("organization_id","space_id","id"),
	CONSTRAINT "demo_authorization_state_ck" CHECK ("demo_authorization"."state" in ('active','revoked') and "demo_authorization"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "demo_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"space_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"max_duration_seconds" integer NOT NULL,
	"max_idle_seconds" integer NOT NULL,
	"max_concurrent_sessions" integer NOT NULL,
	"max_sessions_started" integer NOT NULL,
	"max_inbound_messages" integer NOT NULL,
	"max_assistant_responses" integer NOT NULL,
	"max_provider_calls" integer NOT NULL,
	"budget_micro_usd" bigint NOT NULL,
	"session_budget_micro_usd" bigint,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	CONSTRAINT "demo_limits_values_ck" CHECK ("demo_limits"."version" > 0 and "demo_limits"."window_end" > "demo_limits"."window_start"
    and least("demo_limits"."max_duration_seconds", "demo_limits"."max_idle_seconds", "demo_limits"."max_concurrent_sessions",
      "demo_limits"."max_sessions_started", "demo_limits"."max_inbound_messages", "demo_limits"."max_assistant_responses",
      "demo_limits"."max_provider_calls", "demo_limits"."budget_micro_usd", "demo_limits"."session_budget_micro_usd") >= 0)
);
--> statement-breakpoint
CREATE TABLE "demo_profile_version" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"tone" text NOT NULL,
	"instructions" text NOT NULL,
	"escalation_rules" text NOT NULL,
	"greeting" text NOT NULL,
	"role" text NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_profile_version_organization_id_space_id_id_unique" UNIQUE("organization_id","space_id","id"),
	CONSTRAINT "demo_profile_version_space_id_version_unique" UNIQUE("space_id","version"),
	CONSTRAINT "demo_profile_version_ck" CHECK ("demo_profile_version"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "demo_space" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"commercial_name" text NOT NULL,
	"sector" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"visual_identity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"current_profile_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_space_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "demo_space_organization_id_name_unique" UNIQUE("organization_id","name"),
	CONSTRAINT "demo_space_status_ck" CHECK ("demo_space"."status" in ('draft','active','disabled') and "demo_space"."generation" > 0)
);
--> statement-breakpoint
ALTER TABLE "demo_admin_audit" ADD CONSTRAINT "demo_admin_audit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_admin_audit" ADD CONSTRAINT "demo_admin_audit_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_admin_audit" ADD CONSTRAINT "demo_admin_audit_organization_id_space_id_demo_space_organization_id_id_fk" FOREIGN KEY ("organization_id","space_id") REFERENCES "public"."demo_space"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_authorization" ADD CONSTRAINT "demo_authorization_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_authorization" ADD CONSTRAINT "demo_authorization_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_authorization" ADD CONSTRAINT "demo_authorization_organization_id_space_id_demo_space_organization_id_id_fk" FOREIGN KEY ("organization_id","space_id") REFERENCES "public"."demo_space"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_limits" ADD CONSTRAINT "demo_limits_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_limits" ADD CONSTRAINT "demo_limits_organization_id_space_id_demo_space_organization_id_id_fk" FOREIGN KEY ("organization_id","space_id") REFERENCES "public"."demo_space"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_profile_version" ADD CONSTRAINT "demo_profile_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_profile_version" ADD CONSTRAINT "demo_profile_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_profile_version" ADD CONSTRAINT "demo_profile_version_organization_id_space_id_demo_space_organization_id_id_fk" FOREIGN KEY ("organization_id","space_id") REFERENCES "public"."demo_space"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_space" ADD CONSTRAINT "demo_space_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_space" ADD CONSTRAINT "demo_space_organization_id_id_current_profile_version_id_demo_profile_version_organization_id_space_id_id_fk" FOREIGN KEY ("organization_id","id","current_profile_version_id") REFERENCES "public"."demo_profile_version"("organization_id","space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_admin_audit_scope_idx" ON "demo_admin_audit" USING btree ("organization_id","space_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "demo_authorization_active_uq" ON "demo_authorization" USING btree ("organization_id","space_id","channel","phone_lookup") WHERE "demo_authorization"."state" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "demo_limits_org_uq" ON "demo_limits" USING btree ("organization_id") WHERE "demo_limits"."space_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "demo_limits_space_uq" ON "demo_limits" USING btree ("organization_id","space_id") WHERE "demo_limits"."space_id" is not null;