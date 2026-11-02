import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { encolarDespacho } from "@/server/dispatch/outbox";

vi.mock("@/lib/db", async (original) => ({ ...(await original<typeof import("@/lib/db")>()), getDb: vi.fn() }));

describe("conflictos del despacho", () => {
  it("no confirma una fila inexistente cuando persiste la contención", async () => {
    const conflicto = Object.assign(new Error("conflicto"), { code: "23505" });
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }));
    const values = vi.fn().mockRejectedValue(conflicto);
    vi.mocked(getDb).mockReturnValue({ select, insert: () => ({ values }) } as never);
    await expect(encolarDespacho({ organizationId: "org", conversationId: "conv", messageIds: ["msg"], inmediato: true })).rejects.toBe(conflicto);
    expect(values).toHaveBeenCalledTimes(3);
  });

  it("tras un conflicto sin mensajes confirma la fila ganadora observada", async () => {
    const fecha = new Date();
    const limit = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "ganador", status: "en_vuelo", notBefore: fecha }]);
    const values = vi.fn().mockRejectedValue(Object.assign(new Error("conflicto"), { code: "23505" }));
    vi.mocked(getDb).mockReturnValue({ select: () => ({ from: () => ({ where: () => ({ limit }) }) }), insert: () => ({ values }) } as never);
    await expect(encolarDespacho({ organizationId: "org", conversationId: "conv", inmediato: true })).resolves.toEqual({ id: "ganador", notBefore: fecha });
  });
});
