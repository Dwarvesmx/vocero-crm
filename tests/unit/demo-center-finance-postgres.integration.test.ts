import { createServer } from "node:http";
import { vi } from "vitest";
import { build } from "esbuild";

import { chromium } from "playwright";

import { simulatorRead } from "@/server/demo-center/infra/simulator";

import { beforeAll,afterAll,describe,it,expect } from "vitest";

import { getSql } from "@/lib/db";

import { simulatorCommand } from "@/server/demo-center/infra/simulator";

import { realDemoSend, reconcileDemoOperation, settleDemoOperation } from "@/server/demo-center/infra/finance";

import { openRouterProvider,modelQuote, type DemoProvider } from "@/server/demo-center/infra/openrouter";



describe.skipIf(process.env.DEMO_FINANCE_TEST!=="1")("Reservas persistentes de Demo Center",()=>{

 const http=createServer((_req,res)=>{res.writeHead(404);res.end();});
 let fetchGuard:{mockRestore():void};
 let sql:ReturnType<typeof getSql>;let sessionId:string;let invocations=0;

 const actor={organizationId:"finance-org",userId:"finance-owner"};

 const quote={model:"fixture/model",prompt:"0.000001",completion:"0.000002",context:10000,output:10,reserve:"10"};

 const provider:DemoProvider={

  quote:async()=>quote,

  execute:async messages=>{

    invocations++;

    const [op]=await sql`select status from demo_usage_operation where session_id=${sessionId} order by created_at desc limit 1`;

    expect(op!.status).toBe("uncertain");

    expect(messages[0]!.content).toContain("NOVA");

    expect(JSON.stringify(messages)).toContain("Pizza Hola");

    expect(JSON.stringify(messages)).not.toContain("Casa privada");

    expect(JSON.stringify(messages)).not.toContain("Otra organización");

    expect(JSON.stringify(messages)).not.toContain("Lukas privado");

    return {id:"generation-1",text:"Respuesta real controlada",cost:"0.000005",usage:{prompt_tokens:10,completion_tokens:4,cost:0.000005},model:"fixture/model"};

  },

  reconcile:async()=>({cost:"0.000005",usage:{total_cost:0.000005}}),

 };

 beforeAll(async()=>{

  if(process.env.DEMO_FINANCE_ISOLATED!=="1" || process.env.APP_BASE_URL!=="http://127.0.0.1:55530" || process.env.OPENROUTER_API_TOKEN || process.env.BOT_API_KEY) throw Error("Usa el ejecutor aislado");
  fetchGuard=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("Red externa prohibida en pruebas"));
  await new Promise<void>((resolve,reject)=>{http.once("error",reject);http.listen(55530,"127.0.0.1",resolve);});
  const url=new URL(process.env.DATABASE_URL!);

  if(url.protocol!=="postgres:" || url.username!=="demo" || url.password || url.search || url.hash || url.hostname!=="127.0.0.1"||url.port!=="55529"||url.pathname!=="/demo_f2a")throw Error("BD insegura");

  sql=getSql();

  const [info]=await sql`select current_setting('data_directory') as dir`;

  if(!String(info!.dir).replaceAll("\\","/").endsWith("/tmp/demo-f2a02-pg"))throw Error("Clúster incorrecto");

  await sql`truncate organization,"user" cascade`;

  await sql`insert into organization(id,name) values('finance-org','Ficticio')`;

  await sql`insert into "user"(id,name,email) values('finance-owner','Prueba','finance@example.invalid')`;

  await sql`insert into demo_space(id,organization_id,name,commercial_name,sector,status) values('finance-space','finance-org','Pizza','Pizza','Restaurante','active')`;

  await sql`insert into demo_profile_version(id,organization_id,space_id,version,name,tone,instructions,escalation_rules,greeting,role,created_by)

    values('finance-profile','finance-org','finance-space',1,'NOVA','Amable','Atiende pizza','','','Información','finance-owner')`;

  await sql`update demo_space set current_profile_version_id='finance-profile' where id='finance-space'`;

  for(const space of [null,'finance-space'])await sql`insert into demo_limits(id,organization_id,space_id,max_duration_seconds,max_idle_seconds,max_concurrent_sessions,max_sessions_started,max_inbound_messages,max_assistant_responses,max_provider_calls,budget_micro_usd,session_budget_micro_usd,window_start,window_end)

    values(${space??"finance-global"},'finance-org',${space},900,300,2,50,50,50,50,100,50,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day')`;

  await sql`insert into organization(id,name) values('finance-other-org','Otra')`;

  await sql`insert into demo_space(id,organization_id,name,commercial_name,sector) values

    ('finance-other-space','finance-org','Casa','Casa','Servicios'),('finance-foreign-space','finance-other-org','Otra','Otra','Servicios')`;

  await sql`insert into kb_entry(id,organization_id,demo_space_id,kind,content) values

    ('finance-kb','finance-org','finance-space','block','Pizza Hola'),

    ('finance-kb-other','finance-org','finance-other-space','block','Hola Casa privada'),

    ('finance-kb-commercial','finance-org',null,'block','Hola Lukas privado'),

    ('finance-kb-foreign','finance-other-org','finance-foreign-space','block','Hola Otra organización')`;

  const result=await simulatorCommand(actor,{action:"start",spaceId:"finance-space",requestKey:"start"});

  sessionId=String(result.id);

 });

 afterAll(async()=>{try{if(sql)await sql.end();}finally{fetchGuard?.mockRestore();if(http.listening)await new Promise<void>((resolve,reject)=>http.close(e=>e?reject(e):resolve()));}});

 const request=(requestKey:string)=>({spaceId:"finance-space",sessionId,requestKey,text:"Hola"});

 it("reserva antes de ejecutar, liquida una vez y persiste historial",async()=>{

  await Promise.all([realDemoSend(actor,request("one"),provider),realDemoSend(actor,request("one"),provider)]);

  expect(invocations).toBe(1);

  const [op]=await sql`select * from demo_usage_operation where operation_key='one'`;

  expect(op!.status).toBe("settled");expect(String(op!.actual_amount)).toBe("5");

  await settleDemoOperation(actor,"finance-space",op!.id,"0.000005",{});

  const turns=await sql`select * from demo_simulation_turn where session_id=${sessionId}`;

  expect(turns).toHaveLength(1);

 });

 it("retiene incertidumbre y rechaza otro turno hasta conciliar",async()=>{

  const uncertain={...provider,execute:async()=>{throw Error("timeout");}};

  const result=await realDemoSend(actor,request("uncertain"),uncertain);

  expect(result.status).toBe("uncertain");

  await expect(realDemoSend(actor,request("blocked"),provider)).rejects.toMatchObject({code:"operation_pending"});

  await expect(reconcileDemoOperation(actor,"finance-space",String(result.operationId),provider)).rejects.toMatchObject({code:"generation_id_missing"});

  await sql`update demo_usage_operation set provider_request_id='known-id' where id=${result.operationId}`;

  await reconcileDemoOperation(actor,"finance-space",String(result.operationId),provider);

  await reconcileDemoOperation(actor,"finance-space",String(result.operationId),provider);

  const [op]=await sql`select status,actual_amount from demo_usage_operation where id=${result.operationId}`;

  expect(op!.status).toBe("settled");expect(String(op!.actual_amount)).toBe("5");

 });



 it("serializa reservas de sesiones distintas y conserva una reserva nunca enviada",async()=>{

  const second=await simulatorCommand(actor,{action:"start",spaceId:"finance-space",requestKey:"second-session"});

  await sql`update demo_limits set budget_micro_usd=25 where space_id is null`;

  let reached!:()=>void;const ready=new Promise<void>(resolve=>{reached=resolve;});

  let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});

  const controlled={...provider,execute:async()=>{reached();await wait;return {id:"gen-concurrent",text:"Otra respuesta",cost:"0.000005",usage:{cost:0.000005},model:"fixture/model"};}};

  const first=realDemoSend(actor,request("concurrent"),controlled);

  await ready;

  try {

    await expect(realDemoSend(actor,{...request("concurrent-other"),sessionId:String(second.id)},provider)).rejects.toMatchObject({code:"budget_exceeded"});

  } finally {release();await first;}

  await sql`update demo_limits set budget_micro_usd=100`;

  // Fallo previo a HTTP: solo reserved sin attempted_at puede liberarse.

  await sql`insert into demo_usage_operation(id,organization_id,space_id,session_id,operation_key,kind,status,reserved_amount)

    values('never-sent','finance-org','finance-space',${second.id},'never-sent','provider_call','reserved',10)`;

  await reconcileDemoOperation(actor,"finance-space","never-sent",provider);

  const [released]=await sql`select status from demo_usage_operation where id='never-sent'`;

  expect(released!.status).toBe("released");

 });

 it("rechaza presupuesto insuficiente y accesos ajenos sin invocar",async()=>{

  await sql`update demo_limits set budget_micro_usd=1`;

  await expect(realDemoSend(actor,request("over"),provider)).rejects.toMatchObject({code:"budget_exceeded"});

  expect(invocations).toBe(1);

  await expect(realDemoSend({...actor,organizationId:"finance-other-org"},request("foreign-org"),provider)).rejects.toMatchObject({code:"not_found"});

  await expect(realDemoSend({...actor,userId:"other"},request("foreign"),provider)).rejects.toMatchObject({code:"not_found"});

 });

 it("valida cotas y contrato OpenRouter sin solicitudes facturables",async()=>{

  const model={id:"fixture/model",context_length:10000,architecture:{input_modalities:["text"],output_modalities:["text"]},supported_parameters:["max_tokens"],pricing:{prompt:"0.000001",completion:"0.000002",request:"0"}};

  const q=modelQuote(model,"fixture/model");

  expect(BigInt(q.reserve)).toBeGreaterThan(0n);

  expect(()=>modelQuote({...model,pricing:{...model.pricing,unknown_charge:"1"}},"fixture/model")).toThrow();

  let calls=0;

  const transport=async (url:unknown,init?:RequestInit)=>{

   calls++;

   expect(String(url)).toContain("https://openrouter.ai/api/v1/");

   if(String(url).endsWith("/models"))return Response.json({data:[model]});

   const body=JSON.parse(String(init?.body));expect(body.max_tokens).toBeLessThanOrEqual(512);expect(body.provider.allow_fallbacks).toBe(false);

   return Response.json({id:"gen-contract",model:"fixture/model",choices:[{message:{content:"Hola"}}],usage:{cost:0.00001,prompt_tokens:2,completion_tokens:1}});

  };

  const adapter=openRouterProvider("synthetic-only","fixture/model",transport as typeof fetch);

  const queried=await adapter.quote();await adapter.execute([{role:"user",content:"Hola"}],queried);

  expect(calls).toBe(2);

 });

 it("recupera inicio y respuesta tras perder ACK desde React/Chrome",async()=>{

  await sql`update demo_limits set budget_micro_usd=1000,max_concurrent_sessions=10`;

  const before=await sql`select count(*)::int as n from demo_session`;

  const bundle=await build({stdin:{contents:

    'import React from "react"; import {createRoot} from "react-dom/client"; import {DemoSimulator} from "./src/components/demo-center/simulator"; createRoot(document.getElementById("root")).render(<DemoSimulator spaceId="finance-space"/>);',

    loader:"tsx",resolveDir:process.cwd()},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic"});

  const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});

  let lostStart=false,lostSend=false,posts=0;

  const browserProvider={...provider,execute:async()=>{posts++;return {id:"gen-browser",text:"Respuesta de NOVA controlada",cost:"0.000005",usage:{prompt_tokens:4,completion_tokens:2,cost:0.000005},model:"fixture/model"};}};

  try{

    const page=await browser.newPage();

    await page.route("**/*",async route=>{

      const req=route.request(),url=new URL(req.url());

      if(url.pathname==="/"){await route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});return;}

      if(url.pathname!=="/api/demo-center/simulator"){await route.abort();return;}

      try{

        let result;

        if(req.method()==="POST"){

          const body=req.postDataJSON();

          if(body.action==="send")result=await realDemoSend(actor,body,browserProvider);

          else result=await simulatorCommand(actor,body);

          if(body.action==="start"&&!lostStart){lostStart=true;await route.abort();return;}

          if(body.action==="send"&&!lostSend){lostSend=true;await route.abort();return;}

        }else result=await simulatorRead(actor,url.searchParams.get("spaceId")!,url.searchParams.get("sessionId")??undefined);

        await route.fulfill({contentType:"application/json",body:JSON.stringify(result)});

      }catch{await route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({error:{message:"Bloqueado"}})});}

    });

    await page.goto("http://127.0.0.1:55530/");

    await page.addScriptTag({content:bundle.outputFiles[0]!.text});

    await page.getByRole("button",{name:"Iniciar sesión"}).click();

    await page.getByRole("alert").filter({hasText:/fetch|Failed|Error/i}).waitFor();

    await page.getByRole("button",{name:"Iniciar sesión"}).click();

    await page.getByLabel("Mensaje",{exact:true}).waitFor();

    await page.getByLabel("Mensaje",{exact:true}).fill("Hola NOVA");

    await page.getByRole("button",{name:"Enviar",exact:true}).click();

    await page.getByRole("alert").filter({hasText:/fetch|Failed|Error/i}).waitFor();

    await page.getByRole("button",{name:"Enviar",exact:true}).click();

    await page.getByText("Asistente: Respuesta de NOVA controlada").waitFor();

    expect(posts).toBe(1);

    const after=await sql`select count(*)::int as n from demo_session`;

    expect(after[0]!.n).toBe(before[0]!.n+1);

  }finally{await browser.close();}

 },30000);



 it("fecha la reserva después de esperar el bloqueo de organización",async()=>{

  await sql`update demo_limits set budget_micro_usd=1000`;

  let unlock!:()=>void;

  const gate=new Promise<void>(resolve=>{unlock=resolve;});

  let locked!:()=>void;

  const ready=new Promise<void>(resolve=>{locked=resolve;});

  const lock=sql.begin(async tx=>{await tx`select id from organization where id='finance-org' for update`;locked();await gate;});

  await ready;

  const execution=realDemoSend(actor,request("timestamp-after-lock"),provider);

  await new Promise(resolve=>setTimeout(resolve,250));

  const [clock]=await sql`select clock_timestamp() as instant`;

  unlock();

  await lock;

  await execution;

  const [row]=await sql`select created_at from demo_usage_operation where operation_key='timestamp-after-lock'`;

  expect(new Date(row!.created_at).getTime()).toBeGreaterThanOrEqual(new Date(clock!.instant).getTime());

 },20000);



 it("integra metadatos web_search, reserva, historial, excedente y auditoría",async()=>{
  await sql`update demo_limits set budget_micro_usd=5000000,session_budget_micro_usd=1000000,max_concurrent_sessions=10`;
  const session=await simulatorCommand(actor,{action:"start",spaceId:"finance-space",requestKey:"metadata-session"});
  const model={id:"openai/gpt-4.1-mini",context_length:1047576,top_provider:{context_length:1047576,max_completion_tokens:32768},architecture:{input_modalities:["text","image","file"],output_modalities:["text"]},supported_parameters:["max_tokens"],pricing:{prompt:"0.0000004",completion:"0.0000016",web_search:"0.01",input_cache_read:"0.0000001"}};
  let generations=0;
  const transport:typeof fetch=async(url,init)=>{
   if(String(url).endsWith("/models"))return Response.json({data:[model]});
   expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
   generations++;
   const body=JSON.parse(String(init?.body));
   expect(body.plugins).toEqual([{id:"web",enabled:false}]);expect(body.tools).toEqual([]);expect(body.max_tokens).toBe(512);
   const [op]=await sql`select * from demo_usage_operation where operation_key='metadata-turn'`;
   expect(String(op!.reserved_amount)).toBe("419850");expect(op!.status).toBe("uncertain");expect(op!.attempted_at).not.toBeNull();
   const [audit]=await sql`select count(*)::int as n from demo_admin_audit where target_id=${op!.id} and action='llm_reserved'`;
   expect(audit!.n).toBe(1);
   return Response.json({id:"synthetic-metadata",model:model.id,choices:[{message:{content:"Pizza sintética NOVA"}}],usage:{cost:"0.000005"}});
  };
  const adapter=openRouterProvider("synthetic-only",model.id,transport);
  const cmd={...request("metadata-turn"),sessionId:String(session.id)};
  const result=await realDemoSend(actor,cmd,adapter);expect(result.status).toBe("settled");
  await realDemoSend(actor,cmd,adapter);expect(generations).toBe(1);
  const [op]=await sql`select * from demo_usage_operation where operation_key='metadata-turn'`;
  expect(String(op!.actual_amount)).toBe("5");
  const [used]=await sql`select sum(case when status='settled' then actual_amount else reserved_amount end)::text as amount,count(*) filter(where status in ('reserved','uncertain'))::int as pending from demo_usage_operation where session_id=${session.id}`;
  expect(used!.amount).toBe("5");expect(used!.pending).toBe(0); // excedente 419845 disponible
  const [turn]=await sql`select assistant_text from demo_simulation_turn where session_id=${session.id}`;expect(turn!.assistant_text).toBe("Pizza sintética NOVA");
  const [audit]=await sql`select count(*)::int as n from demo_admin_audit where target_id=${op!.id} and action='llm_settled'`;expect(audit!.n).toBe(1);
  await expect(realDemoSend({...actor,organizationId:"finance-other-org"},cmd,adapter)).rejects.toMatchObject({code:"not_found"});
  await expect(realDemoSend(actor,{...cmd,spaceId:"finance-other-space"},adapter)).rejects.toMatchObject({code:"not_found"});
  const bad=openRouterProvider("synthetic-only",model.id,async()=>Response.json({data:[{...model,pricing:{...model.pricing,unknown_charge:"1"}}]}));
  await expect(realDemoSend(actor,{...cmd,requestKey:"metadata-rejected"},bad)).rejects.toMatchObject({code:"price_unverifiable"});
  const rows=await sql`select id from demo_usage_operation where operation_key='metadata-rejected'`;expect(rows).toHaveLength(0);expect(generations).toBe(1);
 });

});
