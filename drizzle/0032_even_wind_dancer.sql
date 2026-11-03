CREATE TABLE "kb_document" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"error" text,
	"leased_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kb_entry" ADD COLUMN "document_id" text;--> statement-breakpoint
ALTER TABLE "kb_document" ADD CONSTRAINT "kb_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_document_org_sha_uq" ON "kb_document" USING btree ("organization_id","sha256");--> statement-breakpoint
ALTER TABLE "kb_entry" ADD CONSTRAINT "kb_entry_document_id_kb_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_document"("id") ON DELETE cascade ON UPDATE no action;