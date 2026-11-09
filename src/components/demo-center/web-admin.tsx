"use client";

import { useEffect, useState } from "react";

type Sesion = { id: string; state: string; expires_at: string; idle_deadline: string; turns: number; cost: string; held: string; pending: string | null;
  whatsapp?: { state: string; mode: string; generation: number; reviewDueAt?: string; turns: number; cost: string; pending: number;
    financialPending?: string; deliveryPending?: string; noticePending?: string; dispatchErrors: number } };
type Estado = { enabled: boolean; sessions: Sesion[] };
const avisos: Record<string, string> = {
  invalid_phone: "Escribe el teléfono con código de país y sin espacios.",
  whatsapp_unavailable: "WhatsApp no está disponible. Puedes crear una invitación web sin teléfono.",
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
  const [telefono, setTelefono] = useState("");
  const [enlaceWhatsApp, setEnlaceWhatsApp] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [confirmar, setConfirmar] = useState<{ id: string; action: "revoke" | "restoreWhatsApp" }>();

  useEffect(() => {
    let cancelado = false;
    leer(spaceId).then(data => { if (!cancelado) setEstado(data); })
      .catch(e => { if (!cancelado) setError(e.message); });
    return () => { cancelado = true; };
  }, [spaceId]);

  async function operar(accion: Record<string, string | number>) {
    setConfirmar(undefined);
    setError("");
    setAviso("");
    setOcupado(true);
    try {
      const res = await fetch("/api/demo-center/web", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...accion, spaceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(avisos[data.error] ?? "No se pudo completar la operación.");
      if (accion.action === "invite") {
        setEnlace(`${window.location.origin}/demos#acceso=${data.token}`);
        setEnlaceWhatsApp(data.whatsapp?.url ?? "");
        setTelefono("");
      }
      if (accion.action === "revoke") { setEnlace(""); setEnlaceWhatsApp(""); }
      if (accion.action === "reconcile" || accion.action === "reconcileWhatsApp" || accion.action === "reconcileNotice") {
        const resultado: Record<string,string> = { settled: "Costo confirmado.", released: "Reserva liberada sin llamada al proveedor.",
          delivered: "Entrega confirmada.", accepted: "Envío aceptado por el proveedor.", failed: "El proveedor confirmó un fallo." };
        setAviso(resultado[data.status] ?? "La operación sigue pendiente de revisión.");
      }
      setEstado(await leer(spaceId));
    } catch (e) { setError((e as Error).message || "No se pudo confirmar la operación. Actualiza el estado antes de reintentar."); }
    finally { setOcupado(false); }
  }

  return <section className="space-y-4 rounded-xl border p-4">
    <div>
      <h2 className="text-lg font-semibold">Demo para prospectos</h2>
      <p className="text-sm text-muted-foreground">Cada enlace da acceso a una sola sesión del espacio y caduca según sus límites desde la emisión. Compártelo en privado.</p>
    </div>
    {estado?.enabled === false && <p role="status" className="text-sm">El portal web está deshabilitado en este entorno.</p>}
    {estado?.enabled && <label className="block text-sm">
      Teléfono del participante (opcional)
      <input value={telefono} onChange={e => setTelefono(e.target.value)} type="tel" autoComplete="off"
        maxLength={16} disabled={ocupado} placeholder="+52…" className="mt-1 block rounded-lg border p-2" />
      <span className="mt-1 block text-muted-foreground">Con teléfono, se prepara un enlace de WhatsApp. La sesión empieza cuando el participante envía el mensaje desde ese número.</span>
    </label>}
    <div className="flex flex-wrap gap-2">
      <button className={boton} type="button" disabled={!estado?.enabled || ocupado} onClick={() => void operar({ action: "invite", ...(telefono.trim() && { phone: telefono.trim() }) })}>{telefono.trim() ? "Preparar WhatsApp" : "Crear invitación web"}</button>
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
    {enlaceWhatsApp && <label className="block text-sm">Enlace privado de WhatsApp para el participante
      <input readOnly value={enlaceWhatsApp} onFocus={e => e.target.select()} className="mt-1 w-full rounded-lg border p-2" />
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
          {(["active", "suspended"].includes(s.state) || s.whatsapp?.state === "active") && <button type="button" className={boton} disabled={ocupado}
            onClick={() => setConfirmar({ id: s.id, action: "revoke" })}>{s.whatsapp?.state === "active" ? "Finalizar y revocar WhatsApp" : "Revocar"}</button>}
          {s.pending && <button type="button" className={boton} disabled={ocupado}
            onClick={() => void operar({ action: "reconcile", operationId: s.pending! })}>Conciliar reserva</button>}
          {s.whatsapp?.mode === "blocked" && <button type="button" className={boton} disabled={ocupado}
            onClick={() => setConfirmar({ id: s.id, action: "restoreWhatsApp" })}>Restituir atención comercial</button>}
          {confirmar?.id === s.id && <div className="w-full space-y-2 rounded-lg border p-3" role="group" aria-label="Confirmar acción">
            <p>{confirmar.action === "revoke" ? "Se cerrará la sesión activa y WhatsApp quedará en cuarentena."
              : "Se reanudará la atención comercial solo para mensajes nuevos. Si hay trabajo incierto, seguirá en cuarentena."}</p>
            <button type="button" autoFocus className={boton} disabled={ocupado} onClick={() => void operar({
              action: confirmar.action, sessionId: s.id,
              ...(confirmar.action === "restoreWhatsApp" && { generation: s.whatsapp!.generation }),
            })}>Confirmar</button>{" "}
            <button type="button" className={boton} onClick={() => setConfirmar(undefined)}>Cancelar</button>
          </div>}
          {s.whatsapp?.financialPending && <button type="button" className={boton} disabled={ocupado}
            onClick={() => void operar({ action: "reconcileWhatsApp", kind: "financial", operationId: s.whatsapp!.financialPending! })}>Conciliar costo WhatsApp</button>}
          {s.whatsapp?.noticePending && <button type="button" className={boton} disabled={ocupado}
            onClick={() => void operar({ action: "reconcileNotice", noticeId: s.whatsapp!.noticePending! })}>Revisar aviso incierto</button>}
          {s.whatsapp?.deliveryPending && <button type="button" className={boton} disabled={ocupado}
            onClick={() => void operar({ action: "reconcileWhatsApp", kind: "delivery", operationId: s.whatsapp!.deliveryPending! })}>Conciliar salida WhatsApp</button>}
        </div>
      </li>)}
    </ul>
  </section>;
}
