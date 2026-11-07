import { createHash, createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getDb, getSql, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { POST } from "@/app/api/webhooks/zernio-whatsapp/route";
import { construirDespachoWhatsAppDemo } from "@/server/demo-center/infra/whatsapp-dispatch";
import { cerrarVinculoWhatsApp, estadoVinculoWhatsApp, prepararVinculoWhatsApp, restituirWhatsApp } from "@/server/demo-center/infra/whatsapp-link";
import { guardarZernioWhatsApp } from "@/server/zernio/whatsapp-credenciales";
import { tomarPendientes, marcarEntregado } from "@/server/dispatch/outbox";
import { simulatorCommand } from "@/server/demo-center/infra/simulator";
import { POST as SESION } from "@/app/api/bot/demo/session/route";
import { POST as FINANZAS } from "@/app/api/bot/demo/finance/route";
import { POST as GENERAR } from "@/app/api/bot/demo/generate/route";
import { POST as ENTREGA } from "@/app/api/bot/demo/delivery/route";
import { procesarEvento } from "@/server/webhooks/worker";
import { huellaDe } from "@/server/webhooks/eventos";

vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: vi.fn() }));
const efectos = vi.hoisted(() => ({ generadas: 0, salidas: 0 }));
vi.mock("@/server/demo-center/infra/finance", async original => ({
  ...await original<typeof import("@/server/demo-center/infra/finance")>(),
  configuredDemoProvider: async () => ({
    quote: async () => ({ model: "fixture/model", prompt: "0.000001", completion: "0.000001", context: 10000, output: 10, reserve: "10" }),
    execute: async (messages: object[]) => {
      efectos.generadas++;
      const [op] = await getSql()`select status,reserved_amount from demo_usage_operation order by created_at desc limit 1`;
      expect(op).toMatchObject({ status: "uncertain", reserved_amount: "10" });
      const context = JSON.stringify(messages);
      expect(context).toContain("Pizza ficticia Pepperoni");
      expect(context).not.toContain("Lukas privado");
      expect(context).not.toContain("Casa privada");
      return { id: "generation-synthetic", text: "Respuesta controlada de NOVA", cost: "0.000005",
        usage: { cost: "0.000005" }, model: "fixture/model" };
    },
    reconcile: async () => ({ cost: "0.000005", usage: { cost: "0.000005" } }),
  }),
}));
vi.mock("@/server/zernio/whatsapp-envio", () => ({
  enviarTextoWhatsAppZernio: async ({ cuentaAutorizada, conversationId, texto }: Record<string, string>) => {
    expect(cuentaAutorizada).toBe("wa-account");
    expect(conversationId).toBe("wa-thread");
    expect(texto).toBe("Respuesta controlada de NOVA");
    efectos.salidas++;
    return "wamid-out-demo-synthetic";
  },
}));
const org = "wa-example", owner = "wa-owner", cuenta = "wa-account", hilo = "wa-thread", phone = "525511223344";
const bsuid = "BSUID-sintetico", secret = "synthetic-whatsapp-webhook";
const actor = { organizationId: org, userId: owner };

function evento(text: string, opts: { wamid?: string; phone?: string | null; bsuid?: string | null; account?: string; sentAt?: string } = {}) {
  return {
    id: randomUUID(), event: "message.received", account: { id: opts.account ?? cuenta, platform: "whatsapp" },
    conversation: { id: hilo }, message: { id: randomUUID(), platformMessageId: opts.wamid ?? randomUUID(),
      conversationId: hilo, platform: "whatsapp", direction: "incoming", text,
      sentAt: opts.sentAt ?? new Date().toISOString(),
      sender: { phoneNumber: opts.phone === undefined ? "+" + phone : opts.phone,
        businessScopedUserId: opts.bsuid === undefined ? bsuid : opts.bsuid ?? undefined, id: "+" + phone } },
  };
}

async function enviar(event: ReturnType<typeof evento>, firma = true) {
  const body = JSON.stringify(event);
  const signature = firma ? createHmac("sha256", secret).update(body).digest("hex") : "invalid";
  return POST(new Request("http://127.0.0.1:55534/api/webhooks/zernio-whatsapp", { method: "POST",
    headers: { "x-zernio-signature": signature }, body }));
}

async function consumirEnNea(payload: object) {
  const handlers = new Map([["/api/bot/demo/session", SESION], ["/api/bot/demo/finance", FINANZAS],
    ["/api/bot/demo/generate", GENERAR], ["/api/bot/demo/delivery", ENTREGA]]);
  const server = createServer(async (req, res) => {
    try {
      const handler = handlers.get(req.url ?? "");
      if (!handler || req.method !== "POST") { res.writeHead(404).end(); return; }
      const partes: Buffer[] = [];
      for await (const p of req) partes.push(Buffer.from(p));
      const out = await handler(new Request("http://127.0.0.1:55535" + req.url, {
        method: "POST", headers: req.headers as Record<string, string>, body: Buffer.concat(partes),
      }));
      res.writeHead(out.status, Object.fromEntries(out.headers)).end(await out.text());
    } catch { res.writeHead(500).end(); }
  });
  await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(55535, "127.0.0.1", ok); });
  try {
    await new Promise<void>((ok, fail) => {
      const python = process.env.DEMO_WA_PYTHON ?? resolve("../tmp/nea-test-venv/Scripts/python.exe");
      const child = spawn(python, ["-m", "tests.demo_whatsapp_probe"], { cwd: resolve("../nea-agent-dev"), windowsHide: true });
      let error = "";
      child.stderr.on("data", chunk => { error += chunk; });
      child.on("error", fail);
      child.on("close", code => code === 0 ? ok() : fail(new Error(error || "Nea terminó con código " + code)));
      child.stdin.end(JSON.stringify(payload));
    });
  } finally { await new Promise<void>(ok => server.close(() => ok())); }
}

describe.skipIf(process.env.DEMO_WA_TEST !== "1")("WhatsApp Zernio firmado, selector y cola PostgreSQL", () => {
  let sql: ReturnType<typeof getSql>;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "127.0.0.1" || url.port !== "55534" || url.pathname !== "/postgres" || url.username !== "demo_wa") throw Error("Base insegura");
    sql = getSql();
    const [dir] = await sql`select current_setting('data_directory') as dir`;
    if (!String(dir!.dir).replaceAll("\\","/").includes("/demo-wa-pg-")) throw Error("Clúster incorrecto");
    await sql`insert into organization(id,name) values(${org},'Sintética')`;
    await sql`insert into "user"(id,name,email) values(${owner},'Pruebas','wa@example.invalid')`;
    await guardarZernioWhatsApp({ organizationId: org, accountRef: cuenta, token: "fake", secreto: secret, enabled: true });
    await sql`insert into kb_entry(id,organization_id,kind,content) values('lukas-private',${org},'block','Lukas privado')`;
    for (const [space, name] of [["pizza", "NOVA"], ["casa", "Casa Horizonte"]]) {
      await sql`insert into demo_space(id,organization_id,name,commercial_name,sector,status)
        values(${space!},${org},${name!},${name!},'Ficticio','active')`;
      await sql`insert into demo_profile_version(id,organization_id,space_id,version,name,tone,instructions,escalation_rules,greeting,role,created_by)
        values(${space+"-profile"},${org},${space!},1,${name!},'Amable','Ficticio','','','Información',${owner})`;
      await sql`update demo_space set current_profile_version_id=${space+"-profile"} where id=${space!}`;
      await sql`insert into kb_entry(id,organization_id,demo_space_id,kind,content) values(${space+"-kb"},${org},${space!},'block',
        ${space === "pizza" ? "Pizza ficticia Pepperoni" : "Casa privada"})`;
    }
    for (const space of [null, "pizza", "casa"]) await sql`insert into demo_limits(id,organization_id,space_id,max_duration_seconds,max_idle_seconds,
      max_concurrent_sessions,max_sessions_started,max_inbound_messages,max_assistant_responses,max_provider_calls,budget_micro_usd,session_budget_micro_usd,window_start,window_end)
      values(${space ?? "global"},${org},${space},900,300,5,20,2,10,10,1000,100,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day')`;
  });

  async function invitacion(space: string) {
    const web = await simulatorCommand(actor, { action: "start", spaceId: space, requestKey: randomUUID() }, { tokenHash: randomUUID() });
    const enlace = await prepararVinculoWhatsApp({ id: web.id, organization_id: org }, phone);
    const code = new URL(enlace.url).searchParams.get("text")!;
    expect(code).toMatch(/^MODONEXT-DEMO [\w-]{32}$/);
    return { web: String(web.id), code };
  }

  it("enlaza solo la identidad esperada, fija asistente, aísla duplicados, cambia de demo y restituye con corte", async () => {
    const pizza = await invitacion("pizza");
    expect((await enviar(evento(pizza.code), false)).status).toBe(401);
    expect((await enviar(evento(pizza.code, { account: "other" }))).status).toBe(401);
    for (const wrong of [{ phone: null }, { phone: "525500000001" }]) expect((await enviar(evento(pizza.code, wrong))).status).toBe(200);
    expect((await estadoVinculoWhatsApp(org, pizza.web))?.state).toBe("pending");
    expect((await enviar(evento(pizza.code))).status).toBe(200);
    expect((await estadoVinculoWhatsApp(org, pizza.web))?.state).toBe("linked");
    const [sinCodigo] = await sql`select count(*)::int as n from webhook_event where payload::text like ${"%" + pizza.code + "%"}`;
    expect(sinCodigo!.n).toBe(0);
    await sql`update demo_whatsapp_link set linked_at=clock_timestamp()-interval '3 seconds' where web_session_id=${pizza.web}`;
    const pregunta = evento("¿Qué pizza tienen?", { phone: null });
    for (const result of await Promise.all([enviar(pregunta), enviar({ ...pregunta, id: randomUUID() })])) expect(result.status).toBe(200);
    expect((await enviar(evento("Teléfono explícito contradice el alias", { phone: "525500000001" }))).status).toBe(200);
    const [job] = await tomarPendientes(1);
    expect(job?.scopeKind).toBe("demo");
    const sobre = await construirDespachoWhatsAppDemo(job!);
    expect(sobre?.demo.scope).toMatchObject({ spaceId: "pizza", profileVersionId: "pizza-profile" });
    expect(sobre?.channelContext.identity).toEqual({ kind: "phone", value: phone });
    expect(sobre?.messages).toHaveLength(1);
    const [cuentaMensajes] = await sql`select count(*)::int as n from message where scope_kind='demo'`;
    expect(cuentaMensajes!.n).toBe(1);
    await consumirEnNea(sobre!);
    const [operacion] = await sql`select status,actual_amount from demo_usage_operation where operation_key=${job!.id}`;
    expect(operacion).toMatchObject({ status: "settled", actual_amount: "5" });
    expect(efectos).toEqual({ generadas: 1, salidas: 1 });
    const [salida] = await sql`select status,wa_message_id from message where organization_id=${org} and direction='out' and scope_kind='demo'`;
    expect(salida).toMatchObject({ status: "sent", wa_message_id: "wamid-out-demo-synthetic" });
    const confirmacion = evento("fixture", { wamid: "wamid-out-demo-synthetic" });
    Object.assign(confirmacion, { event: "message.delivered", statusAt: new Date().toISOString() });
    confirmacion.message.direction = "outgoing";
    expect((await enviar(confirmacion)).status).toBe(200);
    const [callback] = await sql`select id from webhook_event where huella=${huellaDe("zernio-whatsapp:" + cuenta + ":" + confirmacion.id)}`;
    await procesarEvento(callback!.id);
    const [entregado] = await sql`select status from message where wa_message_id='wamid-out-demo-synthetic'`;
    expect(entregado!.status).toBe("delivered");
    await sql`update demo_limits set budget_micro_usd=5 where id='pizza'`;
    const sinPresupuesto = await FINANZAS(new Request("http://127.0.0.1:55535/api/bot/demo/finance", {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": process.env.BOT_API_KEY! },
      body: JSON.stringify({ contractVersion: 1, action: "reserve", organizationId: org, spaceId: "pizza",
        sessionId: job!.demoSessionId, operationKey: randomUUID(), inputDigest: createHash("sha256").update("extra").digest("hex") }),
    }));
    expect(sinPresupuesto.status).toBe(429);
    expect(efectos).toEqual({ generadas: 1, salidas: 1 });
    await sql`update demo_limits set budget_micro_usd=1000 where id='pizza'`;
    await marcarEntregado(job!);
    const casa = await invitacion("casa");
    expect((await enviar(evento(casa.code))).status).toBe(200);
    expect((await estadoVinculoWhatsApp(org, pizza.web))?.state).toBe("superseded");
    await sql`update demo_whatsapp_link set linked_at=clock_timestamp()-interval '3 seconds' where web_session_id=${casa.web}`;
    expect((await enviar(evento("Pregunta anterior", { sentAt: new Date(Date.now()-120000).toISOString() }))).status).toBe(200);
    expect((await enviar(evento("¿Qué viviendas ficticias hay?"))).status).toBe(200);
    const [segundo] = await tomarPendientes(1);
    expect((await construirDespachoWhatsAppDemo(segundo!))?.demo.scope.spaceId).toBe("casa");
    const agotada = evento("Otro mensaje tras agotar la cuota");
    expect((await enviar(agotada)).status).toBe(200);
    const [sinTurno] = await sql`select scope_kind from message where wa_message_id=${agotada.message.platformMessageId}`;
    expect(sinTurno!.scope_kind).toBe("blocked");
    await cerrarVinculoWhatsApp(org, casa.web, "revoked", owner);
    expect((await estadoVinculoWhatsApp(org, casa.web))?.state).toBe("revoked");
    expect(await construirDespachoWhatsAppDemo(segundo!)).toBeNull();
    await enviar(evento("No debe llegar a Lukas"));
    const [ruta] = await sql`select generation from demo_identity_route where organization_id=${org}`;
    await restituirWhatsApp(actor, "casa", casa.web, ruta!.generation);
    await enviar(evento("Atrasado tras la restitución", { sentAt: new Date(Date.now()-10000).toISOString() }));
    await sql`update demo_identity_route set blocked_since=clock_timestamp()-interval '3 seconds' where organization_id=${org}`;
    const nuevo = evento("Solicito información comercial");
    expect((await enviar(nuevo)).status).toBe(200);
    const rows = await getDb().select().from(schema.webhookEvent).where(eq(schema.webhookEvent.organizationId, org));
    expect(rows.filter(row => row.status === "pendiente")).toHaveLength(1);
    expect(rows.find(row => row.status === "pendiente")?.payload).toMatchObject({ id: nuevo.id });
    const [bloqueados] = await sql`select count(*)::int as n from message where scope_kind='blocked'`;
    expect(bloqueados!.n).toBeGreaterThanOrEqual(3);
  }, 45000);
});
