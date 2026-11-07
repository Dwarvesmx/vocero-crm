import {beforeAll,afterAll,it,expect,describe,vi} from "vitest";
import {createServer} from "node:http";
import {spawn} from "node:child_process";
import {resolve} from "node:path";
import {getSql} from "@/lib/db";
import {externalIdentityLookup} from "@/server/demo-center/infra/external-session";
import {POST} from "@/app/api/bot/demo/session/route";
import {resetInstanceOrgCache} from "@/server/bot/auth";
import {POST as FINANCE} from "@/app/api/bot/demo/finance/route";
vi.mock("@/server/demo-center/infra/finance",async original=>({...await original<typeof import("@/server/demo-center/infra/finance")>(),configuredDemoProvider:async()=>({quote:async()=>({model:"synthetic/model",prompt:"0.000001",completion:"0.000002",context:100000,output:512,reserve:"10"}),execute:async()=>{throw Error("Generación prohibida");},reconcile:async(id:string)=>{if(id!=="synthetic-generation")throw Error("Evidencia ajena");return {cost:"0.000005",usage:{id,total_cost:"0.000005"}};}})}));
const server=createServer(async(req,res)=>{
 try{
  if(!["/api/bot/demo/session","/api/bot/demo/finance"].includes(req.url??"")||req.method!=="POST"){res.writeHead(404);res.end();return;}
  const parts:Buffer[]=[];for await(const part of req)parts.push(Buffer.from(part));
  const response=await (req.url?.endsWith("finance")?FINANCE:POST)(new Request("http://127.0.0.1:55530"+req.url,{method:"POST",headers:req.headers as Record<string,string>,body:Buffer.concat(parts)}));
  if(req.headers['x-test-drop-ack']==='1'&&response.status===200){res.destroy();return;}
  res.writeHead(response.status,{"content-type":"application/json"});res.end(await response.text());
 }catch{res.writeHead(500);res.end();}
});
let sql:ReturnType<typeof getSql>;
function python(args:string[]){return new Promise<string>((done,reject)=>{
 const child=spawn(resolve('../tmp/nea-test-venv/Scripts/python.exe'),['-m','tests.demo_finance_http_probe',...args],{cwd:resolve('../nea-agent-dev'),env:{...process.env,DEMO_SESSION_TEST_KEY:process.env.BOT_API_KEY},windowsHide:true});
 let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>code===0?done(out):reject(Error(err)));
});}
describe.skipIf(process.env.DEMO_FINANCE_ISOLATED!=="1")('Nea → HTTP CRM → PostgreSQL sesión externa',()=>{
 beforeAll(async()=>{
  if(process.env.DATABASE_URL!=="postgres://demo@127.0.0.1:55529/demo_f2a"||process.env.APP_BASE_URL!=="http://127.0.0.1:55530")throw Error('BD insegura');
  sql=getSql();const [dir]=await sql`select current_setting('data_directory') as dir`;
  if(!String(dir!.dir).replaceAll('\\','/').endsWith('/tmp/demo-f2a02-pg'))throw Error('Clúster incorrecto');
  await sql`truncate organization,"user" cascade`;resetInstanceOrgCache();
  await sql`insert into organization(id,name) values('session-org','Ficticio')`;
  await sql`insert into "user"(id,name,email) values('session-owner','Prueba','session@example.invalid')`;
  await sql`insert into contact(id,organization_id,wa_identity,name) values('session-contact','session-org','bsuid:synthetic-participant','Ficticio')`;
  await sql`insert into conversation(id,organization_id,contact_id) values('session-conversation','session-org','session-contact')`;
  await sql`insert into demo_space(id,organization_id,name,commercial_name,sector,status) values('session-space','session-org','Prueba','Prueba','Servicios','active')`;
  await sql`insert into demo_profile_version(id,organization_id,space_id,version,name,tone,instructions,escalation_rules,greeting,role,created_by) values('session-profile','session-org','session-space',1,'NOVA','Amable','','','','Información','session-owner')`;
  await sql`update demo_space set current_profile_version_id='session-profile' where id='session-space'`;
  await sql`insert into demo_authorization(id,organization_id,space_id,canonical_phone,phone_lookup,phone_suffix,created_by) values('session-auth','session-org','session-space','{}','synthetic-phone-lookup','0000','session-owner')`;
  const lookup=externalIdentityLookup('session-org','synthetic-account','bsuid','synthetic-participant');
  await sql`insert into demo_identity_binding(id,organization_id,space_id,channel,account_ref,identity_kind,identity_lookup,authorization_id,state,evidence_type,evidence_ref,verified_by,verified_at) values('session-binding','session-org','session-space','whatsapp','synthetic-account','bsuid',${lookup},'session-auth','verified','synthetic','synthetic-evidence','session-owner',clock_timestamp())`;
  for(const scope of [null,'session-space'])await sql`insert into demo_limits(id,organization_id,space_id,max_duration_seconds,max_idle_seconds,max_concurrent_sessions,max_sessions_started,max_inbound_messages,max_assistant_responses,max_provider_calls,budget_micro_usd,session_budget_micro_usd,window_start,window_end) values(${scope??'global'},'session-org',${scope},900,300,2,20,20,20,20,100,50,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day')`;
  await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(55530,'127.0.0.1',ok);});
 });
 afterAll(async()=>{if(server.listening)await new Promise<void>(ok=>server.close(()=>ok()));if(sql)await sql.end();});
 it('reserva y liquida mediante Nea HTTP con PostgreSQL, idempotencia y evidencia',async()=>{
  const session=JSON.parse(await python(['session']));expect(session.state).toBe('active');
  const a=JSON.parse(await python(['reserve'])),b=JSON.parse(await python(['reserve']));expect(a.operationId).toBe(b.operationId);expect(a.reservedMicroUsd).toBe('10');
  const concurrent=await Promise.all([python(['reserve']),python(['reserve'])]);for(const r of concurrent)expect(JSON.parse(r).operationId).toBe(a.operationId);
  expect(JSON.parse(await python(['conflict'])).status).toBe(409);
  expect(JSON.parse(await python(['foreign'])).status).toBe(404);
  expect(JSON.parse(await python(['settle'])).status).toBe(409);
  expect(JSON.parse(await python(['forged-cost'])).status).toBe(422);
  expect(JSON.parse(await python(['query'])).operationId).toBe(a.operationId); // nuevo cliente tras ACK perdido
  // Fixture representa evidencia registrada por el gateway de ejecución confiable, no por Nea.
  await sql`update demo_usage_operation set status='uncertain',attempted_at=clock_timestamp(),provider_request_id='synthetic-generation' where id=${a.operationId}`;
  const settled=JSON.parse(await python(['settle']));expect(settled.status).toBe('settled');expect(settled.actualMicroUsd).toBe('5');
  expect(JSON.parse(await python(['settle'])).actualMicroUsd).toBe('5');
  const [count]=await sql`select count(*)::int as n from demo_admin_audit where action='llm_settled' and target_id=${a.operationId}`;expect(count!.n).toBe(1);
  await sql`update demo_limits set budget_micro_usd=1`;
  expect(JSON.parse(await python(['second'])).status).toBe(429);
  await sql`update demo_limits set budget_micro_usd=100`;
  const release=JSON.parse(await python(['second']));expect(release.status).toBe('reserved');
  expect(JSON.parse(await python(['release'])).status).toBe('released');
  expect(JSON.parse(await python(['lost-ack'])).code).toBe('result_uncertain');
  expect(JSON.parse(await python(['lost-query'])).status).toBe('reserved');
  expect(JSON.parse(await python(['lost-release'])).status).toBe('released');
 },60000);
});
