import {beforeAll,afterAll,it,expect,describe,vi} from "vitest";
import {createServer} from "node:http";
import {spawn} from "node:child_process";
import {resolve} from "node:path";
import {getSql} from "@/lib/db";
import {externalIdentityLookup} from "@/server/demo-center/infra/external-session";
import {POST} from "@/app/api/bot/demo/session/route";
import {resetInstanceOrgCache} from "@/server/bot/auth";
import {POST as GENERATE} from "@/app/api/bot/demo/generate/route";
import {POST as FINANCE} from "@/app/api/bot/demo/finance/route";
vi.mock("@/server/demo-center/infra/finance",async original=>({...await original<typeof import("@/server/demo-center/infra/finance")>(),configuredDemoProvider:async()=>({quote:async()=>({model:"synthetic/model",prompt:"0.000001",completion:"0.000002",context:100000,output:512,reserve:"10"}),execute:async(messages: Array<{role:string;content:string}>)=>{const joined=JSON.stringify(messages);if(joined.includes("fallo incierto"))throw Error("synthetic timeout");expect(joined).not.toContain('Lukas privado');if(joined.includes('segunda'))expect(joined).toContain('respuesta uno');return {id:'synthetic-generation',text:joined.includes('segunda')?'respuesta dos':'respuesta uno',cost:'0.000005',usage:{cost:'0.000005'},model:'synthetic/model'};},reconcile:async(id:string)=>{if(id!=="synthetic-generation")throw Error("Evidencia ajena");return {cost:"0.000005",usage:{id,total_cost:"0.000005"}};}})}));
const server=createServer(async(req,res)=>{
 try{
  if(!["/api/bot/demo/session","/api/bot/demo/finance","/api/bot/demo/generate"].includes(req.url??"")||req.method!=="POST"){res.writeHead(404);res.end();return;}
  const parts:Buffer[]=[];for await(const part of req)parts.push(Buffer.from(part));
  const response=await (req.url?.endsWith("generate")?GENERATE:req.url?.endsWith("finance")?FINANCE:POST)(new Request("http://127.0.0.1:55530"+req.url,{method:"POST",headers:req.headers as Record<string,string>,body:Buffer.concat(parts)}));
  if(req.headers['x-test-drop-ack']==='1'&&response.status===200){res.destroy();return;}
  res.writeHead(response.status,{"content-type":"application/json"});res.end(await response.text());
 }catch{res.writeHead(500);res.end();}
});
let sql:ReturnType<typeof getSql>;
function python(args:string[]){return new Promise<string>((done,reject)=>{
 const child=spawn(resolve('../tmp/nea-test-venv/Scripts/python.exe'),['-m','tests.demo_generation_probe',...args],{cwd:resolve('../nea-agent-dev'),env:{...process.env,DEMO_SESSION_TEST_KEY:process.env.BOT_API_KEY},windowsHide:true});
 let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>code===0?done(out):reject(Error(err)));
});}
describe.skipIf(process.env.DEMO_FINANCE_ISOLATED!=="1")('Nea → HTTP CRM → PostgreSQL sesión externa',()=>{
 beforeAll(async()=>{
  if(process.env.DATABASE_URL!=="postgres://demo@127.0.0.1:55529/demo_f2a"||process.env.APP_BASE_URL!=="http://127.0.0.1:55530")throw Error('BD insegura');
  sql=getSql();const [dir]=await sql`select current_setting('data_directory') as dir`;
  if(!String(dir!.dir).replaceAll('\\','/').endsWith('/tmp/demo-f2a02-pg'))throw Error('Clúster incorrecto');
  await sql.unsafe("DO $$ BEGIN IF to_regclass('nea_demo_generation.dispatch_inbox') IS NOT NULL THEN TRUNCATE nea_demo_generation.dispatch_inbox; END IF; END $$");
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
 it('consumidor durable Nea genera, liquida y conserva contexto sin Lukas',async()=>{
  const a=JSON.parse(await python(['one']));expect(a.status).toBe('settled');expect(a.text).toBe('respuesta uno');
  const repeat=JSON.parse(await python(['one']));expect(repeat.operationId).toBe(a.operationId);
  const simultaneous=await Promise.all([python(['one']),python(['one'])]);for(const r of simultaneous)expect(JSON.parse(r).operationId).toBe(a.operationId);
  const b=JSON.parse(await python(['two']));expect(b.text).toBe('respuesta dos');
  const [ops]=await sql`select count(*)::int as n,sum(actual_amount)::text as cost from demo_usage_operation`;expect(ops!.n).toBe(2);expect(ops!.cost).toBe('10');
  const [turns]=await sql`select count(*)::int as n from demo_simulation_turn`;expect(turns!.n).toBe(2);
  const [commercial]=await sql`select count(*)::int as n from message`;expect(commercial!.n).toBe(0);
  const parallel=JSON.parse(await python(['parallel']));expect(parallel.status).toBe('settled');
  const [afterParallel]=await sql`select count(*)::int as n from demo_usage_operation`;expect(afterParallel!.n).toBe(3);
  const uncertain=JSON.parse(await python(['uncertain']));expect(uncertain.status).toBe('uncertain');expect(uncertain.text).toBeNull();
  expect(JSON.parse(await python(['uncertain'])).operationId).toBe(uncertain.operationId);
  const [pending]=await sql`select count(*)::int as n from demo_usage_operation where status='uncertain'`;expect(pending!.n).toBe(1);
  await expect(python(['scope-mismatch'])).rejects.toThrow();
  const [afterMismatch]=await sql`select count(*)::int as n from demo_usage_operation`;expect(afterMismatch!.n).toBe(4);
  await sql`update demo_authorization set state='revoked' where id='session-auth'`;
  await expect(python(['revoked'])).rejects.toThrow();
 },90000);
});
