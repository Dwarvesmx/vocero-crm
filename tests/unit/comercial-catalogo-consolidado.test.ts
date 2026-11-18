import { describe, expect, it } from "vitest";
import { calcular, productoSchema, propuestaSchema } from "@/server/comercial/contracts";
import raw from "@/server/comercial/catalogo-v3.json";
const catalogo=raw.map(p=>productoSchema.parse(p));
describe("catálogo consolidado",()=>{
  it.each([["web",149900],["catalogo",249000],["citas",249000]])("%s conserva precio orientativo e incluye el primer periodo",(id,precio)=>{
    const p=catalogo.find(p=>p.id===id)!;
    expect(p.unico).toBe(precio);expect(p.precioEstado).toBe("orientativo");expect(p.caracteristicas.some(c=>c.includes("primeros 12 meses"))).toBe(true);
    expect(()=>calcular(propuestaSchema.parse({conceptos:[{productoId:id,cantidad:1},{productoId:"extra-12",cantidad:1,baseId:id}]}),catalogo)).toThrow("prestacion_ya_incluida");
  });
  it.each(["dominio-com-independiente","hosting-basico-independiente","dominio-hosting-independiente","renovacion-dominio-independiente","renovacion-hosting-independiente"])("permite %s sin tarifa inventada",id=>{
    const r=calcular(propuestaSchema.parse({conceptos:[{productoId:id,cantidad:1}]}),catalogo);
    expect(r.unico).toBeNull();expect(r.requiereAprobacion).toBe(true);
  });
  it("registra una solicitud fuera de catálogo pendiente, pero rechaza una propuesta vacía",()=>{
    expect(()=>propuestaSchema.parse({conceptos:[]})).toThrow();
    const p=propuestaSchema.parse({conceptos:[],pendientes:[{descripcion:"Servicio a medida",solicitud:"Alcance por definir"}]});
    const r=calcular(p,catalogo);expect(r.unico).toBeNull();expect(r.pendientes[0]?.unico).toBeNull();
  });
  it("exige distinguir dominio adicional, hosting superior y renovación posterior",()=>{
    const base={productoId:'web',cantidad:1};
    const domain={productoId:'dominio-com-independiente',cantidad:1};
    expect(()=>calcular(propuestaSchema.parse({conceptos:[base,domain]}),catalogo)).toThrow('alcance_o_periodo_no_acreditado');
    expect(calcular(propuestaSchema.parse({conceptos:[base,{...domain,cobertura:'adicional'}]}),catalogo).requiereAprobacion).toBe(true);
    expect(()=>calcular(propuestaSchema.parse({conceptos:[base,{...domain,cobertura:'renovacion',inicioMes:12}]}),catalogo)).toThrow('alcance_o_periodo_no_acreditado');
    expect(calcular(propuestaSchema.parse({conceptos:[base,{...domain,cobertura:'renovacion',inicioMes:13}]}),catalogo).requiereAprobacion).toBe(true);
    const hosting={productoId:'hosting-basico-independiente',cantidad:1};
    expect(calcular(propuestaSchema.parse({conceptos:[base,{...hosting,cobertura:'superior'}]}),catalogo).requiereAprobacion).toBe(true);
  });
  it("mantiene explícita la autorización de una inclusión especial",()=>{
    const p=propuestaSchema.parse({conceptos:[{productoId:"web",cantidad:1}],pendientes:[{descripcion:"Sexta sección",solicitud:"Incluirla",estado:"incluido",condiciones:"Autorizada sin cargo"}]});
    expect(calcular(p,catalogo).requiereAprobacion).toBe(true);
  });
});
