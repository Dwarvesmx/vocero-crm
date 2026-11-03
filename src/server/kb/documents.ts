import { createHash } from "node:crypto";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { saveMediaFile, readMediaFile, deleteMediaFile } from "@/server/whatsapp/media";
import { extraerDocumento, validarDocumento } from "./extract";
const match = (org: string, id: string) => and(eq(schema.kbDocument.organizationId, org), eq(schema.kbDocument.id, id));
export async function cargarDocumento(org: string, name: string, mime: string, data: Buffer) {
    const valid = validarDocumento(name, mime, data), sha256 = createHash("sha256").update(data).digest("hex"), db = getDb();
    const id = `kbd_${newId("kbEntry")}`;
    const doc = await db.transaction(async (tx) => {
        await tx.select().from(schema.organization).where(eq(schema.organization.id, org)).for("update");
        const [existing] = await tx.select().from(schema.kbDocument).where(and(eq(schema.kbDocument.organizationId, org), eq(schema.kbDocument.sha256, sha256)));
        if (existing)
            return { doc: existing, created: false };
        const [count] = await tx.select({ n: sql<number> `count(*)::int` }).from(schema.kbDocument).where(eq(schema.kbDocument.organizationId, org));
        if (count!.n >= 100)
            throw new Error("Máximo 100 documentos; elimina los que ya no uses.");
        const [created] = await tx.insert(schema.kbDocument).values({ id, organizationId: org, name: name.replace(/[\/\\\x00-\x1f]/g, "_").slice(0, 180), mime: valid.mime, sha256, sizeBytes: data.length, status: "processing", leasedUntil: new Date(Date.now() + 120000) }).returning();
        await saveMediaFile(org, id, data, valid.mime);
        return { doc: created!, created: true };
    }).catch(async (error) => { await deleteMediaFile(org, id).catch(() => { }); throw error; });
    if (!doc.created)
        return doc.doc;
    return procesar(org, id, doc.doc);
}
export async function obtenerDocumento(org: string, id: string) { return (await getDb().select().from(schema.kbDocument).where(match(org, id)))[0]; }
async function procesar(org: string, id: string, doc: typeof schema.kbDocument.$inferSelect) {
    try {
        const data = await readMediaFile(org, id);
        if (createHash("sha256").update(data).digest("hex") !== doc.sha256)
            throw new Error("Integridad incorrecta");
        const chunks = await extraerDocumento(doc.name, doc.mime, data);
        await getDb().transaction(async (tx) => {
            const [locked] = await tx.select().from(schema.kbDocument).where(match(org, id)).for("update");
            // La reserva y updatedAt son el token de esta ejecución; nunca resucitar una eliminación/reintento.
            if (!locked || locked.status !== "processing" || locked.leasedUntil?.getTime() !== doc.leasedUntil?.getTime())
                return;
            await tx.delete(schema.kbEntry).where(and(eq(schema.kbEntry.organizationId, org), eq(schema.kbEntry.documentId, id)));
            await tx.insert(schema.kbEntry).values(chunks.map((content, index) => ({ id: `${id}_${String(index).padStart(4, "0")}`, organizationId: org, documentId: id, kind: "block" as const, content })));
            await tx.update(schema.kbDocument).set({ status: "ready", error: null, leasedUntil: null, updatedAt: new Date() }).where(match(org, id));
        });
    }
    catch {
        await getDb().update(schema.kbDocument).set({ status: "error", error: "No se pudo extraer texto: comprueba PDF con texto (sin contraseña), DOCX o TXT UTF-8 y los límites indicados.", leasedUntil: null, updatedAt: new Date() }).where(and(match(org, id), eq(schema.kbDocument.status, "processing"), eq(schema.kbDocument.leasedUntil, doc.leasedUntil!)));
    }
    return (await obtenerDocumento(org, id))!;
}
export async function reintentarDocumento(org: string, id: string) {
    const [doc] = await getDb().update(schema.kbDocument).set({ status: "processing", error: null, leasedUntil: new Date(Date.now() + 120000), updatedAt: new Date() })
        .where(and(match(org, id), or(eq(schema.kbDocument.status, "error"), and(eq(schema.kbDocument.status, "processing"), lt(schema.kbDocument.leasedUntil, new Date()))))).returning();
    if (!doc)
        throw new Error("El documento no necesita recuperación o sigue procesándose.");
    return procesar(org, id, doc);
}
export async function eliminarDocumento(org: string, id: string) {
    const [doc] = await getDb().update(schema.kbDocument).set({ status: "deleting", enabled: false, updatedAt: new Date() }).where(match(org, id)).returning();
    if (!doc)
        return;
    await deleteMediaFile(org, id);
    await getDb().delete(schema.kbDocument).where(match(org, id));
}
/** Recuperación léxica en español. Solo documentos listos y habilitados de ESTA organización. */
export async function buscarDocumentos(org: string, query: string) {
    const terms = query.match(/[\p{L}\p{N}]{2,}/gu)?.slice(0, 24) ?? [];
    if (!terms.length)
        return [];
    const search = terms.join(" OR ");
    const db = getDb();
    return db.select({ documentId: schema.kbDocument.id, name: schema.kbDocument.name, chunkId: schema.kbEntry.id, text: schema.kbEntry.content })
        .from(schema.kbEntry).innerJoin(schema.kbDocument, eq(schema.kbEntry.documentId, schema.kbDocument.id))
        .where(and(eq(schema.kbEntry.organizationId, org), eq(schema.kbDocument.organizationId, org), eq(schema.kbDocument.status, "ready"), eq(schema.kbDocument.enabled, true), sql `to_tsvector('spanish',coalesce(${schema.kbEntry.content},'')) @@ websearch_to_tsquery('spanish',${search})`))
        .orderBy(sql `ts_rank(to_tsvector('spanish',coalesce(${schema.kbEntry.content},'')),websearch_to_tsquery('spanish',${search})) desc`, schema.kbEntry.id).limit(6);
}
