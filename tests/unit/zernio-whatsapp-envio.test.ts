import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetaApiError } from "@/lib/meta/client";
import { zernioFetch } from "@/server/zernio";
import { enviarTextoWhatsAppZernio } from "@/server/zernio/whatsapp-envio";

vi.mock("@/server/zernio", () => ({ zernioFetch: vi.fn() }));
const input = { token: "token-de-prueba", cuentaAutorizada: "cuenta-modo", conversationId: "hilo/1", texto: "hola", idempotencyKey: "solicitud-1" };
beforeEach(() => vi.resetAllMocks());
describe("envío WhatsApp por Zernio", () => {
  it("envía a la cuenta y el hilo indicados con clave idempotente", async () => {
    vi.mocked(zernioFetch).mockResolvedValue({ success: true, data: { messageId: "wamid-1" } });
    expect(await enviarTextoWhatsAppZernio(input)).toBe("wamid-1");
    expect(zernioFetch).toHaveBeenCalledWith("/inbox/conversations/hilo%2F1/messages", {
      method: "POST", token: input.token, timeoutMs: 15000, headers: { "Idempotency-Key": "solicitud-1" },
      body: { accountId: "cuenta-modo", message: "hola" },
    });
  });
  it("no envía sin clave idempotente ni inventa un id al faltar confirmación", async () => {
    await expect(enviarTextoWhatsAppZernio({ ...input, idempotencyKey: "" })).rejects.toThrow();
    expect(zernioFetch).not.toHaveBeenCalled();
    vi.mocked(zernioFetch).mockResolvedValue({ success: true, data: {} });
    await expect(enviarTextoWhatsAppZernio(input)).rejects.toThrow("identificador");
  });
  it("conserva el estado del error sin filtrar texto privado ni reintentar", async () => {
    vi.mocked(zernioFetch).mockRejectedValue(new MetaApiError("texto privado", { status: 429 }));
    await expect(enviarTextoWhatsAppZernio(input)).rejects.toMatchObject({ status: 429, message: "No se pudo enviar por Zernio" });
    expect(zernioFetch).toHaveBeenCalledTimes(1);
  });
});
