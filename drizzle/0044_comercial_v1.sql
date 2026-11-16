CREATE TABLE "comercial_catalogo" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "comercial_catalogo_organization_id_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "comercial_cotizacion" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"version" integer NOT NULL,
	"estado" text NOT NULL,
	"aprobada_version" integer,
	"accepted_message_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "comercial_cotizacion_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "comercial_cotizacion_estado_ck" CHECK ("comercial_cotizacion"."estado" in ('pendiente','aprobada','rechazada','aceptada'))
);
--> statement-breakpoint
CREATE TABLE "comercial_evento" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"cotizacion_id" text,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comercial_pedido" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"cotizacion_id" text NOT NULL,
	"version" integer NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"enlace" text,
	"evidencia" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "comercial_pedido_organization_id_cotizacion_id_unique" UNIQUE("organization_id","cotizacion_id"),
	CONSTRAINT "comercial_pago_estado_ck" CHECK ("comercial_pedido"."estado" in ('pendiente','en_verificacion','pagado','cancelado')),
	CONSTRAINT "comercial_pago_evidencia_ck" CHECK ("comercial_pedido"."estado" <> 'pagado' or ("comercial_pedido"."evidencia" is not null and length(trim("comercial_pedido"."evidencia")) > 0))
);
--> statement-breakpoint
CREATE TABLE "comercial_reintento" (
	"organization_id" text NOT NULL,
	"actor" text NOT NULL,
	"key" text NOT NULL,
	"hash" text NOT NULL,
	"result" jsonb NOT NULL,
	CONSTRAINT "comercial_reintento_organization_id_actor_key_unique" UNIQUE("organization_id","actor","key")
);
--> statement-breakpoint
CREATE TABLE "comercial_version" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"cotizacion_id" text NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "comercial_version_organization_id_cotizacion_id_version_unique" UNIQUE("organization_id","cotizacion_id","version")
);
--> statement-breakpoint
ALTER TABLE "comercial_catalogo" ADD CONSTRAINT "comercial_catalogo_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial_cotizacion" ADD CONSTRAINT "comercial_cotizacion_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial_cotizacion" ADD CONSTRAINT "comercial_cotizacion_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial_cotizacion" ADD CONSTRAINT "comercial_cotizacion_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial_cotizacion" ADD CONSTRAINT "comercial_cotizacion_accepted_message_id_message_id_fk" FOREIGN KEY ("accepted_message_id") REFERENCES "public"."message"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial_evento" ADD CONSTRAINT "comercial_evento_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial_pedido" ADD CONSTRAINT "comercial_pedido_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial_pedido" ADD CONSTRAINT "comercial_pedido_organization_id_cotizacion_id_comercial_cotizacion_organization_id_id_fk" FOREIGN KEY ("organization_id","cotizacion_id") REFERENCES "public"."comercial_cotizacion"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial_reintento" ADD CONSTRAINT "comercial_reintento_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial_version" ADD CONSTRAINT "comercial_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comercial_version" ADD CONSTRAINT "comercial_version_organization_id_cotizacion_id_comercial_cotizacion_organization_id_id_fk" FOREIGN KEY ("organization_id","cotizacion_id") REFERENCES "public"."comercial_cotizacion"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comercial_cotizacion_org_idx" ON "comercial_cotizacion" USING btree ("organization_id","conversation_id");--> statement-breakpoint
CREATE INDEX "comercial_evento_org_idx" ON "comercial_evento" USING btree ("organization_id","cotizacion_id");