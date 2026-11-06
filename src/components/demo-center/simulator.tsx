"use client";
import { microToUsd } from "./format";
import { useCallback, useEffect, useState, useRef } from "react";
type Detail = {budgets?:Array<{scope:string;budget:string;used:string;available:string}>;operations?:Array<{id:string;status:string;model:string;reserved_amount:string;actual_amount:string|null;provider_request_id:string|null;evidence:unknown}>;session:{id:string;state:string;assistant_name:string;profile_version:number};turns:Array<{id:string;user_text:string;assistant_text:string}>};
export function DemoSimulator({ spaceId }: { spaceId: string }) {
  const startKey = useRef<string | null>(null);
  const pending = useRef(false);
  const [providerStatusError,setProviderStatusError] = useState(false);
  const [providerStatus,setProviderStatus] = useState<{enabled:boolean;model:string|null;configured:boolean}|null>(null);
  const [sessions,setSessions] = useState<Array<{id:string;state:string}>>([]);
  const [detail,setDetail] = useState<Detail | null>(null);
  const [text,setText] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [retry,setRetry] = useState<{key:string;text:string} | null>(null);
  const url = "/api/demo-center/simulator?spaceId="+encodeURIComponent(spaceId);
  const load = useCallback(async (id?: string) => {
    const response = await fetch(url+(id ? "&sessionId="+encodeURIComponent(id):""));
    const value = await response.json();
    if (!response.ok) throw new Error(value.error?.message ?? "Error de consulta");
    if (!id && !Array.isArray(value)) throw new Error("No se pudo consultar el historial.");
    if (id) setDetail(value); else setSessions(value);
  }, [url]);
  useEffect(() => { void load().catch(e=>setError(String(e))); },[load]);
  useEffect(() => {
    let live = true;
    void fetch("/api/demo-center/simulator?status=1", { cache: "no-store" }).then(r => {
      if (!r.ok) throw new Error("provider_status_unavailable");
      return r.json();
    }).then(value => {
      if (live) { setProviderStatus(value); setProviderStatusError(false); }
    }).catch(() => { if (live) { setProviderStatus(null); setProviderStatusError(true); } });
    return () => { live = false; };
  }, []);
  async function run(action:"start"|"send"|"close") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);setError("");
    const request = action==="send" ? retry?.text===text ? retry : {key:crypto.randomUUID(),text} : null;
    if (request) setRetry(request);
    if (action === "start" && !startKey.current) startKey.current = crypto.randomUUID();
    try {
      const body = action==="start" ? {action,spaceId,requestKey:startKey.current} :
        action==="close" ? {action,spaceId,sessionId:detail?.session.id} :
        {action,spaceId,sessionId:detail?.session.id,requestKey:request!.key,text:request!.text,provider:"openrouter"};
      const response = await fetch("/api/demo-center/simulator",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Error de simulación");
      await load(result.id);await load();
      if (action === "start") startKey.current = null;
      if(action==="send" && result.status==="settled"){setText("");setRetry(null);}
      if(action==="send" && result.status==="released"){setRetry(null);setError("La operación no se envió porque cambió su autorización. Revisa la configuración y vuelve a intentarlo.");}
    } catch(e) {setError(e instanceof Error?e.message:"Error de simulación");} finally {pending.current=false;setBusy(false);}
  }
  return <section className="space-y-4 rounded border p-4">
    <h2 className="font-semibold">Demo Center · OpenRouter</h2>
    <p role="status">{providerStatusError ? "No se pudo consultar la configuración de IA." :
      !providerStatus ? "Consultando configuración de IA…" :
      <>Modelo configurado: {providerStatus.model || "Sin configurar"} · {providerStatus.enabled ? "Modo real habilitado" : "Modo real deshabilitado"}</>}</p>
    <p>IA real sujeta a habilitación del administrador y reserva presupuestal. El modelo se obtiene de Ajustes → IA.</p>
    <p role="alert">{error}</p>
    <button className="rounded border px-3 py-2" disabled={busy} onClick={()=>void run("start")}>Iniciar sesión</button>
    <label className="block">Historial de sesiones<select className="block w-full rounded border bg-background p-2" value={detail?.session.id ?? ""} disabled={busy}
      onChange={e=>{if(e.target.value)void load(e.target.value).catch(e=>setError(String(e)));}}>
      <option value="">Seleccionar sesión</option>{sessions.map(s=><option key={s.id} value={s.id}>{s.id.slice(0,8)} · {s.state}</option>)}
    </select></label>
    {detail && <>
      <p>{detail.session.assistant_name} · versión {detail.session.profile_version} · {detail.session.state}</p>
      <ol className="space-y-3">{detail.turns.map(t=><li key={t.id}><p className="whitespace-pre-wrap">Tú: {t.user_text}</p><p className="whitespace-pre-wrap rounded bg-muted p-2">Asistente: {t.assistant_text}</p></li>)}</ol>
      <ul className="text-sm">{detail.budgets?.map(b=><li key={b.scope}>{b.scope==="global"?"Global":"Espacio"} · Presupuesto: USD {microToUsd(b.budget)} · Usado o reservado: USD {microToUsd(b.used)} · Disponible: USD {microToUsd(b.available)}</li>)}</ul>
      <ul className="space-y-2">{detail.operations?.map(op=><li key={op.id} className="rounded border p-2 text-sm">
        {op.model} · {op.status} · Reserva: USD {microToUsd(op.reserved_amount)} · Costo confirmado: {op.actual_amount === null ? "pendiente" : "USD "+microToUsd(op.actual_amount)}
        {(op.status==="uncertain" || op.status==="reserved") && <button type="button" className="ml-2 underline" disabled={busy || (op.status==="uncertain" && !op.provider_request_id)} onClick={async()=>{
          setBusy(true);setError("");
          try {const res=await fetch("/api/demo-center/simulator",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"reconcile",spaceId,operationId:op.id})});
            const data=await res.json();if(!res.ok)throw new Error(data.error?.message ?? "No se pudo conciliar");await load(detail.session.id);
          }catch(e){setError(String(e));}finally{setBusy(false);}
        }}>Conciliar costo</button>}
        <details><summary>Uso reportado</summary><pre className="overflow-auto">{JSON.stringify(op.evidence,null,2)}</pre></details>
      </li>)}</ul>
      <form data-temporary onSubmit={e=>{e.preventDefault();void run("send");}} className="space-y-2">
        <label className="block">Mensaje<textarea className="block w-full rounded border bg-background p-2" required maxLength={2000} value={text} onChange={e=>setText(e.target.value)} disabled={busy || detail.session.state!=="active"} /></label>
        <button className="rounded border px-3 py-2" disabled={busy || detail.session.state!=="active"}>{busy?"Procesando…":"Enviar"}</button>
      </form>
      <button className="rounded border px-3 py-2" disabled={busy || detail.session.state!=="active"} onClick={()=>void run("close")}>Cerrar sesión</button>
    </>}
  </section>;
}
