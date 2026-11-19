function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function tieneObjecion(texto: string): boolean {
  return /\b(?:no|nunca|jamas|tampoco|desautorizo|pero|salvo|excepto|siempre\s+que|a\s+menos\s+que|con\s+tal\s+de|en\s+caso\s+de|correo|email|sms|telegram)\b/u.test(texto) ||
    /\bsi\s+(?!(?:quiero|avisame)\b)\w/u.test(texto);
}

const aprobacion = /\bcuando\s+(?:(?:(?:(?:mi|la|esta|esa|tu)\s+)?(?:nueva\s+)?(?:cotizacion|propuesta)\s+)?(?:este|sea|quede)\s+(?:aprobada|autorizada)|(?:se\s+)?(?:aprueb[ae]n?|autoric[ae]n?)(?:\s+(?:(?:mi|la|esta|esa|tu)\s+)?(?:nueva\s+)?(?:cotizacion|propuesta))?)/u;
const otraReferencia = /\b(?:otr[ao]|anterior|pasad[ao]|distint[ao]|vieja|v\s*\d+|version\s+\d+)\b|\b(?:cotizacion|propuesta)\s+#?(?:\d|[0-9a-f]{8}\b)/u;

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

/** Extrae una referencia ligada a la autorización. El servicio comprueba su alcance y unicidad. */
export function referenciaAvisoExplicita(texto: string): { id: string; version: number } | null {
  const normal = normalizar(texto);
  const referencia = /\b(cotizacion|propuesta)\s+#?([0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?)\s*,?\s+v(?:ersion)?\s*([1-9]\d{0,9})\b(?![.,]\d)/gu;
  const coincidencias = [...normal.matchAll(referencia)];
  if (coincidencias.length !== 1) return null;
  const [original, objeto, id, version] = coincidencias[0]!;
  // La referencia debe estar en la propia frase de autorización, junto al objeto aprobado.
  const antes = normal.slice(0, coincidencias[0]!.index);
  const inicio = Math.max(antes.lastIndexOf('.'), antes.lastIndexOf('!'), antes.lastIndexOf('\n')) + 1;
  const reducida = normal.replace(original!, objeto!);
  const frase = reducida.slice(inicio).split(/[.!\n]/u, 1)[0]!;
  if (!autorizacionAvisoCompleta(frase) || !autorizacionAvisoCompleta(reducida)) return null;
  return { id: id!, version: Number(version) };
}

/** Distingue una mención a la propuesta vigente de una autorización sin destinatario inequívoco. */
export function autorizacionAvisoNatural(texto: string): 'vigente' | 'sin_referencia' | null {
  const frase = normalizar(texto).replace(/[.!]+$/u, '').trim();
  if (tieneObjecion(frase) || otraReferencia.test(frase)) return null;
  const objeto = String.raw`(?:(?:mi|la|esta|esa)\s+)?(?:cotizacion|propuesta)(?:\s+(?<vigente>actual|vigente|que (?:acabamos de|me acabas de) (?:preparar|hacer|enviar)))?`;
  const evento = String.raw`cuando\s+(?:(?:se\s+)?(?:apruebe[n]?|autorice[n]?)(?:\s+${objeto})?|(?:la\s+)?aprueben|(?:este|sea|quede)\s+(?:aprobada|autorizada))`;
  const aviso = String.raw`(?:(?:por favor,?\s+)?(?:avisame|notificame|escribeme|mandame\s+(?:un\s+)?(?:mensaje|whatsapp))|(?:me\s+(?:avisas|notificas|escribes)|puedes\s+(?:avisarme|notificarme|escribirme))|(?:te\s+)?autorizo(?:\s+expresamente)?\s+(?:a\s+(?:avisarme|notificarme)|que\s+me\s+(?:avises|notifiques)))(?:\s+por\s+(?:este\s+)?whatsapp)?`;
  const coincidencia = frase.match(new RegExp(`^${aviso}\\s+${evento}(?:,?\\s+por favor)?$`, 'u')) ??
    frase.match(new RegExp(`^${evento},?\\s+${aviso}(?:,?\\s+por favor)?$`, 'u'));
  if (coincidencia) return coincidencia.groups?.vigente ? 'vigente' : 'sin_referencia';
  return autorizacionAvisoCompleta(texto) ? 'sin_referencia' : null;
}
