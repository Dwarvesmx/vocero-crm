import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { fetchZernioAccounts } from "@/server/zernio/cuentas";
import { eliminarZernioWhatsApp, guardarZernioWhatsApp, obtenerZernioWhatsAppPorOrg } from "@/server/zernio/whatsapp-credenciales";

export const dynamic = "force-dynamic";
const habilitado = () => process.env.ZERNIO_WHATSAPP_ENABLED === "true";
const schema = z.object({
  token: z.string().trim().min(1),
  secreto: z.string().trim().min(1),
  accountRef: z.string().trim().min(1),
});

export const GET = withAuth(async (session) => {
  if (!habilitado()) return new Response(null, { status: 404 });
  if (session.role !== "owner") return apiError(403, "forbidden", "Solo el propietario puede gestionar esta conexión");
  const cred = await obtenerZernioWhatsAppPorOrg(session.organizationId);
  return Response.json({ connection: cred ? { accountRef: cred.accountRef, tokenLast4: cred.token.slice(-4), hasWebhookSecret: true } : null });
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!habilitado()) return new Response(null, { status: 404 });
  if (session.role !== "owner") return apiError(403, "forbidden", "Solo el propietario puede gestionar esta conexión");
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  let cuentas;
  try { cuentas = await fetchZernioAccounts(body.data.token); }
  catch { return apiError(503, "zernio_unavailable", "No se pudo comprobar la cuenta de Zernio"); }
  const cuenta = cuentas.find((c) => c._id === body.data.accountRef && c.platform?.toLowerCase() === "whatsapp" && c.isActive !== false);
  if (!cuenta) return apiError(422, "unknown_account", "La cuenta seleccionada no está disponible como WhatsApp");
  await guardarZernioWhatsApp({ organizationId: session.organizationId, ...body.data });
  // El webhook se registra explícitamente más adelante, nunca al guardar.
  return Response.json({ ok: true, accountRef: cuenta._id });
});

export const DELETE = withAuth(async (session) => {
  if (!habilitado()) return new Response(null, { status: 404 });
  if (session.role !== "owner") return apiError(403, "forbidden", "Solo el propietario puede gestionar esta conexión");
  await eliminarZernioWhatsApp(session.organizationId);
  return Response.json({ ok: true });
});
