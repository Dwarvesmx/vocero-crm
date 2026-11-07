import { z } from "zod";
import { consultarDemoWeb, operarDemoWeb, prepararWhatsAppWeb } from "@/server/demo-center/infra/web";
import { SimulatorError } from "@/server/demo-center";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("close") }).strict(),
  z.object({ action: z.literal("finishWhatsApp") }).strict(),
  z.object({ action: z.literal("startWhatsApp"), phone: z.string().trim().min(7).max(16) }).strict(),
  z.object({ action: z.literal("send"), requestKey: z.string().uuid(), text: z.string().trim().min(1).max(2000) }).strict(),
]);
const token = (req: Request) => /^Bearer ([\w-]{43})$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
function error(e: unknown) {
  const code = e instanceof SimulatorError ? e.code : "unavailable";
  return Response.json({ error: code }, { status: e instanceof SimulatorError ? e.status : 503, headers });
}
export async function GET(req: Request) {
  try { return Response.json(await consultarDemoWeb(token(req)), { headers }); }
  catch (e) { return error(e); }
}
export async function POST(req: Request) {
  if (!token(req)) return error(new SimulatorError("not_found", 404));
  if (req.headers.get("sec-fetch-site") === "cross-site" ||
      req.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return error(new SimulatorError("invalid", 422));
  }
  // Limitar el cuerpo antes de entregarlo a JSON.parse, también con envío por bloques.
  const reader = req.body?.getReader();
  if (!reader) return error(new SimulatorError("invalid", 422));
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let raw = "", size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 12500) {
        await reader.cancel();
        return error(new SimulatorError("invalid", 413));
      }
      raw += decoder.decode(value, { stream: true });
    }
    const parsed = command.safeParse(JSON.parse(raw + decoder.decode()));
    if (!parsed.success) return error(new SimulatorError("invalid", 422));
    return Response.json(parsed.data.action === "startWhatsApp"
      ? await prepararWhatsAppWeb(token(req), parsed.data.phone)
      : await operarDemoWeb(token(req), parsed.data), { headers });
  } catch (e) {
    return error(e instanceof SyntaxError ? new SimulatorError("invalid", 422) : e);
  }
}
