"use client";
import {z} from 'zod';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {mxnACentavos,centavosAMxn} from '@/lib/mxn';
import {calcular,propuestaSchema,type Producto,type Propuesta,type Snapshot} from '@/server/comercial/contracts';
const field='w-full rounded-md border bg-background p-2 text-sm';
const fmt=(n:number|null)=>n===null?'PENDIENTE':new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(n/100);
type Especial=NonNullable<Propuesta['pendientes']>[number];
export function dividirConcepto(p:Especial):Especial[]{return [1,2].map(n=>({...p,descripcion:`${p.descripcion} — parte ${n}`,estado:'pendiente',unico:null,mensual:null}));}
export function PropuestaEditor({snapshot,productos,busy,resultado,guardar}:{snapshot?:Snapshot;productos:Producto[];busy:boolean;resultado?:string;guardar:(p:Propuesta)=>void}){
 const [lineas,setLineas]=useState<Propuesta['conceptos']>(snapshot?.conceptos.map(c=>({productoId:c.productoId,cantidad:c.cantidad,...(c.baseId?{baseId:c.baseId}:{})}))??[]);
 const [especiales,setEspeciales]=useState(snapshot?.pendientes??[]);
 const [precios,setPrecios]=useState((snapshot?.pendientes??[]).map(p=>({unico:centavosAMxn(p.unico),mensual:centavosAMxn(p.mensual)})));
 const [condiciones,setCondiciones]=useState(snapshot?.condiciones??'Aplican las condiciones de cada concepto.');
 const [especial,setEspecial]=useState(snapshot?.especial??'');
 const [promo,setPromo]=useState(!!snapshot?.promocion);
 const [nombre,setNombre]=useState(snapshot?.promocion?.nombre??'');
 const [descuento,setDescuento]=useState(centavosAMxn(snapshot?.promocion?.descuento));
 const [condPromo,setCondPromo]=useState(snapshot?.promocion?.condiciones??'');
 // Conservar ajustes históricos explícitos, sin volver a aplicar su promoción.
 const [final,setFinal]=useState(snapshot && !snapshot.promocion && snapshot.unico!==snapshot.subtotalUnico?centavosAMxn(snapshot.unico):'');
 const [mensual,setMensual]=useState(snapshot && snapshot.mensual!==snapshot.subtotalMensual?centavosAMxn(snapshot.mensual):'');
 const [error,setError]=useState('');
 const catalogo=productos.concat((snapshot?.conceptos??[]).map(c=>c.producto).filter(p=>!productos.some(x=>x.id===p.id)));
 const editar=(i:number,patch:Partial<Especial>)=>setEspeciales(especiales.map((p,j)=>j===i?{...p,...patch}:p));
 const propuesta=()=>propuestaSchema.parse({conceptos:lineas,condiciones,especial:especial||undefined,
  pendientes:especiales.map((p,i)=>({...p,unico:p.estado==='cotizado'?mxnACentavos(precios[i]!.unico):null,mensual:p.estado==='cotizado'?mxnACentavos(precios[i]!.mensual):null})),
  ...(promo?{promocion:{nombre,descuento:mxnACentavos(descuento),...(condPromo?{condiciones:condPromo}:{})}}:{}),
  ...(!promo&&final!==''?{importeUnico:mxnACentavos(final)}:{}),...(mensual!==''?{importeMensual:mxnACentavos(mensual)}:{})});
 let resumen:Snapshot|undefined;try{resumen=calcular(propuesta(),catalogo);}catch{}
 function quitar(i:number){setEspeciales(especiales.filter((_,j)=>j!==i));setPrecios(precios.filter((_,j)=>j!==i));}
 return <form className="space-y-4" onSubmit={e=>{e.preventDefault();try{const p=propuesta();calcular(p,catalogo);guardar(p);setError('');}catch(e){setError(e instanceof z.ZodError?'Revisa nombres, cantidades, estados y condiciones de cada concepto.':e instanceof Error?e.message:'Revisa los datos');}}}>
 {(['producto','extra'] as const).map(tipo=><fieldset className="space-y-2 border p-3" key={tipo}><legend>{tipo==='producto'?'Productos base':'Extras del catálogo'}</legend>
 {lineas.map((l,i)=>{const p=catalogo.find(p=>p.id===l.productoId);if(!p||(tipo==='extra')!==(p.tipo==='extra'))return null;return <div className="space-y-1 border-b pb-2" key={i}><strong>{p.nombre}</strong><details><summary className="cursor-pointer py-2">Ver descripción y condiciones</summary><p className="break-words [overflow-wrap:anywhere]">{p.descripcion}</p><p className="break-words [overflow-wrap:anywhere]">{p.condiciones}</p></details><p>Precio individual: {fmt(p.unico)} · Mensual {fmt(p.mensual)} · {p.precioEstado}</p><label>Cantidad<Input aria-label={`Cantidad ${p.nombre}`} type="number" min="1" max="1000" step="1" value={l.cantidad} onChange={e=>setLineas(lineas.map((x,j)=>j===i?{...x,cantidad:Number(e.target.value)}:x))}/></label>{tipo==='extra'&&<label>Producto asociado<select className={field} value={l.baseId??''} onChange={e=>setLineas(lineas.map((x,j)=>j===i?{...x,baseId:e.target.value}:x))}><option value="">Selecciona producto</option>{lineas.filter(x=>p.compatibles.includes(x.productoId)).map(x=><option key={x.productoId} value={x.productoId}>{catalogo.find(c=>c.id===x.productoId)?.nombre}</option>)}</select></label>}<p>Importe: {fmt(p.unico===null?null:p.unico*l.cantidad)}</p><Button type="button" variant="outline" onClick={()=>setLineas(lineas.filter((_,j)=>j!==i))}>Quitar {p.nombre}</Button></div>;})}
 <label>Agregar {tipo==='extra'?'extra':'producto'}<select className={field} value="" onChange={e=>{const id=e.target.value;if(!id)return;const elegido=catalogo.find(p=>p.id===id);const base=lineas.find(l=>catalogo.find(p=>p.id===l.productoId)?.tipo!=='extra'&&(tipo!=='extra'||elegido?.compatibles.includes(l.productoId)));setLineas([...lineas,{productoId:id,cantidad:1,...(tipo==='extra'&&base?{baseId:base.productoId}:{})}]);}}><option value="">Selecciona un concepto</option>{catalogo.filter(p=>p.activo&&((tipo==='extra')===(p.tipo==='extra'))&&(tipo!=='extra'||lineas.some(l=>p.compatibles.includes(l.productoId)))&&!lineas.some(l=>l.productoId===p.id)).map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label></fieldset>)}
 <fieldset className="space-y-3 border p-3"><legend>Conceptos especiales solicitados</legend>{especiales.map((p,i)=><div className="space-y-2 border p-2" key={i}>
 <label>Nombre y descripción<Input value={p.descripcion} onChange={e=>editar(i,{descripcion:e.target.value})}/></label><label>Solicitud del cliente<textarea className={field} value={p.solicitud} onChange={e=>editar(i,{solicitud:e.target.value})}/></label>
 <label>Estado<select className={field} value={p.estado} onChange={e=>editar(i,{estado:e.target.value as Especial['estado']})}>{[['pendiente','Pendiente de cotizar'],['cotizado','Cotizado'],['incluido','Incluido sin cargo adicional'],['rechazado','Rechazado']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
 {p.estado==='cotizado'&&(['unico','mensual'] as const).map(k=><label className="block" key={k}>{k==='unico'?'Precio único MXN':'Mensualidad MXN'}<Input inputMode="decimal" value={precios[i]![k]} onChange={e=>setPrecios(precios.map((x,j)=>j===i?{...x,[k]:e.target.value}:x))}/></label>)}
 <label>Condiciones y resolución<textarea className={field} value={p.condiciones??''} onChange={e=>editar(i,{condiciones:e.target.value||undefined})}/></label>
 <Button type="button" variant="outline" onClick={()=>{setEspeciales(especiales.flatMap((x,j)=>j===i?dividirConcepto(x):[x]));setPrecios(precios.flatMap((x,j)=>j===i?[{unico:'',mensual:''},{unico:'',mensual:''}]:[x]));}}>Dividir concepto (precios por asignar)</Button><Button type="button" variant="outline" onClick={()=>quitar(i)}>Quitar concepto</Button></div>)}
 <Button type="button" variant="outline" onClick={()=>{setEspeciales([...especiales,{descripcion:'',solicitud:'',estado:'pendiente',unico:null,mensual:null}]);setPrecios([...precios,{unico:'',mensual:''}]);}}>Agregar concepto especial</Button></fieldset>
 <label className="block">Condiciones generales<textarea required className={field} value={condiciones} onChange={e=>setCondiciones(e.target.value)}/></label><label className="block">Alcance especial<textarea className={field} value={especial} onChange={e=>setEspecial(e.target.value)}/></label>
 <fieldset className="space-y-2 border p-3"><legend>Promoción administrativa</legend><label><input type="checkbox" checked={promo} onChange={e=>setPromo(e.target.checked)}/> Aplicar promoción o descuento</label>{promo&&<><label>Nombre o motivo<Input value={nombre} onChange={e=>setNombre(e.target.value)}/></label><label>Descuento fijo del pago único en MXN<Input inputMode="decimal" value={descuento} onChange={e=>setDescuento(e.target.value)}/></label><label>Condiciones de la promoción<textarea className={field} value={condPromo} onChange={e=>setCondPromo(e.target.value)}/></label><p>Se aplica una vez al pago único de esta versión. Requiere aprobación; no modifica la mensualidad ni el catálogo.</p></>}</fieldset>
 <details><summary>Ajuste final administrativo existente (opcional)</summary><p>Si se indica, queda desglosado como ajuste frente a los conceptos. Con promoción se calcula el total automáticamente.</p><label>Importe único final MXN<Input disabled={promo} inputMode="decimal" value={final} onChange={e=>setFinal(e.target.value)}/></label><label>Mensualidad final MXN (indica alcance y periodo en condiciones generales)<Input inputMode="decimal" value={mensual} onChange={e=>setMensual(e.target.value)}/></label></details>
 {resumen&&<section aria-label="Resumen de importes"><p>Subtotal antes del descuento: {fmt(resumen.subtotalUnico)}</p><p>Promoción en revisión: {fmt(resumen.promocion?.descuento??0)}</p><p>Subtotal conocido después del descuento: {fmt(resumen.conocidoDespuesDescuento)}</p><p>Ajuste administrativo: {fmt(resumen.ajusteUnico)}</p><strong>Total final: {fmt(resumen.unico)} · Mensual {fmt(resumen.mensual)}</strong></section>}
 <p role="alert">{error}</p><div className="border-t bg-background py-2">{resultado&&<p role="status" className="break-words">{resultado}</p>}<Button className="min-h-11 w-full sm:w-auto" disabled={busy}>Guardar propuesta en una nueva versión</Button></div></form>;
}
