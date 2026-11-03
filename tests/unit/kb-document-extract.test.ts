import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { extraerDocumento, fragmentarTexto, validarDocumento, MAX_DOCUMENT_BYTES } from "@/server/kb/extract";
const fixture = (name: string) => readFile(new URL(`../fixtures/kb-v1/${name}`, import.meta.url));
it.each([["servicios.txt", "4500"], ["servicios.docx", "treinta"], ["servicios.pdf", "1200"]])("extrae texto real de %s", async (name, expected) => {
    expect((await extraerDocumento(name, "", await fixture(name))).join(" ")).toContain(expected);
});
it("rechaza PDF sin texto, binarios e información truncada", async () => {
    await expect(extraerDocumento("sin-texto.pdf", "", await fixture("sin-texto.pdf"))).rejects.toThrow("texto");
    await expect(extraerDocumento("bad.txt", "", Buffer.from([255, 254, 255]))).rejects.toThrow();
    expect(() => validarDocumento("a.pdf", "application/pdf", Buffer.from("otro"))).toThrow();
    expect(() => validarDocumento("a.docx", "", Buffer.from("PK"))).toThrow();
    expect(() => validarDocumento("a.html", "text/html", Buffer.from("<script>"))).toThrow();
    expect(() => validarDocumento("a.txt", "", Buffer.alloc(MAX_DOCUMENT_BYTES + 1))).toThrow();
});
it("limita texto y conserva contenido con solapamiento acotado", () => {
    expect(() => fragmentarTexto("a".repeat(100001))).toThrow();
    const text = "servicio web consultivo ".repeat(500), chunks = fragmentarTexto(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(c => c.length <= 2000)).toBe(true);
    expect(chunks.at(-1)?.trim().endsWith("consultivo")).toBe(true);
});
