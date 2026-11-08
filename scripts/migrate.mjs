/**
 * Migraciones al ARRANQUE del contenedor (no en pre-deploy: el pre-deploy de
 * plataformas como Coolify corre en el contenedor viejo). Se bundlea con
 * esbuild dentro de la imagen y corre antes de `node server.js`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL no está definida");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? path.join(here, "drizzle");

const maxAttempts = 15;
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  // TimeZone UTC: invariante de tiempo del proyecto (ver src/lib/db/index.ts).
  const sql = postgres(url, {
    max: 1,
    onnotice: () => {},
    connection: { TimeZone: "UTC" },
  });
  try {
    // Esta imagen de recuperación solo admite el esquema posterior a 0041
    // antes de cargar datos demo. El código anterior no los aísla al leer.
    const [guard] = await sql`
      SELECT
        EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations
          WHERE hash = '9d1127cf7a34f27e67c3477c561c7b517b09aee564d19eb1c37d7a68c97dddc3'
            AND created_at = 1794036323218)
          AND NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at > 1794036323218)
          AND NOT EXISTS (SELECT 1 FROM public.demo_space)
          AND NOT EXISTS (SELECT 1 FROM public.demo_identity_route)
          AND NOT EXISTS (SELECT 1 FROM public.dispatch WHERE scope_kind <> 'commercial')
          AND NOT EXISTS (SELECT 1 FROM public.message WHERE scope_kind <> 'commercial')
        AS can_start
    `;
    if (guard?.can_start !== true) {
      throw new Error("La recuperación requiere 0041 y ausencia de datos demo");
    }
    await migrate(drizzle(sql), { migrationsFolder });
    console.log("[migrate] migraciones aplicadas");
    await sql.end();
    process.exit(0);
  } catch (err) {
    await sql.end().catch(() => {});
    if (attempt === maxAttempts) {
      console.error("[migrate] falló tras varios intentos:", err);
      process.exit(1);
    }
    console.log(
      `[migrate] BD no lista (intento ${attempt}/${maxAttempts}), reintento en 2s…`
    );
    await new Promise((r) => setTimeout(r, 2000));
  }
}
