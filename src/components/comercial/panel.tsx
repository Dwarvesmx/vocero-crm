"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {navegarComercial,navegacionInicial} from './navegacion-comercial';
import { PropuestaEditor } from './propuesta-editor';
import {mxnACentavos,centavosAMxn} from '@/lib/mxn';
import { urlDeConversacion } from "@/lib/avisos-sistema";
import type { Comando, Producto, Propuesta, Snapshot } from "@/server/comercial/contracts";

type Cotizacion = { id: string; conversation_id: string; contact_id: string; version: number; estado: string; snapshot: Snapshot };
type Pedido = { id: string; cotizacion_id: string; version: number; estado: string; enlace: string | null; evidencia: string | null };
type Datos = { productos: Producto[]; cotizaciones: Cotizacion[]; pedidos: Pedido[]; eventos: {id:string;action:string;actor:string;data:unknown}[]; versiones: {version:number;snapshot:Snapshot}[] };
const dinero = (n: number | null) => n === null ? "Pendiente" : new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(n/100);
const field = "w-full rounded-md border bg-background p-2 text-sm";
export function ComercialPanel() {
  const [datos,setDatos] = useState<Datos>({productos:[],cotizaciones:[],pedidos:[],eventos:[],versiones:[]});
  const [vista,setVista] = useState("Cotizaciones y aprobaciones");
  const [navegacion,navegar] = useReducer(navegarComercial,navegacionInicial);
  const [mensaje,setMensaje] = useState(""); const [busy,setBusy] = useState(false);
  const [editor,setEditor] = useState<Producto | null>(null);
  const [detalle,setDetalle] = useState<Datos | null>(null);
  const [contactos,setContactos] = useState<Record<string,string>>({});
  const [creacionVersion,setCreacionVersion] = useState(0);
  const [busqueda,setBusqueda] = useState('');
  const [sucios,setSucios] = useState<Set<string>>(()=>new Set());
  const salidaConfirmada=useRef(false);
  const borradoresActuales=useRef(navegacion.borradores);
  borradoresActuales.current=navegacion.borradores;
  const marcarSucio=(id:string)=>{salidaConfirmada.current=false;setSucios(prev=>prev.has(id)?prev:new Set([...prev,id]));};
  const limpiarSucio=(id:string)=>setSucios(prev=>{const siguiente=new Set(prev);siguiente.delete(id);return siguiente;});
  const reintentos = useRef(new Map<string,string>());
  const cargar = useCallback(async () => {
    const r = await fetch("/api/comercial"); const d = await r.json();
    if (!r.ok) throw Error(d.error?.message ?? "Error de consulta");
    setDatos(prev=>({...d,cotizaciones:[...d.cotizaciones,...prev.cotizaciones.filter(q=>borradoresActuales.current[q.id]&&!d.cotizaciones.some((actual:Cotizacion)=>actual.id===q.id))]}));
  },[]);
  useEffect(() => { cargar().catch(e => setMensaje(String(e.message))); },[cargar]);
  useEffect(()=>{let activo=true;fetch('/api/contacts?archived=true').then(r=>r.ok?r.json():null).then(d=>{if(activo&&Array.isArray(d?.contacts))setContactos(Object.fromEntries(d.contacts.filter((c:{id?:unknown;name?:unknown;phone?:unknown})=>typeof c.id==='string'&&((typeof c.name==='string'&&c.name.trim())||(typeof c.phone==='string'&&c.phone.trim()))).map((c:{id:string;name?:string;phone?:string})=>[c.id,c.name?.trim()||c.phone?.trim()||c.id])));}).catch(()=>{});return ()=>{activo=false;};},[]);
  useEffect(()=>{if(!sucios.size)return;const avisar=(e:BeforeUnloadEvent)=>{if(!salidaConfirmada.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',avisar);return ()=>window.removeEventListener('beforeunload',avisar);},[sucios]);
  useEffect(()=>{if(!sucios.size)return;const salir=(e:MouseEvent)=>{const origen=e.target instanceof Element?e.target.closest('a[href]'):null;if(!origen||!(origen instanceof HTMLAnchorElement)||origen.target==='_blank'||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||e.button!==0)return;const destino=new URL(origen.href,window.location.href);if(destino.href===window.location.href)return;if(window.confirm('Hay borradores sin guardar. ¿Salir de Comercial?'))salidaConfirmada.current=true;else{e.preventDefault();e.stopPropagation();}};document.addEventListener('click',salir,true);return ()=>document.removeEventListener('click',salir,true);},[sucios]);
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
  return <main className="mx-auto h-full min-w-0 w-full max-w-6xl space-y-4 overflow-y-auto p-3 sm:p-5 [overflow-wrap:anywhere]">
    <h1 className="text-2xl font-semibold">Comercial</h1>
    <p className="text-sm text-muted-foreground">Cotiza con alcance y condiciones autorizados. Aceptar una propuesta no confirma el pago.</p>
    <nav className="flex flex-wrap gap-2" aria-label="Vistas comerciales">{["Catálogo y extras","Cotizaciones y aprobaciones","Contrataciones y pagos"].map(v => <Button key={v} variant={vista===v?"default":"outline"} disabled={busy} className="min-h-11 h-auto max-w-full whitespace-normal px-4 py-2" onClick={()=>{setVista(v);setDetalle(null);}}>{v}</Button>)}</nav>
    <p role="status" className="text-sm">{mensaje}</p>
    {vista === "Catálogo y extras" && <>
      <div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={busy} onClick={()=>enviar({action:"sembrar"})}>Cargar catálogo V3</Button><Button variant="outline" onClick={()=>setEditor({id:"",nombre:"",descripcion:"",tipo:"producto",caracteristicas:[],exclusiones:[],unico:null,mensual:0,precioEstado:"pendiente",limites:{},compatibles:[],activo:true,condiciones:""})}>Nuevo concepto</Button></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Concepto</th><th>Único MXN</th><th>Mensual MXN</th><th>Precio</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{datos.productos.map(p=><tr className="border-b" key={p.id}><td className="p-2">{p.nombre}<small className="block">{p.tipo}</small></td><td>{dinero(p.unico)}</td><td>{dinero(p.mensual)}</td><td>{p.precioEstado}</td><td>{p.activo?"Activo":"Inactivo"}</td><td><Button variant="outline" onClick={()=>setEditor(p)}>Editar {p.id}</Button></td></tr>)}</tbody></table></div>
      {editor && <CatalogoEditor key={editor.id} producto={editor} busy={busy} cerrar={()=>setEditor(null)} guardar={async producto=>{if(await enviar({action:"catalogo",producto}))setEditor(null);}} />}
    </>}
    <section hidden={vista !== "Cotizaciones y aprobaciones"} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Cotizaciones</h2>
        {navegacion.panel==='lista' ? <Button type="button" className="min-h-11" disabled={busy} onClick={()=>navegar({tipo:'nueva'})}>Nueva cotización</Button> : <Button type="button" className="min-h-11" variant="outline" disabled={busy} onClick={()=>navegar({tipo:'lista'})}>Volver a cotizaciones</Button>}
      </div>
      <p hidden={!sucios.size} className="text-sm text-muted-foreground">Los borradores se conservan mientras permanezcas en Comercial. Guarda la revisión antes de salir.</p>
      <div hidden={navegacion.panel!=='nueva'} className="min-w-0" onChangeCapture={()=>marcarSucio('nueva')} onClickCapture={e=>{if(e.target instanceof Element&&e.target.closest('button[type="button"]'))marcarSucio('nueva');}}><Preparar key={creacionVersion} productos={datos.productos} busy={busy} resultado={mensaje} guardar={async p=>{if(await enviar({action:"preparar",...p})){setCreacionVersion(v=>v+1);limpiarSucio('nueva');navegar({tipo:'lista'});}}} /></div>
      {navegacion.panel!=='nueva'&&navegacion.panel!=='editar'&&<label className="block">Buscar cotización o contacto<Input type="search" value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Referencia o nombre"/></label>}
      {datos.cotizaciones.length===0 && navegacion.panel!=='nueva' && <p>No hay cotizaciones todavía.</p>}
      {datos.cotizaciones.map(q=><article hidden={navegacion.panel==='nueva'||(navegacion.panel==='editar'&&navegacion.seleccion!==q.id)||(navegacion.panel!=='editar'&&!!busqueda.trim()&&!`${q.id} ${q.contact_id} ${contactos[q.contact_id]??''}`.toLocaleLowerCase().includes(busqueda.trim().toLocaleLowerCase()))} className="min-w-0 space-y-3 rounded-lg border p-3 sm:p-4" key={q.id}>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-all font-semibold">Cotización {q.id.slice(0,8)} · v{q.version} · {q.estado}</h3><p className="break-all text-sm text-muted-foreground">Contacto: {contactos[q.contact_id]??q.contact_id}</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={busy} aria-label={`Abrir cotización ${q.id.slice(0,8)}`} aria-expanded={navegacion.seleccion===q.id&&navegacion.panel==='detalle'} onClick={()=>{setDetalle(null);navegar({tipo:'ver',id:q.id});}}>Abrir</Button>{(q.estado!=='aceptada'||navegacion.borradores[q.id])&&<Button type="button" className="min-h-11" disabled={busy} aria-label={`Modificar cotización ${q.id.slice(0,8)}`} aria-expanded={navegacion.seleccion===q.id&&navegacion.panel==='editar'} onClick={()=>navegar({tipo:'editar',id:q.id,version:q.version,snapshot:q.snapshot})}>{q.estado==='aceptada'?'Ver borrador':'Modificar propuesta'}</Button>}</div></div>
        <p className="text-sm">Subtotal conocido: {dinero(q.snapshot.conocidoDespuesDescuento??q.snapshot.subtotalUnico??q.snapshot.unico)}{q.snapshot.subtotalMensual?` · Mensual ${dinero(q.snapshot.subtotalMensual)}`:''} · {(q.snapshot.pendientes??[]).filter(p=>p.estado==='pendiente').length} pendientes</p>
        <div hidden={!(navegacion.seleccion===q.id&&(navegacion.panel==='detalle'||navegacion.panel==='editar'))} className="min-w-0 space-y-3 break-words [overflow-wrap:anywhere] [&_button]:min-h-11 [&_button]:h-auto [&_button]:max-w-full [&_button]:whitespace-normal [&_input]:min-w-0 [&_select]:min-w-0 [&_textarea]:min-w-0">
        <div hidden={navegacion.panel==='editar'} className="space-y-3"><h3 className="break-all font-semibold">Referencia completa: {q.id} · v{q.version} · {q.estado}</h3>
        <a className="underline" href={urlDeConversacion(q.conversation_id)}>Abrir conversación</a>
        <p>Contacto: {q.contact_id} · Único {dinero(q.snapshot.unico)} · Mensual {dinero(q.snapshot.mensual)}</p>
        <ul>{q.snapshot.conceptos.map((c,i)=><li key={i}>{c.cantidad} × {c.producto.nombre} · Unitario {dinero(c.producto.unico)} · Importe {dinero(c.producto.unico===null?null:c.producto.unico*c.cantidad)} · {c.producto.precioEstado} · {c.producto.condiciones}</li>)}</ul>
        {q.snapshot.promocion&&<section aria-label="Promoción de la versión"><p>Subtotal antes de descuentos: {dinero(q.snapshot.subtotalUnico)}</p><p>{['aprobada','aceptada'].includes(q.estado)?'Promoción autorizada':'Promoción en revisión'}: {q.snapshot.promocion.nombre} · −{dinero(q.snapshot.promocion.descuento)}</p><p>{q.snapshot.promocion.condiciones}</p><p>Subtotal conocido después del descuento: {dinero(q.snapshot.conocidoDespuesDescuento)}</p></section>}{!!q.snapshot.ajusteUnico&&<p>Ajuste administrativo único: {dinero(q.snapshot.ajusteUnico)}</p>}{!!q.snapshot.ajusteMensual&&<p>Ajuste administrativo mensual: {dinero(q.snapshot.ajusteMensual)}</p>}<p>Subtotal antes de descuentos: {dinero(q.snapshot.subtotalUnico??q.snapshot.unico)} · Mensual {dinero(q.snapshot.subtotalMensual??q.snapshot.mensual)}</p><ul>{(q.snapshot.pendientes??[]).map((p,i)=><li key={i}>{p.descripcion}: {p.estado} · {p.estado==="incluido"?"Sin cargo adicional":p.estado==="rechazado"?"No se contrata":dinero(p.unico)} · {p.solicitud} · {p.condiciones}</li>)}</ul><p className="whitespace-pre-wrap">{q.snapshot.condiciones}</p>
        {q.estado === "pendiente" && <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);enviar({action:"decidir",cotizacionId:q.id,conversationId:q.conversation_id,version:q.version,decision:f.get("decision"),motivo:f.get("motivo")});}}><Input name="motivo" placeholder="Motivo de decisión" aria-label={`Motivo ${q.id}`} required /><select name="decision" className={field}><option value="aprobar">Aprobar versión</option><option value="rechazar">Rechazar versión</option></select><Button disabled={busy}>Registrar decisión</Button></form>}
        </div>
        {navegacion.borradores[q.id] && <section hidden={navegacion.panel!=='editar'||navegacion.seleccion!==q.id} aria-label={`Editor de cotización ${q.id.slice(0,8)}`} onChangeCapture={()=>marcarSucio(q.id)} onClickCapture={e=>{if(e.target instanceof Element&&e.target.closest('button[type="button"]')&&!e.target.closest('[data-descartar]'))marcarSucio(q.id);}} className="min-w-0 space-y-3 rounded-lg border p-3"><h3 className="font-semibold">Modificar cotización {q.id.slice(0,8)} · versión {navegacion.borradores[q.id]!.version}</h3>{(navegacion.borradores[q.id]!.version!==q.version||q.estado==='aceptada')&&<p role="alert">La cotización cambió o fue aceptada. Tu borrador se conserva; revisa la versión antes de descartarlo y volver a editar.</p>}
          <PropuestaEditor snapshot={navegacion.borradores[q.id]!.snapshot} productos={datos.productos} busy={busy||q.estado==='aceptada'} resultado={mensaje} guardar={async propuesta=>{const ok=await enviar({action:"revisar",conversationId:q.conversation_id,cotizacionId:q.id,version:navegacion.borradores[q.id]!.version,propuesta});if(ok){limpiarSucio(q.id);navegar({tipo:'guardado',id:q.id});}}}/>
          <Button type="button" data-descartar variant="outline" disabled={busy} onClick={()=>{if(window.confirm('¿Descartar el borrador de esta cotización?')){limpiarSucio(q.id);navegar({tipo:'descartar',id:q.id});}}}>Descartar borrador</Button></section>}
        <div hidden={navegacion.panel==='editar'} className="space-y-3">
        {q.estado === "aprobada" && <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();enviar({action:"aceptar",conversationId:q.conversation_id,cotizacionId:q.id,version:q.version,mensajeId:new FormData(e.currentTarget).get("mensajeId")});}}><Input name="mensajeId" required placeholder="ID del mensaje de aceptación" aria-label="Mensaje de aceptación"/><Button disabled={busy}>Registrar aceptación</Button></form>}
        {q.estado === "aceptada" && <Button disabled={busy} onClick={()=>enviar({action:"contratar",conversationId:q.conversation_id,cotizacionId:q.id,version:q.version})}>Crear contratación</Button>}
        <Button variant="outline" onClick={async()=>{const r=await fetch(`/api/comercial?cotizacionId=${q.id}`);if(r.ok)setDetalle(await r.json());}}>Ver historial {q.id.slice(0,8)}</Button>
        </div>
        </div>
      </article>)}
      {detalle && navegacion.panel==='detalle' && <section className="min-w-0 break-words [overflow-wrap:anywhere] rounded-lg border p-3 sm:p-4"><h2>Historial de versiones y decisiones</h2>{detalle.versiones.map(v=><div className="border-b py-2" key={v.version}><p>v{v.version}: {dinero(v.snapshot.unico)} + {dinero(v.snapshot.mensual)} mensual · {v.snapshot.condiciones}</p><ul>{v.snapshot.conceptos.map((c,i)=><li key={i}>{c.cantidad} × {c.producto.nombre} · {dinero(c.producto.unico)} · {c.producto.condiciones}</li>)}{(v.snapshot.pendientes??[]).map((p,i)=><li key={i}>{p.descripcion} · {p.solicitud} · {p.estado} · {dinero(p.unico)} · {p.condiciones}</li>)}</ul>{v.snapshot.promocion&&<p>Promoción de esta versión: {v.snapshot.promocion.nombre} −{dinero(v.snapshot.promocion.descuento)} · {v.snapshot.promocion.condiciones}</p>}</div>)}{detalle.eventos.map(e=><div key={e.id}><strong>{e.action} · {e.actor}</strong><p>{e.data && typeof e.data==='object' && 'motivo' in e.data ? String(e.data.motivo) : ''}</p></div>)}</section>}
    </section>
    {vista === "Contrataciones y pagos" && datos.pedidos.map(p=>{
      const q=datos.cotizaciones.find(q=>q.id===p.cotizacion_id);
      return <article key={p.id} className="min-w-0 space-y-3 break-words [overflow-wrap:anywhere] rounded-lg border p-3 sm:p-4"><h2 className="font-semibold">Pedido {p.id} · {p.estado}</h2><p>Cotización {p.cotizacion_id} · v{p.version}</p>
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
  return <form className="space-y-3 rounded-lg border p-4" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{guardar({...p,id:String(f.get("id")),nombre:String(f.get("nombre")),descripcion:String(f.get("descripcion")),tipo:f.get("tipo") as Producto["tipo"],caracteristicas:String(f.get("caracteristicas")).split("\n").filter(Boolean),exclusiones:String(f.get("exclusiones")).split("\n").filter(Boolean),condiciones:String(f.get("condiciones")),unico:f.get("unico")===""?null:mxnACentavos(String(f.get("unico"))),mensual:f.get("mensual")===""?null:mxnACentavos(String(f.get("mensual"))),precioEstado:f.get("precioEstado") as Producto["precioEstado"],compatibles:String(f.get("compatibles")).split(",").map(s=>s.trim()).filter(Boolean),limites:JSON.parse(String(f.get("limites"))),activo:f.get("activo")==="on"});}catch{e.currentTarget.reportValidity();}}}>
    <h2 className="font-semibold">Editar concepto</h2>
    {([['id','Identificador'],['nombre','Nombre'],['descripcion','Descripción'],['caracteristicas','Características (una por línea)'],['exclusiones','Exclusiones (una por línea)'],['condiciones','Condiciones comerciales']] as const).map(([k,label])=><label className="block" key={k}>{label}<textarea required className={field} name={k} defaultValue={Array.isArray(p[k])?(p[k] as string[]).join("\n"):String(p[k])}/></label>)}
    <label className="block">Tipo<select name="tipo" defaultValue={p.tipo} className={field}>{["producto","extra","especializacion"].map(v=><option key={v}>{v}</option>)}</select></label>
    <label className="block">Precio único MXN (vacío: pendiente)<Input name="unico" type="number" min="0" step="0.01" defaultValue={centavosAMxn(p.unico)}/></label>
    <label className="block">Mensualidad MXN (0: sin mensualidad)<Input name="mensual" type="number" min="0" step="0.01" defaultValue={centavosAMxn(p.mensual)}/></label>
    <label className="block">Autorización de precio<select name="precioEstado" defaultValue={p.precioEstado} className={field}>{["pendiente","orientativo","aprobado"].map(v=><option key={v}>{v}</option>)}</select></label>
    <label className="block">Límites por concepto (JSON)<Input name="limites" defaultValue={JSON.stringify(p.limites)} required/></label>
    <label className="block">Compatible con identificadores (separados por coma)<Input name="compatibles" defaultValue={p.compatibles.join(",")}/></label>
    <label className="block"><input name="activo" type="checkbox" defaultChecked={p.activo}/> Activo</label><Button disabled={busy}>Guardar concepto</Button><Button type="button" variant="outline" onClick={cerrar}>Cerrar</Button>
  </form>;
}
function Preparar({productos,busy,resultado,guardar}:{productos:Producto[];busy:boolean;resultado:string;guardar:(p:{conversationId:string;propuesta:Propuesta})=>void}){
 const [conversationId,setConversationId]=useState('');
 return <section className="min-w-0 space-y-2 rounded-lg border p-3 sm:p-4 [overflow-wrap:anywhere] [&_button]:min-h-11 [&_button]:h-auto [&_button]:max-w-full [&_button]:whitespace-normal [&_input]:min-w-0 [&_select]:min-w-0 [&_textarea]:min-w-0"><h2>Nueva cotización</h2><label>Conversación<Input value={conversationId} onChange={e=>setConversationId(e.target.value)} required/></label><PropuestaEditor productos={productos} busy={busy||!conversationId.trim()} resultado={resultado} guardar={propuesta=>guardar({conversationId,propuesta})}/></section>;
}
