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

type HiloZernio = { organizationId: string; accountRef: string; threadRef: string };
const estadoConfirmacion = z.enum(["sent", "delivered", "read", "failed"]);
type EstadoConfirmacion = z.infer<typeof estadoConfirmacion>;
const paginaMensajes = z.object({
  messages: z.array(z.object({
    id: z.string(), accountId: z.string(), conversationId: z.string(), platform: z.string(),
    direction: z.string(), deliveryStatus: z.string().nullish(),
  })),
  pagination: z.object({ hasMore: z.boolean().optional(), nextCursor: z.string().nullish() }).optional(),
});

/** Una búsqueda por hilo para todos los IDs del lote. No asocia mensajes por texto. */
export async function consultarConfirmacionesZernio(hilo: HiloZernio, ids: string[], timeoutMs = 2500) {
  const pendientes = new Set(ids);
  const confirmaciones = new Map<string, EstadoConfirmacion>();
  if (!pendientes.size) return confirmaciones;

  const { obtenerZernioWhatsAppPorOrg } = await import("./whatsapp-credenciales");
  const cred = await obtenerZernioWhatsAppPorOrg(hilo.organizationId);
  if (!cred || cred.accountRef !== hilo.accountRef) return confirmaciones;

  const cursores = new Set<string>();
  let cursor: string | undefined;
  for (let pagina = 0; pagina < 3 && pendientes.size; pagina++) {
    const query = new URLSearchParams({ accountId: hilo.accountRef, sortOrder: "desc", limit: "100" });
    if (cursor) query.set("cursor", cursor);
    let respuesta: unknown;
    try {
      respuesta = await zernioFetch(`/inbox/conversations/${encodeURIComponent(hilo.threadRef)}/messages?${query}`,
        { token: cred.token, method: "GET", timeoutMs });
    } catch (error) {
      console.warn("No se pudo consultar el historial de Zernio", {
        pagina: pagina + 1, status: error instanceof MetaApiError ? error.status : undefined,
      });
      break;
    }
    const datos = paginaMensajes.safeParse(respuesta);
    if (!datos.success) {
      console.warn("Respuesta de historial de Zernio inválida", { pagina: pagina + 1 });
      break;
    }
    for (const id of pendientes) {
      const exactos = datos.data.messages.filter(m => m.id === id && m.accountId === hilo.accountRef &&
        m.conversationId === hilo.threadRef && m.platform === "whatsapp" && m.direction === "outgoing");
      if (!exactos.length) continue;
      pendientes.delete(id);
      if (exactos.length !== 1) continue;
      const estado = estadoConfirmacion.safeParse(exactos[0]?.deliveryStatus);
      if (estado.success) confirmaciones.set(id, estado.data);
    }
    const siguiente = datos.data.pagination?.nextCursor;
    if (!datos.data.pagination?.hasMore || !siguiente || cursores.has(siguiente)) break;
    cursores.add(siguiente);
    cursor = siguiente;
  }
  return confirmaciones;
}

export async function consultarConfirmacionDemoZernio(input: HiloZernio & { requestKey: string; messageId: string | null }) {
  if (!input.messageId) return null;
  const confirmaciones = await consultarConfirmacionesZernio(input, [input.messageId], 15000);
  const status = confirmaciones.get(input.messageId);
  return status ? { messageId: input.messageId, status } : null;
}
