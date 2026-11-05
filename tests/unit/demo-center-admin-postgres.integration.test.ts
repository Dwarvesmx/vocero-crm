import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getSql } from "@/lib/db";
import { GET as knowledge, POST as writeKnowledge } from "@/app/api/demo-center/knowledge/route";
import { GET as commercialDocuments } from "@/app/api/kb/documents/route";
import { buscarDocumentos, eliminarDocumento } from "@/server/kb/documents";
import { POST as policy } from "@/app/api/demo-center/policy/route";
import { GET, POST } from "@/app/api/demo-center/route";

const session = vi.hoisted(() => ({ userId: "demo-f1-actor", organizationId: "demo-f1-a", role: "owner" }));
vi.mock("@/lib/auth/session", async original => ({
  ...await original<typeof import("@/lib/auth/session")>(),
  requireSession: async () => session,
}));

describe.skipIf(process.env.VOCERO_DEMO_F1_TEST !== "1")("Fundamentos administrativos en PostgreSQL", () => {
  let sql: ReturnType<typeof getSql>;
  const request = (data: object) => new Request("http://localhost/api/demo-center", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
  });
  const docs: { id: string; space: string }[] = [];
  const read = (id: string) => GET(new Request("http://localhost/api/demo-center?id=" + id));
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "127.0.0.1" || url.port !== "55489" || url.pathname !== "/demo_center_f1") {
      throw new Error("Base de pruebas inesperada.");
    }
    if (!process.env.MEDIA_DIR?.replaceAll("\\", "/").endsWith("/tmp/demo-center-f1-media") || process.env.MEDIA_STORE !== "local") {
      throw new Error("Almacenamiento de pruebas inesperado.");
    }
    const candidate = getSql();
    const [identity] = await candidate<{dir: string}[]>`select current_setting('data_directory') as dir`;
    if (!identity?.dir.replaceAll("\\", "/").endsWith("/tmp/demo-center-f1-pg")) {
      await candidate.end();
      throw new Error("Clúster de pruebas inesperado.");
    }
    sql = candidate;
    await sql`insert into organization(id,name) values ('demo-f1-a','Ficticia A'),('demo-f1-b','Ficticia B') on conflict do nothing`;
    await sql`insert into "user"(id,name,email) values ('demo-f1-actor','Operador ficticio','demo-f1@example.invalid') on conflict do nothing`;
  });
  afterAll(async () => {
    if (!sql) return;
    for (const doc of docs) await eliminarDocumento("demo-f1-a", doc.id, doc.space);
    await sql.begin(async tx => {
      await tx`delete from kb_entry where organization_id in ('demo-f1-a','demo-f1-b')`;
      await tx`delete from demo_authorization where organization_id in ('demo-f1-a','demo-f1-b')`;
      await tx`delete from demo_limit_exception where organization_id in ('demo-f1-a','demo-f1-b')`;
      await tx`delete from demo_limits where organization_id in ('demo-f1-a','demo-f1-b')`;
      await tx`delete from demo_admin_audit where organization_id in ('demo-f1-a','demo-f1-b')`;
      await tx`update demo_space set current_profile_version_id=null where organization_id in ('demo-f1-a','demo-f1-b')`;
      await tx`delete from demo_profile_version where organization_id in ('demo-f1-a','demo-f1-b')`;
      await tx`delete from demo_space where organization_id in ('demo-f1-a','demo-f1-b')`;
    });
    await sql.end();
  });

  it("aísla espacios y perfiles, publica versiones y registra cambios", async () => {
    async function create(name: string) {
      const res = await POST(request({ action: "create", space: {
        name, commercialName: name, sector: "Servicios", description: "Ejemplo ficticio",
        visualIdentity: { color: "#123456" },
      } }));
      expect(res.status).toBe(201);
      return (await res.json()).id as string;
    }
    const a = await create("Ficticio A");
    const b = await create("Ficticio B");
    const publish = (id: string, generation: number, instructions: string) => POST(request({
      action: "publishProfile", id, expectedGeneration: generation,
      profile: { name: "Asistente", tone: "", instructions, escalationRules: "", greeting: "", role: "Información", tools: [] },
    }));
    expect((await publish(a, 1, "Contenido A")).status).toBe(200);
    expect((await publish(a, 1, "Cambio obsoleto")).status).toBe(409);
    expect((await publish(a, 2, "Versión posterior")).status).toBe(200);
    expect((await publish(b, 1, "Contenido B")).status).toBe(200);
    const detail = await (await read(a)).json();
    expect(detail.profiles.map((p: { instructions: string }) => p.instructions)).toEqual(["Versión posterior", "Contenido A"]);
    expect(detail.audit).toHaveLength(3);
    const url = (space: string) => "http://localhost/api/demo-center/knowledge?space=" + space;
    async function upload(space: string) {
      const form = new FormData();
      form.set("file", new File(["Ornitorrinco ficticio"], "ficticio.txt", { type: "text/plain" }));
      const res = await writeKnowledge(new Request(url(space), { method: "POST", headers: { "x-demo-center": "1" }, body: form }));
      expect(res.status).toBe(201);
      const { document } = await res.json();
      docs.push({ id: document.id, space });
      expect(document.status).toBe("ready");
      return document;
    }
    const [docA, docB] = await Promise.all([upload(a), upload(b)]);
    expect(docA.sha256).toBe(docB.sha256);
    expect(docA.id).not.toBe(docB.id);
    expect((await buscarDocumentos("demo-f1-a", "ornitorrinco", a)).map(item => item.documentId)).toEqual([docA.id]);
    expect(await buscarDocumentos("demo-f1-a", "ornitorrinco")).toEqual([]);
    expect((await (await commercialDocuments()).json()).documents).toEqual([]);
    expect((await (await knowledge(new Request(url(b)))).json()).documents.map((item: { id: string }) => item.id)).toEqual([docB.id]);
    expect((await writeKnowledge(new Request(url(b), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "toggle", id: docA.id, enabled: false }),
    }))).status).toBe(404);
    const authorized = await POST(request({ action: "authorize", id: a, expectedGeneration: 3, phone: "+12025550101", expiresAt: null }));
    expect(authorized.status).toBe(200);
    const auth = (await (await read(a)).json()).authorizations[0];
    expect(auth.suffix).toBe("0101");
    expect(auth.canonicalPhone).toBeUndefined();
    expect((await POST(request({ action: "revoke", id: b, expectedGeneration: 2, authorizationId: auth.id }))).status).toBe(404);
    expect((await POST(request({ action: "revoke", id: a, expectedGeneration: 4, authorizationId: auth.id }))).status).toBe(200);
    const limits = {
      maxDurationSeconds: 1800, maxIdleSeconds: 300, maxConcurrentSessions: 2, maxSessionsStarted: 5,
      maxInboundMessages: 10, maxAssistantResponses: 7, maxProviderCalls: 8,
      budgetMicroUsd: "50000", sessionBudgetMicroUsd: "20000", enabled: true,
      windowStart: "2026-11-01T00:00:00Z", windowEnd: "2026-12-01T00:00:00Z",
    };
    expect((await POST(request({ action: "limits", id: a, expectedGeneration: 5, limits: { ...limits, maxProviderCalls: -1 } }))).status).toBe(422);
    expect((await POST(request({ action: "limits", id: a, expectedGeneration: 5, limits }))).status).toBe(200);
    expect((await policy(request({ action: "globalLimits", expectedVersion: 0, limits }))).status).toBe(200);
    expect((await policy(request({ action: "globalLimits", expectedVersion: 0, limits }))).status).toBe(409);
    expect((await policy(request({ action: "budgetException", spaceId: null, extraBudgetMicroUsd: "1000",
      expiresAt: new Date(Date.now() + 3600000).toISOString(), reason: "demonstration" }))).status).toBe(200);
    await expect(sql`insert into kb_entry(id,organization_id,demo_space_id,kind,document_id)
      values ('fixture-cross-fragment','demo-f1-a',${b},'block',${docA.id})`).rejects.toMatchObject({ code: "23503" });
    const updated = await (await read(a)).json();
    expect(updated.limits.budgetMicroUsd).toBe("50000");
    expect(updated.authorizations[0].state).toBe("revoked");
    expect(updated.audit).toHaveLength(7);
    const [foreign] = await sql`select current_profile_version_id as id from demo_space where id=${b}`;
    await expect(sql`update demo_space set current_profile_version_id=${foreign!.id} where id=${a}`).rejects.toMatchObject({ code: "23503" });
    try {
      session.organizationId = "demo-f1-b";
      expect((await read(a)).status).toBe(404);
      expect((await publish(a, 3, "Cruce")).status).toBe(404);
      session.role = "member";
      expect((await read(a)).status).toBe(403);
    } finally {
      session.organizationId = "demo-f1-a";
      session.role = "owner";
    }
  });
});
