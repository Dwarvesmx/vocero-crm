import { z } from "zod";
import { MetaApiError } from "@/lib/meta/client";
import { zernioFetch } from "@/server/zernio";

const respuesta = z.object({
  success: z.literal(true),
  data: z.object({ messageId: z.string().min(1) }),
});

/** Una solicitud: solo el llamador puede decidir reintentar con la misma clave. */
export async function enviarTextoWhatsAppZernio(input: {
  token: string;
  cuentaAutorizada: string;
  conversationId: string;
  texto: string;
  idempotencyKey: string;
}): Promise<string> {
  if (!input.token || !input.cuentaAutorizada || !input.conversationId ||
      !input.texto || !input.idempotencyKey) {
    throw new Error("Faltan datos obligatorios para enviar por Zernio");
  }
  let data: unknown;
  try {
    data = await zernioFetch(
      `/inbox/conversations/${encodeURIComponent(input.conversationId)}/messages`,
      { method: "POST", token: input.token, timeoutMs: 15000,
        headers: { "Idempotency-Key": input.idempotencyKey },
        body: { accountId: input.cuentaAutorizada, message: input.texto } }
    );
  } catch (error) {
    const status = error instanceof MetaApiError ? error.status : 0;
    // El cuerpo de error del proveedor puede incluir datos de conversación.
    throw new MetaApiError("No se pudo enviar por Zernio", { status });
  }
  const parsed = respuesta.safeParse(data);
  if (!parsed.success) throw new Error("Zernio no confirmó el identificador del mensaje");
  return parsed.data.data.messageId;
}
