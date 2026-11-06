import { describe,it,expect } from "vitest";
import { modelQuote,openRouterProvider,dollars } from "@/server/demo-center/infra/openrouter";
const model={id:"openai/gpt-4.1-mini",context_length:1047576,architecture:{input_modalities:["image","text","file"],output_modalities:["text"]},supported_parameters:["max_tokens"],top_provider:{context_length:1047576,max_completion_tokens:32768},pricing:{prompt:"0.0000004",completion:"0.0000016",web_search:"0.01",input_cache_read:"0.0000001"}};
describe("Cotización con metadatos públicos OpenRouter",()=>{
 it("usa USD/token y reserva el contexto completo más 512 tokens",()=>{expect(modelQuote(model,model.id).reserve).toBe("419850");});
 it("rechaza tarifas incompletas, negativas, infinitas y adicionales no acotables",()=>{
  for(const pricing of [{prompt:"0.1"},{...model.pricing,request:"0.1"},{...model.pricing,prompt:"NaN"},{...model.pricing,prompt:"-1"},{...model.pricing,web_search:"Infinity"}])expect(()=>modelQuote({...model,pricing},model.id)).toThrow();
  expect(()=>dollars("1e9999")).toThrow();
 });
 it("desactiva búsqueda y herramientas y envía topes de precio en USD/millón",async()=>{
  const q=modelQuote(model,model.id);let calls=0;
  const p=openRouterProvider("synthetic",model.id,async (_url,init)=>{calls++;const b=JSON.parse(String(init?.body));expect(b.plugins).toEqual([{id:"web",enabled:false}]);expect(b.tools).toEqual([]);expect(b.max_tokens).toBe(512);expect(b.provider.max_price.prompt).toBeCloseTo(0.4);expect(b.provider.max_price.completion).toBeCloseTo(1.6);return Response.json({});});
  await p.execute([{role:"user",content:"Hola"}],q);
  await expect(p.execute([{role:"user",content:"x".repeat(q.context)}],q)).rejects.toThrow("context_too_large");expect(calls).toBe(1);
 });
 it("distingue catálogo ausente de indisponibilidad del proveedor",async()=>{
  await expect(openRouterProvider("synthetic",model.id,async()=>Response.json({data:[]})).quote()).rejects.toThrow("model_price_unavailable");
  await expect(openRouterProvider("synthetic",model.id,async()=>new Response(null,{status:503})).quote()).rejects.toThrow("openrouter_unavailable");
 });
});
