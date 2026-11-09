ALTER TABLE "dispatch" ADD COLUMN "commercial_trace_generation" integer;--> statement-breakpoint
ALTER TABLE "zernio_whatsapp_outbox" ADD COLUMN "source_dispatch_id" text;--> statement-breakpoint
ALTER TABLE "zernio_whatsapp_outbox" ADD COLUMN "commercial_route_generation" integer;