import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { globalCommand, guardarPoliticaGlobal } from "@/server/demo-center";

export const POST = withAuth(async (session, req: Request) => {
  if (!canConfigure(session.role) || req.headers.get("sec-fetch-site") === "cross-site"
    || !req.headers.get("content-type")?.startsWith("application/json"))
    return apiError(403, "forbidden", "Solicitud no permitida.");
  const input = await parseBody(req, globalCommand);
  if (!input.ok) return input.response;
  const result = await guardarPoliticaGlobal(session, input.data).catch(() => ({ outcome: "internal" } as const));
  switch (result.outcome) {
    case "saved": return Response.json(result);
    case "conflict": return apiError(409, "stale_version", "La política cambió. Actualiza los datos.");
    case "missing": return apiError(404, "not_found", "Espacio no encontrado.");
    case "expired": return apiError(422, "expired", "Indica un vencimiento futuro.");
    case "internal": return apiError(500, "internal", "No se pudo guardar la política.");
  }
});
