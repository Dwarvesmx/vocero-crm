import {commercialMessageScope} from "@/server/inbox/message-scope";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { WebhookMessage } from "@/server/inbox/webhook";

/**
 * 039 — Responder citando un mensaje.
 *
 * Se guarda el `wamid` del citado (`message.reply_to_wa_message_id`), no su id
 * local: el citado puede no estar en el CRM (anterior a la instalación, o de
 * un tipo que la ingesta ignora). Se resuelve al leer, por lote.
 */

type MessageRow = typeof schema.message.$inferSelect;
type MediaRow = typeof schema.mediaAsset.$inferSelect;

export type CitaEncontrada = { message: MessageRow; media: MediaRow | null };

/** Lo que la burbuja enseña arriba. Con `id: null` el original no está. */
export type CitaDto = {
  id: string | null;
  direction: "in" | "out" | null;
  type: string | null;
  text: string | null;
  mediaKind: string | null;
};

/** Hasta dónde se recorta el texto citado: la burbuja enseña dos renglones. */
const CITA_MAX_CHARS = 200;

/**
 * El `wamid` citado de un mensaje del webhook, o null. `context` también trae
 * `forwarded` o `referred_product`, que no son citas: sin `id` no hay cita.
 */
export function citaDelWebhook(msg: Pick<WebhookMessage, "context">): string | null {
  const id = msg.context?.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** El cuerpo de Graph con `context` solo si hay a qué responder. */
export function conCita<T extends Record<string, unknown>>(
  payload: T,
  wamid: string | null | undefined
): T & { context?: { message_id: string } } {
  return wamid ? { ...payload, context: { message_id: wamid } } : payload;
}

/** Busca, en un solo query, los mensajes citados por `mensajes`. */
export async function resolverCitas(
  organizationId: string,
  mensajes: Pick<MessageRow, "replyToWaMessageId">[]
): Promise<Map<string, CitaEncontrada>> {
  const wamids = [
    ...new Set(
      mensajes
        .map((m) => m.replyToWaMessageId)
        .filter((w): w is string => Boolean(w))
    ),
  ];
  const citas = new Map<string, CitaEncontrada>();
  if (wamids.length === 0) return citas;

  const rows = await getDb()
    .select({ message: schema.message, media: schema.mediaAsset })
    .from(schema.message)
    .leftJoin(
      schema.mediaAsset,
      eq(schema.message.mediaAssetId, schema.mediaAsset.id)
    )
    .where(
      scoped(schema.message.organizationId, organizationId, commercialMessageScope(),
        inArray(schema.message.waMessageId, wamids)
      )
    );
  for (const r of rows) {
    if (r.message.waMessageId) citas.set(r.message.waMessageId, r);
  }
  return citas;
}

/**
 * La cita de UN mensaje, para publicarlo por SSE recién creado. Jamás lanza:
 * el mensaje ya está guardado, y un fallo aquí no debe cortar la ingesta
 * antes del despacho (el refetch del hilo la resuelve después).
 */
export async function resolverCita(
  organizationId: string,
  m: Pick<MessageRow, "replyToWaMessageId">
): Promise<CitaEncontrada | null> {
  if (!m.replyToWaMessageId) return null;
  try {
    const citas = await resolverCitas(organizationId, [m]);
    return citas.get(m.replyToWaMessageId) ?? null;
  } catch (err) {
    console.warn("[citas] no se resolvió la cita:", err);
    return null;
  }
}

export function aCitaDto(encontrada: CitaEncontrada | null): CitaDto {
  if (!encontrada) {
    return { id: null, direction: null, type: null, text: null, mediaKind: null };
  }
  const { message, media } = encontrada;
  const texto = message.text ?? media?.caption ?? null;
  return {
    id: message.id,
    direction: message.direction,
    type: message.type,
    text:
      texto && texto.length > CITA_MAX_CHARS
        ? `${texto.slice(0, CITA_MAX_CHARS)}…`
        : texto,
    mediaKind: media?.kind ?? null,
  };
}
