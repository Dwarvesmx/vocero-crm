// Ejecutar SOLO dentro de la imagen final Linux, sin red, app, secretos ni BD.
import assert from "node:assert/strict";
import {readFile,readdir,copyFile} from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {extraerDocumento} from "/app/kb-extract.mjs";
assert.equal(process.platform,"linux");
assert.equal(process.arch,"x64");
const fromApp=createRequire("/app/kb-extract.mjs");
const fromParser=createRequire(fromApp.resolve("pdf-parse"));
const fromPdfjs=createRequire(fromParser.resolve("pdfjs-dist/package.json"));
const canvas=fromPdfjs("@napi-rs/canvas");
assert.equal(canvas.createCanvas(1,1).width,1);
if (process.argv.includes("--package-native")) {
  // NFT puede aplanar los enlaces pnpm de canvas: su primer intento de carga
  // es este binario relativo. Copiar la dependencia YA fijada/instalada, sin
  // descargas ni cambios de versiones, a cada instancia emitida de canvas.
  const fromCanvas=createRequire(fromPdfjs.resolve("@napi-rs/canvas"));
  const native=fromCanvas.resolve("@napi-rs/canvas-linux-x64-musl");
  let copies=0;
  async function walk(dir) {
    for(const item of await readdir(dir,{withFileTypes:true})) {
      const file=path.join(dir,item.name);
      if(item.isDirectory()) await walk(file);
      else if(item.name==="js-binding.js" && dir.endsWith("/@napi-rs/canvas")) {
        await copyFile(native,path.join(dir,"skia.linux-x64-musl.node"));copies++;
      }
    }
  }
  await walk("/app/.next/standalone/node_modules");
  assert.ok(copies>0,"El standalone no contiene el cargador de canvas");
  console.log(JSON.stringify({packagedNativeCanvasCopies:copies,platform:"linux/amd64-musl"}));
} else {
const fixture=await readFile("/fixtures/servicios.pdf");
const chunks=await extraerDocumento("servicios.pdf","application/pdf",fixture);
assert.ok(chunks.join(" ").includes("1200 MXN"));
await assert.rejects(()=>readFile("/fixtures/sin-texto.pdf").then(data=>extraerDocumento("sin-texto.pdf","application/pdf",data)),/texto/);
console.log(JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,nativeCanvas:true,productionExtractor:true,pdfText:true,emptyPdfRejected:true,fixtureSha256:createHash("sha256").update(fixture).digest("hex"),chunks:chunks.length}));

}
