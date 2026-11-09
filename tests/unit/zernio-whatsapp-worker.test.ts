import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, schema } from "@/lib/db";
import { MetaApiError } from "@/lib/meta/client";
import { obtenerZernioWhatsAppPorOrg } from "@/server/zernio/whatsapp-credenciales";
import { enviarTextoWhatsAppZernio } from "@/server/zernio/whatsapp-envio";
import { barrerEnviosWhatsAppZernio, procesarEnvioZernioReservado } from "@/server/zernio/whatsapp-outbox";

vi.mock("@/lib/db", async (original) => ({ ...(await original<typeof import("@/lib/db")>()), getDb: vi.fn() }));
vi.mock("@/server/zernio/whatsapp-credenciales", () => ({ obtenerZernioWhatsAppPorOrg: vi.fn() }));
vi.mock("@/server/zernio/whatsapp-envio", () => ({ enviarTextoWhatsAppZernio: vi.fn() }));
vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));
const cambios: Record<string, unknown>[] = [];
const job = { handoffReason: null, sourceDispatchId: null, commercialRouteGeneration: null, id: "d1", organizationId: "org1", conversationId: "cv1", messageId: "msg1", accountRef: "cuenta1",
  threadRef: "hilo1", requestKey: "clave-estable", status: "procesando" as const, attempts: 1,
  notBefore: new Date(), leasedUntil: new Date(), createdAt: new Date(), updatedAt: new Date() };
beforeEach(() => {
  vi.resetAllMocks(); cambios.length = 0;
  const tx = { update: () => ({ set: (value: Record<string, unknown>) => { cambios.push(value); return { where: () => ({ returning: async () => [{ id: "d1" }] }) }; } }) };
  const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ text: "hola" }] }) }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) };
  vi.mocked(getDb).mockReturnValue(db as never);
  vi.mocked(obtenerZernioWhatsAppPorOrg).mockResolvedValue({ enabled: true, webhookPending: false, organizationId: "org1", accountRef: "cuenta1", token: "falso", secreto: "falso" });
});
describe("worker de envíos", () => {
  it("confirma aceptación sin marcar entrega", async () => {
    vi.mocked(enviarTextoWhatsAppZernio).mockResolvedValue("wamid-1");
    await procesarEnvioZernioReservado(job);
    expect(enviarTextoWhatsAppZernio).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "clave-estable", cuentaAutorizada: "cuenta1" }));
    expect(cambios).toContainEqual(expect.objectContaining({ status: "completado" }));
    expect(cambios).toContainEqual(expect.objectContaining({ status: "sent", waMessageId: "wamid-1" }));
    expect(cambios).not.toContainEqual(expect.objectContaining({ status: "delivered" }));
  });
  it("tras timeout conserva pendiente el trabajo y la misma clave", async () => {
    vi.mocked(enviarTextoWhatsAppZernio).mockRejectedValueOnce(new MetaApiError("timeout", { status: 0 })).mockResolvedValueOnce("wamid-1");
    await procesarEnvioZernioReservado(job);
    expect(cambios).toContainEqual(expect.objectContaining({ status: "pendiente" }));
    expect(cambios).not.toContainEqual(expect.objectContaining({ status: "failed" }));
    expect(enviarTextoWhatsAppZernio).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "clave-estable" }));
    await procesarEnvioZernioReservado({ ...job, attempts: 2 });
    expect(enviarTextoWhatsAppZernio).toHaveBeenNthCalledWith(2, expect.objectContaining({ idempotencyKey: "clave-estable" }));
    expect(cambios).toContainEqual(expect.objectContaining({ status: "sent", waMessageId: "wamid-1" }));
  });
  it("un rechazo definitivo se registra como fallido", async () => {
    vi.mocked(enviarTextoWhatsAppZernio).mockRejectedValue(new MetaApiError("rechazo", { status: 400 }));
    await procesarEnvioZernioReservado(job);
    expect(cambios).toContainEqual(expect.objectContaining({ status: "fallido" }));
    expect(cambios).toContainEqual(expect.objectContaining({ status: "failed" }));
  });
  it("dos barridos simultáneos solo envían el trabajo reclamado", async () => {
    vi.stubEnv("ZERNIO_WHATSAPP_ENABLED", "true");
    try {
      const reclamar = vi.fn().mockResolvedValueOnce([job]).mockResolvedValueOnce([]);
      const tx = { update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: "d1" }] }) }) }) };
      const db = {
        select: () => ({ from: (tabla: unknown) => ({ where: () => ({ limit: async () => tabla === schema.message ? [{ text: "hola" }] : [job] }) }) }),
        update: () => ({ set: () => ({ where: () => ({ returning: reclamar }) }) }),
        transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
      };
      vi.mocked(getDb).mockReturnValue(db as never);
      vi.mocked(enviarTextoWhatsAppZernio).mockResolvedValue("wamid-1");
      await Promise.all([barrerEnviosWhatsAppZernio(), barrerEnviosWhatsAppZernio()]);
      expect(reclamar).toHaveBeenCalledTimes(2);
      expect(enviarTextoWhatsAppZernio).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllEnvs(); }
  });
});
vi.mock("@/server/zernio/whatsapp-autorizacion", () => ({ liberarSalidaZernio: vi.fn(), recuperarSalidasInciertasZernio: vi.fn().mockResolvedValue(undefined) }));
