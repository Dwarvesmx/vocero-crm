import { POST as ADMIN_SPACE } from "@/app/api/demo-center/route";
import * as credenciales from "@/server/zernio/whatsapp-credenciales";
import { build } from "esbuild";
import { chromium } from "playwright";
import { GET as ADMIN_GET, POST as ADMIN_POST } from "@/app/api/demo-center/web/route";
import { reconcileDemoNotice } from "@/server/demo-center/infra/delivery";
import { encolarAvisoDemo } from "@/server/demo-center/infra/whatsapp-notice";
import { revocarDemoWeb } from "@/server/demo-center/infra/web";
import { recuperarSalidasInciertasZernio } from "@/server/zernio/whatsapp-autorizacion";
import { caducarDemosConversacionales } from "@/server/demo-center/infra/whatsapp-lifecycle";
import { encolarEnvioWhatsAppZernio } from "@/server/zernio/whatsapp-outbox";
import { POST as OFRECER } from "@/app/api/bot/demo/offer/route";
import { liberarSalidaZernio } from "@/server/zernio/whatsapp-autorizacion";
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

const adminAuth = vi.hoisted(() => ({ role: "owner" }));
vi.mock("@/lib/auth/session", () => ({
  requireSession: async () => ({ userId: "wa-owner", organizationId: "wa-example", role: adminAuth.role }),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: vi.fn() }));
const efectos = vi.hoisted(() => ({ generadas: 0, salidas: 0, avisos: 0, receipt: null as null | {messageId:string;status:"delivered"} }));
const confirmacionesComerciales = vi.hoisted(() => ({ enabled: false }));
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
  consultarConfirmacionDemoZernio: async () => efectos.receipt,
  consultarConfirmacionesZernio: async (_hilo: unknown, ids: string[]) =>
    new Map(confirmacionesComerciales.enabled ? ids.map(id => [id, "delivered"] as const) : []),
  enviarTextoWhatsAppZernio: async ({ cuentaAutorizada, conversationId, texto }: Record<string, string>) => {
    expect(cuentaAutorizada).toBe("wa-account");
    expect(conversationId).toBe("wa-thread");
    if (texto?.startsWith("Empezó la demo") || texto?.startsWith("La demostración terminó")) { efectos.avisos++; return "notice-" + randomUUID(); }
    expect(texto).toBe("Respuesta controlada de NOVA");
    efectos.salidas++;
    return efectos.salidas === 1 ? "wamid-out-demo-synthetic" : "wamid-out-" + randomUUID();
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
    await sql`insert into member(id,organization_id,user_id,role) values('wa-member',${org},${owner},'owner')`;
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
    expect(efectos).toEqual({ generadas: 1, salidas: 1, avisos: 0, receipt: null });
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
    expect(efectos).toEqual({ generadas: 1, salidas: 1, avisos: 0, receipt: null });
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

  it("ofrece por HTTP con identidad firmada y solo activa tras consentimiento; cierra y restituye", async () => {
    vi.stubEnv("DEMO_CONVERSATIONAL_ENABLED", "true");
    await sql`update demo_limits set max_inbound_messages=10`;
    try {
      const [conv] = await sql`select id from conversation where organization_id=${org} and channel_thread_ref=${hilo}`;
      const [source] = await sql`select id,payload from webhook_event where organization_id=${org} and status='pendiente'`;
      await sql`update webhook_event set status='procesado' where id=${source!.id}`;
      const msg = randomUUID(), dispatch = randomUUID();
      await sql`insert into message(id,organization_id,conversation_id,wa_message_id,direction,type,text,status,wa_timestamp)
        values(${msg},${org},${conv!.id},${source!.payload.message.platformMessageId},'in','text','Solicito una demo','delivered',clock_timestamp())`;
      await sql`insert into dispatch(id,organization_id,conversation_id,status,message_ids,not_before,first_message_at,last_message_at)
        values(${dispatch},${org},${conv!.id},'entregado',${JSON.stringify([msg])}::jsonb,clock_timestamp(),clock_timestamp(),clock_timestamp())`;
      const tracedSend = () => encolarEnvioWhatsAppZernio({organizationId:org,conversationId:conv!.id,accountRef:cuenta,
        threadRef:hilo,text:"Respuesta comercial trazada",requestKey:"nea:trace-test",aiGenerated:true,sourceDispatchId:dispatch});
      const tracedId=await tracedSend();
      expect(await tracedSend()).toBe(tracedId);
      await expect(encolarEnvioWhatsAppZernio({organizationId:org,conversationId:conv!.id,accountRef:cuenta,
        threadRef:hilo,text:"Respuesta comercial trazada",requestKey:"nea:trace-test",aiGenerated:true,sourceDispatchId:"otro-despacho"})).rejects.toThrow();
      await expect(encolarEnvioWhatsAppZernio({organizationId:org,conversationId:conv!.id,accountRef:cuenta,
        threadRef:hilo,text:"Otro origen",requestKey:"nea:wrong-source",aiGenerated:true,sourceDispatchId:"otro-despacho"})).rejects.toThrow();
      const [trace]=await sql`select source_dispatch_id,commercial_route_generation from zernio_whatsapp_outbox where message_id=${tracedId}`;
      expect(trace?.source_dispatch_id).toBe(dispatch);
      expect(trace?.commercial_route_generation).not.toBeNull();
      await sql`update zernio_whatsapp_outbox set status='cancelado' where message_id=${tracedId}`;
      const offer = (sector: string, apiKey = process.env.BOT_API_KEY!, conversationId = conv!.id) => OFRECER(new Request("http://127.0.0.1:55535/api/bot/demo/offer", {
        method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ contractVersion: 1, conversationId, dispatchId: dispatch, sector }),
      }));
      expect((await offer("NOVA", "invalid")).status).toBe(401);
      expect((await offer("NOVA", process.env.BOT_API_KEY, "otra-conversacion")).status).toBe(403);
      expect(await (await offer("sector desconocido")).json()).toMatchObject({ status: "choose",
        options: [{ id: "pizza", demo: "NOVA", commercialName: "NOVA" }] });
      const [authorized] = await sql`select id from demo_authorization where organization_id=${org} and space_id='pizza' and state='active'`;
      expect(authorized).toBeTruthy();
      await sql`update demo_authorization set state='revoked' where id=${authorized!.id}`;
      expect((await offer("NOVA")).status).toBe(403);
      await sql`update demo_authorization set state='active' where id=${authorized!.id}`;
      await sql`insert into demo_authorization(id,organization_id,space_id,channel,canonical_phone,phone_lookup,phone_suffix,created_by)
        select 'other-auth',organization_id,space_id,channel,canonical_phone,${"f".repeat(64)},'0000',created_by from demo_authorization where id=${authorized!.id}`;
      expect((await offer("NOVA")).status).toBe(200);
      vi.stubEnv("DEMO_CONVERSATIONAL_SINGLE_PARTICIPANT", "true");
      expect((await offer("NOVA")).status).toBe(403);
      vi.stubEnv("DEMO_CONVERSATIONAL_SINGLE_PARTICIPANT", "false");
      await sql`update demo_authorization set state='revoked' where id='other-auth'`;
      const resp = await offer("NOVA");
      const data = await resp.json();
      expect(data).toMatchObject({ status: "offered" });
      expect(await (await offer("NOVA")).json()).toEqual(data);
      await enviar(evento("ACEPTO DEMO")); // todavía no hay oferta enviada
      const [notYet] = await sql`select mode from demo_identity_route where organization_id=${org}`;
      expect(notYet!.mode).toBe("commercial");
      const outbound = randomUUID();
      await sql`insert into message(id,organization_id,conversation_id,direction,type,text,status)
        values(${outbound},${org},${conv!.id},'out','text',${data.message},'delivered')`;
      await sql`insert into zernio_whatsapp_outbox(id,organization_id,conversation_id,message_id,account_ref,thread_ref,request_key,status,updated_at)
        values(${randomUUID()},${org},${conv!.id},${outbound},${cuenta},${hilo},'fixture-commercial-offer','completado',clock_timestamp()-interval '2 seconds')`;
      expect((await enviar(evento("ACEPTO DEMO"), false)).status).toBe(401);
      await enviar(evento("ACEPTO DEMO", { phone: null }));
      await enviar(evento("ACEPTO DEMO", { bsuid: "otro-alias" }));
      const [stillNot] = await sql`select mode from demo_identity_route where organization_id=${org}`;
      expect(stillNot!.mode).toBe("commercial");
      const [evidence] = await sql`select e.metadata,e.metadata->>'thread' as thread,l.created_at,o.created_at at time zone 'UTC' as message_created,
        j.updated_at at time zone 'UTC' as sent_at,clock_timestamp() as now from demo_session_event e
        join demo_whatsapp_link l on l.web_session_id=e.session_id
        join message o on o.id=${outbound} join zernio_whatsapp_outbox j on j.message_id=o.id
        where e.type='whatsapp_demo_offered'`;
      expect(evidence?.thread).toBe(hilo);
      expect(+new Date(evidence!.message_created)).toBeGreaterThanOrEqual(+new Date(evidence!.created_at));
      expect(+new Date(evidence!.sent_at)).toBeLessThan(+new Date(evidence!.now));
      await sql`update demo_authorization set state='revoked' where id=${authorized!.id}`;
      const revokedConsent=evento("ACEPTO DEMO");
      await enviar(revokedConsent);
      const [revokedResult]=await sql`select payload->>'result' as result from webhook_event where payload->>'id'=${revokedConsent.id}`;
      expect(revokedResult!.result).toBe("consent_unverified");
      await sql`update demo_authorization set state='active' where id=${authorized!.id}`;
      const providerMessageId = "wamid-commercial-offer-synthetic";
      await sql`update message set status='sent',wa_message_id=${providerMessageId} where id=${outbound}`;
      for (let i = 0; i < 12; i++) {
        const message = randomUUID();
        await sql`insert into message(id,organization_id,conversation_id,wa_message_id,direction,type,text,status)
          values(${message},${org},${conv!.id},${`commercial-${i}`},'out','text','Mensaje anterior','sent')`;
        await sql`insert into zernio_whatsapp_outbox(id,organization_id,conversation_id,message_id,account_ref,thread_ref,request_key,status)
          values(${randomUUID()},${org},${conv!.id},${message},${cuenta},${hilo},${`commercial-request-${i}`},'completado')`;
      }
      const blockedConsent = evento("ACEPTO DEMO");
      await enviar(blockedConsent);
      const [blockedResult] = await sql`select payload->>'result' as result from webhook_event where payload->>'id'=${blockedConsent.id}`;
      expect(blockedResult?.result).toBe("thread_busy");
      confirmacionesComerciales.enabled = true;
      const consent = evento("ACEPTO DEMO");
      try { expect((await enviar(consent)).status).toBe(200); }
      finally { confirmacionesComerciales.enabled = false; }
      const [reconciliado] = await sql`select status from message where id=${outbound}`;
      expect(reconciliado?.status).toBe("delivered");
      const [pendientesComerciales] = await sql`select count(*)::int as total from message
        where organization_id=${org} and conversation_id=${conv!.id} and direction='out' and status='sent'`;
      expect(pendientesComerciales?.total).toBe(0);
      expect((await enviar({ ...consent, id: randomUUID() })).status).toBe(200);
      const [verdict] = await sql`select payload->>'result' as result from webhook_event where payload->>'id'=${consent.id}`;
      expect(verdict?.result).toBe("linked");
      const [linked] = await sql`select r.mode,s.id,s.profile_version_id,l.web_session_id from demo_identity_route r
        join demo_session s on s.id=r.session_id join demo_whatsapp_link l on l.external_session_id=s.id where r.organization_id=${org}`;
      expect(linked).toMatchObject({ mode: "demo", profile_version_id: "pizza-profile" });
      const [start] = await sql`select id from zernio_whatsapp_outbox where request_key=${"demo-notice:" + linked!.id + ":started"}`;
      const repetir = () => sql.begin(async tx => encolarAvisoDemo(tx, org, linked!.id, cuenta, hilo, "started", consent.message.sentAt));
      expect(await Promise.all([repetir(), repetir()])).toEqual([start!.id, start!.id]);
      await expect(sql.begin(async tx => encolarAvisoDemo(tx, org, linked!.id, cuenta, "hilo-distinto", "started", consent.message.sentAt)))
        .rejects.toMatchObject({ code: "delivery_conflict" });
      const [costBefore] = await sql`select count(*)::int as n from demo_usage_operation where session_id=${linked!.id}`;
      await sql`update zernio_whatsapp_credentials set enabled=false where organization_id=${org}`;
      await expect(liberarSalidaZernio(start!.id)).rejects.toMatchObject({code:"transport_unavailable"});
      const [beforeSend] = await sql`select status,attempts from zernio_whatsapp_outbox where id=${start!.id}`;
      expect(beforeSend).toMatchObject({status:"retenido",attempts:0});
      expect(efectos.avisos).toBe(0);
      const [costAfter] = await sql`select count(*)::int as n from demo_usage_operation where session_id=${linked!.id}`;
      expect(costAfter!.n).toBe(costBefore!.n);
      await sql`update zernio_whatsapp_credentials set enabled=true where organization_id=${org}`;
      const timeoutPrevio = vi.spyOn(credenciales, "descifrar").mockImplementationOnce(() => { throw new Error("timeout antes del transporte"); });
      await expect(liberarSalidaZernio(start!.id)).rejects.toThrow("timeout antes del transporte");
      timeoutPrevio.mockRestore();
      const [timeoutState] = await sql`select status,attempts from zernio_whatsapp_outbox where id=${start!.id}`;
      expect(timeoutState).toMatchObject({status:"retenido",attempts:0});
      expect(efectos.avisos).toBe(0);
      await Promise.all([liberarSalidaZernio(start!.id), liberarSalidaZernio(start!.id)]);
      expect(efectos.avisos).toBe(1);
      const [startStatus] = await sql`select status from zernio_whatsapp_outbox where id=${start!.id}`;
      expect(startStatus!.status).toBe("completado");
      await sql`update message set status='delivered' where id=(select message_id from zernio_whatsapp_outbox where id=${start!.id})`;
      await sql`update demo_whatsapp_link set linked_at=clock_timestamp()-interval '3 seconds' where external_session_id=${linked!.id}`;
      await expect(encolarEnvioWhatsAppZernio({ organizationId: org, conversationId: conv!.id, accountRef: cuenta,
        threadRef: hilo, text: "No debe entrar al canal demo", requestKey: "commercial-blocked" })).rejects.toThrow();
      const question = evento("¿Qué pizza tienen?");
      await enviar(question);
      const [questionVerdict] = await sql`select payload->>'result' as result from webhook_event where payload->>'id'=${question.id}`;
      expect(questionVerdict?.result).toBe("demo");
      const [demoJob] = await tomarPendientes(1);
      expect(demoJob?.demoSessionId).toBe(linked!.id);
      const demoPayload = await construirDespachoWhatsAppDemo(demoJob!);
      expect(demoPayload?.demo.scope.spaceId).toBe("pizza");
      await consumirEnNea(demoPayload!);
      await sql`update message set status='delivered' where organization_id=${org} and demo_session_id=${linked!.id} and direction='out' and status='sent'`;
      const [paid] = await sql`select status,actual_amount from demo_usage_operation where operation_key=${demoJob!.id}`;
      expect(paid).toMatchObject({ status: "settled", actual_amount: "5" });
      await marcarEntregado(demoJob!);
      await enviar(evento("TERMINAR DEMO"));
      const [closed] = await sql`select state from demo_session where id=${linked!.id}`;
      expect(closed!.state).toBe("closed");
      const [blocked] = await sql`select mode,generation from demo_identity_route where organization_id=${org}`;
      expect(blocked!.mode).toBe("blocked");
      const [end] = await sql`select id from zernio_whatsapp_outbox where request_key=${"demo-notice:" + linked!.id + ":ended"}`;
      await expect(restituirWhatsApp(actor, "pizza", linked!.web_session_id, blocked!.generation)).rejects.toMatchObject({ code: "thread_busy" });
      await sql`update zernio_whatsapp_outbox set status='iniciado',leased_until=clock_timestamp()-interval '1 second' where id=${end!.id}`;
      await recuperarSalidasInciertasZernio(org);
      const [uncertain] = await sql`select status from zernio_whatsapp_outbox where id=${end!.id}`;
      expect(uncertain!.status).toBe("incierto");
      expect(await reconcileDemoNotice(org, "pizza", end!.id)).toEqual({ status: "uncertain" });
      await expect(reconcileDemoNotice(org, "casa", end!.id)).rejects.toMatchObject({ code: "not_found" });
      await liberarSalidaZernio(end!.id);
      expect(efectos.avisos).toBe(1);
      await expect(restituirWhatsApp(actor, "pizza", linked!.web_session_id, blocked!.generation)).rejects.toMatchObject({ code: "thread_busy" });
      // En el transporte controlado se confirma el intento antes de continuar.
      await sql`update message set wa_message_id='notice-confirmed' where id=(select message_id from zernio_whatsapp_outbox where id=${end!.id})`;
      efectos.receipt = {messageId:"notice-confirmed",status:"delivered"};
      expect(await reconcileDemoNotice(org, "pizza", end!.id)).toEqual({ status: "delivered" });
      expect(await reconcileDemoNotice(org, "pizza", end!.id)).toEqual({ status: "delivered" });
      efectos.receipt = null;
      const [endStatus] = await sql`select status from zernio_whatsapp_outbox where id=${end!.id}`;
      expect(endStatus!.status).toBe("completado");
      const [commercialControl] = await sql`select count(*)::int as n from message where scope_kind='commercial' and text in ('ACEPTO DEMO','TERMINAR DEMO')`;
      expect(commercialControl!.n).toBe(0);
      const legacy=randomUUID();
      await sql`insert into dispatch(id,organization_id,conversation_id,status,message_ids,not_before,first_message_at,last_message_at)
        values(${legacy},${org},${conv!.id},'entregado','[]'::jsonb,clock_timestamp(),clock_timestamp(),clock_timestamp())`;
      await expect(restituirWhatsApp(actor, "pizza", linked!.web_session_id, blocked!.generation)).rejects.toMatchObject({code:"thread_busy"});
      await sql`update dispatch set status='descartado' where id=${legacy}`;
      await restituirWhatsApp(actor, "pizza", linked!.web_session_id, blocked!.generation);
      const [restored] = await sql`select mode from demo_identity_route where organization_id=${org}`;
      expect(restored!.mode).toBe("commercial");
      await expect(encolarEnvioWhatsAppZernio({organizationId:org,conversationId:conv!.id,accountRef:cuenta,
        threadRef:hilo,text:"Respuesta antigua",requestKey:"nea:late",aiGenerated:true,sourceDispatchId:dispatch})).rejects.toThrow();
      await expect(encolarEnvioWhatsAppZernio({organizationId:org,conversationId:conv!.id,accountRef:cuenta,
        threadRef:hilo,text:"Respuesta sin origen",requestKey:"nea:legacy",aiGenerated:true})).rejects.toThrow();
      // Recrear un vencimiento exclusivamente en la base descartable para probar el barrido.
      await sql`update demo_session set state='active',ended_at=null,expires_at=clock_timestamp()-interval '1 second' where id=${linked!.id}`;
      await sql`update demo_identity_route set mode='demo',session_id=${linked!.id},
        generation=(select route_generation from demo_session where id=${linked!.id}) where organization_id=${org}`;
      await sql`update zernio_whatsapp_outbox set status='incierto' where id=${end!.id}`;
      await caducarDemosConversacionales();
      const [expired] = await sql`select s.state,r.mode,r.blocked_reason from demo_session s join demo_identity_route r on r.organization_id=s.organization_id
        where s.id=${linked!.id}`;
      expect(expired).toMatchObject({ state: "expired", mode: "blocked", blocked_reason: "session_deadline" });
      await sql`update zernio_whatsapp_outbox set status='completado' where id=${end!.id}`;
      await sql`update message set status='sent' where id=(select message_id from zernio_whatsapp_outbox where id=${start!.id})`;
      await caducarDemosConversacionales();
      const [stillBlocked]=await sql`select mode from demo_identity_route where organization_id=${org}`;
      expect(stillBlocked!.mode).toBe("blocked");
      await sql`update message set status='delivered' where organization_id=${org} and demo_session_id=${linked!.id}
        and direction='out' and scope_kind='demo' and status='sent'`;
      await caducarDemosConversacionales();
      const [autoRestored]=await sql`select mode from demo_identity_route where organization_id=${org}`;
      expect(autoRestored!.mode).toBe("commercial");
      await sql`update demo_session set state='active',ended_at=null,expires_at=clock_timestamp()+interval '5 minutes' where id=${linked!.id}`;
      await sql`update demo_identity_route set mode='demo',session_id=${linked!.id},
        generation=(select route_generation from demo_session where id=${linked!.id}) where organization_id=${org}`;
      await sql`update zernio_whatsapp_outbox set status='incierto' where id=${end!.id}`;
      const bundle = await build({stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";
        import {InvitacionesDemoWeb} from "./src/components/demo-center/web-admin";
        createRoot(document.getElementById("root")).render(<InvitacionesDemoWeb spaceId="pizza"/>);`,
        loader:"tsx",resolveDir:process.cwd()},jsx:"automatic",bundle:true,write:false});
      vi.stubEnv("DEMO_WEB_ENABLED","true");
      const server=createServer(async(req,res)=>{
        try{
          if(req.url==="/"){res.writeHead(200,{"content-type":"text/html"}).end('<div id="root"></div><script src="/bundle.js"></script>');return;}
          if(req.url==="/bundle.js"){res.writeHead(200,{"content-type":"application/javascript"}).end(bundle.outputFiles[0]!.text);return;}
          if(req.url?.startsWith("/api/demo-center/web")){
            const parts:Buffer[]=[];for await(const part of req)parts.push(Buffer.from(part));
            const request=new Request("http://127.0.0.1:55536"+req.url,{method:req.method,headers:req.headers as Record<string,string>,...(req.method==="POST"&&{body:Buffer.concat(parts)})});
            const response=req.method==="POST"?await ADMIN_POST(request):await ADMIN_GET(request);
            res.writeHead(response.status,Object.fromEntries(response.headers)).end(await response.text());return;
          }
          res.writeHead(404).end();
        }catch(e){res.writeHead(500).end(String(e));}
      });
      await new Promise<void>((ok,fail)=>{server.once("error",fail);server.listen(55536,"127.0.0.1",ok);});
      const browser=await chromium.launch({channel:"chrome",headless:true});
      try{
        const page=await browser.newPage();
        await page.goto("http://127.0.0.1:55536/");
        const row=page.locator("li").filter({hasText:"WhatsApp"}).first();
        await row.getByRole("button",{name:"Finalizar y revocar WhatsApp"}).click();
        adminAuth.role="member";
        await row.getByRole("button",{name:"Confirmar"}).click();
        await page.getByRole("alert").waitFor();
        const [stillActive]=await sql`select state from demo_session where id=${linked!.id}`;
        expect(stillActive!.state).toBe("active");
        adminAuth.role="owner";
        await row.getByRole("button",{name:"Finalizar y revocar WhatsApp"}).click();
        const confirm=row.getByRole("button",{name:"Confirmar"});
        await confirm.dblclick({timeout:3000}).catch(async()=>{if(await confirm.isVisible())await confirm.click();});
        await row.getByText(/En cuarentena/).waitFor();
        await row.getByRole("button",{name:"Restituir atención comercial"}).click();
        await row.getByRole("button",{name:"Confirmar"}).click();
        await page.getByRole("alert").waitFor();
      }finally{adminAuth.role="owner";await browser.close();await new Promise<void>(ok=>server.close(()=>ok()));}
      const [adminClosed] = await sql`select s.state,a.state as authorization,r.mode from demo_session s
        join demo_authorization a on a.id=s.authorization_id join demo_identity_route r on r.organization_id=s.organization_id
        where s.id=${linked!.id}`;
      expect(adminClosed).toMatchObject({state:"revoked",authorization:"revoked",mode:"blocked"});
      const [audits] = await sql`select count(*)::int as n from demo_admin_audit where organization_id=${org}
        and action='whatsapp_revoked' and target_id=${linked!.id}`;
      expect(audits!.n).toBe(1);
      // El modo comercial crea otra autorización temporal sin registro de piloto.
      await sql`update zernio_whatsapp_outbox set status='completado' where id=${end!.id}`;
      const [adminRoute]=await sql`select generation from demo_identity_route where organization_id=${org}`;
      await restituirWhatsApp(actor,"pizza",linked!.web_session_id,adminRoute!.generation);
      await new Promise(resolve => setTimeout(resolve, 1100));
      await sql`update demo_space set visual_identity=jsonb_set(visual_identity,'{demoPolicy}','"automatic_commercial"'::jsonb) where id='pizza'`;
      vi.stubEnv("DEMO_CONVERSATIONAL_SINGLE_PARTICIPANT","false");
      const again=evento("Quiero otra demostración");
      await enviar(again);
      await sql`update webhook_event set status='procesado' where payload->>'id'=${again.id}`;
      const againDispatch=randomUUID();
      const [againMsgRow]=await sql`insert into message(id,organization_id,conversation_id,wa_message_id,direction,type,text,status,wa_timestamp)
        values(${randomUUID()},${org},${conv!.id},${again.message.platformMessageId},'in','text','Quiero otra demostración','delivered',clock_timestamp())
        on conflict(wa_message_id) do update set status=message.status returning id`;
      const againMsg=String(againMsgRow!.id);
      await sql`insert into dispatch(id,organization_id,conversation_id,status,message_ids,not_before,first_message_at,last_message_at)
        values(${againDispatch},${org},${conv!.id},'entregado',${JSON.stringify([againMsg])}::jsonb,clock_timestamp(),clock_timestamp(),clock_timestamp())`;
      const againCommercial=await encolarEnvioWhatsAppZernio({organizationId:org,conversationId:conv!.id,accountRef:cuenta,
        threadRef:hilo,text:"Oferta trazada",requestKey:"nea:second-trace",aiGenerated:true,sourceDispatchId:againDispatch});
      await sql`update zernio_whatsapp_outbox set status='cancelado' where message_id=${againCommercial}`;
      const againResponse=await OFRECER(new Request("http://127.0.0.1:55535/api/bot/demo/offer",{method:"POST",
        headers:{"content-type":"application/json","x-api-key":process.env.BOT_API_KEY!},
        body:JSON.stringify({contractVersion:1,conversationId:conv!.id,dispatchId:againDispatch,sector:"pizza"})}));
      if (againResponse.status !== 200) throw Error(JSON.stringify(await againResponse.json()));
      const againOffer=await againResponse.json();
      const againOut=randomUUID();
      await sql`insert into message(id,organization_id,conversation_id,direction,type,text,status)
        values(${againOut},${org},${conv!.id},'out','text',${againOffer.message},'delivered')`;
      await sql`insert into zernio_whatsapp_outbox(id,organization_id,conversation_id,message_id,account_ref,thread_ref,request_key,status,updated_at)
        values(${randomUUID()},${org},${conv!.id},${againOut},${cuenta},${hilo},'fixture-second-offer','completado',clock_timestamp()-interval '2 seconds')`;
      const againConsent=evento("ACEPTO DEMO");
      await enviar(againConsent);
      const [againResult]=await sql`select payload->>'result' as result from webhook_event where payload->>'id'=${againConsent.id}`;
      expect(againResult?.result).toBe("linked");
      const [againSession]=await sql`select id,profile_version_id from demo_session where organization_id=${org}
        and conversation_id=${conv!.id} and state='active' and kind='external'`;
      expect(againSession?.id).not.toBe(linked!.id);
      expect(againSession?.profile_version_id).toBe(linked!.profile_version_id);
      expect(await construirDespachoWhatsAppDemo(demoJob!)).toBeNull();
      const [historical]=await sql`select state from demo_authorization where id=${authorized!.id}`;
      expect(historical?.state).toBe("revoked");
      await new Promise(resolve => setTimeout(resolve, 1100));
      const againQuestion=evento("¿Qué pizza tienen?");
      await enviar(againQuestion);
      const [againQuestionResult]=await sql`select payload->>'result' as result from webhook_event where payload->>'id'=${againQuestion.id}`;
      expect(againQuestionResult?.result).toBe("demo");
      const [againJob]=await tomarPendientes(1);
      expect(againJob?.demoSessionId).toBe(againSession!.id);
      const againPayload=await construirDespachoWhatsAppDemo(againJob!);
      await consumirEnNea(againPayload!);
      const [againPaid]=await sql`select status from demo_usage_operation where operation_key=${againJob!.id} and session_id=${againSession!.id}`;
      expect(againPaid?.status).toBe("settled");
      await marcarEntregado(againJob!);
      const [againStart]=await sql`select id from zernio_whatsapp_outbox where request_key=${"demo-notice:"+againSession!.id+":started"}`;
      await liberarSalidaZernio(againStart!.id);
      const finished=evento("TERMINAR DEMO");
      await enviar(finished);
      const [againEnd]=await sql`select id from zernio_whatsapp_outbox where request_key=${"demo-notice:"+againSession!.id+":ended"}`;
      expect(againEnd).toBeTruthy();
      await liberarSalidaZernio(againEnd!.id);
      await sql`update message set status='delivered' where organization_id=${org} and demo_session_id=${againSession!.id}
        and direction='out' and scope_kind='demo' and status='sent'`;
      await caducarDemosConversacionales();
      const [automaticReturn]=await sql`select mode from demo_identity_route where organization_id=${org}`;
      expect(automaticReturn?.mode).toBe("commercial");
      await new Promise(resolve => setTimeout(resolve, 1100));
      const third=evento("Quiero probar otra vez");
      await enviar(third);
      await sql`update webhook_event set status='procesado' where payload->>'id'=${third.id}`;
      const thirdDispatch=randomUUID();
      const [thirdMsgRow]=await sql`insert into message(id,organization_id,conversation_id,wa_message_id,direction,type,text,status,wa_timestamp)
        values(${randomUUID()},${org},${conv!.id},${third.message.platformMessageId},'in','text','Quiero probar otra vez','delivered',clock_timestamp())
        on conflict(wa_message_id) do update set status=message.status returning id`;
      const thirdMsg=String(thirdMsgRow!.id);
      await sql`insert into dispatch(id,organization_id,conversation_id,status,message_ids,not_before,first_message_at,last_message_at)
        values(${thirdDispatch},${org},${conv!.id},'entregado',${JSON.stringify([thirdMsg])}::jsonb,clock_timestamp(),clock_timestamp(),clock_timestamp())`;
      const thirdResponse=await OFRECER(new Request("http://127.0.0.1:55535/api/bot/demo/offer",{method:"POST",
        headers:{"content-type":"application/json","x-api-key":process.env.BOT_API_KEY!},
        body:JSON.stringify({contractVersion:1,conversationId:conv!.id,dispatchId:thirdDispatch,sector:"NOVA"})}));
      expect(thirdResponse.status).toBe(200);
      const thirdOffer=await thirdResponse.json(), thirdOut=randomUUID();
      await sql`insert into message(id,organization_id,conversation_id,direction,type,text,status)
        values(${thirdOut},${org},${conv!.id},'out','text',${thirdOffer.message},'delivered')`;
      await sql`insert into zernio_whatsapp_outbox(id,organization_id,conversation_id,message_id,account_ref,thread_ref,request_key,status,updated_at)
        values(${randomUUID()},${org},${conv!.id},${thirdOut},${cuenta},${hilo},'fixture-third-offer','completado',clock_timestamp()-interval '2 seconds')`;
      const thirdConsent=evento("ACEPTO DEMO");
      await enviar(thirdConsent);
      const [thirdResult]=await sql`select payload->>'result' as result from webhook_event where payload->>'id'=${thirdConsent.id}`;
      expect(thirdResult?.result).toBe("linked");
      const [thirdSession]=await sql`select id,profile_version_id from demo_session where organization_id=${org}
        and conversation_id=${conv!.id} and state='active' and kind='external'`;
      expect(thirdSession?.id).not.toBe(againSession!.id);
      expect(thirdSession?.profile_version_id).toBe(againSession!.profile_version_id);
    } finally { vi.unstubAllEnvs(); }
  }, 60000);

  it("autoriza automáticamente a dos prospectos aislados y respeta revocación", async () => {
    vi.stubEnv("DEMO_CONVERSATIONAL_ENABLED", "true");
    vi.stubEnv("DEMO_CONVERSATIONAL_SINGLE_PARTICIPANT", "false");
    try {
      const admin = (body:object) => ADMIN_SPACE(new Request("http://127.0.0.1/api/demo-center", {
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}));
      const created=await admin({action:"create",space:{name:"Ejemplo universal",commercialName:"Ejemplo universal",sector:"otro giro",
        description:"Ficticio",visualIdentity:{color:"#112233",demoPolicy:"automatic"}}});
      expect(created.status).toBe(201);
      const createdData=await created.json();const spaceId=String(createdData.id);
      const published=await admin({action:"publishProfile",id:spaceId,expectedGeneration:1,
        profile:{name:"Asistente ejemplo",tone:"Amable",instructions:"Información propia",escalationRules:"",greeting:"",role:"Información",tools:[]}});
      expect(published.status).toBe(200);
      expect((await admin({action:"status",id:spaceId,expectedGeneration:2,status:"active"})).status).toBe(200);
      const limits=await admin({action:"limits",id:spaceId,expectedGeneration:3,limits:{
        maxDurationSeconds:900,maxIdleSeconds:300,maxConcurrentSessions:10,maxSessionsStarted:20,
        maxInboundMessages:10,maxAssistantResponses:10,maxProviderCalls:10,budgetMicroUsd:"1000",sessionBudgetMicroUsd:"100",
        windowStart:new Date(Date.now()-86400000).toISOString(),windowEnd:new Date(Date.now()+86400000).toISOString(),enabled:true}});
      expect(limits.status).toBe(200);
      const [createdProfile]=await sql`select current_profile_version_id from demo_space where id=${spaceId}`;
      const profileId=String(createdProfile!.current_profile_version_id);
      await sql`update demo_limits set max_concurrent_sessions=10,max_sessions_started=20,max_inbound_messages=10 where id='global'`;
      const sessions: string[]=[];
      let generation=4;
      for (const suffix of ["71","72"]) {
        const number="5255112233"+suffix, thread="auto-thread-"+suffix, conv="auto-conv-"+suffix, contact="auto-contact-"+suffix;
        expect((await admin({action:"pilotAllow",id:spaceId,expectedGeneration:generation++,phone:"+"+number})).status).toBe(200);
        const incoming=evento("Quiero una demo",{phone:number,bsuid:null});
        incoming.conversation.id=thread; incoming.message.conversationId=thread;
        await enviar(incoming);
        await sql`update webhook_event set status='procesado' where payload->>'id'=${incoming.id}`;
        await sql`insert into contact(id,organization_id,wa_identity,phone,name) values(${contact},${org},${number},${number},'Ficticio')`;
        await sql`insert into conversation(id,organization_id,contact_id,channel_thread_ref,ai_enabled) values(${conv},${org},${contact},${thread},true)`;
        const msg=randomUUID(), dispatch=randomUUID();
        await sql`insert into message(id,organization_id,conversation_id,wa_message_id,direction,type,text,status,wa_timestamp)
          values(${msg},${org},${conv},${incoming.message.platformMessageId},'in','text','Quiero una demo','delivered',clock_timestamp())`;
        await sql`insert into dispatch(id,organization_id,conversation_id,status,message_ids,not_before,first_message_at,last_message_at)
          values(${dispatch},${org},${conv},'entregado',${JSON.stringify([msg])}::jsonb,clock_timestamp(),clock_timestamp(),clock_timestamp())`;
        if (suffix === "72") {
          vi.stubEnv("DEMO_CONVERSATIONAL_SINGLE_PARTICIPANT", "true");
          const denied=await OFRECER(new Request("http://127.0.0.1:55535/api/bot/demo/offer",{method:"POST",
            headers:{"content-type":"application/json","x-api-key":process.env.BOT_API_KEY!},
            body:JSON.stringify({contractVersion:1,conversationId:conv,dispatchId:dispatch,sector:"otro giro"})}));
          expect(denied.status).toBe(403);
          vi.stubEnv("DEMO_CONVERSATIONAL_SINGLE_PARTICIPANT", "false");
        }
        const resp=await OFRECER(new Request("http://127.0.0.1:55535/api/bot/demo/offer",{method:"POST",
          headers:{"content-type":"application/json","x-api-key":process.env.BOT_API_KEY!},
          body:JSON.stringify({contractVersion:1,conversationId:conv,dispatchId:dispatch,sector:"otro giro"})}));
        expect(resp.status).toBe(200);
        const offer=await resp.json(); expect(offer.status).toBe("offered");
        const [before]=await sql`select count(*)::int as n from demo_session where organization_id=${org} and conversation_id=${conv}`;
        expect(before!.n).toBe(0);
        const out=randomUUID();
        await sql`insert into message(id,organization_id,conversation_id,direction,type,text,status) values(${out},${org},${conv},'out','text',${offer.message},'delivered')`;
        await sql`insert into zernio_whatsapp_outbox(id,organization_id,conversation_id,message_id,account_ref,thread_ref,request_key,status,updated_at)
          values(${randomUUID()},${org},${conv},${out},${cuenta},${thread},${'offer-'+suffix},'completado',clock_timestamp()-interval '2 seconds')`;
        if (suffix === "71") {
          await sql`update demo_space set visual_identity=jsonb_set(visual_identity,'{demoPolicy}','"disabled"'::jsonb) where id=${spaceId}`;
          const denied=evento("ACEPTO DEMO",{phone:number,bsuid:null});denied.conversation.id=thread;denied.message.conversationId=thread;
          await enviar(denied);
          const [result]=await sql`select payload->>'result' as result from webhook_event where payload->>'id'=${denied.id}`;
          expect(result!.result).toBe("consent_unverified");
          await sql`update demo_space set visual_identity=jsonb_set(visual_identity,'{demoPolicy}','"automatic"'::jsonb) where id=${spaceId}`;
          const hash=createHmac("sha256",Buffer.alloc(32)).update(JSON.stringify(["demo-phone:v1",org,number])).digest("hex");
          await sql`insert into demo_authorization(id,organization_id,space_id,channel,canonical_phone,phone_lookup,phone_suffix,state,created_by)
            values('auto-revoked',${org},${spaceId},'whatsapp','{}'::jsonb,${hash},'0071','revoked',${owner})`;
          const [pilot]=await sql`select id from demo_pilot_participant where organization_id=${org} and space_id=${spaceId} and phone_lookup=${hash}`;
          expect((await admin({action:"pilotBlock",id:spaceId,expectedGeneration:generation++,participantId:pilot!.id})).status).toBe(200);
          const revoked=evento("ACEPTO DEMO",{phone:number,bsuid:null});revoked.conversation.id=thread;revoked.message.conversationId=thread;
          await enviar(revoked);
          const [revokedResult]=await sql`select payload->>'result' as result from webhook_event where payload->>'id'=${revoked.id}`;
          expect(revokedResult!.result).toBe("consent_unverified");
          expect((await admin({action:"pilotUnblock",id:spaceId,expectedGeneration:generation++,participantId:pilot!.id})).status).toBe(200);
        }
        const accept=evento("ACEPTO DEMO",{phone:number,bsuid:null});accept.conversation.id=thread;accept.message.conversationId=thread;
        await enviar(accept);await enviar({...accept,id:randomUUID()});
        const [acceptResult]=await sql`select payload->>'result' as result from webhook_event where payload->>'id'=${accept.id}`;
        expect(acceptResult?.result).toBe("linked");
        const [session]=await sql`select id,profile_version_id from demo_session where organization_id=${org} and conversation_id=${conv} and state='active'`;
        expect(session?.profile_version_id).toBe(profileId);sessions.push(session!.id);
        const [participant]=await sql`select id from demo_pilot_participant where organization_id=${org} and space_id=${spaceId} and phone_suffix=${number.slice(-4)}`;
        const activeBlock=await admin({action:"pilotBlock",id:spaceId,expectedGeneration:generation,participantId:participant!.id});
        expect(activeBlock.status).toBe(409);
        expect((await activeBlock.json()).error.code).toBe("session_active");
        vi.stubEnv("DEMO_CONVERSATIONAL_SINGLE_PARTICIPANT", "false");
      }
      expect(new Set(sessions).size).toBe(2);
      const [audits]=await sql`select count(*)::int as n from demo_admin_audit
        where organization_id=${org} and space_id=${spaceId} and action='automatic_authorization_granted'`;
      expect(audits!.n).toBe(2);
    } finally { vi.unstubAllEnvs(); }
  }, 30000);
});
