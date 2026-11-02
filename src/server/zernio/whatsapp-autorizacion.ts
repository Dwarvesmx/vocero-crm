import { and, eq, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { descifrar } from "./whatsapp-credenciales";
import { enviarTextoWhatsAppZernio } from "./whatsapp-envio";

/** El commit de iniciado es el límite conservador de cancelación.
 * Comparte los bloqueos de fila con UPDATE de pausa, perfil y credenciales.
 * No se mantiene ninguna transacción durante HTTP. Nunca se recupera
 * iniciado reenviando: si murió el proceso, su resultado es incierto.
 */
export async function autorizarSalidaZernio(id: string) {
  if (process.env.ZERNIO_WHATSAPP_ENABLED !== "true" || process.env.ZERNIO_NEA_AUTO_ENABLED !== "true") return null;
  return getDb().transaction(async (tx) => {
    const [ref] = await tx.select().from(schema.zernioWhatsappOutbox).where(eq(schema.zernioWhatsappOutbox.id, id)).limit(1);
    if (!ref || ref.status !== "retenido") return null;
    // Orden de bloqueo constante. Los cambios de control usan UPDATE sobre
    // estas mismas filas y quedan serializados con esta autorización.
    const [conv] = await tx.select().from(schema.conversation).where(and(eq(schema.conversation.id, ref.conversationId), eq(schema.conversation.organizationId, ref.organizationId))).for("update");
    const [profile] = await tx.select().from(schema.agentProfile).where(eq(schema.agentProfile.organizationId, ref.organizationId)).for("update");
    const [cred] = await tx.select().from(schema.zernioWhatsappCredentials).where(eq(schema.zernioWhatsappCredentials.organizationId, ref.organizationId)).for("update");
    const [job] = await tx.select().from(schema.zernioWhatsappOutbox).where(eq(schema.zernioWhatsappOutbox.id, id)).for("update");
    if (!job || job.status !== "retenido") return null;
    const [msg] = await tx.select().from(schema.message).where(and(eq(schema.message.id, job.messageId), eq(schema.message.organizationId, job.organizationId))).limit(1);
    const now = new Date();
    const valid = conv && profile?.enabled && conv.aiEnabled && !conv.handoffAt && !conv.isTest &&
      conv.channel === "whatsapp" && conv.channelThreadRef === job.threadRef && cred?.accountRef === job.accountRef &&
      msg?.aiGenerated && msg.origin === "ai" && msg.conversationId === conv.id && msg.text && job.requestKey.startsWith("nea:") &&
      conv.lastInboundAt && now.getTime() - conv.lastInboundAt.getTime() >= 0 &&
      now.getTime() - conv.lastInboundAt.getTime() < 86400000 && now.getTime() - job.createdAt.getTime() < 23 * 3600000;
    if (!valid) {
      await tx.update(schema.zernioWhatsappOutbox).set({ status: "cancelado", updatedAt: now }).where(eq(schema.zernioWhatsappOutbox.id, id));
      await tx.update(schema.message).set({ status: "failed", error: "Salida automática cancelada por autorización vigente." }).where(eq(schema.message.id, job.messageId));
      return null;
    }
    const credentials = descifrar(cred!);
    const [started] = await tx.update(schema.zernioWhatsappOutbox).set({ status: "iniciado", attempts: job.attempts + 1,
      leasedUntil: new Date(now.getTime() + 120000), updatedAt: now }).where(eq(schema.zernioWhatsappOutbox.id, id)).returning();
    return { job: started!, text: msg!.text!, credentials };
  });
}

export async function liberarSalidaZernio(id: string) {
  const authorized = await autorizarSalidaZernio(id);
  if (!authorized) return;
  const { job, text, credentials } = authorized;
  let wamid: string;
  try {
    wamid = await enviarTextoWhatsAppZernio({ token: credentials.token, cuentaAutorizada: job.accountRef,
      conversationId: job.threadRef, texto: text, idempotencyKey: job.requestKey });
  } catch {
    await marcarIncierto(job.id, job.attempts);
    return;
  }
  await getDb().transaction(async (tx) => {
    const [done] = await tx.update(schema.zernioWhatsappOutbox).set({ status: "completado", leasedUntil: null, updatedAt: new Date() })
      .where(and(eq(schema.zernioWhatsappOutbox.id, job.id), eq(schema.zernioWhatsappOutbox.status, "iniciado"), eq(schema.zernioWhatsappOutbox.attempts, job.attempts))).returning();
    if (done) await tx.update(schema.message).set({ status: "sent", waMessageId: wamid, error: null }).where(eq(schema.message.id, job.messageId));
  });
}

async function marcarIncierto(id: string, attempts: number) {
  await getDb().transaction(async (tx) => {
    const [job] = await tx.update(schema.zernioWhatsappOutbox).set({ status: "incierto", leasedUntil: null, updatedAt: new Date() })
      .where(and(eq(schema.zernioWhatsappOutbox.id, id), eq(schema.zernioWhatsappOutbox.status, "iniciado"), eq(schema.zernioWhatsappOutbox.attempts, attempts))).returning();
    if (job) await tx.update(schema.message).set({ status: "failed", error: "Resultado externo incierto; conciliar antes de reenviar." }).where(eq(schema.message.id, job.messageId));
  });
}

export async function recuperarSalidasInciertasZernio() {
  const rows = await getDb().select().from(schema.zernioWhatsappOutbox).where(and(eq(schema.zernioWhatsappOutbox.status, "iniciado"), lte(schema.zernioWhatsappOutbox.leasedUntil, new Date())));
  for (const row of rows) await marcarIncierto(row.id, row.attempts);
}
