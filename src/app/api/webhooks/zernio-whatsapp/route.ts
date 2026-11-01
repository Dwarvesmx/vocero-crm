import { recibirEvento } from "@/server/webhooks/recibir";
import { obtenerZernioWhatsAppPorCuenta } from "@/server/zernio/whatsapp-credenciales";
import { validarEventoWhatsAppZernio } from "@/server/zernio/whatsapp-evento";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (process.env.ZERNIO_WHATSAPP_ENABLED !== "true") return new Response(null, { status: 404 });
  const cuerpo = await req.text();
  let cuenta: string | undefined;
  try {
    const payload = JSON.parse(cuerpo) as { account?: { accountId?: unknown; id?: unknown } };
    const valor = payload.account?.accountId ?? payload.account?.id;
    if (typeof valor === "string") cuenta = valor;
  } catch { return new Response(null, { status: 400 }); }
  if (!cuenta) return new Response(null, { status: 401 });
  try {
    const cred = await obtenerZernioWhatsAppPorCuenta(cuenta);
    if (!cred) return new Response(null, { status: 401 });
    const evento = validarEventoWhatsAppZernio({ cuerpo, firma: req.headers.get("x-zernio-signature"), secreto: cred.secreto, cuentaAutorizada: cred.accountRef });
    if (!evento) return new Response(null, { status: 401 });
    // No acusar salientes antes de implementar su persistencia de coexistence.
    if (evento.event !== "message.received") return new Response(null, { status: 503 });
    return await recibirEvento("zernio_whatsapp", evento, cuerpo, "zernio-whatsapp", {
      organizationId: cred.organizationId, deduplicacion: `zernio-whatsapp:${cred.accountRef}:${evento.id}`,
    });
  } catch { return new Response(null, { status: 503 }); }
}
