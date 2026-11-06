ALTER TABLE "demo_usage_operation" ADD COLUMN "input_hash" text;--> statement-breakpoint
ALTER TABLE "demo_usage_operation" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "demo_usage_operation" ADD COLUMN "user_text" text;--> statement-breakpoint
ALTER TABLE "demo_usage_operation" ADD COLUMN "response_text" text;--> statement-breakpoint
ALTER TABLE "demo_usage_operation" ADD COLUMN "evidence" jsonb;--> statement-breakpoint
ALTER TABLE "demo_usage_operation" ADD COLUMN "attempted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "demo_llm_session_pending_uq" ON "demo_usage_operation" USING btree ("session_id") WHERE "demo_usage_operation"."kind" = 'provider_call' and "demo_usage_operation"."status" in ('reserved','uncertain');
