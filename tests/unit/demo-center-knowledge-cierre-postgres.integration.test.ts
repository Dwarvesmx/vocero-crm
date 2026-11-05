import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { getSql } from "@/lib/db";
import { demoKnowledge } from "@/server/demo-center/infra/knowledge";

describe.skipIf(process.env.DEMO_CIERRE02_TEST !== "1")("Búsqueda manual aislada", () => {
  let sql: ReturnType<typeof getSql>;
  const actor = { organizationId: "cierre-org-a", userId: "cierre-actor" };
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "127.0.0.1" || url.port !== "55519" || url.pathname !== "/demo_center_cierre02") throw new Error("BD inesperada");
    sql = getSql();
    const [state] = await sql`select current_setting('data_directory') as dir`;
    if (!String(state!.dir).replaceAll("\\", "/").endsWith("/tmp/demo-center-cierre-02-pg")) throw new Error("Clúster inesperado");
    await sql`insert into organization(id,name) values ('cierre-org-a','A'),('cierre-org-b','B')`;
    await sql`insert into demo_space(id,organization_id,name,commercial_name,sector) values
      ('cierre-a','cierre-org-a','A','A','Servicios'),('cierre-b','cierre-org-a','B','B','Servicios'),
      ('cierre-c','cierre-org-b','C','C','Servicios')`;
    await sql`insert into kb_entry(id,organization_id,demo_space_id,kind,content) values
      ('cierre-entry-a','cierre-org-a','cierre-a','block','Pizza Mexicana y pepperoni'),
      ('cierre-entry-b','cierre-org-a','cierre-b','block','Pizza Mexicana distinta'),
      ('cierre-entry-c','cierre-org-b','cierre-c','block','Pizza Mexicana privada')`;
    await sql`insert into kb_document(id,organization_id,demo_space_id,name,mime,sha256,size_bytes,status,enabled) values
      ('cierre-doc-a','cierre-org-a','cierre-a','Documento','text/plain','sha-a',1,'ready',true),
      ('cierre-doc-off','cierre-org-a','cierre-a','Deshabilitado','text/plain','sha-off',1,'ready',false)`;
    await sql`insert into kb_entry(id,organization_id,demo_space_id,kind,document_id,content) values
      ('cierre-frag-a','cierre-org-a','cierre-a','block','cierre-doc-a','Pizza Mexicana documental'),
      ('cierre-frag-off','cierre-org-a','cierre-a','block','cierre-doc-off','Pizza Mexicana deshabilitada')`;
  });
  afterAll(async () => { if (sql) await sql.end(); });
  it("recupera manual y documento habilitado sin cruzar espacios u organizaciones", async () => {
    const result = await demoKnowledge(actor, "cierre-a", "Pizza Mexicana");
    expect(result?.fragments.map(item => item.chunkId).sort()).toEqual(["cierre-entry-a", "cierre-frag-a"]);
    expect((await demoKnowledge(actor, "cierre-a", "pepperoni"))?.fragments.map(item => item.chunkId)).toEqual(["cierre-entry-a"]);
    expect(await demoKnowledge(actor, "cierre-c", "Pizza")).toBeNull();
    expect((await demoKnowledge(actor, "cierre-b", "pizza"))?.fragments.map(item => item.chunkId)).toEqual(["cierre-entry-b"]);
  });
});
