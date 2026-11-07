import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { ventanaCoalesceMs, type FilaDespacho } from "./outbox";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Usa el índice de conversación viva; el conflicto no aborta la transacción. */
export async function encolarEnTransaccion(tx: Tx, organizationId: string, conversationId: string, ids: string[]) {
  const now = new Date();
  const due = new Date(now.getTime() + ventanaCoalesceMs());
  await tx.execute(sql`insert into dispatch
    (id, organization_id, conversation_id, status, not_before, first_message_at, last_message_at, message_ids)
    values (${newId("dispatch")}, ${organizationId}, ${conversationId}, 'pendiente',
      ${due.toISOString()}::timestamp, ${now.toISOString()}::timestamp, ${now.toISOString()}::timestamp, ${JSON.stringify(ids)}::jsonb)
    on conflict (conversation_id) where scope_kind='commercial' and status in ('pendiente', 'en_vuelo')
    do update set message_ids = coalesce(dispatch.message_ids, '[]'::jsonb) || excluded.message_ids,
      not_before = case when dispatch.status='en_vuelo' then dispatch.not_before else excluded.not_before end,
      last_message_at = excluded.last_message_at, updated_at = excluded.last_message_at`);
}

/** Cierra el trabajo y preserva sus mensajes posteriores en el MISMO commit. */
export async function finalizarConPendientes(fila: FilaDespacho, entregados: string[]) {
  return getDb().transaction(async (tx) => {
    const [actual] = await tx.select().from(schema.dispatch).where(and(
      eq(schema.dispatch.id, fila.id), eq(schema.dispatch.status, "en_vuelo"),
      eq(schema.dispatch.attempts, fila.attempts),
    )).for("update");
    if (!actual) return false;
    const pendientes = [...new Set(actual.messageIds ?? [])].filter((id) => !entregados.includes(id));
    await tx.update(schema.dispatch).set({ status: "entregado", leasedUntil: null, lastError: null, updatedAt: new Date() })
      .where(eq(schema.dispatch.id, fila.id));
    if (pendientes.length) await encolarEnTransaccion(tx, fila.organizationId, fila.conversationId, pendientes);
    return true;
  });
}
