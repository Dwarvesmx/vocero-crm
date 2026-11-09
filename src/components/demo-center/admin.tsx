"use client";

import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DemoSimulator } from "./simulator";
import { InvitacionesDemoWeb } from "./web-admin";
import { DemoKnowledgeAdmin } from "./knowledge";
import { localInput, microToUsd, usdToMicro } from "./format";
import type { demoKnowledge, consultarEspacio, consultarExcepciones, consultarPoliticaGlobal, listarEspacios } from "@/server/demo-center";

type Spaces = Awaited<ReturnType<typeof listarEspacios>>;
type Detail = Awaited<ReturnType<typeof consultarEspacio>>;
const sectors = ["Restaurante", "Inmobiliaria", "Consultorio", "Comercio", "Servicios", "Personalizado"];
const inputStyle = "w-full rounded-md border bg-background px-3 py-2";
const buttonStyle = "rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50";


export function DemoCenterAdmin({ spaces, detail, globalPolicy, exceptions, knowledge, global }: { spaces: Spaces; detail: Detail; globalPolicy: Awaited<ReturnType<typeof consultarPoliticaGlobal>>; exceptions: Awaited<ReturnType<typeof consultarExcepciones>>; knowledge: Awaited<ReturnType<typeof demoKnowledge>>; global: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState("general");
  const [dirty, setDirty] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const baselines = useRef(new WeakMap<HTMLFormElement, string>());
  const snapshot = (form: HTMLFormElement) => JSON.stringify(Array.from(new FormData(form).entries()).map(([key, value]) =>
    [key, typeof value === "string" ? value : value.name ? [value.name, value.size, value.lastModified] : null]));
  function updateDirty() {
    const forms = containerRef.current?.querySelectorAll<HTMLFormElement>("form:not([data-temporary])") ?? [];
    setDirty(Array.from(forms).some(form => {
      const base = baselines.current.get(form);
      return base !== undefined && base !== snapshot(form);
    }));
  }
  useEffect(() => {
    const forms = containerRef.current?.querySelectorAll<HTMLFormElement>("form:not([data-temporary])") ?? [];
    forms.forEach(form => { if (!baselines.current.has(form)) baselines.current.set(form, snapshot(form)); });
  });
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabs = detail ? [["general","General"],["assistant","Asistente"],["knowledge","Conocimiento"],["phones","Teléfonos"],["limits","Límites"],["audit","Auditoría"],["web","Demo web"],["simulator","Simulador"]] : global ? [["limits","Configuración global"]] : [["general","General"]];
  const active = tabs.some(([id]) => id === tab) ? tab : tabs[0]![0]!;
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function navigate(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (dirty && !window.confirm("Hay cambios sin guardar. ¿Deseas descartarlos?")) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    setDirty(false);
    router.push(href);
  }
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length :
      event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length :
      event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    const id = tabs[next]![0]!;
    setTab(id);
    tabRefs.current[id]?.focus();
  }
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [windowError, setWindowError] = useState("");
  const [sector, setSector] = useState("Personalizado");
  const space = detail?.space;
  const policy = space ? detail.limits : globalPolicy;
  const profile = detail?.profiles[0];
  const color = (space?.visualIdentity as { color?: string } | undefined)?.color ?? "#2563eb";

  async function send(command: Record<string, unknown>, policy = false, formElement?: HTMLFormElement, clear = false) {
    if (busy) return;
    const submitted = formElement ? snapshot(formElement) : null;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(policy ? "/api/demo-center/policy" : "/api/demo-center", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "No se pudo guardar.");
      if (formElement && submitted !== null) {
        if (clear && snapshot(formElement) === submitted) {
          formElement.reset();
          baselines.current.set(formElement, snapshot(formElement));
        } else {
          baselines.current.set(formElement, submitted);
        }
        updateDirty();
      }
      const messages: Record<string, string> = { create: "Espacio creado.", edit: "Espacio actualizado.", publishProfile: "Versión publicada.", authorize: "Teléfono autorizado.", revoke: "Teléfono revocado.", limits: "Límites guardados.", globalLimits: "Límites globales guardados.", budgetException: "Excepción registrada.", status: "Estado actualizado." };
      setMessage(messages[String(command.action)] ?? "Cambios guardados.");
      if (command.action === "create") router.push("/demo-center?id=" + encodeURIComponent(result.id));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  function saveSpace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void send({
      ...(space ? { action: "edit", id: space.id, expectedGeneration: space.generation } : { action: "create" }),
      space: {
        name: form.get("name"), commercialName: form.get("commercialName"), sector: form.get("sector"),
        description: form.get("description"), visualIdentity: { color: form.get("color"), demoPolicy: form.get("demoPolicy") },
      },
    }, false, event.currentTarget);
  }

  function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!space) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    void send({ action: "publishProfile", id: space.id, expectedGeneration: space.generation, profile: { ...values, tools: [] } }, false, event.currentTarget);
  }

  return <main className="mx-auto w-full max-w-screen-2xl space-y-6 p-4 sm:p-6">
    <header><h1 className="text-2xl font-semibold">Demo Center</h1>
      <p className="text-sm text-muted-foreground">Configuración administrativa de demostraciones. WhatsApp aún no está disponible para las demos.</p>
    </header>
    <section className="grid min-w-0 gap-6 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
      <nav className="space-y-3 rounded-lg border p-4" aria-label="Espacios demo">
        <div className="space-y-3">
          <Link className="block font-medium underline" href="/demo-center" onClick={e => navigate(e, "/demo-center")}>Nuevo espacio</Link>
          <Link className="block font-medium underline" href="/demo-center?vista=global" aria-current={global ? "page" : undefined} onClick={e => navigate(e, "/demo-center?vista=global")}>Configuración global</Link>
        </div>
        {spaces.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay espacios.</p>}
        <ul className="space-y-2">{spaces.map(item => <li key={item.id}>
          <Link className="block rounded-md border p-2" aria-current={item.id === space?.id ? "page" : undefined}
            href={"/demo-center?id=" + encodeURIComponent(item.id)} onClick={e => { if (item.id === space?.id) { e.preventDefault(); return; } navigate(e, "/demo-center?id=" + encodeURIComponent(item.id)); }}>{item.name} · {statusLabel[item.status]}</Link>
        </li>)}</ul>
      </nav>
      <div ref={containerRef} className="min-w-0 space-y-4" onInputCapture={event => { if (!(event.target as HTMLElement).closest("form[data-temporary]")) updateDirty(); }}
        onChangeCapture={event => { if (!(event.target as HTMLElement).closest("form[data-temporary]")) updateDirty(); }}>
        <div role="tablist" aria-label="Secciones de administración" className="flex flex-wrap gap-2 border-b pb-2">
          {tabs.map(([id, label], index) => <button key={id} ref={node => { tabRefs.current[id!] = node; }}
            id={"tab-" + id} role="tab" type="button" aria-selected={active === id} aria-controls={"panel-" + id}
            tabIndex={active === id ? 0 : -1} onClick={() => setTab(id!)} onKeyDown={event => moveTab(event, index)}
            className={active === id ? "rounded border px-3 py-2 font-semibold" : "rounded px-3 py-2 underline"}>{label}</button>)}
        </div>
        <p role="status" aria-live="polite">{message}</p>
        <div role="tabpanel" id="panel-general" aria-labelledby="tab-general" hidden={active !== "general"}>
        {!global && <form id="datos" key={"space:" + (space?.id ?? "new")} onSubmit={saveSpace} className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold">{space ? "Información del espacio" : "Crear espacio"}</h2>
          {!space && <label className="block">Plantilla inicial
            <select className={inputStyle} value={sector} onChange={e => setSector(e.target.value)}>
              {sectors.map(item => <option key={item}>{item}</option>)}
            </select>
          </label>}
          <div key={space?.id ?? sector} className="space-y-3">
            <label className="block">Nombre del negocio<input className={inputStyle} name="name" required maxLength={120}
              defaultValue={space?.name ?? (sector === "Personalizado" ? "" : sector + " ficticio")} /></label>
            <label className="block">Nombre comercial<input className={inputStyle} name="commercialName" required maxLength={120}
              defaultValue={space?.commercialName ?? (sector === "Personalizado" ? "" : "Ejemplo ficticio de " + sector.toLowerCase())} /></label>
            <label className="block">Sector<input className={inputStyle} name="sector" required maxLength={120} defaultValue={space?.sector ?? sector} /></label>
            <label className="block">Descripción<textarea className={inputStyle} name="description" maxLength={2000}
              defaultValue={space?.description ?? (sector === "Personalizado" ? "" : "Datos ficticios para una demostración editable.")} /></label>
            <label className="block">Color de identidad<input className="ml-2" name="color" type="color" defaultValue={color} /></label>
            <label className="block">Acceso conversacional de prospectos
              <select name="demoPolicy" className={inputStyle} defaultValue={(space?.visualIdentity as {demoPolicy?:string} | undefined)?.demoPolicy ?? "supervised"}>
                <option value="disabled">Deshabilitado</option>
                <option value="supervised">Supervisado: autorización administrativa previa</option>
                <option value="automatic">Automático: piloto autorizado, identidad verificada y consentimiento</option>
              </select>
              <span className="block text-sm text-muted-foreground">Los límites, presupuestos, revocaciones y cuarentenas siguen vigentes.</span>
            </label>
          </div>
          <button className={buttonStyle} disabled={busy}>Guardar espacio</button>
        </form>}
        {space && <section className="mt-4 space-y-2 rounded-lg border p-4">
            <h2 className="font-semibold">Estado · {statusLabel[space.status]}</h2>
            <button type="button" className={buttonStyle} disabled={busy || (!profile && space.status !== "active")} onClick={() => {
              const status = space.status === "active" ? "disabled" : "active";
              if (window.confirm(status === "active" ? "¿Activar la configuración del espacio?" : "¿Desactivar el espacio?")) void send({ action: "status", id: space.id, expectedGeneration: space.generation, status });
            }}>{space.status === "active" ? "Desactivar" : "Activar configuración"}</button>
          </section>}
        </div>
        <div role="tabpanel" id="panel-limits" aria-labelledby="tab-limits" hidden={active !== "limits" || (!space && !global)}>
          <form id="limites" key={"limits:" + (space?.id ?? "global")} className="space-y-3 rounded-lg border p-4" onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const start = String(form.get("windowStart"));
            const end = String(form.get("windowEnd"));
            if (!start || !end || !Number.isFinite(new Date(start).getTime()) || !Number.isFinite(new Date(end).getTime()) || new Date(end).getTime() <= new Date(start).getTime()) {
              setWindowError("Indica ambas fechas y comprueba que el fin sea posterior al inicio.");
              return;
            }
            for (const field of ["maxDurationSeconds", "maxIdleSeconds"]) {
              const seconds = Number(form.get(field)) * 60;
              if (!Number.isFinite(seconds) || Math.abs(seconds - Math.round(seconds)) > 0.000001) {
                setMessage("La duración y la inactividad deben equivaler a segundos completos.");
                return;
              }
            }
            setWindowError("");
            const values = Object.fromEntries(limitCounters.map(([key]) => [key,
              Math.round(Number(form.get(key)) * (key === "maxDurationSeconds" || key === "maxIdleSeconds" ? 60 : 1))]));
            if (Number(values.maxIdleSeconds) > Number(values.maxDurationSeconds)) {
              setMessage("La inactividad no puede superar la duración máxima.");
              return;
            }
            let budget: string;
            let sessionBudget: string | null;
            try {
              budget = usdToMicro(String(form.get("budgetMicroUsd")));
              const input = String(form.get("sessionBudgetMicroUsd") ?? "");
              sessionBudget = input ? usdToMicro(input) : null;
            } catch { setMessage("Introduce presupuestos válidos en USD, con hasta seis decimales."); return; }
            void send({ ...(space ? { action: "limits", id: space.id, expectedGeneration: space.generation }
              : { action: "globalLimits", expectedVersion: globalPolicy?.version ?? 0 }), limits: {
              ...values, budgetMicroUsd: budget, sessionBudgetMicroUsd: sessionBudget,
              windowStart: new Date(start).toISOString(),
              windowEnd: new Date(end).toISOString(), enabled: form.has("enabled"),
            } }, !space, event.currentTarget);
          }}>
            <h2 className="font-semibold">{space ? "Límites del espacio" : "Límites globales de Demo Center"}</h2>
            <p className="text-sm text-muted-foreground">Configuración administrativa. El motor de cuotas se incorporará en una fase posterior. La ventana determina el periodo de sesiones iniciadas. Las políticas global y del espacio se aplicarán conjuntamente. Cero y el presupuesto por sesión vacío aún requieren definición operativa. La zona horaria es la del navegador.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {limitCounters.map(([key, label]) => <label key={key}>{label}<input className={inputStyle} name={key}
                type="number" required min={0} step="any" max={key === "maxDurationSeconds" || key === "maxIdleSeconds" ? 35791394 : 2147483647} defaultValue={(policy?.[key] ?? 0) / (key === "maxDurationSeconds" || key === "maxIdleSeconds" ? 60 : 1)} /></label>)}
              <label>{space ? "Presupuesto del espacio (USD)" : "Presupuesto global (USD)"}<input className={inputStyle} name="budgetMicroUsd" required
                inputMode="decimal" pattern="[0-9]{1,12}([.][0-9]{1,6})?" defaultValue={microToUsd(policy?.budgetMicroUsd ?? "0")} /></label>
              {space && <label>Presupuesto por sesión (USD)<input className={inputStyle} name="sessionBudgetMicroUsd"
                inputMode="decimal" pattern="[0-9]{1,12}([.][0-9]{1,6})?" defaultValue={microToUsd(policy?.sessionBudgetMicroUsd)} /></label>}
              <label>Inicio de ventana obligatorio (hora local)<input className={inputStyle} name="windowStart" type="datetime-local" step="1"
                required defaultValue={localInput(policy?.windowStart)} /></label>
              <label>Fin de ventana obligatorio (hora local)<input aria-invalid={!!windowError} aria-describedby={windowError ? "window-error" : undefined} className={inputStyle} name="windowEnd" type="datetime-local" step="1"
                required defaultValue={localInput(policy?.windowEnd)} /></label>
            </div>
            {windowError && <p id="window-error" role="alert" className="text-sm text-red-700">{windowError}</p>}
            <label className="block"><input type="checkbox" name="enabled" defaultChecked={policy?.enabled ?? true} /> Política habilitada</label>
            <button className={buttonStyle} disabled={busy}>Guardar límites</button>
          </form>
        <form key={"exception:" + (space?.id ?? "global")} className="space-y-3 rounded-lg border p-4" onSubmit={event => {
          event.preventDefault();
          if (!window.confirm("¿Registrar esta excepción presupuestaria?")) return;
          const form = new FormData(event.currentTarget);
          void send({ action: "budgetException", spaceId: space?.id ?? null, extraBudgetMicroUsd: usdToMicro(String(form.get("amount"))),
            expiresAt: new Date(String(form.get("expiresAt"))).toISOString(), reason: form.get("reason") }, true, event.currentTarget, true);
        }}>
          <h2 className="font-semibold">Excepción presupuestaria {space ? "del espacio" : "global"}</h2>
          <label className="block">Monto adicional (USD)<input name="amount" className={inputStyle} required pattern="[0-9]{1,12}([.][0-9]{1,6})?" /></label>
          <label className="block">Vencimiento (hora local)<input type="datetime-local" name="expiresAt" className={inputStyle} required /></label>
          <label className="block">Motivo<select name="reason" className={inputStyle}><option value="demonstration">Demostración</option><option value="operational_review">Revisión operativa</option></select></label>
          <button className={buttonStyle} disabled={busy}>Registrar excepción</button>
          {exceptions.length > 0 && <ul className="space-y-1 text-sm">{exceptions.map(item => <li key={item.id}>
            USD {microToUsd(item.extraBudgetMicroUsd)} · {item.reason === "demonstration" ? "Demostración" : "Revisión operativa"} · vence {new Date(item.expiresAt).toLocaleString()}
          </li>)}</ul>}
        </form>
        </div>
        {space && <>
          <div role="tabpanel" id="panel-assistant" aria-labelledby="tab-assistant" hidden={active !== "assistant"}>
          <form id="asistente" key={"profile:" + space.id + ":" + (profile?.version ?? 0)} onSubmit={publish} className="space-y-3 rounded-lg border p-4">
            <h2 className="font-semibold">Asistente · {profile ? "Versión publicada " + profile.version : "Sin perfil publicado"}</h2>
            <p className="text-sm text-muted-foreground">Nombre, rol e instrucciones son obligatorios. Publicar una versión no activa el espacio.</p>
            {detail.profiles.length > 0 && <details><summary>Versiones publicadas</summary><ul>{detail.profiles.map(version => <li key={version.id}>Versión {version.version} · {version.name}</li>)}</ul></details>}
            <label className="block">Nombre<input className={inputStyle} name="name" required maxLength={120} defaultValue={profile?.name} /></label>
            <label className="block">Rol<input className={inputStyle} name="role" required maxLength={120} defaultValue={profile?.role ?? "Información"} /></label>
            <label className="block">Tono<input className={inputStyle} name="tone" maxLength={500} defaultValue={profile?.tone} /></label>
            <label className="block">Instrucciones<textarea className={inputStyle} name="instructions" required maxLength={12000} defaultValue={profile?.instructions} /></label>
            <label className="block">Bienvenida<textarea className={inputStyle} name="greeting" maxLength={1000} defaultValue={profile?.greeting} /></label>
            <label className="block">Reglas de escalamiento<textarea className={inputStyle} name="escalationRules" maxLength={3000} defaultValue={profile?.escalationRules} /></label>
            <p className="text-sm text-muted-foreground">Herramientas externas deshabilitadas.</p>
            <button className={buttonStyle} disabled={busy}>Publicar nueva versión</button>
          </form>
          </div>
          <div role="tabpanel" id="panel-phones" aria-labelledby="tab-phones" hidden={active !== "phones"}>
          <section className="space-y-3 rounded-lg border p-4">
            <h2 id="telefonos" className="font-semibold">Teléfonos autorizados</h2>
            <h3 className="font-medium">Participantes del piloto automático</h3>
            <p className="text-sm text-muted-foreground">El acceso piloto es persistente; cada demostración sigue requiriendo consentimiento y respetando cuarentenas y límites.</p>
            <form className="space-y-2" onSubmit={event => {
              event.preventDefault();
              void send({ action: "pilotAllow", id: space.id, expectedGeneration: space.generation,
                phone: new FormData(event.currentTarget).get("phone") }, false, event.currentTarget, true);
            }}>
              <label className="block">Teléfono internacional<input className={inputStyle} type="tel" name="phone" required placeholder="+521234567890" maxLength={16} /></label>
              <button className={buttonStyle} disabled={busy}>Autorizar piloto</button>
            </form>
            <ul className="space-y-2">{detail.pilots.map(item => <li key={item.id} className="flex items-center justify-between gap-2">
              <span>•••• {item.suffix} · {item.state === "blocked" ? "Bloqueado" : "Piloto autorizado"}</span>
              {item.state === "allowed" && <button type="button" className={buttonStyle} disabled={busy} onClick={() => {
                if (window.confirm("¿Bloquear este participante del piloto?"))
                  void send({ action: "pilotBlock", id: space.id, expectedGeneration: space.generation, participantId: item.id });
              }}>Bloquear</button>}
              {item.state === "blocked" && <button type="button" className={buttonStyle} disabled={busy} onClick={() => {
                if (window.confirm("¿Levantar el bloqueo de este participante?"))
                  void send({ action: "pilotUnblock", id: space.id, expectedGeneration: space.generation, participantId: item.id });
              }}>Levantar bloqueo</button>}
            </li>)}</ul>
            <h3 className="font-medium">Autorizaciones temporales</h3>
            <form className="space-y-2" onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const expires = String(form.get("expiresAt") ?? "");
              void send({ action: "authorize", id: space.id, expectedGeneration: space.generation,
                phone: form.get("phone"), expiresAt: expires ? new Date(expires).toISOString() : null }, false, event.currentTarget, true);
            }}>
              <label className="block">Teléfono internacional<input className={inputStyle} type="tel" name="phone"
                required placeholder="+521234567890" maxLength={16} /></label>
              <label className="block">Vencimiento opcional<input className={inputStyle} name="expiresAt" type="datetime-local" /></label>
              <button className={buttonStyle} disabled={busy}>Autorizar teléfono</button>
            </form>
            {detail.authorizations.length === 0 && <p>Aún no hay teléfonos autorizados.</p>}
            <ul className="space-y-2">{detail.authorizations.map(item => <li key={item.id} className="flex items-center justify-between gap-2">
              <span>•••• {item.suffix} · {item.state === "revoked" ? "Revocado" : item.expiresAt && new Date(item.expiresAt) <= new Date() ? "Vencido" : "Autorizado"}</span>
              {item.state === "active" && <button type="button" className={buttonStyle} disabled={busy} onClick={() => {
                if (window.confirm("¿Revocar este teléfono?"))
                  void send({ action: "revoke", id: space.id, expectedGeneration: space.generation, authorizationId: item.id });
              }}>Revocar</button>}
            </li>)}</ul>
          </section>
          </div>
          <div role="tabpanel" id="panel-audit" aria-labelledby="tab-audit" hidden={active !== "audit"}>
          <section className="rounded-lg border p-4">
            <h2 id="auditoria" className="font-semibold">Auditoría reciente</h2>
            <ul className="mt-2 space-y-2 text-sm">{detail.audit.map(entry => <li key={entry.id}>
              {auditLabel[entry.action] ?? entry.action} · {new Date(entry.timestamp).toLocaleString()}{entry.newVersion !== null && " · revisión " + entry.newVersion}
            </li>)}</ul>
          </section>
          </div>
          <div role="tabpanel" id="panel-simulator" aria-labelledby="tab-simulator" hidden={active !== "simulator"}><DemoSimulator key={space.id} spaceId={space.id} /></div>
          <div role="tabpanel" id="panel-web" aria-labelledby="tab-web" hidden={active !== "web"}>
            {active === "web" && <InvitacionesDemoWeb spaceId={space.id} />}
          </div>
          <div role="tabpanel" id="panel-knowledge" aria-labelledby="tab-knowledge" hidden={active !== "knowledge"}>
            {knowledge && <DemoKnowledgeAdmin id={space.id} knowledge={knowledge} />}
          </div>
        </>}
      </div>
    </section>
  </main>;
}

const limitCounters = [
  ["maxDurationSeconds", "Duración máxima (minutos)"], ["maxIdleSeconds", "Inactividad (minutos)"],
  ["maxConcurrentSessions", "Sesiones simultáneas"], ["maxSessionsStarted", "Sesiones por periodo"],
  ["maxInboundMessages", "Entradas"], ["maxAssistantResponses", "Respuestas"], ["maxProviderCalls", "Llamadas de IA"],
] as const;

const statusLabel = { draft: "Borrador", active: "Activo", disabled: "Desactivado" };
const auditLabel: Record<string, string> = { create: "Espacio creado", edit: "Espacio editado", status: "Estado actualizado", publishProfile: "Perfil publicado", authorize: "Teléfono autorizado", revoke: "Teléfono revocado", limits: "Límites guardados", knowledge_manual: "Conocimiento manual añadido", knowledge_upload: "Documento cargado", knowledge_toggle: "Estado de documento actualizado", knowledge_recover: "Recuperación de documento iniciada", globalLimits: "Límites globales guardados", budgetException: "Excepción presupuestaria registrada" };
