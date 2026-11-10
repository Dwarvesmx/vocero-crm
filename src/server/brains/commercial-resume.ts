import { getSql } from "@/lib/db";
import type { EventoDespacho } from "./contract";

export const esReanudacionComercial = (id: string) => id.startsWith("resume:");

/** La identidad de despacho solo vale para la generación comercial que salió de esa demo. */
export async function contextoDeReanudacion(org: string, conversation: string, dispatchId: string, paraEntrega = false) {
  if (!esReanudacionComercial(dispatchId)) return null;
  const [fila] = await getSql()<{ session_id: string; generation: number; assistant: string }[]>`select s.id as session_id,r.generation,v.name as assistant
    from dispatch d
    join demo_session s on s.organization_id=d.organization_id and s.conversation_id=d.conversation_id
      and d.id='resume:'||s.id
    join demo_profile_version v on (v.organization_id,v.space_id,v.id)=(s.organization_id,s.space_id,s.profile_version_id)
    join demo_whatsapp_link l on (l.organization_id,l.external_session_id)=(s.organization_id,s.id)
    join demo_identity_route r on r.organization_id=l.organization_id and r.channel='whatsapp' and r.identity_lookup=l.phone_lookup
    join conversation c on (c.organization_id,c.id)=(d.organization_id,d.conversation_id)
    join contact t on (t.organization_id,t.id)=(c.organization_id,c.contact_id)
    where d.organization_id=${org} and d.conversation_id=${conversation} and d.id=${dispatchId}
      and d.scope_kind='commercial' and d.status in ('en_vuelo','entregado')
      and r.mode='commercial' and r.generation=d.commercial_trace_generation and r.generation=s.route_generation+2
      and s.state in ('closed','expired') and c.channel='whatsapp' and not c.is_test and c.ai_enabled
      and c.channel_thread_ref=l.thread_ref and not t.ai_paused and c.handoff_at is null and c.handoff_pending_message_id is null
      and c.last_inbound_at > (clock_timestamp() at time zone 'UTC') - interval '24 hours'
      and exists(select 1 from agent_profile p where p.organization_id=d.organization_id and p.enabled)
      and exists(select 1 from zernio_whatsapp_credentials z where z.organization_id=l.organization_id and z.account_ref=l.account_ref and z.enabled)
      and not exists(select 1 from message m where m.organization_id=d.organization_id and m.conversation_id=d.conversation_id
        and m.scope_kind='commercial' and m.direction='out' and m.created_at >= (r.blocked_since at time zone 'UTC'))
      and (${paraEntrega} or not exists(select 1 from message m
        where m.organization_id=d.organization_id and m.conversation_id=d.conversation_id
          and jsonb_array_length(d.commercial_resume_envelope->'messages')=0
          and m.scope_kind='commercial' and m.direction='in' and m.created_at >= (r.blocked_since at time zone 'UTC')))`;
  return fila ? { sessionId: fila.session_id, generation: fila.generation, assistant: fila.assistant } : null;
}

export async function fijarSobreDeReanudacion(evento: EventoDespacho): Promise<EventoDespacho | null> {
  const sql = getSql();
  const [fila] = await sql<{ commercial_resume_envelope: EventoDespacho }[]>`update dispatch
    set commercial_resume_envelope=coalesce(commercial_resume_envelope,${sql.typed(JSON.stringify(evento),25)}::jsonb)
    where organization_id=${evento.organization.id} and id=${evento.dispatchId} and conversation_id=${evento.conversation.id}
      and scope_kind='commercial' and status='en_vuelo'
    returning commercial_resume_envelope`;
  return fila?.commercial_resume_envelope ?? null;
}
