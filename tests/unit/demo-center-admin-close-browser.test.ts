import { build } from "esbuild";
import { chromium } from "playwright";
import { expect, it } from "vitest";

it("cierra desde el panel una sesión WhatsApp aunque la invitación haya caducado", async () => {
 const bundle=await build({stdin:{contents:`import React from "react"; import {createRoot} from "react-dom/client";
 import {InvitacionesDemoWeb} from "./src/components/demo-center/web-admin";
 createRoot(document.getElementById("root")).render(<InvitacionesDemoWeb spaceId="pizza"/>);`,
 loader:"tsx",resolveDir:process.cwd()},jsx:"automatic",bundle:true,write:false});
 const browser=await chromium.launch({channel:"chrome",headless:true});
 try{
  const page=await browser.newPage();
  let closed=false, requests=0;
  await page.route("**/*",async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname==="/")return route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});
   if(url.pathname==="/api/demo-center/web"){
    if(req.method()==="POST"){requests++;expect(req.postDataJSON()).toMatchObject({action:"revoke",sessionId:"web",spaceId:"pizza"});closed=true;return route.fulfill({json:{ok:true}});}
    return route.fulfill({json:{enabled:true,sessions:[{id:"web",state:"expired",expires_at:"2026-01-01",idle_deadline:"2026-01-01",turns:0,cost:"0",held:"0",pending:null,
     whatsapp:{state:closed?"revoked":"active",mode:closed?"blocked":"demo",generation:1,turns:0,cost:"0",pending:0,dispatchErrors:0}}]}});
   }
   return route.abort();
  });
  await page.goto("https://admin.test/");await page.addScriptTag({content:bundle.outputFiles[0]!.text});
  await page.getByRole("button",{name:"Finalizar y revocar WhatsApp"}).click();
  await page.getByRole("button",{name:"Confirmar"}).click();
  await page.getByText(/En cuarentena/).waitFor();
  expect(requests).toBe(1);
  expect(await page.getByRole("button",{name:"Finalizar y revocar WhatsApp"}).count()).toBe(0);
 }finally{await browser.close();}
},30000);
