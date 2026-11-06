import { build } from "esbuild";
import { chromium } from "playwright";
import { beforeAll,afterAll,describe,it,expect } from "vitest";
import { getSql } from "@/lib/db";
import { simulatorCommand as command,simulatorRead as read } from "@/server/demo-center/infra/simulator";

describe.skipIf(process.env.DEMO_F2A_TEST!=="1")("Simulador integrado en PostgreSQL",()=>{
  let sql:ReturnType<typeof getSql>;
  const actor={organizationId:"sim-org",userId:"sim-owner"};
  let id:string;
  beforeAll(async()=>{
    const url=new URL(process.env.DATABASE_URL!);
    if(url.hostname!=="127.0.0.1"||url.port!=="55529"||url.pathname!=="/demo_f2a")throw Error("BD insegura");
    sql=getSql();
    const [info]=await sql`select current_setting('data_directory') as dir`;
    if(!String(info!.dir).replaceAll("\\","/").endsWith("/tmp/demo-f2a02-pg"))throw Error("Clúster inesperado");
    await sql`truncate organization, "user" cascade`;
    await sql`insert into organization(id,name) values('sim-org','Simulación'),('other-org','Otra')`;
    await sql`insert into "user"(id,name,email) values('sim-owner','Ficticio','sim@example.invalid')`;
    await sql`insert into demo_space(id,organization_id,name,commercial_name,sector,status) values
      ('pizza','sim-org','Pizza','Pizza','Restaurante','active'),('casa','sim-org','Casa','Casa','Inmobiliaria','draft')`;
    await sql`insert into demo_profile_version(id,organization_id,space_id,version,name,tone,instructions,escalation_rules,greeting,role,created_by) values
      ('profile1','sim-org','pizza',1,'NOVA','Amable','Instrucciones A','','Hola','Información','sim-owner')`;
    await sql`update demo_space set current_profile_version_id='profile1' where id='pizza'`;
    for(const space of [null,'pizza']) await sql`insert into demo_limits(id,organization_id,space_id,max_duration_seconds,max_idle_seconds,
      max_concurrent_sessions,max_sessions_started,max_inbound_messages,max_assistant_responses,max_provider_calls,budget_micro_usd,
      window_start,window_end) values(${space??'global'},'sim-org',${space},900,300,3,20,30,30,30,0,now()-interval '1 day',now()+interval '1 day')`;
    await sql`insert into kb_entry(id,organization_id,demo_space_id,kind,content) values
      ('pizza-kb','sim-org','pizza','block','Pizza Galactica'),('casa-kb','sim-org','casa','block','Casa privada'),
      ('commercial-kb','sim-org',null,'block','Lukas privado')`;
  });
  afterAll(async()=>{if(sql)await sql.end();});
  it("inicia sin teléfono, fija perfil y rechaza sesión externa incompleta",async()=>{
    const result=await command(actor,{action:"start",spaceId:"pizza",requestKey:"start-1"});id=String(result.id);
    const [row]=await sql`select * from demo_session where id=${id}`;
    expect(row!.authorization_id).toBeNull();expect(row!.conversation_id).toBeNull();
    expect(row!.profile_version_id).toBe("profile1");
    await expect(sql`insert into demo_session(id,organization_id,space_id,kind,profile_version_id,route_generation,state,started_at,expires_at,last_activity_at,idle_deadline,limits_snapshot)
      values('bad-external','sim-org','pizza','external','profile1',1,'active',now(),now()+interval '1 day',now(),now()+interval '1 hour','{}')`).rejects.toMatchObject({code:"23514"});
  });
  it("persiste el turno, deduplica reintentos concurrentes y aísla ámbitos",async()=>{
    const request={action:"send" as const,spaceId:"pizza",sessionId:id,requestKey:"turn-1",text:"Galactica"};
    await Promise.all([command(actor,request),command(actor,request)]);
    const result=await read(actor,"pizza",id) as unknown as {turns:Array<{assistant_text:string}>};
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]!.assistant_text).toContain("Pizza Galactica");
    expect(result.turns[0]!.assistant_text).not.toContain("Casa privada");
    expect(result.turns[0]!.assistant_text).not.toContain("Lukas privado");
    await expect(read({...actor,organizationId:"other-org"},"pizza",id)).rejects.toMatchObject({code:"not_found"});
    await expect(read(actor,"casa",id)).rejects.toMatchObject({code:"not_found"});
  });
  it("retiene la versión inicial y revierte errores del proveedor",async()=>{
    await sql`insert into demo_profile_version(id,organization_id,space_id,version,name,tone,instructions,escalation_rules,greeting,role,created_by)
      values('profile2','sim-org','pizza',2,'Otra','Amable','B','','','Información','sim-owner')`;
    await sql`update demo_space set current_profile_version_id='profile2' where id='pizza'`;
    await command(actor,{action:"send",spaceId:"pizza",sessionId:id,requestKey:"turn-2",text:"hola"});
    await expect(command(actor,{action:"send",spaceId:"pizza",sessionId:id,requestKey:"failure",text:"/error-simulado"})).rejects.toMatchObject({code:"simulated_provider_error"});
    const result=await read(actor,"pizza",id) as unknown as {turns:Array<{assistant_text:string}>};
    expect(result.turns).toHaveLength(2);expect(result.turns[1]!.assistant_text).toContain("NOVA v1");
  });
  it("aplica simultaneidad y estados, y bloquea políticas incompletas",async()=>{
    await sql`update demo_limits set max_concurrent_sessions=2`;
    const results=await Promise.allSettled([command(actor,{action:"start",spaceId:"pizza",requestKey:"start-2"}),command(actor,{action:"start",spaceId:"pizza",requestKey:"start-3"})]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    await command(actor,{action:"close",spaceId:"pizza",sessionId:id});
    await expect(command(actor,{action:"send",spaceId:"pizza",sessionId:id,requestKey:"closed",text:"hola"})).rejects.toMatchObject({code:"session_unavailable"});
    const other=await command(actor,{action:"start",spaceId:"pizza",requestKey:"start-expire"});
    await sql`update demo_session set idle_deadline=now()-interval '1 second' where id=${other.id}`;
    await expect(command(actor,{action:"send",spaceId:"pizza",sessionId:String(other.id),requestKey:"expired",text:"hola"})).rejects.toMatchObject({code:"session_unavailable"});
    await sql`update demo_limits set max_provider_calls=0`;
    await expect(command(actor,{action:"start",spaceId:"pizza",requestKey:"blocked"})).rejects.toMatchObject({code:"policy_required"});
  });
  it("opera el chat de navegador contra PostgreSQL sintético",async()=>{
    await sql`update demo_limits set max_provider_calls=30,max_concurrent_sessions=5`;
    const bundle=await build({stdin:{contents:
      'import React from "react"; import {createRoot} from "react-dom/client"; import {DemoSimulator} from "./src/components/demo-center/simulator"; createRoot(document.getElementById("root")).render(<DemoSimulator spaceId="pizza"/>);',
      loader:"tsx",resolveDir:process.cwd()},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic"});
    const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
    try {
      const page=await browser.newPage();
      page.setDefaultTimeout(8000);
      page.on("pageerror", e=>console.log("browser",e.message));
      await page.route("**/*",async route=>{
        const req=route.request(),url=new URL(req.url());
        if(url.pathname==="/"){
          await route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});return;
        }
        if(url.pathname!=="/api/demo-center/simulator"){await route.abort();return;}
        try {
          const result=req.method()==="POST"?await command(actor,req.postDataJSON()):
            await read(actor,url.searchParams.get("spaceId")!,url.searchParams.get("sessionId")??undefined);
          await route.fulfill({contentType:"application/json",body:JSON.stringify(result)});
        } catch {await route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({error:{message:"Bloqueado"}})});}
      });
      await page.goto("https://simulator.invalid/");
      await page.addScriptTag({content:bundle.outputFiles[0]!.text});
      await page.getByRole("button",{name:"Iniciar sesión"}).click();
      await page.getByLabel("Mensaje",{exact:true}).waitFor();
      await page.getByLabel("Mensaje",{exact:true}).fill("Galactica");
      await page.getByRole("button",{name:"Enviar",exact:true}).click();
      await page.getByText(/Asistente:.*Pizza Galactica/).waitFor();
      await page.getByRole("button",{name:"Cerrar sesión"}).click();
      await page.waitForFunction(()=>document.body.textContent?.includes("closed"));
    } finally {await browser.close();}
  },30000);

});
