import { randomBytes } from "node:crypto";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getSql } from "@/lib/db";
import { fetchZernioAccounts, zernioAccountName, type ZernioAccount } from "@/server/zernio/cuentas";
import { fetchZernioWebhooks } from "@/server/zernio/webhooks";
import { zernioFetch } from "@/server/zernio";
import { guardarZernioWhatsApp, obtenerZernioWhatsAppPorOrg } from "@/server/zernio/whatsapp-credenciales";

export const dynamic = "force-dynamic";
const input = z.object({ token: z.string().trim().max(4096).optional(), accountRef: z.string().trim().min(1).max(256), confirmation: z.string(), enabled: z.boolean().optional() });
function cuentasModoNext(accounts: ZernioAccount[]) {
  return accounts.filter(a => a.platform?.toLowerCase() === "whatsapp" && a.isActive !== false && a.enabled !== false && !a.needsReconnection &&
    !/ghinversiones/i.test(`${a.displayName ?? ""} ${a.username ?? ""}`.replace(/[^a-z0-9]/gi, "")) && /modonext/i.test(`${a.displayName ?? ""} ${a.username ?? ""}`.replace(/[^a-z0-9]/gi, "")));
}
function origin(req: Request) { return req.headers.get("origin") === new URL(req.url).origin; }
const endpoint = () => `${process.env.APP_BASE_URL?.replace(/\/$/, "")}/api/webhooks/zernio-whatsapp`;
const owner = (role: string) => role === "owner";
const unavailable = () => apiError(503, "zernio_unavailable", "Zernio no respondió. No se ha confirmado la operación; comprueba el estado antes de repetirla.");
export const GET = withAuth(async session => {
  if (!owner(session.role)) return apiError(403, "forbidden", "Solo el propietario puede administrar Zernio");
  const c = await obtenerZernioWhatsAppPorOrg(session.organizationId, true);
  return Response.json({ connection: c ? { accountRef: c.accountRef, tokenLast4: c.token.slice(-4), enabled: c.enabled, webhookPending: c.webhookPending } : null,
    available: process.env.ZERNIO_WHATSAPP_ENABLED === "true", webhookUrl: endpoint(), webhookEvents: ["message.received", "message.sent"] }, { headers: { "Cache-Control": "no-store" } });
});
export const PUT = withAuth(async (session, req: Request) => {
  if (!owner(session.role)) return apiError(403, "forbidden", "Solo el propietario puede administrar Zernio");
  if (!origin(req)) return apiError(403, "origin", "Origen no permitido");
  const b = await parseBody(req, input); if (!b.ok) return b.response;
  if (b.data.confirmation !== b.data.accountRef) return apiError(422, "confirmation", "Confirma el identificador completo de la cuenta ModoNext");
  const previous = await obtenerZernioWhatsAppPorOrg(session.organizationId, true);
  const token = b.data.token || previous?.token;
  if (!token) return apiError(422, "token_required", "Introduce la API key");
  try {
    const a = cuentasModoNext(await fetchZernioAccounts(token)).find(a => a._id === b.data.accountRef);
    if (!a) return apiError(422, "unknown_account", "Selecciona una cuenta WhatsApp activa identificada como ModoNext; otras cuentas están excluidas");
    // Guardar nunca activa el canal ni registra un webhook. Conserva secreto al editar.
    await guardarZernioWhatsApp({ organizationId: session.organizationId, accountRef: a._id, token,
      secreto: previous?.accountRef === a._id ? previous.secreto : randomBytes(32).toString("hex"), enabled: false });
    return Response.json({ ok: true, enabled: false });
  } catch { return unavailable(); }
});
export const POST = withAuth(async (session, req: Request) => {
  if (!owner(session.role)) return apiError(403, "forbidden", "Solo el propietario puede administrar Zernio");
  if (!origin(req)) return apiError(403, "origin", "Origen no permitido");
  const b = await parseBody(req, z.object({ action: z.enum(["accounts", "test", "webhook"]), token: z.string().trim().max(4096).optional(), accountRef: z.string().optional(), confirmation: z.string().optional() }));
  if (!b.ok) return b.response;
  const c = await obtenerZernioWhatsAppPorOrg(session.organizationId, true);
  const token = b.data.token || c?.token; if (!token) return apiError(422, "token_required", "Introduce o guarda una API key");
  try {
    const accounts = cuentasModoNext(await fetchZernioAccounts(token));
    if (b.data.action === "accounts") return Response.json({ accounts: accounts.map(a => ({ id: a._id, name: zernioAccountName(a) })) });
    if (!c || !accounts.some(a => a._id === c.accountRef)) return apiError(422, "unknown_account", "La cuenta guardada no está disponible como ModoNext");
    const url = endpoint(); if (!url.startsWith("https://")) return apiError(422, "https_required", "El webhook requiere APP_BASE_URL con HTTPS");
    // Serializa el registro entre procesos y reconsulta antes de cada creación.
    return await getSql().begin(async sql => {
      await sql`select pg_advisory_xact_lock(hashtext(${"zernio-config:" + session.organizationId}))`;
      const fresh = await obtenerZernioWhatsAppPorOrg(session.organizationId, true);
      if (!fresh || fresh.accountRef !== c.accountRef) return apiError(409, "configuration_changed", "La configuración cambió. Recarga antes de continuar");
      const all = await fetchZernioWebhooks(c.token);
      const matching = all.filter(w => w.url === url);
      const name = `Vocero WhatsApp ${session.organizationId}`;
      const owned = matching.find(w => w.name === name && w.accountIds?.length === 1 && w.accountIds[0] === c.accountRef);
      if (matching.some(w => w !== owned)) return apiError(409, "webhook_conflict", "Existe otro webhook en esta URL. No se modificó; revísalo antes de continuar");
      if (owned && b.data.action === "test") await sql`update zernio_whatsapp_credentials set webhook_pending=false where organization_id=${session.organizationId}`;
      if (b.data.action === "test") return Response.json({ ok: true, webhook: owned ? { id: owned._id, active: owned.isActive !== false, events: owned.events, failureCount: owned.failureCount ?? 0 } : null });
      if (b.data.confirmation !== c.accountRef) return apiError(422, "confirmation", "Confirma la cuenta antes de registrar el webhook");
      if (fresh.webhookPending && !owned) return apiError(409, "webhook_uncertain", "Hay un registro anterior de resultado incierto. Comprueba su estado en Zernio antes de crear otro");
      // Se confirma fuera de la transacción de reserva para sobrevivir a timeout/reinicio.
      await getSql()`update zernio_whatsapp_credentials set webhook_pending=true where organization_id=${session.organizationId}`;
      await zernioFetch("/webhooks/settings", { token: c.token, method: owned ? "PUT" : "POST", timeoutMs: 10000,
        body: { ...(owned ? { webhookId: owned._id } : {}), name, url, secret: c.secreto, accountIds: [c.accountRef], events: ["message.received", "message.sent"], isActive: true } });
      await sql`update zernio_whatsapp_credentials set webhook_pending=false where organization_id=${session.organizationId}`;
      return Response.json({ ok: true, created: !owned });
    });
  } catch { return unavailable(); }
});
export const PATCH = withAuth(async (session, req: Request) => {
  if (!owner(session.role)) return apiError(403, "forbidden", "Solo el propietario puede administrar Zernio");
  if (!origin(req)) return apiError(403, "origin", "Origen no permitido");
  const b = await parseBody(req, z.object({ enabled: z.boolean(), confirmation: z.string().optional() })); if (!b.ok) return b.response;
  // La desactivación es local: no desconecta WhatsApp Business ni cambia Meta/Zernio.
  const c = await obtenerZernioWhatsAppPorOrg(session.organizationId, true);
  if (!c) return apiError(422, "not_configured", "Guarda primero la conexión");
  if (b.data.enabled) {
    if (process.env.ZERNIO_WHATSAPP_ENABLED !== "true") return apiError(409, "disabled", "El canal está deshabilitado en esta instalación");
    if (b.data.confirmation !== c.accountRef) return apiError(422, "confirmation", "Confirma la cuenta");
    try { if (!cuentasModoNext(await fetchZernioAccounts(c.token)).some(a => a._id === c.accountRef)) return apiError(422, "unknown_account", "La cuenta autorizada ya no está disponible"); }
    catch { return unavailable(); }
  }
  await guardarZernioWhatsApp({ ...c, enabled: b.data.enabled });
  return Response.json({ ok: true, enabled: b.data.enabled });
});
