import { createHash } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { saveMediaFile, readMediaFile, deleteMediaFile } from "@/server/whatsapp/media";
import { extraerDocumento, validarDocumento } from "./extract";
const documentScope = (org: string, space: string | null) => and(eq(schema.kbDocument.organizationId, org),
    space ? eq(schema.kbDocument.demoSpaceId, space) : isNull(schema.kbDocument.demoSpaceId));
const entryScope = (org: string, space: string | null) => and(eq(schema.kbEntry.organizationId, org),
    space ? eq(schema.kbEntry.demoSpaceId, space) : isNull(schema.kbEntry.demoSpaceId));
const match = (org: string, id: string, space: string | null) => and(documentScope(org, space), eq(schema.kbDocument.id, id));
type KnowledgeTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type DocumentAudit = (tx: KnowledgeTransaction, documentId: string) => Promise<void>;
export async function cargarDocumento(org: string, name: string, mime: string, data: Buffer, space: string | null = null, audit?: DocumentAudit) {
    const valid = validarDocumento(name, mime, data), sha256 = createHash("sha256").update(data).digest("hex"), db = getDb();
    const id = `kbd_${newId("kbEntry")}`;
    const doc = await db.transaction(async (tx) => {
        await tx.select().from(schema.organization).where(eq(schema.organization.id, org)).for("update");
        const [existing] = await tx.select().from(schema.kbDocument).where(and(documentScope(org, space), eq(schema.kbDocument.sha256, sha256)));
        if (existing)
            return { doc: existing, created: false };
        const [count] = await tx.select({ n: sql<number> `count(*)::int` }).from(schema.kbDocument).where(documentScope(org, space));
        if (count!.n >= 100)
            throw new Error("Máximo 100 documentos; elimina los que ya no uses.");
        const [created] = await tx.insert(schema.kbDocument).values({ id, organizationId: org, demoSpaceId: space, name: name.replace(/[\/\\\x00-\x1f]/g, "_").slice(0, 180), mime: valid.mime, sha256, sizeBytes: data.length, status: "processing", leasedUntil: new Date(Date.now() + 120000) }).returning();
        if (audit) await audit(tx, id);
        await saveMediaFile(org, id, data, valid.mime);
        return { doc: created!, created: true };
    }).catch(async (error) => { await deleteMediaFile(org, id).catch(() => { }); throw error; });
    if (!doc.created)
        return doc.doc;
    return procesar(org, id, doc.doc);
}
export async function obtenerDocumento(org: string, id: string, space: string | null = null) { return (await getDb().select().from(schema.kbDocument).where(match(org, id, space)))[0]; }
async function procesar(org: string, id: string, doc: typeof schema.kbDocument.$inferSelect) {
    const space = doc.demoSpaceId;
    try {
        const data = await readMediaFile(org, id);
        if (createHash("sha256").update(data).digest("hex") !== doc.sha256)
            throw new Error("Integridad incorrecta");
        const chunks = await extraerDocumento(doc.name, doc.mime, data);
        await getDb().transaction(async (tx) => {
            const [locked] = await tx.select().from(schema.kbDocument).where(match(org, id, space)).for("update");
            // La reserva y updatedAt son el token de esta ejecución; nunca resucitar una eliminación/reintento.
            if (!locked || locked.status !== "processing" || locked.leasedUntil?.getTime() !== doc.leasedUntil?.getTime())
                return;
            await tx.delete(schema.kbEntry).where(and(entryScope(org, space), eq(schema.kbEntry.documentId, id)));
            await tx.insert(schema.kbEntry).values(chunks.map((content, index) => ({ id: `${id}_${String(index).padStart(4, "0")}`, organizationId: org, demoSpaceId: space, documentId: id, kind: "block" as const, content })));
            await tx.update(schema.kbDocument).set({ status: "ready", error: null, leasedUntil: null, updatedAt: new Date() }).where(match(org, id, space));
        });
    }
    catch {
        await getDb().update(schema.kbDocument).set({ status: "error", error: "No se pudo extraer texto: comprueba PDF con texto (sin contraseña), DOCX o TXT UTF-8 y los límites indicados.", leasedUntil: null, updatedAt: new Date() }).where(and(match(org, id, space), eq(schema.kbDocument.status, "processing"), eq(schema.kbDocument.leasedUntil, doc.leasedUntil!)));
    }
    return (await obtenerDocumento(org, id, space))!;
}
export async function reintentarDocumento(org: string, id: string, space: string | null = null, audit?: DocumentAudit) {
    const doc = await getDb().transaction(async tx => {
        const [reserved] = await tx.update(schema.kbDocument).set({
            status: "processing", error: null, leasedUntil: new Date(Date.now() + 120000), updatedAt: new Date(),
        }).where(and(match(org, id, space), or(eq(schema.kbDocument.status, "error"),
            and(eq(schema.kbDocument.status, "processing"), lt(schema.kbDocument.leasedUntil, new Date()))))).returning();
        if (reserved && audit) await audit(tx, id);
        return reserved;
    });
    if (!doc) throw new Error("El documento no necesita recuperación o sigue procesándose.");
    return procesar(org, id, doc);
}
export async function eliminarDocumento(org: string, id: string, space: string | null = null) {
    const [doc] = await getDb().update(schema.kbDocument).set({ status: "deleting", enabled: false, updatedAt: new Date() }).where(match(org, id, space)).returning();
    if (!doc)
        return;
    await deleteMediaFile(org, id);
    await getDb().delete(schema.kbDocument).where(match(org, id, space));
}
/** Recuperación léxica en español. Solo documentos listos y habilitados de ESTA organización. */
export async function buscarDocumentos(org: string, query: string, space: string | null = null) {
    const terms = query.match(/[\p{L}\p{N}]{2,}/gu)?.slice(0, 24) ?? [];
    if (!terms.length)
        return [];
    const search = terms.join(" OR ");
    const db = getDb();
    return db.select({ documentId: schema.kbDocument.id, name: schema.kbDocument.name, chunkId: schema.kbEntry.id, text: schema.kbEntry.content })
        .from(schema.kbEntry).innerJoin(schema.kbDocument, eq(schema.kbEntry.documentId, schema.kbDocument.id))
        .where(and(entryScope(org, space), documentScope(org, space), eq(schema.kbDocument.status, "ready"), eq(schema.kbDocument.enabled, true), sql `to_tsvector('spanish',coalesce(${schema.kbEntry.content},'')) @@ websearch_to_tsquery('spanish',${search})`))
        .orderBy(sql `ts_rank(to_tsvector('spanish',coalesce(${schema.kbEntry.content},'')),websearch_to_tsquery('spanish',${search})) desc`, schema.kbEntry.id).limit(6);
}
