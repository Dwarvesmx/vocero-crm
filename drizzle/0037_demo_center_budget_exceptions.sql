CREATE TABLE "demo_limit_exception" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"space_id" text,
	"extra_budget_micro_usd" bigint NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	CONSTRAINT "demo_exception_values_ck" CHECK ("demo_limit_exception"."extra_budget_micro_usd" > 0 and "demo_limit_exception"."expires_at" > "demo_limit_exception"."created_at")
);
--> statement-breakpoint
ALTER TABLE "demo_limit_exception" ADD CONSTRAINT "demo_limit_exception_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_limit_exception" ADD CONSTRAINT "demo_limit_exception_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_limit_exception" ADD CONSTRAINT "demo_exception_space_fk" FOREIGN KEY ("organization_id","space_id") REFERENCES "public"."demo_space"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_exception_scope_idx" ON "demo_limit_exception" USING btree ("organization_id","space_id","expires_at");