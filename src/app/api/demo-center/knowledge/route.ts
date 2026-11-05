import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { demoKnowledge, modifyDemoKnowledge, recoverDemoDocument, uploadDemoDocument } from "@/server/demo-center";
import { readDocumentUpload } from "@/server/kb/upload";

const id = z.string().min(1).max(128);
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("manual"), content: z.string().trim().min(1).max(8000) }).strict(),
  z.object({ action: z.literal("toggle"), id, enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("recover"), id }).strict(),
]);
const missing = () => apiError(404, "not_found", "Recurso no encontrado.");
const forbidden = () => apiError(403, "forbidden", "Se requiere permiso de administración.");

export const GET = withAuth(async (session, req: Request) => {
  if (!canConfigure(session.role)) return forbidden();
  const params = new URL(req.url).searchParams;
  const space = id.safeParse(params.get("space"));
  if (!space.success) return missing();
  const data = await demoKnowledge(session, space.data, params.get("query")?.slice(0, 500));
  return data ? Response.json(data) : missing();
});

export const POST = withAuth(async (session, req: Request) => {
  if (!canConfigure(session.role) || req.headers.get("sec-fetch-site") === "cross-site") return forbidden();
  const space = id.safeParse(new URL(req.url).searchParams.get("space"));
  if (!space.success) return missing();
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.startsWith("multipart/form-data")) {
      // La carga exige la cabecera personalizada de la interfaz (no es un POST simple de navegador).
      if (req.headers.get("x-demo-center") !== "1") return forbidden();
      const file = await readDocumentUpload(req);
      if (file instanceof Response) return file;
      const document = await uploadDemoDocument(session, space.data, file);
      return document ? Response.json({ document }, { status: 201 }) : missing();
    }
    if (!type.startsWith("application/json")) return forbidden();
    const body = await parseBody(req, commandSchema);
    if (!body.ok) return body.response;
    if (body.data.action === "recover") {
      const documentId = body.data.id;
      const current = await demoKnowledge(session, space.data);
      if (!current?.documents.some(doc => doc.id === documentId)) return missing();
      return Response.json({ document: await recoverDemoDocument(session, space.data, body.data.id) });
    }
    return await modifyDemoKnowledge(session, space.data, body.data) ? Response.json({ ok: true }) : missing();
  } catch {
    return apiError(422, "knowledge_error", "No se pudo guardar. Revisa el formato y el estado del documento.");
  }
});
