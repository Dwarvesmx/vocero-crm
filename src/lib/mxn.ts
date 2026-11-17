/** Conversión decimal exacta: no multiplica números de punto flotante. */
export function mxnACentavos(texto: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(texto.trim())) throw new Error('Introduce un importe MXN positivo con máximo dos decimales.');
  const [entero, decimal=''] = texto.trim().split('.');
  const valor=BigInt(entero!)*100n+BigInt(decimal.padEnd(2,'0'));
  if(valor>100000000n) throw new Error('Importe fuera del límite permitido.');
  return Number(valor);
}
export function centavosAMxn(n:number|null|undefined):string {
  if(n===null || n===undefined)return '';
  return `${Math.trunc(n/100)}.${String(n%100).padStart(2,'0')}`;
}
