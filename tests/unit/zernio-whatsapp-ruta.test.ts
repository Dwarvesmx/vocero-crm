import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/zernio-whatsapp/route";
import { recibirEvento } from "@/server/webhooks/recibir";
import { obtenerZernioWhatsAppPorCuenta } from "@/server/zernio/whatsapp-credenciales";

vi.mock("@/server/webhooks/recibir", () => ({ recibirEvento: vi.fn() }));
vi.mock("@/server/zernio/whatsapp-credenciales", () => ({ obtenerZernioWhatsAppPorCuenta: vi.fn() }));
const cuenta = "cuenta-modo", secreto = "secreto-simulado";
const payload = { id: "evento-1", event: "message.received", account: { accountId: cuenta, platform: "whatsapp" },
  conversation: { id: "hilo" }, message: { id: "interno", platformMessageId: "wamid-1", conversationId: "hilo",
    platform: "whatsapp", direction: "incoming", text: "hola", sentAt: "2026-01-01T12:00:00Z", sender: { phoneNumber: "+525512345678" } } };
function request(body: unknown, firma = true) {
  const raw = JSON.stringify(body);
  return new Request("http://localhost/api/webhooks/zernio-whatsapp", { method: "POST", body: raw,
    headers: { "x-zernio-signature": firma ? createHmac("sha256", secreto).update(raw).digest("hex") : "invalida" } });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("ZERNIO_WHATSAPP_ENABLED", "true");
  vi.mocked(obtenerZernioWhatsAppPorCuenta).mockResolvedValue({ accountRef: cuenta, organizationId: "org-modo", token: "falso", secreto });
  vi.mocked(recibirEvento).mockResolvedValue(new Response(null, { status: 200 }));
});
afterEach(() => vi.unstubAllEnvs());
describe("ruta de WhatsApp Zernio", () => {
  it("guarda el evento validado con una clave estable", async () => {
    expect((await POST(request(payload))).status).toBe(200);
    expect(recibirEvento).toHaveBeenCalledWith("zernio_whatsapp", expect.any(Object), expect.any(String), "zernio-whatsapp", { organizationId: "org-modo", deduplicacion: "zernio-whatsapp:cuenta-modo:evento-1" });
  });
  it("rechaza otra cuenta o firma inválida antes de guardar", async () => {
    vi.mocked(obtenerZernioWhatsAppPorCuenta).mockResolvedValueOnce(null);
    expect((await POST(request({ ...payload, account: { accountId: "cuenta-gh", platform: "whatsapp" } }))).status).toBe(401);
    expect((await POST(request(payload, false))).status).toBe(401);
    expect(recibirEvento).not.toHaveBeenCalled();
  });
  it("devuelve 503 si la persistencia falla y permite reintento", async () => {
    vi.mocked(recibirEvento).mockRejectedValueOnce(new Error("fallo"));
    expect((await POST(request(payload))).status).toBe(503);
    expect((await POST(request(payload))).status).toBe(200);
  });
  it("no acusa como guardados los salientes aún no soportados", async () => {
    const salida = { ...payload, event: "message.sent", message: { ...payload.message, direction: "outgoing" } };
    expect((await POST(request(salida))).status).toBe(503);
    expect(recibirEvento).not.toHaveBeenCalled();
  });
  it("está apagada por defecto", async () => {
    vi.stubEnv("ZERNIO_WHATSAPP_ENABLED", "false");
    expect((await POST(request(payload))).status).toBe(404);
  });
});
