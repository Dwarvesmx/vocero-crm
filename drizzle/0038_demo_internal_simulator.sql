CREATE TABLE "demo_simulation_turn" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"session_id" text NOT NULL,
	"request_key" text NOT NULL,
	"user_text" text NOT NULL,
	"assistant_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_simulation_turn_session_id_request_key_unique" UNIQUE("session_id","request_key")
);
--> statement-breakpoint
ALTER TABLE "demo_session" ALTER COLUMN "authorization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_session" ALTER COLUMN "conversation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_session" ADD COLUMN "kind" text DEFAULT 'external' NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_session" ADD COLUMN "actor_user_id" text;--> statement-breakpoint
ALTER TABLE "demo_session" ADD COLUMN "request_key" text;--> statement-breakpoint
ALTER TABLE "demo_simulation_turn" ADD CONSTRAINT "demo_simulation_turn_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_simulation_turn" ADD CONSTRAINT "demo_sim_turn_session_fk" FOREIGN KEY ("organization_id","space_id","session_id") REFERENCES "public"."demo_session"("organization_id","space_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_sim_turn_history_idx" ON "demo_simulation_turn" USING btree ("organization_id","space_id","session_id","created_at");--> statement-breakpoint
ALTER TABLE "demo_session" ADD CONSTRAINT "demo_session_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_session" ADD CONSTRAINT "demo_session_organization_id_actor_user_id_request_key_unique" UNIQUE("organization_id","actor_user_id","request_key");--> statement-breakpoint
ALTER TABLE "demo_session" ADD CONSTRAINT "demo_session_kind_ck" CHECK (("demo_session"."kind" = 'internal' and "demo_session"."actor_user_id" is not null and "demo_session"."request_key" is not null and "demo_session"."authorization_id" is null and "demo_session"."conversation_id" is null)
    or ("demo_session"."kind" = 'external' and "demo_session"."authorization_id" is not null and "demo_session"."conversation_id" is not null));
