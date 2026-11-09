CREATE TABLE "demo_pilot_participant" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"phone_lookup" text NOT NULL,
	"phone_suffix" text NOT NULL,
	"state" text NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_pilot_participant_organization_id_space_id_channel_phone_lookup_unique" UNIQUE("organization_id","space_id","channel","phone_lookup"),
	CONSTRAINT "demo_pilot_participant_state_ck" CHECK ("demo_pilot_participant"."channel" = 'whatsapp' and "demo_pilot_participant"."state" in ('allowed','blocked'))
);
--> statement-breakpoint
ALTER TABLE "demo_pilot_participant" ADD CONSTRAINT "demo_pilot_participant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_pilot_participant" ADD CONSTRAINT "demo_pilot_participant_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_pilot_participant" ADD CONSTRAINT "demo_pilot_participant_organization_id_space_id_demo_space_organization_id_id_fk" FOREIGN KEY ("organization_id","space_id") REFERENCES "public"."demo_space"("organization_id","id") ON DELETE restrict ON UPDATE no action;