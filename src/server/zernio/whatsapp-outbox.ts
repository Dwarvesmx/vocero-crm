import { and, eq, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { MetaApiError } from "@/lib/meta/client";
import { publish } from "@/server/events/bus";
import { obtenerZernioWhatsAppPorOrg } from "@/server/zernio/whatsapp-credenciales";
import { enviarTextoWhatsAppZernio } from "@/server/zernio/whatsapp-envio";

const RESERVA_MS = 120_000;
const MAX_INTENTOS = 6;
// Zernio conserva la clave durante 24 h: no enviar de nuevo después de 23 h.
const MAX_EDAD_MS = 23 * 60 * 60 * 1000;
type Job = typeof schema.zernioWhatsappOutbox.$inferSelect;
const g = globalThis as typeof globalThis & { __zernioWaTimer?: ReturnType<typeof setInterval> };

/** Reintentos seguros con la MISMA clave, antes de que venza en Zernio. */
export function politicaEnvioZernio(status: number, attempts: number, edadMs: number) {
  const retry = (status === 0 || status === 408 || status === 409 || status === 429 || status >= 500) &&
    attempts < MAX_INTENTOS && edadMs < MAX_EDAD_MS;
  return { retry, demoraMs: Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 3_600_000) };
}

export async function encolarEnvioWhatsAppZernio(input: {
  organizationId: string; conversationId: string; accountRef: string;
  threadRef: string; text: string; requestKey: string;
}) {
  const db = getDb();
  const buscar = async () => (await db.select({ job: schema.zernioWhatsappOutbox, text: schema.message.text })
    .from(schema.zernioWhatsappOutbox).innerJoin(schema.message, eq(schema.message.id, schema.zernioWhatsappOutbox.messageId))
    .where(and(eq(schema.zernioWhatsappOutbox.organizationId, input.organizationId), eq(schema.zernioWhatsappOutbox.requestKey, input.requestKey))).limit(1))[0];
  const validar = (previo: NonNullable<Awaited<ReturnType<typeof buscar>>>) => {
    if (previo.job.conversationId !== input.conversationId || previo.text !== input.text ||
        previo.job.accountRef !== input.accountRef || previo.job.threadRef !== input.threadRef) {
      throw new Error("La clave ya corresponde a otra solicitud");
    }
    return previo.job.messageId;
  };
  const previo = await buscar();
  if (previo) return validar(previo);
  const messageId = newId("message");
  try { await db.transaction(async (tx) => {
    await tx.insert(schema.message).values({ id: messageId, organizationId: input.organizationId,
      conversationId: input.conversationId, direction: "out", type: "text", text: input.text,
      status: "pending", origin: "operator" });
    await tx.insert(schema.zernioWhatsappOutbox).values({ id: newId("dispatch"),
      organizationId: input.organizationId, conversationId: input.conversationId, messageId,
      accountRef: input.accountRef, threadRef: input.threadRef, requestKey: input.requestKey });
    await tx.update(schema.conversation).set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.conversation.id, input.conversationId), eq(schema.conversation.organizationId, input.organizationId)));
  }); } catch (error) {
    // Dos solicitudes simultáneas con la misma clave: el índice hace rollback
    // del perdedor; tras él se consulta la intención ganadora.
    const existente = await buscar();
    if (existente) return validar(existente);
    throw error;
  }
  iniciarEnviosWhatsAppZernio();
  return messageId;
}

function propietario(job: Job) {
  return and(eq(schema.zernioWhatsappOutbox.id, job.id), eq(schema.zernioWhatsappOutbox.status, "procesando"), eq(schema.zernioWhatsappOutbox.attempts, job.attempts));
}
export async function procesarEnvioZernioReservado(job: Job) {
  const db = getDb();
  try {
    if (job.attempts > MAX_INTENTOS) throw new MetaApiError("Límite de intentos agotado", { status: 400 });
    if (Date.now() - job.createdAt.getTime() >= MAX_EDAD_MS) throw new MetaApiError("Ventana de idempotencia agotada", { status: 400 });
    const cred = await obtenerZernioWhatsAppPorOrg(job.organizationId);
    if (!cred || cred.accountRef !== job.accountRef) throw new MetaApiError("Cuenta no disponible", { status: 400 });
    const [msg] = await db.select({ text: schema.message.text }).from(schema.message)
      .where(and(eq(schema.message.id, job.messageId), eq(schema.message.organizationId, job.organizationId))).limit(1);
    if (!msg?.text) throw new MetaApiError("Mensaje no disponible", { status: 400 });
    const wamid = await enviarTextoWhatsAppZernio({ token: cred.token, cuentaAutorizada: job.accountRef,
      conversationId: job.threadRef, texto: msg.text, idempotencyKey: job.requestKey });
    const confirmado = await db.transaction(async (tx) => {
      const [finished] = await tx.update(schema.zernioWhatsappOutbox).set({ status: "completado", leasedUntil: null, updatedAt: new Date() })
        .where(propietario(job)).returning({ id: schema.zernioWhatsappOutbox.id });
      if (finished) await tx.update(schema.message).set({ waMessageId: wamid, status: "sent" })
        .where(and(eq(schema.message.id, job.messageId), eq(schema.message.organizationId, job.organizationId)));
      return Boolean(finished);
    });
    if (confirmado) publish(job.organizationId, { type: "message.status", data: { conversationId: job.conversationId, messageId: job.messageId, status: "sent", error: null } });
  } catch (error) {
    const status = error instanceof MetaApiError ? error.status : 0;
    const { retry, demoraMs } = politicaEnvioZernio(status, job.attempts, Date.now() - job.createdAt.getTime());
    const marcado = await db.transaction(async (tx) => {
      const [updated] = await tx.update(schema.zernioWhatsappOutbox).set({ status: retry ? "pendiente" : "fallido", leasedUntil: null,
        notBefore: new Date(Date.now() + demoraMs), updatedAt: new Date() })
        .where(propietario(job)).returning({ id: schema.zernioWhatsappOutbox.id });
      if (updated && !retry) await tx.update(schema.message).set({ status: "failed", error: "No se pudo confirmar el envío; revisa antes de reenviar." })
        .where(and(eq(schema.message.id, job.messageId), eq(schema.message.organizationId, job.organizationId)));
      return Boolean(updated);
    });
    if (marcado && !retry) publish(job.organizationId, { type: "message.status", data: { conversationId: job.conversationId,
      messageId: job.messageId, status: "failed", error: "No se pudo confirmar el envío; revisa antes de reenviar." } });
  }
}

export async function barrerEnviosWhatsAppZernio() {
  if (process.env.ZERNIO_WHATSAPP_ENABLED !== "true") return;
  const db = getDb(), now = new Date();
  const candidates = await db.select().from(schema.zernioWhatsappOutbox).where(or(
    and(eq(schema.zernioWhatsappOutbox.status, "pendiente"), lte(schema.zernioWhatsappOutbox.notBefore, now)),
    and(eq(schema.zernioWhatsappOutbox.status, "procesando"), lte(schema.zernioWhatsappOutbox.leasedUntil, now))
  )).limit(20);
  for (const candidate of candidates) {
    const [job] = await db.update(schema.zernioWhatsappOutbox).set({ status: "procesando", attempts: candidate.attempts + 1,
      leasedUntil: new Date(Date.now() + RESERVA_MS), updatedAt: now })
      .where(and(eq(schema.zernioWhatsappOutbox.id, candidate.id), eq(schema.zernioWhatsappOutbox.status, candidate.status),
        eq(schema.zernioWhatsappOutbox.attempts, candidate.attempts),
        candidate.status === "pendiente" ? lte(schema.zernioWhatsappOutbox.notBefore, now) : lte(schema.zernioWhatsappOutbox.leasedUntil, now)))
      .returning();
    if (job) await procesarEnvioZernioReservado(job);
  }
}
export function iniciarEnviosWhatsAppZernio() {
  if (process.env.ZERNIO_WHATSAPP_ENABLED !== "true" || g.__zernioWaTimer) return;
  g.__zernioWaTimer = setInterval(() => { void barrerEnviosWhatsAppZernio().catch(() => {}); }, 10_000);
  g.__zernioWaTimer.unref?.();
  void barrerEnviosWhatsAppZernio().catch(() => {});
}
