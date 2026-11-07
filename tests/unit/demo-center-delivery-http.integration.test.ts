import {createHmac} from "node:crypto";
import {validarEventoWhatsAppZernio} from "@/server/zernio/whatsapp-evento";
import {procesarEntranteWhatsAppZernio} from "@/server/zernio/whatsapp-ingesta";
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
import {POST as DELIVERY} from "@/app/api/bot/demo/delivery/route";
import {guardarZernioWhatsApp} from "@/server/zernio/whatsapp-credenciales";
import {readDemoDelivery} from "@/server/demo-center/infra/delivery";
import {liberarSalidaZernio} from "@/server/zernio/whatsapp-autorizacion";
import {listMessages,listConversations} from "@/server/inbox/queries";
import {rafagaDe} from "@/server/brains/deliver";
import {subscribe,publish} from "@/server/events/bus";
import {MetaApiError} from "@/lib/meta/client";
const channel=vi.hoisted(()=>({sends:0,mode:'ok',confirm:false,receipts:{} as Record<string,string>}));
vi.mock("@/server/zernio/whatsapp-envio",()=>({enviarTextoWhatsAppZernio:async(input:{idempotencyKey:string;conversationId:string;cuentaAutorizada:string})=>{
 expect(input.cuentaAutorizada).toBe('synthetic-account');expect(input.conversationId).toBe('synthetic-thread');
 channel.sends++;if(channel.mode==='reject')throw new MetaApiError('synthetic rejection',{status:400});
 const id='synthetic-'+input.idempotencyKey;channel.receipts[input.idempotencyKey]=id;
 if(channel.mode==='lost')throw Error('synthetic ACK lost');return id;
},consultarConfirmacionDemoZernio:async(input:{requestKey:string})=>channel.confirm&&channel.receipts[input.requestKey]?{messageId:channel.receipts[input.requestKey],status:'delivered'}:null}));
const server=createServer(async(req,res)=>{
 try{
  if(!["/api/bot/demo/session","/api/bot/demo/finance","/api/bot/demo/generate","/api/bot/demo/delivery"].includes(req.url??"")||req.method!=="POST"){res.writeHead(404);res.end();return;}
  const parts:Buffer[]=[];for await(const part of req)parts.push(Buffer.from(part));
  const response=await (req.url?.endsWith("delivery")?DELIVERY:req.url?.endsWith("generate")?GENERATE:req.url?.endsWith("finance")?FINANCE:POST)(new Request("http://127.0.0.1:55530"+req.url,{method:"POST",headers:req.headers as Record<string,string>,body:Buffer.concat(parts)}));
  if(req.headers['x-test-drop-ack']==='1'&&response.status===200){res.destroy();return;}
  res.writeHead(response.status,{"content-type":"application/json"});res.end(await response.text());
 }catch{res.writeHead(500);res.end();}
});
let sql:ReturnType<typeof getSql>;
function python(args:string[]){return new Promise<string>((done,reject)=>{
 const child=spawn(resolve('../tmp/nea-test-venv/Scripts/python.exe'),['-m','tests.demo_delivery_probe',...args],{cwd:resolve('../nea-agent-dev'),env:{...process.env,DEMO_SESSION_TEST_KEY:process.env.BOT_API_KEY},windowsHide:true});
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
  await guardarZernioWhatsApp({organizationId:'session-org',accountRef:'synthetic-account',token:'synthetic-token',secreto:'synthetic-secret',enabled:true});
  await sql`update conversation set channel_thread_ref='synthetic-thread',last_inbound_at=clock_timestamp() where id='session-conversation'`;
  await sql`insert into message(id,organization_id,conversation_id,direction,type,text,status) values('commercial-in','session-org','session-conversation','in','text','Lukas comercial','delivered')`;
  await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(55530,'127.0.0.1',ok);});
 });
 afterAll(async()=>{if(server.listening)await new Promise<void>(ok=>server.close(()=>ok()));if(sql)await sql.end();});
 it('despacho durable, confirmación, recuperación y aislamiento comercial',async()=>{
  const events:unknown[]=[];const unsubscribe=subscribe('session-org',e=>events.push(e));
  try{
   const first=JSON.parse(await python(['one']));expect(first.delivery.status).toBe('accepted');expect(channel.sends).toBe(1);
   const [op]=await sql`select operation_key,session_id from demo_usage_operation where id=${first.operationId}`;
   const command=(action:string,text?:string,org='session-org')=>python(['receipt',op!.session_id,op!.operation_key,action,text??'',org]).then(JSON.parse);
   expect((await command('reconcile')).status).toBe('accepted');
   const receiptBody=JSON.stringify({id:'signed-receipt',event:'message.delivered',statusAt:new Date().toISOString(),account:{accountId:'synthetic-account',platform:'whatsapp'},conversation:{id:'synthetic-thread'},message:{id:'provider-local',platformMessageId:first.delivery.providerMessageId,conversationId:'synthetic-thread',platform:'whatsapp',direction:'outgoing',text:null,sentAt:new Date().toISOString()}});
   expect(validarEventoWhatsAppZernio({cuerpo:receiptBody,firma:'invalid',secreto:'synthetic-secret',cuentaAutorizada:'synthetic-account'})).toBeNull();
   const signed=validarEventoWhatsAppZernio({cuerpo:receiptBody,firma:createHmac('sha256','synthetic-secret').update(receiptBody).digest('hex'),secreto:'synthetic-secret',cuentaAutorizada:'synthetic-account'});
   const failedBody=JSON.stringify({...JSON.parse(receiptBody),id:'signed-failure',event:'message.failed'});
   const failedReceipt=validarEventoWhatsAppZernio({cuerpo:failedBody,firma:createHmac('sha256','synthetic-secret').update(failedBody).digest('hex'),secreto:'synthetic-secret',cuentaAutorizada:'synthetic-account'});
   await procesarEntranteWhatsAppZernio(failedReceipt);expect((await command('query')).status).toBe('failed');
   expect(signed).not.toBeNull();await procesarEntranteWhatsAppZernio(signed);await procesarEntranteWhatsAppZernio(signed);
   await procesarEntranteWhatsAppZernio(failedReceipt);
   expect((await command('query')).status).toBe('delivered');
   channel.confirm=true;expect((await command('reconcile')).status).toBe('delivered');expect((await command('reconcile')).status).toBe('delivered');channel.confirm=false;
   const repeated=await Promise.all([python(['one']),python(['one'])]);for(const r of repeated)expect(JSON.parse(r).delivery.deliveryId).toBe(first.delivery.deliveryId);expect(channel.sends).toBe(1);
   expect((await command('dispatch','altered')).httpStatus).toBe(409);
   await sql`update contact set wa_identity='bsuid:wrong-participant' where id='session-contact'`;
   expect((await command('dispatch',first.text)).httpStatus).toBe(403);
   await sql`update contact set wa_identity='bsuid:synthetic-participant' where id='session-contact'`;
   await sql`update conversation set channel_thread_ref='wrong-thread' where id='session-conversation'`;
   expect((await command('dispatch',first.text)).httpStatus).toBe(409);
   await sql`update conversation set channel_thread_ref='synthetic-thread' where id='session-conversation'`;expect((await command('query',undefined,'foreign-org')).httpStatus).toBe(404);
   await sql`update zernio_whatsapp_credentials set enabled=false`;
   await expect(python(['preflight'])).rejects.toThrow();expect(channel.sends).toBe(1);
   await sql`update zernio_whatsapp_credentials set enabled=true`;
   await sql.unsafe("update nea_demo_generation.dispatch_inbox set available_at=clock_timestamp()-interval '1 second' where state='started'");
   expect(JSON.parse(await python(['preflight'])).delivery.status).toBe('accepted');expect(channel.sends).toBe(2);
   channel.mode='lost';const lost=JSON.parse(await python(['lost']));expect(lost.delivery.status).toBe('uncertain');const calls=channel.sends;
   expect(JSON.parse(await python(['lost'])).delivery.status).toBe('uncertain');expect(channel.sends).toBe(calls);
   const [lostOp]=await sql`select operation_key,session_id from demo_usage_operation where id=${lost.operationId}`;
   await sql`update zernio_whatsapp_outbox set status='iniciado',leased_until=clock_timestamp()-interval '1 second' where id=${lost.delivery.deliveryId}`;
   const uncertain=JSON.parse(await python(['receipt',lostOp!.session_id,lostOp!.operation_key,'query']));expect(uncertain.status).toBe('uncertain');expect(channel.sends).toBe(calls);
   channel.confirm=true;expect(JSON.parse(await python(['receipt',lostOp!.session_id,lostOp!.operation_key,'reconcile'])).status).toBe('delivered');channel.confirm=false;
   channel.mode='reject';const failed=JSON.parse(await python(['reject']));expect(failed.delivery.status).toBe('failed');const rejectedCalls=channel.sends;
   expect(JSON.parse(await python(['reject'])).delivery.status).toBe('failed');expect(channel.sends).toBe(rejectedCalls);
   const visible=await listMessages('session-org','session-conversation');expect(visible.map(x=>x.message.id)).toEqual(['commercial-in']);
   const conversations=await listConversations('session-org');expect(conversations[0]!.preview).toBe('Lukas comercial');
   const burst=await rafagaDe('session-org','session-conversation');expect(burst.map(x=>x.id)).toEqual(['commercial-in']);
   await new Promise(ok=>setTimeout(ok,100));expect(events).toHaveLength(0);
   publish('session-org',{type:'message.new',data:{conversationId:'session-conversation',message:{id:'commercial-in'}}});
   await new Promise(ok=>setTimeout(ok,100));expect(events).toHaveLength(1);
   await sql`update zernio_whatsapp_credentials set enabled=false`;
   await expect(python(['revoked-before-send'])).rejects.toThrow();
   const [pending]=await sql`select id from zernio_whatsapp_outbox where status='retenido'`;
   await sql`update demo_authorization set state='revoked' where id='session-auth'`;
   await sql`update zernio_whatsapp_credentials set enabled=true`;
   await liberarSalidaZernio(pending!.id);expect(channel.sends).toBe(rejectedCalls);
   const [cancelled]=await sql`select status from zernio_whatsapp_outbox where id=${pending!.id}`;expect(cancelled!.status).toBe('cancelado');
   const [usage]=await sql`select count(*)::int as n,sum(actual_amount)::text as cost from demo_usage_operation`;expect(usage!.n).toBe(5);expect(usage!.cost).toBe('25');
  }finally{unsubscribe();}
 },180000);
});
