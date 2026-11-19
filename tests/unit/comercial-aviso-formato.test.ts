import { describe, expect, it } from "vitest";
import { formatearAvisoAprobacion } from "@/server/comercial/avisos";
import { calcular, type Producto } from "@/server/comercial/contracts";
import catalogo from "@/server/comercial/catalogo-v3.json";
import conciliacion from "@/server/comercial/catalogo-conciliacion-v3.json";

const base = catalogo.find(p => p.id === "web") as Producto;
const anterior = conciliacion.find(p => p.id === "web")!.campos!;
const web: Producto = {
  ...base,
  caracteristicas: anterior.caracteristicas!.antes,
  exclusiones: anterior.exclusiones!.antes,
  condiciones: anterior.condiciones!.antes,
};
const snapshot = calcular({ conceptos: [{ productoId: "web", cantidad: 1 }] }, [web]);
const referencia = "c3e31876-sintetica";

describe("Presentación del aviso comercial", () => {
  it("muestra los totales aprobados y conserva lo provisional de una ficha histórica", () => {
    const original = structuredClone(snapshot);
    const aviso = formatearAvisoAprobacion(referencia, 1, snapshot);
    expect(aviso).toBe(
      "¡Hola! Tu cotización fue aprobada. ✅\n\n" +
      "*Página web*\n*Referencia* c3e31876 · versión 1\n\n" +
      "*Pago único* $1,499 MXN\n*Mensualidad* $0 MXN\n\n" +
      "*Incluye*\n• Una página informativa adaptable a celular y computadora.\n" +
      "• Contacto por WhatsApp y hasta cinco secciones. La quinta requiere confirmar disponibilidad.\n\n" +
      "*Condiciones*\nDominio básico y alojamiento propuestos por 12 meses, por confirmar antes de contratar. " +
      "La renovación se informa por separado.\n\n" +
      "La aprobación no implica contratación ni pago.\n\n" +
      "¿Aceptas esta propuesta para que Lukas te ayude a continuar con la contratación?",
    );
    expect(snapshot).toEqual(original);
  });

  it("muestra importes exactos y conserva un alcance corto sin copiar la ficha técnica", () => {
    const aviso = formatearAvisoAprobacion(referencia, 2, {
      ...snapshot, mensual: 12050, ajusteMensual: 12050,
      especial: "Lavandería: servicios, precios y solicitudes de cita dentro del paquete base",
      condiciones: "Entrega después de recibir los textos e imágenes.",
    });
    expect(aviso).toContain("*Mensualidad* $120.50 MXN");
    expect(aviso).toContain("Alcance aprobado: Lavandería: servicios, precios y solicitudes de cita");
    expect(aviso).toContain("Entrega después de recibir los textos e imágenes.");
    expect(aviso).not.toMatch(/V3|c3e31876-sintetica|dominio|posicionamiento/iu);
  });

  it("reporta importes contradictorios sin mostrar una cifra ni pedir aceptación", () => {
    const aviso = formatearAvisoAprobacion(referencia, 1, { ...snapshot, unico: 100 });
    expect(aviso).toContain("Los importes de esta versión no coinciden");
    expect(aviso).not.toMatch(/\$|¿Aceptas/u);
  });
});
