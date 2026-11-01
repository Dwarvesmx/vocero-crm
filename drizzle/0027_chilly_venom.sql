CREATE TABLE "zernio_whatsapp_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_ref" text NOT NULL,
	"token_cipher" text NOT NULL,
	"token_iv" text NOT NULL,
	"token_tag" text NOT NULL,
	"secret_cipher" text NOT NULL,
	"secret_iv" text NOT NULL,
	"secret_tag" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "zernio_whatsapp_credentials" ADD CONSTRAINT "zernio_whatsapp_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "zernio_wa_org_uq" ON "zernio_whatsapp_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zernio_wa_account_uq" ON "zernio_whatsapp_credentials" USING btree ("account_ref");