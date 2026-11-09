import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Row, TransactionSql } from "postgres";
import { getSql } from "@/lib/db";
import { enlaceWhatsApp, telefonoWhatsApp } from "../domain/whatsapp";
import { externalIdentityLookup } from "./external-session";
import { SimulatorError } from "./simulator";

export const hashCodigo = (value: string) => createHash("sha256").update(value).digest("hex");
export const canalDemoWhatsApp = () => process.env.DEMO_WHATSAPP_ENABLED === "true" &&
  process.env.ZERNIO_WHATSAPP_ENABLED === "true";
export const numeroDemoWhatsApp = () => telefonoWhatsApp(process.env.DEMO_WHATSAPP_NUMBER);

export async function prepararVinculoWhatsApp(web: Row, numero: string) {
  const receptor = numeroDemoWhatsApp(), phone = telefonoWhatsApp(numero);
  if (!canalDemoWhatsApp() || !receptor) throw new SimulatorError("whatsapp_unavailable", 503);
  if (!phone) throw new SimulatorError("invalid_phone", 422);
  const codigo = randomBytes(24).toString("base64url");
  const expira = await getSql().begin(async sql => {
    await sql`select id from organization where id=${web.organization_id} for update`;
    const [cuenta] = await sql`select account_ref from zernio_whatsapp_credentials where organization_id=${web.organization_id} and enabled`;
    if (!cuenta) throw new SimulatorError("whatsapp_unavailable", 503);
    const [sesion] = await sql`select s.id from demo_session s join demo_space p on (p.organization_id,p.id)=(s.organization_id,s.space_id)
      where s.id=${web.id} and s.organization_id=${web.organization_id} and s.kind='web' and s.state='active' and p.status='active'
      and least(s.expires_at,s.idle_deadline)>clock_timestamp() for update of s,p`;
    if (!sesion) throw new SimulatorError("session_unavailable");
    const lookup = externalIdentityLookup(web.organization_id, cuenta.account_ref, "phone", phone);
    const [link] = await sql`insert into demo_whatsapp_link(id,organization_id,space_id,web_session_id,account_ref,phone_lookup,challenge_hash,expires_at)
      select ${randomUUID()},s.organization_id,s.space_id,s.id,${cuenta.account_ref},${lookup},${hashCodigo(codigo)},
        least(s.expires_at,s.idle_deadline,clock_timestamp()+interval '5 minutes')
      from demo_session s where s.id=${web.id}
      on conflict(web_session_id) do update set account_ref=excluded.account_ref, phone_lookup=excluded.phone_lookup,
        challenge_hash=excluded.challenge_hash, created_at=clock_timestamp(), expires_at=excluded.expires_at
      where demo_whatsapp_link.external_session_id is null returning expires_at`;
    if (!link) throw new SimulatorError("already_linked");
    return new Date(link.expires_at).toISOString();
  });
  return { url: enlaceWhatsApp(receptor, codigo), expiresAt: expira };
}

export async function estadoVinculoWhatsApp(org: string, webId: string) {
  const [link] = await getSql()`select
    case when s.state <> 'active' then s.state
      when not ${canalDemoWhatsApp()} or p.status <> 'active' then 'suspended'
      when s.id is not null and (least(s.expires_at,s.idle_deadline)<=clock_timestamp() or a.expires_at<=clock_timestamp()) then 'expired'
      when s.id is not null and (r.id is null or a.state<>'active') then 'revoked'
      when s.id is not null then 'linked'
      when l.expires_at<=clock_timestamp() then 'expired' else 'pending' end as state,
    coalesce(least(s.expires_at,s.idle_deadline), l.expires_at) as expires_at
    from demo_whatsapp_link l join demo_space p on (p.organization_id,p.id)=(l.organization_id,l.space_id)
    left join demo_session s on (s.organization_id,s.id)=(l.organization_id,l.external_session_id)
    left join demo_identity_route r on r.organization_id=s.organization_id and r.session_id=s.id and r.mode='demo' and r.generation=s.route_generation
    left join demo_authorization a on (a.organization_id,a.space_id,a.id)=(s.organization_id,s.space_id,s.authorization_id)
    where l.organization_id=${org} and l.web_session_id=${webId}`;
  return link ? { state: String(link.state), expiresAt: new Date(link.expires_at).toISOString() } : null;
}

export async function bloquearRutaWhatsApp(sql: TransactionSql, org: string, lookup: string, session: string, estado: string, motivo: string) {
  await sql`update demo_session set state=${estado},ended_at=clock_timestamp() where organization_id=${org} and id=${session} and state='active'`;
  await sql`update demo_identity_route set mode='blocked',session_id=null,generation=generation+1,
    blocked_since=clock_timestamp(),blocked_reason=${motivo},review_due_at=clock_timestamp()+interval '24 hours'
    where organization_id=${org} and identity_lookup=${lookup} and session_id=${session} and mode='demo'`;
  await invalidarPendientesWhatsApp(sql, org, session);
}

export async function invalidarPendientesWhatsApp(sql: TransactionSql, org: string, session: string) {
  await sql`update dispatch set status='descartado',leased_until=null,last_error='demo no vigente',updated_at=clock_timestamp()
    where organization_id=${org} and demo_session_id=${session} and scope_kind='demo' and status in ('pendiente','en_vuelo')`;
  await sql`with cancelados as (
    update zernio_whatsapp_outbox j set status='cancelado',updated_at=clock_timestamp() from message m
    where (j.organization_id,j.message_id)=(m.organization_id,m.id) and m.organization_id=${org}
    and m.demo_session_id=${session} and m.scope_kind='demo' and j.status='retenido' returning j.message_id
  ) update message set status='failed' where organization_id=${org} and id in (select message_id from cancelados)`;
}

export async function cerrarVinculoWhatsApp(org: string, webId: string, estado: "closed" | "revoked", actor?: string) {
  await getSql().begin(async sql => {
    await sql`select id from organization where id=${org} for update`;
    await cerrarVinculoWhatsAppEnTx(sql, org, webId, estado, actor);
  });
}

export async function cerrarVinculoWhatsAppEnTx(sql: TransactionSql, org: string, webId: string, estado: "closed" | "revoked", actor?: string) {
    // Invalida también un reto que aún no se haya usado.
    await sql`update demo_whatsapp_link set expires_at=least(expires_at,clock_timestamp())
      where organization_id=${org} and web_session_id=${webId}`;
    const [link] = await sql`select external_session_id,phone_lookup,space_id from demo_whatsapp_link where organization_id=${org} and web_session_id=${webId}`;
    if (!link?.external_session_id) return;
    if (estado === "revoked") {
      await sql`update demo_authorization a set state='revoked',version=a.version+1 from demo_session s
        join demo_identity_route r on r.organization_id=s.organization_id and r.session_id=s.id and r.generation=s.route_generation
        where s.organization_id=${org} and s.id=${link.external_session_id} and r.mode='demo'
        and (a.organization_id,a.space_id,a.id)=(s.organization_id,s.space_id,s.authorization_id) and a.state='active'`;
    }
    await bloquearRutaWhatsApp(sql, org, link.phone_lookup, link.external_session_id, estado, "portal_" + estado);
    if (actor) {
      const id = randomUUID();
      await sql`insert into demo_admin_audit(id,organization_id,space_id,actor_user_id,action,target_id,reason_code,request_id,result)
        values(${id},${org},${link.space_id},${actor},'whatsapp_revoked',${link.external_session_id},'portal_revoked',${id},'success')`;
    }
}

export async function restituirWhatsApp(actor: {organizationId: string; userId: string}, spaceId: string, webId: string, generation: number) {
  const org = actor.organizationId;
  await getSql().begin(async sql => {
    await sql`select id from organization where id=${org} for update`;
    const [r] = await sql`select r.*,s.conversation_id,l.linked_at from demo_whatsapp_link l
      join demo_session s on (s.organization_id,s.id)=(l.organization_id,l.external_session_id)
      join demo_identity_route r on r.organization_id=l.organization_id and r.identity_lookup=l.phone_lookup and r.channel='whatsapp'
      where l.organization_id=${org} and l.space_id=${spaceId} and l.web_session_id=${webId}
      and not exists(select 1 from demo_whatsapp_link posterior where posterior.organization_id=l.organization_id
        and posterior.phone_lookup=l.phone_lookup and posterior.linked_at>l.linked_at) for update of r`;
    if (!r) throw new SimulatorError("not_found", 404);
    if (r.mode !== "blocked" || r.generation !== generation) throw new SimulatorError("request_conflict");
    const [conv] = await sql`select id from conversation where organization_id=${org} and id=${r.conversation_id} for update`;
    if (!conv) throw new SimulatorError("not_found", 404);
    const [trabajo] = await sql`select 1 from zernio_whatsapp_outbox where organization_id=${org} and conversation_id=${conv.id}
      and status in ('pendiente','procesando','retenido','iniciado','incierto')
      union all select 1 from zernio_whatsapp_outbox j join message m on (m.organization_id,m.id)=(j.organization_id,j.message_id)
      where j.organization_id=${org} and j.conversation_id=${conv.id} and j.status='completado'
        and m.status not in ('delivered','read','failed')
      union all select 1 from dispatch where organization_id=${org} and conversation_id=${conv.id}
      and (status in ('pendiente','en_vuelo') or (scope_kind='commercial' and status='entregado'
        and commercial_trace_generation is null and updated_at>clock_timestamp()-interval '24 hours'))
      union all select 1 from demo_usage_operation o join demo_session s on (s.organization_id,s.id)=(o.organization_id,o.session_id)
      where o.organization_id=${org} and s.conversation_id=${conv.id} and o.status in ('reserved','uncertain') limit 1`;
    if (trabajo) throw new SimulatorError("thread_busy");
    await sql`update demo_identity_route set mode='commercial',generation=generation+1,blocked_since=clock_timestamp(),
      blocked_reason=null,review_due_at=null where id=${r.id}`;
    const id = randomUUID();
    await sql`insert into demo_admin_audit(id,organization_id,space_id,actor_user_id,action,target_id,reason_code,request_id,result)
      values(${id},${org},${spaceId},${actor.userId},'whatsapp_commercial_restored',${r.id},'reviewed_pending_work',${id},'success')`;
  });
}
