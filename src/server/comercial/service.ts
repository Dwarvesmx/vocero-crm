import { createHash, randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getSql } from "@/lib/db";
import { calcular, ComercialError, comandoSchema, enlaceSeguro, exigirAdmin, productoSchema,
  type Actor, type Comando, type Snapshot } from "./contracts";
import semilla from "./catalogo-v3.json";

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
    const pedidos = await sql`select p.* from comercial_pedido p join comercial_cotizacion q on q.id=p.cotizacion_id and q.organization_id=p.organization_id
      where p.organization_id=${actor.organizationId} and (${conversationId ?? null}::text is null or q.conversation_id=${conversationId ?? null})
      and (${cotizacionId ?? null}::text is null or q.id=${cotizacionId ?? null}) order by p.created_at desc limit 100`;
    // Historial interno no se devuelve al bot: puede contener motivos administrativos.
    const eventos = actor.userId ? await sql`select * from comercial_evento where organization_id=${actor.organizationId}
      and (${cotizacionId ?? null}::text is null or cotizacion_id=${cotizacionId ?? null}) order by created_at desc limit 100` : [];
    const versiones = actor.userId && cotizacionId ? await sql`select version,snapshot,created_at from comercial_version
      where organization_id=${actor.organizationId} and cotizacion_id=${cotizacionId} order by version` : [];
    return { productos: actor.userId ? productos : productos.filter(p => p.activo), cotizaciones,
      pedidos: actor.userId ? pedidos : pedidos.map(p => ({ id:p.id,cotizacion_id:p.cotizacion_id,version:p.version,estado:p.estado,enlace:p.enlace })), eventos, versiones };
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
    if (previo) { if (previo.hash !== hash) throw new ComercialError("clave_reutilizada"); return previo.result; }
    let result: Record<string, unknown> = {};
    let quoteId: string | null = "cotizacionId" in cmd ? cmd.cotizacionId : null;
    if (cmd.action === "sembrar") {
      exigirAdmin(actor);
      for (const raw of semilla) {
        const p = productoSchema.parse(raw);
        await sql`insert into comercial_catalogo(organization_id,id,data) values(${actor.organizationId},${p.id},${JSON.stringify(p)}::text::jsonb) on conflict(organization_id,id) do nothing`;
      }
      result = { sembrado: true };
    } else if (cmd.action === "catalogo") {
      exigirAdmin(actor);
      await sql`insert into comercial_catalogo(organization_id,id,data) values(${actor.organizationId},${cmd.producto.id},${JSON.stringify(cmd.producto)}::text::jsonb)
        on conflict(organization_id,id) do update set data=excluded.data,updated_at=now()`;
      result = { producto: cmd.producto.id };
    } else {
      let q: Record<string, unknown> | undefined;
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
        result = { cotizacionId: quoteId, version, estado, snapshot };
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
          if (q.estado !== "pendiente") throw new ComercialError("estado_invalido");
          if (cmd.mensajeAvisoId) {
            const [m] = await sql`select text from message where organization_id=${actor.organizationId}
              and conversation_id=${cmd.conversationId} and id=${cmd.mensajeAvisoId} and direction='in'
              and scope_kind='commercial' and created_at>=${v!.created_at}`;
            if (!m || !/^s[ií][,\s]+av[ií]same\s+(?:por (?:este )?whatsapp\s+)?cuando\s+(?:mi |la )?cotizaci[oó]n\s+est[eé]\s+(?:autorizada|aprobada)[.!]?$/iu.test(String(m.text).trim()))
              throw new ComercialError("consentimiento_no_acreditado",422);
          }
          result = { cotizacionId: quoteId, version: cmd.version, estado: "pendiente" };
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
