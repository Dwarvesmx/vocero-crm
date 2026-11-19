import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import type { Snapshot } from "./contracts";
import conciliacion from "./catalogo-conciliacion-v3.json";

const moneda = new Intl.NumberFormat("es-MX", {
  style: "currency", currency: "MXN", trailingZeroDisplay: "stripIfInteger",
});
const fichaWeb = conciliacion.find(item => item.id === "web")?.campos;
const condicionGeneral = "Aplican las condiciones de cada concepto del catálogo adjunto.";

function extracto(texto: string | null | undefined, maximo: number) {
  const limpio = texto?.replace(/\s+/gu, " ").trim();
  // Conserva frases completas. Los importes salen de los campos aprobados.
  return limpio && limpio.length <= maximo &&
    !/[\u0000-\u001f*_`~$]|\bestado\s*:|\b(?:v\d+|mxn|pesos|precio\s+desde|mensualidad\w*|pago\s+[úu]nico|sin\s+costo|gratis|administrativ\w*)\b/iu.test(limpio)
    ? limpio : null;
}

export function formatearAvisoAprobacion(id: string, version: number, snapshot: Snapshot): string {
  const { unico, mensual, conceptos, especial, condiciones, promocion } = snapshot;
  const referencia = `*Referencia* ${id.slice(0, 8)} · versión ${version}`;
  const importes = [
    [unico, snapshot.subtotalUnico, snapshot.ajusteUnico, promocion?.descuento ?? 0],
    [mensual, snapshot.subtotalMensual, snapshot.ajusteMensual, 0],
  ];
  if (importes.some(([total, subtotal, ajuste, descuento]) =>
    typeof total !== "number" || !Number.isSafeInteger(total) || total < 0 ||
    (Number.isSafeInteger(subtotal) && Number.isSafeInteger(ajuste) && total !== subtotal! + ajuste! - descuento!)
  ) || (promocion && snapshot.ajusteUnico !== undefined && snapshot.ajusteUnico !== 0)) {
    return [
      "¡Hola! Tu cotización fue aprobada.", referencia,
      "Los importes de esta versión no coinciden. Lukas puede ayudarte a revisarlos antes de continuar.",
      "La aprobación no implica contratación ni pago.",
    ].join("\n\n");
  }

  const alcances = [
    ...conceptos.map(({ cantidad, producto }) => ({
      texto: producto.nombre, prefijo: cantidad > 1 ? `${cantidad} × ` : "",
    })),
    ...(snapshot.pendientes ?? []).filter(item => item.estado === "incluido" || item.estado === "cotizado")
      .map(item => ({ texto: item.descripcion, prefijo: "" })),
  ];
  const nombres = alcances.flatMap(({ texto, prefijo }) => {
    const nombre = extracto(texto, 64);
    return nombre ? [prefijo + nombre] : [];
  });
  const productoWeb = conceptos[0]?.producto;
  // La síntesis se aplica solo a la ficha conocida y sin alcance adicional.
  const webPropuesta = conceptos.length === 1 && conceptos[0]?.cantidad === 1 && productoWeb?.id === "web" &&
    !especial && !promocion && !snapshot.pendientes?.length && condiciones === condicionGeneral && fichaWeb &&
    productoWeb.condiciones === fichaWeb.condiciones?.antes &&
    JSON.stringify(productoWeb.caracteristicas) === JSON.stringify(fichaWeb.caracteristicas?.antes) &&
    JSON.stringify(productoWeb.exclusiones) === JSON.stringify(fichaWeb.exclusiones?.antes);
  const alcance = extracto(especial, 140);
  const condicion = condiciones !== condicionGeneral ? extracto(condiciones, 140) : null;
  const detalle = webPropuesta
    ? "*Incluye*\n• Una página informativa adaptable a celular y computadora.\n• Contacto por WhatsApp y hasta cinco secciones. La quinta requiere confirmar disponibilidad."
    : alcance ? `Alcance aprobado: ${alcance}` : null;
  const terminos = webPropuesta
    ? "*Condiciones*\nDominio básico y alojamiento propuestos por 12 meses, por confirmar antes de contratar. La renovación se informa por separado."
    : ["*Condiciones*", condicion, "Puedes revisar todos los detalles de la versión aprobada con Lukas antes de contratar."].filter(Boolean).join("\n");

  return [
    "¡Hola! Tu cotización fue aprobada. ✅",
    `*${nombres.slice(0, 2).join(" · ") || "Tu propuesta"}*\n${referencia}`,
    `*Pago único* ${moneda.format(unico! / 100)} MXN\n*Mensualidad* ${moneda.format(mensual! / 100)} MXN`,
    detalle, terminos,
    "La aprobación no implica contratación ni pago.\n\n¿Aceptas esta propuesta para que Lukas te ayude a continuar con la contratación?",
  ].filter(Boolean).join("\n\n");
}

/** Solo eventos nuevos: nunca deduce avisos de cotizaciones históricas. */
export async function prepararAvisosComerciales() {
  if (process.env.COMERCIAL_V1_ENABLED !== "true" || process.env.ZERNIO_WHATSAPP_ENABLED !== "true") return;
  await getSql().begin(async sql => {
    const eventos = await sql`select * from comercial_evento where action='aviso_aprobacion'
      and data->>'estado'='pendiente' order by created_at limit 20 for update skip locked`;
    for (const e of eventos) {
      const [c] = await sql`select c.*,q.version,q.aprobada_version,q.estado as quote_estado,v.snapshot,z.account_ref,z.enabled,
        coalesce(c.last_inbound_at>clock_timestamp()-interval '24 hours' and c.last_inbound_at<=clock_timestamp(),false) as ventana_abierta
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
          !c.ventana_abierta ? "ventana_cerrada_sin_plantilla" : "";
      }
      if (motivo) {
        await sql`update comercial_evento set data=data||${JSON.stringify({estado:'bloqueado',motivo})}::jsonb where id=${e.id}`;
        continue;
      }
      const key=`comercial-aviso:${e.cotizacion_id}:${e.data.version}:${c!.contact_id}`;
      const text = formatearAvisoAprobacion(e.cotizacion_id, e.data.version, c!.snapshot);
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
export async function motivoBloqueoAviso(id:string) {
  if (process.env.COMERCIAL_V1_ENABLED !== 'true' || process.env.ZERNIO_WHATSAPP_ENABLED !== 'true') return 'emisor_desactivado';
  const [decision]=await getSql()`select case
    when not coalesce(z.enabled,false) or c.channel<>'whatsapp' or c.is_test or c.channel_thread_ref is distinct from j.thread_ref then 'canal_no_disponible'
    when not c.ai_enabled or c.handoff_at is not null or c.handoff_pending_message_id is not null then 'atencion_humana'
    when c.contact_id is distinct from e.data->>'contactId' or c.id is distinct from e.data->>'conversationId'
      or q.contact_id is distinct from c.contact_id or q.conversation_id is distinct from c.id then 'destinatario_no_vigente'
    when q.version<>(e.data->>'version')::integer or q.aprobada_version is distinct from q.version or q.estado<>'aprobada' then 'version_no_vigente'
    when c.last_inbound_at is null or c.last_inbound_at<=clock_timestamp()-interval '24 hours' or c.last_inbound_at>clock_timestamp() then 'ventana_cerrada_sin_plantilla'
    when exists(select 1 from demo_whatsapp_link l
      join demo_session s on s.organization_id=l.organization_id and s.id=l.external_session_id
      join demo_identity_route r on r.organization_id=l.organization_id and r.channel='whatsapp' and r.identity_lookup=l.phone_lookup
      where s.organization_id=c.organization_id and s.conversation_id=c.id and r.mode<>'commercial')
      or exists(select 1 from demo_session s where s.organization_id=c.organization_id and s.conversation_id=c.id and s.kind='external' and s.state='active') then 'ambito_no_comercial'
    when not exists(select 1 from comercial_evento a join message m on m.organization_id=a.organization_id
      and m.id=a.data->>'mensajeAvisoId' and m.conversation_id=c.id and m.direction='in' and m.scope_kind='commercial'
      where a.organization_id=e.organization_id and a.cotizacion_id=e.cotizacion_id and a.action='solicitar_aprobacion'
        and a.data->>'version'=e.data->>'version') then 'consentimiento_no_acreditado'
    end as motivo from zernio_whatsapp_outbox j
    join comercial_evento e on e.organization_id=j.organization_id and e.data->>'jobId'=j.id and e.action='aviso_aprobacion'
    join conversation c on c.organization_id=j.organization_id and c.id=j.conversation_id
    join comercial_cotizacion q on q.organization_id=e.organization_id and q.id=e.cotizacion_id
    left join zernio_whatsapp_credentials z on z.organization_id=j.organization_id and z.account_ref=j.account_ref
    where j.id=${id}`;
  return decision ? decision.motivo as string | null : 'aviso_no_encontrado';
}
