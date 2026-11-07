import { describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/demo/web/route";
import { SimulatorError } from "@/server/demo-center/infra/simulator";

const web = vi.hoisted(() => ({ consultarDemoWeb: vi.fn(), operarDemoWeb: vi.fn() }));
vi.mock("@/server/demo-center/infra/web", () => web);
const base = "http://localhost/api/demo/web";
const headers = { authorization: "Bearer " + "a".repeat(43), "content-type": "application/json" };
const request = (body: string, extra: Record<string, string> = {}) => new Request(base, {
  method: "POST", headers: { ...headers, ...extra }, body,
});

describe("Frontera pública de invitaciones", () => {
  it("rechaza mutaciones sin token, cross-site, cuerpos grandes y controles administrativos", async () => {
    expect((await POST(request('{"action":"close"}', { authorization: "" }))).status).toBe(404);
    expect((await POST(request('{"action":"close"}', { "sec-fetch-site": "cross-site" }))).status).toBe(422);
    expect((await POST(request(" ".repeat(12501)))).status).toBe(413);
    expect((await POST(request('{"action":"close","organizationId":"otra"}'))).status).toBe(422);
    expect((await POST(request('{"action":"send","text":"hola","requestKey":"mal"}'))).status).toBe(422);
    expect(web.operarDemoWeb).not.toHaveBeenCalled();
  });

  it("devuelve errores sanitizados y no permite cachear resultados", async () => {
    web.consultarDemoWeb.mockRejectedValueOnce(new Error("mensaje interno con datos privados"));
    const respuesta = await GET(new Request(base, { headers }));
    expect(respuesta.status).toBe(503);
    expect(await respuesta.json()).toEqual({ error: "unavailable" });
    expect(respuesta.headers.get("cache-control")).toBe("private, no-store");
    web.operarDemoWeb.mockRejectedValueOnce(new SimulatorError("operation_pending"));
    const operacion = await POST(request('{"action":"close"}'));
    expect(operacion.status).toBe(409);
    expect(await operacion.json()).toEqual({ error: "operation_pending" });
  });
});
