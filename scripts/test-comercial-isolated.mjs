import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

// No carga .env, no conecta clústeres existentes ni usa credenciales reales.
const parent=resolve("../tmp");mkdirSync(parent,{recursive:true});
const dir=mkdtempSync(join(parent,"comercial-pg-")),data=join(dir,"data");
const password=randomBytes(24).toString("hex"),passfile=join(dir,"init-pw");
const bin=process.env.COMERCIAL_PG_BIN??"C:/Program Files/PostgreSQL/16/bin";
const env=Object.fromEntries(["SystemRoot","WINDIR","PATH","Path","TEMP","TMP","COMSPEC","USERPROFILE","LOCALAPPDATA","APPDATA","ProgramFiles"].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const dsn=`postgres://comercial:${password}@127.0.0.1:55546/postgres`;
const local={...env,DATABASE_URL:dsn,APP_BASE_URL:"http://127.0.0.1:55547",BETTER_AUTH_SECRET:"synthetic-commercial-test-secret-only",ENCRYPTION_KEY:Buffer.alloc(32).toString("base64"),META_WEBHOOK_VERIFY_TOKEN:"synthetic-commercial-test",COMERCIAL_TEST:"1",COMERCIAL_V1_ENABLED:"true",COMERCIAL_BOT_ENABLED:"true",COMERCIAL_BOT_ORG_ID:"comercial-test",BOT_API_KEY:"synthetic-commercial-test-bot-key",NEXT_TELEMETRY_DISABLED:"1",MEDIA_DIR:join(dir,"media"),WA_MOCK_ENABLED:"1",NEA_COMERCIAL_PATH:process.env.NEA_COMERCIAL_PATH??"../nea-comercial-v1",COMERCIAL_REAL_MODEL_TEST:process.env.COMERCIAL_REAL_MODEL_TEST??"0",COMERCIAL_REAL_MODEL:process.env.COMERCIAL_REAL_MODEL??"google/gemini-3-flash-preview",COMERCIAL_REAL_CASES:process.env.COMERCIAL_REAL_CASES??""};
function ejecutar(exe,args,vars=env){const r=spawnSync(exe,args,{env:vars,stdio:"inherit",windowsHide:true,timeout:600000});if(r.error)throw r.error;if(r.status!==0)throw Error(`Falló comando local (${r.status})`);}
function pg(exe,args){ejecutar(join(bin,exe+(process.platform==="win32"?".exe":"")),args);}
writeFileSync(passfile,password+"\n",{mode:0o600,flag:"wx"});
try{pg("initdb",["-D",data,"-U","comercial","-A","scram-sha-256","--encoding=UTF8","--pwfile",passfile]);}finally{unlinkSync(passfile);}
pg("pg_ctl",["start","-w","-D",data,"-o","-h 127.0.0.1 -p 55546","-l",join(dir,"postgres.log")]);
let app;
try{
 const sql=postgres(dsn,{max:1,onnotice(){},connection:{TimeZone:"UTC"}});
 try{
  const [d]=await sql`select current_setting('data_directory') as dir`;
  if(resolve(d.dir).toLowerCase()!==data.toLowerCase())throw Error("Clúster incorrecto");
  // Ensayar transición exacta desde journal de producción versionado, sin 0044 ajeno.
  const journal=JSON.parse(readFileSync("drizzle/meta/_journal.json","utf8"));
  const base=join(dir,"base");mkdirSync(join(base,"meta"),{recursive:true});
  const entries=journal.entries.filter(e=>e.idx<44);
  writeFileSync(join(base,"meta/_journal.json"),JSON.stringify({...journal,entries}));
  for(const e of entries)writeFileSync(join(base,e.tag+".sql"),readFileSync(join("drizzle",e.tag+".sql")));
  await migrate(drizzle(sql),{migrationsFolder:base});
  await sql`insert into organization(id,name) values('sentinela','Registro previo sintético')`;
  await migrate(drizzle(sql),{migrationsFolder:resolve("drizzle")});
  await migrate(drizzle(sql),{migrationsFolder:resolve("drizzle")});
  await migrate(drizzle(sql),{migrationsFolder:base}); // Migrador del código anterior: sin downgrade.
  const [count]=await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
  const [sentinel]=await sql`select name from organization where id='sentinela'`;
  if(count.n!==45||sentinel.name!=="Registro previo sintético")throw Error("Migración no conserva base");
  console.log("Migración base 0000–0043 → 0044 comercial aplicada dos veces; migrador anterior compatible; journal 45, fila previa conservada.");
 }finally{await sql.end();}
 if(!process.argv.includes("--ui-only")){
  ejecutar(process.execPath,["node_modules/vitest/vitest.mjs","run","tests/unit/comercial-postgres.integration.test.ts","tests/unit/nav.test.ts"],local);
  ejecutar(process.execPath,["node_modules/typescript/bin/tsc","--noEmit"],local);
  ejecutar(process.execPath,["node_modules/eslint/bin/eslint.js","src/server/comercial","src/components/comercial","src/app/api/comercial","src/app/api/bot/comercial","src/app/(app)/comercial","tests/unit/comercial-postgres.integration.test.ts"],local);
 }
 if(process.argv.includes("--build"))ejecutar(process.execPath,["node_modules/next/dist/bin/next","build"],local);
 if(process.argv.includes("--browser")){
  // Base nueva de UI, auth real. No comparte prospectos con los tests del dominio.
  const create=postgres(dsn,{max:1,onnotice(){}});
  await create`create database comercial_ui`;await create.end();
  const ui={...local,DATABASE_URL:dsn.replace("/postgres","/comercial_ui"),COMERCIAL_BOT_ORG_ID:"disabled-for-ui"};
  const dbui=postgres(ui.DATABASE_URL,{max:1,onnotice(){},connection:{TimeZone:"UTC"}});
  try{await migrate(drizzle(dbui),{migrationsFolder:resolve("drizzle")});}finally{await dbui.end();}
  const logPath=join(dir,"next-local.log"),logFd=openSync(logPath,"a");
  app=spawn(process.execPath,["node_modules/next/dist/bin/next",process.argv.includes("--build")||process.argv.includes("--built")?"start":"dev","--hostname","127.0.0.1","--port","55547"],{env:ui,windowsHide:true,stdio:["ignore",logFd,logFd]});
  closeSync(logFd);
  let ready=false;
  for(let i=0;i<120;i++){if(app.exitCode!==null)throw Error("Next terminó antes de iniciar");try{const r=await fetch(local.APP_BASE_URL+"/login");if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
  if(!ready)throw Error("Next no inició");
  try{ejecutar(process.execPath,["scripts/test-comercial-browser.mjs"],ui);}catch(e){console.log(readFileSync(logPath,"utf8"));throw e;}
 }
 console.log("COMERCIAL V1: verificaciones solicitadas aprobadas; sin efectos externos.");
}finally{
 if(app){app.kill();await new Promise(r=>app.once("exit",r));}
 pg("pg_ctl",["stop","-w","-D",data,"-m","fast"]);
}
