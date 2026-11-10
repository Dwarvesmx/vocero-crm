import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { ofrecerDemoWhatsApp } from "@/server/demo-center/infra/whatsapp-offer";
import { SimulatorError } from "@/server/demo-center/infra/simulator";

const request = z.object({
  contractVersion: z.literal(1), conversationId: z.string().min(1).max(128),
  dispatchId: z.string().min(1).max(128), sector: z.string().trim().min(1).max(128).optional(),
}).strict();

export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;
  const body = await parseBody(req, request);
  if (!body.ok) return body.response;
  const org = await resolveInstanceOrg();
  if (!org) return apiError(404, "not_found", "No disponible.");
  try {
    return Response.json(await ofrecerDemoWhatsApp(org, body.data.conversationId, body.data.dispatchId, body.data.sector),
      { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return e instanceof SimulatorError ? apiError(e.status, e.code, "No se pudo ofrecer la demo.") :
      apiError(503, "offer_unavailable", "No se pudo ofrecer la demo.");
  }
}
