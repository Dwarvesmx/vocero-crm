import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getSql } from "@/lib/db";
import { guardarZernioWhatsApp } from "@/server/zernio/whatsapp-credenciales";
const m = vi.hoisted(() => ({ transport: vi.fn(), webhooks: vi.fn() }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), withAuth: (fn: Function) => (...args: unknown[]) => fn({ role: "owner", organizationId: "org_config_pg" }, ...args) }));
vi.mock("@/server/zernio/cuentas", () => ({ fetchZernioAccounts: async () => [{ _id: "modo_config_pg", platform: "whatsapp", displayName: "ModoNext ficticio" }], zernioAccountName: () => "ModoNext ficticio" }));
vi.mock("@/server/zernio/webhooks", () => ({ fetchZernioWebhooks: m.webhooks }));
vi.mock("@/server/zernio", () => ({ zernioFetch: m.transport }));
import { POST } from "@/app/api/settings/whatsapp/zernio/route";
const enabled = process.env.VOCERO_TEST_POSTGRES === "1";
const base = "https://config.example.test";
const own = { _id: "wh_ficticio", name: "Vocero WhatsApp org_config_pg", url: base + "/api/webhooks/zernio-whatsapp", accountIds: ["modo_config_pg"], isActive: true };
const req = (action: string) => new Request(base + "/api/settings/whatsapp/zernio", { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action, confirmation: "modo_config_pg" }) });
describe.skipIf(!enabled)("Configuración con PostgreSQL aislado y API simulada", () => {
 let sql: ReturnType<typeof getSql>;
 beforeAll(async () => {
  const u = new URL(process.env.DATABASE_URL!); if (u.hostname !== "127.0.0.1" || u.pathname !== "/vocero_zernio_test") throw new Error("Base no autorizada");
  sql = getSql(); const [row] = await sql`select current_setting('data_directory') as dir`;
  const norm = (s: string) => s.replaceAll("\\", "/").toLowerCase(); if (norm(row!.dir) !== norm(process.env.VOCERO_TEST_PGDATA!)) throw new Error("Directorio no autorizado");
  process.env.APP_BASE_URL = base;
  await sql`insert into organization (id, name) values ('org_config_pg', 'Configuración ficticia') on conflict do nothing`;
  await guardarZernioWhatsApp({ organizationId: "org_config_pg", accountRef: "modo_config_pg", token: "key_ficticia", secreto: "firma_ficticia" });
 });
 beforeEach(async () => { vi.resetAllMocks(); m.webhooks.mockResolvedValue([]); await sql`update zernio_whatsapp_credentials set webhook_pending=false where organization_id='org_config_pg'`; });
 afterAll(async () => { if (sql) { await sql`delete from organization where id='org_config_pg'`; await sql.end(); } });
 it("serializa dos registros concurrentes y no crea dos webhooks", async () => {
  let registered = false;
  m.webhooks.mockImplementation(async () => registered ? [own] : []);
  m.transport.mockImplementation(async (_path, options) => { if (options.method === "POST") registered = true; return { webhook: own }; });
  const results = await Promise.all([POST(req("webhook")), POST(req("webhook"))]);
  expect(results.map(r => r.status)).toEqual([200, 200]);
  expect(m.transport.mock.calls.filter(c => c[1].method === "POST")).toHaveLength(1);
 });
 it("conserva incertidumbre durable y bloquea un segundo POST tras timeout", async () => {
  m.transport.mockRejectedValue(new Error("timeout ficticio")); expect((await POST(req("webhook"))).status).toBe(503);
  expect((await sql`select webhook_pending from zernio_whatsapp_credentials where organization_id='org_config_pg'`)[0]!.webhook_pending).toBe(true);
  // Otra solicitud/worker reconsulta PostgreSQL, sin memoria compartida de la reserva.
  expect((await POST(req("webhook"))).status).toBe(409); expect(m.transport).toHaveBeenCalledTimes(1);
 });
 it("concilia el alta externa aparecida después del timeout mediante lectura", async () => {
  await sql`update zernio_whatsapp_credentials set webhook_pending=true where organization_id='org_config_pg'`;
  m.webhooks.mockResolvedValue([own]); expect((await POST(req("test"))).status).toBe(200);
  expect((await sql`select webhook_pending from zernio_whatsapp_credentials where organization_id='org_config_pg'`)[0]!.webhook_pending).toBe(false); expect(m.transport).not.toHaveBeenCalled();
 });
});
