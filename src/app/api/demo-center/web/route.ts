import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { SimulatorError } from "@/server/demo-center";
import { conciliarAvisoWhatsApp, conciliarDemoWeb, conciliarWhatsAppWeb, invitarDemoWeb, listarDemosWeb, revocarDemoWeb, webHabilitada } from "@/server/demo-center/infra/web";
import { restituirWhatsApp } from "@/server/demo-center/infra/whatsapp-link";

const headers = { "Cache-Control": "private, no-store" };
const id = z.string().min(1).max(128);
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invite"), spaceId: id, phone: z.string().trim().min(7).max(16).optional() }).strict(),
  z.object({ action: z.literal("revoke"), spaceId: id, sessionId: id }).strict(),
  z.object({ action: z.literal("reconcileNotice"), spaceId: id, noticeId: id }).strict(),
  z.object({ action: z.literal("reconcile"), spaceId: id, operationId: id }).strict(),
  z.object({ action: z.literal("restoreWhatsApp"), spaceId: id, sessionId: id, generation: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("reconcileWhatsApp"), spaceId: id, operationId: id, kind: z.enum(["financial", "delivery"]) }).strict(),
]);

export const GET = withAuth(async (actor, req: Request) => {
  if (!canConfigure(actor.role)) return apiError(403, "forbidden", "Se requiere administración.");
  const scope = id.safeParse(new URL(req.url).searchParams.get("spaceId"));
  if (!scope.success) return apiError(422, "invalid", "Espacio inválido.");
  return Response.json({ enabled: webHabilitada(), sessions: await listarDemosWeb(actor, scope.data) }, { headers });
});
export const POST = withAuth(async (actor, req: Request) => {
  if (!canConfigure(actor.role) || req.headers.get("sec-fetch-site") === "cross-site" ||
      req.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return apiError(403, "forbidden", "Solicitud no permitida.");
  }
  const body = await parseBody(req, command);
  if (!body.ok) return body.response;
  try {
    const { data } = body;
    if (data.action === "invite") return Response.json(await invitarDemoWeb(actor, data.spaceId, data.phone), { headers });
    if (data.action === "reconcileNotice") return Response.json(await conciliarAvisoWhatsApp(actor, data.spaceId, data.noticeId), { headers });
    if (data.action === "reconcile") return Response.json(await conciliarDemoWeb(actor, data.spaceId, data.operationId), { headers });
    if (data.action === "reconcileWhatsApp") return Response.json(await conciliarWhatsAppWeb(actor, data.spaceId, data.operationId, data.kind), { headers });
    if (data.action === "restoreWhatsApp") await restituirWhatsApp(actor, data.spaceId, data.sessionId, data.generation);
    else await revocarDemoWeb(actor, data.spaceId, data.sessionId);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    const code = error instanceof SimulatorError ? error.code : "unavailable";
    return Response.json({ error: code }, { status: error instanceof SimulatorError ? error.status : 503, headers });
  }
});
