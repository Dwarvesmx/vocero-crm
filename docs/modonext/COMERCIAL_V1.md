# Comercial V1 · entrega controlada · 2026-11-16

Estado del código: PROBADO en entorno local sintético. No desplegado; no habilitado en Lukas. Especificación previa: [spec](../../specs/comercial-v1/spec.md).

## Base y aislamiento

Worktree `vocero-comercial-v1`, rama `entrega/comercial-v1`, padre `f66a58965963748cbe2575043dd4ffb85e64bbd4`. Es la imagen `sha-f66a589` configurada en Coolify Read y el commit reportado por `/api/health` con `commitVerified=true` el 2026-11-16. Producción usa imagen preconstruida; el campo Git `main/HEAD` de Coolify no representa su fuente. El commit corresponde al historial de `demo-center-fase-1` y tag `v-demo-restore-f66a589`.

Se conserva el Demo Center que **ya estaba en producción**. Se excluyen todos los cambios posteriores de la rama de desarrollo, en particular escaparate/plantillas, continuidad `0044_commercial_resume`, dispatcher y cambios de Nea. No hacer merge de `demo-center-fase-1` para publicar Comercial. Si producción avanzase, detener y recotejar la nueva base; no mezclar journals 0044 de dos ramas.

La base tiene journal 0000–0043 (44 entradas). El contenedor ejecuta el migrador antes de servir: health acredita su terminación por inferencia, **no una consulta independiente del journal de producción**. Coolify Read no proporciona sesión SQL; el cotejo directo se conserva como gate obligatorio previo al despliegue. No se afirma que se haya ejecutado ahora.

## Circuito y permisos

`COMERCIAL_V1_ENABLED=true` abre `/comercial` y `/api/comercial` a owner/admin. Ausente o distinto de `true`, permanece inactivo. Bot necesita además `COMERCIAL_BOT_ENABLED=true`, `COMERCIAL_BOT_ORG_ID` correspondiente a la organización autorizada y la clave de servicio existente. No hay proveedor ni credenciales nuevos.

Catálogo: 49 conceptos V3 sanitizados (8 productos, 3 especializaciones y 38 extras); sin horas, costos directos, márgenes ni libro de rentabilidad. Carga por botón **Cargar catálogo V3**, repetible y sin sobreescribir ediciones. Todos los precios originales quedan orientativos o pendientes; no se autorizaron tarifas nuevas. Un administrador confirma precio, alcance, compatibilidad y condiciones antes de marcar un concepto aprobado. Los extras sin tarifa final requieren propuesta interna. Los precios de 149900/29000 usados en tests son centavos sintéticos, no decisiones comerciales.

La cotización calcula en servidor, conserva contacto/conversación, conceptos completos, condiciones e importes enteros en centavos MXN. Precio aprobado y sin excepción permite aprobación automática. Descuento, importe pendiente, desarrollo especial o revisión exige decisión de owner/admin. La revisión crea versión nueva; no sobrescribe snapshots ni conserva la aprobación anterior. El admin puede modificar importes y condiciones, aprobar o rechazar con motivo. El bot consulta la aprobación al siguiente turno sin cambiar `ai_enabled`, solicitar handoff ni inventar avisos proactivos.

Aceptar exige versión aprobada y mensaje entrante comercial de esa conversación, posterior a la versión y última decisión. La referencia acredita el mensaje; la interpretación semántica de aceptación explícita sigue siendo responsabilidad del interlocutor/herramienta. Contratación única por cotización; inicialmente `pendiente`. Pago `en_verificacion` no equivale a `pagado`. Solo admin puede asociar URL HTTPS de cuenta aprobada y confirmar evidencia revisada. No se consulta ni crea la URL en ningún proveedor; no existe pasarela nueva. Pagado/cancelado son terminales. No hay recurrencia automática.

Las operaciones son transaccionales, serializadas por organización y auditadas. `requestKey` por actor conserva el resultado en reintentos; reutilizarla con payload distinto da 409. Las rutas rechazan ámbito ajeno, parámetros no definidos y escritura bot de precios/decisiones/pagos. El adaptador fija conversación y mensaje desde el despacho, fuera de los argumentos del modelo. Se excluyen laboratorio y sesiones demo externas activas. El bot no recibe historial interno ni evidencia administrativa de pago. Los registros comerciales preservan referencias y pueden impedir borrar un contacto/conversación ya contratado: conservar su historial es intencional.

## Herramientas preparadas, sin activar Nea

[Adaptador y registro](../../integrations/nea/comercial_v1.py): `comercial_catalogo`, `comercial_preparar`, `comercial_solicitar_aprobacion`, `comercial_consultar_aprobacion`, `comercial_aceptar`, `comercial_contratar`, `comercial_consultar_cobro`, `comercial_enlace_cobro`. Es código local optativo, apagado por defecto, compatible con `CrmClient._request` y schemas de herramientas de Nea existentes. No se copió al agente ni se cambió su registro activo, personalidad o conocimiento V1/V3.

Habilitación futura mínima: en un cambio de Nea expresamente autorizado, cargar ese registro únicamente para Lukas comercial; crear `ComercialTools` con cliente CRM, conversación, despacho y mensaje entrante de confianza; pasar ID estable de llamada a `execute` y conservar el resultado en el historial del turno. Despacho + ID de llamada forman la clave idempotente. Ante un reintento de transporte conservar ambos IDs y payload. Excluir sesiones de demo y laboratorio en el registro. La cotización puede recuperarse desde el CRM por conversación y ID en turnos posteriores. Compartir enlace usa el envío normal de Nea; esta herramienta solo recupera la URL aprobada. El adaptador se probó con transporte simulado; su incorporación al loop real de Nea y aceptación por WhatsApp requieren la habilitación posterior, no están desplegadas ni probadas con el Lukas activo.

## Migración y verificación local

Única migración nueva: [0044_comercial_v1.sql](../../drizzle/0044_comercial_v1.sql), entrada idx 44 y snapshot 0044. Crea seis tablas `comercial_*` con índices/relaciones; no cambia columnas ni índices existentes. No depende de `0044_commercial_resume` ni de cambios posteriores del Demo Center. No ejecutar ambas migraciones con idx 44; esta entrega se publica exclusivamente desde su base aislada.

`node scripts/verify-comercial-release.mjs` verifica prefix de journal y hashes de los 44 SQL previos normalizados LF contra blobs Git de producción. El checkout Windows puede usar CRLF; los hashes que se comparan con producción deben salir de los blobs LF de la imagen/Linux, no del checkout CRLF. `package.json`, lockfile, Dockerfile, entrypoint y migrador permanecen idénticos a la base. Reutiliza Next 15, React 19, Zod, postgres-js, Drizzle, Better Auth y componentes UI. Sin dependencias añadidas ni instalación de Docker.

Prueba completa reproducible (PostgreSQL 16 nativo ya instalado y Chrome):

```powershell
node scripts/test-comercial-isolated.mjs --build --browser
python -m unittest discover -s integrations/nea -p test_comercial_v1.py
node scripts/verify-comercial-release.mjs
```

El ejecutor no lee `.env`, crea clúster temporal nuevo con contraseña aleatoria local, escucha solo loopback, migra con datos sintéticos y lo detiene en `finally`. UI usa otra base nueva del mismo clúster y Better Auth real. No se usan bases preexistentes ni WhatsApp, LLM o cuentas de cobro. Las capturas sintéticas quedan en `../tmp/comercial-evidencia/`, fuera del candidato. Puertos: PostgreSQL 55546, aplicación 55547. No ejecutarlo junto a otra instancia del mismo arnés.

## Publicación y despliegue manual posteriores

Este procedimiento prepara acciones futuras; ninguna fue ejecutada. Reutiliza la publicación GHCR y cambio manual de imagen que ya operan en este fork (bitácora privada local `docs/integraciones/WA_LANZAMIENTO_02.md`, cierre f66a589). Coolify actual usa `dockerimage`: descarga y arranca una imagen; no se le cambia a build desde Git para esta entrega. El build Linux de imagen y arranque remoto siguen pendientes y solo se ejecutarán con autorización de publicación/despliegue.

1. Obtener autorización específica para publicar el candidato delimitado y para cada operación productiva. Confirmar HEAD limpio de `entrega/comercial-v1`, diff contra base y que remoto es `Dwarvesmx/vocero-crm`, nunca upstream. Revisar el manifest exacto de entrega. No publicar `demo-center-fase-1` ni Nea como efecto lateral.
2. Con autorización de publicación, publicar solo esa rama y un tag prerelease único `v2.7.0-comercial-v1.1` apuntado al candidato exacto. El workflow existente `imagen.yml` admite `v*`, construye linux/amd64, pasa `SOURCE_COMMIT` y publica en GHCR del fork. Un prerelease conserva separado el lanzamiento estable. Si cambian el tag o workflow, revisar antes de ejecutarlo. No se ha creado tag ni disparado workflow ahora.
3. Esperar éxito real del workflow, cotejar revisión OCI contra el candidato y guardar digest inmutable. No declarar aprobado ese build antes de ejecutarlo. No desplegar una etiqueta móvil ni una imagen de la rama de trabajo ajena.
4. Antes de arrancar la imagen, respaldar de forma recuperable la base de Vocero y configuración indispensable; ensayar restauración aislada del respaldo actual y comparar journal/datos. Es condición futura, no auditoría general de respaldos en esta tarea. Preservar `/data` y configuración actual; este módulo no escribe adjuntos ni requiere volumen nuevo.
5. En sesión SQL de solo lectura ya autorizada para el recurso, comprobar `SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;`. Exigir prefix exacto de 44 entradas 0000–0043, hashes LF del artefacto base y ausencia de 0044 ajena. Si hay diferencias, detener. No basta con health. Conservar el resultado sanitizado con el cambio autorizado.
6. Despliegue inicial con las dos banderas comerciales ausentes/false. Coolify → proyecto actual → aplicación Vocero actual → imagen Docker: usar digest del candidato aprobado y **Deploy** manual. El entrypoint aplica exclusivamente 0044 tras el prefix existente y después inicia Next. No cambiar DNS, proxy, dominios, redes ni variables del circuito operativo. Healthcheck de Coolify permanece apagado. No activar Operations como parte de esta preparación.
7. Verificar deployment terminado, logs del migrador, journal con una nueva entrada/hash correcto y seis tablas; health HTTPS con commit exacto y `commitVerified=true`. Comprobar bandeja/contactos y estado de Nea sin enviar mensajes. Ambas superficies comerciales deben seguir inactivas con sus banderas apagadas.
8. Solo después de autorización específica de habilitación, añadir `COMERCIAL_V1_ENABLED=true` al CRM y redesplegar. Probar owner/admin/member, seed repetida, propuesta/aprobación/versiones y contratación sintética autorizada; revisar y confirmar precios reales antes de automatizarlos. No dar por aprobados los precios V3 por haberlos cargado.
9. Tras el cambio local de registro de Nea autorizado y probado, configurar `COMERCIAL_BOT_ENABLED=true` y `COMERCIAL_BOT_ORG_ID` en CRM, conservando la clave compartida existente, y redesplegar. Habilitar el adaptador solo para el Lukas existente. Hacer prueba supervisada de consulta, propuesta, decisión, aceptación y pedido pendiente en la conversación autorizada. La prueba de pago real requiere evidencia auténtica; nunca marcarla con un fixture.

Lectura 2026-11-16: esas tres variables comerciales no aparecen en Coolify Production; esto es esperado y mantiene apagado el módulo. No se necesitan para descargar el código inactivo. Coolify reporta `is_auto_deploy_enabled=true`, aunque el recurso usa imagen preconstruida: no depender de esa opción para aislar una publicación. Se conserva sin cambiar; el despliegue futuro será manual por digest. No se leyeron valores de secretos ni se alteró configuración.

## Reversión y datos

Imagen previa: Coolify configura actualmente la etiqueta `sha-f66a589`; el digest registrado para esa versión es `ghcr.io/dwarvesmx/vocero-crm@sha256:4e1e0f7210ffbfcda3c6839f30f38f14b83b307da3b58f1c8f70575f2434638f` (`f66a589`). Antes del deploy futuro volver a verificar su disponibilidad. Para volver al código anterior, con autorización, deshabilitar entrada comercial/registro nuevo de Nea, conservar datos, seleccionar ese digest en la misma app y Deploy manual. No cambiar DB ni variables ajenas. El migrador anterior no hace downgrade; ignora la entrada posterior por timestamp y el esquema aditivo conserva las tablas. Este comportamiento se ensaya en el arnés local; no equivale a un rollback productivo ejecutado.

La reversión de código **no borra** cotizaciones, pedidos, eventos ni journal. Camino recomendado: conservar las seis tablas sin escritores, hacer respaldo/exportación si ya hay operaciones comerciales y corregir hacia delante. No eliminar filas del journal ni tablas para "deshacer" un deploy. Si falla la aplicación de 0044, el migrador transaccional debe revertir su transacción: verificarlo antes de reintentar, sin borrar nada manualmente. Si existe corrupción persistente, detener escritores, preservar copia del estado fallido y restaurar respaldo probado en base aislada; recuperar de forma acotada las tablas comerciales y su journal únicamente bajo plan autorizado y cotejado con las operaciones posteriores. No restaurar ciegamente toda la base productiva perdiendo mensajes del CRM.

## Evidencia de cierre · 2026-11-16 · LOCAL

- PostgreSQL 16 sintético: 9/9 casos de integración (A–J agrupados y API bot). Inicialización de Drizzle antes del dominio reproduce la auth real; JSON se envía como texto casteado a jsonb, compatible con los serializers del cliente compartido. Reintentos concurrentes, cambio de payload, snapshots, descuentos/revisión, precios pendientes, aprobaciones, aceptación referenciada, contratación única, cobro, evidencia y aislamiento probados. La base también rechaza un pago marcado pagado si se elimina su evidencia (CHECK 23514). No se validó cobro externo.
- Navegación 10/10, incluida visibilidad comercial por bandera y rol; typecheck, lint focalizado y build Next 15.5.28 aprobados. El build también ejecutó su gate de lint/tipos. Sin suites extensas ajenas. Node local 24.13.1; contenedor Linux/Node y build remoto pendientes según procedimiento.
- PostgreSQL descartable: aplicación 0000–0043 → 0044 dos veces, journal final 45 sin duplicación y registro previo preservado. Se volvió a ejecutar el migrador con solo el prefix anterior, que no hizo downgrade y conservó el esquema. Carga inicial de catálogo repetida conservó ediciones administrativas.
- Chrome headless contra **build de producción local**, Better Auth real y base UI independiente: catálogo, edición autorizada, cotización aprobada, revisión v2 pendiente, decisión, aceptación, contratación pendiente, enlace HTTPS, rechazo de pago sin evidencia y pago confirmado con evidencia sintética. Reintento del panel tras respuesta perdida probado sin duplicar cotización. Historial visible; capturas 1440 y 390 px inspeccionadas. Member no lee/escribe; anónimo 401; origen ajeno 403; sin errores JavaScript.
- Adaptador opcional Nea: 3/3 unittest, transporte simulado, bandera apagada, inyección del contexto y mensajes de confianza, reintento estable y recuperación de URL. Loop real del agente activo y WhatsApp no ejercitados ni alterados.
- `verify-comercial-release.mjs` aprobado: prefix exacto, 44 SQL previos LF iguales a Git, dependencias y arranque intactos. `git diff --check` aprobado. Build Linux/remoto, respaldo actual restaurado, cotejo SQL del destino y aceptación productiva quedan para el despliegue posterior autorizado.

La diferencia exacta y los hashes SQL LF están en [el manifiesto de entrega](COMERCIAL_V1_MANIFEST.json). El commit funcional figura allí; el HEAD final de `entrega/comercial-v1` añade solamente el manifiesto documental. El registro local del starter conserva ese SHA final.

La entrega local queda **LISTA PARA PUBLICACIÓN CONTROLADA** exclusivamente desde su rama aislada y con los gates productivos anteriores. No constituye autorización para publicar, migrar, habilitar herramientas ni marcar precios como aprobados.
