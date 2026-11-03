"use client";
import { useEffect, useState } from "react";
import { WhatsappWizard } from "./whatsapp-wizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
type Config = { available: boolean; connection: { accountRef: string; tokenLast4: string; enabled: boolean; webhookPending?: boolean } | null; webhookUrl: string };
const api = "/api/settings/whatsapp/zernio";
export function WhatsappProvider() {
  const [provider, setProvider] = useState("meta");
  const [config, setConfig] = useState<Config | null>(null);
  const [token, setToken] = useState(""); const [account, setAccount] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const [error, setError] = useState(""); const [webhook, setWebhook] = useState<string>("Sin comprobar");
  async function load() {
    const r = await fetch(api, { cache: "no-store" }); const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message ?? "No se pudo leer la configuración");
    setConfig(d); setAccount(d.connection?.accountRef ?? ""); return d as Config;
  }
  useEffect(() => { void load().then(d => setProvider(d.connection?.enabled ? "zernio" : "meta")).catch(e => setError(e.message)); }, []);
  async function run(method: string, body: object, action: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch(api, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message ?? "No se pudo completar la operación");
      if (action === "accounts") { setAccounts(d.accounts); setNotice(d.accounts.length ? "Elige la cuenta ModoNext. No se seleccionó ninguna automáticamente." : "No hay cuentas WhatsApp activas identificadas como ModoNext. Revisa su nombre en Zernio."); }
      else if (action === "test") { setWebhook(d.webhook ? `${d.webhook.active ? "Activo" : "Inactivo"} · ${d.webhook.id} · ${(d.webhook.events ?? []).join(", ")} · fallos: ${d.webhook.failureCount}` : "No registrado"); setNotice("Conexión comprobada mediante lectura. No se enviaron mensajes."); }
      else { setNotice(action === "save" ? "Credenciales guardadas y canal desactivado. El webhook no se registró." : action === "webhook" ? "Webhook registrado o actualizado para la cuenta confirmada." : "Proveedor actualizado. Lukas no se ha activado."); setToken(""); await load(); }
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo completar la operación"); }
    finally { setBusy(false); }
  }
  const same = !!account && confirmation === account;
  return <div className="space-y-6 max-w-4xl">
    <Card><CardHeader><CardTitle>Proveedor de WhatsApp</CardTitle><CardDescription>Elige cómo gestionar WhatsApp. Cambiar esta vista no cambia la conexión activa.</CardDescription></CardHeader>
    <CardContent className="space-y-3"><Label htmlFor="wa-provider">Proveedor</Label><select id="wa-provider" className="w-full rounded-md border bg-background p-2" value={provider} onChange={e => setProvider(e.target.value)}><option value="meta">Meta Cloud API</option><option value="zernio">Zernio API</option></select>
    <p className="text-sm text-muted-foreground">Proveedor activo: {config?.connection?.enabled ? "Zernio API" : "Meta Cloud API (si está configurado)"}. Lukas conserva su interruptor independiente.</p>
    {provider === "meta" && config?.connection?.enabled && <Button disabled={busy} onClick={() => void run("PATCH", { enabled: false }, "provider")}>Desactivar Zernio y usar Meta existente</Button>}
    </CardContent></Card>
    {error && <p role="alert" className="rounded-md border border-destructive p-3 text-destructive">{error}</p>}
    {notice && <p role="status" className="rounded-md border p-3">{notice}</p>}
    {provider === "meta" ? <WhatsappWizard /> : <>
    <Card><CardHeader><CardTitle>Zernio API · ModoNext</CardTitle><CardDescription>Solo el propietario puede guardar la conexión. No se muestran ni admiten cuentas de otros negocios. Guardar no activa el canal.</CardDescription></CardHeader><CardContent className="space-y-4">
    <p>Estado: {config?.connection ? config.connection.enabled ? "Canal activo" : "Configurado · canal desactivado" : "Sin configurar"}</p>
    <div className="space-y-2"><Label htmlFor="zernio-key">API key de Zernio</Label><Input id="zernio-key" type="password" autoComplete="new-password" value={token} onChange={e => { setToken(e.target.value); setAccounts([]); }} placeholder={config?.connection ? `Guardada · termina en ${config.connection.tokenLast4}. Déjala vacía para conservarla` : "Introduce la API key"} /></div>
    <Button variant="outline" disabled={busy || (!token && !config?.connection)} onClick={() => void run("POST", { action: "accounts", ...(token ? { token } : {}) }, "accounts")}>Consultar cuentas verificadas</Button>
    <div className="space-y-2"><Label htmlFor="zernio-account">Cuenta WhatsApp autorizada</Label><select id="zernio-account" className="w-full rounded-md border bg-background p-2" value={account} onChange={e => { setAccount(e.target.value); setConfirmation(""); }}><option value="">Selecciona explícitamente ModoNext</option>{config?.connection && !accounts.some(a => a.id === config.connection!.accountRef) && <option value={config.connection.accountRef}>Guardada: {config.connection.accountRef}</option>}{accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.id}</option>)}</select></div>
    <div className="space-y-2"><Label htmlFor="zernio-confirm">Confirma copiando el accountId completo de ModoNext</Label><Input id="zernio-confirm" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" /></div>
    <div className="flex flex-wrap gap-2"><Button disabled={busy || !same || (!token && !config?.connection)} onClick={() => void run("PUT", { ...(token ? { token } : {}), accountRef: account, confirmation }, "save")}>Guardar sin activar</Button>
    <Button variant="outline" disabled={busy || !config?.connection} onClick={() => void run("POST", { action: "test" }, "test")}>Probar conexión sin enviar mensajes</Button></div>
    <p className="text-sm text-muted-foreground">La API key y el secreto de firma se cifran en el servidor. No se recuperan completos en esta pantalla.</p>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Webhook de Zernio</CardTitle><CardDescription>El registro es una operación independiente: solo ejecútala cuando autorices conectar la cuenta.</CardDescription></CardHeader><CardContent className="space-y-4"><p className="break-all text-sm">URL: {config?.webhookUrl ?? "Cargando"}</p><p className="text-sm">Eventos: message.received y message.sent. Firma HMAC-SHA256 obligatoria con secreto generado y cifrado en el servidor.</p><p className="break-all text-sm">Estado: {webhook}</p>{config?.connection?.webhookPending && <p role="alert">Registro anterior sin confirmar. Prueba la conexión para conciliarlo antes de repetir; no se creará otro webhook a ciegas.</p>}
    <Button variant="outline" disabled={busy || !config?.connection || !same} onClick={() => { if (window.confirm("¿Registrar el webhook real exclusivamente para la cuenta ModoNext confirmada? Esta operación habilita entregas desde Zernio.")) void run("POST", { action: "webhook", confirmation }, "webhook"); }}>Registrar o actualizar webhook</Button>
    <p className="text-sm text-muted-foreground">Se reutiliza el webhook propio y nunca se modifica otro. Tras un timeout, comprueba el estado antes de repetir.</p>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Activación y desconexión</CardTitle></CardHeader><CardContent className="space-y-3"><p>Activa el canal solo después de comprobar la cuenta y el webhook. Desconectar aquí desactiva Vocero; conserva las credenciales y no desvincula WhatsApp Business de Zernio ni cambia Meta. Una solicitud externa ya iniciada no se puede cancelar; comprueba los envíos pendientes antes de cambiar de proveedor.</p>
    <div className="flex flex-wrap gap-2"><Button disabled={busy || !same || !config?.connection || config.connection.enabled || !config.available} onClick={() => { if (window.confirm("¿Activar Zernio para WhatsApp de ModoNext? Lukas permanecerá apagado.")) void run("PATCH", { enabled: true, confirmation }, "provider"); }}>Activar canal Zernio</Button><Button variant="outline" disabled={busy || !config?.connection?.enabled} onClick={() => void run("PATCH", { enabled: false }, "provider")}>Desconectar de Vocero</Button></div>
    {config && !config.available && <p className="text-sm">El canal está deshabilitado por configuración de esta instalación.</p>}
    </CardContent></Card></>}
  </div>;
}
