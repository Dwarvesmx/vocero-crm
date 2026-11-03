/** No confirmar guardado por un 2xx sin el ACK de la aplicación. */
export async function guardarConfiguracionAgente(url: string, method: "PUT" | "POST", patch: unknown) {
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.ok !== true)
        throw new Error(data?.error?.message ?? "No se pudo confirmar el guardado. Tus cambios se conservan.");
    return data;
}
