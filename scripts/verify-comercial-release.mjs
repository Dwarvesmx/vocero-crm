import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const base="f66a58965963748cbe2575043dd4ffb85e64bbd4";
const git=(...args)=>execFileSync("git",args,{encoding:"utf8"}).trim();
const original=JSON.parse(git("show",`${base}:drizzle/meta/_journal.json`));
const journal=JSON.parse(readFileSync("drizzle/meta/_journal.json","utf8"));
assert.deepEqual(journal.entries.slice(0,44),original.entries);
assert.equal(journal.entries.length,45);
assert.equal(journal.entries[44].tag,"0044_comercial_v1");
for(const e of original.entries){
 const file=`drizzle/${e.tag}.sql`;
 const old=execFileSync("git",["show",`${base}:${file}`]);
 // Git Windows puede convertir saltos CRLF: el migrador calcula el hash de los bytes.
 const actual=Buffer.from(readFileSync(file,"utf8").replaceAll("\r\n","\n"));
 assert.equal(createHash("sha256").update(actual).digest("hex"),createHash("sha256").update(old).digest("hex"),file);
}
assert.equal(git("diff",base,"--","package.json","pnpm-lock.yaml","Dockerfile","vocero-entrypoint.sh","scripts/migrate.mjs"),"");
const sql=readFileSync("drizzle/0044_comercial_v1.sql","utf8");
assert.ok(!/DROP\s|ALTER TABLE\s+"(?!comercial_)/i.test(sql));
console.log("Base de producción: "+base+"; 44 SQL normalizados LF y journal previos idénticos; solo 0044_comercial_v1 aditiva; dependencias/arranque intactos.");
