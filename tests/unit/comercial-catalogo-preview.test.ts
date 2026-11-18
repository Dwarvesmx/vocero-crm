import { describe, expect, it } from "vitest";
import { previsualizarCatalogo } from "@/server/comercial/catalogo-preview";
import semilla from "@/server/comercial/catalogo-v3.json";
import type { Producto } from "@/server/comercial/contracts";

describe("vista previa de catálogo", () => {
  it("es de lectura y reconoce un catálogo ya actualizado", () => {
    const actual=structuredClone(semilla) as Producto[]; const original=JSON.stringify(actual);
    const r=previsualizarCatalogo(actual);
    expect(r.find(x=>x.id==="web")?.estado).toBe("aplicado");
    expect(JSON.stringify(actual)).toBe(original);
  });
  it("marca cambios manuales y un ID nuevo existente como conflictos", () => {
    const actual=structuredClone(semilla) as Producto[];
    actual.find(p=>p.id==="web")!.descripcion="Edición administrativa";
    const r=previsualizarCatalogo(actual);
    expect(r.find(x=>x.id==="web")?.estado).toBe("conflicto");
    expect(r.find(x=>x.id==="dominio-com-independiente")?.estado).toBe("aplicado");
    actual.find(p=>p.id==="dominio-com-independiente")!.nombre="Otra edición";
    expect(previsualizarCatalogo(actual).find(x=>x.id==="dominio-com-independiente")?.estado).toBe("conflicto");
  });
});
