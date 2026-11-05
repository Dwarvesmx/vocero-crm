DROP INDEX "kb_document_org_sha_uq";--> statement-breakpoint
ALTER TABLE "kb_document" ADD COLUMN "demo_space_id" text;--> statement-breakpoint
ALTER TABLE "kb_entry" ADD COLUMN "demo_space_id" text;--> statement-breakpoint
ALTER TABLE "kb_document" ADD CONSTRAINT "kb_document_organization_id_demo_space_id_demo_space_organization_id_id_fk" FOREIGN KEY ("organization_id","demo_space_id") REFERENCES "public"."demo_space"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_entry" ADD CONSTRAINT "kb_entry_organization_id_demo_space_id_demo_space_organization_id_id_fk" FOREIGN KEY ("organization_id","demo_space_id") REFERENCES "public"."demo_space"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_document_demo_sha_uq" ON "kb_document" USING btree ("organization_id","demo_space_id","sha256") WHERE "kb_document"."demo_space_id" is not null;--> statement-breakpoint
CREATE INDEX "kb_document_demo_scope_idx" ON "kb_document" USING btree ("organization_id","demo_space_id","status","enabled");--> statement-breakpoint
CREATE INDEX "kb_demo_scope_idx" ON "kb_entry" USING btree ("organization_id","demo_space_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kb_document_org_sha_uq" ON "kb_document" USING btree ("organization_id","sha256") WHERE "kb_document"."demo_space_id" is null;
--> statement-breakpoint
CREATE FUNCTION enforce_demo_kb_fragment_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM kb_document
    WHERE id = NEW.document_id AND organization_id = NEW.organization_id
      AND demo_space_id IS NOT DISTINCT FROM NEW.demo_space_id
  ) THEN
    RAISE EXCEPTION 'Ámbito de documento incompatible' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER demo_kb_fragment_scope BEFORE INSERT OR UPDATE OF document_id, organization_id, demo_space_id
ON kb_entry FOR EACH ROW EXECUTE FUNCTION enforce_demo_kb_fragment_scope();
--> statement-breakpoint
CREATE FUNCTION enforce_kb_document_scope_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id OR OLD.demo_space_id IS DISTINCT FROM NEW.demo_space_id THEN
    RAISE EXCEPTION 'El ámbito del documento es inmutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER kb_document_scope_immutable BEFORE UPDATE OF organization_id, demo_space_id
ON kb_document FOR EACH ROW EXECUTE FUNCTION enforce_kb_document_scope_immutable();
