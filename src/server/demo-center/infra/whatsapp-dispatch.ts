import { getSql } from "@/lib/db";
import { armarEvento } from "@/server/brains/contract";
import type { FilaDespacho } from "@/server/dispatch/outbox";
import { externalIdentityLookup } from "./external-session";
import { canalDemoWhatsApp } from "./whatsapp-link";

export async function construirDespachoWhatsAppDemo(fila: FilaDespacho) {
  if (!canalDemoWhatsApp() || fila.messageIds?.length !== 1 || !fila.demoSessionId) return null;
  const [r] = await getSql()`select s.*,org.slug,c.contact_id,t.wa_identity,l.account_ref,l.phone_lookup,
    m.id as message_id,m.text,m.wa_timestamp at time zone 'UTC' as wa_timestamp
    from demo_session s join organization org on org.id=s.organization_id
    join demo_whatsapp_link l on (l.organization_id,l.external_session_id)=(s.organization_id,s.id)
    join demo_identity_route r on r.organization_id=s.organization_id and r.session_id=s.id and r.mode='demo' and r.generation=s.route_generation
    join demo_authorization a on (a.organization_id,a.space_id,a.id)=(s.organization_id,s.space_id,s.authorization_id)
    join demo_identity_binding b on (b.organization_id,b.space_id,b.authorization_id,b.identity_lookup)=(s.organization_id,s.space_id,a.id,r.identity_lookup)
    join demo_space p on (p.organization_id,p.id)=(s.organization_id,s.space_id)
    join conversation c on (c.organization_id,c.id)=(s.organization_id,s.conversation_id)
    join contact t on (t.organization_id,t.id)=(c.organization_id,c.contact_id)
    join message m on (m.organization_id,m.conversation_id,m.demo_session_id)=(s.organization_id,s.conversation_id,s.id)
    join zernio_whatsapp_credentials cred on cred.organization_id=s.organization_id and cred.account_ref=l.account_ref and cred.enabled
    where s.organization_id=${fila.organizationId} and s.conversation_id=${fila.conversationId} and s.id=${fila.demoSessionId}
    and s.kind='external' and s.route_generation=${fila.routeGeneration} and s.state='active' and p.status='active'
    and least(s.expires_at,s.idle_deadline,a.expires_at,b.expires_at)>clock_timestamp()
    and a.state='active' and b.state='verified' and b.account_ref=l.account_ref
    and m.id=${fila.messageIds[0]!} and m.scope_kind='demo' and m.route_generation=s.route_generation and m.direction='in'
    and m.type='text' and m.wa_timestamp>clock_timestamp()-interval '24 hours'
    and c.channel_thread_ref=l.thread_ref and c.ai_enabled and not c.is_test and c.handoff_at is null and c.handoff_pending_message_id is null`;
  if (!r || !r.text || externalIdentityLookup(fila.organizationId,r.account_ref,"phone",r.wa_identity) !== r.phone_lookup) return null;
  const expiracion = new Date(r.expires_at).toISOString();
  const envio = new Date(r.wa_timestamp);
  const base = armarEvento({
    dispatchId: fila.id, organization: { id: fila.organizationId, slug: r.slug },
    conversation: { id: fila.conversationId, channel: "whatsapp", aiEnabled: true,
      windowOpen: true, windowExpiresAt: new Date(+envio + 86400000) },
    contact: { id: r.contact_id, displayName: "Visitante demo", identity: r.wa_identity },
    messages: [{ id: r.message_id, createdAt: envio, text: r.text, type: "text", media: null }],
    firstMessageAt: fila.firstMessageAt, lastMessageAt: fila.lastMessageAt,
  });
  return { ...base, expiresAt: expiracion,
    demo: { contractVersion: 1, scope: { kind: "demo", organizationId: fila.organizationId, spaceId: r.space_id,
      sessionId: fila.demoSessionId, conversationId: fila.conversationId, authorizationId: r.authorization_id,
      routeGeneration: fila.routeGeneration, profileVersionId: r.profile_version_id } },
    channelContext: { accountRef: r.account_ref, identity: { kind: "phone", value: r.wa_identity } },
  };
}
