# Mejoras funcionales V1 — 2026-11-03

Entorno: DEV local. Estado: PROBADO localmente con PostgreSQL 16 aislado, API Zernio/CRM simulada y Chrome headless. Sin publicación, imágenes, despliegue, cambios o mensajes productivos. `coolify_operations` permaneció `enabled=false`, verificado por lectura de `.codex/config.toml`.

La incidencia anterior fue declarada cerrada por el propietario tras su corrección manual y respuesta real de Lukas. No se volvió a investigar ni modificar esa configuración.

## 1. Transferencia a atención humana

Causa corregida: Nea interpretaba la aceptación de una respuesta en la cola del CRM como envío externo terminado y llamaba a handoff inmediatamente. La pausa individual impedía después autorizar el aviso retenido.

Contrato aditivo: `POST /api/bot/messages` admite `handoffReason` junto al `responseId` estable; para Zernio devuelve `handoffManaged=true`. Nea guarda el propósito en la MISMA fila `pending_send` antes del primer intento y lo conserva al reiniciar/reintentar. Cloud y demás proveedores conservan el flujo anterior; `BrainsCrmClient` acepta el nuevo argumento opcional sin cambiar su transporte.

Vocero registra mensaje, intención de salida y `conversation.handoff_pending_message_id` en una transacción. El marcador bloquea otros turnos/salidas IA. Solo el aviso asociado puede reservarse; no hay exención del interruptor global, toma humana, cuenta, proveedor ni ventana de 24 horas. Si una persona revoca el marcador antes de la reserva, el aviso se cancela incluso si después reactiva la IA.

Conforme a la respuesta del propietario, la pausa se completa cuando Zernio confirma el envío y devuelve el identificador externo, NO al recibir una confirmación de entrega al teléfono. ACK, estado `sent` y pausa se registran juntos bajo bloqueo de conversación. Una decisión humana posterior al inicio externo no es sobrescrita por el ACK. La ruta heredada bot/handoff también usa una condición atómica que impide adelantar la pausa cuando ya existe un aviso pendiente. Se conserva el límite de no cancelación de la reserva `iniciado`; una petición externa ya iniciada no puede deshacerse.

Timeout o caída tras iniciar: estado durable `incierto`, sin reenvío ciego y sin completar automáticamente la pausa. El aviso pendiente impide nuevas respuestas automáticas; requiere conciliación/intervención, no reproceso automático. Un asesor puede tomar el control explícitamente. No hay nueva cola ni nuevo motor.

## 2. Configuración del agente

Guardado confirmado solo después del ACK `{ok:true}` de la API que actualiza PostgreSQL. Indicador Guardando, bloqueo de guardar concurrentemente, errores visibles y conservación del borrador ante rechazo/red/respuesta inválida. La confirmación se oculta mientras existan cambios pendientes.

El formulario distingue el borrador del último contenido guardado; una edición durante una solicitud no queda marcada como guardada. Refrescar KB/cambiar herramientas no sobreescribe el borrador. Las altas y bajas de KB manual también verifican el ACK, muestran errores y conservan el texto ante rechazo; las entradas pendientes de KB y los documentos seleccionados participan del aviso de cambios sin guardar. La carga inicial fallida muestra Reintentar. Advertencia al salir por enlaces o recargar/cerrar; navegación atrás/adelante también protegida donde existe Navigation API. En navegadores sin esa API, la protección garantizada es enlaces y beforeunload (el navegador decide el texto del aviso).

El preset sigue exigiendo confirmación expresa y ahora utiliza el perfil devuelto por el servidor, sin anunciar éxito después de un error ni reemplazar instrucciones por iniciativa del sistema.

## 3. Documentos de Knowledge Base

PDF con texto, DOCX y TXT UTF-8. Lectores autorizados expresamente por el propietario: `pdf-parse@2.4.5`, `mammoth@1.11.0`, fijados con lockfile. Fuentes de uso: documentación oficial de [PDFParse](https://github.com/mehmet-kozan/pdf-parse) y [Mammoth](https://github.com/mwilliamson/mammoth.js). No servicios externos de extracción.

Originales mediante el almacenamiento existente `saveMediaFile/readMediaFile/deleteMediaFile` (volumen MEDIA_DIR o bucket ya configurado). SHA-256 y tamaño persistidos. Tabla `kb_document` con estados processing/ready/error/deleting, habilitación y reserva; fragmentos en `kb_entry` existente, con FK document_id y eliminación en cascada. Identidad de fragmento estable por documento/posición, índice GIN en PostgreSQL y aislamiento por organización.

Límites: 5 MB por archivo (también cuerpo sin Content-Length), 100 páginas PDF, 100.000 caracteres extraídos, 100 documentos por organización, fragmentos de hasta 2.000 caracteres con solapamiento. DOCX: límites de entradas/expansión ZIP, verificación de tamaños descomprimidos y rechazo de cifrado/ZIP64. Solo texto; no OCR, maquetación, imágenes o tablas complejas garantizadas.

Procesamiento acotado dentro de la solicitud, estado durable antes de extraer, fragmentos y estado ready confirmados juntos. Error visible y recuperación manual del procesamiento fallido o reserva vencida (2 minutos), incluso tras reinicio. No se crean timers/colas paralelas. Un fallo conserva el original para recuperar; una eliminación pendiente queda excluida de búsquedas y puede repetirse.

Pantalla Agente: carga, lista de estado, actualización de estado, vista previa parcial de texto, habilitar/deshabilitar, recuperar y eliminar. Escrituras protegidas por permisos administrativos existentes; lecturas por sesión y organización. Datos de documentos nunca expuestos por rutas públicas.

El perfil anuncia `/api/bot/knowledge` cuando hay documentos habilitados y listos. Nea consulta fragmentos relevantes por turno, sin cachear resultados entre conversaciones ni modificar el perfil base. Búsqueda léxica en español por términos, máximo seis fragmentos y fuentes identificables. No son embeddings ni una garantía semántica de encontrar sinónimos ausentes. Los fragmentos entran por el límite de datos de conocimiento del prompt existente, sin sustituir instrucciones, tono ni escalamiento. Si falla la recuperación, se registra el fallo y se conserva el conocimiento manual; no se inventa contenido documental.

## Archivos del cambio

Dentro de `vocero-crm-dev/`:

- Transferencia: `src/server/zernio/whatsapp-outbox.ts`, `whatsapp-autorizacion.ts`; `src/server/inbox/send.ts`, `queries.ts`; `src/server/dispatch/worker.ts`; `src/app/api/bot/messages/route.ts`, `handoff/route.ts`; esquema compartido.
- Configuración: `src/components/agent/agent-client.tsx`, `src/lib/agent-save.ts`, `src/app/api/agent/profile/preset/route.ts`.
- Documentos: `src/server/kb/documents.ts`, `extract.ts`; `src/components/agent/kb-documents.tsx`; rutas `src/app/api/kb/documents/`, `src/app/api/bot/knowledge/`; filtros de KB manual en rutas existentes, `src/server/ai/prompts.ts`, `src/app/api/bot/profile/route.ts`.
- Modelo/empaquetado: `src/lib/db/schema.ts`, migraciones/metadatos 0031–0033, `next.config.ts`, `package.json`, `pnpm-lock.yaml`; `.gitattributes` acotado a fixtures.
- Pruebas: los nueve archivos unit/integration indicados abajo, `scripts/test-agent-ui.mjs`, fixtures sintéticos `tests/fixtures/kb-v1/`.

Dentro de `nea-agent-dev/`: `app/crm.py`, `crm_brains.py`, `db.py`, `profile.py`, `sender.py`, `state.py`, `turn.py`, nuevo `knowledge.py`; migración `010_pending_handoff.sql`; pruebas `test_turn.py`, `test_sender.py`, `test_response_id_pg.py`, nueva `test_knowledge_v1.py`. No se modificó el prompt base, las instrucciones del negocio, configuraciones productivas ni el control de autorización de números.

## Migraciones y compatibilidad

CRM, en orden después del historial existente:

1. `0031_cold_smiling_tiger.sql`: marcador de aviso pendiente y motivo en outbox, ambos nullable.
2. `0032_even_wind_dancer.sql`: documentos y FK nullable en kb_entry.
3. `0033_giant_inertia.sql`: índices de fragmentos y búsqueda.

Nea: `010_pending_handoff.sql`, columna nullable en pending_send, después de 009. Aplicadas SOLO en PostgreSQL local aislado (Nea usa esquemas efímeros de prueba). No migraciones productivas.

Preferir reversión de código manteniendo esquema aditivo. Una vuelta al CRM anterior requiere atención: ese código incluiría todos los bloques kb_entry sin respetar document_id/habilitación. Antes de una reversión autorizada, con Lukas apagado, se deben retirar únicamente los fragmentos derivados documentales y marcar sus documentos para reindexar, conservando originales y KB manual. No eliminar tablas/columnas ni originales sin copia y autorización específica. Volver a la pareja anterior reintroduce el defecto del aviso: mantener automatización pausada. No se ejecutó ninguna reversión productiva.

## Evidencia

- Vocero: 62/62 pruebas en nueve archivos; 24 son de integración PostgreSQL real (20 del contrato afectado y 4 documentales). Incluyen ACK antes de pausa, UUID/duplicados, dos workers, timeout sin reenvío, intervención/reactivación humana, recuperación de procesamiento, aislamiento organizacional y API administrativa.
- Chrome headless, `node scripts/test-agent-ui.mjs`: borrador tras 503, advertencia/cancelación al salir, guardado en curso, edición concurrente no declarada guardada, confirmación real y conservación de escalado; carga inicial fallida y recuperación, KB manual rechazada sin pérdida del borrador y guardado posterior; carga, vista previa sin interpretar HTML, deshabilitación y eliminación documental con API ficticia.
- Nea: 84/84 pruebas relevantes, incluidas tres con PostgreSQL real y esquemas efímeros. UUID y motivo persisten antes de envío y tras reinicio; dos workers; handoff delegado y compatibilidad anterior; consulta documental alcanza el prompt conservando instrucciones.
- Vocero: typecheck y build de producción aprobados; comprobación final registrada en ESTADO.
- Nea: mypy focalizado sin errores en los ocho módulos modificados; compileall sin errores. El chequeo global señala seis errores en archivos ajenos no modificados: llm.py:195 (dos errores de TypedDict) y :290 (tipo de messages), dispatch.py:236 (forget_dispatches ausente del protocolo Store), main.py:196 y :202 (asignaciones de clientes CRM). No se declara aprobado el chequeo global.

Los tests usan exclusivamente documentos y cuentas ficticias, PostgreSQL en loopback con identidad/directorio verificados y almacenamiento local de prueba. No ALLOWED_WA_IDS ni pruebas de su incidente cerrado.

## Repetición local

Con el PostgreSQL sintético existente en loopback, `vocero_zernio_test`, y su credencial local (sin imprimirla), definir `VOCERO_TEST_POSTGRES=1`, `VOCERO_TEST_PGDATA` al directorio de ese cluster y `MEDIA_DIR` a `tmp/kb-v1-test-media`. El guard comprueba base, host y directorio antes de escribir. Para los tres tests de Nea, `NEA_TEST_DATABASE_URL` apunta exclusivamente a esa misma instancia y `NEA_TEST_PGDATA` a ese directorio; cada caso crea y elimina un esquema propio. El puente HTTP requiere `NEA_TEST_PYTHON` y `NEA_TEST_PATH` al entorno Python y repo local.

- CRM: `pnpm exec drizzle-kit migrate`; Vitest sobre `zernio-postgres.integration`, `kb-document-postgres.integration`, `agent-save`, `kb-document-extract`, `bot-profile`, `zernio-whatsapp-worker`, `zernio-whatsapp-outbox`, `dispatch-interruptor` y `dispatch-conflicto` dentro de `tests/unit`, con `--minWorkers=1 --maxWorkers=1`.
- UI: `node scripts/test-agent-ui.mjs`, requiere Chrome local instalado; todas las APIs se interceptan con datos ficticios.
- CRM: `pnpm typecheck` y `pnpm build`.
- Nea: pytest sobre `test_response_id_pg`, `test_knowledge_v1`, `test_turn`, `test_sender`, `test_profile`, `test_tools`, `test_dispatch_durable`, `test_llm_por_el_crm` dentro de `tests/`.
- Nea: `python -m mypy app/crm.py app/crm_brains.py app/state.py app/db.py app/sender.py app/turn.py app/profile.py app/knowledge.py --follow-imports=silent --ignore-missing-imports`; `python -m compileall -q app`.

Los fixtures PDF/DOCX tienen reglas binarias acotadas en `.gitattributes` para conservar offsets y bytes al clonar en Windows/Linux; índice Git y archivos probados comparados byte a byte.

## Pendientes concretos (estado al cierre local)

La publicación y la validación Linux fueron autorizadas posteriormente y su resultado vigente figura en [el índice maestro](README.md). El despliegue sigue pendiente de autorización. El build Windows no prueba el empaquetado Linux del lector PDF y su worker/canvas nativo; validar extracción de los fixtures dentro de la futura imagen antes de desplegar. Para prueba real, autorizar migraciones aditivas, actualizar CRM y después Nea con automatización pausada; comprobar aviso y pausa desde una conversación supervisada. No afirmar entrega externa validada en esta etapa.

Documentos nuevos pueden tardar hasta el TTL existente del perfil (cinco minutos) en anunciarse a Nea. Deshabilitación/eliminación se respetan en la siguiente consulta documental, sin esperar ese TTL. La ventana de contexto es acotada y la búsqueda léxica puede omitir información sin términos compartidos; validar el material real desde la vista previa y una prueba autorizada.

## Commits locales y cierre

- Vocero: `e2c8086e6d24fe3991593fd5b62b00dfb65a75d4`, rama `zernio-whatsapp`, sobre `3628b41d95a851d3b83bb0d33a694f430ae658ce`.
- Nea: `32f7d006c2c4131aa4ae57d984f83ddb50a60b04`, rama `zernio-identidad-respuesta`, sobre `ce1ca9c418c9607685a0cd481c2cb6deea25c478` (incluye la base funcional aefc25c).
- Árboles de ambos repositorios limpios después de los commits. Identidad puntual de commit `Codex <codex@localhost>`, igual que el historial previo; no se cambió la configuración global de Git.
- Prueba final de la nueva protección de bot/handoff: suite PostgreSQL afectada 20/20 nuevamente aprobada. Después de los últimos ajustes del formulario, Chrome y typecheck aprobados de nuevo; build final de producción exit 0, sin advertencias de hooks.
- PostgreSQL local de pruebas volvió al estado detenido en que estaba al comenzar; se conservaron cluster y credencial sintética. No se descargó ni utilizó información productiva.
- Sin push, publicación de imágenes, despliegue ni operación productiva. Operations deshabilitado.

