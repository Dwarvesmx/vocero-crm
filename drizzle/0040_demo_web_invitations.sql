ALTER TABLE "demo_session" DROP CONSTRAINT "demo_session_kind_ck";--> statement-breakpoint
ALTER TABLE "demo_session" ADD COLUMN "web_token_hash" text;--> statement-breakpoint
ALTER TABLE "demo_session" ADD CONSTRAINT "demo_session_web_token_hash_unique" UNIQUE("web_token_hash");--> statement-breakpoint
ALTER TABLE "demo_session" ADD CONSTRAINT "demo_session_kind_ck" CHECK (("demo_session"."kind" in ('internal','web') and "demo_session"."actor_user_id" is not null and "demo_session"."request_key" is not null and "demo_session"."authorization_id" is null and "demo_session"."conversation_id" is null
    and (("demo_session"."kind" = 'web' and "demo_session"."web_token_hash" is not null) or ("demo_session"."kind" = 'internal' and "demo_session"."web_token_hash" is null)))
    or ("demo_session"."kind" = 'external' and "demo_session"."authorization_id" is not null and "demo_session"."conversation_id" is not null and "demo_session"."web_token_hash" is null));