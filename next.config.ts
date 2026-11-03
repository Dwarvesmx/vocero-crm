import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// La versión sale de package.json y no de una constante aparte: duplicarla es
// tenerla desactualizada en uno de los dos lados, y justo esta no puede mentir.
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

const nextConfig: NextConfig = {
  // standalone es para la imagen Docker (Linux). En Windows el trazado crea
  // symlinks que requieren permisos elevados, así que ahí se omite.
  output: process.platform === "win32" ? undefined : "standalone",
  // El paquete `postgres` usa APIs de Node que no deben empaquetarse en el bundle.
  serverExternalPackages: ["postgres", "pdf-parse", "mammoth"],
  // PDF.js carga worker y canvas/nativos dinámicamente: NFT no los detectó
  // en la prueba real de la imagen Alpine. Incluir solo esa dependencia y
  // su cierre instalado por pnpm, conservando la resolución de sus enlaces.
  outputFileTracingIncludes: {
    "/api/kb/documents{,/**}": [
      "./node_modules/.pnpm/pdf-parse@*/node_modules/**/*",
      "./node_modules/.pnpm/pdfjs-dist@*/node_modules/**/*",
      "./node_modules/.pnpm/@napi-rs+canvas*@*/node_modules/**/*",
    ],
  },
  // 061 — El indicador de Next en modo dev caía encima de la cuenta del riel
  // (abajo a la izquierda) y tapaba el clic. Solo existe en dev; los errores
  // de compilación se siguen mostrando en su panel.
  devIndicators: false,
  // Se congelan al construir: lo que queda aquí va dentro del binario y no
  // cambia en tiempo de ejecución. El commit solo se congela si `SOURCE_COMMIT`
  // llega AL BUILD (build arg `SOURCE_COMMIT`; con docker compose,
  // `--build-arg`). Si no llega, esto queda vacío y el servidor cae al
  // `SOURCE_COMMIT` del entorno al arrancar, marcado como NO verificado
  // (`src/lib/version.ts`, #50): puede no ser el del código que corre.
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_BUILD_COMMIT: process.env.SOURCE_COMMIT ?? "",
  },
};

export default nextConfig;
