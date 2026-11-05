# Plan de implementación y aceptación

Estado PLANEADO, 2026-11-04. ARQ-01 está cerrado documentalmente con aprobación conceptual; no autoriza Fase 1, despliegues, migraciones productivas ni mensajes. Fases entregan una arquitectura común, banderas por defecto apagadas, sin modificación de datos reales durante DEV.

## Fase 1 — fundamentos y administración

Crear migraciones aditivas de 02, contratos/versiones, gestión de espacios, perfiles inmutables, documentos y teléfonos, límites, rutas y auditoría. UI de activación configura pero no procesa WhatsApp; permisos, normalización e identidad vinculada. UI informa estado sin revelar datos innecesarios. Implementar almacenamiento y consultas KB separados, control de acceso y exclusión explícita de rutas comerciales. Aceptación: migración adelante/reversión ensayadas en PostgreSQL efímero, deduplicación SHA por ámbito, usuarios sin permisos rechazados, fixtures sin datos reales, contratos 1–4 y 12, límites de dependencias de módulo y pruebas de puertos con adaptadores falsos; no conectar webhook.

## Fase 2 — motor y aislamiento

Sesiones y selección transaccional, despachos versionados y snapshots, Nea aislado por sesión, contexto/KB, reservas de consumo y cancelación. Transporte y proveedor simulados, incluyendo procesos concurrentes y reinicios. Añadir metadatos de scope a pendientes y todos los efectos; deshabilitar herramientas/seguimientos inseguros. Aceptación: matriz 06 íntegra en infraestructura desechable, presupuestos y deduplicación probados con PostgreSQL real, reintentos con mismo payload y sin llamadas a proveedor real; retorno manual con cuarentena y resolución BSUID simulada; ninguna vía comercial lee demo y viceversa. La certificación de límite de gasto requiere precio/cotas reales documentados y una ruta única mediada; si no, bloquear demo facturable.

## Fase 3 — WhatsApp y publicación

Integrar el selector en recepción durable del webhook existente y autorización final de outbox; probar ecos salientes, mensajes duplicados, orden de llegada y transición entre ámbitos. Aceptación local: toda matriz, capacidades CRM/Nea negociadas, regresión comercial/handoff, fallos/reinicio y conciliación, con cuenta y transporte falsos. Ensayo posterior en entorno aislado y revisión de backups/restauración, compatibilidad de rollback, ACL y límite de no cancelación. Solo con autorizaciones separadas y concretas: despliegue coordinado CRM compatible → Nea compatible, banderas apagadas, revisión operativa y prueba WhatsApp real limitada a número/cuenta autorizados; habilitación posterior explícita. Mantener Zernio, Meta, allowlist y otros servicios intactos salvo autorización expresa.

## Definición de hecho

Tests automatizados reproducibles con dos PostgreSQL desechables, identidades sintéticas, HMAC de prueba, almacenamiento temporal y simuladores deterministas; sin credenciales, redes externas ni producción. Aserciones negativas y de concurrencia, revisión de todas las rutas de lectura/efectos, migración desde esquema realista de prueba y rollback seguro, análisis de costos inciertos, logs sin contenido sensible, documentos y registro actualizados. Sin prueba real, solo PROBADO en entorno aislado; nunca VERIFICADO EN PRODUCCIÓN. La restauración productiva sigue sin ensayo y recuperación documental inequívoca está pendiente según índice maestro.

## Compatibilidad modular y aplicación del arnés

Verificar automáticamente que `domain` no importe Next.js, Drizzle ni adaptadores, y que otros módulos solo utilicen la interfaz pública de Demo Center. Probar cada puerto con adaptador falso y real aislado, versiones incompatibles rechazadas y sobre comercial histórico sin cambios. El guion A/B del arnés se adapta a dos espacios bajo una organización y dos identidades sintéticas: probar tanto accesos legítimos como lecturas y escrituras cruzadas denegadas en API, webhook, UI, media, SSE y workers; ejecución con identificadores únicos, drenaje/limpieza y orden independiente. Fase 3 añade prueba con app viva local y proveedor simulado, caminos feliz y negativo. Gates de tipos, lint, build y pruebas reales del proyecto aplican cuando exista implementación; validación humana no realizada se marca pendiente. No se introduce host por espacio ni endpoint webhook nuevo.
