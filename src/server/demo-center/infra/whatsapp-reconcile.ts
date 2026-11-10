import { getSql } from "@/lib/db";
import { consultarConfirmacionesZernio } from "@/server/zernio/whatsapp-envio";

/** Solo cambia estados con una confirmación exacta de cuenta, hilo e identificador. */
export async function conciliarSalidasWhatsApp(org: string, cuenta: string, hilo: string, soloComerciales: boolean) {
  const sql = getSql();
  const salidas = await sql<{ id: string; wa_message_id: string }[]>`select m.id,m.wa_message_id from zernio_whatsapp_outbox j
    join message m on (m.organization_id,m.id,m.conversation_id)=(j.organization_id,j.message_id,j.conversation_id)
    where j.organization_id=${org} and j.account_ref=${cuenta} and j.thread_ref=${hilo} and j.status='completado'
    and (not ${soloComerciales} or m.scope_kind='commercial')
    and m.direction='out' and m.status='sent' and m.wa_message_id is not null
    order by j.updated_at desc limit 30`;
  const confirmaciones = await consultarConfirmacionesZernio({ organizationId: org, accountRef: cuenta, threadRef: hilo },
    salidas.map(salida => salida.wa_message_id));
  const definitivas = [...confirmaciones.values()].filter(estado => estado !== "sent").length;
  if (salidas.length > definitivas) console.warn("Conciliación de Zernio incompleta", { consultadas: salidas.length, definitivas });
  await Promise.all(salidas.map(async salida => {
    const estado = confirmaciones.get(salida.wa_message_id);
    if (!estado || estado === "sent") return;
    await sql`update message set status=${estado}
      where organization_id=${org} and id=${salida.id} and wa_message_id=${salida.wa_message_id}
      and direction='out' and status='sent'`;
  }));
}
