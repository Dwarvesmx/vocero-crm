"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
type Doc = {
    id: string;
    name: string;
    sizeBytes: number;
    status: string;
    enabled: boolean;
    error: string | null;
    leasedUntil: string | null;
};
export function KbDocuments({onDirty}: {onDirty: (dirty: boolean) => void}) {
    const [docs, setDocs] = useState<Doc[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [selected, setSelected] = useState<File | null>(null);
    useEffect(() => { onDirty(selected !== null); }, [selected, onDirty]);
    const [previews, setPreviews] = useState<Record<string, string>>({});
    async function load() { const r = await fetch("/api/kb/documents"); if (!r.ok)
        throw new Error("No se pudieron consultar los documentos."); setDocs((await r.json()).documents); }
    useEffect(() => { void load().catch(e => setError(e.message)); }, []);
    async function action(url: string, init: RequestInit) {
        setBusy(true);
        setError("");
        try {
            const r = await fetch(url, init);
            const data = await r.json();
            if (!r.ok || !(data.document?.id || data.ok === true))
                throw new Error(data.error?.message ?? "No se pudo completar la operación.");
            if (data.document?.error)
                setError(data.document.error);
            await load();
            return true;
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Error de conexión.");
            return false;
        }
        finally {
            setBusy(false);
        }
    }
    return <Card className="lg:col-span-2"><CardHeader><CardTitle>Documentos de conocimiento</CardTitle><CardDescription>PDF con texto (hasta 100 páginas), DOCX o TXT UTF-8. Máximo 5 MB y 100.000 caracteres por documento. Nea consulta los fragmentos pertinentes; las instrucciones del agente no se reemplazan.</CardDescription></CardHeader><CardContent className="space-y-3">
    <input aria-label="Documento de conocimiento" type="file" accept=".pdf,.docx,.txt" disabled={busy} onChange={e => setSelected(e.target.files?.[0] ?? null)}/>
    <Button disabled={busy || !selected} onClick={async () => { if (!selected)
        return; const form = new FormData(); form.append("file", selected); if (await action("/api/kb/documents", { method: "POST", body: form }))
        setSelected(null); }}>{busy ? "Procesando…" : "Incorporar documento"}</Button>
    {error && <p role="alert" className="text-danger-text">{error}</p>}
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void load().catch(e => setError(e.message))}>Actualizar estado</Button>
    <ul className="space-y-3">{docs.map(doc => <li key={doc.id} className="rounded border p-3 space-y-2"><p>{doc.name} · {Math.ceil(doc.sizeBytes / 1024)} KB · {({ ready: "Listo", processing: "Procesando / pendiente de recuperación", error: "Error", deleting: "Eliminación pendiente" } as Record<string, string>)[doc.status]} · {doc.enabled ? "Habilitado" : "Deshabilitado"}</p>{doc.error && <p role="alert">{doc.error}</p>}
      <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy || doc.status !== "ready"} onClick={async () => {
                setError("");
                try {
                    const r = await fetch(`/api/kb/documents/${doc.id}`);
                    if (!r.ok)
                        throw new Error("No se pudo consultar el texto.");
                    const data = await r.json();
                    setPreviews(p => ({ ...p, [doc.id]: data.preview }));
                }
                catch (e) {
                    setError(e instanceof Error ? e.message : "Error de conexión.");
                }
            }}>Ver texto extraído</Button><Button size="sm" variant="outline" disabled={busy || doc.status !== "ready"} onClick={() => void action(`/api/kb/documents/${doc.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !doc.enabled }) })}>{doc.enabled ? "Deshabilitar" : "Habilitar"}</Button>
      {(doc.status === "error" || doc.status === "processing") && <Button size="sm" variant="outline" disabled={busy} onClick={() => void action(`/api/kb/documents/${doc.id}`, { method: "POST" })}>Recuperar procesamiento</Button>}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm(`¿Eliminar ${doc.name} y sus fragmentos?`))
            void action(`/api/kb/documents/${doc.id}`, { method: "DELETE" }); }}>Eliminar</Button></div>
    {previews[doc.id] && <details open><summary>Vista previa parcial del texto extraído</summary><pre className="whitespace-pre-wrap text-sm">{previews[doc.id]}</pre></details>}</li>)}</ul>{!docs.length && <p className="text-sm text-muted-foreground">Todavía no hay documentos.</p>}
  </CardContent></Card>;
}
