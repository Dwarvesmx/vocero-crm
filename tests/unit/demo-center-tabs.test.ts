import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DemoCenterAdmin } from "@/components/demo-center/admin";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: (props: React.ComponentProps<"a">) => React.createElement("a", props) }));

describe("Pestañas de Demo Center", () => {
  it("muestra solo General y mantiene ocultos los demás paneles", () => {
    const detail = { space: { id: "space-a", name: "A", commercialName: "A", sector: "Servicios",
      description: "", status: "draft", generation: 1, visualIdentity: {} },
      profiles: [], authorizations: [], audit: [], limits: null };
    const html = renderToStaticMarkup(React.createElement(DemoCenterAdmin, { spaces: [], detail: detail as never,
      globalPolicy: null, exceptions: [], knowledge: { documents: [], entries: [], fragments: [] }, global: false }));
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('id="panel-general" aria-labelledby="tab-general"');
    for (const id of ["assistant", "knowledge", "phones", "limits", "audit"]) {
      expect(html).toContain('id="panel-' + id + '" aria-labelledby="tab-' + id + '" hidden=""');
    }
    expect(html).toContain("Configuración global");
  });

  it("ofrece política global sin mostrar el formulario de un espacio", () => {
    const html = renderToStaticMarkup(React.createElement(DemoCenterAdmin, { spaces: [], detail: null, globalPolicy: null,
      exceptions: [], knowledge: null, global: true }));
    expect(html).toContain("Límites globales de Demo Center");
    expect(html).not.toContain("Crear espacio");
    expect(html).toContain('id="panel-limits" aria-labelledby="tab-limits"');
  });
});
