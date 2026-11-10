import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getEnv } from "@/lib/env";
import { getSql } from "@/lib/db";
import { permiteDespachoWhatsAppZernio, type EventoWhatsAppZernio } from "@/server/zernio/whatsapp-evento";
import { posteriorAlCorte, telefonoWhatsApp } from "../domain/whatsapp";
import { externalIdentityLookup } from "./external-session";
import { configuredDemoProvider } from "./finance";
import { SimulatorError, simulatorCommand } from "./simulator";
import { canalDemoWhatsApp, hashCodigo } from "./whatsapp-link";

export const canalConversacional = () => canalDemoWhatsApp() &&
  process.env.DEMO_CONVERSATIONAL_ENABLED === "true" &&
  process.env.DEMO_EXTERNAL_SESSIONS_ENABLED === "true" &&
  process.env.DEMO_EXTERNAL_DELIVERY_ENABLED === "true" &&
  process.env.DEMO_EXTERNAL_GENERATION_ENABLED === "true";

export const consentimientoDemo = (text: string | null) => /^acepto demo[.!]?$/iu.test(text?.trim() ?? "");
export const finDemo = (text: string | null) =>
  /^(?:(?:terminar|finalizar|salir de (?:la )?)\s*(?:la )?demo|(?:quiero|deseo) (?:terminar|finalizar) (?:la )?demo)[.!]?$/iu.test(text?.trim() ?? "");
const clave = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");

// El valor histórico "automatic" conserva el alcance piloto al actualizar la aplicación.
async function permisoConversacional(sql: TransactionSql, org: string, space: string, phoneHash: string, policy: unknown) {
  const [access] = await sql`select
    (select state from demo_pilot_participant where organization_id=${org} and space_id=${space}
      and channel='whatsapp' and phone_lookup=${phoneHash}) as pilot,
    (select id from demo_authorization where organization_id=${org} and space_id=${space}
      and channel='whatsapp' and phone_lookup=${phoneHash} and state='active'
      and (expires_at is null or expires_at>clock_timestamp())) as authorization_id`;
  if (!access || access.pilot === "blocked" || policy === "disabled") return null;
  const automatic = policy === "automatic_commercial" || policy === "automatic";
  const single = process.env.DEMO_CONVERSATIONAL_SINGLE_PARTICIPANT === "true";
  if ((policy === "automatic" || (automatic && single)) && access.pilot !== "allowed") return null;
  if (single) {
    const [scope] = await sql`select count(*)::int as total,
      count(distinct phone_lookup) filter (where state='allowed')::int as allowed
      from demo_pilot_participant where organization_id=${org} and channel='whatsapp'`;
    if (automatic || scope!.total > 0) {
      if (scope!.allowed !== 1 || access.pilot !== "allowed") return null;
    } else {
      const [active] = await sql`select count(*)::int as n from demo_authorization
        where organization_id=${org} and channel='whatsapp' and state='active'
        and (expires_at is null or expires_at>clock_timestamp())`;
      if (active!.n !== 1) return null;
    }
  }
  if (!automatic && !access.authorization_id) return null;
  return { automatic, authorizationId: access.authorization_id as string | null };
}

export async function ofrecerDemoWhatsApp(org: string, conversation: string, dispatch: string, sector?: string) {
  if (!canalConversacional()) throw new SimulatorError("demo_disabled", 503);
  await configuredDemoProvider(org);
  return getSql().begin(async sql => {
    await sql`select id from organization where id=${org} for update`;
    const [source] = await sql`select c.channel_thread_ref, t.wa_identity, z.account_ref, w.payload
      from dispatch d join conversation c on (c.organization_id,c.id)=(d.organization_id,d.conversation_id)
      join contact t on (t.organization_id,t.id)=(c.organization_id,c.contact_id)
      join zernio_whatsapp_credentials z on z.organization_id=c.organization_id and z.enabled
      join message m on m.organization_id=d.organization_id and m.conversation_id=c.id and d.message_ids ? m.id
      join webhook_event w on w.organization_id=d.organization_id and w.fuente='zernio_whatsapp'
        and w.payload->'message'->>'platformMessageId'=m.wa_message_id
      where d.organization_id=${org} and d.id=${dispatch} and d.conversation_id=${conversation}
        and d.scope_kind='commercial' and d.status in ('en_vuelo','entregado')
        and c.channel='whatsapp' and not c.is_test and c.ai_enabled and not t.ai_paused and c.handoff_at is null
        and c.handoff_pending_message_id is null and m.direction='in' and m.scope_kind='commercial'
        and w.payload->'conversation'->>'id'=c.channel_thread_ref
        and coalesce(w.payload->'account'->>'accountId',w.payload->'account'->>'id')=z.account_ref
        and w.created_at>clock_timestamp()-interval '5 minutes'
      order by m.wa_timestamp desc, m.id desc limit 1`;
    if (!source) throw new SimulatorError("identity_unverified", 403);
    const event = source.payload as EventoWhatsAppZernio;
    const phone = telefonoWhatsApp(event.message.sender?.phoneNumber);
    if (!phone || phone !== source.wa_identity || !permiteDespachoWhatsAppZernio(event)) throw new SimulatorError("identity_unverified", 403);
    const account = String(source.account_ref), thread = String(source.channel_thread_ref);
    const lookup = externalIdentityLookup(org, account, "phone", phone);
    const [route] = await sql`select mode from demo_identity_route where organization_id=${org} and channel='whatsapp' and identity_lookup=${lookup}`;
    if (route && route.mode !== "commercial") throw new SimulatorError("thread_unavailable");
    const available = await sql`select p.id,p.name,p.commercial_name,p.sector,p.visual_identity,v.name as assistant,v.created_by
      from demo_space p join demo_profile_version v on (v.organization_id,v.space_id,v.id)=(p.organization_id,p.id,p.current_profile_version_id)
      join member u on u.organization_id=p.organization_id and u.user_id=v.created_by and u.role in ('owner','admin')
      where p.organization_id=${org} and p.status='active' and coalesce(p.visual_identity->>'demoPolicy','supervised') <> 'disabled'
      and exists(select 1 from demo_limits l where l.organization_id=p.organization_id and l.space_id=p.id
        and l.enabled and clock_timestamp()>=l.window_start and clock_timestamp()<l.window_end) order by p.name`;
    const phoneHash = createHmac("sha256", Buffer.from(getEnv().ENCRYPTION_KEY, "base64"))
      .update(JSON.stringify(["demo-phone:v1", org, phone])).digest("hex");
    const eligible = [];
    for (const space of available) {
      const permission = await permisoConversacional(sql, org, String(space.id), phoneHash, space.visual_identity?.demoPolicy);
      if (permission) eligible.push({ space, permission });
    }
    const matches = sector ? eligible.filter(({space}) => String(space.id) === sector ||
      [space.sector,space.name,space.commercial_name,space.assistant].some(s => clave(String(s)) === clave(sector))) : [];
    if (matches.length !== 1) {
      if (sector && available.some(space => String(space.id) === sector ||
        [space.sector,space.name,space.commercial_name,space.assistant].some(s => clave(String(s)) === clave(sector))) && !matches.length)
        throw new SimulatorError("authorization_unavailable", 403);
      return { status: "choose", options: eligible.map(({space}) => ({
        id: String(space.id), sector: space.sector, demo: space.name, assistant: space.assistant,
      })) };
    }
    const { space: p, permission } = matches[0]!;

    const caps = await sql`select max_sessions_started,window_start,window_end,space_id from demo_limits
      where organization_id=${org} and (space_id is null or space_id=${p.id}) and enabled
        and window_start<=clock_timestamp() and window_end>clock_timestamp() for update`;
    if (caps.length !== 2) throw new SimulatorError("policy_required");
    for (const cap of caps) {
      const [used] = await sql`select count(*)::int as n from demo_session s
        join demo_authorization a on (a.organization_id,a.space_id,a.id)=(s.organization_id,s.space_id,s.authorization_id)
        where s.organization_id=${org} and a.phone_lookup=${phoneHash} and s.kind='external'
        and (${cap.space_id}::text is null or s.space_id=${cap.space_id})
        and s.started_at>=${cap.window_start} and s.started_at<${cap.window_end}`;
      if (used!.n >= cap.max_sessions_started) throw new SimulatorError("quota_exceeded",429);
    }

    const [prior] = await sql`select e.metadata,l.space_id from demo_whatsapp_link l join demo_session_event e
      on (e.organization_id,e.space_id,e.session_id)=(l.organization_id,l.space_id,l.web_session_id)
      where l.organization_id=${org} and l.account_ref=${account} and l.phone_lookup=${lookup}
        and l.expires_at>clock_timestamp() and l.external_session_id is null
        and e.type='whatsapp_demo_offered' and e.metadata->>'thread'=${thread}
      order by l.created_at desc limit 1`;
    if (prior) {
      if (prior.space_id !== p.id) throw new SimulatorError("offer_pending");
      return { status: "offered", message: String(prior.metadata.text) };
    }
    const { id } = await simulatorCommand({ organizationId: org, userId: String(p.created_by) },
      { action: "start", spaceId: String(p.id), requestKey: "wa-offer:" + dispatch },
      { tokenHash: hashCodigo(randomBytes(32).toString("base64url")) }, sql);
    const [session] = await sql`update demo_session set idle_deadline=least(idle_deadline,clock_timestamp()+interval '5 minutes') where organization_id=${org} and id=${id} returning limits_snapshot`;
    const limits = session!.limits_snapshot as { max_duration_seconds: number; max_inbound_messages: number }[];
    const seconds = Math.min(...limits.map(l => Number(l.max_duration_seconds)));
    const turns = Math.min(...limits.map(l => Number(l.max_inbound_messages)));
    const duration = seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
    const text = `Puedes probar ${p.name} con ${p.assistant} durante hasta ${duration} y ${turns} mensajes, sujeto a los límites de uso. Para cambiar de asistente, responde ACEPTO DEMO. Puedes salir escribiendo TERMINAR DEMO.`;
    const [link] = await sql`insert into demo_whatsapp_link(id,organization_id,space_id,web_session_id,account_ref,phone_lookup,challenge_hash,expires_at)
      select ${randomUUID()},s.organization_id,s.space_id,s.id,${account},${lookup},${hashCodigo(randomBytes(24).toString("base64url"))},
        least(s.expires_at,s.idle_deadline,clock_timestamp()+interval '5 minutes') from demo_session s where s.id=${id}
      on conflict(web_session_id) do nothing returning id`;
    if (!link) throw new SimulatorError("offer_expired");
    const bsuid = event.message.sender?.businessScopedUserId;
    await sql`insert into demo_session_event(id,organization_id,space_id,session_id,type,actor,reason_code,metadata)
      values(${randomUUID()},${org},${p.id},${id},'whatsapp_demo_offered','crm_nea','explicit_consent_required',
        ${JSON.stringify({ authorizationId: permission.automatic ? null : permission.authorizationId, authorizationOrigin: permission.automatic ? "automatic_policy" : "administrator", thread, conversation, text, alias: bsuid ? externalIdentityLookup(org, account, "bsuid", bsuid) : null })}::jsonb)`;
    return { status: "offered", message: text };
  });
}

export async function ofertaAceptada(sql: TransactionSql, org: string, account: string, event: EventoWhatsAppZernio,
  lookup: string, alias: string | null, now: Date) {
  await sql`select id from organization where id=${org} for update`;
  const [offer] = await sql`select l.challenge_hash,l.space_id,e.metadata
    from demo_whatsapp_link l join demo_session_event e on (e.organization_id,e.space_id,e.session_id)=(l.organization_id,l.space_id,l.web_session_id)
    where l.organization_id=${org} and l.account_ref=${account} and l.phone_lookup=${lookup}
    and l.external_session_id is null and l.expires_at>clock_timestamp() and e.type='whatsapp_demo_offered'
    and e.metadata->>'thread'=${event.conversation.id} order by l.created_at desc limit 1`;
  if (!offer || (offer.metadata.alias && alias && offer.metadata.alias !== alias)) return null;
  const [currentSpace] = await sql`select visual_identity from demo_space where organization_id=${org}
    and id=${offer.space_id} and status='active' for update`;
  if (!currentSpace || currentSpace.visual_identity?.demoPolicy === "disabled") return null;
  const phone = telefonoWhatsApp(event.message.sender?.phoneNumber);
  if (!phone) return null;
  const phoneHash = createHmac("sha256", Buffer.from(getEnv().ENCRYPTION_KEY, "base64"))
    .update(JSON.stringify(["demo-phone:v1", org, phone])).digest("hex");
  const permission = await permisoConversacional(sql, org, String(offer.space_id), phoneHash, currentSpace.visual_identity?.demoPolicy);
  if (!permission || permission.automatic !== (offer.metadata.authorizationOrigin === "automatic_policy") ||
      (!permission.automatic && permission.authorizationId !== offer.metadata.authorizationId)) return null;
  const [sent] = await sql`select j.updated_at at time zone 'UTC' as sent_at from zernio_whatsapp_outbox j
    join message m on (m.organization_id,m.id)=(j.organization_id,j.message_id)
    join demo_whatsapp_link l on l.organization_id=j.organization_id and l.challenge_hash=${offer.challenge_hash}
    where j.organization_id=${org} and j.conversation_id=${offer.metadata.conversation} and j.thread_ref=${event.conversation.id}
    and j.account_ref=${account} and j.status='completado' and m.scope_kind='commercial' and m.direction='out'
    and m.text=${offer.metadata.text} and m.created_at>=l.created_at order by m.created_at desc limit 1`;
  return sent && posteriorAlCorte(event.message.sentAt, new Date(sent.sent_at), now) ? offer : null;
}
