import { asc, eq, and, isNull } from "drizzle-orm";
import { withAuth, apiError } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { getDb, schema } from "@/lib/db";
import { cargarDocumento } from "@/server/kb/documents";
import { readDocumentUpload } from "@/server/kb/upload";
export const dynamic = "force-dynamic";
export const GET = withAuth(async (session) => {
    const documents = await getDb().select().from(schema.kbDocument).where(and(eq(schema.kbDocument.organizationId, session.organizationId), isNull(schema.kbDocument.demoSpaceId))).orderBy(asc(schema.kbDocument.createdAt));
    return Response.json({ documents });
});
export const POST = withAuth(async (session, req: Request) => {
    if (!canConfigure(session.role))
        return apiError(403, "forbidden", "Solo administración puede cargar documentos.");
    const file = await readDocumentUpload(req);
    if (file instanceof Response) return file;
    try {
        return Response.json({ document: await cargarDocumento(session.organizationId, file.name, file.type, Buffer.from(await file.arrayBuffer())) }, { status: 201 });
    }
    catch {
        return apiError(422, "invalid_document", "No se pudo cargar: revisa formato, límites y almacenamiento.");
    }
});
