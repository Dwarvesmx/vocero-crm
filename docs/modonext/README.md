# ModoNext — índice maestro Vocero / Nea

Registro técnico público sanitizado. Última actualización: 2026-11-03. Este índice distingue fuente probada, publicación y producción. La bitácora histórica completa continúa fuera de GitHub en el workspace del propietario (`docs/integraciones/ESTADO.md`); no se publican trazas de conversaciones, números, credenciales ni identificadores de infraestructura.

## Versiones y referencias

| Componente | Versión | Rama existente | Fuente V1 probada | Imagen V1 |
|---|---|---|---|---|
| Vocero CRM | 2.7.0 | [zernio-whatsapp](https://github.com/Dwarvesmx/vocero-crm/tree/zernio-whatsapp) | `e2c8086e6d24fe3991593fd5b62b00dfb65a75d4` | PROBADO Linux / fuente [`a659177`](https://github.com/Dwarvesmx/vocero-crm/commit/a65917720b6616479ce5d7fd5c9355566aea5506) |
| Nea | 2.0.2 | [zernio-identidad-respuesta](https://github.com/Dwarvesmx/nea-agent/tree/zernio-identidad-respuesta) | `32f7d006c2c4131aa4ae57d984f83ddb50a60b04` | PROBADO Linux / fuente [`489aecd`](https://github.com/Dwarvesmx/nea-agent/commit/489aecd76da177eeace334d79bf78a77a11b91b6) |

El HEAD documental exacto es el commit que GitHub muestra en este archivo; consultar también los historiales de [Vocero](https://github.com/Dwarvesmx/vocero-crm/commits/zernio-whatsapp/) y [Nea](https://github.com/Dwarvesmx/nea-agent/commits/zernio-identidad-respuesta/). Los commits de construcción y digests verificados se registran a continuación; una actualización documental posterior no cambia la fuente de una imagen ya publicada.

## Producción: V1 desplegada y verificada

El 2026-11-03 se actualizaron las aplicaciones existentes en orden CRM → Nea. HTTPS y PostgreSQL respondieron correctamente; los commits ejecutados se verificaron y ambos contratos internos respondieron sin enviar mensajes durante el despliegue.

- CRM 2.7.0: commit `a65917720b6616479ce5d7fd5c9355566aea5506`, `ghcr.io/dwarvesmx/vocero-crm@sha256:b520d2625aa39218824b26dc85c992972d1e8e092f5a1424e44eaef310c6e6b2`.
- Nea 2.0.2: commit `489aecd76da177eeace334d79bf78a77a11b91b6`, `ghcr.io/dwarvesmx/nea-agent@sha256:ffa90851bdedc7cf0ee0e398b32704a1a6baf9b32b42c5ef0a58f951a583a0ff`.
- CRM 0031–0033 registradas una vez con hashes correctos; estructura de Nea 010 comprobada. Datos, variables, configuración y almacenamiento conservados según las comprobaciones técnicas; no se necesitó reversión.
- Respaldos puntuales anteriores: CRM 128448 bytes, Nea 25368 bytes; Coolify reportó éxito local y subida a R2. Restauración aislada no ensayada. El volumen conservó su respaldo puntual verificado.
- Lukas quedó apagado al cierre técnico del despliegue; las pruebas posteriores fueron reportadas por el propietario. El estado actual del interruptor no se ha vuelto a consultar. `coolify_operations=false` confirmado el 2026-11-04 en la configuración local.

## Validaciones posteriores reportadas por el propietario

El propietario informó que el guardado del comportamiento persiste; un PDF de conocimiento quedó listo y habilitado, con vista previa legible; Lukas respondió coherentemente una pregunta comercial; y el aviso de transferencia apareció antes de la pausa sin nuevo error de autorización. Son observaciones del propietario, no pruebas ejecutadas por Codex. La recuperación documental inequívoca sigue pendiente.

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

Aplicación completada en producción el 2026-11-03; orden y condiciones conservados como referencia:

1. Con automatización pausada y respaldos/reversión acordados, actualizar CRM: [0031](../../drizzle/0031_cold_smiling_tiger.sql), [0032](../../drizzle/0032_even_wind_dancer.sql), [0033](../../drizzle/0033_giant_inertia.sql), tras su historial existente.
2. Actualizar Nea y aplicar [010_pending_handoff.sql](https://github.com/Dwarvesmx/nea-agent/blob/zernio-identidad-respuesta/migrations/010_pending_handoff.sql), tras 009.
3. Mantener las variables actuales del circuito y los mismos recursos persistentes. No activar el agente ni reprocesar conversaciones como efecto de esta actualización.
4. El contrato es aditivo (`handoffReason`, `handoffManaged`, consulta documental). Primero CRM, después Nea. Las migraciones no eliminan datos ni cambian las versiones 2.7.0/2.0.2.

Los contenedores conservan migraciones al arranque; no arrancar sus comandos por defecto contra producción antes de autorizar esa operación. La validación Linux usa entrypoint de prueba, sin red, credenciales ni PostgreSQL. Reversión y particularidad de los fragmentos KB en imágenes antiguas: ver el informe V1; no revertir ciegamente ni borrar originales.

## Publicación Linux V1 — evidencia previa al despliegue

Ambos workflows terminaron **success**, plataforma **linux/amd64**. Se publicaron las ramas existentes sin merges ni force push. Los commits funcionales `e2c8086` y `32f7d00` se conservaron como ancestros; los únicos ajustes posteriores son documentación, publicación y corrección del empaquetado PDF.

| Componente | Commit exacto de imagen | Workflow verificado |
|---|---|---|
| CRM | [`a65917720b6616479ce5d7fd5c9355566aea5506`](https://github.com/Dwarvesmx/vocero-crm/commit/a65917720b6616479ce5d7fd5c9355566aea5506) | [41619859513: success](https://github.com/Dwarvesmx/vocero-crm/actions/runs/41619859513) |
| Nea | [`489aecd76da177eeace334d79bf78a77a11b91b6`](https://github.com/Dwarvesmx/nea-agent/commit/489aecd76da177eeace334d79bf78a77a11b91b6) | [41618549967: success](https://github.com/Dwarvesmx/nea-agent/actions/runs/41618549967) |

Referencias inmutables que identifican los artefactos verificados:

```text
ghcr.io/dwarvesmx/vocero-crm@sha256:b520d2625aa39218824b26dc85c992972d1e8e092f5a1424e44eaef310c6e6b2
ghcr.io/dwarvesmx/nea-agent@sha256:ffa90851bdedc7cf0ee0e398b32704a1a6baf9b32b42c5ef0a58f951a583a0ff
```

Etiquetas de trazabilidad: `2.7.0-zernio-a65917720b6616479ce5d7fd5c9355566aea5506` y `2.0.2-zernio-489aecd76da177eeace334d79bf78a77a11b91b6`. Para desplegar, usar el digest, no la etiqueta.

Prueba PDF dentro del contenedor final Alpine, Node v22.23.4: extractor de producción y canvas nativo cargados; `servicios.pdf` devuelve el texto esperado; `sin-texto.pdf` rechazado. Hash SHA-256 del fixture, igual al blob Git: `f40cb86ac49316c2ee948f619689006966424d88c2ab8ca0c7512c88691757de`. Se ejecutó con red deshabilitada, sistema de archivos de solo lectura, usuario sin privilegios y sin arrancar el CRM/migrador. No se repitieron las 146 pruebas locales aprobadas.

Corrección Linux acotada: trazado explícito de PDF.js/worker/canvas y copia del binario musl ya fijado en el lockfile a los cargadores canvas emitidos por standalone. No se modificaron las funciones V1, dependencias ni versiones. Los candidatos de [41618545376](https://github.com/Dwarvesmx/vocero-crm/actions/runs/41618545376) y [41619320616](https://github.com/Dwarvesmx/vocero-crm/actions/runs/41619320616) fallaron la validación y NO son referencias autorizadas para desplegar.

Migraciones empaquetadas comprobadas byte a byte contra sus blobs Git: CRM 0031–0033; Nea 010. Ver hashes, límite de reversión y detalle en [el informe V1](MEJORAS_FUNCIONALES_V1_2026_11_03.md#publicación-linux-y-verificación-ghcr). Los índices/manifiestos/config de GHCR se comprobaron por SHA-256 con acceso anónimo; etiquetas OCI de revisión/versión y arquitectura coinciden. Provenance/SBOM generados por Actions; no se afirma firma keyless verificada.

El HEAD documental puede avanzar después del commit de imagen: consultar el commit de este archivo y los historiales enlazados arriba. Esto no reconstruye ni cambia los digests registrados.

## Pendientes comprobados y decisiones

1. Pendiente: demostrar inequívocamente la recuperación de información del PDF en una prueba supervisada autorizada.
2. Pendiente: ensayar la restauración aislada de los respaldos en un entorno autorizado.
3. Mypy global Nea: seis errores en tres archivos ajenos a V1, detallados en el informe; mypy focalizado de los ocho módulos modificados aprobado. No ampliar publicación para corregirlos.
4. Restauración productiva aislada no ensayada según la bitácora; no se presenta un respaldo exitoso como restauración comprobada.
5. Límites V1: PDF requiere texto, sin OCR; consulta léxica en español, contexto acotado, anuncio documental sujeto al TTL del perfil; ver límites y recuperación en el informe.

## Acceso para ChatGPT

Compartir la URL de este índice y pedir consultar sus enlaces antes de una tarea. Los documentos son públicos y versionados; no implica sincronización automática ni memoria permanente del chat. Para fijar evidencia histórica, usar el enlace de archivo con SHA en lugar del nombre de rama. No publicar la bitácora privada ni materiales reales de clientes.
