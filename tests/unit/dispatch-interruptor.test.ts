import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { tanda } from "@/server/dispatch/worker";
import { construirEvento, entregar } from "@/server/brains/deliver";
import { descartarDespacho, tomarPendientes } from "@/server/dispatch/outbox";

vi.mock("@/lib/db", async (original) => ({ ...(await original<typeof import("@/lib/db")>()), getDb: vi.fn() }));
vi.mock("@/server/brains/config", () => ({ leerConfigDespacho: () => ({ active: true, url: "http://localhost", secret: "ficticio" }) }));
vi.mock("@/server/brains/deliver", () => ({ construirEvento: vi.fn(), entregar: vi.fn(), rafagaDe: vi.fn(), sinDespachar: vi.fn() }));
vi.mock("@/server/dispatch/outbox", () => ({
  caducarAHumano: vi.fn(), descartarDespacho: vi.fn(), encolarDespacho: vi.fn(),
  marcarEntregado: vi.fn(), mensajesAnotados: vi.fn(), pasarAHumano: vi.fn(),
  reintentarOCaducar: vi.fn(), renovarLease: vi.fn(), tomarPendientes: vi.fn(),
}));

describe("interruptor del agente al despachar", () => {
  const fila = { id: "trabajo", organizationId: "org", conversationId: "conv" };
  const limit = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(tomarPendientes).mockResolvedValueOnce([fila as never]).mockResolvedValue([]);
    vi.mocked(getDb).mockReturnValue({ select: () => ({ from: () => ({ where: () => ({ limit }) }) }) } as never);
  });

  it("descarta el trabajo si el agente se apagó después de encolarlo", async () => {
    limit.mockResolvedValueOnce([{ aiEnabled: true, handoffAt: null, isTest: false }]).mockResolvedValueOnce([{ enabled: false }]);
    await tanda();
    expect(descartarDespacho).toHaveBeenCalledWith(fila, "el agente se apagó antes de despachar");
    expect(construirEvento).not.toHaveBeenCalled();
    expect(entregar).not.toHaveBeenCalled();
  });

  it("mantiene aislado el flujo del Laboratorio", async () => {
    limit.mockResolvedValueOnce([{ aiEnabled: true, handoffAt: null, isTest: true }]);
    vi.mocked(construirEvento).mockResolvedValueOnce(null);
    await tanda();
    expect(construirEvento).toHaveBeenCalledWith(fila);
    expect(limit).toHaveBeenCalledTimes(1);
  });

  it("deja continuar al agente habilitado", async () => {
    limit.mockResolvedValueOnce([{ aiEnabled: true, handoffAt: null, isTest: false }]).mockResolvedValueOnce([{ enabled: true }]);
    vi.mocked(construirEvento).mockResolvedValueOnce(null);
    await tanda();
    expect(construirEvento).toHaveBeenCalledWith(fila);
    expect(descartarDespacho).not.toHaveBeenCalledWith(fila, "el agente se apagó antes de despachar");
  });
  it("no inicia otro turno durante un aviso de transferencia pendiente", async () => {
    limit.mockResolvedValueOnce([{aiEnabled:true,handoffAt:null,handoffPendingMessageId:"msg_notice",isTest:false}]);
    await tanda();
    expect(descartarDespacho).toHaveBeenCalledWith(fila,"la IA se pausó antes de despachar");
    expect(entregar).not.toHaveBeenCalled();
  });

});
