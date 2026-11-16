import { apiError, parseBody, withAuth } from "@/lib/api";
import { comandoSchema } from "@/server/comercial/contracts";
import { comercialEjecutar, comercialEnabled, comercialLeer } from "@/server/comercial/service";
import { comercialError } from "@/server/comercial/http";
export const dynamic = "force-dynamic";
export const GET = withAuth(async (session,req: Request) => {
  if (!comercialEnabled()) return apiError(404,"not_found","No disponible");
  const url = new URL(req.url);
  try { return Response.json(await comercialLeer(session,url.searchParams.get("conversationId") ?? undefined,url.searchParams.get("cotizacionId") ?? undefined)); }
  catch (e) { return comercialError(e); }
});
export const POST = withAuth(async (session,req: Request) => {
  if (!comercialEnabled()) return apiError(404,"not_found","No disponible");
  if (req.headers.get("origin") !== new URL(process.env.APP_BASE_URL!).origin ||
      req.headers.get("sec-fetch-site") === "cross-site" || !req.headers.get("content-type")?.startsWith("application/json")) {
    return apiError(403,"invalid_origin","Solicitud no permitida");
  }
  const body = await parseBody(req,comandoSchema); if (!body.ok) return body.response;
  try { return Response.json(await comercialEjecutar(session,body.data)); }
  catch (e) { return comercialError(e); }
});
