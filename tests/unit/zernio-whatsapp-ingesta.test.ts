import { beforeEach, describe, expect, it, vi } from "vitest";
import { ingestInboundMessage } from "@/server/inbox/ingest";
import { obtenerZernioWhatsAppPorCuenta } from "@/server/zernio/whatsapp-credenciales";
import { procesarEntranteWhatsAppZernio } from "@/server/zernio/whatsapp-ingesta";
import { resolverIngresoComercialWhatsApp } from "@/server/demo-center/infra/whatsapp-selector";

vi.mock("@/server/inbox/ingest", () => ({ ingestInboundMessage: vi.fn() }));
vi.mock("@/server/demo-center/infra/whatsapp-selector", () => ({ resolverIngresoComercialWhatsApp: vi.fn() }));
vi.mock("@/server/zernio/whatsapp-credenciales", () => ({ obtenerZernioWhatsAppPorCuenta: vi.fn() }));
const evento = { id: "evt", event: "message.received", account: { accountId: "cuenta-modo", platform: "whatsapp" },
  conversation: { id: "hilo" }, message: { id: "interno", platformMessageId: "wamid-1", conversationId: "hilo", platform: "whatsapp",
    direction: "incoming", text: "hola", sentAt: "2026-01-01T12:00:00Z", sender: { phoneNumber: "+525512345678" } } };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(resolverIngresoComercialWhatsApp).mockResolvedValue({ blocked: false }); vi.mocked(obtenerZernioWhatsAppPorCuenta).mockResolvedValue({ accountRef: "cuenta-modo", organizationId: "org-modo", token: "falso", secreto: "falso" }); });
describe("ingesta WhatsApp Zernio", () => {
  it("entrega el mensaje al núcleo de bandeja con identidad y referencias", async () => {
    await procesarEntranteWhatsAppZernio(evento);
    expect(ingestInboundMessage).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-modo", waMessageId: "wamid-1", threadRef: "hilo", omitirDespacho: true, conservarOrden: true }));
  });
  it("no despacha al agente en standby", async () => {
    await procesarEntranteWhatsAppZernio({ ...evento, metadata: { standby: true } });
    expect(ingestInboundMessage).toHaveBeenCalledWith(expect.objectContaining({ omitirDespacho: true }));
  });
  it("no vuelve a ingresar por Lukas un webhook rezagado de un hilo demo", async () => {
    vi.mocked(resolverIngresoComercialWhatsApp).mockResolvedValue({ blocked: true });
    await procesarEntranteWhatsAppZernio(evento);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });
  it("si la cuenta se eliminó, falla para que el worker reintente", async () => {
    vi.mocked(obtenerZernioWhatsAppPorCuenta).mockResolvedValue(null);
    await expect(procesarEntranteWhatsAppZernio(evento)).rejects.toThrow();
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });
});
