import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getSql } from "@/lib/db";
import { guardarEvento, tomarEvento } from "@/server/webhooks/eventos";
import { barrido, detenerBarrido, procesarEvento } from "@/server/webhooks/worker";
import { programarFallosDePrueba } from "@/server/dev/webhook-fallo";
import { guardarZernioWhatsApp } from "@/server/zernio/whatsapp-credenciales";
import { barrerEnviosWhatsAppZernio, encolarEnvioWhatsAppZernio } from "@/server/zernio/whatsapp-outbox";
import { listMessages, updateConversation } from "@/server/inbox/queries";
import { procesarEntranteWhatsAppZernio } from "@/server/zernio/whatsapp-ingesta";
import { POST } from "@/app/api/webhooks/zernio-whatsapp/route";
import { createHmac } from "node:crypto";
import postgres from "postgres";
vi.mock("next/server", () => ({ after: vi.fn() }));

// Nunca ejecutar contra una URL arbitraria: además se verifica data_directory.
const url = process.env.DATABASE_URL;
const habilitado = process.env.VOCERO_TEST_POSTGRES === "1";
if (habilitado) {
  const parsed = new URL(url ?? "");
  if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/vocero_zernio_test" || !process.env.VOCERO_TEST_PGDATA) {
    throw new Error("La base no es la instancia local efímera autorizada");
  }
}

describe.skipIf(!habilitado)("PostgreSQL real aislado — WhatsApp Zernio", () => {
  const org = "org_zernio_prueba";
  const cuenta = "cuenta_ficticia";
  let sql: ReturnType<typeof getSql>;
  const normalize = (s: string) => s.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
  const evento = (id: string, wamid: string) => ({ id, event: "message.received", account: { accountId: cuenta, platform: "whatsapp" },
    conversation: { id: "hilo_ficticio" }, message: { id: `interno_${id}`, platformMessageId: wamid, conversationId: "hilo_ficticio",
      platform: "whatsapp", direction: "incoming", text: "mensaje ficticio", sentAt: new Date().toISOString(), sender: { phoneNumber: "+525512340001" } } });
  const crearEvento = (id: string, wamid: string) => guardarEvento({ organizationId: org, fuente: "zernio_whatsapp", payload: evento(id, wamid), rawBody: `zernio-whatsapp:${cuenta}:${id}` });

  beforeAll(async () => {
    sql = getSql();
    const [identity] = await sql`select current_database() as db, current_setting('data_directory') as dir, host(inet_server_addr()) as host`;
    if (!identity || identity.db !== "vocero_zernio_test" || identity.host !== "127.0.0.1" ||
        normalize(String(identity.dir)) !== normalize(process.env.VOCERO_TEST_PGDATA!)) {
      throw new Error("No coincide el directorio o la identidad de PostgreSQL de prueba");
    }
    // Solo esta organización sintética dentro de la instancia efímera validada.
    await sql`delete from organization where id=${org}`;
    await sql`insert into organization (id, name) values (${org}, 'Prueba aislada')`;
    await sql`insert into pipeline_stage (id, organization_id, name, position) values ('stage_zernio_prueba', ${org}, 'Nuevo', 0)`;
    await guardarZernioWhatsApp({ organizationId: org, accountRef: cuenta, token: "token-ficticio", secreto: "secreto-ficticio" });
    process.env.WA_MOCK_ENABLED = "true";
  });
  afterAll(async () => { detenerBarrido(); vi.unstubAllGlobals(); if (sql) await sql.end(); });

  it("procesa la ingesta de texto con la base aislada", async () => {
    await expect(procesarEntranteWhatsAppZernio(evento("ev_debug", "wamid_debug"))).resolves.toBeUndefined();
  });

  it("la ruta autenticada guarda en PostgreSQL y rechaza otra cuenta", async () => {
    process.env.ZERNIO_WHATSAPP_ENABLED = "true";
    const req = (payload: unknown) => {
      const body = JSON.stringify(payload);
      return new Request("http://localhost/webhook", { method: "POST", body,
        headers: { "x-zernio-signature": createHmac("sha256", "secreto-ficticio").update(body).digest("hex") } });
    };
    const original = evento("ev_ruta", "wamid_ruta");
    expect((await POST(req({ ...original, account: { accountId: "cuenta_ajena", platform: "whatsapp" } }))).status).toBe(401);
    expect((await POST(req(original))).status).toBe(200);
    const rows = await sql`select id from webhook_event where organization_id=${org} and payload->>'id'='ev_ruta'`;
    expect(rows).toHaveLength(1);
    await sql`update webhook_event set not_before=now()-interval '1 second' where id=${String(rows[0]!.id)}`;
    await procesarEvento(String(rows[0]!.id));
  });

  it("persiste un evento antes de procesarlo y evita duplicados", async () => {
    const a = await crearEvento("ev_1", "wamid_prueba_1");
    const b = await crearEvento("ev_1", "wamid_prueba_1");
    expect(b).toMatchObject({ id: a.id, nuevo: false });
    expect((await sql`select status from webhook_event where id=${a.id}`)[0]?.status).toBe("pendiente");
    await procesarEvento(a.id);
    const messages = await sql`select id, conversation_id from message where wa_message_id='wamid_prueba_1' and organization_id=${org}`;
    expect(messages).toHaveLength(1);
    expect((await listMessages(org, String(messages[0]!.conversation_id))).map((row) => row.message.id)).toContain(messages[0]!.id);
    expect((await sql`select status from webhook_event where id=${a.id}`)[0]?.status).toBe("procesado");
  });

  it("recupera un fallo de procesamiento y una reserva vencida", async () => {
    const a = await crearEvento("ev_2", "wamid_prueba_2");
    programarFallosDePrueba(1);
    await sql`update webhook_event set not_before=now()-interval '1 second' where id=${a.id}`;
    await procesarEvento(a.id);
    expect((await sql`select status, attempts from webhook_event where id=${a.id}`)[0]).toMatchObject({ status: "pendiente", attempts: 1 });
    await sql`update webhook_event set not_before=now()-interval '1 second' where id=${a.id}`;
    expect((await sql`select not_before <= now()::timestamp as elegible from webhook_event where id=${a.id}`)[0]?.elegible).toBe(true);
    await procesarEvento(a.id);
    expect((await sql`select status, attempts from webhook_event where id=${a.id}`)[0]).toMatchObject({ status: "procesado", attempts: 2 });
    const recuperados = await sql`select id, conversation_id from message where wa_message_id='wamid_prueba_2' and organization_id=${org}`;
    expect(recuperados).toHaveLength(1);
    expect((await listMessages(org, String(recuperados[0]!.conversation_id))).map((row) => row.message.id)).toContain(recuperados[0]!.id);
    const b = await crearEvento("ev_3", "wamid_prueba_3");
    await sql`update webhook_event set not_before=now()-interval '1 second' where id=${b.id}`;
    expect(await tomarEvento(b.id)).not.toBeNull();
    await sql`update webhook_event set leased_until=now()-interval '1 second' where id=${b.id}`;
    await barrido();
    expect((await sql`select status, attempts from webhook_event where id=${b.id}`)[0]).toMatchObject({ status: "procesado", attempts: 2 });
    expect(await sql`select id from message where wa_message_id='wamid_prueba_3'`).toHaveLength(1);
  });

  it("dos workers no reclaman dos veces el mismo evento", async () => {
    const a = await crearEvento("ev_4", "wamid_prueba_4");
    await sql`update webhook_event set not_before=now()-interval '1 second' where id=${a.id}`;
    const claims = await Promise.all([tomarEvento(a.id), tomarEvento(a.id)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("reintenta un timeout de envío con la misma clave y confirma una sola salida", async () => {
    const [conv] = await sql`select id from conversation where organization_id=${org} limit 1`;
    expect(conv).toBeDefined();
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).startsWith("http://127.0.0.1:9/")) throw new Error("Red externa prohibida en pruebas");
      calls.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
      if (calls.length === 1) throw new Error("timeout simulado");
      return Response.json({ success: true, data: { messageId: "wamid_salida_prueba" } });
    }));
    process.env.ZERNIO_WHATSAPP_ENABLED = "false";
    const input = { organizationId: org, conversationId: String(conv!.id), accountRef: cuenta, threadRef: "hilo_ficticio", text: "respuesta ficticia", requestKey: "clave_prueba_1" };
    const messageId = await encolarEnvioWhatsAppZernio(input);
    expect(await encolarEnvioWhatsAppZernio(input)).toBe(messageId);
    process.env.ZERNIO_WHATSAPP_ENABLED = "true";
    await barrerEnviosWhatsAppZernio();
    expect((await sql`select status from zernio_whatsapp_outbox where message_id=${messageId}`)[0]?.status).toBe("pendiente");
    await sql`update zernio_whatsapp_outbox set not_before=now()-interval '1 second' where message_id=${messageId}`;
    await Promise.all([barrerEnviosWhatsAppZernio(), barrerEnviosWhatsAppZernio()]);
    expect(calls).toEqual(["clave_prueba_1", "clave_prueba_1"]);
    expect((await sql`select status, wa_message_id from message where id=${messageId}`)[0]).toMatchObject({ status: "sent", wa_message_id: "wamid_salida_prueba" });
    expect(await sql`select id from zernio_whatsapp_outbox where request_key='clave_prueba_1'`).toHaveLength(1);
  });

  it("revierte el mensaje si la transacción de envío viola una clave foránea", async () => {
    process.env.ZERNIO_WHATSAPP_ENABLED = "false";
    await expect(encolarEnvioWhatsAppZernio({ organizationId: org, conversationId: "conversacion_inexistente", accountRef: cuenta,
      threadRef: "hilo", text: "no debe guardarse", requestKey: "clave_rollback" })).rejects.toThrow();
    expect(await sql`select id from message where text='no debe guardarse' and organization_id=${org}`).toHaveLength(0);
    expect(await sql`select id from zernio_whatsapp_outbox where request_key='clave_rollback'`).toHaveLength(0);
  });

  it("sincroniza el teléfono una sola vez sin tomar el control humano ni despachar", async () => {
    const [conv] = await sql`select id, ai_enabled, last_message_at from conversation where organization_id=${org} limit 1`;
    const base = evento("ev_telefono", "wamid_telefono");
    const salida = { ...base, event: "message.sent", conversation: { id: "hilo_ficticio", participantId: "525512340001" },
      message: { ...base.message, direction: "outgoing", source: "whatsapp_business_app", sentAt: "2020-01-01T12:00:00Z" } };
    const antes = await sql`select count(*)::int as n from dispatch where organization_id=${org}`;
    await procesarEntranteWhatsAppZernio(salida);
    await procesarEntranteWhatsAppZernio(salida);
    const mensajes = await sql`select id, direction, origin, conversation_id from message where wa_message_id='wamid_telefono'`;
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]).toMatchObject({ direction: "out", origin: "manual", conversation_id: conv!.id });
    const [despues] = await sql`select ai_enabled, last_message_at from conversation where id=${String(conv!.id)}`;
    expect(despues?.ai_enabled).toBe(conv!.ai_enabled);
    expect(String(despues?.last_message_at)).toBe(String(conv!.last_message_at));
    expect(await sql`select count(*)::int as n from dispatch where organization_id=${org}`).toEqual(antes);
    await updateConversation(org, String(conv!.id), { aiEnabled: false });
    await procesarEntranteWhatsAppZernio({ ...salida, id: "ev_telefono2", message: { ...salida.message, platformMessageId: "wamid_telefono2" } });
    const conexionNueva = postgres(process.env.DATABASE_URL!, { max: 1 });
    try { expect((await conexionNueva`select ai_enabled from conversation where id=${String(conv!.id)}`)[0]?.ai_enabled).toBe(false); }
    finally { await conexionNueva.end(); }
    await updateConversation(org, String(conv!.id), { reactivate: true });
    expect((await sql`select ai_enabled from conversation where id=${String(conv!.id)}`)[0]?.ai_enabled).toBe(true);
  });

  it("concilia ecos de API con mensajes existentes y reintenta los aún desconocidos", async () => {
    const base = evento("ev_api", "wamid_salida_prueba");
    const salida = { ...base, event: "message.sent", message: { ...base.message, direction: "outgoing", source: "cloud_api" } };
    await procesarEntranteWhatsAppZernio(salida);
    expect(await sql`select id from message where wa_message_id='wamid_salida_prueba'`).toHaveLength(1);
    await expect(procesarEntranteWhatsAppZernio({ ...salida, message: { ...salida.message, platformMessageId: "wamid_aun_no_confirmado" } })).rejects.toThrow("conciliado");
    expect(await sql`select id from message where wa_message_id='wamid_aun_no_confirmado'`).toHaveLength(0);
  });

  it("agota de forma visible los ecos API desconocidos sin crear mensajes", async () => {
    const base = evento("ev_api_desconocido", "wamid_api_desconocido");
    const payload = { ...base, event: "message.sent", message: { ...base.message, direction: "outgoing", source: "cloud_api" } };
    const guardado = await guardarEvento({ organizationId: org, fuente: "zernio_whatsapp", payload,
      rawBody: `zernio-whatsapp:${cuenta}:ev_api_desconocido` });
    for (let intento = 1; intento <= 6; intento++) {
      await sql`update webhook_event set not_before=now()-interval '1 second' where id=${guardado.id}`;
      await procesarEvento(guardado.id);
      const [fila] = await sql`select status, attempts, last_error from webhook_event where id=${guardado.id}`;
      expect(fila).toMatchObject({ status: intento === 6 ? "agotado" : "pendiente", attempts: intento,
        last_error: "No se pudo procesar el evento de Zernio" });
    }
    expect(await sql`select id from message where wa_message_id='wamid_api_desconocido'`).toHaveLength(0);
  });

  it("revierte toda la ingesta si falla la actualización de la conversación", async () => {
    await sql`create or replace function prueba_interrupcion_conversacion() returns trigger language plpgsql as $$ begin if new.organization_id = 'org_zernio_prueba' then raise exception 'fallo simulado'; end if; return new; end $$`;
    await sql`create trigger prueba_interrupcion before update on conversation for each row execute function prueba_interrupcion_conversacion()`;
    try {
      await expect(procesarEntranteWhatsAppZernio(evento("ev_rollback", "wamid_rollback"))).rejects.toThrow();
      expect(await sql`select id from message where wa_message_id='wamid_rollback'`).toHaveLength(0);
    } finally {
      await sql`drop trigger prueba_interrupcion on conversation`;
      await sql`drop function prueba_interrupcion_conversacion()`;
    }
  });

  it("DDL de las migraciones nuevas se puede revertir dentro de una transacción", async () => {
    await expect(sql.begin(async (tx) => {
      await tx`drop table zernio_whatsapp_outbox`;
      await tx`drop table zernio_whatsapp_credentials`;
      throw new Error("rollback intencional");
    })).rejects.toThrow("rollback intencional");
    const [row] = await sql`select to_regclass('zernio_whatsapp_outbox') as outbox, to_regclass('zernio_whatsapp_credentials') as credenciales`;
    expect(row?.outbox).toBe("zernio_whatsapp_outbox");
    expect(row?.credenciales).toBe("zernio_whatsapp_credentials");
  });
});
