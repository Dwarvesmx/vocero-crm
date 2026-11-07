import {and,eq} from "drizzle-orm";
import {getDb,schema} from "@/lib/db";
import {commercialMessageScope} from "@/server/inbox/message-scope";
import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { downloadGraphMedia, MediaFetchError } from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

/** Límite para el bot (transcribe audio/imagen; nunca documentos de 100 MB). */
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/**
 * 006 (amendment 002) — Descarga de un adjunto de Meta para el bot.
 * GET /api/bot/media/{mediaId} → binario + content-type.
 *
 * El token de WhatsApp NO sale del CRM: el bot pide aquí, jamás a Meta.
 * Flujo Graph delegado al helper compartido (008): src/server/whatsapp/media.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ mediaId: string }> }
) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }
  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) {
    return apiError(409, "no_connection", "WhatsApp no está conectado");
  }

  const { mediaId } = await ctx.params;
  if (!/^[\w.-]{1,64}$/.test(mediaId)) {
    return apiError(422, "invalid", "mediaId inválido");
  }

  const [owned]=await getDb().select({id:schema.message.id}).from(schema.message).innerJoin(schema.mediaAsset,eq(schema.message.mediaAssetId,schema.mediaAsset.id)).where(and(commercialMessageScope(),eq(schema.message.organizationId,organizationId),eq(schema.mediaAsset.waMediaId,mediaId))).limit(1);
  if(!owned)return apiError(404,"not_found","Adjunto no disponible.");
  try {
    const { data, mimeType } = await downloadGraphMedia(
      creds.token,
      mediaId,
      MAX_MEDIA_BYTES
    );
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": mimeType ?? "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof MediaFetchError) {
      if (err.message.includes("límite")) {
        return apiError(413, "too_large", "El adjunto excede el límite de 16 MB");
      }
      return apiError(
        err.gone ? 404 : 502,
        "media_download_failed",
        err.message
      );
    }
    return apiError(502, "media_download_failed", "No se pudo descargar el adjunto");
  }
}
