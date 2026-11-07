import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

// Laboratorio nuevo. No lee .env ni usa clústeres preexistentes.
const padre = resolve("../tmp");
mkdirSync(padre, { recursive: true });
const carpeta = mkdtempSync(join(padre, "demo-wa-pg-"));
const data = join(carpeta, "data");
const password = randomBytes(24).toString("hex");
const passfile = join(carpeta, "pg-init-pw");
const bin = process.env.DEMO_WA_PG_BIN ?? "C:/Program Files/PostgreSQL/16/bin";
const env = Object.fromEntries(["SystemRoot","WINDIR","PATH","Path","TEMP","TMP","COMSPEC","USERPROFILE","LOCALAPPDATA","APPDATA","ProgramFiles"]
  .filter(k => process.env[k]).map(k => [k, process.env[k]]));
const dsn = `postgres://demo_wa:${password}@127.0.0.1:55534/postgres`;

function ejecutar(exe, args, variables = env) {
  const result = spawnSync(exe, args, { env: variables, stdio: "inherit", windowsHide: true, timeout: 120000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`Comando de laboratorio falló (${result.status})`);
}
function pg(exe, args) { ejecutar(join(bin, exe + (process.platform === "win32" ? ".exe" : "")), args); }

writeFileSync(passfile, password + "\n", { mode: 0o600, flag: "wx" });
try {
  pg("initdb", ["-D", data, "-U", "demo_wa", "-A", "scram-sha-256", "--encoding=UTF8", "--pwfile", passfile]);
} finally { unlinkSync(passfile); }
pg("pg_ctl", ["start", "-w", "-D", data, "-o", "-h 127.0.0.1 -p 55534", "-l", join(carpeta, "postgres.log")]);
try {
  const client = postgres(dsn, { max: 1, onnotice() {}, connection: { TimeZone: "UTC" } });
  try {
    const [comprobacion] = await client`select current_setting('data_directory') as path`;
    const normalizar = path => path.replaceAll("\\", "/").toLowerCase();
    if (normalizar(comprobacion.path) !== normalizar(data)) throw Error("Destino de migración inesperado");
    await migrate(drizzle(client), { migrationsFolder: resolve("drizzle") });
  } finally { await client.end(); }
  ejecutar(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run",
    "tests/unit/demo-center-whatsapp-postgres.integration.test.ts"], { ...env, DATABASE_URL: dsn,
    APP_BASE_URL: "http://127.0.0.1:55534", BETTER_AUTH_SECRET: "synthetic-wa-only-secret",
    ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"), META_WEBHOOK_VERIFY_TOKEN: "synthetic-wa",
    DEMO_WA_TEST: "1", DEMO_WHATSAPP_ENABLED: "true", DEMO_WHATSAPP_NUMBER: "525500000099", ZERNIO_WHATSAPP_ENABLED: "true",
    DEMO_WA_PYTHON: process.env.DEMO_WA_PYTHON, BOT_API_KEY: "synthetic-wa-demo-service-key",
    DEMO_EXTERNAL_SESSIONS_ENABLED: "true", DEMO_EXTERNAL_GENERATION_ENABLED: "true", DEMO_EXTERNAL_DELIVERY_ENABLED: "true",
    DEMO_CONSUMER_ENABLED: "true", DEMO_DELIVERY_ENABLED: "true" });
} finally {
  pg("pg_ctl", ["stop", "-w", "-D", data, "-m", "fast"]);
}
