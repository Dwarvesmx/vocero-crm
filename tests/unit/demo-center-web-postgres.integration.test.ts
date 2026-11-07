import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getSql } from "@/lib/db";
import { GET, POST } from "@/app/api/demo/web/route";
import { GET as ADMIN_READ, POST as ADMIN } from "@/app/api/demo-center/web/route";
import { simulatorRead, SimulatorError } from "@/server/demo-center/infra/simulator";

const auth = vi.hoisted(() => ({ actor: null as { organizationId: string; userId: string; role: string } | null }));
vi.mock("@/lib/auth/session", () => {
  class UnauthorizedError extends Error {}
  return { UnauthorizedError, requireSession: async () => {
    if (!auth.actor) throw new UnauthorizedError();
    return auth.actor;
  } };
});
vi.mock("@/lib/ai/provider", () => ({
  resolveAiProvider: async () => ({ ok: true, provider: {
    baseUrl: "https://openrouter.ai/api/v1", token: "solo-pruebas", model: "fixture/model",
  } }),
}));

const origin = "http://127.0.0.1:55530";
const sessionURL = origin + "/api/demo/web";
const adminURL = origin + "/api/demo-center/web";
const owner = { organizationId: "web-org", userId: "web-owner", role: "owner" };
const providerModel = {
  id: "fixture/model", context_length: 10000, architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["max_tokens"], pricing: { prompt: "0.000000001", completion: "0.000000001" },
};

function req(url: string, body?: object, token?: string) {
  return new Request(url, { method: body ? "POST" : "GET", headers: {
    ...(body && { "content-type": "application/json" }),
    ...(token && { authorization: `Bearer ${token}` }),
  }, body: body ? JSON.stringify(body) : undefined });
}

describe.skipIf(process.env.DEMO_WEB_TEST !== "1")("Portal comercial con PostgreSQL y OpenRouter controlado", () => {
  let sql: ReturnType<typeof getSql>;
  let llamadas = 0;
  let pizza: { id: string; token: string }, casa: { id: string; token: string };

  async function invitar(spaceId: string) {
    const respuesta = await ADMIN(req(adminURL, { action: "invite", spaceId }));
    expect(respuesta.status).toBe(200);
    return respuesta.json();
  }
  async function turno(token: string, text: string, requestKey = randomUUID()) {
    return POST(req(sessionURL, { action: "send", text, requestKey }, token));
  }

  beforeAll(async () => {
    if (process.env.DATABASE_URL !== "postgres://demo@127.0.0.1:55529/demo_f2a" ||
        process.env.APP_BASE_URL !== origin) throw Error("Usar el entorno aislado documentado");
    sql = getSql();
    const [dir] = await sql`select current_setting('data_directory') as path`;
    if (!String(dir!.path).replaceAll("\\", "/").endsWith("/tmp/demo-f2a02-pg")) throw Error("Clúster incorrecto");
    await sql`truncate organization,"user" cascade`;
    await sql`insert into organization(id,name) values('web-org','Ficticia'),('web-foreign','Otra')`;
    await sql`insert into "user"(id,name,email) values('web-owner','Pruebas','web@example.invalid')`;
    await sql`insert into kb_entry(id,organization_id,kind,content) values('lukas','web-org','block','Oferta Lukas privada')`;
    for (const [id, name, assistant, knowledge] of [
      ["pizza", "Pizza Nova", "NOVA", "Oferta pizza ficticia de Pepperoni"],
      ["casa", "Casa Horizonte", "Horizonte", "Oferta casa ficticia de 2 habitaciones"],
    ] as const) {
      await sql`insert into demo_space(id,organization_id,name,commercial_name,sector,status) values(${id},'web-org',${name},${name},'Ejemplo','active')`;
      await sql`insert into demo_profile_version(id,organization_id,space_id,version,name,tone,instructions,escalation_rules,greeting,role,created_by)
        values(${id+"-profile"},'web-org',${id},1,${assistant},'Amable','Solo datos ficticios','','Bienvenido','Asistente','web-owner')`;
      await sql`update demo_space set current_profile_version_id=${id+"-profile"} where id=${id}`;
      await sql`insert into kb_entry(id,organization_id,demo_space_id,kind,content) values(${id},'web-org',${id},'block',${knowledge})`;
    }
    for (const space of [null, "pizza", "casa"]) {
      await sql`insert into demo_limits(id,organization_id,space_id,max_duration_seconds,max_idle_seconds,max_concurrent_sessions,
        max_sessions_started,max_inbound_messages,max_assistant_responses,max_provider_calls,budget_micro_usd,session_budget_micro_usd,window_start,window_end)
        values(${space ?? "global"},'web-org',${space},900,300,4,10,6,6,6,1000,100,
        clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day')`;
    }
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      if (input === "https://openrouter.ai/api/v1/models") return Response.json({ data: [providerModel] });
      if (input !== "https://openrouter.ai/api/v1/chat/completions") throw Error("Acceso externo prohibido");
      llamadas++;
      const payload = JSON.parse(String(init?.body));
      const context = JSON.stringify(payload.messages);
      const esPizza = context.includes("NOVA");
      const [op] = await sql`select status,reserved_amount from demo_usage_operation order by created_at desc limit 1`;
      expect(op!.status).toBe("uncertain");
      expect(Number(op!.reserved_amount)).toBeGreaterThan(0);
      expect(context).not.toContain("Lukas privada");
      expect(context).toContain(esPizza ? "Pepperoni" : "2 habitaciones");
      expect(context).not.toContain(esPizza ? "2 habitaciones" : "Pepperoni");
      if (context.includes("¿y la oferta anterior?")) expect(context).toContain("NOVA controlada");
      return Response.json({ id: "synthetic-"+llamadas, model: providerModel.id, usage: { cost: "0.000005" },
        choices: [{ message: { content: esPizza ? "NOVA controlada" : "Horizonte controlada" } }] });
    });
  });
  afterAll(() => { vi.unstubAllGlobals(); auth.actor = null; });

  it("protege la administración, aísla las invitaciones y conserva cuotas y continuidad", async () => {
    expect((await ADMIN_READ(req(adminURL + "?spaceId=pizza"))).status).toBe(401);
    auth.actor = { ...owner, role: "member" };
    expect((await ADMIN(req(adminURL, { action: "invite", spaceId: "pizza" }))).status).toBe(403);
    auth.actor = owner;
    pizza = await invitar("pizza");
    casa = await invitar("casa");
    expect((await ADMIN(req(adminURL, { action: "invite", spaceId: "foreign" }))).status).toBe(404);
    auth.actor = { ...owner, organizationId: "web-foreign" };
    expect((await ADMIN(req(adminURL, { action: "revoke", spaceId: "pizza", sessionId: pizza.id }))).status).toBe(404);
    auth.actor = null;
    expect((await GET(req(sessionURL))).status).toBe(404);
    expect((await GET(req(sessionURL, undefined, "a".repeat(43)))).status).toBe(404);
    const invalid = await POST(req(sessionURL, { action: "close", spaceId: "casa" }, pizza.token));
    expect(invalid.status).toBe(422);
    await expect(simulatorRead(owner, "pizza", pizza.id)).rejects.toBeInstanceOf(SimulatorError);
    const key = randomUUID();
    const primera = await turno(pizza.token, "¿Qué oferta de pizza tienen?", key);
    expect(primera.headers.get("cache-control")).toContain("no-store");
    const view = await primera.json();
    expect(view.turns[0].answer).toBe("NOVA controlada");
    expect(Object.keys(view).sort()).toEqual(["assistant", "deadline", "greeting", "name", "operation", "state", "turns"]);
    expect((await turno(pizza.token, "¿Qué oferta de pizza tienen?", key)).status).toBe(200);
    expect(llamadas).toBe(1);
    expect((await turno(pizza.token, "Texto diferente", key)).status).toBe(409);
    expect((await (await turno(pizza.token, "¿y la oferta anterior?")).json()).turns).toHaveLength(2);
    const respuestaCasa = await (await turno(casa.token, "¿Qué oferta de casa tienen?")).json();
    expect(respuestaCasa.turns.map((t: { answer: string }) => t.answer)).toEqual(["Horizonte controlada"]);
    await sql`update demo_limits set budget_micro_usd=5 where id='pizza'`;
    expect((await turno(pizza.token, "Otra pregunta")).status).toBe(429);
    expect(llamadas).toBe(3);
    await sql`update demo_limits set budget_micro_usd=1000 where id='pizza'`;
    const [cont] = await sql`select (select count(*) from message)::int as messages,(select count(*) from conversation)::int as conversations,
      (select count(*) from demo_usage_operation where status='settled')::int as settled`;
    expect(cont).toMatchObject({ messages: 0, conversations: 0, settled: 3 });
  });

  it("restringe vigencia, revocación y suspensión en cada solicitud", async () => {
    auth.actor = owner;
    const vence = await invitar("pizza");
    await sql`update demo_session set idle_deadline=clock_timestamp()-interval '1 second' where id=${vence.id}`;
    expect((await (await GET(req(sessionURL, undefined, vence.token))).json()).state).toBe("expired");
    expect((await turno(vence.token, "Hola")).status).toBe(409);
    expect((await ADMIN(req(adminURL, { action: "revoke", spaceId: "casa", sessionId: casa.id }))).status).toBe(200);
    const revocada = await (await GET(req(sessionURL, undefined, casa.token))).json();
    expect(revocada).toMatchObject({ state: "revoked", turns: [] });
    expect((await turno(casa.token, "Hola")).status).toBe(409);
    await sql`update demo_space set status='disabled' where id='pizza'`;
    expect((await turno(pizza.token, "Hola")).status).toBe(409);
    await sql`update demo_space set status='active' where id='pizza'`;
    vi.stubEnv("DEMO_WEB_ENABLED", "false");
    expect((await GET(req(sessionURL, undefined, pizza.token))).status).toBe(404);
    vi.stubEnv("DEMO_WEB_ENABLED", "true");
    expect(llamadas).toBe(3);
  });

  it("permite seleccionar y cerrar sin sesión administrativa en Chromium móvil y escritorio", async () => {
    const bundle = await build({ stdin: { contents: `import React from "react";import {createRoot} from "react-dom/client";
      import {PortalDemo} from "./src/components/demo-center/portal";
      createRoot(document.getElementById("root")).render(<React.StrictMode><PortalDemo contacto="https://example.invalid/contacto" /></React.StrictMode>);`,
      loader: "tsx", resolveDir: process.cwd() }, jsx: "automatic", bundle: true, write: false, define: { "process.env.NODE_ENV": '"development"' } });
    const server = createServer(async (request, response) => {
      try {
        if (request.url === "/demos") {
          response.setHeader("Content-Type", "text/html");
          response.end('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>');
          return;
        }
        if (request.url !== "/api/demo/web") { response.writeHead(404).end(); return; }
        const data = [];
        for await (const part of request) data.push(Buffer.from(part));
        const res = await (request.method === "POST" ? POST : GET)(new Request(sessionURL, {
          method: request.method, headers: request.headers as Record<string, string>,
          body: request.method === "POST" ? Buffer.concat(data) : undefined,
        }));
        response.writeHead(res.status, Object.fromEntries(res.headers)).end(await res.text());
      } catch { response.writeHead(500).end(); }
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(55530, "127.0.0.1", resolve); });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      browser = await chromium.launch({ channel: "chrome", headless: true });
      for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        auth.actor = owner;
        const demo = await invitar("pizza");
        auth.actor = null;
        const page = await browser.newPage({ viewport });
        page.on("dialog", dialog => dialog.accept());
        await page.goto(origin + "/demos#acceso=" + demo.token);
        await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        await page.getByRole("button", { name: /Pizza Nova.*NOVA/ }).click();
        expect(new URL(page.url()).hash).toBe("");
        await page.getByLabel("Tu mensaje").fill("¿Qué oferta de pizza tienen?");
        await page.getByRole("button", { name: "Enviar", exact: true }).click();
        await page.getByText("NOVA controlada").waitFor();
        await page.getByRole("button", { name: "Finalizar demo" }).click();
        const contacto = page.getByRole("link", { name: "Solicitar información" });
        await contacto.waitFor();
        expect(await contacto.getAttribute("href")).toBe("https://example.invalid/contacto");
        expect(await page.getByLabel("Tu mensaje").count()).toBe(0);
        await page.close();
      }
    } finally {
      await browser?.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 30000);
});
