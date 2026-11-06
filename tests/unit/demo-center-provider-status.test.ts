import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ org: "org-a", role: "owner", fails: false, baseUrl: "https://openrouter.ai/api" }));
vi.mock("@/lib/auth/session", () => ({
  requireSession: async () => ({ userId: "test-user", organizationId: state.org, role: state.role }),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("@/lib/env", () => ({ isAiConfiguredByEnv: () => false }));
vi.mock("@/server/ai/credentials", () => ({
  getAiCredentialSecret: async (org: string) => {
    if (state.fails) throw new Error("private database detail");
    return org === "org-a" ? { status: "active", tokenLast4: "CRET", statusChangedAt: null,
      baseUrl: state.baseUrl, model: "openai/gpt-4.1-mini", token: "SYNTHETIC-SECRET" } : null;
  },
}));
vi.mock("@/server/demo-center", () => ({ SimulatorError: class SimulatorError extends Error {},
  simulatorCommand: vi.fn(), simulatorRead: vi.fn(), configuredDemoProvider: vi.fn(), realDemoSend: vi.fn(), reconcileDemoOperation: vi.fn() }));

import { GET } from "@/app/api/demo-center/simulator/route";
import { configuredDemoProvider } from "@/server/demo-center/infra/finance";
const request = () => new Request("http://localhost/api/demo-center/simulator?status=1");

describe("estado autenticado del proveedor Demo Center", () => {
  beforeEach(() => { state.org = "org-a"; state.role = "owner"; state.fails = false; state.baseUrl = "https://openrouter.ai/api"; vi.stubEnv("DEMO_REAL_ENABLED", "false"); });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it("recupera el modelo guardado con el modo real apagado sin revelar credenciales", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const response = await GET(request());
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({ enabled: false, configured: true, model: "openai/gpt-4.1-mini" });
    expect(body).not.toContain("SYNTHETIC-SECRET");
    expect(body).not.toContain("CRET");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("no devuelve la configuración de otra organización", async () => {
    state.org = "org-b";
    expect(await (await GET(request())).json()).toEqual({ enabled: false, configured: false, model: null });
  });
  it("rechaza a quien no tiene permisos de administración", async () => {
    state.role = "member";
    expect((await GET(request())).status).toBe(403);
  });
  it("distingue un error de consulta sin divulgar detalles", async () => {
    state.fails = true;
    const response = await GET(request());
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("provider_status_unavailable");
    expect(body).not.toContain("private database detail");
  });
  it("acepta ambas variantes de la URL y mantiene el bloqueo del modo real", async () => {
    await expect(configuredDemoProvider("org-a")).rejects.toMatchObject({ code: "real_not_enabled" });
    vi.stubEnv("DEMO_REAL_ENABLED", "true");
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(configuredDemoProvider("org-a")).resolves.toBeDefined();
    state.baseUrl = "https://openrouter.ai/api/v1/";
    expect((await (await GET(request())).json()).configured).toBe(true);
    await expect(configuredDemoProvider("org-a")).resolves.toBeDefined();
    state.baseUrl = "https://openrouter.ai.evil/api";
    expect((await (await GET(request())).json()).configured).toBe(false);
    await expect(configuredDemoProvider("org-a")).rejects.toMatchObject({ code: "openrouter_required" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
