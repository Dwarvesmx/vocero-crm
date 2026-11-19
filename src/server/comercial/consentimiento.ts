function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function tieneObjecion(texto: string): boolean {
  return /\b(?:no|nunca|jamas|tampoco|desautorizo|pero|salvo|excepto|siempre\s+que|a\s+menos\s+que|con\s+tal\s+de|en\s+caso\s+de|correo|email|sms|telegram)\b/u.test(texto) ||
    /\bsi\s+(?!(?:quiero|avisame)\b)\w/u.test(texto);
}

const aprobacion = /\bcuando\s+(?:(?:(?:(?:mi|la|esta|esa|tu)\s+)?(?:nueva\s+)?(?:cotizacion|propuesta)\s+)?(?:este|sea|quede)\s+(?:aprobada|autorizada)|(?:se\s+)?(?:aprueb[ae]n?|autoric[ae]n?)(?:\s+(?:(?:mi|la|esta|esa|tu)\s+)?(?:nueva\s+)?(?:cotizacion|propuesta))?)/u;
const otraReferencia = /\b(?:otr[ao]|anterior|pasad[ao]|distint[ao]|vieja|v\s*\d+|version\s+\d+)\b|\bcotizacion\s+#?\d/u;

/** Identifica una única pregunta de permiso, compartida por lectura y escritura. */
export function preguntaDeAviso(texto: string): boolean {
  const preguntas = [...normalizar(texto).matchAll(/¿([^¿?]+)\?/gu)];
  if (preguntas.length !== 1 || (texto.match(/\?/gu)?.length ?? 0) !== 1) return false;
  const pregunta = preguntas[0]![1]!;
  return !tieneObjecion(pregunta) && !otraReferencia.test(pregunta) && !/\bo\b/u.test(pregunta) &&
    /\b(?:te\s+(?:aviso|avise|avisemos|notifique|notifiquemos)|avisarte|notificarte|recibir\s+(?:(?:el|un)\s+)?aviso)\b/u.test(pregunta) &&
    /\b(?:cotizacion|propuesta)\b/u.test(pregunta) && aprobacion.test(pregunta.replace(/\btu\s+/gu, 'la '));
}

export function respuestaAviso(texto: string): boolean {
  const normal = normalizar(texto);
  // Una consulta adicional explícita puede acompañar el permiso, sin cambiar su objeto.
  const frase = normal.split(/(?:[.!]\s+|\n|,?\s+pero\s+antes\s+)/u)[0]!.replace(/[.!]+$/u, '').trim();
  if (tieneObjecion(normal.replace(/\bpero\s+antes\b/u, '')) || otraReferencia.test(normal)) return false;
  if (/^(?:si(?:[,\s]+quiero)?|claro|va|porfa(?:vor)?|orale|esta\s+bien|de\s+acuerdo|me\s+avisas)$/u.test(frase)) {
    return frase === normal.replace(/[.!]+$/u, '').trim();
  }
  return /^(?:si[,\s]+)?(?:avisame|notificame)(?:\s+por\s+(?:este\s+)?whatsapp)?(?:\s+cuando\s+.+)?$/u.test(frase) &&
    (!frase.includes('cuando') || aprobacion.test(frase));
}

export function respuestaAvisoEnContexto(texto: string, pregunta: string): boolean {
  return preguntaDeAviso(pregunta) && respuestaAviso(texto);
}

/** Exige acción, canal y evento de aprobación declarados por el cliente. */
export function autorizacionAvisoCompleta(texto: string): boolean {
  const normal = normalizar(texto);
  if (tieneObjecion(normal.replace(/\bpero\s+antes\b/u, '')) || otraReferencia.test(normal)) return false;
  return normal.split(/[.!\n]+/u).some(oracion => {
    const frase = oracion.trim();
    if (frase.includes('?') || !aprobacion.test(frase)) return false;
    const partes = frase.match(/^(?:tambien\s+)?(?:si[,\s]+)?(?:(?:te\s+)?autorizo(?:\s+expresamente)?\s+(?:a\s+(?:avisarme|notificarme)|que\s+me\s+(?:avises|notifiques))|(?:avisame|notificame))(\s+por\s+(?:este\s+)?whatsapp)?\s+(cuando\s+.+)$/u);
    if (!partes) return false;
    const evento = partes[2]!;
    return Boolean(partes[1] || /\b(?:cotizacion|propuesta)\b/u.test(evento)) &&
      evento.match(aprobacion)?.[0] === evento;
  });
}
