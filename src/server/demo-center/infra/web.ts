import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolveInstanceOrg } from "@/server/bot/auth";
import { telefonoWhatsApp } from "../domain/whatsapp";
import { canalConversacional } from "./whatsapp-offer";
import { getSql } from "@/lib/db";
import type { AdminActor } from "../domain/contracts";
import { configuredDemoProvider, realDemoSend, reconcileDemoOperation } from "./finance";
import { simulatorCommand, SimulatorError } from "./simulator";
import { readDemoDelivery, reconcileDemoNotice } from "./delivery";
import { canalDemoWhatsApp, cerrarVinculoWhatsApp, cerrarVinculoWhatsAppEnTx, estadoVinculoWhatsApp, numeroDemoWhatsApp, prepararVinculoWhatsApp } from "./whatsapp-link";

const huella = (token: string) => createHash("sha256").update(token).digest("hex");
export const webHabilitada = () => process.env.DEMO_WEB_ENABLED === "true";

export function contactoDemoWeb() {
  try {
    const url = new URL(process.env.DEMO_WEB_CONTACT_URL ?? "");
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch { /* Se usa el contacto comercial de ModoNext registrado. */ }
  return "mailto:contacto@modonext.tech?subject=Informaci%C3%B3n%20sobre%20Vocero";
}

export async function catalogoConversacional() {
  const number = canalConversacional() ? numeroDemoWhatsApp() : null;
  if (!number) return null;
  const org = await resolveInstanceOrg();
  if (!org) return null;
  const spaces = await getSql()`select p.name,v.name as assistant from demo_space p
    join demo_profile_version v on (v.organization_id,v.space_id,v.id)=(p.organization_id,p.id,p.current_profile_version_id)
    join member u on u.organization_id=p.organization_id and u.user_id=v.created_by and u.role in ('owner','admin')
    join zernio_whatsapp_credentials z on z.organization_id=p.organization_id and z.enabled
    where p.organization_id=${org} and p.status='active'
    and 2=(select count(*) from demo_limits l where l.organization_id=p.organization_id and (l.space_id is null or l.space_id=p.id)
      and l.enabled and l.window_start<=clock_timestamp() and l.window_end>clock_timestamp() and l.budget_micro_usd>0)
    order by p.name limit 20`;
  return spaces.length ? { number, demos: spaces.map(s => ({ name: String(s.name), assistant: String(s.assistant) })) } : null;
}

export async function invitarDemoWeb(actor: AdminActor, spaceId: string, phone?: string) {
  if (!webHabilitada()) throw new SimulatorError("not_found", 404);
  if (phone && !telefonoWhatsApp(phone)) throw new SimulatorError("invalid_phone", 422);
  // Resolver la credencial localmente, sin cotizar ni llamar al proveedor.
  await configuredDemoProvider(actor.organizationId);
  const token = randomBytes(32).toString("base64url");
  const session = await simulatorCommand(actor, { action: "start", spaceId, requestKey: randomUUID() }, { tokenHash: huella(token) });
  if (phone) {
    try {
      const whatsapp = await prepararVinculoWhatsApp({ id: session.id, organization_id: actor.organizationId }, phone);
      return { id: session.id, token, whatsapp };
    } catch (e) {
      await revocarDemoWeb(actor, spaceId, String(session.id));
      throw e;
    }
  }
  return { id: session.id, token };
}

async function accesoDemoWeb(token: string) {
  if (!webHabilitada() || !/^[\w-]{43}$/.test(token)) throw new SimulatorError("not_found", 404);
  const [sesion] = await getSql()`select s.id, s.organization_id, s.space_id, s.actor_user_id, s.expires_at, s.idle_deadline,
    case when s.state <> 'active' then s.state when p.status <> 'active' then 'suspended'
      when least(s.expires_at, s.idle_deadline) <= clock_timestamp() then 'expired' else 'active' end as state,
    p.name as name, v.name as assistant_name, v.greeting
    from demo_session s join demo_space p on (p.organization_id,p.id)=(s.organization_id,s.space_id)
    join demo_profile_version v on (v.organization_id,v.space_id,v.id)=(s.organization_id,s.space_id,s.profile_version_id)
    where s.kind='web' and s.web_token_hash=${huella(token)}`;
  if (!sesion) throw new SimulatorError("not_found", 404);
  return sesion;
}

export async function consultarDemoWeb(token: string) {
  const s = await accesoDemoWeb(token);
  const sql = getSql();
  const [turnos, operaciones] = s.state === "active" ? await Promise.all([
    sql`select t.id, t.user_text, t.assistant_text from demo_simulation_turn t
      join demo_session s on (s.organization_id,s.space_id,s.id)=(t.organization_id,t.space_id,t.session_id)
      join demo_space p on (p.organization_id,p.id)=(s.organization_id,s.space_id)
      where t.organization_id=${s.organization_id} and t.space_id=${s.space_id} and t.session_id=${s.id}
      and s.state='active' and p.status='active' and least(s.expires_at,s.idle_deadline)>clock_timestamp()
      order by t.created_at,t.id`,
    sql`select status from demo_usage_operation where organization_id=${s.organization_id}
      and space_id=${s.space_id} and session_id=${s.id} order by created_at desc limit 1`,
  ]) : [[], []];
  return {
    name: String(s.name), assistant: String(s.assistant_name), greeting: String(s.greeting ?? ""),
    state: String(s.state), deadline: new Date(Math.min(+new Date(s.expires_at), +new Date(s.idle_deadline))).toISOString(),
    operation: operaciones[0]?.status as string | undefined,
    turns: turnos.map(t => ({ id: String(t.id), question: String(t.user_text), answer: String(t.assistant_text) })),
    ...(canalDemoWhatsApp() && { whatsapp: await estadoVinculoWhatsApp(s.organization_id, s.id) ?? { state: "available" } }),
  };
}

export async function prepararWhatsAppWeb(token: string, phone: string) {
  return prepararVinculoWhatsApp(await accesoDemoWeb(token), phone);
}

export async function operarDemoWeb(token: string, command: { action: "close" | "finishWhatsApp" } | { action: "send"; requestKey: string; text: string }) {
  const s = await accesoDemoWeb(token);
  const actor = { organizationId: String(s.organization_id), userId: String(s.actor_user_id) };
  const scope = { spaceId: String(s.space_id), sessionId: String(s.id) };
  if (command.action === "close") {
    await getSql().begin(async sql => {
      await sql`select id from organization where id=${s.organization_id} for update`;
      const [closed] = await sql`update demo_session set state='closed',ended_at=clock_timestamp()
        where organization_id=${s.organization_id} and id=${s.id} and kind='web' and state='active' returning id`;
      if (!closed) return;
      await cerrarVinculoWhatsAppEnTx(sql, s.organization_id, s.id, "closed");
      await sql`insert into demo_session_event(id,organization_id,space_id,session_id,type,actor,reason_code)
        values(${randomUUID()},${s.organization_id},${s.space_id},${s.id},'web_demo_closed','prospect_invitation','web_demo')`;
      const audit = randomUUID();
      await sql`insert into demo_admin_audit(id,organization_id,space_id,actor_user_id,action,target_id,reason_code,request_id,result)
        values(${audit},${s.organization_id},${s.space_id},${s.actor_user_id},'web_demo_closed',${s.id},'web_demo',${audit},'success')`;
    });
  } else if (command.action === "finishWhatsApp") {
    await cerrarVinculoWhatsApp(s.organization_id, s.id, "closed");
  } else if (command.action === "send") {
    if (s.state !== "active") throw new SimulatorError("session_unavailable");
    await realDemoSend(actor, { ...scope, requestKey: `web:${scope.sessionId}:${command.requestKey}`, text: command.text },
      await configuredDemoProvider(actor.organizationId), false, false, true);
  }
  return consultarDemoWeb(token);
}

export async function listarDemosWeb(actor: AdminActor, spaceId: string) {
  return getSql()`select s.id, s.expires_at, s.idle_deadline,
    case when s.state='active' and least(s.expires_at,s.idle_deadline)<=clock_timestamp() then 'expired'
      when s.state='active' and p.status<>'active' then 'suspended' else s.state end as state,
    count(o.id)::int as turns,
    coalesce(sum(o.actual_amount) filter(where o.status='settled'),0)::text as cost,
    coalesce(sum(greatest(o.reserved_amount,coalesce(o.actual_amount,0))) filter(where o.status in ('reserved','uncertain')),0)::text as held,
    max(o.id) filter(where o.status in ('reserved','uncertain')) as pending,
    (select jsonb_build_object('state',ext.state,'mode',r.mode,'generation',r.generation,'reviewDueAt',r.review_due_at,
      'turns',(select count(*) from demo_usage_operation w where w.organization_id=s.organization_id and w.session_id=ext.id),
      'cost',(select coalesce(sum(w.actual_amount),0)::text from demo_usage_operation w
        where w.organization_id=s.organization_id and w.session_id=ext.id and w.status='settled'),
      'financialPending',(select max(w.id) from demo_usage_operation w
        where w.organization_id=s.organization_id and w.session_id=ext.id and w.status in ('reserved','uncertain')),
      'deliveryPending',(select max(w.id) from demo_usage_operation w join zernio_whatsapp_outbox j
        on j.organization_id=w.organization_id and j.request_key='demo:'||w.id
        where w.organization_id=s.organization_id and w.session_id=ext.id and j.status in ('iniciado','incierto')),
      'noticePending',(select max(j.id) from zernio_whatsapp_outbox j join message m on (m.organization_id,m.id)=(j.organization_id,j.message_id)
        where m.organization_id=s.organization_id and m.demo_session_id=ext.id and j.request_key in
          ('demo-notice:'||ext.id||':started','demo-notice:'||ext.id||':ended') and j.status in ('iniciado','incierto')),
      'dispatchErrors',(select count(*) from dispatch d where d.organization_id=s.organization_id
        and d.demo_session_id=ext.id and d.status in ('caducado','descartado') and d.last_error is not null),
      'pending',(select count(*) from zernio_whatsapp_outbox j join message m on (m.organization_id,m.id)=(j.organization_id,j.message_id)
        where m.organization_id=s.organization_id and m.demo_session_id=ext.id and j.status in ('retenido','iniciado','incierto')))
      from demo_whatsapp_link l join demo_session ext on (ext.organization_id,ext.id)=(l.organization_id,l.external_session_id)
      left join demo_identity_route r on r.organization_id=l.organization_id and r.identity_lookup=l.phone_lookup and r.channel='whatsapp'
      where l.organization_id=s.organization_id and l.web_session_id=s.id) as whatsapp
    from demo_session s join demo_space p on (p.organization_id,p.id)=(s.organization_id,s.space_id)
    left join demo_usage_operation o on (o.organization_id,o.space_id,o.session_id)=(s.organization_id,s.space_id,s.id)
    where s.kind='web' and s.organization_id=${actor.organizationId} and s.space_id=${spaceId}
    group by s.id,p.status order by s.started_at desc limit 30`;
}

export async function revocarDemoWeb(actor: AdminActor, spaceId: string, sessionId: string) {
  await getSql().begin(async sql => {
    const org = actor.organizationId;
    await sql`select id from organization where id=${org} for update`;
    const [s] = await sql`select state from demo_session where organization_id=${org} and space_id=${spaceId}
      and kind='web' and id=${sessionId} for update`;
    if (!s) throw new SimulatorError("not_found", 404);
    if (s.state !== "active" && !(await sql`select 1 from demo_whatsapp_link l join demo_session x on (x.organization_id,x.space_id,x.id)=(l.organization_id,l.space_id,l.external_session_id) where l.organization_id=${org} and l.web_session_id=${sessionId} and x.state='active'`)[0]) return;
    await sql`update demo_session set state='revoked',ended_at=clock_timestamp() where organization_id=${org} and id=${sessionId} and state='active'`;
    await cerrarVinculoWhatsAppEnTx(sql, org, sessionId, "revoked", actor.userId);
    const id = randomUUID();
    await sql`insert into demo_admin_audit(id,organization_id,space_id,actor_user_id,action,target_id,reason_code,request_id,result)
      values(${id},${org},${spaceId},${actor.userId},'web_demo_revoked',${sessionId},'web_demo',${id},'success')`;
  });
}

export async function conciliarDemoWeb(actor: AdminActor, spaceId: string, operationId: string) {
  const [scope] = await getSql()`select s.actor_user_id from demo_usage_operation o join demo_session s
    on (s.organization_id,s.space_id,s.id)=(o.organization_id,o.space_id,o.session_id)
    where s.kind='web' and o.organization_id=${actor.organizationId} and o.space_id=${spaceId} and o.id=${operationId}`;
  if (!scope) throw new SimulatorError("not_found", 404);
  return reconcileDemoOperation({ ...actor, userId: String(scope.actor_user_id) }, spaceId, operationId,
    await configuredDemoProvider(actor.organizationId), false, true);
}

export async function conciliarWhatsAppWeb(actor: AdminActor, spaceId: string, operationId: string, tipo: "financial" | "delivery") {
  const [op] = await getSql()`select o.session_id,o.operation_key from demo_usage_operation o
    join demo_whatsapp_link l on (l.organization_id,l.space_id,l.external_session_id)=(o.organization_id,o.space_id,o.session_id)
    where o.organization_id=${actor.organizationId} and o.space_id=${spaceId} and o.id=${operationId}`;
  if (!op) throw new SimulatorError("not_found", 404);
  if (tipo === "delivery") return readDemoDelivery(actor.organizationId, op.session_id, op.operation_key, true);
  return reconcileDemoOperation(actor, spaceId, operationId, await configuredDemoProvider(actor.organizationId), true);
}

export async function conciliarAvisoWhatsApp(actor: AdminActor, spaceId: string, noticeId: string) {
  const result = await reconcileDemoNotice(actor.organizationId, spaceId, noticeId);
  const id = randomUUID();
  await getSql()`insert into demo_admin_audit(id,organization_id,space_id,actor_user_id,action,target_id,reason_code,request_id,result)
    values(${id},${actor.organizationId},${spaceId},${actor.userId},'whatsapp_notice_reviewed',${noticeId},'provider_confirmation',${id},${result.status === "uncertain" ? "pending" : "success"})`;
  return result;
}
