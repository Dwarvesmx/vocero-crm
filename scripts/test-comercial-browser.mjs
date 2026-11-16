import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import postgres from "postgres";

if(process.env.COMERCIAL_TEST!=="1"||!process.env.DATABASE_URL?.includes("127.0.0.1:55546/comercial_ui"))throw Error("Solo laboratorio sintético");
const origin="http://127.0.0.1:55547",sql=postgres(process.env.DATABASE_URL,{max:1,connection:{TimeZone:"UTC"}});
const browser=await chromium.launch({channel:"chrome",headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
 const r=await context.request.post(origin+"/api/auth/sign-up/email",{headers:{origin},data:{email:"comercial@example.invalid",password:"synthetic-test-password",name:"Operador sintético"}});
 assert.equal(r.ok(),true,`Registro sintético falló ${r.status()}`);
 const [member]=await sql`select organization_id,user_id from member limit 1`;assert.ok(member);
 const org=member.organization_id;
 await sql`insert into contact(id,organization_id,wa_identity,name) values('ui-contact',${org},'525500000000','Cliente sintético')`;
 await sql`insert into conversation(id,organization_id,contact_id) values('ui-conv',${org},'ui-contact')`;
 await page.goto(origin+"/comercial");await page.getByRole("heading",{name:"Comercial",exact:true}).waitFor();
 const loaded=page.waitForResponse(r=>r.url().endsWith("/api/comercial")&&r.request().method()==="POST");
 await page.getByRole("button",{name:"Cargar catálogo V3"}).click();const seed=await loaded;assert.equal(seed.status(),200,await seed.text());await page.getByRole("button",{name:"Editar tarjeta",exact:true}).waitFor();
 await page.getByRole("button",{name:"Editar web",exact:true}).click();
 await page.getByLabel("Autorización de precio").selectOption("aprobado");
 await page.getByRole("button",{name:"Guardar concepto",exact:true}).click();await page.getByRole("button",{name:"Guardar concepto",exact:true}).waitFor({state:"hidden"});
 await page.getByRole("button",{name:"Cotizaciones y aprobaciones",exact:true}).click();
 await page.getByLabel("Conversación",{exact:true}).fill("ui-conv");await page.getByLabel("Producto",{exact:true}).selectOption("web");
 let perdido=false;const keys=[];
 await page.route("**/api/comercial",async route=>{
   const request=route.request();
   if(request.method()==="POST"&&request.postDataJSON()?.action==="preparar"){
     keys.push(request.postDataJSON().requestKey);
     if(!perdido){perdido=true;assert.equal((await route.fetch()).status(),200);await route.abort();return;}
   }
   await route.continue();
 });
 await page.getByRole("button",{name:"Preparar cotización",exact:true}).click();await page.getByRole("status").filter({hasText:/fetch/i}).waitFor();
 await page.getByRole("button",{name:"Preparar cotización",exact:true}).click();await page.getByText(/v1 · aprobada/).waitFor();
 assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
 const [quotes]=await sql`select count(*)::int as n from comercial_cotizacion where organization_id=${org}`;assert.equal(quotes.n,1);
 assert.equal(await page.getByRole("link",{name:"Abrir conversación",exact:true}).getAttribute("href"),"/inbox?conversation=ui-conv");
 await page.getByText("Modificar propuesta (crea nueva versión)",{exact:true}).click();
 await page.getByLabel("Desarrollo especial",{exact:true}).fill("Alcance especial sintético");
 await page.getByRole("button",{name:"Crear revisión pendiente",exact:true}).click();await page.getByText(/v2 · pendiente/).waitFor();
 await page.getByPlaceholder("Motivo de decisión").fill("Alcance e importe cotejados");
 await page.getByRole("button",{name:"Registrar decisión",exact:true}).click();await page.getByText(/v2 · aprobada/).waitFor();
 await sql`insert into message(id,organization_id,conversation_id,direction,text) values('ui-aceptacion',${org},'ui-conv','in','Acepto la cotización v2')`;
 await page.getByLabel("Mensaje de aceptación",{exact:true}).fill("ui-aceptacion");await page.getByRole("button",{name:"Registrar aceptación",exact:true}).click();await page.getByText(/v2 · aceptada/).waitFor();
 await page.getByRole("button",{name:"Crear contratación",exact:true}).click();await page.getByRole("status").filter({hasText:"Guardado"}).waitFor();
 await page.getByRole("button",{name:"Contrataciones y pagos",exact:true}).click();await page.getByRole("heading",{name:/Pedido .*pendiente/}).waitFor();
 await page.getByLabel("Enlace HTTPS aprobado",{exact:true}).fill("https://payments.example.com/prueba-sintetica");await page.getByLabel("Estado de pago").selectOption("en_verificacion");
 await page.getByRole("button",{name:"Guardar cobro",exact:true}).click();await page.getByRole("link",{name:"Enlace de cobro autorizado",exact:true}).waitFor();
 assert.equal(await page.getByRole("link",{name:"Enlace de cobro autorizado"}).getAttribute("href"),"https://payments.example.com/prueba-sintetica");
 await page.getByLabel("Estado de pago").selectOption("pagado");await page.getByRole("button",{name:"Guardar cobro",exact:true}).click();await page.getByRole("status").filter({hasText:"falta evidencia"}).waitFor();
 await page.getByLabel("Evidencia revisada (referencia)",{exact:true}).fill("Transferencia sintética cotejada por administrador");await page.getByRole("button",{name:"Guardar cobro",exact:true}).click();await page.getByRole("heading",{name:/Pedido .*pagado/}).waitFor();
 await page.getByRole("button",{name:"Cotizaciones y aprobaciones",exact:true}).click();await page.getByRole("button",{name:/Ver historial/}).click();await page.getByRole("heading",{name:"Historial de versiones y decisiones"}).waitFor();
 const dir=resolve("../tmp/comercial-evidencia");mkdirSync(dir,{recursive:true});
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){await page.setViewportSize(viewport);await page.screenshot({path:resolve(dir,`comercial-${viewport.width}.png`),fullPage:true});}
 // Sesión real member: lectura, escritura y página administrativa denegadas.
 await sql`update member set role='member' where user_id=${member.user_id}`;
 const forbidden=await context.request.get(origin+"/api/comercial");assert.equal(forbidden.status(),403);
 const denied=await context.request.post(origin+"/api/comercial",{headers:{origin},data:{action:"sembrar",requestKey:"member-denied"}});assert.equal(denied.status(),403);
 const csrf=await context.request.post(origin+"/api/comercial",{headers:{origin:"https://evil.example.com"},data:{action:"sembrar",requestKey:"csrf-denied"}});assert.equal(csrf.status(),403);
 const anonymous=await browser.newContext();assert.equal((await anonymous.request.get(origin+"/api/comercial")).status(),401);await anonymous.close();
 assert.deepEqual(errors,[]);console.log("UI real: catálogo → aprobación v2 → aceptación → contratación → enlace → pago con evidencia; permisos/CSRF y capturas 1440/390 aprobados.");
 await context.close();
}finally{await browser.close();await sql.end();}
