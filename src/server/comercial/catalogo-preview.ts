import cambios from "./catalogo-conciliacion-v3.json";
import type { Producto } from "./contracts";

/** Vista previa pura: no escribe ni decide sobre ediciones ajenas. */
export function previsualizarCatalogo(actual: Producto[]) {
  return cambios.map(cambio => {
    const existente = actual.find(p => p.id === cambio.id);
    if ("nuevo" in cambio && cambio.nuevo) return { id:cambio.id, estado:!existente ? "nuevo" : JSON.stringify(existente) === JSON.stringify(cambio.nuevo) ? "aplicado" : "conflicto", antes:existente ?? null, despues:cambio.nuevo };
    if (!existente) return { id:cambio.id, estado:"ausente", campos:[] };
    const registro = existente as unknown as Record<string, unknown>;
    const campos = Object.entries(cambio.campos ?? {}).map(([campo, valores]) => {
      const valor = registro[campo];
      const igual = (a: unknown,b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      return {campo, actual:valor, antes:valores.antes, despues:valores.despues,
        estado:igual(valor,valores.despues) ? "aplicado" : igual(valor,valores.antes) ? "propuesto" : "conflicto"};
    });
    return {id:cambio.id, estado:campos.some(c=>c.estado==="conflicto") ? "conflicto" : campos.every(c=>c.estado==="aplicado") ? "aplicado" : "propuesto", campos};
  });
}
