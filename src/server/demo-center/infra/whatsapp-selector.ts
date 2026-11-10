import { createHmac, randomUUID } from "node:crypto";
import type { Row, TransactionSql } from "postgres";
import { getSql } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { huellaDe } from "@/server/webhooks/eventos";
import { permiteDespachoWhatsAppZernio, type EventoWhatsAppZernio } from "@/server/zernio/whatsapp-evento";
import { consultarConfirmacionDemoZernio } from "@/server/zernio/whatsapp-envio";
import { codigoDemoWhatsApp, posteriorAlCorte, telefonoWhatsApp } from "../domain/whatsapp";
import { externalIdentityLookup, iniciarSesionWhatsApp } from "./external-session";
import { bloquearRutaWhatsApp, canalDemoWhatsApp, hashCodigo, invalidarPendientesWhatsApp } from "./whatsapp-link";
import { canalConversacional, consentimientoDemo, finDemo, ofertaAceptada } from "./whatsapp-offer";
import { encolarAvisoDemo } from "./whatsapp-notice";
import { SimulatorError } from "./simulator";

function identidad(org: string, cuenta: string, evento: EventoWhatsAppZernio) {
  const phone = telefonoWhatsApp(evento.message.sender?.phoneNumber);
  const bsuid = evento.message.sender?.businessScopedUserId;
  return {
    phone,
    lookup: phone ? externalIdentityLookup(org, cuenta, "phone", phone) : null,
    alias: bsuid && bsuid.length <= 128 ? externalIdentityLookup(org, cuenta, "bsuid", bsuid) : null,
  };
}

async function vinculos(sql: TransactionSql, org: string, cuenta: string, hilo: string, lookup: string | null, alias: string | null) {
  return sql`select l.phone_lookup,l.bsuid_lookup,l.thread_ref,s.conversation_id
    from demo_whatsapp_link l join demo_session s on (s.organization_id,s.id)=(l.organization_id,l.external_session_id)
    where l.organization_id=${org} and l.account_ref=${cuenta}
    and (l.thread_ref=${hilo} or l.phone_lookup=${lookup} or l.bsuid_lookup=${alias})
    order by l.linked_at desc`;
}

async function asignar(sql: TransactionSql, org: string, cuenta: string, evento: EventoWhatsAppZernio, challengeHash: string,
  persona: ReturnType<typeof identidad>, ahora: Date, oferta?: { metadata: Row }) {
  if (!canalDemoWhatsApp() || !permiteDespachoWhatsAppZernio(evento) || !persona.phone || !persona.lookup || !challengeHash) return;
  await sql`select id from organization where id=${org} for update`;
  const hilo = evento.conversation.id;
  const [link] = await sql`select l.*,s.actor_user_id,s.expires_at as web_expiry,s.profile_version_id,p.current_profile_version_id
    from demo_whatsapp_link l join demo_session s on (s.organization_id,s.space_id,s.id)=(l.organization_id,l.space_id,l.web_session_id)
    join demo_space p on (p.organization_id,p.id)=(l.organization_id,l.space_id)
    where l.organization_id=${org} and l.account_ref=${cuenta} and l.challenge_hash=${challengeHash}
      and l.phone_lookup=${persona.lookup} and l.external_session_id is null and l.expires_at>clock_timestamp()
      and s.kind='web' and s.state='active' and least(s.expires_at,s.idle_deadline)>clock_timestamp()
      and p.status='active' and p.current_profile_version_id is not null for update of l,s,p`;
  // El sello está redondeado a segundos. Durante el segundo de emisión basta la prueba aleatoria.
  if (!link || Date.parse(evento.message.sentAt) < Math.floor(+new Date(link.created_at) / 1000) * 1000 ||
      Date.parse(evento.message.sentAt) > +ahora) return;
  if (oferta && link.profile_version_id !== link.current_profile_version_id) throw new SimulatorError("profile_changed");
  const anteriores = await vinculos(sql, org, cuenta, hilo, persona.lookup, persona.alias);
  if (anteriores.some(l => l.phone_lookup !== persona.lookup || l.thread_ref !== hilo ||
      (l.bsuid_lookup && persona.alias && l.bsuid_lookup !== persona.alias))) return;

  const idContacto = randomUUID();
  await sql`insert into contact(id,organization_id,wa_identity,phone,name)
    values(${idContacto},${org},${persona.phone},${persona.phone},'Visitante demo')
    on conflict(organization_id,channel,wa_identity) do nothing`;
  const [contacto] = await sql`select id,ai_paused from contact where organization_id=${org} and channel='whatsapp' and wa_identity=${persona.phone}`;
  if (!contacto || contacto.ai_paused) throw new SimulatorError("contact_unavailable");
  await sql`insert into conversation(id,organization_id,contact_id,channel_thread_ref,ai_enabled)
    values(${randomUUID()},${org},${contacto.id},${hilo},${!contacto.ai_paused}) on conflict do nothing`;
  const [conv] = await sql`select * from conversation where organization_id=${org} and contact_id=${contacto.id} and not is_test for update`;
  const [ambiguo] = await sql`select id from conversation where organization_id=${org} and channel='whatsapp' and not is_test
    and channel_thread_ref=${hilo} and id<>${conv?.id ?? ""}`;
  if (!conv || ambiguo || conv.channel !== "whatsapp" || (conv.channel_thread_ref && conv.channel_thread_ref !== hilo) ||
      !conv.ai_enabled || conv.handoff_at || conv.handoff_pending_message_id) throw new SimulatorError("thread_unavailable");
  const [pendiente] = await sql`select 1 from dispatch where organization_id=${org} and conversation_id=${conv.id}
    and scope_kind='commercial' and status in ('pendiente','en_vuelo')
    union all select 1 from zernio_whatsapp_outbox where organization_id=${org} and conversation_id=${conv.id}
    and status in ('pendiente','procesando','retenido','iniciado','incierto')
    union all select 1 from zernio_whatsapp_outbox j join message m on (m.organization_id,m.id)=(j.organization_id,j.message_id)
    where j.organization_id=${org} and j.conversation_id=${conv.id} and j.status='completado'
      and m.scope_kind='commercial' and m.status not in ('delivered','read','failed')
    union all select 1 from webhook_event where organization_id=${org} and fuente='zernio_whatsapp'
    and payload->'conversation'->>'id'=${hilo} and payload->>'event'='message.received'
    and status in ('pendiente','en_proceso') limit 1`;
  if (oferta && oferta.metadata.conversation !== conv.id) throw new SimulatorError("identity_conflict");
  if (pendiente) throw new SimulatorError("thread_busy");
  await sql`update conversation set channel_thread_ref=${hilo} where id=${conv.id} and channel_thread_ref is null`;

  const [ruta] = await sql`select * from demo_identity_route where organization_id=${org} and channel='whatsapp'
    and identity_lookup=${persona.lookup} for update`;
  if (oferta && ruta && ruta.mode !== "commercial") throw new SimulatorError("thread_unavailable");
  if (ruta?.session_id) {
    await sql`update demo_session set state='superseded',ended_at=clock_timestamp()
      where organization_id=${org} and id=${ruta.session_id} and state='active'`;
    await invalidarPendientesWhatsApp(sql, org, ruta.session_id);
  }
  const phoneHash = createHmac("sha256", Buffer.from(getEnv().ENCRYPTION_KEY, "base64"))
    .update(JSON.stringify(["demo-phone:v1", org, persona.phone])).digest("hex");
  const [pilotBlock] = await sql`select 1 from demo_pilot_participant where organization_id=${org}
    and space_id=${link.space_id} and channel='whatsapp' and phone_lookup=${phoneHash} and state='blocked'`;
  if (pilotBlock) throw new SimulatorError("authorization_unavailable", 403);
  let [existente] = await sql`select * from demo_authorization where organization_id=${org} and space_id=${link.space_id}
    and channel='whatsapp' and phone_lookup=${phoneHash} and state='active' for update`;
  // Una autorización revocada por el operador no se usa. Una invitación nueva es una autorización explícita distinta.
  if (existente?.expires_at && +new Date(existente.expires_at) <= +ahora) {
    if (!oferta) throw new SimulatorError("authorization_expired");
    await sql`update demo_authorization set state='revoked',version=version+1 where organization_id=${org} and id=${existente.id}`;
    existente = undefined;
  }
  const autorizacion = String(existente?.id ?? randomUUID());
  if (!existente) await sql`insert into demo_authorization(id,organization_id,space_id,canonical_phone,phone_lookup,phone_suffix,created_by,expires_at)
    values(${autorizacion},${org},${link.space_id},${sql.typed(JSON.stringify(encryptSecret(persona.phone)),25)}::jsonb,${phoneHash},
      ${persona.phone.slice(-4)},${link.actor_user_id},${link.web_expiry})`;
  await sql`update demo_identity_binding set state='revoked',version=version+1 where organization_id=${org}
    and channel='whatsapp' and account_ref=${cuenta} and identity_lookup=${persona.lookup} and state='verified'`;
  await sql`insert into demo_identity_binding(id,organization_id,space_id,channel,account_ref,identity_kind,identity_lookup,authorization_id,
    state,evidence_type,evidence_ref,verified_by,verified_at,expires_at)
    values(${randomUUID()},${org},${link.space_id},'whatsapp',${cuenta},'phone',${persona.lookup},${autorizacion},
      'verified',${oferta ? "signed_whatsapp_consent" : "signed_whatsapp_challenge"},${evento.id},${link.actor_user_id},clock_timestamp(),${link.web_expiry})`;
  const politicas = await sql`select * from demo_limits where organization_id=${org} and (space_id is null or space_id=${link.space_id})
    order by space_id nulls first for update`;
  if (oferta) await sql`update demo_session set state='closed',ended_at=clock_timestamp() where id=${link.web_session_id}`;
  const sesion = await iniciarSesionWhatsApp(sql, org, {
    contractVersion: 1, organizationId: org, conversationId: conv.id, accountRef: cuenta,
    channel: "whatsapp", identity: { kind: "phone", value: persona.phone }, requestKey: "wa-link:" + link.id,
  }, { authorization_id: autorizacion, space_id: link.space_id, current_profile_version_id: link.current_profile_version_id,
    verified_by: link.actor_user_id }, persona.lookup, politicas, ahora, ruta);
  await sql`update demo_whatsapp_link set external_session_id=${String(sesion.sessionId)},thread_ref=${hilo},
    bsuid_lookup=${persona.alias ?? anteriores.find(l => l.bsuid_lookup)?.bsuid_lookup ?? null},
    linked_at=clock_timestamp() where id=${link.id}`;
  if (oferta?.metadata.authorizationOrigin === "automatic_policy") {
    await sql`insert into demo_session_event(id,organization_id,space_id,session_id,type,actor,reason_code)
      values(${randomUUID()},${org},${link.space_id},${String(sesion.sessionId)},'authorization_granted','crm_policy','signed_explicit_consent')`;
    const id = randomUUID();
    await sql`insert into demo_admin_audit(id,organization_id,space_id,actor_user_id,action,target_id,reason_code,request_id,result)
      values(${id},${org},${link.space_id},${link.actor_user_id},'automatic_authorization_granted',${autorizacion},'signed_explicit_consent',${id},'success')`;
  }
  if (oferta) await encolarAvisoDemo(sql, org, String(sesion.sessionId), cuenta, hilo, "started", evento.message.sentAt);
  return "linked";
}

async function encolar(sql: TransactionSql, org: string, evento: EventoWhatsAppZernio, conv: string, sesion?: Row) {
  const texto = evento.message.text?.trim();
  if (!texto) return;
  const [m] = await sql`insert into message(id,organization_id,conversation_id,wa_message_id,direction,type,text,status,wa_timestamp,
    scope_kind,demo_session_id,route_generation)
    values(${randomUUID()},${org},${conv},${evento.message.platformMessageId},'in','text',${texto},'delivered',
      ${evento.message.sentAt}::timestamptz,${sesion ? "demo" : "blocked"},${sesion?.id ?? null},${sesion?.route_generation ?? null})
    on conflict(wa_message_id) do nothing returning id`;
  if (!m || !sesion) return;
  await sql`insert into dispatch(id,organization_id,conversation_id,scope_kind,demo_session_id,route_generation,status,message_ids,
    not_before,first_message_at,last_message_at,created_at)
    values(${randomUUID()},${org},${conv},'demo',${sesion.id},${sesion.route_generation},'pendiente',${sql.typed(JSON.stringify([m.id]),25)}::jsonb,
      clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp())`;
}

async function seleccionar(sql: TransactionSql, org: string, cuenta: string, evento: EventoWhatsAppZernio, ahora: Date) {
  const persona = identidad(org, cuenta, evento);
  const codigo = codigoDemoWhatsApp(evento.message.text);
  const consentimiento = canalConversacional() && consentimientoDemo(evento.message.text);
  if (codigo !== null || consentimiento) {
    try {
      return await sql.savepoint(async tx => {
        if (consentimiento && persona.lookup && permiteDespachoWhatsAppZernio(evento)) {
          const oferta = await ofertaAceptada(tx, org, cuenta, evento, persona.lookup, persona.alias, ahora);
          if (oferta) return asignar(tx, org, cuenta, evento, oferta.challenge_hash, persona, ahora, { metadata: oferta.metadata });
        }
        if (codigo) return asignar(tx, org, cuenta, evento, hashCodigo(codigo), persona, ahora);
      }) ?? (consentimiento ? "consent_unverified" : "challenge_unverified");
    } catch (e) {
      if (!(e instanceof SimulatorError)) throw e;
      return e.code;
    }
  }
  const hilo = evento.conversation.id;
  const links = await vinculos(sql, org, cuenta, hilo, persona.lookup, persona.alias);
  const link = links[0];
  if (!link) {
    const [preexistente] = await sql`select 1 from demo_identity_route where organization_id=${org} and channel='whatsapp'
      and mode<>'commercial' and (identity_lookup=${persona.lookup} or identity_lookup=${persona.alias})`;
    const [cuentaAnterior] = await sql`select 1 from demo_whatsapp_link where organization_id=${org}
      and account_ref<>${cuenta} and thread_ref=${hilo}`;
    return preexistente || cuentaAnterior ? "unmanaged_demo_route" : "commercial";
  }
  if (links.some(l => l.phone_lookup !== link.phone_lookup || l.thread_ref !== hilo) || link.thread_ref !== hilo ||
      (persona.lookup && persona.lookup !== link.phone_lookup) ||
      (persona.alias && link.bsuid_lookup && persona.alias !== link.bsuid_lookup) ||
      !(persona.lookup === link.phone_lookup || (persona.alias && persona.alias === link.bsuid_lookup))) return "identity_conflict";
  const [r] = await sql`select * from demo_identity_route where organization_id=${org} and channel='whatsapp' and identity_lookup=${link.phone_lookup} for update`;
  if (r?.mode === "commercial" && r.blocked_since && posteriorAlCorte(evento.message.sentAt, new Date(r.blocked_since), ahora)) return "commercial";
  if (r?.mode !== "demo") {
    await encolar(sql, org, evento, link.conversation_id);
    return "blocked";
  }
  const [s] = await sql`select s.*,l.linked_at,b.expires_at as binding_expiry,a.expires_at as auth_expiry,
    a.state as auth_state,p.status as space_state,
    c.ai_enabled and not t.ai_paused and c.handoff_at is null and c.handoff_pending_message_id is null as ai_available,
    not (coalesce(p.visual_identity->>'demoPolicy','supervised')='disabled' and exists(
      select 1 from demo_session_event e where e.organization_id=s.organization_id
        and e.space_id=s.space_id and e.session_id=l.web_session_id and e.type='whatsapp_demo_offered'
    )) as policy_available
    from demo_session s join demo_whatsapp_link l on (l.organization_id,l.external_session_id)=(s.organization_id,s.id)
    join demo_authorization a on (a.organization_id,a.space_id,a.id)=(s.organization_id,s.space_id,s.authorization_id)
    join demo_identity_binding b on (b.organization_id,b.space_id,b.authorization_id)=(s.organization_id,s.space_id,a.id)
    join demo_space p on (p.organization_id,p.id)=(s.organization_id,s.space_id)
    join conversation c on (c.organization_id,c.id)=(s.organization_id,s.conversation_id)
    join contact t on (t.organization_id,t.id)=(c.organization_id,c.contact_id)
    where s.organization_id=${org} and s.id=${r.session_id} and s.conversation_id=${link.conversation_id}
    and s.route_generation=${r.generation} and l.thread_ref=${hilo} and b.state='verified' and b.account_ref=${cuenta}
    and b.identity_lookup=${link.phone_lookup} for update of s,a,p,b`;
  const vigente = s && s.state === "active" && s.auth_state === "active" && s.space_state === "active" && s.ai_available && s.policy_available &&
    [s.expires_at,s.idle_deadline,s.binding_expiry,s.auth_expiry].every(d => !d || +new Date(d) > +ahora);
  if (!vigente || !canalDemoWhatsApp()) {
    const expired = s?.state === "active" && [s.expires_at, s.idle_deadline].some(d => +new Date(d) <= +ahora);
    await bloquearRutaWhatsApp(sql, org, link.phone_lookup, r.session_id, expired ? "expired" : "revoked",
      expired ? "session_deadline" : "authorization_or_channel_unavailable");
    if (expired && canalConversacional() && permiteDespachoWhatsAppZernio(evento) && posteriorAlCorte(evento.message.sentAt, new Date(s.linked_at), ahora)) {
      await encolarAvisoDemo(sql, org, s.id, cuenta, hilo, "ended", evento.message.sentAt);
    }
    await encolar(sql, org, evento, link.conversation_id);
    return "blocked";
  }
  if (!permiteDespachoWhatsAppZernio(evento) || !posteriorAlCorte(evento.message.sentAt, new Date(s.linked_at), ahora) ||
      +ahora - Date.parse(evento.message.sentAt) >= 86400000 || !evento.message.text?.trim() || evento.message.text.trim().length > 2000) {
    await encolar(sql, org, evento, link.conversation_id);
    return "blocked";
  }
  if (canalConversacional() && finDemo(evento.message.text)) {
    await bloquearRutaWhatsApp(sql, org, link.phone_lookup, s.id, "closed", "prospect_finished");
    await encolarAvisoDemo(sql, org, s.id, cuenta, hilo, "ended", evento.message.sentAt);
    return "demo_finished";
  }
  const politicas = await sql`select * from demo_limits where organization_id=${org} and (space_id is null or space_id=${s.space_id})`;
  const snapshot = s.limits_snapshot as Row[];
  const [total] = await sql`select count(*)::int as n,max(wa_timestamp) at time zone 'UTC' as ultimo from message
    where organization_id=${org} and demo_session_id=${s.id} and direction='in'`;
  let permitido = politicas.length === 2 && snapshot.every(p => total!.n < p.max_inbound_messages) &&
    (!total!.ultimo || +new Date(total!.ultimo) <= Date.parse(evento.message.sentAt));
  for (const p of politicas) {
    const [usados] = await sql`select count(*)::int as n from message m join demo_session ds on ds.id=m.demo_session_id
      where m.organization_id=${org} and m.scope_kind='demo' and m.direction='in'
        and (${p.space_id}::text is null or ds.space_id=${p.space_id})
        and m.created_at>=${p.window_start}::timestamptz and m.created_at<${p.window_end}::timestamptz`;
    permitido &&= p.enabled && +new Date(p.window_start) <= +ahora && +new Date(p.window_end) > +ahora && usados!.n < p.max_inbound_messages;
  }
  if (canalConversacional() && !permitido && (!total!.ultimo || +new Date(total!.ultimo) <= Date.parse(evento.message.sentAt))) {
    await bloquearRutaWhatsApp(sql, org, link.phone_lookup, s.id, "closed", "inbound_quota");
    await encolarAvisoDemo(sql, org, s.id, cuenta, hilo, "ended", evento.message.sentAt);
  }
  await encolar(sql, org, evento, link.conversation_id, permitido ? s : undefined);
  return permitido ? "demo" : "quota_exceeded";
}

/** Revalida la frontera si un evento comercial o eco quedó rezagado en el worker. */
export async function resolverIngresoComercialWhatsApp(org: string, cuenta: string, evento: EventoWhatsAppZernio) {
  const entrante = evento.event === "message.received";
  const p = entrante ? identidad(org, cuenta, evento) : null;
  const hilo = evento.conversation.id;
  const rows = await getSql()`select l.account_ref,l.thread_ref,l.phone_lookup,l.bsuid_lookup,t.wa_identity,
    r.mode,r.blocked_since,clock_timestamp() as now from demo_whatsapp_link l
    join demo_session s on (s.organization_id,s.id)=(l.organization_id,l.external_session_id)
    join conversation c on (c.organization_id,c.id)=(s.organization_id,s.conversation_id)
    join contact t on (t.organization_id,t.id)=(c.organization_id,c.contact_id)
    left join demo_identity_route r on r.organization_id=l.organization_id and r.channel='whatsapp' and r.identity_lookup=l.phone_lookup
    where l.organization_id=${org} and (l.thread_ref=${hilo} or
      (l.account_ref=${cuenta} and (l.phone_lookup=${p?.lookup ?? null} or l.bsuid_lookup=${p?.alias ?? null})))
    order by l.linked_at desc`;
  const r = rows[0];
  if (!r) return { blocked: false };
  const coincide = rows.every(row => row.account_ref === cuenta && row.thread_ref === hilo && row.phone_lookup === r.phone_lookup) &&
    (!p || ((p.lookup === r.phone_lookup || (p.alias && p.alias === r.bsuid_lookup)) &&
      (!p.lookup || p.lookup === r.phone_lookup) && (!p.alias || !r.bsuid_lookup || p.alias === r.bsuid_lookup)));
  if (!coincide || r.mode !== "commercial" || !r.blocked_since ||
      !posteriorAlCorte(evento.message.sentAt, new Date(r.blocked_since), new Date(r.now))) return { blocked: true };
  return { blocked: false, phone: String(r.wa_identity) };
}

async function conciliarSalidasComerciales(org: string, cuenta: string, hilo: string) {
  const sql = getSql();
  const salidas = await sql`select m.id,m.wa_message_id,j.request_key from zernio_whatsapp_outbox j
    join message m on (m.organization_id,m.id,m.conversation_id)=(j.organization_id,j.message_id,j.conversation_id)
    where j.organization_id=${org} and j.account_ref=${cuenta} and j.thread_ref=${hilo} and j.status='completado'
    and m.scope_kind='commercial' and m.direction='out' and m.status='sent' and m.wa_message_id is not null
    order by j.updated_at desc limit 6`;
  await Promise.allSettled(salidas.map(async salida => {
    const confirmacion = await consultarConfirmacionDemoZernio({ organizationId: org, accountRef: cuenta, threadRef: hilo,
      requestKey: salida.request_key, messageId: salida.wa_message_id }, true);
    if (!confirmacion || confirmacion.messageId !== salida.wa_message_id || confirmacion.status === 'sent') return;
    await sql`update message set status=${confirmacion.status}
      where organization_id=${org} and id=${salida.id} and wa_message_id=${confirmacion.messageId}
      and scope_kind='commercial' and direction='out' and status='sent'`;
  }));
}

const conciliarAntesDeConsentir = Symbol("conciliarAntesDeConsentir");

/** El mismo commit fija ámbito, persiste el ingreso y, en demo, encola el turno. */
async function seleccionarYPersistir(org: string, cuenta: string, evento: EventoWhatsAppZernio, intentarConciliacion: boolean) {
  return getSql().begin(async sql => {
    await sql`select id from organization where id=${org} for update`;
    const [cuentaVigente] = await sql`select 1 from zernio_whatsapp_credentials where organization_id=${org} and account_ref=${cuenta} and enabled for share`;
    if (!cuentaVigente) throw new SimulatorError("account_unavailable", 503);
    const huella = huellaDe(`zernio-whatsapp-in:v1:${cuenta}:${evento.message.platformMessageId}`);
    const anterior = huellaDe(`zernio-whatsapp:${cuenta}:${evento.id}`);
    const [previo] = await sql`select id from webhook_event where huella in (${huella},${anterior})`;
    if (previo) return null;
    const [clock] = await sql`select clock_timestamp() as now`;
    const ambito = await seleccionar(sql, org, cuenta, evento, new Date(clock!.now));
    if (ambito === "thread_busy" && intentarConciliacion && consentimientoDemo(evento.message.text)) return conciliarAntesDeConsentir;
    const id = randomUUID();
    const payload = ambito === "commercial" ? evento : { account: { accountId: cuenta }, event: evento.event,
      conversation: { id: evento.conversation.id }, id: evento.id, result: ambito };
    await sql`insert into webhook_event(id,organization_id,fuente,payload,huella,status,processed_at)
      values(${id},${org},'zernio_whatsapp',${sql.typed(JSON.stringify(payload),25)}::jsonb,${huella},${ambito === "commercial" ? "pendiente" : "procesado"},
      case when ${ambito === "commercial"} then null else clock_timestamp() end)`;
    return ambito === "commercial" ? id : null;
  });
}

export async function recibirWhatsAppConSelector(org: string, cuenta: string, evento: EventoWhatsAppZernio) {
  const resultado = await seleccionarYPersistir(org, cuenta, evento, true);
  if (typeof resultado !== "symbol") return resultado;
  // Consultar al proveedor fuera de la transacción. El selector vuelve a validar el mismo evento.
  await conciliarSalidasComerciales(org, cuenta, evento.conversation.id);
  const revalidado = await seleccionarYPersistir(org, cuenta, evento, false);
  return typeof revalidado === "symbol" ? null : revalidado;
}
