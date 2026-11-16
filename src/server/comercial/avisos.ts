import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";

/** Solo eventos nuevos: nunca deduce avisos de cotizaciones históricas. */
export async function prepararAvisosComerciales() {
  if (process.env.COMERCIAL_V1_ENABLED !== "true" || process.env.ZERNIO_WHATSAPP_ENABLED !== "true") return;
  await getSql().begin(async sql => {
    const eventos = await sql`select * from comercial_evento where action='aviso_aprobacion'
      and data->>'estado'='pendiente' order by created_at limit 20 for update skip locked`;
    for (const e of eventos) {
      const [c] = await sql`select c.*,q.version,q.aprobada_version,q.estado as quote_estado,v.snapshot,z.account_ref,z.enabled
        from comercial_cotizacion q join conversation c on c.organization_id=q.organization_id and c.id=q.conversation_id
        join comercial_version v on v.organization_id=q.organization_id and v.cotizacion_id=q.id and v.version=q.version
        left join zernio_whatsapp_credentials z on z.organization_id=c.organization_id
        where q.organization_id=${e.organization_id} and q.id=${e.cotizacion_id}`;
      let motivo = "consentimiento_no_acreditado";
      const [permiso] = await sql`select 1 from comercial_evento a join message m
        on m.id=a.data->>'mensajeAvisoId' and m.organization_id=a.organization_id
        where a.organization_id=${e.organization_id} and a.cotizacion_id=${e.cotizacion_id}
          and a.action='solicitar_aprobacion' and a.data->>'version'=${String(e.data.version)}
          and m.conversation_id=${e.data.conversationId} and m.direction='in' and m.scope_kind='commercial'`;
      if (permiso) {
        motivo = !c || c.contact_id!==e.data.contactId || c.id!==e.data.conversationId || c.version!==e.data.version || c.aprobada_version!==c.version || c.quote_estado!=='aprobada' ? "version_no_vigente" :
          c.channel!=='whatsapp' || c.is_test || !c.enabled || !c.channel_thread_ref ? "canal_no_disponible" :
          !c.ai_enabled || c.handoff_at || c.handoff_pending_message_id ? "atencion_humana" :
          !c.last_inbound_at || Date.now()-new Date(c.last_inbound_at).getTime()>=86400000 ? "ventana_cerrada_sin_plantilla" : "";
      }
      if (motivo) {
        await sql`update comercial_evento set data=data||${JSON.stringify({estado:'bloqueado',motivo})}::jsonb where id=${e.id}`;
        continue;
      }
      const key=`comercial-aviso:${e.cotizacion_id}:${e.data.version}:${c!.contact_id}`;
      const snapshot=c!.snapshot;
      const money=(n:number)=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(n/100);
      const text=`Tu cotización ${e.cotizacion_id}, versión ${e.data.version}, fue aprobada. `+
        snapshot.conceptos.map((l:{cantidad:number;producto:{nombre:string;caracteristicas:string[];exclusiones:string[];condiciones:string}})=>`${l.cantidad} × ${l.producto.nombre}: ${l.producto.caracteristicas.join('; ')}. Excluye: ${l.producto.exclusiones.join('; ')}. ${l.producto.condiciones}`).join('\n')+
        `. Pago único: ${money(snapshot.unico)}; mensual: ${money(snapshot.mensual)}. ${snapshot.condiciones} `+
        "Lukas puede continuar contigo: ¿aceptas esta propuesta? La aprobación no confirma contratación ni pago.";
      if (text.length>4096) {
        await sql`update comercial_evento set data=data||'{"estado":"bloqueado","motivo":"alcance_excede_limite_del_canal"}'::jsonb where id=${e.id}`;
        continue;
      }
      const message=randomUUID(),job=randomUUID();
      await sql`insert into message(id,organization_id,conversation_id,direction,type,text,status,origin,ai_generated)
        values(${message},${e.organization_id},${c!.id},'out','text',${text},'pending','operator',false)`;
      await sql`insert into zernio_whatsapp_outbox(id,organization_id,conversation_id,message_id,account_ref,thread_ref,request_key,status)
        values(${job},${e.organization_id},${c!.id},${message},${c!.account_ref},${c!.channel_thread_ref},${key},'pendiente')`;
      await sql`update comercial_evento set data=data||${JSON.stringify({estado:'encolado',motivo:null,messageId:message,jobId:job})}::jsonb where id=${e.id}`;
    }
  });
}

/** Se ejecuta antes de CADA intento; nunca concede extensión de ventana. */
export async function autorizarIntentoAviso(id:string) {
  if (process.env.COMERCIAL_V1_ENABLED !== 'true' || process.env.ZERNIO_WHATSAPP_ENABLED !== 'true') return false;
  const [ok]=await getSql()`select j.id from zernio_whatsapp_outbox j
    join comercial_evento e on e.organization_id=j.organization_id and e.data->>'jobId'=j.id and e.action='aviso_aprobacion'
    join conversation c on c.organization_id=j.organization_id and c.id=j.conversation_id
    join comercial_cotizacion q on q.organization_id=e.organization_id and q.id=e.cotizacion_id
    join zernio_whatsapp_credentials z on z.organization_id=j.organization_id and z.account_ref=j.account_ref
    where j.id=${id} and z.enabled and c.channel='whatsapp' and not c.is_test and c.ai_enabled
      and c.handoff_at is null and c.handoff_pending_message_id is null and c.channel_thread_ref=j.thread_ref
      and c.contact_id=e.data->>'contactId' and c.id=e.data->>'conversationId' and q.contact_id=c.contact_id
      and c.last_inbound_at>clock_timestamp()-interval '24 hours' and c.last_inbound_at<=clock_timestamp()
      and q.version=(e.data->>'version')::integer and q.aprobada_version=q.version and q.estado='aprobada'
      and not exists(select 1 from demo_whatsapp_link l
        join demo_session s on s.organization_id=l.organization_id and s.id=l.external_session_id
        join demo_identity_route r on r.organization_id=l.organization_id and r.channel='whatsapp' and r.identity_lookup=l.phone_lookup
        where s.organization_id=c.organization_id and s.conversation_id=c.id and r.mode<>'commercial')
      and exists(select 1 from comercial_evento a where a.organization_id=e.organization_id
        and a.cotizacion_id=e.cotizacion_id and a.action='solicitar_aprobacion'
        and a.data->>'version'=e.data->>'version' and a.data->>'mensajeAvisoId' is not null)
      and not exists(select 1 from demo_session s where s.organization_id=c.organization_id and s.conversation_id=c.id and s.kind='external' and s.state='active')`;
  return Boolean(ok);
}
