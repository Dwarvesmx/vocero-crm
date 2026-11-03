import { inflateRawSync } from "node:zlib";
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_CHARS = 100000;
const types = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain" } as const;
export function validarDocumento(name: string, mime: string, data: Buffer) {
    const ext = name.split(".").pop()?.toLowerCase() as keyof typeof types;
    if (!types[ext] || (mime && mime !== "application/octet-stream" && mime !== types[ext]))
        throw new Error("Usa PDF con texto, DOCX o TXT UTF-8.");
    if (!data.length || data.length > MAX_DOCUMENT_BYTES)
        throw new Error("El documento debe pesar entre 1 byte y 5 MB.");
    if (ext === "pdf" && data.subarray(0, 5).toString() !== "%PDF-")
        throw new Error("El archivo no es un PDF válido.");
    if (ext === "docx")
        validarZip(data);
    return { ext, mime: types[ext] };
}
/** Límites antes de descomprimir DOCX: no ZIP64, cifrado ni bombas ZIP. */
function validarZip(b: Buffer) {
    let end = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
        if (b.readUInt32LE(i) === 0x06054b50) {
            end = i;
            break;
        }
    if (end < 0 || b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6))
        throw new Error("DOCX inválido.");
    const count = b.readUInt16LE(end + 10);
    let pos = b.readUInt32LE(end + 16), total = 0, document = false;
    if (count > 3000 || count === 65535 || pos >= end)
        throw new Error("DOCX excede los límites.");
    for (let i = 0; i < count; i++) {
        if (pos + 46 > end || b.readUInt32LE(pos) !== 0x02014b50 || (b.readUInt16LE(pos + 8) & 1))
            throw new Error("DOCX inválido o cifrado.");
        const size = b.readUInt32LE(pos + 24), len = b.readUInt16LE(pos + 28);
        const compressed = b.readUInt32LE(pos + 20), local = b.readUInt32LE(pos + 42), method = b.readUInt16LE(pos + 10);
        if (local + 30 > b.length || b.readUInt32LE(local) !== 0x04034b50 || ![0, 8].includes(method))
            throw new Error("DOCX inválido.");
        const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
        if (start + compressed > pos || size > 10 * 1024 * 1024)
            throw new Error("DOCX inválido o demasiado grande.");
        const body = b.subarray(start, start + compressed);
        const inflated = method === 8 ? inflateRawSync(body, { maxOutputLength: 10 * 1024 * 1024 }) : body;
        if (inflated.length !== size)
            throw new Error("DOCX con tamaños inconsistentes.");
        total += size;
        if (size > 10 * 1024 * 1024 || total > 20 * 1024 * 1024)
            throw new Error("DOCX descomprimido demasiado grande.");
        if (b.subarray(pos + 46, pos + 46 + len).toString() === "word/document.xml")
            document = true;
        pos += 46 + len + b.readUInt16LE(pos + 30) + b.readUInt16LE(pos + 32);
    }
    if (!document || pos > end)
        throw new Error("Falta el texto del DOCX.");
}
export function fragmentarTexto(text: string) {
    const clean = text.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
    if (!clean || !/[\p{L}\p{N}]/u.test(clean))
        throw new Error("El documento no contiene texto extraíble. Los PDF escaneados requieren OCR externo.");
    if (clean.length > MAX_TEXT_CHARS)
        throw new Error("El texto supera 100.000 caracteres.");
    const chunks: string[] = [];
    for (let start = 0; start < clean.length;) {
        let end = Math.min(start + 2000, clean.length);
        if (end < clean.length) {
            const cut = clean.lastIndexOf(" ", end);
            if (cut > start + 1000)
                end = cut;
        }
        chunks.push(clean.slice(start, end));
        if (end === clean.length)
            break;
        start = Math.max(start + 1, end - 150);
    }
    return chunks;
}
export async function extraerDocumento(name: string, mime: string, data: Buffer) {
    const { ext } = validarDocumento(name, mime, data);
    let text: string;
    if (ext === "txt")
        text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    else if (ext === "docx") {
        const mammoth = await import("mammoth");
        text = (await mammoth.extractRawText({ buffer: data })).value;
    }
    else {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: false });
        try {
            const info = await parser.getInfo();
            if (info.total > 100)
                throw new Error("El PDF supera 100 páginas.");
            const result = await parser.getText({ pageJoiner: "" });
            text = result.pages.map(p => p.text).join("\n\n");
        }
        finally {
            await parser.destroy();
        }
    }
    return fragmentarTexto(text);
}
