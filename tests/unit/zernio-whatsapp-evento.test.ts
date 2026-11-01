import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizarEntranteWhatsAppZernio, permiteDespachoWhatsAppZernio, validarEventoWhatsAppZernio } from "@/server/zernio/whatsapp-evento";

const cuenta = "cuenta-modonext-ficticia";
const secreto = "secreto-ficticio-de-prueba";
function entrega(evento: unknown, firmaValida = true) {
  const cuerpo = JSON.stringify(evento);
  const firma = firmaValida ? createHmac("sha256", secreto).update(cuerpo).digest("hex") : "incorrecta";
  return validarEventoWhatsAppZernio({ cuerpo, firma, secreto, cuentaAutorizada: cuenta });
}
function entrante() {
  return { id: "evento-1", event: "message.received", account: { accountId: cuenta, platform: "whatsapp" },
    conversation: { id: "hilo-1" }, message: { id: "mensaje-1", platformMessageId: "wamid-1",
      conversationId: "hilo-1", platform: "whatsapp", direction: "incoming", text: "hola",
      sentAt: "2026-01-01T12:00:00Z", sender: { id: "5215551234567" } } };
}
describe("webhook WhatsApp de Zernio", () => {
  it("acepta cuenta, plataforma y firma correctas", () => {
    const e = entrega(entrante());
    expect(e?.message.platformMessageId).toBe("wamid-1");
    expect(e && permiteDespachoWhatsAppZernio(e)).toBe(true);
  });
  it("rechaza firma inválida y secreto ausente", () => {
    expect(entrega(entrante(), false)).toBeNull();
    expect(validarEventoWhatsAppZernio({ cuerpo: "{}", firma: "x", secreto: null, cuentaAutorizada: cuenta })).toBeNull();
  });
  it("rechaza otra cuenta, una plataforma distinta y referencias contradictorias", () => {
    expect(entrega({ ...entrante(), account: { accountId: "otra-cuenta", platform: "whatsapp" } })).toBeNull();
    expect(entrega({ ...entrante(), account: { accountId: cuenta, platform: "instagram" } })).toBeNull();
    expect(entrega({ ...entrante(), account: { id: "otra-cuenta", accountId: cuenta, platform: "whatsapp" } })).toBeNull();
  });
  it("nunca despacha salientes ni mensajes en standby", () => {
    const base = entrante();
    const salida = entrega({ ...base, event: "message.sent", message: { ...base.message, direction: "outgoing", source: "whatsapp_business_app" } });
    const standby = entrega({ ...base, metadata: { standby: true } });
    expect(salida && permiteDespachoWhatsAppZernio(salida)).toBe(false);
    expect(standby && permiteDespachoWhatsAppZernio(standby)).toBe(false);
  });
  it("rechaza direcciones y conversaciones inconsistentes", () => {
    const base = entrante();
    expect(entrega({ ...base, message: { ...base.message, direction: "outgoing" } })).toBeNull();
    expect(entrega({ ...base, conversation: { id: "otro-hilo" } })).toBeNull();
  });
  it("conserva el hilo, wamid y tiempo originales al normalizar", () => {
    const base = entrante();
    const e = entrega({ ...base, message: { ...base.message, sender: { phoneNumber: "+5215512345678", businessScopedUserId: "BSUID123" } } });
    expect(e && normalizarEntranteWhatsAppZernio(e)).toMatchObject({
      waMessageId: "wamid-1", eventId: "evento-1", threadRef: "hilo-1",
      identity: { phone: "525512345678", waUserId: "BSUID123" },
      timestamp: "1767268800", permiteDespacho: true,
    });
  });
  it("permite BSUID sin teléfono y no normaliza un saliente como entrante", () => {
    const base = entrante();
    const e = entrega({ ...base, message: { ...base.message, sender: { businessScopedUserId: "BSUID123" } } });
    expect(e && normalizarEntranteWhatsAppZernio(e)?.identity.identity).toBe("bsuid:BSUID123");
    const salida = entrega({ ...base, event: "message.sent", message: { ...base.message, direction: "outgoing" } });
    expect(salida && normalizarEntranteWhatsAppZernio(salida)).toBeNull();
  });
});
