import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";
import { canalConversacional } from "./whatsapp-offer";
import { bloquearRutaWhatsApp, restituirWhatsApp } from "./whatsapp-link";
import { encolarAvisoDemo } from "./whatsapp-notice";

/** Cierra sin esperar otro mensaje. El aviso requiere una ventana de 24 horas acreditada. */
export async function caducarDemosConversacionales() {
  if (!canalConversacional()) return;
  const db = getSql();
  const candidates = await db`select s.organization_id,s.id from demo_session s
    join demo_whatsapp_link l on (l.organization_id,l.external_session_id)=(s.organization_id,s.id)
    join demo_identity_route r on r.organization_id=s.organization_id and r.session_id=s.id and r.mode='demo'
    where s.kind='external' and s.state='active' and least(s.expires_at,s.idle_deadline)<=clock_timestamp()
    order by s.expires_at limit 20`;
  for (const candidate of candidates) await db.begin(async sql => {
    const org = String(candidate.organization_id);
    await sql`select id from organization where id=${org} for update`;
    const [s] = await sql`select s.id,l.phone_lookup,l.account_ref,l.thread_ref,
      greatest((select max((e.metadata->>'inboundAt')::timestamptz) from demo_session_event e
        where e.organization_id=s.organization_id and e.session_id=s.id and e.type='whatsapp_lifecycle_notice' and e.metadata->>'kind'='started'),
        (select max(m.wa_timestamp) at time zone 'UTC' from message m
        where m.organization_id=s.organization_id and m.demo_session_id=s.id and m.scope_kind='demo' and m.direction='in')) as last_inbound
      from demo_session s join demo_whatsapp_link l on (l.organization_id,l.external_session_id)=(s.organization_id,s.id)
      join demo_identity_route r on r.organization_id=s.organization_id and r.session_id=s.id and r.mode='demo' and r.generation=s.route_generation
      where s.organization_id=${org} and s.id=${candidate.id} and s.state='active' and least(s.expires_at,s.idle_deadline)<=clock_timestamp()
      for update of s,r`;
    if (!s) return;
    await bloquearRutaWhatsApp(sql, org, s.phone_lookup, s.id, "expired", "session_deadline");
    if (s.last_inbound) await encolarAvisoDemo(sql, org, s.id, s.account_ref, s.thread_ref, "ended", new Date(s.last_inbound).toISOString());
  });
  // Solo cierres conversacionales y únicamente después del aviso final confirmado.
  // La restitución reutiliza la comprobación transaccional de pendientes y el corte temporal.
  const ready = await db`select l.organization_id,l.space_id,l.web_session_id,r.generation,a.created_by
    from demo_whatsapp_link l
    join demo_session s on (s.organization_id,s.id)=(l.organization_id,l.external_session_id)
    join demo_authorization a on (a.organization_id,a.space_id,a.id)=(s.organization_id,s.space_id,s.authorization_id)
    join demo_identity_route r on r.organization_id=l.organization_id and r.channel='whatsapp' and r.identity_lookup=l.phone_lookup
    join zernio_whatsapp_outbox j on j.organization_id=s.organization_id and j.request_key='demo-notice:'||s.id||':ended'
    where r.mode='blocked' and r.generation=s.route_generation+1
      and r.blocked_reason in ('prospect_finished','session_deadline','inbound_quota','generation_quota')
      and s.state in ('closed','expired') and j.status='completado'
      and not exists(select 1 from zernio_whatsapp_outbox q
        join message m on (m.organization_id,m.id)=(q.organization_id,q.message_id)
        where m.organization_id=s.organization_id and m.demo_session_id=s.id and m.scope_kind='demo'
          and q.status='completado' and m.status not in ('delivered','read','failed'))
      and not exists(select 1 from demo_whatsapp_link newer where newer.organization_id=l.organization_id
        and newer.phone_lookup=l.phone_lookup and newer.linked_at>l.linked_at)
    order by r.blocked_since limit 20`;
  for (const row of ready) {
    try {
      await restituirWhatsApp({organizationId:String(row.organization_id),userId:String(row.created_by)},
        String(row.space_id),String(row.web_session_id),Number(row.generation));
    } catch {
      // Trabajo incierto, revocación concurrente u otros fallos conservan la cuarentena.
    }
  }
}

export async function cerrarPorCuotaDemo(org: string, space: string, session: string, dispatch: string, digest: string) {
  if (!canalConversacional()) return;
  await getSql().begin(async sql => {
    await sql`select id from organization where id=${org} for update`;
    const [s] = await sql`select l.phone_lookup,l.account_ref,l.thread_ref,m.wa_timestamp at time zone 'UTC' as inbound_at,m.text
      from demo_session s join demo_whatsapp_link l on (l.organization_id,l.external_session_id)=(s.organization_id,s.id)
      join demo_identity_route r on r.organization_id=s.organization_id and r.session_id=s.id and r.mode='demo' and r.generation=s.route_generation
      join dispatch d on (d.organization_id,d.demo_session_id,d.route_generation)=(s.organization_id,s.id,s.route_generation)
      join message m on m.organization_id=s.organization_id and m.demo_session_id=s.id and d.message_ids ? m.id
      where s.organization_id=${org} and s.space_id=${space} and s.id=${session} and s.state='active' and d.id=${dispatch}
        and d.scope_kind='demo' and d.status in ('en_vuelo','entregado') and jsonb_array_length(d.message_ids)=1
        and m.scope_kind='demo' and m.direction='in' and m.route_generation=s.route_generation for update of s,r`;
    if (!s?.text || createHash("sha256").update(s.text.trim()).digest("hex") !== digest) return;
    await bloquearRutaWhatsApp(sql, org, s.phone_lookup, session, "closed", "generation_quota");
    await encolarAvisoDemo(sql, org, session, s.account_ref, s.thread_ref, "ended", new Date(s.inbound_at).toISOString());
  });
}
