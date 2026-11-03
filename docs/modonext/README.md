# ModoNext — índice maestro Vocero / Nea

Registro técnico público sanitizado. Última actualización: 2026-11-03. Este índice distingue fuente probada, publicación y producción. La bitácora histórica completa continúa fuera de GitHub en el workspace del propietario (`docs/integraciones/ESTADO.md`); no se publican trazas de conversaciones, números, credenciales ni identificadores de infraestructura.

## Versiones y referencias

| Componente | Versión | Rama existente | Fuente V1 probada | Imagen V1 |
|---|---|---|---|---|
| Vocero CRM | 2.7.0 | [zernio-whatsapp](https://github.com/Dwarvesmx/vocero-crm/tree/zernio-whatsapp) | `e2c8086e6d24fe3991593fd5b62b00dfb65a75d4` | Validación Linux/publicación en curso |
| Nea | 2.0.2 | [zernio-identidad-respuesta](https://github.com/Dwarvesmx/nea-agent/tree/zernio-identidad-respuesta) | `32f7d006c2c4131aa4ae57d984f83ddb50a60b04` | Publicación en curso |

El HEAD documental exacto es el commit que GitHub muestra en este archivo; consultar también los historiales de [Vocero](https://github.com/Dwarvesmx/vocero-crm/commits/zernio-whatsapp/) y [Nea](https://github.com/Dwarvesmx/nea-agent/commits/zernio-identidad-respuesta/). Los commits de construcción y digests se fijan a continuación al terminar Actions; una actualización documental posterior no cambia la fuente de una imagen ya publicada.

## Producción: última versión registrada, distinta de DEV

Última evidencia técnica registrada el 2026-11-02 (no es una consulta nueva):

- CRM 2.7.0, commit `3628b41d95a851d3b83bb0d33a694f430ae658ce`, `ghcr.io/dwarvesmx/vocero-crm@sha256:7c595c9c5e412070c747436be985b61f4d35fa6386a0027d0904c402ad73bf8e`.
- Nea 2.0.2, commit `aefc25c4e2c2478c44443ae7edd3dc850474353e`, `ghcr.io/dwarvesmx/nea-agent@sha256:f886751c3da875c1d5324b2c553cbd88be26574ee7eb37f21d1210bcd314549d`.
- El propietario confirmó después recepción, envío manual, Coexistence y respuesta real de Lukas. Las mejoras V1 NO están desplegadas por esta publicación. No se alteró el estado de producción.

## Funcionalidades terminadas y evidencia

[Informe V1 canónico: contratos, archivos, pruebas y límites](MEJORAS_FUNCIONALES_V1_2026_11_03.md).

- Aviso de transferencia confirmado por Zernio antes de completar la pausa; UUID e intención durables, control humano y resultado incierto sin reenvío ciego.
- Guardado confirmado del agente/KB, errores y borradores protegidos; instrucciones y escalado conservados.
- PDF con texto, DOCX y TXT persistentes; procesamiento recuperable, administración y consulta de fragmentos desde Nea.
- Evidencia DEV ya aprobada: 62 pruebas CRM (24 PostgreSQL), 84 Nea (3 PostgreSQL), Chrome, typecheck/build CRM y mypy focalizado/compileall Nea. No repetidas en esta publicación.

## Incidencias cerradas: no reabrir sin evidencia nueva

- Rechazo de origen tras proxy: corregido y verificado en la versión CRM registrada arriba.
- Primer despacho no creado: banderas requeridas configuradas y verificadas en los procesos entonces desplegados.
- Identidad durable de Nea: implementada y comprobada con PostgreSQL.
- Restricción de autorización de la línea de prueba: corregida manualmente por el propietario; respuesta real confirmada. No modificar ni repetir sus pruebas.
- Bloqueos A/B/C del conector: resueltos y probados; no rediseñarlos en tareas de publicación.

## Migraciones y despliegue coordinado

Aplicación futura, NO ejecutada en producción:

1. Con automatización pausada y respaldos/reversión acordados, actualizar CRM: [0031](../../drizzle/0031_cold_smiling_tiger.sql), [0032](../../drizzle/0032_even_wind_dancer.sql), [0033](../../drizzle/0033_giant_inertia.sql), tras su historial existente.
2. Actualizar Nea y aplicar [010_pending_handoff.sql](https://github.com/Dwarvesmx/nea-agent/blob/zernio-identidad-respuesta/migrations/010_pending_handoff.sql), tras 009.
3. Mantener las variables actuales del circuito y los mismos recursos persistentes. No activar el agente ni reprocesar conversaciones como efecto de esta actualización.
4. El contrato es aditivo (`handoffReason`, `handoffManaged`, consulta documental). Primero CRM, después Nea. Las migraciones no eliminan datos ni cambian las versiones 2.7.0/2.0.2.

Los contenedores conservan migraciones al arranque; no arrancar sus comandos por defecto contra producción antes de autorizar esa operación. La validación Linux usa entrypoint de prueba, sin red, credenciales ni PostgreSQL. Reversión y particularidad de los fragmentos KB en imágenes antiguas: ver el informe V1; no revertir ciegamente ni borrar originales.

## Publicación Linux V1

Estado: BLOQUEADO por credencial de publicación rechazada por GitHub. No se publicaron los commits V1 ni se ejecutó Actions con ellos. Se registrarán aquí commits de construcción, workflows, arquitectura, prueba del extractor/nativo y referencias completas por digest cuando se restablezca el acceso autorizado. Ningún workflow de publicación contiene despliegue a Coolify.

## Pendientes comprobados y decisiones

1. Prioridad actual: terminar la validación PDF en imagen Linux/amd64 y verificar los dos artefactos por digest.
2. Después: autorización expresa para despliegue coordinado/migraciones y prueba real supervisada. No autorizados en esta etapa.
3. Mypy global Nea: seis errores en tres archivos ajenos a V1, detallados en el informe; mypy focalizado de los ocho módulos modificados aprobado. No ampliar publicación para corregirlos.
4. Restauración productiva aislada no ensayada según la bitácora; no se presenta un respaldo exitoso como restauración comprobada.
5. Límites V1: PDF requiere texto, sin OCR; consulta léxica en español, contexto acotado, anuncio documental sujeto al TTL del perfil; ver límites y recuperación en el informe.

## Acceso para ChatGPT

Compartir la URL de este índice y pedir consultar sus enlaces antes de una tarea. Los documentos son públicos y versionados; no implica sincronización automática ni memoria permanente del chat. Para fijar evidencia histórica, usar el enlace de archivo con SHA en lugar del nombre de rama. No publicar la bitácora privada ni materiales reales de clientes.
