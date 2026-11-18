import { randomUUID } from "node:crypto";
import { apiRoot } from "@/lib/ai/presets";
import { resolveAiProvider } from "@/lib/ai/provider";
import { marcarEstadoPorRespuesta } from "@/server/ai/credentials";

/**
 * 036 — El CRM piensa por el cerebro (`POST /api/bot/llm/{ruta}`).
 *
 * Puerto de `/api/brains/llm` de la edición cloud. La llave de IA se pone una
 * vez, en Ajustes → IA, y no sale del CRM: el cerebro (Nea) apunta el
 * `base_url` de su SDK de OpenAI aquí y el CRM le pone la llave al reenviar.
 * Así quien instala no la copia a dos lugares, una filtrada no viaja, y
 * cuando el proveedor la rechaza (401, o 402 sin saldo) es el CRM quien se
 * entera y la pausa en la pantalla, igual que con el agente que traía.
 *
 * No interpreta el cuerpo: se reenvía como llegó. Entenderlo convertiría al
 * CRM en un mini-OpenRouter que hay que actualizar cada vez que un proveedor
 * agrega un campo.
 *
 * Sin lista de modelos permitidos, a diferencia de cloud (spec 036, D4): allá
 * el cerebro puede ser de un tercero; aquí lo pone quien instala y entra con
 * la misma `BOT_API_KEY` que ya escribe en la bandeja. El perfil le dice qué
 * modelo eligió el negocio (`llm.model`).
 */

/** Cuánto se espera a que el proveedor piense antes de rendirse. */
export const LLM_PROXY_TIMEOUT_MS = 120_000;

export type ResultadoProxy =
  | { ok: true; status: number; cuerpo: string; contentType: string }
  | { ok: false; status: number; code: string; message: string };

export async function pensarPorElCerebro(input: {
  organizationId: string;
  /** Lo que viene después de `/api/bot/llm/`: `chat/completions` hoy. */
  ruta: string;
  cuerpoCrudo: string;
  contentType: string | null;
  correlationId?: string | null;
  intento?: string | null;
}): Promise<ResultadoProxy> {
  const inicio = performance.now();
  const correlationId = input.correlationId && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.correlationId)
    ? input.correlationId : randomUUID();
  const intento = input.intento && /^[1-9][0-9]?$/.test(input.intento) ? Number(input.intento) : null;
  let proveedor: string | null = null;
  let httpUpstream: number | null = null;
  const registrar = (categoria: string, httpDevuelto: number) => {
    if (input.ruta !== "chat/completions") return;
    console.info(JSON.stringify({
      timestamp_utc: new Date().toISOString(), servicio: "vocero", evento: "llm_proxy",
      correlation_id: correlationId, intento, proveedor, http_upstream: httpUpstream,
      http_devuelto: httpDevuelto, categoria, duracion_ms: Math.round(performance.now() - inicio),
    }));
  };

  const r = await resolveAiProvider(input.organizationId).catch((error: unknown) => {
    registrar("error_resolucion", 500);
    throw error;
  });
  if (!r.ok) {
    registrar("sin_credencial", 402);
    return {
      ok: false,
      status: 402,
      code: "sin_credencial",
      message:
        r.estado.motivo === "sin_configurar"
          ? "No hay proveedor de IA configurado. Ponlo en Ajustes → IA."
          : "La llave de IA está pausada (el proveedor la rechazó). Revísala en Ajustes → IA.",
    };
  }
  const { provider } = r;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_PROXY_TIMEOUT_MS);
  try {
    const url = new URL(`${apiRoot(provider.baseUrl)}/${input.ruta}`);
    proveedor = ({
      "openrouter.ai": "openrouter",
      "api.openai.com": "openai",
      "generativelanguage.googleapis.com": "google",
      "api.anthropic.com": "anthropic",
      "api.deepseek.com": "deepseek",
      "api.groq.com": "groq",
    } as Record<string, string>)[url.hostname] ?? "personalizado";
    const res = await fetch(url.href, {
      method: "POST",
      headers: {
        // La llave se pone AQUÍ y solo aquí: no se loguea ni vuelve al cerebro.
        Authorization: `Bearer ${provider.token}`,
        "Content-Type": input.contentType ?? "application/json",
      },
      body: input.cuerpoCrudo,
      signal: controller.signal,
    });
    httpUpstream = res.status;
    const cuerpo = await res.text();

    // El estado de la credencial lo dicta quien cobra. El respaldo del
    // entorno no tiene fila que pausar. `.catch`: un fallo al escribir el
    // estado no convierte la respuesta del proveedor en un error.
    if (!res.ok && provider.source === "org") {
      await marcarEstadoPorRespuesta(input.organizationId, res.status, cuerpo.slice(0, 200)).catch(
        () => {}
      );
    }

    registrar(res.ok ? "respuesta_http" : "error_http", res.status);
    return {
      ok: true,
      status: res.status,
      cuerpo,
      contentType: res.headers.get("content-type") ?? "application/json",
    };
  } catch (err) {
    registrar(err instanceof Error && err.name === "AbortError" ? "timeout" : httpUpstream === null ? "error_comunicacion" : "error_lectura_respuesta", 504);
    // Timeout o red: no fue el proveedor quien rechazó la llave, no se pausa.
    return {
      ok: false,
      status: 504,
      code: "proveedor_sin_respuesta",
      message: err instanceof Error && err.name === "AbortError" ? "El proveedor no contestó a tiempo" : "No se pudo hablar con el proveedor",
    };
  } finally {
    clearTimeout(timer);
  }
}
