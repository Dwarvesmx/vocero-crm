/** Interpreta el texto sin sustituir las guardas de identidad, versión y pregunta. */
export function respuestaAviso(texto:string){
  const textoLimpio=texto.trim();
  if(/\b(?:no\s+(?:me\s+)?(?:avises|escribas|mandes|env[ií]es)|solo si|s[oó]lo si|siempre que|[uú]nicamente si)\b/iu.test(textoLimpio))return false;
  const primera=textoLimpio.split(/(?:[.!?]\s+|\n|,?\s+pero\s+)/iu)[0]!.trim().replace(/[.!?]+$/u,'');
  if(/^me avisas[.!?\s]*$/iu.test(textoLimpio))return true;
  return /^s[ií](?:[,\s]+av[ií]same(?:\s+por\s+(?:este\s+)?whatsapp)?(?:\s+cuando\s+(?:(?:mi |la |esta )?cotizaci[oó]n\s+est[eé]\s+(?:autorizada|aprobada)|se\s+(?:apruebe|autorice)(?:\s+(?:esta |mi |la )?cotizaci[oó]n)?))?)?$/iu.test(primera);
}

/** Esta confirmación breve solo vale después de una pregunta explícita de aviso. */
export function respuestaAvisoEnContexto(texto: string, pregunta: string): boolean {
  if (!/^s[ií][,\s]+quiero[.!\s]*$/iu.test(texto.trim())) return respuestaAviso(texto);
  const preguntas = [...pregunta.matchAll(/¿([^¿?]+)\?/gu)];
  if (preguntas.length !== 1 || (pregunta.match(/\?/gu)?.length ?? 0) !== 1) return false;
  const frase = preguntas[0]![1]!;
  return /(?:\bte (?:avis(?:e|emos|o|amos)|notifique(?:mos)?|notifico)\b|\b(?:avisarte|notificarte|recibir (?:el |un )?aviso)\b)/iu.test(frase) &&
    /(?:cotizaci[oó]n|propuesta)/iu.test(frase) && /(?:autoriza|aprob|aprueb)/iu.test(frase);
}

/** Una autorización que nombra expresamente el aviso de esta cotización no
 * necesita que el cliente repita literalmente nuestra pregunta. */
export function autorizacionAvisoCompleta(texto:string){
  const primera=texto.trim().split(/(?:[.!?]\s+|\n|,?\s+pero\s+)/iu)[0]!;
  const normal=texto.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  // El permiso puede seguir a la solicitud de cotización en otra oración.
  const permisoInicial = /(?:^|[.!\n])\s*(?:tambien\s+)?te\s+autorizo\s+expresamente\s+a\s+avisarme\s+por\s+este\s+whatsapp\s+cuando\s+la\s+cotizacion\s+este\s+aprobada\s*(?:\.|!|$)/u;
  const negacionOCondicion = /\b(?:desautorizo|no\s+(?:(?:te\s+)?autorizo|(?:me\s+)?(?:avises|escribas|envies)|(?:quiero|deseo)\s+que\s+me\s+avises)|solo\s+si|unicamente\s+si|siempre\s+que)\b/u;
  if (permisoInicial.test(normal) && !negacionOCondicion.test(normal)) return true;
  if(!/desautorizo|no (?:te )?autorizo|no (?:me )?(?:avises|escribas|envies)|solo si|siempre que/.test(normal) && /\b(?:tambien )?autorizo que me avises por (?:este )?whatsapp cuando (?:esta|este) (?:aprobada|autorizada)/.test(normal))return true;
  return respuestaAviso(texto) && /av[ií]same/iu.test(primera) && /cuando/iu.test(primera) && /cotizaci[oó]n/iu.test(primera);
}
