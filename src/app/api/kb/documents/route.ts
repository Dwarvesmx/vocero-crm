import { asc, eq } from "drizzle-orm";
import { withAuth, apiError } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { getDb, schema } from "@/lib/db";
import { cargarDocumento } from "@/server/kb/documents";
import { MAX_DOCUMENT_BYTES } from "@/server/kb/extract";
export const dynamic = "force-dynamic";
export const GET = withAuth(async (session) => {
    const documents = await getDb().select().from(schema.kbDocument).where(eq(schema.kbDocument.organizationId, session.organizationId)).orderBy(asc(schema.kbDocument.createdAt));
    return Response.json({ documents });
});
export const POST = withAuth(async (session, req: Request) => {
    if (!canConfigure(session.role))
        return apiError(403, "forbidden", "Solo administración puede cargar documentos.");
    const length = Number(req.headers.get("content-length"));
    if (length > MAX_DOCUMENT_BYTES + 65536)
        return apiError(413, "too_large", "Máximo 5 MB por documento.");
    // El límite también se aplica sin Content-Length (cuerpo fragmentado).
    if (!req.body)
        return apiError(422, "invalid_file", "Falta el archivo.");
    const reader = req.body.getReader(), parts: Uint8Array[] = [];
    let received = 0;
    while (true) {
        const part = await reader.read();
        if (part.done)
            break;
        received += part.value.length;
        if (received > MAX_DOCUMENT_BYTES + 65536) {
            await reader.cancel();
            return apiError(413, "too_large", "Máximo 5 MB por documento.");
        }
        parts.push(part.value);
    }
    let form: FormData;
    try {
        form = await new Response(new Uint8Array(Buffer.concat(parts)), { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
    }
    catch {
        return apiError(422, "invalid_file", "El formulario no es válido.");
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size > MAX_DOCUMENT_BYTES)
        return apiError(422, "invalid_file", "Selecciona PDF con texto, DOCX o TXT de hasta 5 MB.");
    try {
        return Response.json({ document: await cargarDocumento(session.organizationId, file.name, file.type, Buffer.from(await file.arrayBuffer())) }, { status: 201 });
    }
    catch {
        return apiError(422, "invalid_document", "No se pudo cargar: revisa formato, límites y almacenamiento.");
    }
});
