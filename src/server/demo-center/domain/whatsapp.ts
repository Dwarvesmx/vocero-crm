/** Los alias se acreditan por campos explícitos del mismo evento firmado. */
export function telefonoWhatsApp(value: string | null | undefined) {
  const numero = value?.trim().replace(/^\+/, "");
  if (!numero || !/^[1-9]\d{6,14}$/.test(numero)) return null;
  return /^521\d{10}$/.test(numero) ? "52" + numero.slice(3) : numero;
}

export function codigoDemoWhatsApp(texto: string | null) {
  const textoLimpio = texto?.trim() ?? "";
  if (!/^MODONEXT-DEMO(?:\s|$)/i.test(textoLimpio)) return null;
  return /^MODONEXT-DEMO ([\w-]{32})$/.exec(textoLimpio)?.[1] ?? "";
}

/** El sello del proveedor puede tener resolución de segundos. */
export function posteriorAlCorte(sentAt: string, corte: Date, ahora: Date) {
  const enviado = Date.parse(sentAt);
  return Number.isFinite(enviado) && enviado >= Math.floor(+corte / 1000) * 1000 + 1000 && enviado <= +ahora;
}

export function enlaceWhatsApp(numero: string, codigo: string) {
  return `https://wa.me/${numero}?text=${encodeURIComponent("MODONEXT-DEMO " + codigo)}`;
}
