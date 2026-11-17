import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ComercialPanel} from '@/components/comercial/panel';
import {PropuestaEditor} from '@/components/comercial/propuesta-editor';
import {navegarComercial,navegacionInicial} from '@/components/comercial/navegacion-comercial';
import {calcular,propuestaSchema,type Producto} from '@/server/comercial/contracts';
const producto:Producto={id:'web',nombre:'Página',descripcion:'Información completa',tipo:'producto',caracteristicas:[],exclusiones:[],unico:149900,mensual:0,precioEstado:'aprobado',limites:{},compatibles:[],activo:true,condiciones:'Alcance'};
const snapshot=calcular(propuestaSchema.parse({conceptos:[{productoId:'web',cantidad:1}]}),[producto]);
describe('Navegación de cotizaciones',()=>{
 it('abre por defecto la lista y conserva el formulario de creación oculto',()=>{
  const html=renderToStaticMarkup(createElement(ComercialPanel));
  expect(navegacionInicial.panel).toBe('lista');expect(html).toContain('Buscar cotización o contacto');
  expect(html).toContain('No hay cotizaciones todavía.');expect(html).toContain('Nueva cotización');
  expect(html).toMatch(/<div hidden=""[^>]*><section[^>]*><h2>Nueva cotización<\/h2>/);
 });
 it('mantiene un panel desplazable y el botón después del contenido del editor',()=>{
  const panel=renderToStaticMarkup(createElement(ComercialPanel));
  expect(panel).toMatch(/<main class="[^"]*h-full[^"]*overflow-y-auto/);
  const editor=renderToStaticMarkup(createElement(PropuestaEditor,{productos:[producto],busy:false,guardar:()=>{}}));
  expect(editor.indexOf('Conceptos especiales solicitados')).toBeLessThan(editor.indexOf('Promoción administrativa'));
  expect(editor.indexOf('Promoción administrativa')).toBeLessThan(editor.indexOf('Guardar propuesta en una nueva versión'));
  expect(editor).not.toContain('sticky bottom-0');
 });
 it('abre un solo editor y conserva sus borradores al navegar o cambiar la versión remota',()=>{
  let s=navegarComercial(navegacionInicial,{tipo:'editar',id:'uno',version:1,snapshot});
  expect(s.panel).toBe('editar');expect(s.seleccion).toBe('uno');const original=s.borradores.uno;
  s=navegarComercial(s,{tipo:'lista'});s=navegarComercial(s,{tipo:'nueva'});
  s=navegarComercial(s,{tipo:'editar',id:'dos',version:2,snapshot});expect(s.seleccion).toBe('dos');expect(s.borradores.uno).toBe(original);
  s=navegarComercial(s,{tipo:'editar',id:'uno',version:3,snapshot});expect(s.seleccion).toBe('uno');expect(s.borradores.uno!.version).toBe(1);
  s=navegarComercial(s,{tipo:'descartar',id:'uno'});expect(s.borradores.uno).toBeUndefined();expect(s.borradores.dos!.version).toBe(2);
 });
 it('al guardar solo elimina el borrador de esa cotización',()=>{
  let s=navegarComercial(navegacionInicial,{tipo:'editar',id:'a',version:1,snapshot});
  s=navegarComercial(s,{tipo:'editar',id:'b',version:1,snapshot});s=navegarComercial(s,{tipo:'guardado',id:'b'});
  expect(s.panel).toBe('detalle');expect(s.borradores.b).toBeUndefined();expect(s.borradores.a).toBeDefined();
 });
});
