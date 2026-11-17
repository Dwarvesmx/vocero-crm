import type {Snapshot} from '@/server/comercial/contracts';
export type NavegacionComercial={panel:'lista'|'nueva'|'detalle'|'editar';seleccion:string|null;borradores:Record<string,{version:number;snapshot:Snapshot}>};
export type AccionComercial={tipo:'lista'}|{tipo:'nueva'}|{tipo:'ver';id:string}|{tipo:'editar';id:string;version:number;snapshot:Snapshot}|{tipo:'descartar';id:string}|{tipo:'guardado';id:string};
export const navegacionInicial:NavegacionComercial={panel:'lista',seleccion:null,borradores:{}};
export function navegarComercial(s:NavegacionComercial,a:AccionComercial):NavegacionComercial{
 switch(a.tipo){
  case 'lista': return {...s,panel:'lista',seleccion:null};
  case 'nueva': return {...s,panel:'nueva',seleccion:null};
  case 'ver': return {...s,panel:'detalle',seleccion:a.id};
  case 'editar': return {...s,panel:'editar',seleccion:a.id,borradores:{...s.borradores,[a.id]:s.borradores[a.id]??{version:a.version,snapshot:a.snapshot}}};
  case 'descartar': case 'guardado': {const borradores={...s.borradores};delete borradores[a.id];return {...s,borradores,panel:s.seleccion===a.id?'detalle':s.panel};}
 }
}
