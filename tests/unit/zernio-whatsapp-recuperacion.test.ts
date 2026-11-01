import { beforeEach, describe, expect, it, vi } from "vitest";
import { barrido, procesarEvento } from "@/server/webhooks/worker";
import { marcarProcesado, reintentarOAgotar, tomarEvento, tomarPendientes } from "@/server/webhooks/eventos";
import { procesarFuente } from "@/server/webhooks/procesar";

vi.mock("@/server/webhooks/eventos", () => ({ marcarProcesado: vi.fn(), reintentarOAgotar: vi.fn(), tomarEvento: vi.fn(), tomarPendientes: vi.fn(), purgar: vi.fn().mockResolvedValue(0) }));
vi.mock("@/server/webhooks/procesar", () => ({ procesarFuente: vi.fn() }));
const fila = { id: "evento1", organizationId: "org1", fuente: "zernio_whatsapp" as const, payload: {}, huella: "hash",
  status: "en_proceso" as const, attempts: 1, notBefore: new Date(), leasedUntil: new Date(), lastError: null,
  processedAt: null, createdAt: new Date(), updatedAt: new Date() };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(reintentarOAgotar).mockResolvedValue(null); });
describe("recuperación del webhook", () => {
  it("si falla el procesamiento conserva el trabajo para reintentar", async () => {
    vi.mocked(tomarEvento).mockResolvedValue(fila);
    vi.mocked(procesarFuente).mockRejectedValue(new Error("temporal"));
    await procesarEvento("evento1");
    expect(reintentarOAgotar).toHaveBeenCalledWith(fila, expect.any(Error));
    expect(marcarProcesado).not.toHaveBeenCalled();
  });
  it("el barrido recupera y finaliza un trabajo tras reinicio", async () => {
    vi.mocked(tomarPendientes).mockResolvedValue([fila]);
    await barrido();
    expect(procesarFuente).toHaveBeenCalledWith("zernio_whatsapp", {});
    expect(marcarProcesado).toHaveBeenCalledWith(fila);
  });
});
