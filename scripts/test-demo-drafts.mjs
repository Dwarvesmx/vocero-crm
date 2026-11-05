import { build } from "esbuild";
import { chromium } from "playwright";
import { strict as assert } from "node:assert";

const source = `
import React from "react";
import { createRoot } from "react-dom/client";
import { DemoCenterAdmin } from "./src/components/demo-center/admin";
const space = {id:"a",name:"Pizza",commercialName:"Pizza",sector:"Restaurante",description:"Ficticio",status:"draft",generation:1,visualIdentity:{color:"#ff0000"}};
const detail = {space,profiles:[],authorizations:[],audit:[],limits:null};
const root = createRoot(document.getElementById("root"));
window.__renderSpace = (other) => {
  const selected = other ? {...space,id:"b",name:"Casa",commercialName:"Casa"} : space;
  root.render(<DemoCenterAdmin key={selected.id} spaces={[space,{...space,id:"b",name:"Casa"}]}
    detail={{...detail,space:selected}} globalPolicy={null} exceptions={[]}
    knowledge={{documents:[],entries:[],fragments:[]}} global={false} />);
};
window.__renderSpace(false);
`;
const bundle = await build({
  stdin: { contents: source, loader: "tsx", resolveDir: process.cwd() },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  plugins: [{ name: "next-fixtures", setup(build) {
    build.onResolve({filter:/^next\/(navigation|link)$/}, args => ({path:args.path,namespace:"fixture"}));
    build.onLoad({filter:/.*/,namespace:"fixture"}, args => ({
      contents: args.path === "next/link"
        ? 'import React from "react"; export default function Link(p){return React.createElement("a",p)}'
        : 'export function useRouter(){return {push:(href)=>{window.__nav=href},refresh:()=>{}}}',
      loader: "jsx", resolveDir: process.cwd(),
    }));
  }}],
});
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => {
    window.__confirm = 0;
    window.confirm = () => { window.__confirm++; return false; };
    window.fetch = async (url, options) => ({
      ok: true,
      json: async () => options?.method === "POST"
        ? { id: "a", generation: 2 } : { fragments: [] },
    });
  });
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const tab = name => page.getByRole("tab", {name});
  const changeSpace = async () => page.getByRole("link", {name:/Casa/}).click();
  const confirms = () => page.evaluate(() => window.__confirm);
  await changeSpace();
  assert.equal(await confirms(), 0, "sin edición");
  await tab("Conocimiento").click();
  const query = page.getByLabel("Consultar fragmentos");
  await query.fill("Galactica");
  await changeSpace();
  assert.equal(await confirms(), 0, "escribir búsqueda");
  await query.fill("");
  await changeSpace();
  assert.equal(await confirms(), 0, "borrar búsqueda");
  await query.fill("Galactica");
  await page.getByRole("button", {name:"Buscar"}).click();
  await changeSpace();
  assert.equal(await confirms(), 0, "ejecutar búsqueda");
  await tab("General").click();
  const name = page.getByLabel("Nombre comercial");
  await name.fill("Modificado");
  await changeSpace();
  assert.equal(await confirms(), 1, "cambio real protegido");
  await name.fill("Pizza");
  await changeSpace();
  assert.equal(await confirms(), 1, "restaurar original");
  await name.fill("Pizza nueva");
  await page.getByRole("button", {name:"Guardar espacio"}).click();
  await page.getByText("Espacio actualizado.").waitFor();
  await changeSpace();
  assert.equal(await confirms(), 1, "guardado confirmado");
  await tab("Asistente").click();
  await page.getByLabel("Nombre", {exact:true}).fill("NOVA");
  await tab("General").click();
  await name.fill("Pizza otra");
  await page.getByRole("button", {name:"Guardar espacio"}).click();
  await page.getByText("Espacio actualizado.").waitFor();
  await changeSpace();
  assert.equal(await confirms(), 2, "borrador de otra sección protegido");
  await page.evaluate(() => window.__renderSpace(true));
  await page.getByRole("heading", {name: "Información del espacio"}).waitFor();
  await page.waitForFunction(() => document.querySelector('input[name="commercialName"]')?.value === "Casa");
  assert.equal(await page.getByLabel("Nombre comercial").inputValue(), "Casa", "los espacios no comparten borradores");
  console.log("Interacción sintética: 7 escenarios de borradores y aislamiento entre espacios aprobados.");
} finally { await browser.close(); }
