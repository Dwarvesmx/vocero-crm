import { beforeEach, describe, expect, it, vi } from "vitest";
import { encolarEnvioWhatsAppZernio, politicaEnvioZernio } from "@/server/zernio/whatsapp-outbox";
import { getDb } from "@/lib/db";

vi.mock("@/lib/db", async (original) => ({ ...(await original<typeof import("@/lib/db")>()), getDb: vi.fn() }));

describe("política de envío Zernio", () => {
  it("reintenta resultados inciertos y temporales con espera creciente", () => {
    for (const status of [0, 408, 409, 429, 500, 503]) {
      expect(politicaEnvioZernio(status, 1, 0)).toEqual({ retry: true, demoraMs: 60000 });
    }
    expect(politicaEnvioZernio(0, 2, 0).demoraMs).toBe(120000);
  });
  it("no reintenta errores definitivos ni fuera del límite de tiempo o intentos", () => {
    expect(politicaEnvioZernio(400, 1, 0).retry).toBe(false);
    expect(politicaEnvioZernio(401, 1, 0).retry).toBe(false);
    expect(politicaEnvioZernio(0, 6, 0).retry).toBe(false);
    expect(politicaEnvioZernio(0, 1, 23 * 60 * 60 * 1000).retry).toBe(false);
  });
});

describe("cola durable de envío", () => {
  const input = { organizationId: "org1", conversationId: "conv1", accountRef: "cuenta1", threadRef: "hilo1", text: "hola", requestKey: "clave1" };
  const row = { job: { conversationId: "conv1", accountRef: "cuenta1", threadRef: "hilo1", messageId: "msg1" }, text: "hola" };
  const limit = vi.fn();
  const select = () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit }) }) }) });
  beforeEach(() => { vi.resetAllMocks(); });
  it("reutiliza la intención ya registrada sin reenviar ni crear otra", async () => {
    limit.mockResolvedValue([row]);
    const transaction = vi.fn();
    vi.mocked(getDb).mockReturnValue({ select, transaction } as never);
    expect(await encolarEnvioWhatsAppZernio(input)).toBe("msg1");
    expect(transaction).not.toHaveBeenCalled();
  });
  it("ante dos solicitudes simultáneas recupera el registro ganador", async () => {
    limit.mockResolvedValueOnce([]).mockResolvedValueOnce([row]);
    const transaction = vi.fn().mockRejectedValue(new Error("conflicto único"));
    vi.mocked(getDb).mockReturnValue({ select, transaction } as never);
    expect(await encolarEnvioWhatsAppZernio(input)).toBe("msg1");
  });
  it("propaga un fallo de base sin declarar que guardó el envío", async () => {
    limit.mockResolvedValue([]);
    const transaction = vi.fn().mockRejectedValue(new Error("bd no disponible"));
    vi.mocked(getDb).mockReturnValue({ select, transaction } as never);
    await expect(encolarEnvioWhatsAppZernio(input)).rejects.toThrow("bd no disponible");
  });
  it("rechaza la misma clave con otro contenido", async () => {
    limit.mockResolvedValue([row]);
    vi.mocked(getDb).mockReturnValue({ select } as never);
    await expect(encolarEnvioWhatsAppZernio({ ...input, text: "otro" })).rejects.toThrow("otra solicitud");
  });
});
