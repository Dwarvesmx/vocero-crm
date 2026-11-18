import { it, expect, vi } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

// Solo contexto de ejecución de Next: no reemplaza handlers, auth ni servicios.
const framework = vi.hoisted(() => ({ context: null as AsyncLocalStorage<Headers> | null, after: [] as (()=>Promise<unknown>)[] }));
vi.mock('next/headers',()=>({headers:async()=>framework.context!.getStore()!}));
vi.mock('next/server',()=>({after:(fn:()=>Promise<unknown>)=>framework.after.push(fn)}));
import { getAuth } from '@/lib/auth';
import { getDb, getSql } from '@/lib/db';
import * as comercial from '@/app/api/comercial/route';
import * as botComercial from '@/app/api/bot/comercial/route';
import * as context from '@/app/api/bot/context/route';
import * as profile from '@/app/api/bot/profile/route';
import * as messages from '@/app/api/bot/messages/route';
import * as typing from '@/app/api/bot/typing/route';
import * as handoff from '@/app/api/bot/handoff/route';
import * as knowledge from '@/app/api/bot/knowledge/route';
import * as webhook from '@/app/api/webhooks/zernio-whatsapp/route';
import { guardarZernioWhatsApp } from '@/server/zernio/whatsapp-credenciales';
import { procesarEvento, detenerBarrido } from '@/server/webhooks/worker';
import { tanda, detenerWorker } from '@/server/dispatch/worker';
import { prepararAvisosComerciales } from '@/server/comercial/avisos';
import { barrerEnviosWhatsAppZernio, detenerEnviosWhatsAppZernio } from '@/server/zernio/whatsapp-outbox';

it.skipIf(process.env.COMERCIAL_TEST!=='1')('Lukas: circuito real único con PostgreSQL aislado',async()=>{
  if(!process.env.DATABASE_URL?.includes('@127.0.0.1:55546/postgres'))throw Error('Solo clúster efímero');
  getDb(); const sql=getSql();
  const [identity]=await sql`select current_setting('data_directory') as dir`;
  expect(String(identity!.dir).replaceAll('\\','/')).toContain('/tmp/comercial-pg-');
  framework.context=new AsyncLocalStorage<Headers>();
  const origin='http://127.0.0.1:55548', key=process.env.BOT_API_KEY!, signature='synthetic-webhook-signature';
  const calls:Record<string,unknown>[]=[], sends:Record<string,unknown>[]=[], checks:Record<string,unknown>[]=[];
  const neaPath=resolve(process.env.NEA_COMERCIAL_PATH??'../nea-catalogo-consolidado');
  const revision=(cwd:string)=>execFileSync('git',['rev-parse','HEAD'],{cwd,windowsHide:true,encoding:'utf8'}).trim();
  const report:Record<string,unknown>={estado:'BLOQUEADO',fecha:new Date().toISOString(),fuentes:{vocero:revision(resolve('.')),nea:revision(neaPath)},entorno:'PostgreSQL 16 local descartable, datos sintéticos',simulaciones:['Respuestas HTTP OpenRouter','Aceptación HTTP y ACK firmado de Zernio'],calls,sends,checks};
  let cookie='',org='',conv='',quote='',phase='informacion',modelStep=0,child:ReturnType<typeof spawn>|undefined,childLog='';
  const routes:Record<string,Record<string,unknown>>={
    '/api/comercial':comercial,'/api/bot/comercial':botComercial,'/api/bot/context':context,
    '/api/bot/profile':profile,'/api/bot/messages':messages,'/api/bot/typing':typing,
    '/api/bot/handoff':handoff,'/api/bot/knowledge':knowledge,'/api/webhooks/zernio-whatsapp':webhook,
  };
  const realFetch=globalThis.fetch;
  let perderAckDespacho=false;
  vi.stubGlobal('fetch',async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    if(url.hostname!=='127.0.0.1')throw Error('Red externa prohibida');
    if(perderAckDespacho&&url.href===process.env.BRAIN_DISPATCH_URL){
      perderAckDespacho=false;
      const accepted=await realFetch(input,init);
      expect(accepted.status).toBe(200);
      await accepted.body?.cancel();
      throw Error('ACK del despacho perdido después de persistir en Nea');
    }
    return realFetch(input,init);
  });
  function modelReply(body:{messages:{role:string;content:string}[]}) {
    const tool=(name:string,args:Record<string,unknown>)=>({role:'assistant',content:null,tool_calls:[{id:`${phase}-${modelStep}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
    modelStep++;
    if(phase==='cotizacion'){
      if(modelStep===1)return tool('comercial_preparar',{conceptos:[{productoId:'citas',cantidad:1}],especial:'Lavandería: servicios, precios y solicitudes de cita dentro del paquete base'});
      const prepared=body.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)).find(m=>m.data?.cotizacionId);
      if(prepared)quote=prepared.data.cotizacionId;
      if(modelStep===2)return tool('comercial_preparar',{conceptos:[{productoId:'citas',cantidad:1}],nuevaNegociacion:true}); // adversarial: misma intención, distinto tool id
      if(modelStep===3)return tool('comercial_solicitar_aprobacion',{cotizacionId:quote,version:1,avisar:true});
    }
    if(phase==='contratacion'){
      if(modelStep===1)return tool('comercial_aceptar',{cotizacionId:quote,version:1});
      if(modelStep===2)return tool('comercial_contratar',{cotizacionId:quote,version:1});
    }
    const content=phase==='informacion'?'Para una lavandería ofrecemos Servicios y Citas: muestra servicios y precios y permite solicitudes de cita. Puedes consultar el alcance y las condiciones antes de decidir. Por ahora seguimos solo con información.':phase==='cotizacion'?'Servicios y Citas cubre tu lavandería: servicios, precios y solicitudes de cita en la misma propuesta. El precio orientativo es $2,490 MXN y requiere aprobación administrativa. Tu autorización de aviso quedó registrada. Para contratar, primero se aprueba esta propuesta y después aceptas las condiciones; el pago queda pendiente.':'Tu pedido quedó registrado con pago pendiente. La contratación corresponde a la propuesta aprobada que aceptaste por este chat. No hay pago confirmado ni enlace de cobro disponible todavía.';
    return {role:'assistant',content};
  }
  const server=createServer(async(req,res)=>{
    try{
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      const raw=Buffer.concat(chunks).toString(),path=new URL(origin+req.url).pathname;
      const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);
      if(path==='/openrouter/chat/completions'){
        const answer=modelReply(JSON.parse(raw));res.writeHead(200,{'content-type':'application/json'});
        res.end(JSON.stringify({id:'synthetic-completion',object:'chat.completion',created:1,model:'z-ai/glm-5.3-flash',choices:[{index:0,message:answer,finish_reason:'tool_calls' in answer?'tool_calls':'stop'}]}));return;
      }
      if(path.startsWith('/provider/')){
        expect(headers.get('authorization')).toBe('Bearer synthetic-provider-token');
        if(req.method==='POST'){
          const requestKey=headers.get('idempotency-key');expect(requestKey).toBeTruthy();
          expect(path).toBe('/provider/inbox/conversations/hilo-circuito/messages');
          const payload=JSON.parse(raw);expect(payload.accountId).toBe('cuenta-circuito');expect(payload.message).toBeTruthy();
          let send=sends.find(s=>s.requestKey===requestKey);
          if(!send){send={requestKey,id:`wamid-salida-${sends.length+1}`,attempts:0};sends.push(send);}
          send.attempts=Number(send.attempts)+1;
          res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({success:true,data:{messageId:send.id}}));return;
        }
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({messages:[],pagination:{hasMore:false}}));return;
      }
      const request=new Request(origin+req.url,{method:req.method,headers,...(raw?{body:raw}:{})});
      const response=await framework.context!.run(headers,async()=>{
        if(path.startsWith('/api/auth/'))return getAuth().handler(request);
        const handler=routes[path]?.[req.method??'GET'] as ((r:Request)=>Promise<Response>)|undefined;
        if(!handler)throw Error('Ruta sin puente: '+path);
        return handler(request);
      });
      const text=await response.text();
      if(path==='/api/bot/comercial'||path==='/api/bot/messages'){
        const input=raw?JSON.parse(raw):{};const output=JSON.parse(text);
        calls.push({method:req.method,tool:path==='/api/bot/messages'?'messages':input.action?'comercial_'+input.action:'comercial_catalogo',action:path==='/api/bot/messages'?'responder':input.action??'consultar',requestKey:input.requestKey,conversationId:input.conversationId,status:response.status,code:output.error?.code,
          result:{cotizacionId:output.cotizacionId,version:output.version,estado:output.estado,consentimiento:output.consentimiento,pedido:output.pedido,messageId:output.messageId},command:raw?input:undefined});
      }
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(text);
    }catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:String(e)}));}
  });
  await new Promise<void>(r=>server.listen(55548,'127.0.0.1',r));
  async function request(path:string,body?:unknown,admin=false){
    const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(admin?{cookie,origin}:{'x-api-key':key})},...(body?{body:JSON.stringify(body)}:{})});
    const text=await r.text();expect(r.status,text).toBe(200);return JSON.parse(text);
  }
  async function admin(body:Record<string,unknown>){return request('/api/comercial',{requestKey:randomUUID(),...body},true);}
  const envelope=(id:string,text:string,event='message.received',outId='')=>({id,event,account:{accountId:'cuenta-circuito',platform:'whatsapp'},conversation:{id:'hilo-circuito'},message:{id:'zernio-'+id,platformMessageId:outId||'wamid-'+id,conversationId:'hilo-circuito',platform:'whatsapp',direction:event==='message.received'?'incoming':'outgoing',text,sentAt:new Date().toISOString(),sender:{phoneNumber:'+525500000001'}},...(event==='message.delivered'?{statusAt:new Date().toISOString()}:{})});
  async function inbound(payload:ReturnType<typeof envelope>){
    const body=JSON.stringify(payload);
    const r=await fetch(origin+'/api/webhooks/zernio-whatsapp',{method:'POST',headers:{'x-zernio-signature':createHmac('sha256',signature).update(body).digest('hex')},body});
    expect(r.status,await r.text()).toBe(200);
    while(framework.after.length)await framework.after.shift()!();
    const events=await sql`select id from webhook_event where status='pendiente'`;
    for(const e of events)await procesarEvento(String(e.id));
  }
  async function turn(payload:ReturnType<typeof envelope>){
    modelStep=0;await inbound(payload);detenerWorker();
    await sql`update dispatch set not_before=clock_timestamp()-interval '1 second' where status='pendiente'`;
    perderAckDespacho=phase==='cotizacion';
    await tanda();
    if(phase==='cotizacion'){
      const [retry]=await sql`select id,status,attempts from dispatch where status='pendiente'`;
      expect(retry).toMatchObject({status:'pendiente',attempts:1});
      expect(await sql`select dispatch_id from nea_circuito.dispatch_inbox where dispatch_id=${retry!.id}`).toHaveLength(1);
      await sql`update dispatch set not_before=clock_timestamp()-interval '1 second' where id=${retry!.id}`;
      expect(await tanda()).toBe(1);
      const [confirmed]=await sql`select status,attempts from dispatch where id=${retry!.id}`;
      expect(confirmed).toMatchObject({status:'entregado',attempts:2});
      checks.push({transicion:'reintento_despacho',dispatchId:retry!.id,...confirmed});
    }
    const r=await fetch('http://127.0.0.1:55549/fixture/drain',{method:'POST'});expect(r.status,childLog).toBe(200);
    expect((await r.json()).processed).toBe(true);
    await barrerEnviosWhatsAppZernio();
    // El encolado despierta un barrido real en segundo plano. Esperar su commit.
    for(let i=0;i<100;i++){
      const pending=await sql`select id from zernio_whatsapp_outbox where status in ('retenido','iniciado','procesando')`;
      if(!pending.length)break;await new Promise(r=>setTimeout(r,50));
    }
    const replies=await sql`select m.text,m.status,j.status as job_status from message m join zernio_whatsapp_outbox j on j.message_id=m.id
      join dispatch d on d.id=j.source_dispatch_id
      join message inbound on inbound.id=any(array(select jsonb_array_elements_text(d.message_ids)))
      where m.conversation_id=${conv} and m.ai_generated and inbound.wa_message_id=${payload.message.platformMessageId}`;
    expect(replies,childLog).toHaveLength(1);expect(replies[0]!.status,childLog).toBe('sent');expect(replies[0]!.job_status).toBe('completado');
    expect(String(replies[0]!.text).split(/\s+/).length).toBeGreaterThan(25);
    if(phase==='cotizacion'){
      expect(replies[0]!.text).toMatch(/2,490/);expect(replies[0]!.text).toMatch(/contratar/);
      expect(replies[0]!.text).toMatch(/autorización.*registrada/);expect(replies[0]!.text).not.toMatch(/¿.*aviso/);
    }
    checks.push({transicion:phase,respuesta:replies[0]!.text,estado:replies[0]!.status});
  }
  try{
    // El runner ya verificó la sentinela; solo se retira esa fila sintética.
    await sql`delete from organization where id='sentinela'`;
    const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'circuito@example.invalid',password:'synthetic-commercial-password',name:'Circuito sintético'})});
    expect(signup.status,await signup.text()).toBe(200);cookie=signup.headers.get('set-cookie')!.split(';')[0]!;
    const [member]=await sql`select organization_id from member limit 1`;org=String(member!.organization_id);process.env.COMERCIAL_BOT_ORG_ID=org;
    await sql`update agent_profile set enabled=true where organization_id=${org}`;
    await guardarZernioWhatsApp({organizationId:org,accountRef:'cuenta-circuito',token:'synthetic-provider-token',secreto:signature,enabled:true});
    await admin({action:'sembrar'});
    await sql`insert into contact(id,organization_id,wa_identity,name) values('cliente-circuito',${org},'525500000001','Lavandería sintética')`;
    await sql`insert into conversation(id,organization_id,contact_id) values('conv-circuito',${org},'cliente-circuito')`;conv='conv-circuito';
    const previous=[];
    for(const product of ['web','catalogo']){
      const id='origen-anterior-'+product;
      await sql`insert into message(id,organization_id,conversation_id,direction,text) values(${id},${org},${conv},'in','Quiero cotizar otro proyecto nuevo anterior sintético')`;
      previous.push(await admin({action:'preparar',conversationId:conv,mensajeOrigenId:id,propuesta:{conceptos:[{productoId:product,cantidad:1}]}}));
    }
    const previousIds=previous.map(p=>p.cotizacionId);report.proyectosAnteriores=previousIds;
    child=spawn(process.env.CIRCUITO_PYTHON!,['tests/lukas_circuito_server.py'],{cwd:neaPath,env:{...process.env,PYTHONPATH:neaPath},windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stderr!.on('data',c=>{childLog+=c;});child.stdout!.on('data',c=>{childLog+=c;});
    let ready=false;for(let i=0;i<80;i++){try{if((await fetch('http://127.0.0.1:55549/fixture/ready')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,100));}expect(ready,childLog).toBe(true);
    // Autenticación de servicio y firma se verifican sin bypass.
    expect((await fetch(origin+'/api/bot/comercial?conversationId='+conv)).status).toBe(401);
    expect((await fetch('http://127.0.0.1:55549/vocero/dispatch',{method:'POST',body:'{}'})).status).toBe(401);
    await turn(envelope('info','Quiero información para un proyecto nuevo de lavandería. No quiero cotización.'));
    let state=await request('/api/comercial?conversationId='+conv,undefined,true);
    expect(state.cotizaciones).toHaveLength(2);expect(state.eventos.filter((e:{action:string})=>e.action==='solicitar_aprobacion')).toHaveLength(0);
    checks.push({transicion:'informacion',cotizacionesNuevas:0,consentimientos:0});
    phase='cotizacion';const second=envelope('cotizar','Quiero una cotización para mi lavandería con servicios, precios y solicitudes de cita. Autorizo que me avises por este WhatsApp cuando esté aprobada. ¿Cuánto cuesta y cómo contrato?');
    await turn(second);
    state=await request('/api/comercial?conversationId='+conv,undefined,true);
    expect(state.cotizaciones).toHaveLength(3);quote=state.cotizaciones.find((q:{id:string})=>!previousIds.includes(q.id)).id;
    const q=state.cotizaciones.find((q:{id:string})=>q.id===quote);expect(q.consentimiento.registrado).toBe(true);expect(q.version).toBe(1);expect(q.snapshot.conceptos).toHaveLength(1);expect(q.snapshot.especial).toContain('Lavandería');expect(q.snapshot.pendientes).toHaveLength(0);
    checks.push({transicion:'cotizacion',cotizacionId:quote,version:q.version,consentimiento:q.consentimiento,snapshot:q.snapshot});
    await inbound(second);
    const beforeReplay=calls.length;expect(await tanda()).toBe(0);
    const [dispatch]=await sql`select payload from nea_circuito.dispatch_inbox order by created_at desc limit 1`;
    const replay=JSON.stringify(dispatch!.payload);
    const repeated=await fetch('http://127.0.0.1:55549/vocero/dispatch',{method:'POST',body:replay,headers:{'x-vocero-signature':createHmac('sha256',key).update(replay).digest('hex')}});expect(repeated.status).toBe(200);
    expect((await (await fetch('http://127.0.0.1:55549/fixture/drain',{method:'POST'})).json()).processed).toBe(false);
    expect(calls).toHaveLength(beforeReplay);
    const saved=calls.find(c=>c.action==='solicitar_aprobacion'&&c.status===200)!;
    await request('/api/bot/comercial',saved.command);
    const prepare=calls.find(c=>c.action==='preparar'&&c.status===200)!;
    expect((await request('/api/bot/comercial',prepare.command)).cotizacionId).toBe(quote);
    const ref={conversationId:conv,cotizacionId:quote,version:1};
    expect((await fetch(origin+'/api/comercial',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action:'decidir',requestKey:'anonymous',...ref,decision:'aprobar',motivo:'Sin sesión'})})).status).toBe(401);
    await admin({action:'decidir',...ref,decision:'aprobar',motivo:'Alcance sintético incluido en paquete cotejado'});
    await prepararAvisosComerciales();await prepararAvisosComerciales();
    const approval=await sql`select action,data from comercial_evento where cotizacion_id=${quote} and action in ('decidir','aviso_aprobacion')`;
    expect(approval.filter(e=>e.action==='decidir')).toHaveLength(1);expect(approval.filter(e=>e.action==='aviso_aprobacion')).toHaveLength(1);
    const jobs=await sql`select j.* from zernio_whatsapp_outbox j where request_key like 'comercial-aviso:%'`;expect(jobs).toHaveLength(1);
    await barrerEnviosWhatsAppZernio();
    const [notice]=await sql`select status,wa_message_id,text from message where id=${jobs[0]!.message_id}`;expect(notice!.status).toBe('sent');
    expect(notice!.text).toContain('Alcance aprobado: Lavandería: servicios, precios y solicitudes de cita dentro del paquete base');
    checks.push({transicion:'aceptacion_proveedor',estado:notice!.status,entregaConfirmada:false});
    await inbound(envelope('ack','', 'message.delivered',String(notice!.wa_message_id)));
    await inbound(envelope('ack','', 'message.delivered',String(notice!.wa_message_id)));
    const [delivered]=await sql`select status from message where id=${jobs[0]!.message_id}`;expect(delivered!.status).toBe('delivered');
    const sentCount=sends.length;await barrerEnviosWhatsAppZernio();expect(sends).toHaveLength(sentCount);
    checks.push({transicion:'aprobacion_outbox_ack',approval,jobs,estadoFinal:delivered!.status});
    phase='contratacion';await turn(envelope('aceptar','Sí, acepto explícitamente la propuesta aprobada de mi lavandería y quiero contratarla.'));
    state=await request('/api/comercial?conversationId='+conv,undefined,true);
    expect(state.pedidos).toHaveLength(1);expect(state.pedidos[0]).toMatchObject({cotizacion_id:quote,version:1,estado:'pendiente',enlace:null,evidencia:null});
    expect(state.cotizaciones).toHaveLength(3);
    expect(state.cotizaciones.filter((q:{id:string;version:number})=>previousIds.includes(q.id)).every((q:{version:number})=>q.version===1)).toBe(true);
    const consent=state.eventos.filter((e:{action:string;cotizacion_id:string;data:{mensajeAvisoId?:string}})=>e.action==='solicitar_aprobacion'&&e.cotizacion_id===quote&&e.data.mensajeAvisoId);expect(consent).toHaveLength(1);
    const [source]=await sql`select id from message where wa_message_id='wamid-cotizar'`;expect(consent[0].data.mensajeAvisoId).toBe(source!.id);expect(consent[0].data.version).toBe(1);
    report.organizationId=org;report.conversationId=conv;report.cotizaciones=state.cotizaciones;report.consentimientos=consent;report.pedidos=state.pedidos;
    report.mensajes=await sql`select id,direction,text,status,wa_message_id from message order by created_at`;
    report.despachos=await sql`select id,status,message_ids,attempts from dispatch order by created_at`;
    report.nea=await sql`select dispatch_id,state from nea_circuito.dispatch_inbox`;
    report.outbox=await sql`select id,message_id,request_key,status,attempts from zernio_whatsapp_outbox`;
    report.eventos=await sql`select id,cotizacion_id,action,data from comercial_evento where cotizacion_id=${quote} order by created_at`;
    report.webhooks=await sql`select id,status,attempts,payload->>'id' as provider_event from webhook_event order by created_at`;
    expect(await sql`select id from nea_circuito.pending_send where delivered_at is null and abandoned_at is null`).toHaveLength(0);
    expect(await sql`select id from message where ai_generated`).toHaveLength(3);
    expect(report.despachos).toHaveLength(3);expect(report.nea).toHaveLength(3);expect(sends).toHaveLength(4);
    expect(sends.every(s=>s.attempts===1)).toBe(true);
    expect(calls.filter(c=>c.status===422)).toHaveLength(0);
    expect(calls.filter(c=>c.action==='responder'&&c.status!==200)).toHaveLength(0);
    report.duplicados={cotizacionesNuevas:state.cotizaciones.length-2,consentimientos:consent.length,pedidos:state.pedidos.length,avisos:jobs.length,detectados:0};
    report.estado='LISTO';
    console.log(JSON.stringify({estado:report.estado,duplicados:report.duplicados,pedidos:state.pedidos.map((p:{estado:string})=>p.estado)}));
  }catch(e){report.error=String(e);console.error(childLog);throw e;}
  finally{
    writeFileSync(process.env.CIRCUITO_REPORT!,JSON.stringify(report,null,2)+'\n');
    detenerWorker();detenerBarrido();detenerEnviosWhatsAppZernio();
    if(child&&child.exitCode===null){child.kill();await new Promise(r=>child!.once('exit',r));}
    await new Promise<void>(r=>server.close(()=>r()));vi.unstubAllGlobals();await sql.end();
  }
},120000);
