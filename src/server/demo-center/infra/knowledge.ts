import { randomUUID } from "node:crypto";
import { eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { buscarDocumentos, cargarDocumento, reintentarDocumento } from "@/server/kb/documents";
import type { AdminActor } from "../domain/contracts";

const { demoSpace, kbDocument, kbEntry, demoAdminAudit } = schema;
export async function demoKnowledge(actor: AdminActor, space: string, query?: string) {
  const org = actor.organizationId;
  const db = getDb();
  const [exists] = await db.select({ id: demoSpace.id }).from(demoSpace)
    .where(scoped(demoSpace.organizationId, org, eq(demoSpace.id, space)));
  if (!exists) return null;
  const [documents, entries, fragments, manualResults] = await Promise.all([
    db.select().from(kbDocument).where(scoped(kbDocument.organizationId, org, eq(kbDocument.demoSpaceId, space))),
    db.select().from(kbEntry).where(scoped(kbEntry.organizationId, org, eq(kbEntry.demoSpaceId, space), isNull(kbEntry.documentId))),
    query ? buscarDocumentos(org, query, space) : [],
    query && query.match(/[\p{L}\p{N}]{2,}/gu)?.length
      ? db.select({ documentId: sql<string>`'manual'`, name: sql<string>`'Entrada manual'`,
          chunkId: kbEntry.id, text: kbEntry.content }).from(kbEntry)
        .where(scoped(kbEntry.organizationId, org, eq(kbEntry.demoSpaceId, space), isNull(kbEntry.documentId),
          sql`to_tsvector('spanish', coalesce(${kbEntry.content}, '')) @@ websearch_to_tsquery('spanish', ${(query.match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 24).join(" OR ")})`))
        .orderBy(kbEntry.id).limit(6)
      : [],
  ]);
  return { documents, entries, fragments: [...manualResults, ...fragments].slice(0, 6) };
}

export async function modifyDemoKnowledge(actor: AdminActor, space: string, command:
  { action: "manual"; content: string } | { action: "toggle"; id: string; enabled: boolean }) {
  return getDb().transaction(async tx => {
    const org = actor.organizationId;
    const [exists] = await tx.select({ id: demoSpace.id }).from(demoSpace)
      .where(scoped(demoSpace.organizationId, org, eq(demoSpace.id, space))).for("update");
    if (!exists) return false;
    const targetId = command.action === "manual" ? randomUUID() : command.id;
    if (command.action === "manual") {
      await tx.insert(kbEntry).values({ id: targetId, organizationId: org, demoSpaceId: space, kind: "block", content: command.content });
    } else {
      const [updated] = await tx.update(kbDocument).set({ enabled: command.enabled, updatedAt: new Date() })
        .where(scoped(kbDocument.organizationId, org, eq(kbDocument.demoSpaceId, space), eq(kbDocument.id, targetId)))
        .returning({ id: kbDocument.id });
      if (!updated) return false;
    }
    const requestId = randomUUID();
    await tx.insert(demoAdminAudit).values({ id: requestId, requestId, organizationId: org, spaceId: space,
      actorUserId: actor.userId, action: "knowledge_" + command.action, targetId, reasonCode: "admin_configuration", result: "success" });
    return true;
  });
}

function documentAudit(actor: AdminActor, space: string, action: string) {
  return async (tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], targetId: string) => {
    const requestId = randomUUID();
    await tx.insert(demoAdminAudit).values({ id: requestId, requestId, organizationId: actor.organizationId,
      spaceId: space, actorUserId: actor.userId, action, targetId, reasonCode: "admin_configuration", result: "success" });
  };
}

export async function uploadDemoDocument(actor: AdminActor, space: string, file: File) {
  const [exists] = await getDb().select({ id: demoSpace.id }).from(demoSpace)
    .where(scoped(demoSpace.organizationId, actor.organizationId, eq(demoSpace.id, space)));
  if (!exists) return null;
  return cargarDocumento(actor.organizationId, file.name, file.type, Buffer.from(await file.arrayBuffer()), space, documentAudit(actor, space, "knowledge_upload"));
}

export async function recoverDemoDocument(actor: AdminActor, space: string, id: string) {
  return reintentarDocumento(actor.organizationId, id, space, documentAudit(actor, space, "knowledge_recover"));
}
