import { afterEach, expect, it, vi } from "vitest";
import { guardarConfiguracionAgente } from "@/lib/agent-save";
afterEach(() => vi.unstubAllGlobals());
it("solo confirma el ACK real del servidor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true })));
    await expect(guardarConfiguracionAgente("/api/agent/profile", "PUT", { instructions: "consultivo" })).resolves.toMatchObject({ ok: true });
});
it.each([Response.json({ error: { message: "Sin permiso" } }, { status: 403 }), Response.json({}), new Response("proxy", { status: 502 })])("no presenta éxito ante rechazo o respuesta inválida", async (response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(guardarConfiguracionAgente("/api/agent/profile", "PUT", { tone: "cercano" })).rejects.toThrow();
});
it("conserva el error de conexión", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Sin conexión")));
    await expect(guardarConfiguracionAgente("/api/agent/profile", "PUT", {})).rejects.toThrow("Sin conexión");
});
