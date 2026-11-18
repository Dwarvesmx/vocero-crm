/** Interpreta el texto sin sustituir las guardas de identidad, versión y pregunta. */
export function respuestaAviso(texto:string){
  const textoLimpio=texto.trim();
  if(/\b(?:no\s+(?:me\s+)?(?:avises|escribas|mandes|env[ií]es)|solo si|s[oó]lo si|siempre que|[uú]nicamente si)\b/iu.test(textoLimpio))return false;
  const primera=textoLimpio.split(/(?:[.!?]\s+|\n|,?\s+pero\s+)/iu)[0]!.trim().replace(/[.!?]+$/u,'');
  if(/^me avisas[.!?\s]*$/iu.test(textoLimpio))return true;
  return /^s[ií](?:[,\s]+av[ií]same(?:\s+por\s+(?:este\s+)?whatsapp)?(?:\s+cuando\s+(?:(?:mi |la |esta )?cotizaci[oó]n\s+est[eé]\s+(?:autorizada|aprobada)|se\s+(?:apruebe|autorice)(?:\s+(?:esta |mi |la )?cotizaci[oó]n)?))?)?$/iu.test(primera);
}

/** Una autorización que nombra expresamente el aviso de esta cotización no
 * necesita que el cliente repita literalmente nuestra pregunta. */
export function autorizacionAvisoCompleta(texto:string){
  const primera=texto.trim().split(/(?:[.!?]\s+|\n|,?\s+pero\s+)/iu)[0]!;
  const normal=texto.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(!/desautorizo|no (?:te )?autorizo|no (?:me )?(?:avises|escribas|envies)|solo si|siempre que/.test(normal) && /\b(?:tambien )?autorizo que me avises por (?:este )?whatsapp cuando (?:esta|este) (?:aprobada|autorizada)/.test(normal))return true;
  return respuestaAviso(texto) && /av[ií]same/iu.test(primera) && /cuando/iu.test(primera) && /cotizaci[oó]n/iu.test(primera);
}
