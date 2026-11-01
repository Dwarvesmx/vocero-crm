CREATE TABLE "zernio_whatsapp_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text NOT NULL,
	"account_ref" text NOT NULL,
	"thread_ref" text NOT NULL,
	"request_key" text NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"not_before" timestamp DEFAULT now() NOT NULL,
	"leased_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "zernio_whatsapp_outbox" ADD CONSTRAINT "zernio_whatsapp_outbox_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zernio_whatsapp_outbox" ADD CONSTRAINT "zernio_whatsapp_outbox_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zernio_whatsapp_outbox" ADD CONSTRAINT "zernio_whatsapp_outbox_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "zernio_wa_outbox_request_uq" ON "zernio_whatsapp_outbox" USING btree ("organization_id","request_key");--> statement-breakpoint
CREATE INDEX "zernio_wa_outbox_work_idx" ON "zernio_whatsapp_outbox" USING btree ("status","not_before");