import { ingestInboundMessage } from "@/server/inbox/ingest";
import { obtenerZernioWhatsAppPorCuenta } from "@/server/zernio/whatsapp-credenciales";
import { normalizarEntranteWhatsAppZernio, type EventoWhatsAppZernio } from "@/server/zernio/whatsapp-evento";
import { procesarSalienteWhatsAppZernio } from "@/server/zernio/whatsapp-saliente";

/** El worker solo recibe eventos autenticados y guardados por la ruta. */
export async function procesarEntranteWhatsAppZernio(payload: unknown): Promise<void> {
  const evento = payload as EventoWhatsAppZernio;
  const accountRef = evento.account.accountId ?? evento.account.id;
  if (!accountRef) throw new Error("Falta la cuenta de Zernio");
  const cred = await obtenerZernioWhatsAppPorCuenta(accountRef);
  if (!cred) throw new Error("Conexión de WhatsApp no disponible");
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
  });
}
