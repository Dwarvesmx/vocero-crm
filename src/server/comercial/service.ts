import { createHash, randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getSql } from "@/lib/db";
import { calcular, ComercialError, comandoSchema, enlaceSeguro, exigirAdmin, productoSchema,
  type Actor, type Comando, type Producto, type Snapshot } from "./contracts";
import { respuestaAviso, autorizacionAvisoCompleta } from "./consentimiento";
import semilla from "./catalogo-v3.json";
import cambiosConciliacion from "./catalogo-conciliacion-v3.json";
import { previsualizarCatalogo } from "./catalogo-preview";

export const comercialEnabled = () => process.env.COMERCIAL_V1_ENABLED === "true";
function habilitado() { if (!comercialEnabled()) throw new ComercialError("no_disponible",404); }
function identidad(actor: Actor) { return actor.userId ? `admin:${actor.userId}` : `bot:${actor.conversationId}`; }
async function contexto(sql: TransactionSql, actor: Actor, conversationId: string) {
  if (!actor.userId && (actor.role !== "bot" || actor.conversationId !== conversationId)) throw new ComercialError("sin_permiso",403);
  const [c] = await sql`select c.id,c.contact_id from conversation c join contact p on p.id=c.contact_id and p.organization_id=c.organization_id
    where c.organization_id=${actor.organizationId} and c.id=${conversationId} and c.is_test=false
      and not exists(select 1 from demo_session s where s.organization_id=c.organization_id and s.conversation_id=c.id and s.kind='external' and s.state='active')`;
  if (!c) throw new ComercialError("conversacion_no_disponible",404);
  return c;
}
async function catalogo(sql: TransactionSql, org: string) {
  const rows = await sql`select data from comercial_catalogo where organization_id=${org} order by id`;
  return rows.map(r => productoSchema.parse(r.data));
}
async function consentimiento(sql: TransactionSql, org:string, quote:string, version:number) {
  const [e]=await sql`select e.data,m.id as mensaje from comercial_evento e
    join comercial_cotizacion q on q.organization_id=e.organization_id and q.id=e.cotizacion_id
    join comercial_version v on v.organization_id=q.organization_id and v.cotizacion_id=q.id and v.version=${version}
    left join message m on m.organization_id=e.organization_id and m.id=e.data->>'mensajeAvisoId' and m.conversation_id=q.conversation_id
      and m.direction='in' and m.scope_kind='commercial' and m.created_at>=v.created_at and m.created_at<=clock_timestamp()
    where e.organization_id=${org} and e.cotizacion_id=${quote} and e.action='solicitar_aprobacion' and e.data->>'version'=${String(version)}
    order by (m.id is not null) desc,e.created_at desc limit 1`;
  return {registrado:Boolean(e?.mensaje),preguntaPendiente:Boolean(e)&&!e?.mensaje};
}
async function estadoCotizacion(sql:TransactionSql,org:string,q:Record<string,unknown>) {
  const [v]=await sql`select snapshot from comercial_version where organization_id=${org} and cotizacion_id=${String(q.id)} and version=${Number(q.version)}`;
  return {cotizacionId:String(q.id),negociacionId:String(q.id),version:Number(q.version),estado:String(q.estado),snapshot:v!.snapshot,
    consentimiento:await consentimiento(sql,org,String(q.id),Number(q.version))};
}

export async function comercialLeer(actor: Actor, conversationId?: string, cotizacionId?: string) {
  habilitado();
  if (actor.userId) exigirAdmin(actor);
  return getSql().begin(async sql => {
    if (!actor.userId || conversationId) await contexto(sql,actor,conversationId ?? "");
    const productos = await catalogo(sql,actor.organizationId);
    const cotizaciones = await sql`select q.*,v.snapshot from comercial_cotizacion q join comercial_version v
      on v.organization_id=q.organization_id and v.cotizacion_id=q.id and v.version=q.version
      where q.organization_id=${actor.organizationId} and (${conversationId ?? null}::text is null or q.conversation_id=${conversationId ?? null})
      and (${cotizacionId ?? null}::text is null or q.id=${cotizacionId ?? null}) order by q.created_at desc limit 100`;
    if (cotizacionId && !cotizaciones.length) throw new ComercialError("no_encontrada",404);
    for(const q of cotizaciones) q.consentimiento=await consentimiento(sql,actor.organizationId,String(q.id),Number(q.version));
    const [activa]=conversationId ? await sql`select e.cotizacion_id from comercial_evento e join comercial_cotizacion q on q.id=e.cotizacion_id and q.organization_id=e.organization_id
      where e.organization_id=${actor.organizationId} and q.conversation_id=${conversationId} and e.action='preparar' and e.data->>'mensajeOrigenId' is not null order by e.created_at desc limit 1` : [];
    const negociacionActiva=activa?.cotizacion_id??(cotizaciones.length===1?cotizaciones[0]!.id:null);
    if(conversationId){
      const [salida]=await sql`select text from message where organization_id=${actor.organizationId} and conversation_id=${conversationId} and direction='out' and scope_kind='commercial' order by created_at desc limit 1`;
      const [pregunta]=await sql`select cotizacion_id,data from comercial_evento where organization_id=${actor.organizationId} and action='solicitar_aprobacion' and data->>'conversationId'=${conversationId} order by created_at desc limit 1`;
      for(const q of cotizaciones) q.preguntaAvisoActual=Boolean(pregunta?.cotizacion_id===q.id && pregunta?.data?.version===q.version && /\baviso\b.*(?:cotizaci[oó]n|propuesta).*(?:autorizada|aprobada)/iu.test(String(salida?.text??'')));
    }
    const pedidos = await sql`select p.* from comercial_pedido p join comercial_cotizacion q on q.id=p.cotizacion_id and q.organization_id=p.organization_id
      where p.organization_id=${actor.organizationId} and (${conversationId ?? null}::text is null or q.conversation_id=${conversationId ?? null})
      and (${cotizacionId ?? null}::text is null or q.id=${cotizacionId ?? null}) order by p.created_at desc limit 100`;
    // Historial interno no se devuelve al bot: puede contener motivos administrativos.
    const eventos = actor.userId ? await sql`select * from comercial_evento where organization_id=${actor.organizationId}
      and (${cotizacionId ?? null}::text is null or cotizacion_id=${cotizacionId ?? null}) order by created_at desc limit 100` : [];
    const versiones = actor.userId && cotizacionId ? await sql`select version,snapshot,created_at from comercial_version
      where organization_id=${actor.organizationId} and cotizacion_id=${cotizacionId} order by version` : [];
    return { productos: actor.userId ? productos : productos.filter(p => p.activo), cotizaciones,
      negociacionActiva, pedidos: actor.userId ? pedidos : pedidos.map(p => ({ id:p.id,cotizacion_id:p.cotizacion_id,version:p.version,estado:p.estado,enlace:p.enlace })), eventos, versiones };
  });
}

export async function comercialEjecutar(actor: Actor, input: Comando) {
  habilitado();
  const cmd = comandoSchema.parse(input);
  if (actor.userId) exigirAdmin(actor);
  else if (!["preparar","solicitar_aprobacion","aceptar","contratar"].includes(cmd.action) ||
    actor.role !== "bot" || (cmd.action === "preparar" &&
      (cmd.propuesta.promocion !== undefined || cmd.propuesta.importeUnico !== undefined || cmd.propuesta.importeMensual !== undefined || cmd.propuesta.condiciones !== undefined ||
        cmd.propuesta.pendientes?.some(p=>p.estado!=='pendiente'||p.unico!==null||p.mensual!==null)))) {
    throw new ComercialError("sin_permiso",403);
  }
  const hash = createHash("sha256").update(JSON.stringify(cmd)).digest("hex");
  return getSql().begin(async sql => {
    // Serializa comandos y reintentos de una organización; nunca hay HTTP en la transacción.
    await sql`select id from organization where id=${actor.organizationId} for update`;
    if ("conversationId" in cmd) await contexto(sql,actor,cmd.conversationId);
    const who = identidad(actor);
    const [previo] = await sql`select hash,result from comercial_reintento where organization_id=${actor.organizationId} and actor=${who} and key=${cmd.requestKey}`;
    if (previo) {
      if (previo.hash !== hash) throw new ComercialError("clave_reutilizada");
      if(cmd.action==='preparar'||cmd.action==='solicitar_aprobacion'){
        const id=cmd.action==='preparar'?previo.result.cotizacionId:cmd.cotizacionId;
        const [actual]=await sql`select * from comercial_cotizacion where organization_id=${actor.organizationId} and conversation_id=${cmd.conversationId} and id=${id}`;
        if(!actual)throw new ComercialError('no_encontrada',404);
        if(cmd.action==='solicitar_aprobacion' && actual.version!==cmd.version)throw new ComercialError('version_desactualizada');
        return estadoCotizacion(sql,actor.organizationId,actual);
      }
      return previo.result;
    }
    let result: Record<string, unknown> = {};
    let quoteId: string | null = "cotizacionId" in cmd ? cmd.cotizacionId??null : null;
    if (cmd.action === "sembrar") {
      exigirAdmin(actor);
      for (const raw of semilla) {
        const p = productoSchema.parse(raw);
        await sql`insert into comercial_catalogo(organization_id,id,data) values(${actor.organizationId},${p.id},${JSON.stringify(p)}::text::jsonb) on conflict(organization_id,id) do nothing`;
      }
      result = { sembrado: true };
    } else if (cmd.action === "conciliar_catalogo") {
      exigirAdmin(actor);
      const actual = await catalogo(sql,actor.organizationId);
      if (JSON.stringify(actual) !== JSON.stringify(cmd.esperado)) throw new ComercialError("catalogo_modificado",409);
      const vista=previsualizarCatalogo(actual);
      const resultados: {id:string;antes:Producto|null;despues:Producto}[]=[];
      for(const cambio of cambiosConciliacion){
        const estado=vista.find(x=>x.id===cambio.id);
        const anterior=actual.find(x=>x.id===cambio.id);
        if ("nuevo" in cambio && cambio.nuevo && estado?.estado==='nuevo') {
          const siguiente=productoSchema.parse(cambio.nuevo);
          await sql`insert into comercial_catalogo(organization_id,id,data) values(${actor.organizationId},${siguiente.id},${JSON.stringify(siguiente)}::text::jsonb)`;
          resultados.push({id:siguiente.id,antes:null,despues:siguiente});
        } else if (anterior && estado?.estado === 'propuesto' && 'campos' in estado && estado.campos) {
          const siguiente:Record<string,unknown>={...anterior};
          for(const campo of estado.campos) if(campo.estado==='propuesto') siguiente[campo.campo]=campo.despues;
          if(JSON.stringify(siguiente)!==JSON.stringify(anterior)){
            const validado=productoSchema.parse(siguiente);
            await sql`update comercial_catalogo set data=${JSON.stringify(validado)}::text::jsonb,updated_at=now() where organization_id=${actor.organizationId} and id=${validado.id}`;
            resultados.push({id:validado.id,antes:anterior,despues:validado});
          }
        }
      }
      result={cambios:resultados,vista};
    } else if (cmd.action === "catalogo") {
      exigirAdmin(actor);
      await sql`insert into comercial_catalogo(organization_id,id,data) values(${actor.organizationId},${cmd.producto.id},${JSON.stringify(cmd.producto)}::text::jsonb)
        on conflict(organization_id,id) do update set data=excluded.data,updated_at=now()`;
      result = { producto: cmd.producto.id };
    } else {
      let q: Record<string, unknown> | undefined;
      if (cmd.action === 'preparar' && !actor.userId) {
        if(!cmd.mensajeOrigenId)throw new ComercialError('falta_mensaje_origen',422);
        const [origen]=await sql`select id,text,created_at from message where organization_id=${actor.organizationId} and conversation_id=${cmd.conversationId}
          and id=${cmd.mensajeOrigenId} and direction='in' and scope_kind='commercial' and created_at<=clock_timestamp()`;
        if(!origen)throw new ComercialError('mensaje_origen_invalido',422);
        const [anterior]=await sql`select q.* from comercial_evento e join comercial_cotizacion q on q.organization_id=e.organization_id and q.id=e.cotizacion_id
          where e.organization_id=${actor.organizationId} and q.conversation_id=${cmd.conversationId} and e.action='preparar'
          and e.data->>'mensajeOrigenId'=${cmd.mensajeOrigenId} order by e.created_at desc limit 1`;
        if(anterior){if(cmd.cotizacionId && cmd.cotizacionId!==anterior.id)throw new ComercialError('mensaje_origen_reutilizado',422);return estadoCotizacion(sql,actor.organizationId,anterior);}
        const todas=await sql`select * from comercial_cotizacion where organization_id=${actor.organizationId} and conversation_id=${cmd.conversationId} order by created_at desc`;
        const [activa]=await sql`select cotizacion_id from comercial_evento where organization_id=${actor.organizationId} and action='preparar'
          and data->>'conversationId'=${cmd.conversationId} and data->>'mensajeOrigenId' is not null order by created_at desc limit 1`;
        const seleccion=cmd.cotizacionId??activa?.cotizacion_id??(todas.length===1?todas[0]!.id:null);
        if(cmd.nuevaNegociacion && todas.length && !/\b(otra|otro|nueva|nuevo|segunda|segundo|distint[oa]|diferente|ahora|cambi[oa])\b/iu.test(String(origen.text)))
          throw new ComercialError('nueva_intencion_no_acreditada',422);
        if(!cmd.nuevaNegociacion && todas.length){
          q=todas.find(x=>x.id===seleccion);
          if(!q)throw new ComercialError('seleccionar_negociacion',422);
          if(!cmd.actualizarAlcance){
            const actual=await estadoCotizacion(sql,actor.organizationId,q);
            await sql`insert into comercial_evento(id,organization_id,cotizacion_id,actor,action,data) values(${randomUUID()},${actor.organizationId},${String(q.id)},${who},'preparar',${JSON.stringify(cmd)}::text::jsonb)`;
            await sql`insert into comercial_reintento(organization_id,actor,key,hash,result) values(${actor.organizationId},${who},${cmd.requestKey},${hash},${JSON.stringify(actual)}::text::jsonb)`;
            return actual;
          }
          if(cmd.version!==q.version)throw new ComercialError('version_desactualizada');
          const [vigente]=await sql`select created_at from comercial_version where organization_id=${actor.organizationId} and cotizacion_id=${String(q.id)} and version=${Number(q.version)}`;
          if(!vigente || new Date(origen.created_at).getTime()<new Date(vigente.created_at).getTime())throw new ComercialError('mensaje_anterior_a_version',422);
          if(/^(s[ií]|ok|vale|de acuerdo|s[ií][,\s]+av[ií]same)[.!\s]*$/iu.test(String(origen.text).trim()))throw new ComercialError('cambio_alcance_no_acreditado',422);
        }else if(!/cotiz|contrat|presupuesto|quiero|necesito|solicito/iu.test(String(origen.text)))throw new ComercialError('falta_solicitud_comercial',422);
      }
      if (cmd.action !== "preparar") {
        [q] = await sql`select * from comercial_cotizacion where organization_id=${actor.organizationId} and id=${cmd.cotizacionId} and conversation_id=${cmd.conversationId} for update`;
        if (!q) throw new ComercialError("no_encontrada",404);
        if (q.version !== cmd.version) throw new ComercialError("version_desactualizada");
      }
      if (cmd.action === "preparar" || cmd.action === "revisar") {
        if (q?.estado === "aceptada") throw new ComercialError("ya_aceptada");
        const snapshot = calcular(cmd.propuesta, await catalogo(sql,actor.organizationId));
        const version = q ? Number(q.version) + 1 : 1;
        quoteId = q ? String(q.id) : randomUUID();
        // Toda revisión requiere decisión nueva, incluso con precios del catálogo aprobados.
        const estado = q || snapshot.requiereAprobacion ? "pendiente" : "aprobada";
        if (!q) {
          const c = await contexto(sql,actor,cmd.conversationId);
          await sql`insert into comercial_cotizacion(id,organization_id,conversation_id,contact_id,version,estado,aprobada_version)
            values(${quoteId},${actor.organizationId},${cmd.conversationId},${String(c.contact_id)},${version},${estado},${estado === "aprobada" ? version : null})`;
        } else await sql`update comercial_cotizacion set version=${version},estado=${estado},aprobada_version=null where organization_id=${actor.organizationId} and id=${quoteId}`;
        await sql`insert into comercial_version(id,organization_id,cotizacion_id,version,snapshot) values(${randomUUID()},${actor.organizationId},${quoteId},${version},${JSON.stringify(snapshot)}::text::jsonb)`;
        result = { cotizacionId: quoteId, negociacionId:quoteId, version, estado, snapshot, consentimiento:{registrado:false,preguntaPendiente:false} };
      } else if (q) {
        quoteId = String(q.id);
        const [v] = await sql`select snapshot,created_at from comercial_version where organization_id=${actor.organizationId} and cotizacion_id=${quoteId} and version=${cmd.version}`;
        const snapshot = v!.snapshot as Snapshot;
        if (cmd.action === "decidir") {
          exigirAdmin(actor);
          if (q.estado !== "pendiente") throw new ComercialError("estado_invalido");
          if (cmd.decision === "aprobar" && (snapshot.unico === null || snapshot.mensual === null)) throw new ComercialError("importe_pendiente");
          await sql`update comercial_cotizacion set estado=${cmd.decision === "aprobar" ? "aprobada" : "rechazada"},aprobada_version=${cmd.decision === "aprobar" ? cmd.version : null}
            where organization_id=${actor.organizationId} and id=${quoteId}`;
          if (cmd.decision === "aprobar") {
            // Registrar la intención junto a la decisión, sin enviar mientras
            // no exista evidencia verificable de autorización del destinatario.
            const aviso = { version: cmd.version, conversationId: cmd.conversationId,
              contactId: q.contact_id, estado: "pendiente", motivo: "consentimiento_no_acreditado" };
            await sql`insert into comercial_evento(id,organization_id,cotizacion_id,actor,action,data)
              values(${randomUUID()},${actor.organizationId},${quoteId},'sistema','aviso_aprobacion',${JSON.stringify(aviso)}::text::jsonb)`;
          }
          result = { cotizacionId: quoteId, version: cmd.version, estado: cmd.decision === "aprobar" ? "aprobada" : "rechazada" };
        } else if (cmd.action === "solicitar_aprobacion") {
          if (!['pendiente','aprobada'].includes(String(q.estado))) throw new ComercialError("estado_invalido");
          const permiso=await consentimiento(sql,actor.organizationId,quoteId,cmd.version);
          if(permiso.registrado)return {...await estadoCotizacion(sql,actor.organizationId,q),consentimiento:permiso};
          if (cmd.mensajeAvisoId) {
            const [m] = await sql`select text,created_at from message where organization_id=${actor.organizationId}
              and conversation_id=${cmd.conversationId} and id=${cmd.mensajeAvisoId} and direction='in'
              and scope_kind='commercial' and created_at>=${v!.created_at} and created_at<=clock_timestamp()`;
            const completa=m&&autorizacionAvisoCompleta(String(m.text));
            if(!completa){
              const [pregunta]=m?await sql`select e.id from comercial_evento e where e.organization_id=${actor.organizationId} and e.cotizacion_id=${quoteId}
                and e.action='solicitar_aprobacion' and e.data->>'version'=${String(cmd.version)} and e.created_at<=${m.created_at}
                and not exists(select 1 from comercial_evento otra where otra.organization_id=e.organization_id and otra.action='solicitar_aprobacion'
                  and otra.data->>'conversationId'=${cmd.conversationId} and otra.created_at>e.created_at and otra.created_at<=${m.created_at}) limit 1`:[];
              const [salida]=m?await sql`select text from message where organization_id=${actor.organizationId} and conversation_id=${cmd.conversationId}
                and scope_kind='commercial' and direction='out' and created_at>=${v!.created_at} and created_at<=${m.created_at} order by created_at desc limit 1`:[];
              if(!m||!pregunta||!respuestaAviso(String(m.text))||
                !/\baviso\b.*(?:cotizaci[oó]n|propuesta).*(?:autorizada|aprobada)/iu.test(String(salida?.text??'')))throw new ComercialError('consentimiento_no_acreditado',422);
            }
          }else if(permiso.preguntaPendiente)return await estadoCotizacion(sql,actor.organizationId,q);
          if(cmd.mensajeAvisoId) await sql`update comercial_evento set data=data||'{"estado":"pendiente","motivo":null}'::jsonb where organization_id=${actor.organizationId} and cotizacion_id=${quoteId} and action='aviso_aprobacion' and data->>'version'=${String(cmd.version)} and data->>'estado'='bloqueado' and data->>'motivo'='consentimiento_no_acreditado' and data->>'jobId' is null`;
          result = { cotizacionId: quoteId, version: cmd.version, estado: q.estado, consentimiento:{registrado:Boolean(cmd.mensajeAvisoId),preguntaPendiente:!cmd.mensajeAvisoId} };
        } else if (cmd.action === "aceptar") {
          if (q.estado !== "aprobada" || q.aprobada_version !== cmd.version) throw new ComercialError("falta_aprobacion");
          const [m] = await sql`select m.id from message m join comercial_version v on v.organization_id=m.organization_id
            and v.cotizacion_id=${quoteId} and v.version=${cmd.version}
            where m.organization_id=${actor.organizationId} and m.conversation_id=${cmd.conversationId} and m.id=${cmd.mensajeId}
            and m.direction='in' and m.scope_kind='commercial' and m.created_at >= v.created_at
            and m.created_at >= coalesce((select max(created_at) from comercial_evento where organization_id=${actor.organizationId}
              and cotizacion_id=${quoteId} and action='decidir'),v.created_at)`;
          if (!m) throw new ComercialError("evidencia_aceptacion_invalida",422);
          await sql`update comercial_cotizacion set estado='aceptada',accepted_message_id=${cmd.mensajeId} where organization_id=${actor.organizationId} and id=${quoteId}`;
          result = { cotizacionId: quoteId, version: cmd.version, estado: "aceptada" };
        } else if (cmd.action === "contratar") {
          if (q.estado !== "aceptada" || q.aprobada_version !== cmd.version) throw new ComercialError("falta_aceptacion");
          await sql`insert into comercial_pedido(id,organization_id,cotizacion_id,version) values(${randomUUID()},${actor.organizationId},${quoteId},${cmd.version}) on conflict(organization_id,cotizacion_id) do nothing`;
          const [p] = await sql`select * from comercial_pedido where organization_id=${actor.organizationId} and cotizacion_id=${quoteId}`;
          result = { pedido: actor.userId ? p : { id:p!.id,cotizacion_id:p!.cotizacion_id,version:p!.version,estado:p!.estado,enlace:p!.enlace } };
        } else if (cmd.action === "pago") {
          exigirAdmin(actor);
          const [p] = await sql`select * from comercial_pedido where organization_id=${actor.organizationId} and cotizacion_id=${quoteId} for update`;
          if (!p) throw new ComercialError("falta_contratacion");
          if (["pagado","cancelado"].includes(p.estado)) throw new ComercialError("pago_terminal");
          if (cmd.estado === "pagado" && !cmd.evidencia) throw new ComercialError("falta_evidencia",422);
          const enlace = cmd.enlace ? enlaceSeguro(cmd.enlace) : p.enlace;
          const evidencia = cmd.evidencia ?? p.evidencia;
          const [updated] = await sql`update comercial_pedido set estado=${cmd.estado},enlace=${enlace},evidencia=${evidencia}
            where organization_id=${actor.organizationId} and cotizacion_id=${quoteId} returning *`;
          result = { pedido: updated };
        }
      }
    }
    // Motivos de aprobación y referencias de evidencia permanecen internos.
    await sql`insert into comercial_evento(id,organization_id,cotizacion_id,actor,action,data)
      values(${randomUUID()},${actor.organizationId},${quoteId},${who},${cmd.action},${JSON.stringify(cmd)}::text::jsonb)`;
    await sql`insert into comercial_reintento(organization_id,actor,key,hash,result) values(${actor.organizationId},${who},${cmd.requestKey},${hash},${JSON.stringify(result)}::text::jsonb)`;
    return result;
  });
}
