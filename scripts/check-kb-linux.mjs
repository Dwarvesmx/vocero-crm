// Ejecutar SOLO dentro de la imagen final Linux, sin red, app, secretos ni BD.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
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
const fixture=await readFile("/fixtures/servicios.pdf");
const chunks=await extraerDocumento("servicios.pdf","application/pdf",fixture);
assert.ok(chunks.join(" ").includes("1200 MXN"));
await assert.rejects(()=>readFile("/fixtures/sin-texto.pdf").then(data=>extraerDocumento("sin-texto.pdf","application/pdf",data)),/texto/);
console.log(JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,nativeCanvas:true,productionExtractor:true,pdfText:true,emptyPdfRejected:true,fixtureSha256:createHash("sha256").update(fixture).digest("hex"),chunks:chunks.length}));
