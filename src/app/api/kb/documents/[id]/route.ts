import { and, eq, asc, isNull } from "drizzle-orm";
import { z } from "zod";
import { withAuth, apiError, parseBody } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { getDb, schema } from "@/lib/db";
import { eliminarDocumento, reintentarDocumento, obtenerDocumento } from "@/server/kb/documents";
type Context = {
    params: Promise<{
        id: string;
    }>;
};
export const dynamic = "force-dynamic";
export const GET = withAuth(async (session, _req: Request, ctx: Context) => {
    const { id } = await ctx.params;
    const document = await obtenerDocumento(session.organizationId, id);
    if (!document)
        return apiError(404, "not_found", "Documento no encontrado.");
    const chunks = await getDb().select({ text: schema.kbEntry.content }).from(schema.kbEntry)
        .where(and(and(eq(schema.kbEntry.organizationId, session.organizationId), isNull(schema.kbEntry.demoSpaceId)), eq(schema.kbEntry.documentId, id)))
        .orderBy(asc(schema.kbEntry.createdAt), asc(schema.kbEntry.id)).limit(5);
    return Response.json({ document, preview: chunks.map(c => c.text).join("\n\n").slice(0, 10000) });
});
export const PATCH = withAuth(async (session, req: Request, ctx: Context) => {
    if (!canConfigure(session.role))
        return apiError(403, "forbidden", "Solo administración puede modificar documentos.");
    const { id } = await ctx.params;
    const body = await parseBody(req, z.object({ enabled: z.boolean() }));
    if (!body.ok)
        return body.response;
    const [document] = await getDb().update(schema.kbDocument).set({ enabled: body.data.enabled, updatedAt: new Date() }).where(and(and(eq(schema.kbDocument.organizationId, session.organizationId), isNull(schema.kbDocument.demoSpaceId)), eq(schema.kbDocument.id, id))).returning();
    return document ? Response.json({ document }) : apiError(404, "not_found", "Documento no encontrado.");
});
export const POST = withAuth(async (session, _req: Request, ctx: Context) => {
    if (!canConfigure(session.role))
        return apiError(403, "forbidden", "Solo administración puede recuperar documentos.");
    const { id } = await ctx.params;
    try {
        return Response.json({ document: await reintentarDocumento(session.organizationId, id) });
    }
    catch {
        return apiError(409, "processing", "El documento sigue procesándose o no requiere recuperación.");
    }
});
export const DELETE = withAuth(async (session, _req: Request, ctx: Context) => {
    if (!canConfigure(session.role))
        return apiError(403, "forbidden", "Solo administración puede eliminar documentos.");
    const { id } = await ctx.params;
    await eliminarDocumento(session.organizationId, id);
    return Response.json({ ok: true });
});
