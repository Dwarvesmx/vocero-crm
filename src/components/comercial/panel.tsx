"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { urlDeConversacion } from "@/lib/avisos-sistema";
import type { Comando, Producto, Propuesta, Snapshot } from "@/server/comercial/contracts";

type Cotizacion = { id: string; conversation_id: string; contact_id: string; version: number; estado: string; snapshot: Snapshot };
type Pedido = { id: string; cotizacion_id: string; version: number; estado: string; enlace: string | null; evidencia: string | null };
type Datos = { productos: Producto[]; cotizaciones: Cotizacion[]; pedidos: Pedido[]; eventos: {id:string;action:string;actor:string;data:unknown}[]; versiones: {version:number;snapshot:Snapshot}[] };
const dinero = (n: number | null) => n === null ? "Pendiente" : new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(n/100);
const field = "w-full rounded-md border bg-background p-2 text-sm";
export function ComercialPanel() {
  const [datos,setDatos] = useState<Datos>({productos:[],cotizaciones:[],pedidos:[],eventos:[],versiones:[]});
  const [vista,setVista] = useState("Catálogo y extras");
  const [mensaje,setMensaje] = useState(""); const [busy,setBusy] = useState(false);
  const [editor,setEditor] = useState<Producto | null>(null);
  const [detalle,setDetalle] = useState<Datos | null>(null);
  const reintentos = useRef(new Map<string,string>());
  const cargar = useCallback(async () => {
    const r = await fetch("/api/comercial"); const d = await r.json();
    if (!r.ok) throw Error(d.error?.message ?? "Error de consulta"); setDatos(d);
  },[]);
  useEffect(() => { cargar().catch(e => setMensaje(String(e.message))); },[cargar]);
  async function ejecutar(cmd: Omit<Comando,"requestKey">) {
    setBusy(true);setMensaje("");
    const payload = JSON.stringify(cmd);
    const requestKey = reintentos.current.get(payload) ?? crypto.randomUUID();
    reintentos.current.set(payload,requestKey);
    try {
      const r = await fetch("/api/comercial",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...cmd,requestKey})});
      const d = await r.json(); if (!r.ok) throw Error(d.error?.message ?? "No se pudo guardar");
      await cargar();reintentos.current.delete(payload);setMensaje("Guardado");return true;
    } catch(e) { setMensaje(e instanceof Error ? e.message : "Error"); return false; }
    finally {setBusy(false);}
  }
  const enviar = (cmd: Record<string,unknown>) => ejecutar(cmd as Omit<Comando,"requestKey">);
  return <main className="mx-auto w-full max-w-6xl space-y-5 overflow-auto p-5">
    <h1 className="text-2xl font-semibold">Comercial</h1>
    <p className="text-sm text-muted-foreground">Cotiza con alcance y condiciones autorizados. Aceptar una propuesta no confirma el pago.</p>
    <nav className="flex flex-wrap gap-2" aria-label="Vistas comerciales">{["Catálogo y extras","Cotizaciones y aprobaciones","Contrataciones y pagos"].map(v => <Button key={v} variant={vista===v?"default":"outline"} onClick={()=>{setVista(v);setDetalle(null);}}>{v}</Button>)}</nav>
    <p role="status" className="text-sm">{mensaje}</p>
    {vista === "Catálogo y extras" && <>
      <div className="flex gap-2"><Button disabled={busy} onClick={()=>enviar({action:"sembrar"})}>Cargar catálogo V3</Button><Button variant="outline" onClick={()=>setEditor({id:"",nombre:"",descripcion:"",tipo:"producto",caracteristicas:[],exclusiones:[],unico:null,mensual:0,precioEstado:"pendiente",limites:{},compatibles:[],activo:true,condiciones:""})}>Nuevo concepto</Button></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Concepto</th><th>Único MXN</th><th>Mensual MXN</th><th>Precio</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{datos.productos.map(p=><tr className="border-b" key={p.id}><td className="p-2">{p.nombre}<small className="block">{p.tipo}</small></td><td>{dinero(p.unico)}</td><td>{dinero(p.mensual)}</td><td>{p.precioEstado}</td><td>{p.activo?"Activo":"Inactivo"}</td><td><Button variant="outline" onClick={()=>setEditor(p)}>Editar {p.id}</Button></td></tr>)}</tbody></table></div>
      {editor && <CatalogoEditor key={editor.id} producto={editor} busy={busy} cerrar={()=>setEditor(null)} guardar={async producto=>{if(await enviar({action:"catalogo",producto}))setEditor(null);}} />}
    </>}
    {vista === "Cotizaciones y aprobaciones" && <>
      <Preparar productos={datos.productos} busy={busy} guardar={p=>enviar({action:"preparar",...p})} />
      {datos.cotizaciones.map(q=><article className="space-y-3 rounded-lg border p-4" key={q.id}>
        <h2 className="font-semibold">{q.id} · v{q.version} · {q.estado}</h2>
        <a className="underline" href={urlDeConversacion(q.conversation_id)}>Abrir conversación</a>
        <p>Contacto: {q.contact_id} · Único {dinero(q.snapshot.unico)} · Mensual {dinero(q.snapshot.mensual)}</p>
        <ul>{q.snapshot.conceptos.map((c,i)=><li key={i}>{c.cantidad} × {c.producto.nombre}</li>)}</ul>
        <p>Subtotal conocido: {dinero(q.snapshot.subtotalUnico??q.snapshot.unico)} · Mensual {dinero(q.snapshot.subtotalMensual??q.snapshot.mensual)}</p><ul>{(q.snapshot.pendientes??[]).map((p,i)=><li key={i}>{p.descripcion}: {p.estado} · {dinero(p.unico)} · {p.solicitud} · {p.condiciones}</li>)}</ul><p className="whitespace-pre-wrap">{q.snapshot.condiciones}</p>
        {q.estado === "pendiente" && <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);enviar({action:"decidir",cotizacionId:q.id,conversationId:q.conversation_id,version:q.version,decision:f.get("decision"),motivo:f.get("motivo")});}}><Input name="motivo" placeholder="Motivo de decisión" aria-label={`Motivo ${q.id}`} required /><select name="decision" className={field}><option value="aprobar">Aprobar versión</option><option value="rechazar">Rechazar versión</option></select><Button disabled={busy}>Registrar decisión</Button></form>}
        {q.estado !== "aceptada" && <details><summary>Modificar propuesta (crea nueva versión)</summary><Revision q={q} busy={busy} guardar={propuesta=>enviar({action:"revisar",conversationId:q.conversation_id,cotizacionId:q.id,version:q.version,propuesta})}/></details>}
        {q.estado === "aprobada" && <form className="flex gap-2" onSubmit={e=>{e.preventDefault();enviar({action:"aceptar",conversationId:q.conversation_id,cotizacionId:q.id,version:q.version,mensajeId:new FormData(e.currentTarget).get("mensajeId")});}}><Input name="mensajeId" required placeholder="ID del mensaje de aceptación" aria-label="Mensaje de aceptación"/><Button disabled={busy}>Registrar aceptación</Button></form>}
        {q.estado === "aceptada" && <Button disabled={busy} onClick={()=>enviar({action:"contratar",conversationId:q.conversation_id,cotizacionId:q.id,version:q.version})}>Crear contratación</Button>}
        <Button variant="outline" onClick={async()=>{const r=await fetch(`/api/comercial?cotizacionId=${q.id}`);if(r.ok)setDetalle(await r.json());}}>Ver historial {q.id}</Button>
      </article>)}
      {detalle && <section className="rounded-lg border p-4"><h2>Historial de versiones y decisiones</h2>{detalle.versiones.map(v=><p key={v.version}>v{v.version}: {dinero(v.snapshot.unico)} + {dinero(v.snapshot.mensual)} mensual · {v.snapshot.condiciones}</p>)}{detalle.eventos.map(e=><div key={e.id}><strong>{e.action} · {e.actor}</strong><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(e.data,null,2)}</pre></div>)}</section>}
    </>}
    {vista === "Contrataciones y pagos" && datos.pedidos.map(p=>{
      const q=datos.cotizaciones.find(q=>q.id===p.cotizacion_id);
      return <article key={p.id} className="space-y-3 rounded-lg border p-4"><h2 className="font-semibold">Pedido {p.id} · {p.estado}</h2><p>Cotización {p.cotizacion_id} · v{p.version}</p>
        {p.enlace && <a className="underline" href={p.enlace} rel="noreferrer" target="_blank">Enlace de cobro autorizado</a>}
        {p.evidencia && <p>Evidencia: {p.evidencia}</p>}
        {q && !["pagado","cancelado"].includes(p.estado) && <form className="space-y-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);enviar({action:"pago",conversationId:q.conversation_id,cotizacionId:q.id,version:q.version,estado:f.get("estado"),...(f.get("enlace")?{enlace:f.get("enlace")} : {}),...(f.get("evidencia")?{evidencia:f.get("evidencia")} : {})});}}>
          <label className="block">Estado de pago<select name="estado" defaultValue={p.estado} className={field}><option value="pendiente">Pendiente de pago</option><option value="en_verificacion">Pago en verificación</option><option value="pagado">Pagado</option><option value="cancelado">Cancelado</option></select></label>
          <label className="block">Enlace HTTPS aprobado<Input name="enlace" type="url" defaultValue={p.enlace??""}/></label><label className="block">Evidencia revisada (referencia)<Input name="evidencia" defaultValue={p.evidencia??""}/></label><Button disabled={busy}>Guardar cobro</Button>
        </form>}
      </article>;
    })}
  </main>;
}
function CatalogoEditor({producto:p,busy,cerrar,guardar}:{producto:Producto;busy:boolean;cerrar:()=>void;guardar:(p:Producto)=>void}) {
  return <form className="space-y-3 rounded-lg border p-4" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{guardar({...p,id:String(f.get("id")),nombre:String(f.get("nombre")),descripcion:String(f.get("descripcion")),tipo:f.get("tipo") as Producto["tipo"],caracteristicas:String(f.get("caracteristicas")).split("\n").filter(Boolean),exclusiones:String(f.get("exclusiones")).split("\n").filter(Boolean),condiciones:String(f.get("condiciones")),unico:f.get("unico")===""?null:Number(f.get("unico")),mensual:f.get("mensual")===""?null:Number(f.get("mensual")),precioEstado:f.get("precioEstado") as Producto["precioEstado"],compatibles:String(f.get("compatibles")).split(",").map(s=>s.trim()).filter(Boolean),limites:JSON.parse(String(f.get("limites"))),activo:f.get("activo")==="on"});}catch{e.currentTarget.reportValidity();}}}>
    <h2 className="font-semibold">Editar concepto</h2>
    {([['id','Identificador'],['nombre','Nombre'],['descripcion','Descripción'],['caracteristicas','Características (una por línea)'],['exclusiones','Exclusiones (una por línea)'],['condiciones','Condiciones comerciales']] as const).map(([k,label])=><label className="block" key={k}>{label}<textarea required className={field} name={k} defaultValue={Array.isArray(p[k])?(p[k] as string[]).join("\n"):String(p[k])}/></label>)}
    <label className="block">Tipo<select name="tipo" defaultValue={p.tipo} className={field}>{["producto","extra","especializacion"].map(v=><option key={v}>{v}</option>)}</select></label>
    <label className="block">Precio único en centavos (vacío: pendiente)<Input name="unico" type="number" min="0" step="1" defaultValue={p.unico??""}/></label>
    <label className="block">Mensualidad en centavos (0: sin mensualidad)<Input name="mensual" type="number" min="0" step="1" defaultValue={p.mensual??""}/></label>
    <label className="block">Autorización de precio<select name="precioEstado" defaultValue={p.precioEstado} className={field}>{["pendiente","orientativo","aprobado"].map(v=><option key={v}>{v}</option>)}</select></label>
    <label className="block">Límites por concepto (JSON)<Input name="limites" defaultValue={JSON.stringify(p.limites)} required/></label>
    <label className="block">Compatible con identificadores (separados por coma)<Input name="compatibles" defaultValue={p.compatibles.join(",")}/></label>
    <label className="block"><input name="activo" type="checkbox" defaultChecked={p.activo}/> Activo</label><Button disabled={busy}>Guardar concepto</Button><Button type="button" variant="outline" onClick={cerrar}>Cerrar</Button>
  </form>;
}
function Preparar({productos,busy,guardar}:{productos:Producto[];busy:boolean;guardar:(p:{conversationId:string;propuesta:Propuesta})=>void}) {
  return <form className="space-y-2 rounded-lg border p-4" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const base=String(f.get("productoId"));guardar({conversationId:String(f.get("conversationId")),propuesta:{conceptos:[{productoId:base,cantidad:Number(f.get("cantidad"))},...Array.from(new Set([...(f.get("extra")?[String(f.get("extra"))]:[]),...f.getAll("otrosExtras").map(String)])).map(productoId=>({productoId,cantidad:Number(f.get("extraCantidad")),baseId:base}))],pendientes:String(f.get("pendientesNuevos")??"").split("\n").filter(x=>x.trim()).map(descripcion=>({descripcion,solicitud:descripcion,estado:"pendiente",unico:null,mensual:null}))}});}}><h2>Nueva cotización</h2><Input name="conversationId" required placeholder="ID de conversación" aria-label="Conversación"/><select name="productoId" className={field} aria-label="Producto">{productos.filter(p=>p.activo&&p.tipo!=="extra").map(p=><option value={p.id} key={p.id}>{p.nombre}</option>)}</select><Input name="cantidad" type="number" min="1" max="1000" defaultValue="1" aria-label="Cantidad"/>
    <label className="block">Extra opcional<select className={field} name="extra"><option value="">Sin extra</option>{productos.filter(p=>p.activo&&p.tipo==="extra").map(p=><option key={p.id} value={p.id}>{p.nombre} (para {p.compatibles.join(", ")})</option>)}</select></label><Input name="extraCantidad" type="number" min="1" max="1000" defaultValue="1" aria-label="Cantidad de extras"/><label>Otros extras (selección múltiple)<select multiple name="otrosExtras" className={field}>{productos.filter(p=>p.activo&&p.tipo==='extra').map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label><label>Conceptos pendientes (uno por línea)<textarea name="pendientesNuevos" className={field}/></label><Button disabled={busy}>Preparar cotización</Button></form>;
}
function Revision({q,busy,guardar}:{q:Cotizacion;busy:boolean;guardar:(p:Propuesta)=>void}) {
  const [error,setError]=useState("");
  return <form className="space-y-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const propuesta={conceptos:JSON.parse(String(f.get("conceptos"))),condiciones:String(f.get("condiciones")),especial:String(f.get("especial"))||undefined,pendientes:JSON.parse(String(f.get("pendientes"))),...(f.get("unico")!==""?{importeUnico:Number(f.get("unico"))}:{}),...(f.get("mensual")!==""?{importeMensual:Number(f.get("mensual"))}:{})};guardar(propuesta);setError("");}catch{setError("Revisa los conceptos JSON");}}}>
    <label className="block">Conceptos y extras (productoId, cantidad y baseId para extras)<textarea name="conceptos" className={field} defaultValue={JSON.stringify(q.snapshot.conceptos.map(c=>({productoId:c.productoId,cantidad:c.cantidad,...(c.baseId?{baseId:c.baseId}:{})})),null,2)}/></label>
    <label className="block">Conceptos especiales (JSON): descripcion, solicitud, estado (pendiente/cotizado/incluido/rechazado), unico y mensual en centavos o null, condiciones<textarea name="pendientes" className={field} defaultValue={JSON.stringify(q.snapshot.pendientes??[],null,2)}/></label><label className="block">Condiciones<textarea name="condiciones" required className={field} defaultValue={q.snapshot.condiciones}/></label><label className="block">Desarrollo especial<Input name="especial" defaultValue={q.snapshot.especial??""}/></label>
    <label className="block">Importe único final en centavos<Input type="number" min="0" name="unico" defaultValue={q.snapshot.unico??""}/></label><label className="block">Mensualidad final en centavos<Input type="number" min="0" name="mensual" defaultValue={q.snapshot.mensual??""}/></label><p role="alert">{error}</p><Button disabled={busy}>Crear revisión pendiente</Button>
  </form>;
}
