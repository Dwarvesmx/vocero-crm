import { z } from "zod";
import type { SimulatorMessage } from "../domain/simulator";

/** USD expresados a 18 decimales; rechaza precisión que no se pueda representar. */
export function dollars(value: unknown): bigint {
  if (typeof value !== "string" && typeof value !== "number") throw new Error("price_unverifiable");
  if (String(value).length > 100) throw new Error("price_unverifiable");
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) throw new Error("price_unverifiable");
  const exponent = Number(match[3] ?? 0) - (match[2]?.length ?? 0) + 18;
  if (Math.abs(exponent) > 40) throw new Error("price_unverifiable");
  const digits = BigInt(match[1]! + (match[2] ?? ""));
  if (exponent < 0) {
    const divisor = 10n ** BigInt(-exponent);
    if (digits % divisor) throw new Error("price_unverifiable");
    return digits / divisor;
  }
  return digits * 10n ** BigInt(exponent);
}
export const microCeil = (scaled: bigint) => (scaled + 10n ** 12n - 1n) / (10n ** 12n);
export type Quote = { model: string; prompt: string; completion: string; context: number; output: number; reserve: string };
export interface DemoProvider {
  quote(): Promise<Quote>;
  execute(messages: SimulatorMessage[], quote: Quote): Promise<ProviderResult>;
  reconcile(id: string): Promise<{ cost: string; usage: unknown }>;
}
export type ProviderResult = { id: string | null; text: string | null; cost: string | null; usage: unknown; model: string };
const modelSchema = z.object({
  id:z.string(), context_length:z.number().int().positive().max(10000000),
  architecture:z.object({input_modalities:z.array(z.string()),output_modalities:z.array(z.string())}),
  supported_parameters:z.array(z.string()),
  top_provider:z.object({context_length:z.number().int().positive().max(10000000).nullable().optional(),max_completion_tokens:z.number().int().positive().nullable().optional()}).optional(),
  pricing:z.record(z.string(),z.union([z.string(),z.number()])),
});
export function modelQuote(value: unknown, model: string): Quote {
  const m=modelSchema.parse(value);
  if(model.includes(":") || model.startsWith("openrouter/")) throw Error("model_unsupported");
  if(m.id!==model || !m.architecture.input_modalities.includes("text") ||
    !m.architecture.output_modalities.includes("text") || !m.supported_parameters.includes("max_tokens")) throw Error("model_unsupported");
  const prompt=m.pricing.prompt,completion=m.pricing.completion;
  if(prompt===undefined || completion===undefined) throw Error("price_unverifiable");
  // Texto simple sin plugins, herramientas ni cargos adicionales conocidos.
  for(const [key,value] of Object.entries(m.pricing)) {
    dollars(value); // incluso tarifas de capacidades desactivadas deben ser válidas
    if(!["prompt","completion","input_cache_read","input_cache_write","web_search"].includes(key) && dollars(value)!==0n) throw Error("extra_pricing_unsupported");
  }
  if(m.pricing.input_cache_write && dollars(m.pricing.input_cache_write)>0n) throw Error("extra_pricing_unsupported");
  if(m.pricing.input_cache_read && dollars(m.pricing.input_cache_read)>dollars(prompt)) throw Error("extra_pricing_unsupported");
  const context=Math.min(m.context_length,m.top_provider?.context_length ?? m.context_length);
  const output=Math.min(512,context,m.top_provider?.max_completion_tokens ?? 512);
  const reserve=microCeil(dollars(prompt)*BigInt(context)+dollars(completion)*BigInt(output));
  if(reserve<=0n || reserve>9223372036854775807n) throw Error("price_unverifiable");
  return {model,prompt:String(prompt),completion:String(completion),context,output,reserve:String(reserve)};
}
export function openRouterProvider(token: string, model: string, transport: typeof fetch = fetch): DemoProvider {
  async function json(path: string, init?: RequestInit) {
    const response=await transport("https://openrouter.ai/api/v1/"+path,{
      ...init,redirect:"error",signal:AbortSignal.timeout(45000),
      headers:{"authorization":"Bearer "+token,"content-type":"application/json"},
    });
    if(!response.ok) throw Error("openrouter_unavailable");
    return response.json();
  }
  return {
    async quote(){
      const result=await json("models");
      const entry=Array.isArray(result.data)?result.data.find((m:{id?:string})=>m.id===model):null;
      if (!entry) throw Error("model_price_unavailable");
      try { return modelQuote(entry,model); } catch { throw Error("price_unverifiable"); }
    },
    async execute(messages,quote){
      // Texto UTF-8 acotado más margen de encuadre; no sustituye al costo confirmado.
      if (messages.reduce((n,m)=>n+Buffer.byteLength(m.content,"utf8")+256,256)+quote.output>quote.context) throw Error("context_too_large");
      const result=await json("chat/completions",{method:"POST",body:JSON.stringify({
        model:quote.model,messages,stream:false,max_tokens:quote.output,
        tools:[],plugins:[{id:"web",enabled:false}],
        provider:{allow_fallbacks:false,require_parameters:true,max_price:{
          prompt:Number(quote.prompt)*1000000,completion:Number(quote.completion)*1000000,request:0,image:0,
        }},
        usage:{include:true},
      })});
      const text=result.choices?.[0]?.message?.content;
      const cost=result.usage?.cost;
      return {id:typeof result.id==="string"?result.id:null,text:typeof text==="string"?text:null,
        cost:typeof cost==="number"||typeof cost==="string"?String(cost):null,
        usage:result.usage??null,model:typeof result.model==="string"?result.model:model};
    },
    async reconcile(id){
      const result=await json("generation?id="+encodeURIComponent(id));
      if(result.data?.id!==id || result.data?.total_cost==null) throw Error("cost_unavailable");
      return {cost:String(result.data.total_cost),usage:result.data};
    },
  };
}
