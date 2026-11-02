import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/bot/messages/route";
import { getDb } from "@/lib/db";
import { sendText } from "@/server/inbox/send";

vi.mock("@/lib/db", async (original) => ({ ...(await original<typeof import("@/lib/db")>()), getDb: vi.fn() }));
vi.mock("@/server/bot/auth", () => ({ requireBotKey: () => null, resolveInstanceOrg: async () => "org" }));
vi.mock("@/server/inbox/send", () => ({ AiPausedError: class extends Error {}, SendError: class extends Error {}, sendText: vi.fn() }));

beforeEach(() => {
  vi.mocked(getDb).mockReturnValue({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ aiEnabled: true, handoffAt: null, isTest: false }] }) }) }) } as never);
  vi.mocked(sendText).mockReset().mockResolvedValue({ messageId: "mensaje" });
});
const request = (responseId?: string) => new Request("http://localhost/api/bot/messages", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ conversationId: "conv", text: "hola", responseId }),
});

it("transmite la identidad validada y aislada del espacio de claves manuales", async () => {
  const id = "E5E46ABB-14D3-4FE2-B7C9-497DA6E98791";
  expect((await POST(request(id))).status).toBe(200);
  expect(sendText).toHaveBeenCalledWith(expect.objectContaining({ requestKey: `nea:${id.toLowerCase()}` }));
});

it("conserva el contrato heredado y rechaza identidades inválidas", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(sendText).toHaveBeenCalledWith(expect.objectContaining({ requestKey: undefined }));
  expect((await POST(request("no-es-uuid"))).status).toBe(422);
  expect(sendText).toHaveBeenCalledTimes(1);
});
