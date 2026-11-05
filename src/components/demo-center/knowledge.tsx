"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { demoKnowledge } from "@/server/demo-center";

type Knowledge = NonNullable<Awaited<ReturnType<typeof demoKnowledge>>>;
export function DemoKnowledgeAdmin({ id, knowledge }: { id: string; knowledge: Knowledge }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fragments, setFragments] = useState<Knowledge["fragments"]>([]);
  const url = "/api/demo-center/knowledge?space=" + encodeURIComponent(id);
  async function action(body: FormData | Record<string, unknown>, form?: HTMLFormElement) {
    if (busy) return;
    const original = form ? JSON.stringify(Array.from(new FormData(form).entries()).map(([key, value]) => [key, typeof value === "string" ? value : value.name ? [value.name, value.size, value.lastModified] : null])) : null;
    setBusy(true);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: body instanceof FormData ? { "x-demo-center": "1" } : { "content-type": "application/json" },
        body: body instanceof FormData ? body : JSON.stringify(body),
      });
      const result = await response.json();
      setMessage(response.ok ? (body instanceof FormData ? "Documento cargado." : body.action === "manual" ? "Entrada manual guardada." : "Documento actualizado.") : result.error?.message ?? "No se pudo guardar.");
      if (response.ok) {
        if (form && original === JSON.stringify(Array.from(new FormData(form).entries()).map(([key, value]) => [key, typeof value === "string" ? value : value.name ? [value.name, value.size, value.lastModified] : null]))) {
          form.reset();
          form.dispatchEvent(new Event("input", { bubbles: true }));
        }
        router.refresh();
      }
    } catch {
      setMessage("No se pudo conectar.");
    } finally {
      setBusy(false);
    }
  }
  return <section id="conocimiento" className="w-full space-y-4">
    <div className="space-y-4 rounded-lg border p-4">
      <h2 className="font-semibold">Conocimiento del espacio</h2>
      <p role="status">{message}</p>
      <form className="space-y-2" onSubmit={event => { event.preventDefault(); void action(new FormData(event.currentTarget), event.currentTarget); }}>
        <label className="block">Documento PDF con texto, DOCX o TXT
          <input className="block" type="file" name="file" accept=".pdf,.docx,.txt" required />
        </label>
        <button className="rounded border px-3 py-2" disabled={busy}>Cargar documento</button>
      </form>
      {knowledge.documents.length === 0 && <p>No hay documentos.</p>}
      <ul className="space-y-2">{knowledge.documents.map(doc => <li key={doc.id}>
        <span>{doc.name} · {doc.status === "ready" ? "Listo" : doc.status === "error" ? "Error" : "En proceso"} · {doc.enabled ? "Habilitado" : "Deshabilitado"}</span>
        <button type="button" className="ml-3 underline" disabled={busy}
          onClick={() => void action({ action: "toggle", id: doc.id, enabled: !doc.enabled })}>{doc.enabled ? "Deshabilitar" : "Habilitar"}</button>
        {(doc.status === "error" || doc.status === "processing") && <button type="button" className="ml-3 underline" disabled={busy}
          onClick={() => void action({ action: "recover", id: doc.id })}>Recuperar</button>}
      </li>)}</ul>
      <form className="space-y-2" onSubmit={event => {
        event.preventDefault();
        void action({ action: "manual", content: new FormData(event.currentTarget).get("content") }, event.currentTarget);
      }}>
        <label className="block">Entrada manual<textarea className="block w-full rounded border bg-background p-2" name="content" required maxLength={8000} /></label>
        <button className="rounded border px-3 py-2" disabled={busy}>Añadir entrada</button>
      </form>
      <ul>{knowledge.entries.map(entry => <li key={entry.id} className="whitespace-pre-wrap border-b py-2">{entry.content}</li>)}</ul>
      <form data-temporary className="space-y-2" onSubmit={async event => {
        event.preventDefault();
        const query = String(new FormData(event.currentTarget).get("query"));
        try {
          const response = await fetch(url + "&query=" + encodeURIComponent(query));
          if (!response.ok) throw new Error();
          const result: Knowledge = await response.json();
          setFragments(result.fragments);
          setMessage(result.fragments.length ? "" : "No se encontraron fragmentos.");
        } catch { setFragments([]); setMessage("No se pudo consultar el conocimiento."); }
      }}>
        <label className="block">Consultar fragmentos<input className="block w-full rounded border bg-background p-2" name="query" required maxLength={500} /></label>
        <button className="rounded border px-3 py-2">Buscar</button>
      </form>
      <ul>{fragments.map(item => <li key={item.chunkId} className="whitespace-pre-wrap border-b py-2">{item.name} · {item.text}</li>)}</ul>
    </div>
  </section>;
}
