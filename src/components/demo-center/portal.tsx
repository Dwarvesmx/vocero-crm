"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

type Demo = {
  name: string;
  assistant: string;
  greeting: string;
  state: string;
  deadline: string;
  operation?: string;
  whatsapp?: { state: string; expiresAt?: string };
  turns: { id: string; question: string; answer: string }[];
};
const estados: Record<string, string> = {
  active: "Disponible", expired: "Caducó", revoked: "Acceso revocado", closed: "Finalizada", suspended: "Suspendida",
};
const errores: Record<string, string> = {
  not_found: "El enlace es inválido o la demo ya no está disponible.",
  budget_exceeded: "La demo alcanzó su presupuesto. Contacta a ModoNext para continuar.",
  quota_exceeded: "La demo alcanzó su límite de mensajes.",
  operation_pending: "Hay una respuesta en revisión. Puedes consultar el estado sin reenviar.",
  session_unavailable: "La sesión terminó o ya no está disponible. Consulta el estado.",
  invalid_phone: "Escribe el número con código de país, sin espacios.",
  already_linked: "Esta invitación ya se vinculó con WhatsApp.",
  whatsapp_unavailable: "WhatsApp no está disponible para esta demo.",
};
const boton = "rounded-xl bg-teal-800 px-4 py-2.5 font-semibold text-white hover:bg-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:opacity-50";
const secundario = "rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50";

async function api<T = Demo>(token: string, body?: object): Promise<T> {
  const res = await fetch("/api/demo/web", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    credentials: "omit",
    headers: { Authorization: `Bearer ${token}`, ...(body && { "Content-Type": "application/json" }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(errores[data.error] ?? "La demo no pudo completar la solicitud. Consulta su estado o vuelve a intentar.");
  return data;
}

function leerCodigos(value: string) {
  const fragmento = value.includes("#") ? value.slice(value.indexOf("#") + 1) : value;
  const codigos = fragmento.includes("=") ? new URLSearchParams(fragmento).getAll("acceso") : [fragmento.trim()];
  return [...new Set(codigos.filter(token => /^[\w-]{43}$/.test(token)))].slice(0, 6);
}

export function PortalDemo({ contacto }: { contacto: string | null }) {
  const [demos, setDemos] = useState<{ token: string; data: Demo }[]>([]);
  const [seleccion, setSeleccion] = useState("");
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const iniciales = useRef<string[] | undefined>(undefined);

  useEffect(() => {
    if (!iniciales.current && window.location.hash) {
      iniciales.current = leerCodigos(window.location.hash);
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
    const tokens = iniciales.current;
    if (!tokens) return;
    let cancelado = false;
    setCargando(true);
    Promise.allSettled(tokens.map(async token => ({ token, data: await api(token) }))).then(resultados => {
      if (cancelado) return;
      setDemos(actual => {
        const nuevos = resultados.flatMap(r => r.status === "fulfilled" ? [r.value] : []);
        return [...actual.filter(a => !nuevos.some(n => n.token === a.token)), ...nuevos];
      });
      if (!tokens.length || resultados.some(r => r.status === "rejected")) setError("Alguna invitación no está disponible.");
      setCargando(false);
    });
    return () => { cancelado = true; };
  }, []);

  async function agregar(e: FormEvent) {
    e.preventDefault();
    const tokens = leerCodigos(codigo);
    if (!tokens.length) { setError("Pega el enlace de invitación completo."); return; }
    setCargando(true);
    setError("");
    try {
      const resultados = await Promise.allSettled(tokens.map(async token => ({ token, data: await api(token) })));
      const nuevos = resultados.flatMap(r => r.status === "fulfilled" ? [r.value] : []);
      setDemos(actual => [...actual.filter(d => !nuevos.some(n => n.token === d.token)), ...nuevos]);
      if (resultados.some(r => r.status === "rejected")) setError("Alguna invitación no está disponible.");
      setCodigo("");
    } catch (e) { setError((e as Error).message); }
    finally { setCargando(false); }
  }

  const activa = demos.find(d => d.token === seleccion);
  return <main className="min-h-screen bg-[#f3f5ee] px-4 py-6 text-slate-900 sm:px-8 sm:py-10">
    <div className="mx-auto max-w-5xl">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 pb-5">
        <span className="font-bold tracking-wide">ModoNext <span className="ml-2 font-normal text-slate-600">/ Vocero</span></span>
        {contacto && <a className="font-semibold text-teal-900 underline underline-offset-4" href={contacto} rel="noreferrer">Hablar con ModoNext</a>}
      </header>
      <section className="rounded-3xl bg-[#163632] p-6 text-white sm:p-10">
        <p className="text-sm font-bold uppercase tracking-widest text-teal-100">Demo Center</p>
        <h1 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">Prueba Vocero en acción</h1>
        <p className="mt-4 max-w-xl text-teal-50">ModoNext combina CRM, atención por WhatsApp y automatización con IA. En esta demo web puedes conversar con un asistente de un negocio de ejemplo y probar cómo mantiene el contexto de tus preguntas.</p>
      </section>
      <section className="mt-7" aria-labelledby="disponibles">
        <h2 id="disponibles" className="text-xl font-bold">Tus demostraciones</h2>
        {error && <p role="alert" className="mt-2 text-red-800">{error}</p>}
        {cargando && <p role="status" className="mt-2">Comprobando acceso…</p>}
        {demos.length > 0 && <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {demos.map(({ token, data }) => <li key={token}>
            <button type="button" aria-pressed={seleccion === token}
              className="w-full rounded-2xl border border-slate-300 bg-white p-4 text-left hover:border-teal-800 aria-pressed:border-2 aria-pressed:border-teal-800"
              onClick={() => {
                setSeleccion(token);
                void api(token).then(nueva => setDemos(actual => actual.map(d => d.token === token ? { ...d, data: nueva } : d)))
                  .catch(e => setError(e.message));
              }}>
              <span className="block text-lg font-semibold">{data.name}</span>
              <span className="block text-sm text-slate-600">{data.assistant} · {estados[data.state] ?? data.state}</span>
            </button>
          </li>)}
        </ul>}
        {!activa && <form onSubmit={agregar} className="mt-4 max-w-xl">
          <label htmlFor="invitacion" className="block text-sm font-semibold">{demos.length ? "Agregar otra invitación" : "¿Tienes una invitación?"}</label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input id="invitacion" value={codigo} onChange={e => setCodigo(e.target.value)} autoComplete="off"
              placeholder="Pega tu enlace de acceso" maxLength={2048} className="min-w-0 flex-1 rounded-xl border border-slate-400 bg-white px-3 py-2" required />
            <button className={boton} disabled={cargando}>Ver demo</button>
          </div>
          <p className="mt-2 text-sm text-slate-600">Comparte la invitación solo con su destinatario. Usa datos ficticios al conversar.</p>
        </form>}
      </section>
      {demos.map(d => <div key={d.token} hidden={d.token !== seleccion}>
        <Conversacion token={d.token} data={d.data} contacto={contacto}
          actualizar={data => setDemos(actual => actual.map(otra => otra.token === d.token ? { ...otra, data } : otra))}
          volver={() => setSeleccion("")} />
      </div>)}
    </div>
  </main>;
}

function Conversacion({ token, data, contacto, actualizar, volver }: {
  token: string; data: Demo; contacto: string | null; actualizar: (data: Demo) => void; volver: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [peticion, setPeticion] = useState<{ text: string; requestKey: string }>();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const pendiente = data.operation === "uncertain" || data.operation === "reserved";
  async function ejecutar(accion: "send" | "close" | "read") {
    setOcupado(true);
    setError("");
    try {
      if (accion === "send") {
        const pregunta = texto.trim();
        if (!pregunta) return;
        const intento = peticion?.text === pregunta ? peticion : { text: pregunta, requestKey: crypto.randomUUID() };
        setPeticion(intento);
        const respuesta = await api(token, { action: "send", ...intento });
        actualizar(respuesta);
        if (respuesta.operation === "settled") { setTexto(""); setPeticion(undefined); }
        if (respuesta.operation === "released") {
          setPeticion(undefined);
          setError("El turno se canceló antes de consultar a la IA. Puedes volver a intentar.");
        }
      } else {
        actualizar(await api(token, accion === "close" ? { action: "close" } : undefined));
      }
    } catch (e) { setError((e as Error).message); }
    finally { setOcupado(false); }
  }
  return <section aria-labelledby={id + "-titulo"} className="mt-6 rounded-3xl border border-slate-300 bg-white p-4 sm:p-7">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id={id + "-titulo"} className="text-xl font-bold">{data.assistant} · {data.name}</h2>
        <p className="mt-1 text-sm text-slate-600">{estados[data.state] ?? data.state}{data.state === "active" && <> · Acceso hasta <time dateTime={data.deadline}>{new Date(data.deadline).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></>}</p>
      </div>
      <button type="button" className={secundario} onClick={volver} disabled={ocupado}>Volver a demos</button>
    </div>
    {data.whatsapp && <CanalWhatsApp token={token} status={data.whatsapp} webActiva={data.state === "active"}
      actualizar={actualizar} contacto={contacto} />}
    {data.state === "active" && <>
      <div aria-live="polite" className="mt-4 space-y-3">
        {data.greeting && <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-100 p-3">{data.greeting}</p>}
        {data.turns.map(t => <div key={t.id} className="space-y-2">
          <p className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-xl bg-teal-100 p-3"><strong>Tú: </strong>{t.question}</p>
          <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-100 p-3"><strong>{data.assistant}: </strong>{t.answer}</p>
        </div>)}
      </div>
      {pendiente && <p role="status" className="mt-4">La respuesta está pendiente de confirmación. Consulta el estado en unos instantes.</p>}
      <form onSubmit={e => { e.preventDefault(); void ejecutar("send"); }} className="mt-5">
        <label htmlFor={id + "-mensaje"} className="mb-1 block text-sm font-semibold">Tu mensaje</label>
        <textarea id={id + "-mensaje"} value={texto} onChange={e => setTexto(e.target.value)}
          disabled={ocupado || pendiente} maxLength={2000} rows={3} required
          className="w-full resize-y rounded-xl border border-slate-400 p-3" />
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={boton} disabled={ocupado || pendiente || !texto.trim()}>Enviar</button>
          <button type="button" className={secundario} disabled={ocupado} onClick={() => void ejecutar("read")}>Consultar estado</button>
          <button type="button" className={secundario} disabled={ocupado} onClick={() => { if (window.confirm("¿Finalizar esta demostración?")) void ejecutar("close"); }}>Finalizar demo</button>
        </div>
      </form>
    </>}
    {ocupado && <p role="status" className="mt-3">Procesando…</p>}
    {error && <p role="alert" className="mt-3 text-red-800">{error}</p>}
    {data.state !== "active" && <div className="mt-4 space-y-2">
      <p>Si quieres conocer cómo se configuraría Vocero para tu negocio, contacta a ModoNext.</p>
      {contacto && <a className="inline-block rounded-xl bg-teal-800 px-4 py-2.5 font-semibold text-white" href={contacto} rel="noreferrer">Solicitar información</a>}
    </div>}
  </section>;
}

function CanalWhatsApp({ token, status, webActiva, actualizar, contacto }: {
  token: string; status: NonNullable<Demo["whatsapp"]>; webActiva: boolean;
  actualizar: (data: Demo) => void; contacto: string | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const [telefono, setTelefono] = useState("");
  const [enlace, setEnlace] = useState<{ url: string; expiresAt: string }>();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const vinculado = status.state === "linked";
  const estadosWhatsApp: Record<string, string> = {
    available: "Disponible", pending: "Esperando el mensaje de vinculación", linked: "Sesión vinculada",
    closed: "Demostración finalizada", expired: "Acceso vencido", revoked: "Acceso revocado",
    superseded: "Reemplazada por otra demostración", suspended: "Canal suspendido",
  };
  async function operar(accion: "start" | "refresh" | "finish") {
    setOcupado(true);
    setError("");
    try {
      if (accion === "start") {
        setEnlace(await api<{ url: string; expiresAt: string }>(token, { action: "startWhatsApp", phone: telefono }));
        setTelefono("");
      }
      actualizar(await api(token, accion === "finish" ? { action: "finishWhatsApp" } : undefined));
      if (accion === "finish") setEnlace(undefined);
    } catch (e) { setError((e as Error).message); }
    finally { setOcupado(false); }
  }
  return <section className="mt-4 space-y-2 rounded-xl border border-teal-200 bg-teal-50 p-4 text-teal-950" aria-labelledby={id + "-canal"}>
    <h3 className="font-semibold" id={id + "-canal"}>WhatsApp · demostración de IA</h3>
    <p role="status">{estadosWhatsApp[status.state] ?? "No disponible"}</p>
    {status.expiresAt && <p className="text-sm">Vence <time dateTime={status.expiresAt}>{new Date(status.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></p>}
    {webActiva && ["available", "pending", "expired"].includes(status.state) && <>
      <button type="button" className={secundario} aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>Probar por WhatsApp</button>
      {abierto && <form className="space-y-2" onSubmit={e => { e.preventDefault(); void operar("start"); }}>
        <label htmlFor={id + "-tel"} className="block text-sm">Tu número de WhatsApp con código de país</label>
        <input id={id + "-tel"} type="tel" autoComplete="tel" value={telefono} onChange={e => setTelefono(e.target.value)}
          maxLength={16} minLength={7} required className="w-full rounded-xl border border-slate-400 bg-white px-3 py-2 sm:w-auto" />
        <button className={boton + " ml-0 sm:ml-2"} disabled={ocupado}>Preparar acceso</button>
      </form>}
    </>}
    {enlace && status.state === "pending" && <p><a className="font-bold underline" href={enlace.url} target="_blank" rel="noreferrer">Abrir WhatsApp</a>
      {" y enviar el código desde el número indicado. Luego vuelve aquí y consulta el estado."}</p>}
    {vinculado && <p>Ya puedes enviar una pregunta desde el mismo chat de WhatsApp. Estás probando un asistente de demostración.</p>}
    <div className="flex flex-wrap gap-2">
      {(status.state === "pending" || vinculado) && <button type="button" className={secundario} disabled={ocupado}
        onClick={() => void operar("refresh")}>Consultar vinculación</button>}
      {vinculado && <button type="button" className={secundario} disabled={ocupado}
        onClick={() => { if (window.confirm("¿Finalizar la demostración en WhatsApp?")) void operar("finish"); }}>Finalizar WhatsApp</button>}
      {contacto && ["closed", "expired", "revoked"].includes(status.state) && <a className="self-center underline" href={contacto}>Contactar a ModoNext</a>}
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
