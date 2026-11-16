import { apiError, parseBody } from "@/lib/api";
import { requireBotKey } from "@/server/bot/auth";
import { getSql } from "@/lib/db";
import { comandoSchema, type Actor } from "@/server/comercial/contracts";
import { comercialEjecutar, comercialEnabled, comercialLeer } from "@/server/comercial/service";
import { comercialError } from "@/server/comercial/http";
export const dynamic = "force-dynamic";
async function guard(req: Request, conversationId: string): Promise<Actor | Response> {
  if (!comercialEnabled() || process.env.COMERCIAL_BOT_ENABLED !== "true") return apiError(404,"not_found","No disponible");
  const key = requireBotKey(req); if (key) return key;
  const organizationId = process.env.COMERCIAL_BOT_ORG_ID;
  if (!organizationId) return apiError(403,"sin_ambito","Sin ámbito comercial autorizado");
  const [org] = await getSql()`select id from organization where id=${organizationId}`;
  if (!org) return apiError(403,"sin_ambito","Sin ámbito comercial autorizado");
  if (!conversationId) return apiError(422,"conversation_required","Indica la conversación");
  return { organizationId, role: "bot", conversationId };
}
export async function GET(req: Request) {
  const url = new URL(req.url); const conversationId = url.searchParams.get("conversationId") ?? "";
  const actor = await guard(req,conversationId); if (actor instanceof Response) return actor;
  // Ningún parámetro permite elegir otro espacio u organización.
  if ([...url.searchParams.keys()].some(k => !["conversationId","cotizacionId"].includes(k))) return apiError(422,"invalid_scope","Ámbito inválido");
  try { return Response.json(await comercialLeer(actor,conversationId,url.searchParams.get("cotizacionId") ?? undefined)); }
  catch(e) { return comercialError(e); }
}
export async function POST(req: Request) {
  // Autenticar antes de parsear o consultar recursos.
  const actor = await guard(req,"pending"); if (actor instanceof Response) return actor;
  const body = await parseBody(req,comandoSchema); if (!body.ok) return body.response;
  if (!("conversationId" in body.data)) return apiError(403,"sin_permiso","Operación no permitida");
  actor.conversationId = body.data.conversationId;
  try { return Response.json(await comercialEjecutar(actor,body.data)); }
  catch(e) { return comercialError(e); }
}
