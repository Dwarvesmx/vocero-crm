// Prueba de componentes reales; APIs simuladas y navegador local, sin credenciales.
import {build} from "esbuild";
import {createServer} from "node:http";
import {once} from "node:events";
import assert from "node:assert/strict";
import {chromium} from "playwright";
const result=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AgentClient}from'./src/components/agent/agent-client';createRoot(document.getElementById('app')).render(<AgentClient/>);`,loader:"tsx",resolveDir:process.cwd()},banner:{js:"window.process={env:{}};"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",define:{"process.env.NODE_ENV":'"development"'},alias:{"@":"./src"}});
const server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/bundle.js"?"text/javascript":"text/html");res.end(req.url==="/bundle.js"?result.outputFiles[0].text:'<a id="exit" href="/otro">Salir</a><div id="app"></div><script src="/bundle.js"></script>');});
server.listen(0,"127.0.0.1");await once(server,"listening");
let browser;
try {
 browser=await chromium.launch({channel:"chrome",headless:true});
 const page=await browser.newPage();
 page.on("pageerror",e=>console.error("UI error:",e.message));
 page.setDefaultTimeout(10000);
 let profile={enabled:false,name:"Lukas",tone:"Consultivo",instructions:"Instrucciones originales",escalationRules:"Escala según el negocio",greeting:"Hola",role:"calificador",tools:["escalar"]};
 let mode="fail",pending,docs=[],loadFailed=false,kbFail=true,kb=[];
 await page.route("**/api/**",async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==="/api/kb"&&req.method()==="POST") {
   if(kbFail)return route.fulfill({status:503,json:{error:{message:"Error simulado KB"}}});
   const entry={...req.postDataJSON(),id:"kb_test"};kb.push(entry);return route.fulfill({status:201,json:{entry}});
  }
  if(url.pathname==="/api/kb/documents"&&req.method()==="POST") {docs=[{id:"kbd_test",name:"servicios.txt",sizeBytes:100,status:"ready",enabled:true,error:null}];return route.fulfill({status:201,json:{document:docs[0]}});}
  if(url.pathname==="/api/kb/documents/kbd_test") {
   if(req.method()==="GET")return route.fulfill({json:{document:docs[0],preview:"Datos aprobados <script>no ejecutar</script>"}});
   if(req.method()==="PATCH") {docs[0].enabled=req.postDataJSON().enabled;return route.fulfill({json:{document:docs[0]}});}
   if(req.method()==="DELETE") {docs=[];return route.fulfill({json:{ok:true}});}
  }
  if(url.pathname==="/api/agent/profile"&&req.method()==="PUT") {
   if(mode==="fail")return route.fulfill({status:503,json:{error:{message:"Error simulado de guardado"}}});
   if(mode==="pending")await new Promise(resolve=>{pending=resolve;});
   profile={...profile,...req.postDataJSON()};return route.fulfill({json:{ok:true}});
  }
  if(url.pathname==="/api/agent/profile" && !loadFailed){loadFailed=true;return route.fulfill({status:503,json:{}});}
  const payload=url.pathname==="/api/agent/profile"?{profile,aiConfigured:true}:url.pathname==="/api/kb"?{entries:kb}:url.pathname==="/api/kb/size"?{chars:0,warnAt:24000,warning:false}:url.pathname==="/api/kb/documents"?{documents:docs}:null;
  return route.fulfill({json:payload});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole("button",{name:"Reintentar",exact:true}).click();
 const instructions=page.locator("#agent-instructions"),save=page.getByRole("button",{name:"Guardar comportamiento"});
 await instructions.fill("Instrucciones nuevas conservadas");
 await page.getByText("Cambios sin guardar",{exact:true}).waitFor();
 await save.click();await page.getByRole("alert").filter({hasText:"Error simulado"}).waitFor();
 assert.equal(await instructions.inputValue(),"Instrucciones nuevas conservadas");
 assert.equal(await page.getByText("Guardado ✓",{exact:true}).count(),0);
 // La navegación cancelada conserva el borrador.
 page.once("dialog",dialog=>dialog.dismiss());await page.locator("#exit").click();
 assert.equal(new URL(page.url()).pathname,"/");
 mode="pending";await save.click();
 await page.getByRole("button",{name:"Guardando…"}).waitFor();
 assert.equal(await page.getByRole("button",{name:"Guardando…"}).isDisabled(),true);
 // Permite editar durante la solicitud: no afirmar que la nueva edición fue guardada.
 await instructions.fill("Edición posterior al envío");
 assert.ok(pending);pending();
 await save.waitFor();
 assert.equal(await instructions.inputValue(),"Edición posterior al envío");
 await page.getByText("Cambios sin guardar",{exact:true}).waitFor();
 mode="success";await save.click();await page.getByText("Guardado ✓",{exact:true}).waitFor();
 assert.equal(profile.instructions,"Edición posterior al envío");
 assert.equal(await page.getByText("Cambios sin guardar",{exact:true}).count(),0);
 assert.equal(profile.escalationRules,"Escala según el negocio");
 const block=page.getByPlaceholder("Horarios, direcciones, políticas…");
 await block.fill("Texto de conocimiento que no debe perderse");
 await page.getByRole("button",{name:"Agregar bloque"}).click();
 await page.getByRole("alert").filter({hasText:"Error simulado KB"}).waitFor();
 assert.equal(await block.inputValue(),"Texto de conocimiento que no debe perderse");
 await page.getByText("Cambios sin guardar",{exact:true}).waitFor();
 kbFail=false;await page.getByRole("button",{name:"Agregar bloque"}).click();
 await page.getByText("Conocimiento guardado.",{exact:true}).waitFor();
 assert.equal(await block.inputValue(),"");
 await page.getByLabel("Documento de conocimiento").setInputFiles("tests/fixtures/kb-v1/servicios.txt");
 await page.getByRole("button",{name:"Incorporar documento"}).click();
 await page.getByText(/servicios.txt · 1 KB · Listo/).waitFor();
 await page.getByRole("button",{name:"Ver texto extraído"}).click();
 await page.getByText("Datos aprobados <script>no ejecutar</script>",{exact:true}).waitFor();
 await page.getByRole("button",{name:"Deshabilitar",exact:true}).click();
 await page.getByRole("button",{name:"Habilitar",exact:true}).waitFor();
 page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"Eliminar",exact:true}).click();
 await page.getByText("Todavía no hay documentos.").waitFor();
 console.log("PASS: documentos carga/vista previa segura/deshabilitar/eliminar.");
 console.log("PASS: rechazo conserva borrador; navegación protegida; reserva de guardado; edición concurrente; ACK real sin sobrescribir escalado.");
} finally {await browser?.close();server.close();}
