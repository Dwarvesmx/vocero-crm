import { apiError } from "@/lib/api";
import { MAX_DOCUMENT_BYTES } from "./extract";

export async function readDocumentUpload(req: Request): Promise<File | Response> {
    const length = Number(req.headers.get("content-length"));
    if (length > MAX_DOCUMENT_BYTES + 65536)
        return apiError(413, "too_large", "Máximo 5 MB por documento.");
    // El límite también se aplica sin Content-Length (cuerpo fragmentado).
    if (!req.body)
        return apiError(422, "invalid_file", "Falta el archivo.");
    const reader = req.body.getReader(), parts: Uint8Array[] = [];
    let received = 0;
    while (true) {
        const part = await reader.read();
        if (part.done)
            break;
        received += part.value.length;
        if (received > MAX_DOCUMENT_BYTES + 65536) {
            await reader.cancel();
            return apiError(413, "too_large", "Máximo 5 MB por documento.");
        }
        parts.push(part.value);
    }
    let form: FormData;
    try {
        form = await new Response(new Uint8Array(Buffer.concat(parts)), { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
    }
    catch {
        return apiError(422, "invalid_file", "El formulario no es válido.");
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size > MAX_DOCUMENT_BYTES)
        return apiError(422, "invalid_file", "Selecciona PDF con texto, DOCX o TXT de hasta 5 MB.");
    return file;
}
