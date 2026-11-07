import {commercialMessageScope} from "@/server/inbox/message-scope";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { claseReenvio, llevaPie } from "@/lib/reenvio";
import { ForwardImageError, leerParaReenviar } from "./forward-image";
import { SendError, sendMediaMessage, sendText } from "./send";

/**
 * 059 — Reenvía cualquier mensaje del historial a otra conversación (D1, D2):
 * el texto sale como texto libre y un adjunto como un archivo nuevo, por
 * `sendText` o `sendMediaMessage`, con todas sus guardas (sandbox, ventana,
 * canal, credenciales). El cliente solo nombra el mensaje de origen.
 *
 * Los errores propios son `ForwardImageError` (el de la 042: mismo contrato
 * de status y código).
 */
export async function forwardMessage(input: {
  organizationId: string;
  conversationId: string;
  sourceMessageId: string;
  caption?: string;
}): Promise<{ messageId: string }> {
  const rows = await getDb()
    .select({
      message: schema.message,
      asset: schema.mediaAsset,
      conversation: schema.conversation,
    })
    .from(schema.message)
    .innerJoin(
      schema.conversation,
      and(
        eq(schema.message.conversationId, schema.conversation.id),
        eq(schema.conversation.organizationId, input.organizationId)
      )
    )
    .leftJoin(
      schema.mediaAsset,
      and(
        eq(schema.message.mediaAssetId, schema.mediaAsset.id),
        eq(schema.mediaAsset.organizationId, input.organizationId)
      )
    )
    .where(
      scoped(schema.message.organizationId, input.organizationId, commercialMessageScope(),
        eq(schema.message.id, input.sourceMessageId)
      )
    )
    .limit(1);
  const source = rows[0];
  if (!source) throw new ForwardImageError(404, "not_found", "Mensaje no encontrado");
  if (source.conversation.isTest) {
    throw new SendError("sandbox_violation", "No se reenvían mensajes del Laboratorio");
  }
  if (source.message.conversationId === input.conversationId) {
    throw new ForwardImageError(422, "invalid", "Elige otra conversación para reenviar el mensaje");
  }

  const { message, asset } = source;
  const media = asset ? { kind: asset.kind } : null;
  const clase = claseReenvio({ type: message.type, text: message.text, media });
  if (!clase) {
    throw new ForwardImageError(422, "invalid", "Este mensaje no se puede reenviar");
  }

  if (clase === "texto") {
    return sendText({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      text: message.text!,
    });
  }

  if (!asset!.mimeType) {
    throw new ForwardImageError(422, "invalid", "Este adjunto no se puede reenviar");
  }
  const data = await leerParaReenviar(input.organizationId, asset!, "El adjunto");
  return sendMediaMessage({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    file: { data, mimeType: asset!.mimeType, fileName: asset!.fileName ?? undefined },
    // Como en la 042: sin `caption` se conserva el del original; con «» sale sin pie.
    caption: llevaPie({ media })
      ? (input.caption ?? asset!.caption ?? "") || undefined
      : undefined,
    // Una nota de voz (Ogg/Opus) sigue siendo nota de voz.
    voz: asset!.kind === "audio" && /^audio\/(ogg|opus)/.test(asset!.mimeType),
  });
}
