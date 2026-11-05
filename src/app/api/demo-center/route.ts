import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { adminCommand, consultarEspacio, guardarEspacio, listarEspacios } from "@/server/demo-center";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Se requiere permiso de administración.");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ spaces: await listarEspacios(session) });
  if (id.length > 128) return apiError(422, "invalid_id", "Identificador inválido.");
  const detail = await consultarEspacio(session, id);
  return detail ? Response.json(detail) : apiError(404, "not_found", "Espacio no encontrado.");
});

export const POST = withAuth(async (session, req: Request) => {
  if (!canConfigure(session.role)) return apiError(403, "forbidden", "Se requiere permiso de administración.");
  if (req.headers.get("sec-fetch-site") === "cross-site" || !req.headers.get("content-type")?.startsWith("application/json")) {
    return apiError(403, "invalid_origin", "Solicitud no permitida.");
  }
  const input = await parseBody(req, adminCommand);
  if (!input.ok) return input.response;
  const result = await guardarEspacio(session, input.data).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return { outcome: "duplicate" } as const;
    }
    return { outcome: "internal" } as const;
  });
  switch (result.outcome) {
    case "duplicate": return apiError(409, "duplicate", "Ya existe un espacio con ese nombre.");
    case "expired": return apiError(422, "expired", "El vencimiento debe ser posterior a la fecha actual.");
    case "internal": return apiError(500, "internal", "No se pudo guardar la configuración.");
    case "missing": return apiError(404, "not_found", "Espacio no encontrado.");
    case "conflict": return apiError(409, "stale_version", "El espacio cambió. Actualiza los datos.");
    case "profile_required": return apiError(422, "profile_required", "Publica un perfil antes de activar el espacio.");
    case "saved": return Response.json(result, { status: input.data.action === "create" ? 201 : 200 });
  }
});
