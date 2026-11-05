export function usdToMicro(value: string): string {
  const match = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new Error("Introduce USD con hasta seis decimales.");
  return (BigInt(match[1]!) * 1000000n + BigInt((match[2] ?? "").padEnd(6, "0"))).toString();
}
export function microToUsd(value: string | null | undefined): string {
  if (value == null) return "";
  const n = BigInt(value);
  return (n / 1000000n).toString() + "." + (n % 1000000n).toString().padStart(6, "0");
}
export function localInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 19);
}
