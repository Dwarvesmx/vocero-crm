ALTER TABLE "conversation" ADD CONSTRAINT "conversation_org_id_uq" UNIQUE("organization_id","id");--> statement-breakpoint
CREATE TABLE "demo_concurrency_bucket" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"space_id" text,
	"active_sessions" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "demo_concurrency_active_ck" CHECK ("demo_concurrency_bucket"."active_sessions" >= 0)
);
--> statement-breakpoint
CREATE TABLE "demo_dispatch_debt" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text NOT NULL,
	"scope_kind" text NOT NULL,
	"session_id" text,
	"generation" integer,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_at" timestamp with time zone,
	CONSTRAINT "demo_dispatch_debt_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "demo_identity_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"channel" text NOT NULL,
	"account_ref" text NOT NULL,
	"identity_kind" text NOT NULL,
	"identity_lookup" text NOT NULL,
	"authorization_id" text NOT NULL,
	"state" text NOT NULL,
	"evidence_type" text NOT NULL,
	"evidence_ref" text NOT NULL,
	"verified_by" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "demo_binding_state_ck" CHECK ("demo_identity_binding"."state" in ('verified','revoked') and "demo_identity_binding"."identity_kind" in ('phone','bsuid') and "demo_identity_binding"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "demo_identity_route" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel" text NOT NULL,
	"identity_lookup" text NOT NULL,
	"mode" text NOT NULL,
	"session_id" text,
	"generation" integer DEFAULT 1 NOT NULL,
	"last_event_sequence" bigint DEFAULT 0 NOT NULL,
	"blocked_since" timestamp with time zone,
	"blocked_reason" text,
	"review_due_at" timestamp with time zone,
	"last_review_notified_at" timestamp with time zone,
	CONSTRAINT "demo_identity_route_organization_id_channel_identity_lookup_unique" UNIQUE("organization_id","channel","identity_lookup"),
	CONSTRAINT "demo_route_mode_ck" CHECK ("demo_identity_route"."generation" > 0 and (("demo_identity_route"."mode" = 'demo' and "demo_identity_route"."session_id" is not null)
    or ("demo_identity_route"."mode" in ('commercial','blocked') and "demo_identity_route"."session_id" is null)))
);
--> statement-breakpoint
CREATE TABLE "demo_session" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"authorization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"profile_version_id" text NOT NULL,
	"route_generation" integer NOT NULL,
	"state" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"idle_deadline" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"limits_snapshot" jsonb NOT NULL,
	CONSTRAINT "demo_session_organization_id_space_id_id_unique" UNIQUE("organization_id","space_id","id"),
	CONSTRAINT "demo_session_organization_id_conversation_id_id_unique" UNIQUE("organization_id","conversation_id","id"),
	CONSTRAINT "demo_session_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "demo_session_state_ck" CHECK ("demo_session"."state" in ('active','expired','revoked','superseded','closed')
    and "demo_session"."route_generation" > 0 and "demo_session"."expires_at" > "demo_session"."started_at")
);
--> statement-breakpoint
CREATE TABLE "demo_session_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"session_id" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"reason_code" text NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "demo_usage_bucket" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"sessions_started" integer DEFAULT 0 NOT NULL,
	"inbound_messages" integer DEFAULT 0 NOT NULL,
	"assistant_responses" integer DEFAULT 0 NOT NULL,
	"provider_calls" integer DEFAULT 0 NOT NULL,
	"reserved_micro_usd" bigint DEFAULT 0 NOT NULL,
	"settled_micro_usd" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "demo_usage_bucket_organization_id_scope_kind_scope_id_window_start_unique" UNIQUE("organization_id","scope_kind","scope_id","window_start"),
	CONSTRAINT "demo_usage_bucket_ck" CHECK ("demo_usage_bucket"."scope_kind" in ('global','space','session') and "demo_usage_bucket"."window_end" > "demo_usage_bucket"."window_start"
    and least("demo_usage_bucket"."sessions_started","demo_usage_bucket"."inbound_messages","demo_usage_bucket"."assistant_responses","demo_usage_bucket"."provider_calls","demo_usage_bucket"."reserved_micro_usd","demo_usage_bucket"."settled_micro_usd") >= 0)
);
--> statement-breakpoint
CREATE TABLE "demo_usage_operation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"session_id" text NOT NULL,
	"operation_key" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"reserved_amount" bigint DEFAULT 0 NOT NULL,
	"actual_amount" bigint,
	"provider_request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_usage_operation_organization_id_operation_key_unique" UNIQUE("organization_id","operation_key"),
	CONSTRAINT "demo_operation_ck" CHECK ("demo_usage_operation"."kind" in ('session_start','inbound','response','provider_call')
    and "demo_usage_operation"."status" in ('reserved','settled','released','uncertain')
    and least("demo_usage_operation"."reserved_amount","demo_usage_operation"."actual_amount") >= 0)
);
--> statement-breakpoint
ALTER TABLE "dispatch" ADD COLUMN "contract_version" integer;--> statement-breakpoint
ALTER TABLE "dispatch" ADD COLUMN "profile_version_id" text;--> statement-breakpoint
ALTER TABLE "dispatch" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "dispatch" ADD COLUMN "payload_hash" text;--> statement-breakpoint
ALTER TABLE "dispatch" ADD COLUMN "scope_kind" text DEFAULT 'commercial' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch" ADD COLUMN "demo_session_id" text;--> statement-breakpoint
ALTER TABLE "dispatch" ADD COLUMN "route_generation" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "scope_kind" text DEFAULT 'commercial' NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "demo_session_id" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "route_generation" integer;--> statement-breakpoint
ALTER TABLE "demo_concurrency_bucket" ADD CONSTRAINT "demo_concurrency_bucket_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_concurrency_bucket" ADD CONSTRAINT "demo_concurrency_space_fk" FOREIGN KEY ("organization_id","space_id") REFERENCES "public"."demo_space"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_dispatch_debt" ADD CONSTRAINT "demo_dispatch_debt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_dispatch_debt" ADD CONSTRAINT "demo_dispatch_debt_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_dispatch_debt" ADD CONSTRAINT "demo_debt_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversation"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_dispatch_debt" ADD CONSTRAINT "demo_debt_session_fk" FOREIGN KEY ("organization_id","conversation_id","session_id") REFERENCES "public"."demo_session"("organization_id","conversation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_identity_binding" ADD CONSTRAINT "demo_identity_binding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_identity_binding" ADD CONSTRAINT "demo_identity_binding_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_identity_binding" ADD CONSTRAINT "demo_binding_authorization_fk" FOREIGN KEY ("organization_id","space_id","authorization_id") REFERENCES "public"."demo_authorization"("organization_id","space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_identity_route" ADD CONSTRAINT "demo_identity_route_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_identity_route" ADD CONSTRAINT "demo_route_session_fk" FOREIGN KEY ("organization_id","session_id") REFERENCES "public"."demo_session"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_session" ADD CONSTRAINT "demo_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_session" ADD CONSTRAINT "demo_session_authorization_fk" FOREIGN KEY ("organization_id","space_id","authorization_id") REFERENCES "public"."demo_authorization"("organization_id","space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_session" ADD CONSTRAINT "demo_session_profile_fk" FOREIGN KEY ("organization_id","space_id","profile_version_id") REFERENCES "public"."demo_profile_version"("organization_id","space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_session" ADD CONSTRAINT "demo_session_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."conversation"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_session_event" ADD CONSTRAINT "demo_session_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_session_event" ADD CONSTRAINT "demo_event_session_fk" FOREIGN KEY ("organization_id","space_id","session_id") REFERENCES "public"."demo_session"("organization_id","space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_usage_bucket" ADD CONSTRAINT "demo_usage_bucket_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_usage_operation" ADD CONSTRAINT "demo_usage_operation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_usage_operation" ADD CONSTRAINT "demo_operation_session_fk" FOREIGN KEY ("organization_id","space_id","session_id") REFERENCES "public"."demo_session"("organization_id","space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "demo_concurrency_org_uq" ON "demo_concurrency_bucket" USING btree ("organization_id") WHERE "demo_concurrency_bucket"."space_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "demo_concurrency_space_uq" ON "demo_concurrency_bucket" USING btree ("organization_id","space_id") WHERE "demo_concurrency_bucket"."space_id" is not null;--> statement-breakpoint
CREATE INDEX "demo_debt_pending_idx" ON "demo_dispatch_debt" USING btree ("organization_id","conversation_id","received_at") WHERE "demo_dispatch_debt"."handled_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "demo_binding_verified_uq" ON "demo_identity_binding" USING btree ("organization_id","channel","account_ref","identity_kind","identity_lookup") WHERE "demo_identity_binding"."state" = 'verified';--> statement-breakpoint
CREATE INDEX "demo_session_expiry_idx" ON "demo_session" USING btree ("organization_id","space_id","state","expires_at");--> statement-breakpoint
CREATE INDEX "demo_session_event_scope_idx" ON "demo_session_event" USING btree ("organization_id","space_id","session_id","occurred_at");--> statement-breakpoint
ALTER TABLE "dispatch" ADD CONSTRAINT "dispatch_demo_session_fk" FOREIGN KEY ("organization_id","conversation_id","demo_session_id") REFERENCES "public"."demo_session"("organization_id","conversation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_demo_session_fk" FOREIGN KEY ("organization_id","conversation_id","demo_session_id") REFERENCES "public"."demo_session"("organization_id","conversation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch" ADD CONSTRAINT "dispatch_demo_scope_ck" CHECK (("dispatch"."scope_kind" = 'demo' and "dispatch"."demo_session_id" is not null and "dispatch"."route_generation" > 0)
      or ("dispatch"."scope_kind" in ('commercial') and "dispatch"."demo_session_id" is null));--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_demo_scope_ck" CHECK (("message"."scope_kind" = 'demo' and "message"."demo_session_id" is not null and "message"."route_generation" > 0)
      or ("message"."scope_kind" in ('commercial','blocked') and "message"."demo_session_id" is null));