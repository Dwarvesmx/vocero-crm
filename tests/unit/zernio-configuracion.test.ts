import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: "owner", accounts: vi.fn(), cred: vi.fn(), save: vi.fn(), webhooks: vi.fn(), transport: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), withAuth: (handler: Function) => (...args: unknown[]) => handler({ role: m.role, organizationId: "org-modo" }, ...args) }));
vi.mock("@/lib/db", () => ({ getSql: () => Object.assign(m.lock, { begin: async (fn: Function) => fn(m.lock) }) }));
vi.mock("@/server/zernio/cuentas", () => ({ fetchZernioAccounts: m.accounts, zernioAccountName: (a: { displayName: string }) => a.displayName }));
vi.mock("@/server/zernio/whatsapp-credenciales", () => ({ obtenerZernioWhatsAppPorOrg: m.cred, guardarZernioWhatsApp: m.save }));
vi.mock("@/server/zernio/webhooks", () => ({ fetchZernioWebhooks: m.webhooks }));
vi.mock("@/server/zernio", () => ({ zernioFetch: m.transport }));
import { GET, PUT, POST, PATCH } from "@/app/api/settings/whatsapp/zernio/route";
const base = "https://crm.example.test";
const request = (method: string, body: object, origin = base) => new Request(base + "/api/settings/whatsapp/zernio", { method, headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
const credential = { organizationId: "org-modo", token: "secret-ficticio-1234", secreto: "firma-ficticia", accountRef: "modo", enabled: false };
beforeEach(() => { vi.clearAllMocks(); m.role = "owner"; vi.stubEnv("APP_BASE_URL", base); vi.stubEnv("ZERNIO_WHATSAPP_ENABLED", "true"); m.cred.mockResolvedValue(credential); m.accounts.mockResolvedValue([{ _id: "modo", platform: "whatsapp", displayName: "ModoNext" }, { _id: "gh", platform: "whatsapp", displayName: "GH Inversiones" }]); m.webhooks.mockResolvedValue([]); });
describe("Configuración Zernio V1", () => {
 it("recupera solo datos enmascarados sin consultar al proveedor", async () => { const d = await (await GET()).json(); expect(d.connection.tokenLast4).toBe("1234"); expect(JSON.stringify(d)).not.toContain(credential.token); expect(JSON.stringify(d)).not.toContain(credential.secreto); expect(m.accounts).not.toHaveBeenCalled(); });
 it("impide administración a otro rol", async () => { m.role = "member"; expect((await GET()).status).toBe(403); expect((await PUT(request("PUT", {}))).status).toBe(403); expect((await POST(request("POST", { action: "accounts" }))).status).toBe(403); expect((await PATCH(request("PATCH", { enabled: false }))).status).toBe(403); });
 it("rechaza escrituras de otro origen", async () => { expect((await PUT(request("PUT", {}, "https://otro.test"))).status).toBe(403); });
 it("acepta el dominio público real aunque Next reciba la URL interna del proxy", async () => {
  vi.stubEnv("APP_BASE_URL", "https://crm.modonext.tech");
  const req = new Request("http://localhost:3000/api/settings/whatsapp/zernio", { method: "POST", headers: { Origin: "https://crm.modonext.tech", "Content-Type": "application/json" }, body: JSON.stringify({ action: "accounts", token: "key-ficticia" }) });
  expect((await POST(req)).status).toBe(200); expect(m.accounts).toHaveBeenCalledWith("key-ficticia");
 });
 it("rechaza orígenes ausentes, null, otro puerto o esquema y cabeceras reenviadas falsas", async () => {
  vi.stubEnv("APP_BASE_URL", "https://crm.modonext.tech");
  for (const origin of [null, "null", "http://crm.modonext.tech", "https://crm.modonext.tech:444", "https://otro.test", "https://crm.modonext.tech.evil.test"]) {
   const headers = new Headers({ "Content-Type": "application/json", "X-Forwarded-Host": "crm.modonext.tech", "X-Forwarded-Proto": "https" }); if (origin) headers.set("Origin", origin);
   const r = await POST(new Request("https://crm.modonext.tech/api/settings/whatsapp/zernio", { method: "POST", headers, body: JSON.stringify({ action: "accounts", token: "key-ficticia" }) })); expect(r.status).toBe(403);
  }
  expect(m.accounts).not.toHaveBeenCalled();
 });
 it("falla cerrado si falta o es inválida la URL pública configurada", async () => {
  for (const value of ["", "no-es-url", "file:///tmp/config"]) { vi.stubEnv("APP_BASE_URL", value); expect((await POST(request("POST", { action: "accounts" }))).status).toBe(403); }
  expect(m.accounts).not.toHaveBeenCalled();
 });
 it("lista solo WhatsApp ModoNext sin selección automática", async () => { const d = await (await POST(request("POST", { action: "accounts", token: "falso" }))).json(); expect(d.accounts).toEqual([{ id: "modo", name: "ModoNext" }]); expect(m.save).not.toHaveBeenCalled(); });
 it("no acepta GH ni siquiera con su ID confirmado", async () => { expect((await PUT(request("PUT", { accountRef: "gh", confirmation: "gh" }))).status).toBe(422); expect(m.save).not.toHaveBeenCalled(); });
 it("guarda cifrado por el servicio existente y siempre apagado", async () => { expect((await PUT(request("PUT", { accountRef: "modo", confirmation: "modo", enabled: true }))).status).toBe(200); expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, token: credential.token, secreto: credential.secreto })); expect(m.transport).not.toHaveBeenCalled(); });
 it("exige confirmación explícita de cuenta", async () => { expect((await PUT(request("PUT", { accountRef: "modo", confirmation: "" }))).status).toBe(422); });
 it("prueba conexión y webhook sin enviar ni registrar", async () => { expect((await POST(request("POST", { action: "test" }))).status).toBe(200); expect(m.transport).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled(); });
 it("registra solo tras confirmación y reserva PostgreSQL", async () => { expect((await POST(request("POST", { action: "webhook", confirmation: "modo" }))).status).toBe(200); expect(m.lock).toHaveBeenCalled(); expect(m.transport).toHaveBeenCalledWith("/webhooks/settings", expect.objectContaining({ method: "POST", body: expect.objectContaining({ accountIds: ["modo"], events: ["message.received", "message.sent"] }) })); });
 it("actualiza el propio sin crear duplicados", async () => { m.webhooks.mockResolvedValue([{ _id: "wh-1", name: "Vocero WhatsApp org-modo", url: base + "/api/webhooks/zernio-whatsapp", accountIds: ["modo"] }]); await POST(request("POST", { action: "webhook", confirmation: "modo" })); expect(m.transport).toHaveBeenCalledWith("/webhooks/settings", expect.objectContaining({ method: "PUT", body: expect.objectContaining({ webhookId: "wh-1" }) })); });
 it("no toca un webhook ajeno en la misma URL", async () => { m.webhooks.mockResolvedValue([{ _id: "otro", url: base + "/api/webhooks/zernio-whatsapp", accountIds: ["gh"] }]); expect((await POST(request("POST", { action: "webhook", confirmation: "modo" }))).status).toBe(409); expect(m.transport).not.toHaveBeenCalled(); });
 it("desconecta localmente sin llamadas externas", async () => { expect((await PATCH(request("PATCH", { enabled: false }))).status).toBe(200); expect(m.save).toHaveBeenCalledWith({ ...credential, enabled: false }); expect(m.transport).not.toHaveBeenCalled(); expect(m.accounts).not.toHaveBeenCalled(); });
 it("no repite un alta con resultado incierto tras reinicio", async () => { m.cred.mockResolvedValue({ ...credential, webhookPending: true }); const r = await POST(request("POST", { action: "webhook", confirmation: "modo" })); expect(r.status).toBe(409); expect(m.transport).not.toHaveBeenCalled(); });
 it("timeout no reintenta a ciegas y oculta errores del proveedor", async () => { m.transport.mockRejectedValue(new Error("secret-provider-data")); const r = await POST(request("POST", { action: "webhook", confirmation: "modo" })); expect(r.status).toBe(503); expect(await r.text()).not.toContain("secret-provider-data"); expect(m.transport).toHaveBeenCalledTimes(1); });
});
