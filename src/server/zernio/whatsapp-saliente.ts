import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getOrCreateContactByIdentity, parseIdentity } from "@/server/inbox/identity";
import { getOrCreateConversation, serializeMessage } from "@/server/inbox/ingest";
import { publish } from "@/server/events/bus";
import type { EventoWhatsAppZernio } from "@/server/zernio/whatsapp-evento";

/** Un eco no implica que una persona haya tomado control de la conversación. */
export async function procesarSalienteWhatsAppZernio(organizationId: string, evento: EventoWhatsAppZernio): Promise<void> {
  if (evento.event !== "message.sent" || evento.message.direction !== "outgoing") throw new Error("Evento saliente inválido");
  const db = getDb();
  const id = evento.message.platformMessageId;
  const [existente] = await db.select({ message: schema.message, conversation: schema.conversation })
    .from(schema.message).innerJoin(schema.conversation, eq(schema.message.conversationId, schema.conversation.id))
    .where(and(eq(schema.message.organizationId, organizationId), eq(schema.message.waMessageId, id))).limit(1);
  if (existente) {
    if (existente.message.direction !== "out" || existente.conversation.channelThreadRef !== evento.conversation.id) throw new Error("El mensaje no corresponde al hilo autorizado");
    return;
  }
  // Los ecos de la API pueden llegar antes de que el outbox guarde el wamid.
  // No adivinar la correspondencia por texto ni crear un duplicado.
  if (evento.message.source !== "whatsapp_business_app") throw new Error("Saliente externo aún no conciliado");
  if (!evento.message.text) throw new Error("Saliente sin texto no soportado");
  const hilos = await db.select().from(schema.conversation).where(and(
    eq(schema.conversation.organizationId, organizationId), eq(schema.conversation.channel, "whatsapp"),
    eq(schema.conversation.channelThreadRef, evento.conversation.id), eq(schema.conversation.isTest, false)
  )).limit(2);
  if (hilos.length > 1) throw new Error("Hilo ambiguo");
  let conversation = hilos[0];
  if (!conversation) {
    const participant = evento.conversation.participantId;
    if (!participant || !(/^(\+?\d{7,15}|bsuid:.+)$/.test(participant))) throw new Error("Identidad de conversación no disponible");
    const identity = parseIdentity(participant.replace(/^\+/, ""));
    if (!identity) throw new Error("Identidad inválida");
    const { contact } = await getOrCreateContactByIdentity(organizationId, identity);
    conversation = await getOrCreateConversation(organizationId, contact.id);
    if (conversation.channelThreadRef && conversation.channelThreadRef !== evento.conversation.id) throw new Error("El contacto ya tiene otro hilo");
    if (!conversation.channelThreadRef) {
      const [asignado] = await db.update(schema.conversation).set({ channelThreadRef: evento.conversation.id }).where(and(
        eq(schema.conversation.id, conversation.id), eq(schema.conversation.organizationId, organizationId), sql`${schema.conversation.channelThreadRef} is null`
      )).returning({ id: schema.conversation.id });
      if (!asignado) throw new Error("La asociación del hilo cambió; se reintentará");
    }
  }
  const fecha = new Date(evento.message.sentAt);
  const message = await db.transaction(async (tx) => {
    const [insertado] = await tx.insert(schema.message).values({ id: newId("message"), organizationId,
      conversationId: conversation.id, waMessageId: id, direction: "out", type: "text", text: evento.message.text,
      status: "sent", origin: "manual", waTimestamp: fecha }).onConflictDoNothing({ target: schema.message.waMessageId }).returning();
    if (insertado) await tx.update(schema.conversation).set({
      lastMessageAt: sql`greatest(${schema.conversation.lastMessageAt}, ${fecha.toISOString()}::timestamp)`, updatedAt: new Date(),
    }).where(and(eq(schema.conversation.organizationId, organizationId), eq(schema.conversation.id, conversation.id)));
    return insertado;
  });
  if (message) {
    publish(organizationId, { type: "message.new", data: { conversationId: conversation.id, message: serializeMessage(message, null, null) } });
    publish(organizationId, { type: "conversation.updated", data: { conversation: { id: conversation.id } } });
  }
}
