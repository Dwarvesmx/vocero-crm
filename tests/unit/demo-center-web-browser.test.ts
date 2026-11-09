import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { expect, it } from "vitest";

it("presenta el recorrido de prospecto en Chrome móvil y escritorio con API controlada", async () => {
  const bundle = await build({
    stdin: {
      contents: `import React from "react"; import {createRoot} from "react-dom/client";
        import {PortalDemo} from "./src/components/demo-center/portal";
        createRoot(document.getElementById("root")).render(<React.StrictMode>
          <PortalDemo contacto="mailto:contacto@modonext.tech" catalogo={{number:"525500000099",demos:[{name:"Pizza Nova",assistant:"NOVA"}]}} />
        </React.StrictMode>);`,
      loader: "tsx", resolveDir: process.cwd(),
    },
    jsx: "automatic", bundle: true, write: false, define: { "process.env.NODE_ENV": '"development"' },
  });
  const from = "src/app/globals.css";
  const style = await postcss([tailwindcss()]).process(await readFile(from, "utf8"), { from });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const page = await browser.newPage({ viewport });
      try {
        const pizza = "p".repeat(43), casa = "c".repeat(43);
        const pizzaData = { name: "Pizza Nova", assistant: "NOVA", greeting: "Bienvenido a Pizza Nova", state: "active",
          deadline: "2026-11-07T12:00:00Z", turns: [] as { id: string; question: string; answer: string }[],
          whatsapp: { state: "available" } };
        const casaData = { ...pizzaData, name: "Casa Horizonte", assistant: "Horizonte", greeting: "Conoce viviendas de ejemplo" };
        const intentos: string[] = [];
        await page.route("**/*", async route => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin === "https://portal.test" && url.pathname === "/demos") {
            await route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' });
            return;
          }
          if (url.origin !== "https://portal.test" || url.pathname !== "/api/demo/web") { await route.abort(); return; }
          const token = request.headers().authorization;
          const data = token === "Bearer " + pizza ? pizzaData : casaData;
          if (request.method() === "POST") {
            const body = request.postDataJSON();
            if (body.action === "startWhatsApp") {
              expect(body.phone).toBe("+525500000001");
              data.whatsapp = { state: "pending" };
              await route.fulfill({ json: { url: "https://wa.me/525500000099?text=MODONEXT-DEMO%20example", expiresAt: pizzaData.deadline } });
              return;
            }
            if (body.action === "finishWhatsApp") data.whatsapp = { state: "closed" };
            if (body.action === "send") {
              intentos.push(body.requestKey);
              if (!data.turns.length) data.turns = [{ id: "turno", question: body.text, answer: "Respuesta controlada para NOVA" }];
              if (intentos.length === 1) { await route.abort(); return; }
            }
            if (body.action === "close") { data.state = "closed"; data.turns = []; }
          }
          await route.fulfill({ json: { ...data, operation: data.turns.length ? "settled" : undefined } });
        });
        page.on("dialog", dialog => dialog.accept());
        await page.goto(`https://portal.test/demos#acceso=${pizza}&acceso=${casa}`);
        await page.addStyleTag({ content: style.css });
        await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
        const catalogo = page.getByRole("region", { name: "Demostraciones por WhatsApp" });
        const directo = catalogo.getByRole("link", { name: "Abrir WhatsApp", exact: true });
        await directo.waitFor();
        const target = new URL((await directo.getAttribute("href"))!);
        expect(target.searchParams.get("text")).toBe("Quiero una demo de Pizza Nova");
        expect(await catalogo.getByRole("img", { name: "QR para abrir WhatsApp" }).isVisible()).toBe(viewport.width > 640);
        expect(await catalogo.getByRole("link", { name: "WhatsApp Web" }).isVisible()).toBe(viewport.width > 640);
        const demoPizza = page.getByRole("button", { name: /Pizza Nova.*NOVA/ });
        await demoPizza.focus();
        await demoPizza.press("Enter");
        expect(new URL(page.url()).hash).toBe("");
        await page.getByRole("button", { name: "Vincular desde una invitación" }).click();
        await page.getByRole("textbox", { name: "Tu número de WhatsApp con código de país" }).fill("+525500000001");
        await page.getByRole("button", { name: "Preparar mensaje de vinculación" }).click();
        const wa = page.getByRole("region", { name: /WhatsApp · demostración/ }).getByRole("link", { name: "Abrir WhatsApp", exact: true });
        await wa.waitFor();
        expect(await wa.getAttribute("href")).toContain("https://wa.me/525500000099?text=");
        pizzaData.whatsapp = { state: "linked" };
        await page.getByRole("button", { name: "Consultar vinculación" }).click();
        await page.getByRole("button", { name: "Finalizar WhatsApp" }).click();
        await page.getByText("Demostración finalizada", { exact: true }).waitFor();
        const mensaje = page.getByRole("textbox", { name: "Tu mensaje" });
        await mensaje.fill("¿Qué pizzas ofrecen?");
        const enviar = page.getByRole("button", { name: "Enviar", exact: true });
        await enviar.click();
        await page.getByRole("alert").waitFor();
        await page.getByRole("button", { name: /Casa Horizonte/ }).click();
        await page.getByText(casaData.greeting).waitFor();
        await demoPizza.click();
        expect(await mensaje.inputValue()).toBe("¿Qué pizzas ofrecen?");
        await enviar.click();
        await page.getByText("Respuesta controlada para NOVA").waitFor();
        expect(intentos).toHaveLength(2);
        expect(intentos[0]).toBe(intentos[1]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
        await page.getByRole("button", { name: "Finalizar demo" }).click();
        const contacto = page.getByRole("link", { name: "Solicitar información" });
        await contacto.waitFor();
        expect(await contacto.getAttribute("href")).toBe("mailto:contacto@modonext.tech");
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}, 30000);
