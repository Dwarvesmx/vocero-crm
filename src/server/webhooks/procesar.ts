import type { WebhookPayload } from "@/server/inbox/webhook";
import { processEchoesValue, processMessagesValue } from "@/server/inbox/ingest";
import { processTemplateStatusValue } from "@/server/whatsapp/template-events";
import { processMetaInstagramPayload } from "@/server/instagram/ingest";
import { processMetaPagePayload } from "@/server/messenger/ingest";
import { processZernioPayload } from "@/server/zernio/dispatch";
import { procesarEntranteWhatsAppZernio } from "@/server/zernio/whatsapp-ingesta";
import { lanzarFalloDePrueba } from "@/server/dev/webhook-fallo";
import type { FuenteWebhook } from "./eventos";

/**
 * 047 — Quién procesa cada evento guardado. Antes cada ruta llamaba a su
 * procesador dentro de un `after()`; ahora lo llaman igual la ruta (en el
 * caso normal) y el barrido (al reintentar), así que vive en un solo lugar.
 *
 * Lanza si el procesamiento falla: eso es lo que hace que se reintente. Lo
 * que la ingesta descarta a propósito (un tipo no soportado, un mensaje sin
 * identidad) no lanza y no se reintenta.
 */
export async function procesarFuente(
  fuente: FuenteWebhook,
  payload: unknown
): Promise<void> {
  // Solo con mocks: el arnés E2E inyecta fallos aquí (no-op en producción).
  lanzarFalloDePrueba();
  switch (fuente) {
    case "whatsapp":
      return procesarWhatsapp(payload as WebhookPayload);
    case "meta_instagram":
      return processMetaInstagramPayload(payload);
    case "meta_messenger":
      return processMetaPagePayload(payload);
    case "zernio":
      return processZernioPayload(payload);
    case "zernio_whatsapp":
      try { return await procesarEntranteWhatsAppZernio(payload); }
      catch { throw new Error("No se pudo procesar el evento de Zernio"); }
  }
}

/** El cuerpo de un webhook de WhatsApp: mensajes, echos de coexistence y estados de plantillas. */
async function procesarWhatsapp(payload: WebhookPayload): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (!change.value) continue;
      if (change.field === "messages") {
        await processMessagesValue(change.value);
      } else if (change.field === "smb_message_echoes") {
        // 008: mensajes enviados a mano desde la app del teléfono (coexistence)
        await processEchoesValue(change.value);
      } else if (change.field === "message_template_status_update") {
        await processTemplateStatusValue(entry.id ?? null, change.value);
      }
      // otros fields: ignorar sin error
    }
  }
}
