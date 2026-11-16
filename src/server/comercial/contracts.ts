import { z } from "zod";

const id = z.string().trim().min(1).max(120);
const texto = z.string().trim().min(1).max(6000);
const dinero = z.number().int().min(0).max(100_000_000);
export const productoSchema = z.object({
  id, nombre: texto, descripcion: texto, tipo: z.enum(["producto", "extra", "especializacion"]),
  caracteristicas: z.array(texto).max(40), exclusiones: z.array(texto).max(40),
  unico: dinero.nullable(), mensual: dinero.nullable(),
  precioEstado: z.enum(["aprobado", "orientativo", "pendiente"]),
  limites: z.record(z.string(), z.number().int().min(0).max(100000)),
  compatibles: z.array(id).max(50), activo: z.boolean(), condiciones: texto,
}).strict();
export type Producto = z.infer<typeof productoSchema>;
export const propuestaSchema = z.object({
  conceptos: z.array(z.object({ productoId: id, cantidad: z.number().int().min(1).max(1000),
    baseId: id.optional() }).strict()).min(1).max(40),
  condiciones: texto.optional(), especial: texto.optional(),
  // Solo admin. Su presencia invalida la autorización automática.
  importeUnico: dinero.optional(), importeMensual: dinero.optional(),
}).strict();
export type Propuesta = z.infer<typeof propuestaSchema>;
export const comandoSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sembrar"), requestKey: id }).strict(),
  z.object({ action: z.literal("catalogo"), requestKey: id, producto: productoSchema }).strict(),
  z.object({ action: z.literal("preparar"), requestKey: id, conversationId: id, propuesta: propuestaSchema }).strict(),
  z.object({ action: z.literal("revisar"), requestKey: id, conversationId: id, cotizacionId: id, version: z.number().int().positive(), propuesta: propuestaSchema }).strict(),
  z.object({ action: z.literal("decidir"), requestKey: id, conversationId: id, cotizacionId: id, version: z.number().int().positive(), decision: z.enum(["aprobar", "rechazar"]), motivo: texto }).strict(),
  z.object({ action: z.literal("solicitar_aprobacion"), requestKey: id, conversationId: id, cotizacionId: id, version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("aceptar"), requestKey: id, conversationId: id, cotizacionId: id, version: z.number().int().positive(), mensajeId: id }).strict(),
  z.object({ action: z.literal("contratar"), requestKey: id, conversationId: id, cotizacionId: id, version: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("pago"), requestKey: id, conversationId: id, cotizacionId: id, version: z.number().int().positive(), estado: z.enum(["pendiente", "en_verificacion", "pagado", "cancelado"]), evidencia: texto.optional(), enlace: z.string().max(2048).optional() }).strict(),
]);
export type Comando = z.infer<typeof comandoSchema>;
export type Actor = { organizationId: string; userId?: string; role: string; conversationId?: string };
export class ComercialError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
export function exigirAdmin(actor: Actor) {
  if (!actor.userId || !["owner", "admin"].includes(actor.role)) throw new ComercialError("sin_permiso", 403);
}
export function enlaceSeguro(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new ComercialError("enlace_invalido", 422); }
  const host = url.hostname.toLowerCase();
  // No SSRF: no se consulta la URL. Se impide compartir direcciones internas y credenciales.
  if (url.protocol !== "https:" || url.username || url.password || url.port || !host.includes(".") ||
      /[\[\]:]/.test(host) || /^\d/.test(host) || /(^|\.)(localhost|local|internal|invalid|test)$/.test(host)) {
    throw new ComercialError("enlace_invalido", 422);
  }
  return url.href;
}
export function calcular(propuesta: Propuesta, catalogo: Producto[]) {
  const conceptos = propuesta.conceptos.map(linea => {
    const p = catalogo.find(p => p.id === linea.productoId && p.activo);
    if (!p) throw new ComercialError("producto_no_disponible", 422);
    if (p.tipo === "extra") {
      const base = propuesta.conceptos.find(c => c.productoId === linea.baseId);
      const productoBase = catalogo.find(p => p.id === base?.productoId);
      if (!base || !productoBase || productoBase.tipo === "extra" ||
          !p.compatibles.includes(productoBase.id)) throw new ComercialError("extra_incompatible", 422);
    }
    return { ...linea, producto: p };
  });
  const sumar = (campo: "unico" | "mensual") => conceptos.some(c => c.producto[campo] === null) ? null :
    conceptos.reduce((s,c) => s + c.producto[campo]! * c.cantidad, 0);
  const unico = propuesta.importeUnico ?? sumar("unico");
  const mensual = propuesta.importeMensual ?? sumar("mensual");
  if ((unico !== null && !Number.isSafeInteger(unico)) || (mensual !== null && !Number.isSafeInteger(mensual))) throw new ComercialError("importe_fuera_de_rango",422);
  return { moneda: "MXN" as const, conceptos, unico, mensual,
    condiciones: propuesta.condiciones ?? "Aplican las condiciones de cada concepto del catálogo adjunto.",
    especial: propuesta.especial ?? null,
    requiereAprobacion: !!propuesta.especial || propuesta.importeUnico !== undefined || propuesta.importeMensual !== undefined ||
      unico === null || mensual === null || conceptos.some(c => c.producto.precioEstado !== "aprobado"),
  };
}
export type Snapshot = ReturnType<typeof calcular>;
