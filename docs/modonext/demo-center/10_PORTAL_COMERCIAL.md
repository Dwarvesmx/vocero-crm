# Portal comercial de Demo Center

2026-11-07 · IMPLEMENTADO LOCALMENTE. Baselines CRM `a0b4c685` y Nea `36d6e968`. El portal es una superficie web de Vocero y usa el motor real ya existente. La continuación del selector de ingreso se registra en [WhatsApp](11_WHATSAPP_LANZAMIENTO.md).

## Operación local

1. Usar una instancia local y una base descartable o una copia DEV autorizada. Confirmar el destino antes de aplicar `pnpm db:migrate`. La migración 0040 añade el hash de acceso y el tipo de sesión `web`. Se conservan las filas internas y externas existentes.
2. En Ajustes → IA, confirmar la configuración OpenRouter de la organización. Activar `DEMO_WEB_ENABLED=true` y `DEMO_REAL_ENABLED=true` solo en el entorno en que se vaya a probar. Mantener apagadas las capacidades demo externas de CRM y Nea. La emisión de la invitación comprueba la configuración sin llamar al proveedor. Enviar mensajes con el proveedor real consume presupuesto y requiere autorización.
3. En Demo Center, publicar el perfil, confirmar el conocimiento propio y activar el espacio. Configurar políticas vigentes global y del espacio, presupuesto positivo en ambos y presupuesto por sesión. Las invitaciones ocupan una sesión desde la emisión y caducan según el menor plazo de ambas políticas. Emitirlas poco antes de entregarlas. La pestaña **Demo web** permite emitir, revocar y consultar las últimas 30 sesiones, su estado, operaciones, consumo confirmado y reservas retenidas. La conciliación es administrativa y usa la evidencia del proveedor.
4. Abrir el enlace en una ventana privada y seleccionar la demo. Para ofrecer las dos demos en el mismo portal, emitir una invitación por espacio y pegar el segundo enlace en **Agregar otra invitación**, o unir sus parámetros `acceso` en el mismo fragmento con `&`. El fragmento se retira tras abrir la página y el acceso queda solo en memoria de la pestaña. Para volver tras recargar, abrir el enlace original.
5. Confirmar continuidad de dos turnos y finalizar. **Solicitar información** abre el correo comercial registrado `contacto@modonext.tech` o el destino HTTPS configurado en `DEMO_WEB_CONTACT_URL`. El visitante decide si envía la solicitud. El portal no transfiere historial ni abre una sesión de Lukas.

### Contenido de ejemplo

- **Pizza Nova.** El registro de Fase 2A acredita que NOVA v2 recuperó el menú ficticio y horario en una sesión interna local anterior. Confirmar en la instancia de revisión que ese perfil siga publicado y que el conocimiento esté activo.
- **Casa Horizonte.** Su publicación y conocimiento en la instancia de revisión no están acreditados. Si falta, crear el espacio en Demo Center y publicar un perfil para consultas inmobiliarias ficticias. Entrada manual de ejemplo: «Casa Horizonte es una demostración ficticia. Vivienda de ejemplo Aurora, dos recámaras, un baño y un estudio. Vivienda de ejemplo Brisa, tres recámaras y dos baños. Las dos fichas son ficticias. No representan inmuebles, precios, direcciones ni disponibilidad real». Pregunta de revisión: «¿Qué opción ficticia tiene dos recámaras y un estudio?».

## Contratos y protección

La API pública acepta solo un token aleatorio de 256 bits por sesión, guarda su huella y deriva organización, espacio y perfil en servidor. La API de gestión exige Better Auth y permisos de configuración. Los cuerpos públicos no aceptan identificadores de organización, espacio o sesión. Los datos se sirven sin caché y la interfaz no envía el historial al canal de contacto. Desactivar el espacio suspende el acceso, revocar o cerrar termina el permiso y la caducidad impide operar. El motor conserva controles de concurrencia, cuota, reserva antes del efecto facturable y conciliación. Una solicitud ya iniciada puede liquidarse después del cierre sin reabrir el chat.

## Aceptación y lanzamiento

PROBADO en DEV. 21 pruebas focalizadas de API, simulador, costos, estado del proveedor, pestañas y contratos de canal. Una prueba de interfaz con API controlada pasó en Chrome a 390 y 1440 px, con selección por teclado, cambio entre demos, reintento con la misma clave, finalización y enlace de contacto. Typecheck, ESLint focalizado y `git diff --check` aprobados. El navegador no llamó a la base ni al proveedor en esta prueba.

El recorrido integrado está en `tests/unit/demo-center-web-postgres.integration.test.ts`. Para reproducirlo, iniciar el clúster PostgreSQL 16 sintético conocido `../tmp/demo-f2a02-pg` en `127.0.0.1:55529` después de confirmar que está detenido y que la ruta es la del clúster de pruebas. Usar solo la base descartable `demo_f2a`. La prueba trunca fixtures y verifica la identidad del clúster. No usar `vocero_demo_dev` ni un destino productivo.

```powershell
$env:DATABASE_URL = 'postgres://demo@127.0.0.1:55529/demo_f2a'
$env:APP_BASE_URL = 'http://127.0.0.1:55530'
$env:BETTER_AUTH_SECRET = 'synthetic-test-only-secret'
$env:ENCRYPTION_KEY = [Convert]::ToBase64String([byte[]]::new(32))
$env:META_WEBHOOK_VERIFY_TOKEN = 'synthetic-test-only'
$env:DEMO_WEB_TEST = '1'
$env:DEMO_WEB_ENABLED = 'true'
$env:DEMO_REAL_ENABLED = 'true'
pnpm db:migrate
if ($LASTEXITCODE -eq 0) { pnpm exec vitest run tests/unit/demo-center-web-postgres.integration.test.ts }
```

La prueba sustituye el transporte HTTP a OpenRouter y usa Chrome local para la interacción. La ejecución que incluía arranque del clúster y migración fue rechazada por revisión automática con «blocked by policy», sin detalle adicional. La migración y la suite PostgreSQL quedan pendientes de ejecución autorizada. No se acredita una generación facturable del portal con los resultados de Fase 2A.

La entrega original del portal dejó pendiente el selector de WhatsApp. Consultar el [registro de su implementación local y aceptación pendiente con el proveedor](11_WHATSAPP_LANZAMIENTO.md). El chat web puede validarse por separado.

Antes de publicar, aprobar la prueba integrada, confirmar contenidos y contacto, autorizar una prueba real acotada de OpenRouter, y confirmar la operación concreta de publicación y despliegue con la migración 0040. No hubo publicación, cambios en VPS, mensajes WhatsApp ni cargos durante esta entrega.
