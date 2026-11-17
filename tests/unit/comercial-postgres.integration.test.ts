import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
vi.mock('@/server/zernio/whatsapp-credenciales',()=>({obtenerZernioWhatsAppPorOrg:vi.fn(async()=>({token:'synthetic',accountRef:'cuenta-sintetica'}))}));
vi.mock('@/server/zernio/whatsapp-envio',()=>({enviarTextoWhatsAppZernio:vi.fn(async()=> 'wamid-aviso-sintetico')}));
import { barrerEnviosWhatsAppZernio } from '@/server/zernio/whatsapp-outbox';
import { enviarTextoWhatsAppZernio } from '@/server/zernio/whatsapp-envio';
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { getDb, getSql } from "@/lib/db";
import { comercialEjecutar, comercialLeer } from "@/server/comercial/service";
import { comandoSchema, type Actor, type Comando, type Producto, type Snapshot } from "@/server/comercial/contracts";
import { GET as botGet, POST as botPost } from "@/app/api/bot/comercial/route";
import { prepararAvisosComerciales, autorizarIntentoAviso } from "@/server/comercial/avisos";

describe.skipIf(process.env.COMERCIAL_TEST !== "1")("Comercial V1 · PostgreSQL descartable",()=>{
  const owner: Actor = {organizationId:"comercial-test",userId:"owner",role:"owner"};
  const bot: Actor = {organizationId:owner.organizationId,role:"bot",conversationId:"conv"};
  let sql: ReturnType<typeof getSql>;
  const producto: Producto={id:"estandar",nombre:"Servicio sintético",descripcion:"Solo pruebas",tipo:"producto",caracteristicas:["Una entrega"],exclusiones:["Sin soporte indefinido"],unico:149900,mensual:0,precioEstado:"aprobado",limites:{secciones:5},compatibles:[],activo:true,condiciones:"Pago único; vigencia prueba"};
  const call = async (actor:Actor,cmd:Record<string,unknown>) => {
    if(!actor.userId && cmd.action==='preparar' && !cmd.mensajeOrigenId && cmd.conversationId===actor.conversationId){
      const id=randomUUID();await sql`insert into message(id,organization_id,conversation_id,direction,text) values(${id},${actor.organizationId},${String(cmd.conversationId)},'in','Quiero otra cotización para un proyecto nuevo')`;
      cmd={...cmd,mensajeOrigenId:id,nuevaNegociacion:true};
    }
    return comercialEjecutar(actor,comandoSchema.parse({requestKey:randomUUID(),...cmd}));
  };
  const preparar = async (propuesta:Record<string,unknown>={conceptos:[{productoId:"estandar",cantidad:1}]}) => call(bot,{action:"preparar",conversationId:"conv",propuesta}) as Promise<{cotizacionId:string;version:number;estado:string;snapshot:Snapshot}>;
  beforeAll(async()=>{
    if (!process.env.DATABASE_URL?.includes("127.0.0.1:55546/") || process.env.OPENROUTER_API_TOKEN || process.env.BRAIN_DISPATCH_URL) throw Error("Requiere laboratorio aislado");
    getDb(); // Auth inicializa Drizzle: comparte serializers con getSql, como Next real.
    sql=getSql();
    const [d]=await sql`select current_setting('data_directory') as dir`;
    if (!String(d!.dir).replaceAll("\\","/").includes("/tmp/comercial-pg-")) throw Error("Clúster inesperado");
    await sql`insert into organization(id,name) values('comercial-test','Sintético'),('otra-org','Ajena')`;
    await sql`insert into "user"(id,name,email) values('owner','Operador','owner@example.invalid')`;
    for (const [id,org] of [["contacto",owner.organizationId],["ajeno","otra-org"],["segundo",owner.organizationId]]) {
      await sql`insert into contact(id,organization_id,wa_identity,name) values(${id!},${org!},${id!},'Ficticio')`;
      await sql`insert into conversation(id,organization_id,contact_id,is_test) values(${id==="contacto"?"conv":id!},${org!},${id!},false)`;
    }
    await sql`insert into conversation(id,organization_id,contact_id,is_test) values('lab','comercial-test','contacto',true)`;
    await call(owner,{action:"catalogo",producto});
    await call(owner,{action:"catalogo",producto:{...producto,id:"extra",tipo:"extra",unico:29000,compatibles:["estandar"]}});
  });
  afterAll(async()=>{await sql?.end();});
  it("A. precio aprobado y reintento concurrente sin duplicación ni cambio de payload",async()=>{
    const origen=randomUUID();await sql`insert into message(id,organization_id,conversation_id,direction,text) values(${origen},${owner.organizationId},'conv','in','Quiero otra cotización para un proyecto nuevo')`;
    const cmd = comandoSchema.parse({action:"preparar",conversationId:"conv",mensajeOrigenId:origen,nuevaNegociacion:true,requestKey:randomUUID(),propuesta:{conceptos:[{productoId:"estandar",cantidad:1}]}});
    const [a,b]=await Promise.all([comercialEjecutar(bot,cmd),comercialEjecutar(bot,cmd)]);
    expect(a).toEqual(b); expect(a).toMatchObject({estado:"aprobada",snapshot:{unico:149900,mensual:0}});
    await expect(comercialEjecutar(bot,{...cmd,propuesta:{conceptos:[{productoId:"estandar",cantidad:2}]}} as Comando)).rejects.toMatchObject({code:"clave_reutilizada"});
  });
  it("B. extras autorizados calculados en servidor y compatibilidad",async()=>{
    const q=await preparar({conceptos:[{productoId:"estandar",cantidad:1},{productoId:"extra",cantidad:2,baseId:"estandar"}]});
    expect(q.snapshot.unico).toBe(207900);expect(q.estado).toBe("aprobada");
    await expect(preparar({conceptos:[{productoId:"extra",cantidad:1,baseId:"no-existe"}]})).rejects.toMatchObject({code:"extra_incompatible"});
  });
  it("C/D. propuesta especial, revisión revoca aprobación, bot recupera decisión sin handoff",async()=>{
    const q=await preparar({conceptos:[{productoId:"estandar",cantidad:1}],especial:"Ajuste a medida"});
    const ref={conversationId:"conv",cotizacionId:q.cotizacionId,version:1};
    expect(q.estado).toBe("pendiente");await call(bot,{action:"solicitar_aprobacion",...ref});
    await expect(call(bot,{action:"contratar",...ref})).rejects.toMatchObject({code:"falta_aceptacion"});
    await call(owner,{action:"decidir",...ref,decision:"aprobar",motivo:"Alcance revisado"});
    const avisos = await sql`select data from comercial_evento where organization_id=${owner.organizationId} and cotizacion_id=${q.cotizacionId} and action='aviso_aprobacion'`;
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.data).toMatchObject({version:1,estado:"pendiente",motivo:"consentimiento_no_acreditado"});
    expect((await comercialLeer(bot,"conv",q.cotizacionId)).cotizaciones[0]!.estado).toBe("aprobada");
    const revised=await call(owner,{action:"revisar",...ref,propuesta:{conceptos:[{productoId:"estandar",cantidad:1}],importeUnico:140000}});
    expect(revised).toMatchObject({version:2,estado:"pendiente"});
    await expect(call(owner,{action:"decidir",...ref,decision:"aprobar",motivo:"Vieja"})).rejects.toMatchObject({code:"version_desactualizada"});
    await call(owner,{action:"decidir",...ref,version:2,decision:"aprobar",motivo:"Descuento aprobado"});
    const data=await comercialLeer(bot,"conv",q.cotizacionId);expect(data.cotizaciones[0]!.aprobada_version).toBe(2);expect(data.eventos).toEqual([]);
    const [conv]=await sql`select ai_enabled,handoff_at from conversation where id='conv'`;expect(conv!.ai_enabled).toBe(true);expect(conv!.handoff_at).toBe(null);
  });
  it("E/F. aceptación con evidencia, contratación única, enlace HTTPS y pago revisado",async()=>{
    const q=await preparar();const ref={conversationId:"conv",cotizacionId:q.cotizacionId,version:1};
    await expect(call(bot,{action:"aceptar",...ref,mensajeId:"no-existe"})).rejects.toMatchObject({code:"evidencia_aceptacion_invalida"});
    const id=randomUUID(); await sql`insert into message(id,organization_id,conversation_id,direction,text) values(${id},${owner.organizationId},'conv','in','Acepto esta cotización')`;
    await call(bot,{action:"aceptar",...ref,mensajeId:id});
    const a=await call(bot,{action:"contratar",...ref});const b=await call(bot,{action:"contratar",...ref});expect(a).toEqual(b);
    expect(a.pedido).toMatchObject({estado:"pendiente",enlace:null});
    await expect(call(owner,{action:"pago",...ref,estado:"pagado"})).rejects.toMatchObject({code:"falta_evidencia"});
    for (const enlace of ["http://payments.example.com/p/1","javascript:alert(1)","https://127.0.0.1/x","https://user:secret@payments.example.com/p"]) await expect(call(owner,{action:"pago",...ref,estado:"pendiente",enlace})).rejects.toMatchObject({code:"enlace_invalido"});
    await call(owner,{action:"pago",...ref,estado:"en_verificacion",enlace:"https://payments.example.com/pedido-sintetico",evidencia:"Documento sintético por revisar"});
    const data=await comercialLeer(bot,"conv",q.cotizacionId);expect(data.pedidos[0]).toMatchObject({estado:"en_verificacion",enlace:"https://payments.example.com/pedido-sintetico"});expect(data.pedidos[0]).not.toHaveProperty("evidencia");
    await call(owner,{action:"pago",...ref,estado:"pagado",evidencia:"Administrador cotejó transferencia sintética 123"});
    expect((await comercialLeer(bot,"conv",q.cotizacionId)).pedidos[0]!.estado).toBe("pagado");
    await expect(call(owner,{action:"pago",...ref,estado:"pendiente"})).rejects.toMatchObject({code:"pago_terminal"});
    await expect(sql`update comercial_pedido set evidencia=null where organization_id=${owner.organizationId} and cotizacion_id=${q.cotizacionId}`).rejects.toMatchObject({code:"23514"});
  });
  it("Cierre integrado V2: evidencia válida, herramientas Nea, aceptación y pedido pendiente",async()=>{
    await call(owner,{action:"catalogo",producto});
    const q=await preparar({conceptos:[{productoId:"estandar",cantidad:1}],especial:"Revisión sintética"});
    const ref={conversationId:"conv",cotizacionId:q.cotizacionId,version:2};
    await call(owner,{action:"revisar",...ref,version:1,propuesta:{conceptos:[{productoId:"estandar",cantidad:1}],importeUnico:217900}});
    await call(owner,{action:"decidir",...ref,decision:"aprobar",motivo:"V2 autorizada"});
    for(const [id,conversation,scope,fecha] of [["previo","conv","commercial","2000-01-01"],["ajena","segundo","commercial",null]] as const){
      await sql`insert into message(id,organization_id,conversation_id,direction,text,scope_kind,created_at) values(${id},${owner.organizationId},${conversation},'in','Sí',${scope},coalesce(${fecha}::timestamptz,clock_timestamp()))`;
      await expect(call(bot,{action:"aceptar",...ref,mensajeId:id})).rejects.toMatchObject({code:"evidencia_aceptacion_invalida"});
    }
    expect((await comercialLeer(owner,undefined,q.cotizacionId)).pedidos).toHaveLength(0);
    await expect(call(bot,{action:"contratar",...ref})).rejects.toMatchObject({code:"falta_aceptacion"});
    const id=randomUUID();await sql`insert into message(id,organization_id,conversation_id,direction,text,scope_kind) values(${id},${owner.organizationId},'conv','in','Sí, acepto la propuesta aprobada','commercial')`;
    const server=createServer(async(req,res)=>{
      try{
        const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
        const response=await botPost(new Request('http://127.0.0.1/api/bot/comercial',{method:'POST',headers:{'x-api-key':process.env.BOT_API_KEY!,'content-type':'application/json'},body:Buffer.concat(chunks).toString()}));
        res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());
      }catch{res.writeHead(500);res.end('{}');}
    });
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
    try{
      const address=server.address();if(!address||typeof address==='string')throw Error('Sin puerto local');
      const output=await new Promise<string>((yes,no)=>{
        const child=spawn(resolve('../tmp/nea-test-venv/Scripts/python.exe'),['tests/comercial_cierre_api.py',`http://127.0.0.1:${address.port}`,q.cotizacionId,id],{cwd:resolve('../nea-comercial-v1'),windowsHide:true,env:{...process.env,PYTHONPATH:resolve('../nea-comercial-v1')}});
        let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',no);child.on('exit',code=>code===0?yes(stdout):no(Error(stderr)));
      });
      const result=JSON.parse(output);expect(result.pedido).toMatchObject({cotizacion_id:q.cotizacionId,version:2,estado:'pendiente',enlace:null});
      const data=await comercialLeer(owner,undefined,q.cotizacionId);expect(data.cotizaciones[0]).toMatchObject({estado:'aceptada',accepted_message_id:id});expect(data.pedidos[0]!.id).toBe(result.pedido.id);
      expect(data.eventos.filter(e=>['aceptar','contratar'].includes(e.action))).toHaveLength(2);
    }finally{await new Promise<void>((yes,no)=>server.close(e=>e?no(e):yes()));}
  });
  it('Estética: runtime Nea conserva una cotización y un consentimiento entre tres turnos',async()=>{
    await sql`insert into contact(id,organization_id,wa_identity,name) values('contacto-estetica-integrada',${owner.organizationId},'estetica-integrada','Estética sintética')`;
    await sql`insert into conversation(id,organization_id,contact_id,is_test) values('estetica-integrada',${owner.organizationId},'contacto-estetica-integrada',false)`;
    await call(owner,{action:'catalogo',producto:{...producto,id:'citas-integrada',unico:249000,precioEstado:'orientativo'}});
    const server=createServer(async(req,res)=>{
      try{
        const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
        if(req.url==='/fixture/message'){
          const body=JSON.parse(Buffer.concat(chunks).toString());const id=randomUUID();
          await sql`insert into message(id,organization_id,conversation_id,direction,text) values(${id},${owner.organizationId},'estetica-integrada',${body.direction},${body.text})`;
          res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id}));return;
        }
        const request=new Request(`http://127.0.0.1${req.url}`,{method:req.method,headers:{'x-api-key':process.env.BOT_API_KEY!,'content-type':'application/json'},...(req.method==='POST'?{body:Buffer.concat(chunks).toString()}:{})});
        const response=req.method==='GET'?await botGet(request):await botPost(request);
        res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());
      }catch{res.writeHead(500);res.end('{}');}
    });
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
    try{
      const address=server.address();if(!address||typeof address==='string')throw Error('Sin puerto local');
      const output=await new Promise<string>((yes,no)=>{
        const child=spawn(resolve('../tmp/nea-test-venv/Scripts/python.exe'),['tests/comercial_continuidad_api.py',`http://127.0.0.1:${address.port}`],{cwd:resolve('../nea-comercial-v1'),windowsHide:true,env:{...process.env,PYTHONPATH:resolve('../nea-comercial-v1')}});
        let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',no);child.on('exit',code=>code===0?yes(stdout):no(Error(stderr)));
      });
      const resultado=JSON.parse(output);expect(resultado).toMatchObject({version:1,estado:'pendiente'});
      const data=await comercialLeer(owner,'estetica-integrada');expect(data.cotizaciones).toHaveLength(1);expect(data.cotizaciones[0]!.snapshot.subtotalUnico).toBe(249000);
      expect(data.eventos.filter(e=>e.action==='solicitar_aprobacion'&&e.data.mensajeAvisoId)).toHaveLength(1);
    }finally{await new Promise<void>((yes,no)=>server.close(e=>e?no(e):yes()));}
  });
  it('Negociación estable: concurrencia, origen, consentimiento, versiones y proyectos distintos',async()=>{
    await sql`insert into contact(id,organization_id,wa_identity,name) values('contacto-estetica',${owner.organizationId},'estetica','Estética sintética')`;
    await sql`insert into conversation(id,organization_id,contact_id,is_test) values('estetica',${owner.organizationId},'contacto-estetica',false)`;
    const actor={...bot,conversationId:'estetica'};
    await call(owner,{action:'catalogo',producto:{...producto,id:'citas-prueba',unico:249000,precioEstado:'orientativo'}});
    const mensaje=async(text:string,direction='in')=>{const id=randomUUID();await sql`insert into message(id,organization_id,conversation_id,direction,text) values(${id},${owner.organizationId},'estetica',${direction},${text})`;return id;};
    const propuesta={conceptos:[{productoId:'citas-prueba',cantidad:1}]};
    const origen=await mensaje('Tengo una estética y quiero cotizar Servicios y Citas');
    const cmd={action:'preparar',conversationId:'estetica',mensajeOrigenId:origen,propuesta};
    const requestKey=randomUUID();
    const [a,b]=await Promise.all([call(actor,{...cmd,requestKey}),call(actor,cmd)]);expect(a).toEqual(b);expect(a.snapshot).toMatchObject({subtotalUnico:249000});
    const id=String(a.cotizacionId);const ref={conversationId:'estetica',cotizacionId:id,version:1};
    await call(actor,{action:'solicitar_aprobacion',...ref});
    const sinPregunta=await mensaje('Sí');await expect(call(actor,{action:'solicitar_aprobacion',...ref,mensajeAvisoId:sinPregunta})).rejects.toMatchObject({code:'consentimiento_no_acreditado'});
    await mensaje('¿Te aviso por este WhatsApp cuando tu cotización esté autorizada?','out');
    const si=await mensaje('Sí');const permisos=await Promise.all([call(actor,{action:'solicitar_aprobacion',...ref,mensajeAvisoId:si}),call(actor,{action:'solicitar_aprobacion',...ref,mensajeAvisoId:si})]);for(const permiso of permisos)expect(permiso).toMatchObject({consentimiento:{registrado:true}});
    const corto=await mensaje('Sí, avísame');expect(await call(actor,{...cmd,mensajeOrigenId:corto})).toMatchObject({cotizacionId:id,version:1,consentimiento:{registrado:true}});
    await call(actor,{action:'solicitar_aprobacion',...ref,mensajeAvisoId:corto});
    const [conteo]=await sql`select count(*)::int n from comercial_evento where cotizacion_id=${id} and action='solicitar_aprobacion' and data->>'mensajeAvisoId' is not null`;expect(conteo!.n).toBe(1);
    const consulta=await comercialLeer(actor,'estetica');expect(consulta.cotizaciones).toHaveLength(1);expect(consulta.cotizaciones[0]!.consentimiento).toMatchObject({registrado:true});
    await call(owner,{action:'decidir',...ref,decision:'aprobar',motivo:'Revisión sintética'});
    expect(await call(actor,{action:'solicitar_aprobacion',...ref,mensajeAvisoId:corto})).toMatchObject({estado:'aprobada',consentimiento:{registrado:true}});
    const seguir=await mensaje('Sigo esperando, no cambia la solicitud');expect(await call(actor,{...cmd,mensajeOrigenId:seguir})).toMatchObject({cotizacionId:id,version:1});
    const cambio=await mensaje('Agrega una segunda unidad a esta misma propuesta');const revisar={...cmd,mensajeOrigenId:cambio,actualizarAlcance:true,version:1,propuesta:{conceptos:[{productoId:'citas-prueba',cantidad:2}]}};
    const v2=await call(actor,revisar);expect(v2).toMatchObject({cotizacionId:id,version:2,estado:'pendiente',consentimiento:{registrado:false}});expect(await call(actor,revisar)).toMatchObject({version:2});expect(await call(actor,{...cmd,requestKey})).toMatchObject({version:2,consentimiento:{registrado:false}});
    await expect(call(actor,{action:'solicitar_aprobacion',...ref})).rejects.toMatchObject({code:'version_desactualizada'});
    const viejo=await mensaje('Agrega un detalle a la versión vieja');await expect(call(actor,{...cmd,mensajeOrigenId:viejo,actualizarAlcance:true,version:1})).rejects.toMatchObject({code:'version_desactualizada'});
    const segunda=await mensaje('Quiero otra cotización para un proyecto distinto');const otra=await call(actor,{...cmd,mensajeOrigenId:segunda,nuevaNegociacion:true});expect(otra.cotizacionId).not.toBe(id);
    const proyecto=await mensaje('Ahora quiero cotizar una cafetería como nuevo proyecto');const tercera=await call(actor,{...cmd,mensajeOrigenId:proyecto,nuevaNegociacion:true});expect(tercera.cotizacionId).not.toBe(otra.cotizacionId);
    const ambiguo=await mensaje('Sí');await expect(call(actor,{...cmd,mensajeOrigenId:ambiguo,nuevaNegociacion:true})).rejects.toMatchObject({code:'nueva_intencion_no_acreditada'});
    await expect(call(bot,{...cmd,conversationId:'conv',mensajeOrigenId:origen})).rejects.toMatchObject({code:'mensaje_origen_invalido'});
    expect((await comercialLeer(actor,'estetica')).cotizaciones).toHaveLength(3);
  });
  it("G. bot y miembros no pueden cambiar precios, decisiones o pagos; inputs estrictos",async()=>{
    await expect(call(bot,{action:"catalogo",producto})).rejects.toMatchObject({code:"sin_permiso"});
    await expect(call({...owner,role:"member"},{action:"catalogo",producto})).rejects.toMatchObject({code:"sin_permiso"});
    await expect(preparar({conceptos:[{productoId:"estandar",cantidad:1}],importeUnico:1})).rejects.toMatchObject({code:"sin_permiso"});
    await expect(call(bot,{action:"pago",conversationId:"conv",cotizacionId:"x",version:1,estado:"pagado",evidencia:"Falsa"})).rejects.toMatchObject({code:"sin_permiso"});
    expect(comandoSchema.safeParse({action:"preparar",requestKey:"x",spaceId:"otro",conversationId:"conv",propuesta:{conceptos:[{productoId:"estandar",cantidad:1}]}}).success).toBe(false);
  });
  it("H. aislamiento entre organizaciones, clientes y laboratorio",async()=>{
    const q=await preparar();
    await expect(comercialLeer({...bot,organizationId:"otra-org"},"conv")).rejects.toMatchObject({status:404});
    await expect(comercialLeer({...bot,conversationId:"segundo"},"segundo",q.cotizacionId)).rejects.toMatchObject({status:404});
    await expect(comercialLeer(bot,"segundo")).rejects.toMatchObject({status:403});
    await expect(comercialLeer({...bot,conversationId:"lab"},"lab")).rejects.toMatchObject({status:404});
    await expect(call(bot,{action:"preparar",conversationId:"ajeno",propuesta:{conceptos:[{productoId:"estandar",cantidad:1}]}})).rejects.toMatchObject({status:403});
  });
  it("I. snapshots emitidos no cambian al editar el catálogo; rechazo y cancelación",async()=>{
    const q=await preparar();await call(owner,{action:"catalogo",producto:{...producto,unico:990000}});
    expect(((await comercialLeer(bot,"conv",q.cotizacionId)).cotizaciones[0]!.snapshot as Snapshot).unico).toBe(149900);
    const special=await preparar({conceptos:[{productoId:"estandar",cantidad:1}],especial:"Pendiente"});
    await call(owner,{action:"decidir",conversationId:"conv",cotizacionId:special.cotizacionId,version:1,decision:"rechazar",motivo:"No autorizado"});
    await expect(call(bot,{action:"aceptar",conversationId:"conv",cotizacionId:special.cotizacionId,version:1,mensajeId:"x"})).rejects.toMatchObject({code:"falta_aprobacion"});
  });
  it("J. semilla idempotente conserva edición administrativa y precios V3 pendientes",async()=>{
    await call(owner,{action:"sembrar"});const antes=await comercialLeer(owner);
    await call(owner,{action:"catalogo",producto:{...antes.productos.find(p=>p.id==="web")!,nombre:"Nombre editado"}});
    await call(owner,{action:"sembrar"});const despues=await comercialLeer(owner);
    expect(despues.productos.length).toBe(antes.productos.length);expect(despues.productos.find(p=>p.id==="web")!.nombre).toBe("Nombre editado");
    expect(despues.productos.filter(p=>p.id!=="estandar"&&p.id!=="extra").every(p=>p.precioEstado!=="aprobado")).toBe(true);
  });
  it("API bot: banderas, autenticación, ámbito y precios en servidor",async()=>{
    const url="http://127.0.0.1:55547/api/bot/comercial?conversationId=conv";
    expect((await botGet(new Request(url))).status).toBe(401);
    const headers={"x-api-key":process.env.BOT_API_KEY!,"content-type":"application/json"};
    expect((await botGet(new Request(url,{headers}))).status).toBe(200);
    expect((await botGet(new Request(url+"&spaceId=ajeno",{headers}))).status).toBe(422);
    expect((await botPost(new Request(url,{method:"POST",headers,body:JSON.stringify({action:"catalogo",requestKey:"forbidden",producto})}))).status).toBe(403);
    process.env.COMERCIAL_BOT_ORG_ID="no-autorizada";expect((await botGet(new Request(url,{headers}))).status).toBe(403);process.env.COMERCIAL_BOT_ORG_ID=owner.organizationId;
    process.env.COMERCIAL_V1_ENABLED="false";expect((await botGet(new Request(url,{headers}))).status).toBe(404);process.env.COMERCIAL_V1_ENABLED="true";
  });
  it('Propuesta flexible conserva subtotal, bloquea finalización y resuelve en nueva versión',async()=>{
    await call(owner,{action:'catalogo',producto});
    await call(owner,{action:'catalogo',producto:{...producto,id:'extra2',tipo:'extra',unico:29000,compatibles:['estandar']}});
    const pendientes=[{descripcion:'Enlaces sociales a medida',solicitud:'Cliente solicita enlaces adicionales',estado:'pendiente',unico:null,mensual:null}];
    const propuesta={conceptos:[{productoId:'estandar',cantidad:1},{productoId:'extra',cantidad:1,baseId:'estandar'},{productoId:'extra2',cantidad:1,baseId:'estandar'}],pendientes};
    const q=await preparar(propuesta);
    const ref={conversationId:'conv',cotizacionId:q.cotizacionId,version:1};
    expect(q.snapshot).toMatchObject({subtotalUnico:207900,unico:null,mensual:null});
    await expect(call(owner,{action:'decidir',...ref,decision:'aprobar',motivo:'Intento incompleto'})).rejects.toMatchObject({code:'importe_pendiente'});
    await expect(call(bot,{action:'aceptar',...ref,mensajeId:'x'})).rejects.toMatchObject({code:'falta_aprobacion'});
    await expect(call(bot,{action:'contratar',...ref})).rejects.toMatchObject({code:'falta_aceptacion'});
    await expect(preparar({...propuesta,pendientes:[{...pendientes[0],estado:'incluido',condiciones:'Incluido'}]})).rejects.toMatchObject({code:'sin_permiso'});
    const revisada=await call(owner,{action:'revisar',...ref,propuesta:{...propuesta,pendientes:[{...pendientes[0],estado:'cotizado',unico:15000,mensual:0,condiciones:'Dos enlaces adicionales'}]}});
    expect(revisada).toMatchObject({version:2,estado:'pendiente',snapshot:{unico:222900}});
    await call(owner,{action:'decidir',...ref,version:2,decision:'aprobar',motivo:'Alcance y precio completos'});
    const historia=await comercialLeer(owner,'conv',q.cotizacionId);
    expect(historia.versiones).toHaveLength(2);
    expect((historia.versiones.find(v=>v.version===1)!.snapshot as Snapshot).unico).toBeNull();
    await expect(comercialLeer({...bot,conversationId:'segundo'},'segundo',q.cotizacionId)).rejects.toMatchObject({code:'no_encontrada'});
  });
  it('Promoción administrativa versionada, consultable por Lukas y sin aviso al revisar',async()=>{
    await call(owner,{action:'catalogo',producto});
    const q=await preparar();
    const ref={conversationId:'conv',cotizacionId:q.cotizacionId,version:1};
    const promocion={nombre:'Lanzamiento sintético',descuento:20000,condiciones:'Una sola vez en instalación'};
    await expect(preparar({conceptos:[{productoId:'estandar',cantidad:1}],promocion})).rejects.toMatchObject({code:'sin_permiso'});
    await call(owner,{action:'revisar',...ref,propuesta:{conceptos:[{productoId:'estandar',cantidad:1}],promocion}});
    const revision=await comercialLeer(bot,'conv',q.cotizacionId);
    expect(revision.cotizaciones[0]).toMatchObject({estado:'pendiente',version:2,snapshot:{unico:129900,subtotalUnico:149900,promocion}});
    const [avisos]=await sql`select count(*)::int as n from comercial_evento where cotizacion_id=${q.cotizacionId} and action='aviso_aprobacion'`;
    expect(avisos!.n).toBe(0);
    await call(owner,{action:'decidir',...ref,version:2,decision:'aprobar',motivo:'Precio y promoción autorizados'});
    const consulta=await comercialLeer(bot,'conv',q.cotizacionId);
    expect(consulta.cotizaciones[0]).toMatchObject({estado:'aprobada',aprobada_version:2,snapshot:{unico:129900,promocion}});
    const versiones=await comercialLeer(owner,'conv',q.cotizacionId);
    expect((versiones.versiones.find(v=>v.version===1)!.snapshot as Snapshot).unico).toBe(149900);
    expect((await comercialLeer(owner)).productos.find(p=>p.id==='estandar')!.unico).toBe(149900);
    await expect(call(bot,{action:'revisar',...ref,version:2,propuesta:{conceptos:[{productoId:'estandar',cantidad:1}],promocion}})).rejects.toMatchObject({code:'sin_permiso'});
  });
  it("Aviso durable: consentimiento, duplicados, ventana y continuidad hasta pedido pendiente",async()=>{
    process.env.ZERNIO_WHATSAPP_ENABLED='true';
    await sql`insert into zernio_whatsapp_credentials(id,organization_id,account_ref,token_cipher,token_iv,token_tag,secret_cipher,secret_iv,secret_tag,enabled)
      values('cred-aviso',${owner.organizationId},'cuenta-sintetica','x','x','x','x','x','x',true)`;
    await sql`update conversation set channel='whatsapp',channel_thread_ref='hilo-sintetico',last_inbound_at=clock_timestamp(),ai_enabled=true where id='conv'`;
    const q=await preparar({conceptos:[{productoId:'estandar',cantidad:1}],especial:'Cafetería con materiales preparados'});
    const ref={conversationId:'conv',cotizacionId:q.cotizacionId,version:1};
    await expect(call(bot,{action:'solicitar_aprobacion',...ref,mensajeAvisoId:'inexistente'})).rejects.toMatchObject({code:'consentimiento_no_acreditado'});
    await sql`insert into message(id,organization_id,conversation_id,direction,text) values('consent-aviso',${owner.organizationId},'conv','in','Sí, avísame cuando mi cotización esté autorizada')`;
    await call(bot,{action:'solicitar_aprobacion',...ref,mensajeAvisoId:'consent-aviso'});
    const decision=comandoSchema.parse({action:'decidir',...ref,requestKey:'decision-aviso',decision:'aprobar',motivo:'Revisado'});
    await comercialEjecutar(owner,decision); await comercialEjecutar(owner,decision);
    await prepararAvisosComerciales(); await prepararAvisosComerciales();
    const jobs=await sql`select * from zernio_whatsapp_outbox where request_key like ${'comercial-aviso:'+q.cotizacionId+':%'}`;
    expect(jobs).toHaveLength(1);
    expect(await autorizarIntentoAviso(jobs[0]!.id)).toBe(true);
    await sql`update conversation set last_inbound_at=clock_timestamp()-interval '25 hours' where id='conv'`;
    expect(await autorizarIntentoAviso(jobs[0]!.id)).toBe(false);
    await sql`update conversation set last_inbound_at=clock_timestamp(),ai_enabled=false where id='conv'`;
    expect(await autorizarIntentoAviso(jobs[0]!.id)).toBe(false);
    await sql`update conversation set ai_enabled=true where id='conv'`;
    await barrerEnviosWhatsAppZernio();
    const [enviado]=await sql`select j.status,m.wa_message_id from zernio_whatsapp_outbox j join message m on m.id=j.message_id where j.id=${jobs[0]!.id}`;
    expect(enviado).toMatchObject({status:'completado',wa_message_id:'wamid-aviso-sintetico'});
    await barrerEnviosWhatsAppZernio();
    await sql`insert into message(id,organization_id,conversation_id,direction,text) values('accept-aviso',${owner.organizationId},'conv','in','Acepto esta propuesta')`;
    await call(bot,{action:'aceptar',...ref,mensajeId:'accept-aviso'});
    const pedido=await call(bot,{action:'contratar',...ref});
    expect(pedido).toMatchObject({pedido:{estado:'pendiente',enlace:null}});
    const sinConsentimiento=await sql`select count(*)::int as n from zernio_whatsapp_outbox j
      join comercial_evento e on e.data->>'jobId'=j.id where e.data->>'motivo'='consentimiento_no_acreditado'`;
    expect(sinConsentimiento[0]!.n).toBe(0);
    const otra=await preparar({conceptos:[{productoId:'estandar',cantidad:1}],especial:'Aviso incierto'});
    const r2={conversationId:'conv',cotizacionId:otra.cotizacionId,version:1};
    await sql`insert into message(id,organization_id,conversation_id,direction,text) values('consent-2',${owner.organizationId},'conv','in','Sí, avísame cuando mi cotización esté autorizada')`;
    await call(bot,{action:'solicitar_aprobacion',...r2,mensajeAvisoId:'consent-2'});
    await call(owner,{action:'decidir',...r2,decision:'aprobar',motivo:'Revisado'});
    vi.mocked(enviarTextoWhatsAppZernio).mockRejectedValueOnce(new Error('Timeout sintético'));
    await barrerEnviosWhatsAppZernio();
    const [incierto]=await sql`select status from zernio_whatsapp_outbox where request_key like ${'comercial-aviso:'+otra.cotizacionId+':%'}`;
    expect(incierto!.status).toBe('incierto');
    const llamadas=vi.mocked(enviarTextoWhatsAppZernio).mock.calls.length;
    await barrerEnviosWhatsAppZernio();
    expect(vi.mocked(enviarTextoWhatsAppZernio).mock.calls).toHaveLength(llamadas);
    process.env.ZERNIO_WHATSAPP_ENABLED='false';
  });
});
