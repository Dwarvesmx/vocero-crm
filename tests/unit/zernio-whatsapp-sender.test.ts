import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendText } from "@/server/inbox/send";
import { encolarEnvioWhatsAppZernio } from "@/server/zernio/whatsapp-outbox";
import { obtenerZernioWhatsAppPorOrg } from "@/server/zernio/whatsapp-credenciales";

vi.mock("@/server/zernio/whatsapp-outbox", () => ({ encolarEnvioWhatsAppZernio: vi.fn() }));
vi.mock("@/server/zernio/whatsapp-credenciales", () => ({ obtenerZernioWhatsAppPorOrg: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({ ...(await original<typeof import("@/lib/db")>()), getDb: () => ({
  select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [{
    conversation: { id: "cv1", organizationId: "org1", isTest: false, channel: "whatsapp", channelThreadRef: "hilo1", lastInboundAt: new Date() },
    contact: { id: "ct1", phone: "525512345678", waIdentity: "525512345678" },
  }] }) }) }) }),
}) }));
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("ZERNIO_WHATSAPP_ENABLED", "true");
  vi.mocked(obtenerZernioWhatsAppPorOrg).mockResolvedValue({ enabled: true, webhookPending: false, organizationId: "org1", accountRef: "cuenta1", token: "falso", secreto: "falso" });
  vi.mocked(encolarEnvioWhatsAppZernio).mockResolvedValue("msg1");
});
afterEach(() => vi.unstubAllEnvs());
describe("envío manual desde bandeja", () => {
  it("encola para la cuenta autorizada sin llamar a Meta", async () => {
    expect(await sendText({ organizationId: "org1", conversationId: "cv1", text: "hola", requestKey: "clave1" })).toEqual({ messageId: "msg1" });
    expect(encolarEnvioWhatsAppZernio).toHaveBeenCalledWith(expect.objectContaining({ accountRef: "cuenta1", threadRef: "hilo1", requestKey: "clave1" }));
  });
  it("sin clave o para IA rechaza sin encolar", async () => {
    await expect(sendText({ organizationId: "org1", conversationId: "cv1", text: "hola" })).rejects.toThrow("clave de envío");
    await expect(sendText({ organizationId: "org1", conversationId: "cv1", text: "hola", aiGenerated: true, requestKey: "clave1" })).rejects.toThrow("aún no está disponible");
    expect(encolarEnvioWhatsAppZernio).not.toHaveBeenCalled();
  });
});
