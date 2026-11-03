import { beforeAll, afterAll, expect, it, describe, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { getSql } from "@/lib/db";
import { cargarDocumento, buscarDocumentos, eliminarDocumento, reintentarDocumento, obtenerDocumento } from "@/server/kb/documents";
import { readMediaFile } from "@/server/whatsapp/media";
import { renderKb } from "@/server/ai/prompts";
const session = vi.hoisted(() => ({ role: "owner", organizationId: "org_kb_v1_test" }));
vi.mock("@/lib/api", async (original) => ({ ...await original<typeof import("@/lib/api")>(), withAuth: (fn: Function) => (...args: unknown[]) => fn(session, ...args) }));
import { POST as upload } from "@/app/api/kb/documents/route";
import { GET as preview } from "@/app/api/kb/documents/[id]/route";
const enabled = process.env.VOCERO_TEST_POSTGRES === "1";
const org = "org_kb_v1_test";
vi.mock("@/server/bot/auth", () => ({ requireBotKey: () => null, resolveInstanceOrg: async () => org }));
import { POST as search } from "@/app/api/bot/knowledge/route";
describe.skipIf(!enabled)("Documentos en PostgreSQL y almacenamiento aislados", () => {
    let sql: ReturnType<typeof getSql>;
    const ids: string[] = [];
    beforeAll(async () => {
        const u = new URL(process.env.DATABASE_URL!);
        if (u.hostname !== "127.0.0.1" || u.pathname !== "/vocero_zernio_test" || !process.env.MEDIA_DIR?.includes("kb-v1-test-media"))
            throw new Error("Entorno no autorizado");
        sql = getSql();
        const [identity] = await sql `select current_setting('data_directory') as dir`;
        const norm = (s: string) => s.replaceAll("\\", "/").toLowerCase();
        if (norm(identity!.dir) !== norm(process.env.VOCERO_TEST_PGDATA!))
            throw new Error("PGDATA no autorizado");
        await sql `delete from organization where id=${org}`;
        await sql `insert into organization(id,name) values(${org},'Documentos ficticios'),('org_kb_v1_other','Otro negocio ficticio') on conflict do nothing`;
    });
    afterAll(async () => { if (sql) {
        for (const id of ids)
            await eliminarDocumento(org, id);
        await sql `delete from organization where id in (${org},'org_kb_v1_other')`;
        await sql.end();
    } });
    it("persiste los tres formatos, deduplica y recupera la información para Nea", async () => {
        for (const name of ["servicios.txt", "servicios.docx", "servicios.pdf"]) {
            const data = await readFile(new URL(`../fixtures/kb-v1/${name}`, import.meta.url));
            const [a, b] = await Promise.all([cargarDocumento(org, name, "", data), cargarDocumento(org, name, "", data)]);
            ids.push(a.id);
            expect(a.id).toBe(b.id);
            expect((await obtenerDocumento(org, a.id))!.status).toBe("ready");
            expect(await readMediaFile(org, a.id)).toEqual(data);
        }
        const response = await search(new Request("http://localhost/api/bot/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "¿Cuál es el precio del mantenimiento?" }) }));
        expect(response.status).toBe(200);
        expect((await response.json()).chunks[0].text).toContain("1200");
        expect(await buscarDocumentos("org_kb_v1_other", "mantenimiento")).toEqual([]);
        const chunks = await sql `select * from kb_entry where organization_id=${org}`;
        expect(chunks.length).toBe(3);
        expect(renderKb(chunks.map(c => ({ documentId: c.document_id, ...c })) as never)).toBe("(knowledge base vacío)");
    });
    it("deshabilitación inmediata, recuperación tras caída y eliminación de archivo/fragmentos", async () => {
        const id = ids[0]!;
        await sql `update kb_document set enabled=false where id=${id}`;
        expect(await buscarDocumentos(org, "4500")).toHaveLength(0);
        await sql `update kb_document set enabled=true,status='processing',leased_until=now()+interval '1 minute' where id=${id}`;
        await expect(reintentarDocumento(org, id)).rejects.toThrow();
        await sql `update kb_document set leased_until=now()-interval '1 second' where id=${id}`;
        const recovered = await reintentarDocumento(org, id);
        expect(recovered.status).toBe("ready");
        expect((await sql `select count(*)::int n from kb_entry where document_id=${id}`)[0]!.n).toBe(1);
        await sql `update kb_document set status='error' where id=${id}`;
        const result = await Promise.allSettled([reintentarDocumento(org, id), reintentarDocumento(org, id)]);
        expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
        expect((await sql `select count(*)::int n from kb_entry where document_id=${id}`)[0]!.n).toBe(1);
        await eliminarDocumento(org, id);
        expect(await obtenerDocumento(org, id)).toBeUndefined();
        expect(await sql `select id from kb_entry where document_id=${id}`).toHaveLength(0);
        await expect(readMediaFile(org, id)).rejects.toThrow();
    });
    it("errores de extracción quedan durables y no se recuperan como conocimiento", async () => {
        const data = await readFile(new URL("../fixtures/kb-v1/sin-texto.pdf", import.meta.url));
        const doc = await cargarDocumento(org, "sin-texto.pdf", "", data);
        ids.push(doc.id);
        expect(doc.status).toBe("error");
        expect(doc.error).toBeTruthy();
        expect((await reintentarDocumento(org, doc.id)).status).toBe("error");
        expect(await buscarDocumentos(org, "sin-texto")).toEqual([]);
    });
    it("la API protege administración, aísla la vista previa y reutiliza el documento", async () => {
        const bytes = await readFile(new URL("../fixtures/kb-v1/servicios.pdf", import.meta.url));
        const request = () => { const form = new FormData(); form.append("file", new File([new Uint8Array(bytes)], "servicios.pdf", { type: "application/pdf" })); return new Request("http://localhost/api/kb/documents", { method: "POST", body: form }); };
        session.role = "member";
        expect((await upload(request())).status).toBe(403);
        session.role = "owner";
        const response = await upload(request());
        expect(response.status).toBe(201);
        const doc = (await response.json()).document;
        const context = { params: Promise.resolve({ id: doc.id }) };
        expect((await (await preview(new Request("http://localhost"), context)).json()).preview).toContain("1200");
        session.organizationId = "org_kb_v1_other";
        try {
            expect((await preview(new Request("http://localhost"), context)).status).toBe(404);
        }
        finally {
            session.organizationId = org;
        }
    });
});
