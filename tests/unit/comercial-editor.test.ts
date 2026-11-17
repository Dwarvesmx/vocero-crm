import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mxnACentavos,centavosAMxn} from '@/lib/mxn';
import {calcular,propuestaSchema,type Producto} from '@/server/comercial/contracts';
import {PropuestaEditor,dividirConcepto} from '@/components/comercial/propuesta-editor';
const producto:Producto={id:'base',nombre:'Página sintética',descripcion:'Descripción sintética',tipo:'producto',caracteristicas:[],exclusiones:[],unico:149900,mensual:0,precioEstado:'aprobado',limites:{},compatibles:[],activo:true,condiciones:'Una entrega'};
const p={conceptos:[{productoId:'base',cantidad:1}]};
describe('Editor de propuestas MXN y promoción',()=>{
 it('convierte decimales de forma exacta y rechaza formatos inválidos',()=>{
  expect(mxnACentavos('1999')).toBe(199900);expect(mxnACentavos('1999.50')).toBe(199950);
  expect(mxnACentavos('0.29')).toBe(29);expect(centavosAMxn(199950)).toBe('1999.50');
  for(const x of ['', '-1','1.001','1e3','NaN','1,999','1000000.01'])expect(()=>mxnACentavos(x)).toThrow();
 });
 it('descuenta una vez y conserva mensualidad y catálogo',()=>{
  const q=calcular(propuestaSchema.parse({...p,promocion:{nombre:'Lanzamiento',descuento:20000}}),[producto]);
  expect(q).toMatchObject({subtotalUnico:149900,conocidoDespuesDescuento:129900,unico:129900,mensual:0,requiereAprobacion:true});
  expect(producto.unico).toBe(149900);
  expect(()=>calcular(propuestaSchema.parse({...p,promocion:{nombre:'Excesivo',descuento:150000}}),[producto])).toThrow('descuento_excesivo');
  expect(()=>calcular(propuestaSchema.parse({...p,importeUnico:100,promocion:{nombre:'Contradictorio',descuento:20000}}),[producto])).toThrow('total_contradictorio');
 });
 it('mantiene pendiente distinto de cero e impide un final con pendientes',()=>{
  const q=calcular(propuestaSchema.parse({...p,promocion:{nombre:'Promoción',descuento:20000},pendientes:[{descripcion:'Formulario especial',solicitud:'Solicitud'}]}),[producto]);
  expect(q.unico).toBeNull();expect(q.conocidoDespuesDescuento).toBe(129900);expect(q.pendientes[0]!.unico).toBeNull();
  expect(mxnACentavos('0')).toBe(0);
  for(const cantidad of [0,-1,1.5])expect(()=>propuestaSchema.parse({conceptos:[{productoId:'base',cantidad}]})).toThrow();
 });
 it('divide sustituyendo el concepto y sin duplicar su importe',()=>{
  const original={descripcion:'Formularios y redes',solicitud:'Detalle confirmado',estado:'cotizado' as const,unico:50000,mensual:0,condiciones:'Alcance original'};
  const partes=dividirConcepto(original);expect(partes).toHaveLength(2);expect(original.unico).toBe(50000);
  expect(partes.every(p=>p.estado==='pendiente'&&p.unico===null&&p.mensual===null&&p.solicitud===original.solicitud&&p.descripcion.includes(original.descripcion))).toBe(true);
 });
 it('renderiza controles administrativos sin campos JSON ni centavos',()=>{
  const html=renderToStaticMarkup(createElement(PropuestaEditor,{productos:[producto],snapshot:calcular(propuestaSchema.parse(p),[producto]),busy:false,guardar:()=>{}}));
  expect(html).toContain('Precio individual');expect(html).toContain('Aplicar promoción o descuento');expect(html).toContain('Cantidad');
  expect(html).not.toContain('JSON');expect(html).not.toContain('centavos');expect(html).not.toContain('149900');
 });
});
