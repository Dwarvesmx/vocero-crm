"use client";

import { useEffect, useState } from "react";

type Sesion = { id: string; state: string; expires_at: string; idle_deadline: string; turns: number; cost: string; held: string; pending: string | null;
  whatsapp?: { state: string; mode: string; generation: number; reviewDueAt?: string; turns: number; cost: string; pending: number;
    financialPending?: string; deliveryPending?: string; dispatchErrors: number } };
type Estado = { enabled: boolean; sessions: Sesion[] };
const avisos: Record<string, string> = {
  real_not_enabled: "Habilita la IA real para emitir una invitación.",
  openrouter_required: "Configura OpenRouter para esta organización en Ajustes → IA.",
  policy_required: "Configura límites globales y del espacio con ventanas vigentes.",
  session_budget_required: "Configura presupuestos positivos global, del espacio y por sesión.",
  space_unavailable: "Publica un perfil y activa el espacio.",
  quota_exceeded: "Se alcanzó el límite de sesiones.",
  generation_id_missing: "No hay un identificador verificable. La reserva sigue protegida.",
  thread_busy: "Hay despachos o reservas pendientes. Revisa y concilia antes de restituir la atención comercial.",
};
const estados: Record<string, string> = { active: "Activa", suspended: "Suspendida", closed: "Finalizada", expired: "Caducada", revoked: "Revocada" };
const dinero = (micro: string) => {
  const n = BigInt(micro);
  return `US$${n / 1000000n}.${String(n % 1000000n).padStart(6, "0")}`;
};
const boton = "rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";

async function leer(spaceId: string): Promise<Estado> {
  const res = await fetch(`/api/demo-center/web?spaceId=${encodeURIComponent(spaceId)}`, { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo cargar el estado de las invitaciones.");
  return res.json();
}

export function InvitacionesDemoWeb({ spaceId }: { spaceId: string }) {
  const [estado, setEstado] = useState<Estado>();
  const [enlace, setEnlace] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    let cancelado = false;
    leer(spaceId).then(data => { if (!cancelado) setEstado(data); })
      .catch(e => { if (!cancelado) setError(e.message); });
    return () => { cancelado = true; };
  }, [spaceId]);

  async function operar(accion: Record<string, string | number>) {
    setError("");
    setAviso("");
    setOcupado(true);
    try {
      const res = await fetch("/api/demo-center/web", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...accion, spaceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(avisos[data.error] ?? "No se pudo completar la operación.");
      if (accion.action === "invite") setEnlace(`${window.location.origin}/demos#acceso=${data.token}`);
      if (accion.action === "revoke") setEnlace("");
      if (accion.action === "reconcile" || accion.action === "reconcileWhatsApp") {
        const resultado: Record<string,string> = { settled: "Costo confirmado.", released: "Reserva liberada sin llamada al proveedor.",
          delivered: "Entrega confirmada.", accepted: "Envío aceptado por el proveedor.", failed: "El proveedor confirmó un fallo." };
        setAviso(resultado[data.status] ?? "La operación sigue pendiente de revisión.");
      }
      setEstado(await leer(spaceId));
    } catch (e) { setError((e as Error).message); }
    finally { setOcupado(false); }
  }

  return <section className="space-y-4 rounded-xl border p-4">
    <div>
      <h2 className="text-lg font-semibold">Demo para prospectos</h2>
      <p className="text-sm text-muted-foreground">Cada enlace da acceso a una sola sesión del espacio y caduca según sus límites desde la emisión. Compártelo en privado.</p>
    </div>
    {estado?.enabled === false && <p role="status" className="text-sm">El portal web está deshabilitado en este entorno.</p>}
    <div className="flex flex-wrap gap-2">
      <button className={boton} type="button" disabled={!estado?.enabled || ocupado} onClick={() => void operar({ action: "invite" })}>Crear invitación</button>
      <button className={boton} type="button" disabled={ocupado} onClick={async () => {
        setOcupado(true);
        setError("");
        try { setEstado(await leer(spaceId)); }
        catch (e) { setError((e as Error).message); }
        finally { setOcupado(false); }
      }}>Actualizar uso</button>
    </div>
    {enlace && <label className="block text-sm">Enlace de invitación. Cópialo antes de salir.
      <input readOnly value={enlace} onFocus={e => e.target.select()} className="mt-1 w-full rounded-lg border p-2" />
    </label>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {aviso && <p role="status" className="text-sm">{aviso}</p>}
    {estado && !estado.sessions.length && <p className="text-sm text-muted-foreground">Todavía no hay invitaciones.</p>}
    <ul className="space-y-2">
      {estado?.sessions.map(s => <li key={s.id} className="space-y-2 rounded-lg border p-3 text-sm">
        <p><strong>{estados[s.state] ?? s.state}</strong> · {s.turns} operaciones · {dinero(s.cost)} confirmado · {dinero(s.held)} retenido</p>
        <p className="text-muted-foreground">Vence {new Date(Math.min(+new Date(s.expires_at), +new Date(s.idle_deadline))).toLocaleString()}</p>
        {s.whatsapp && <p>WhatsApp · {estados[s.whatsapp.state] ?? s.whatsapp.state} · {s.whatsapp.turns} operaciones · {dinero(s.whatsapp.cost)}
          {" · "}{s.whatsapp.pending} salidas pendientes{s.whatsapp.mode === "blocked" ? " · En cuarentena" : ""}
          {s.whatsapp.dispatchErrors > 0 ? ` · ${s.whatsapp.dispatchErrors} despachos detenidos` : ""}
          {s.whatsapp.reviewDueAt ? " · Revisar antes de " + new Date(s.whatsapp.reviewDueAt).toLocaleString() : ""}</p>}
        <div className="flex flex-wrap gap-2">
          {["active", "suspended"].includes(s.state) && <button type="button" className={boton} disabled={ocupado}
            onClick={() => { if (window.confirm("¿Revocar este acceso?")) void operar({ action: "revoke", sessionId: s.id }); }}>Revocar</button>}
          {s.pending && <button type="button" className={boton} disabled={ocupado}
            onClick={() => void operar({ action: "reconcile", operationId: s.pending! })}>Conciliar reserva</button>}
          {s.whatsapp?.mode === "blocked" && <button type="button" className={boton} disabled={ocupado}
            onClick={() => { if (window.confirm("¿Restituir atención comercial? Solo un mensaje nuevo podrá llegar a Lukas.")) {
              void operar({ action: "restoreWhatsApp", sessionId: s.id, generation: s.whatsapp!.generation });
            } }}>Restituir atención comercial</button>}
          {s.whatsapp?.financialPending && <button type="button" className={boton} disabled={ocupado}
            onClick={() => void operar({ action: "reconcileWhatsApp", kind: "financial", operationId: s.whatsapp!.financialPending! })}>Conciliar costo WhatsApp</button>}
          {s.whatsapp?.deliveryPending && <button type="button" className={boton} disabled={ocupado}
            onClick={() => void operar({ action: "reconcileWhatsApp", kind: "delivery", operationId: s.whatsapp!.deliveryPending! })}>Conciliar salida WhatsApp</button>}
        </div>
      </li>)}
    </ul>
  </section>;
}
