import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { canalDemoWhatsApp } from "./whatsapp-link";
import { SimulatorError } from "./simulator";
import { externalIdentityLookup } from "./external-session";

type Notice = "started" | "ended";

export async function encolarAvisoDemo(sql: TransactionSql, org: string, session: string, account: string,
  thread: string, kind: Notice, inboundAt: string) {
  const [s] = await sql`select s.space_id,s.conversation_id,s.route_generation,v.name
    from demo_session s join demo_profile_version v on (v.organization_id,v.space_id,v.id)=(s.organization_id,s.space_id,s.profile_version_id)
    where s.organization_id=${org} and s.id=${session} and s.kind='external'`;
  if (!s || !canalDemoWhatsApp()) return;
  const request = `demo-notice:${session}:${kind}`;
  const text = kind === "started" ?
    `Empezó la demo con ${s.name}. Escribe tu primera pregunta. Si quieres salir, escribe TERMINAR DEMO.` :
    `¡Listo! 🎉 Gracias por probar ${s.name}. 😊\n\nEspero que hayas disfrutado la experiencia. ¡Esto es solo una muestra de lo que podemos hacer por tu negocio!\n\nEn un momento retomamos nuestra charla con Lukas para seguir platicando. 🙌`;
  const [prior] = await sql`select j.id,j.account_ref,j.thread_ref,j.conversation_id,m.text,m.demo_session_id
    from zernio_whatsapp_outbox j join message m on (m.organization_id,m.id)=(j.organization_id,j.message_id)
    where j.organization_id=${org} and j.request_key=${request}`;
  if (prior) {
    const avisoAnterior = kind === "ended" && [
      "La demostración terminó. ModoNext puede ayudarte a continuar con la atención comercial una vez revisada esta conversación.",
      "La demostración terminó. Gracias por probarla. Enseguida continuamos nuestra conversación.",
    ].includes(prior.text);
    if (prior.account_ref !== account || prior.thread_ref !== thread || prior.conversation_id !== s.conversation_id ||
        prior.demo_session_id !== session || (prior.text !== text && !avisoAnterior)) throw new SimulatorError("delivery_conflict");
    return String(prior.id);
  }
  const message = randomUUID(), job = randomUUID();
  await sql`insert into message(id,organization_id,conversation_id,direction,type,text,status,origin,ai_generated,scope_kind,demo_session_id,route_generation)
    values(${message},${org},${s.conversation_id},'out','text',${text},'pending','ai',false,'demo',${session},${s.route_generation})`;
  await sql`insert into zernio_whatsapp_outbox(id,organization_id,conversation_id,message_id,account_ref,thread_ref,request_key,status)
    values(${job},${org},${s.conversation_id},${message},${account},${thread},${request},'retenido')`;
  await sql`insert into demo_session_event(id,organization_id,space_id,session_id,type,actor,reason_code,metadata)
    values(${randomUUID()},${org},${s.space_id},${session},'whatsapp_lifecycle_notice','crm','prospect_transition',
      ${JSON.stringify({ kind, message, job, inboundAt })}::jsonb)`;
  return job;
}

/** Solamente acepta los avisos fijos que el selector creó al cambiar el ámbito. */
export async function autorizarAvisoDemo(sql: TransactionSql, id: string) {
  if (!canalDemoWhatsApp()) return null;
  const [row] = await sql`select j.organization_id,j.account_ref,c.channel_thread_ref,s.conversation_id,s.route_generation,
      m.text as response_text,l.phone_lookup,t.wa_identity
    from zernio_whatsapp_outbox j
    join message m on (m.organization_id,m.id)=(j.organization_id,j.message_id)
    join demo_session s on (s.organization_id,s.id)=(m.organization_id,m.demo_session_id)
    join demo_whatsapp_link l on (l.organization_id,l.space_id,l.external_session_id)=(s.organization_id,s.space_id,s.id)
    join demo_session_event e on (e.organization_id,e.space_id,e.session_id)=(s.organization_id,s.space_id,s.id)
    join demo_identity_route r on r.organization_id=s.organization_id and r.channel='whatsapp' and r.identity_lookup=l.phone_lookup
    join demo_authorization a on (a.organization_id,a.space_id,a.id)=(s.organization_id,s.space_id,s.authorization_id)
    join demo_identity_binding b on (b.organization_id,b.space_id,b.authorization_id,b.identity_lookup)=(s.organization_id,s.space_id,a.id,r.identity_lookup)
    join demo_space p on (p.organization_id,p.id)=(s.organization_id,s.space_id)
    join conversation c on (c.organization_id,c.id)=(s.organization_id,s.conversation_id)
    join contact t on (t.organization_id,t.id)=(c.organization_id,c.contact_id)
    where j.id=${id} and j.status='retenido' and m.direction='out' and m.scope_kind='demo'
      and s.kind='external' and m.route_generation=s.route_generation and j.conversation_id=c.id
      and c.channel='whatsapp' and not c.is_test and c.ai_enabled and c.handoff_at is null and c.handoff_pending_message_id is null
      and (j.account_ref,j.thread_ref)=(l.account_ref,l.thread_ref) and c.channel_thread_ref=l.thread_ref
      and b.account_ref=l.account_ref and b.state='verified' and a.state='active'
      and e.type='whatsapp_lifecycle_notice' and e.metadata->>'job'=j.id and e.metadata->>'message'=m.id
      and j.request_key='demo-notice:'||s.id||':'||(e.metadata->>'kind')
      and (e.metadata->>'inboundAt')::timestamptz between clock_timestamp()-interval '24 hours' and clock_timestamp()
      and ((e.metadata->>'kind'='started' and r.mode='demo' and r.session_id=s.id and r.generation=s.route_generation
        and s.state='active' and p.status='active' and least(s.expires_at,s.idle_deadline)>clock_timestamp()
        and (a.expires_at is null or a.expires_at>clock_timestamp()) and (b.expires_at is null or b.expires_at>clock_timestamp()))
        or (e.metadata->>'kind'='ended' and s.state in ('closed','expired') and r.mode='blocked'
          and r.generation=s.route_generation+1 and r.blocked_reason in ('prospect_finished','session_deadline','inbound_quota','generation_quota')))
    for update of s,a,b,r,c,t,p`;
  return row && externalIdentityLookup(row.organization_id,
    row.account_ref, "phone", row.wa_identity) === row.phone_lookup ? row : null;
}
