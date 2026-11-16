# Comercial V1 · especificación previa · 2026-11-16

Carril completo: persistencia incremental, contrato bot nuevo y panel autenticado.
Base aislada: f66a58965963748cbe2575043dd4ffb85e64bbd4, confirmada por health público y Coolify Read.

## Comportamiento y aceptación

Catálogo por organización editable solo por owner/admin. Semilla V3 idempotente sin costos ni márgenes. Precios en centavos MXN, importes orientativos/pendientes nunca autorizan venta automática. Extras compatibles calculados en servidor. Cada cotización conserva snapshot y versiones inmutables; revisar una cotización crea nueva versión y revoca su aprobación. Decisiones con autor, fecha y motivo. Aceptación referenciada a mensaje entrante de su conversación y versión aprobada; contratación única por cotización. Pagos pendientes, en verificación, pagados o cancelados; solo admin puede asociar URL HTTPS y verificar evidencia. Reintentos con clave y payload idéntico devuelven el mismo resultado; payload distinto con misma clave se rechaza.

Bot: clave existente de servicio más bandera específica; organización resuelta en servidor, conversación/contacto verificados en cada acceso. Solo ámbito comercial real, nunca sesiones de demo ni laboratorio. Herramientas limitadas, sin acceso administrativo. No se cambia Nea ni el perfil/herramientas activos de Lukas; registro local preparado para conexión posterior. Sin notificación proactiva: consulta de aprobación al siguiente turno.

## Plan y tareas

1. Reutilizar auth Better Auth, BOT_API_KEY, PostgreSQL y estilos; crear tablas comerciales aditivas sin dependencia del 0044 local ajeno.
2. Implementar servicio transaccional, validación Zod estricta, semilla sanitizada, rutas admin/bot y panel Comercial con catálogo, cotizaciones y contrataciones.
3. Probar A–J en PostgreSQL 16 descartable, API y navegador sintéticos; tipos, lint focalizado y build aislado, sin .env real.
4. Congelar candidato con diff frente a base, migración, procedimiento manual y recuperación; commits locales autorizados por esta solicitud, sin push.

## Exclusiones

Sin pasarela, facturación, agenda, infraestructura, publicación o cambios a Lukas activo. V3 no contiene tarifas finales aprobadas: pruebas de venta automática usarán tarifas sintéticas. Los precios originales se conservan orientativos hasta aprobación administrativa. La lectura de health acredita código, no el journal real; el cotejo SQL de producción y respaldo recuperable son condiciones previas al despliegue futuro, sin ejecutar ahora migraciones reales.
