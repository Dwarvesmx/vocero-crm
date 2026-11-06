import { apiRoot, OPENROUTER_BASE_URL } from "@/lib/ai/presets";
import { z } from "zod";
import { withAuth, apiError, parseBody } from "@/lib/api";
import { resolveAiProvider } from "@/lib/ai/provider";
import { canConfigure } from "@/lib/auth/roles";
import { simulatorCommand, simulatorRead, SimulatorError, configuredDemoProvider, realDemoSend, reconcileDemoOperation } from "@/server/demo-center";
const id = z.string().min(1).max(128);
const command = z.discriminatedUnion("action", [
  z.object({action:z.literal("start"),spaceId:id,requestKey:id}).strict(),
  z.object({action:z.literal("send"),spaceId:id,sessionId:id,requestKey:id,text:z.string().trim().min(1).max(2000),provider:z.enum(["openrouter","simulated"]).default("openrouter")}).strict(),
  z.object({action:z.literal("reconcile"),spaceId:id,operationId:id}).strict(),
  z.object({action:z.literal("close"),spaceId:id,sessionId:id}).strict(),
]);
function failure(error: unknown) {
  const messages:Record<string,string> = {
    real_not_enabled:"La IA real está deshabilitada. El administrador debe aprobar los controles y habilitar DEMO_REAL_ENABLED.",
    openrouter_required:"Configura una credencial activa y un modelo OpenRouter en Ajustes → IA.",
    model_price_unavailable:"El modelo no aparece en el catálogo de precios del proveedor.",
    price_unverifiable:"La tarifa o capacidad publicada no permite verificar una reserva segura.",
    openrouter_unavailable:"El proveedor no está disponible para consultar tarifas. Intenta más tarde.",
    context_too_large:"El contexto supera la capacidad segura del modelo. Inicia una sesión nueva o reduce el contenido.",
    quote_unverifiable:"No se pudo verificar una cota segura de precio para el modelo. No se realizó una llamada de generación.",
    budget_exceeded:"El presupuesto disponible no cubre la reserva máxima del modelo.",
    session_budget_required:"Configura un presupuesto positivo por sesión e inicia una sesión nueva.",
    operation_pending:"Esta sesión tiene una operación pendiente de conciliación.",
    generation_id_missing:"El proveedor no devolvió un identificador. La reserva sigue protegida; no se reenviará la solicitud.",
    cost_breach_review_required:"Existe un costo que excede su reserva. Se requiere revisión antes de continuar.",
    policy_required:"Configura políticas global y de espacio habilitadas, con ventana vigente y límites positivos.",
    session_unavailable:"La sesión está cerrada, vencida o el espacio está desactivado.",
  };
  return error instanceof SimulatorError ? apiError(error.status,error.code,messages[error.code] ?? "Operación bloqueada: "+error.code)
    : apiError(500,"simulator_error","No se pudo completar la simulación.");
}
export const GET = withAuth(async (actor, req: Request) => {
  if (!canConfigure(actor.role)) return apiError(403,"forbidden","Se requiere administración.");
  const params = new URL(req.url).searchParams;
  if (params.get("status") === "1") {
    try {
      const resolved = await resolveAiProvider(actor.organizationId);
      const isOpenRouter = resolved.ok && apiRoot(resolved.provider.baseUrl) === apiRoot(OPENROUTER_BASE_URL);
      return Response.json({ enabled: process.env.DEMO_REAL_ENABLED === "true",
        model: isOpenRouter ? resolved.provider.model : null, configured: isOpenRouter });
    } catch {
      return apiError(503, "provider_status_unavailable", "No se pudo consultar la configuración de IA.");
    }
  }
  const parsed = z.object({spaceId:id,sessionId:id.optional()}).safeParse({spaceId:params.get("spaceId"),sessionId:params.get("sessionId") ?? undefined});
  if (!parsed.success) return apiError(422,"invalid","Identificador inválido.");
  try { return Response.json(await simulatorRead(actor,parsed.data.spaceId,parsed.data.sessionId)); } catch(e) { return failure(e); }
});
export const POST = withAuth(async (actor, req: Request) => {
  if (!canConfigure(actor.role) || req.headers.get("sec-fetch-site")==="cross-site" || !req.headers.get("content-type")?.startsWith("application/json"))
    return apiError(403,"forbidden","Solicitud no permitida.");
  const body = await parseBody(req,command);
  if (!body.ok) return body.response;
  try {
    if(body.data.action==="reconcile")return Response.json(await reconcileDemoOperation(actor,body.data.spaceId,body.data.operationId,await configuredDemoProvider(actor.organizationId)));
    if(body.data.action==="send" && body.data.provider==="openrouter")return Response.json(await realDemoSend(actor,body.data,await configuredDemoProvider(actor.organizationId)));
    if(body.data.action==="send" && process.env.DEMO_SIMULATED_ENABLED!=="true")return apiError(403,"diagnostic_disabled","Modo de diagnóstico deshabilitado.");
    return Response.json(await simulatorCommand(actor,body.data));
  } catch(e) { return failure(e); }
});
