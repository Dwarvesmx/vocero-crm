CREATE TABLE "demo_whatsapp_link" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"web_session_id" text NOT NULL,
	"external_session_id" text,
	"account_ref" text NOT NULL,
	"phone_lookup" text NOT NULL,
	"bsuid_lookup" text,
	"thread_ref" text,
	"challenge_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"linked_at" timestamp with time zone,
	CONSTRAINT "demo_whatsapp_link_challenge_hash_unique" UNIQUE("challenge_hash"),
	CONSTRAINT "demo_whatsapp_link_web_session_id_unique" UNIQUE("web_session_id"),
	CONSTRAINT "demo_whatsapp_link_external_session_id_unique" UNIQUE("external_session_id"),
	CONSTRAINT "demo_wa_link_state_ck" CHECK (("demo_whatsapp_link"."external_session_id" is null and "demo_whatsapp_link"."thread_ref" is null and "demo_whatsapp_link"."linked_at" is null and "demo_whatsapp_link"."bsuid_lookup" is null)
    or ("demo_whatsapp_link"."external_session_id" is not null and "demo_whatsapp_link"."thread_ref" is not null and "demo_whatsapp_link"."linked_at" is not null))
);
--> statement-breakpoint
DROP INDEX "dispatch_conversation_vivo_uq";--> statement-breakpoint
ALTER TABLE "demo_whatsapp_link" ADD CONSTRAINT "demo_whatsapp_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_whatsapp_link" ADD CONSTRAINT "demo_wa_link_web_fk" FOREIGN KEY ("organization_id","space_id","web_session_id") REFERENCES "public"."demo_session"("organization_id","space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_whatsapp_link" ADD CONSTRAINT "demo_wa_link_external_fk" FOREIGN KEY ("organization_id","space_id","external_session_id") REFERENCES "public"."demo_session"("organization_id","space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_wa_link_thread_idx" ON "demo_whatsapp_link" USING btree ("organization_id","account_ref","thread_ref");--> statement-breakpoint
CREATE INDEX "demo_wa_link_phone_idx" ON "demo_whatsapp_link" USING btree ("organization_id","account_ref","phone_lookup");--> statement-breakpoint
CREATE INDEX "demo_wa_link_bsuid_idx" ON "demo_whatsapp_link" USING btree ("organization_id","account_ref","bsuid_lookup");--> statement-breakpoint
CREATE INDEX "dispatch_demo_queue_idx" ON "dispatch" USING btree ("demo_session_id","created_at","id") WHERE "dispatch"."scope_kind" = 'demo' and "dispatch"."status" in ('pendiente', 'en_vuelo');--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_conversation_vivo_uq" ON "dispatch" USING btree ("conversation_id") WHERE "dispatch"."scope_kind" = 'commercial' and "dispatch"."status" in ('pendiente', 'en_vuelo');