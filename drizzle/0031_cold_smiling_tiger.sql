ALTER TABLE "conversation" ADD COLUMN "handoff_pending_message_id" text;--> statement-breakpoint
ALTER TABLE "zernio_whatsapp_outbox" ADD COLUMN "handoff_reason" text;