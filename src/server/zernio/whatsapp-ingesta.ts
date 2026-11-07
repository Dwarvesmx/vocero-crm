import {getSql} from "@/lib/db";
import {applyStatusUpdate} from "@/server/inbox/status";
import { ingestInboundMessage } from "@/server/inbox/ingest";
import { obtenerZernioWhatsAppPorCuenta } from "@/server/zernio/whatsapp-credenciales";
import { normalizarEntranteWhatsAppZernio, permiteDespachoWhatsAppZernio, type EventoWhatsAppZernio } from "@/server/zernio/whatsapp-evento";
import { procesarSalienteWhatsAppZernio } from "@/server/zernio/whatsapp-saliente";

/** El worker solo recibe eventos autenticados y guardados por la ruta. */
export async function procesarEntranteWhatsAppZernio(payload: unknown): Promise<void> {
  const evento = payload as EventoWhatsAppZernio;
  const accountRef = evento.account.accountId ?? evento.account.id;
  if (!accountRef) throw new Error("Falta la cuenta de Zernio");
  const cred = await obtenerZernioWhatsAppPorCuenta(accountRef);
  if (!cred) throw new Error("Conexión de WhatsApp no disponible");
  if(['message.delivered','message.read','message.failed'].includes(evento.event)){
    const [known]=await getSql()`select m.id from message m join conversation c on c.id=m.conversation_id and c.organization_id=m.organization_id
     where m.organization_id=${cred.organizationId} and m.wa_message_id=${evento.message.platformMessageId} and m.direction='out' and c.channel_thread_ref=${evento.conversation.id}`;
    if(!known)throw new Error('Confirmación aún no correlacionada');
    await applyStatusUpdate(cred.organizationId,{id:evento.message.platformMessageId,status:evento.event.split('.')[1] as 'delivered'|'read'|'failed',timestamp:String(Math.floor(Date.parse(evento.statusAt!)/1000))});
    return;
  }
  if (evento.event === "message.sent") {
    await procesarSalienteWhatsAppZernio(cred.organizationId, evento);
    return;
  }
  const entrada = normalizarEntranteWhatsAppZernio(evento);
  if (!entrada || !entrada.text) throw new Error("Mensaje de WhatsApp no soportado");
  await ingestInboundMessage({
    organizationId: cred.organizationId, identity: entrada.identity,
    waMessageId: entrada.waMessageId, type: "text", text: entrada.text,
    timestamp: entrada.timestamp, threadRef: entrada.threadRef,
    // Esta etapa solo habilita atención manual; Nea se integra después.
    omitirDespacho: true, conservarOrden: true,
    despachoTransaccional: process.env.ZERNIO_NEA_DISPATCH_ENABLED === "true" && permiteDespachoWhatsAppZernio(evento),
  });
}
