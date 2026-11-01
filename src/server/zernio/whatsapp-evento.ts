import { z } from "zod";
import { isValidZernioSignature } from "@/server/zernio";
import { normalizeMx } from "@/lib/meta/client";

// Contrato de webhook WhatsApp; no se aceptan perfiles como si fueran cuentas.
const texto = z.string().trim().min(1);
const eventoSchema = z.object({
  id: texto,
  event: z.enum(["message.received", "message.sent"]),
  account: z.object({
    id: texto.optional(),
    accountId: texto.optional(),
    platform: z.literal("whatsapp"),
  }),
  conversation: z.object({ id: texto, participantId: texto.optional() }),
  message: z.object({
    id: texto,
    platformMessageId: texto,
    conversationId: texto,
    platform: z.literal("whatsapp"),
    direction: z.enum(["incoming", "outgoing"]),
    text: z.string().nullable(),
    sentAt: z.string().datetime({ offset: true }),
    source: z.string().optional(),
    sender: z.object({
      id: texto.optional(),
      name: z.string().nullable().optional(),
      phoneNumber: z.string().nullable().optional(),
      businessScopedUserId: texto.optional(),
    }).optional(),
  }),
  metadata: z.object({ standby: z.boolean().optional() }).nullable().optional(),
});

export type EventoWhatsAppZernio = z.infer<typeof eventoSchema>;

/** Valida firma obligatoria, plataforma y cuenta exacta antes de ingerir. */
export function validarEventoWhatsAppZernio(input: {
  cuerpo: string;
  firma: string | null;
  secreto: string | null;
  cuentaAutorizada: string | null;
}): EventoWhatsAppZernio | null {
  if (!input.secreto || !input.cuentaAutorizada || !input.firma) return null;
  if (!isValidZernioSignature(input.cuerpo, input.firma, input.secreto)) return null;
  let contenido: unknown;
  try { contenido = JSON.parse(input.cuerpo); } catch { return null; }
  const resultado = eventoSchema.safeParse(contenido);
  if (!resultado.success) return null;
  const evento = resultado.data;
  const { id, accountId } = evento.account;
  if ((!id && !accountId) || (id && id !== input.cuentaAutorizada) ||
      (accountId && accountId !== input.cuentaAutorizada)) return null;
  if (evento.message.conversationId !== evento.conversation.id) return null;
  if (evento.event === "message.received" && evento.message.direction !== "incoming") return null;
  if (evento.event === "message.sent" && evento.message.direction !== "outgoing") return null;
  return evento;
}

/** Solo los entrantes ajenos a standby pueden originar un turno automático. */
export function permiteDespachoWhatsAppZernio(evento: EventoWhatsAppZernio): boolean {
  return evento.event === "message.received" && evento.message.direction === "incoming" &&
    evento.metadata?.standby !== true;
}

/** Normaliza únicamente entradas verificadas para el núcleo de la bandeja. */
export function normalizarEntranteWhatsAppZernio(evento: EventoWhatsAppZernio) {
  if (evento.event !== "message.received" || evento.message.direction !== "incoming") return null;
  const sender = evento.message.sender;
  // Zernio también documenta sender.id como teléfono cuando lo conoce.
  const numero = (sender?.phoneNumber ?? sender?.id ?? "").replace(/^\+/, "");
  const phone = /^\d{7,15}$/.test(numero) ? normalizeMx(numero) : null;
  const waUserId = sender?.businessScopedUserId ?? null;
  if (!phone && !waUserId) return null;
  return {
    identity: {
      identity: phone ?? `bsuid:${waUserId}`,
      phone,
      waUserId,
      profileName: sender?.name ?? null,
      channel: "whatsapp" as const,
    },
    waMessageId: evento.message.platformMessageId,
    threadRef: evento.message.conversationId,
    text: evento.message.text,
    timestamp: String(Math.floor(Date.parse(evento.message.sentAt) / 1000)),
    eventId: evento.id,
    permiteDespacho: permiteDespachoWhatsAppZernio(evento),
  };
}
