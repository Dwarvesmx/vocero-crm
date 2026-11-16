import { apiError } from "@/lib/api";
import { ComercialError } from "./contracts";
export function comercialError(error: unknown) {
  if (error instanceof ComercialError) return apiError(error.status,error.code,error.code.replaceAll("_"," "));
  // No registrar comandos, evidencia, URLs de cobro ni datos del prospecto.
  const name = error instanceof Error ? error.name : "Unknown";
  const code = typeof error === "object" && error !== null && "code" in error && /^[A-Z0-9]{5}$/.test(String(error.code)) ? String(error.code) : "";
  console.error("[comercial] fallo interno",name,code,error instanceof Error ? error.stack?.split("\n").slice(1,3).join("\n") : "");
  return apiError(500,"internal","Error interno");
}
