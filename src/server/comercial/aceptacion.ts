/** La selección de una herramienta no sustituye la intención del mensaje. */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function interpretarAceptacion(texto: string, alcances: string[]): "explicita" | "breve" | null {
  const mensaje = normalizar(texto);
  if (/^(?:si(?:[,\s]+acepto)?|acepto|de acuerdo|claro|va|esta bien)[.!]*$/u.test(mensaje)) return "breve";
  // Se admite lenguaje natural siempre que se exprese una decisión y su objeto.
  if (/[?¿]/u.test(mensaje) || /\b(?:no|nunca|pero|siempre que|solo si|si me|si el|si la|si se|si puedes|a menos|aviso|avises|avisarme|notifiques|notificarme|autorizo|diferente|otra|anterior)\b/u.test(mensaje)) return null;
  const frase = mensaje.replace(/^si[,\s]+/u, "").replace(/[.!]+$/u, "")
    .replace(/\s+y\s+quiero\s+contratarla$/u, "");
  // Mantener condiciones nuevas fuera de la aceptación. El precio y el alcance
  // ya están fijados por la versión que el servidor valida.
  if (/\b(?:si|con tal|salvo|excepto|cuando|descuento|pesos|mxn|mensual|y|o)\b|[$\d]/u.test(frase)) return null;
  const aceptacion = frase.match(/^(?:acepto(?: expresamente| explicitamente)?|confirmo que acepto|estoy de acuerdo con|quiero contratar|confirmo la contratacion de)\s+(?:la|esta|mi)\s+(?:cotizacion|propuesta)(?:\s+aprobada)?(?:\s+de\s+(?:(?:mi|la|el)\s+)?([\p{L}\s]+))?$/u);
  if (!aceptacion) return null;
  const alcance = aceptacion[1]?.trim();
  if (alcance && !alcances.some(s => (" " + normalizar(s).replace(/[^\p{L}\d]+/gu, " ") + " ").includes(" " + alcance + " "))) return null;
  return "explicita";
}
