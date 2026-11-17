/** Interpreta el texto sin sustituir las guardas de identidad, versión y pregunta. */
export function respuestaAviso(texto:string){
  const textoLimpio=texto.trim();
  if(/\b(?:no\s+(?:me\s+)?(?:avises|escribas|mandes|env[ií]es)|solo si|s[oó]lo si|siempre que|[uú]nicamente si)\b/iu.test(textoLimpio))return false;
  const primera=textoLimpio.split(/(?:[.!?]\s+|\n|,?\s+pero\s+)/iu)[0]!.trim().replace(/[.!?]+$/u,'');
  return /^s[ií](?:[,\s]+av[ií]same(?:\s+por\s+(?:este\s+)?whatsapp)?(?:\s+cuando\s+(?:(?:mi |la |esta )?cotizaci[oó]n\s+est[eé]\s+(?:autorizada|aprobada)|se\s+(?:apruebe|autorice)(?:\s+(?:esta |mi |la )?cotizaci[oó]n)?))?)?$/iu.test(primera);
}

/** Una autorización que nombra expresamente el aviso de esta cotización no
 * necesita que el cliente repita literalmente nuestra pregunta. */
export function autorizacionAvisoCompleta(texto:string){
  const primera=texto.trim().split(/(?:[.!?]\s+|\n|,?\s+pero\s+)/iu)[0]!;
  return respuestaAviso(texto) && /av[ií]same/iu.test(primera) && /cuando/iu.test(primera) && /cotizaci[oó]n/iu.test(primera);
}
