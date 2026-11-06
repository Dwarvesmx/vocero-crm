# DC-F2A-01 — Simulador interno

2026-11-05 · IMPLEMENTADO LOCALMENTE de forma parcial sobre CRM `39b6132`, rama `demo-center-fase-1`. La entrega 2A no está terminada.

Se añadió un constructor puro de mensajes en `src/server/demo-center/domain/simulator.ts` y sus pruebas en `tests/unit/demo-center-simulator.test.ts`. Acepta perfil, conocimiento e historial explícitos, sin leer el perfil comercial. El conocimiento se coloca en un mensaje de usuario, no en el mensaje de sistema. No se ha probado contra un modelo real y la separación de roles no garantiza que el modelo ignore instrucciones maliciosas en los datos.

La función que representa disponibilidad de proveedor real devuelve false. Ninguna ruta, sesión, pantalla o proveedor consume todavía esta función: no constituye una barrera implementada en un punto de entrada, pues ese punto de entrada aún no existe.

Decisiones pendientes de implementar: el esquema `demo_session` de 0036 exige `authorization_id` y `conversation_id`, vinculados a teléfono y conversación CRM. El simulador interno requiere una identidad y persistencia propias sin alterar contactos comerciales. Debe modelarse una variante de sesión interna y verificar FKs, migración y acceso por organización, espacio y actor en PostgreSQL desechable. La cuota simultánea, los contadores y la reserva y conciliación de costos no están implementados. No se puede habilitar un LLM facturable hasta demostrar una cota de costos y reservarla atómicamente; si el proveedor no ofrece cota y conciliación verificables, bloquear esa operación como exige 04_SEGURIDAD.md.

Pendiente: API autenticada y auditada, persistencia e historial por sesión, cierre y expiración, recuperación de KB autorizada, límites y concurrencia, adaptador de proveedor simulado, interfaz y pruebas integradas. Las dos pruebas unitarias del constructor pasan; `tsc --noEmit` y `git diff --check` pasan en DEV. No se ejecutó build ni PostgreSQL en esta entrega. No existen migraciones nuevas, llamadas a proveedores, mensajes externos, commit ni despliegue.


## DC-F2A-02 — 2026-11-05

IMPLEMENTADO LOCALMENTE. La entrega simulada funciona con API, PostgreSQL y chat. El cierre de Fase 2A con proveedor real permanece pendiente de DC-F2A-03.

### Modelo y compatibilidad

0038_demo_internal_simulator.sql añade kind=internal/external a demo_session. Los registros previos conservan external. CHECK exige autorización y conversación para external; internal exige actor y clave idempotente, y prohíbe teléfono y conversación. Se mantienen las FKs compuestas de organización y espacio/perfil. demo_simulation_turn conserva pares de usuario/respuesta con clave única por sesión. No se insertan mensajes comerciales ni se utilizan identidades ficticias del CRM.

### API y aislamiento

GET /api/demo-center/simulator?spaceId=… lista las últimas 25 sesiones internas del actor. Añadir sessionId devuelve sesión e historial. POST admite exclusivamente start (spaceId,requestKey), send (spaceId,sessionId,requestKey,text) y close (spaceId,sessionId). Requiere Better Auth y rol owner/admin. El actor, organización y pertenencia salen de la sesión autenticada. Se exige misma organización, espacio y actor para acceder a una sesión. Los campos de proveedor/modelo/URL se rechazan por contrato estricto.

Inicio exige espacio activo, perfil publicado y políticas global y de espacio vigentes y habilitadas con valores positivos de duración, inactividad, concurrencia, sesiones por periodo, entradas, respuestas y llamadas. Valores ausentes o cero se bloquean con policy_required para evitar interpretar una semántica no resuelta. No se emplean importes ni excepciones como autorización de gasto. Global y espacio se comprueban conjuntamente y la sesión conserva snapshot. Los presupuestos monetarios no se aplican porque no hay proveedor facturable disponible.

Se serializan operaciones por fila de organización y espacio. El cierre compite bajo los mismos bloqueos. El proveedor determinista se ejecuta dentro de la transacción sin HTTP. Un fallo revierte todo el turno; reintento de misma clave/texto devuelve el resultado persistido sin duplicar. La clave reutilizada con otro texto se rechaza. Cada inicio, turno y cierre registra auditoría y evento de sesión sin contenido. El perfil se obtiene por la versión fijada al iniciar. El reloj de puertas temporales usa clock_timestamp después de adquirir bloqueos. Las sesiones vencidas se rechazan aunque su estado almacenado siga active; no se ha añadido un barrido de expiración.

### Proveedor e interfaz

La pestaña Simulador utiliza exclusivamente el proveedor determinista local y se identifica como simulado. El contexto reutiliza buildSimulatorMessages y demoKnowledge del espacio; KB entra como datos, no como instrucciones del sistema. El proveedor recibe el contexto pero su respuesta determinista solo confirma nombre, versión, fragmentos y longitud de historial; no es una prueba de razonamiento ni de resistencia a inyección de un LLM real. El texto /error-simulado permite probar rollback. No hay registro de adaptadores ni configuración que conecte el simulador a proveedores reales. El motor de reservas y conciliación queda pendiente.

### Evidencia DEV

Clúster PostgreSQL 16 desechable nuevo tmp/demo-f2a02-pg, loopback 55529, base demo_f2a. Migraciones hasta 0038 aplicadas solamente allí. Prueba integrada 5/5: sesión interna sin contacto, CHECK externo, persistencia y deduplicación concurrente, versiones, ámbitos, conocimiento comercial excluido, cierre/vencimiento, políticas y rollback de error. Incluye recorrido React/Chrome real con peticiones interceptadas y resueltas por el backend contra esa base: iniciar, enviar Galactica, leer respuesta e historial y cerrar. La prueba sustituye autenticación y transporte HTTP con el actor sintético; no certifica Better Auth real. Los tests previos de dominio y pestañas pasaron 4/4. Typecheck y git diff --check aprobados. Build final aislado aprobado con los ajustes de eventos y hook load. Una repetición de edición/prueba fue rechazada por política de ejecución sin motivo específico; no se afirma ejecutada.

### Revisión Windows

Usar un entorno descartable nuevo, separado de vocero_demo_dev. Aplicar migraciones allí con pnpm db:migrate tras verificar DATABASE_URL. Iniciar pnpm dev en ese entorno. Entrar con propietario, crear un espacio ficticio y publicar perfil. Configurar política global y del espacio con fechas vigentes y contadores positivos. Activar configuración del espacio. Abrir Simulador, Iniciar sesión, escribir una consulta de conocimiento, Enviar, consultar la sesión en el selector y Cerrar sesión. El selector recupera las últimas 25 sesiones del mismo actor. Las migraciones no se han aplicado a la base del usuario. La clave de reintento del turno se conserva en la UI ante error; el inicio requiere que el cliente conserve su requestKey para reintentos HTTP idempotentes. La UI todavía genera una clave nueva al volver a pulsar iniciar tras un error de red, limitación pendiente de robustez.

### Archivos y pendientes

schema.ts, migración/snapshot/journal 0038, infra/simulator.ts, entrada pública index.ts, API simulator/route.ts, componentes simulator.tsx y admin.tsx, pruebas de dominio e integración. Cambios locales sobre 39b6132 en demo-center-fase-1, sin commit/push/despliegue. Pendientes DC-F2A-03: reservas monetarias y conciliación, proveedor real autorizado, pruebas HTTP autenticadas y recuperación de operaciones inciertas. No continuar automáticamente a esa entrega.

## DC-F2A-03 — avance parcial, 2026-11-05

Se confirmó por lectura la conexión autorizada 127.0.0.1:55489/vocero_demo_dev, usuario vocero_demo_dev, esquema public, 38 migraciones registradas. Respaldo local en tmp/dc-f2a03-backup/vocero_demo_dev-1793917313291.dump, 172178 bytes, SHA-256 29a673d41c0c96852afb0bdd7292f51235cfdc6ddb8fc73f45a750b2e43a65d2. pg_restore --list aprobó su lectura. No se ensayó restauración. Restaurar requiere detener escritores, verificar destino y usar pg_restore contra una base autorizada, sin sobrescribir la actual automáticamente. La migración 0038 sigue pendiente de comprobación de compatibilidad y aplicación.

La UI conserva una clave de inicio entre reintentos, la libera tras recuperar la sesión y bloquea solicitudes simultáneas mediante ref. Typecheck aprobado. Pendiente prueba de interacción de este ajuste.

La infraestructura chatJson existente reintenta hasta tres veces y devuelve texto/JSON sin contrato de costo real. No se puede reutilizar como autorización de gasto ni presentar como motor de reservas. Falta implementar y probar reserva transaccional, liquidación y conciliación, adaptar el proveedor y bloquear su activación por defecto. No se ejecutaron llamadas facturables, migraciones ni cambios productivos. DC-F2A-03 permanece incompleta.


## DC-F2A-REAL-01 — integración de base local, 2026-11-05

Avance parcial. El simulador real y el motor monetario todavía no están implementados.

Se verificó la huella del respaldo anterior y se restauró completamente en un clúster descartable aislado, tmp/demo-real-restore-pg, puerto 55539. El usuario local vocero_demo_dev no tiene CREATEDB; por eso el ensayo utilizó un clúster descartable y no creó una base permanente en su instancia. pg_restore --exit-on-error --no-owner --no-privileges aprobó la restauración; 0038 también se aplicó en esa copia. El clúster de restauración quedó detenido.

Antes del cambio local se generó otro respaldo legible: tmp/dc-f2a03-backup/vocero_demo_dev-1793917932439.dump, 172178 bytes, SHA-256 809b4234d00fd275f37bc1be1a52d1b04506dce82c969a8dd84407e59abf6f2a. Después de comprobar 38 migraciones existentes y sesiones compatibles, se aplicó exclusivamente 0038 a vocero_demo_dev en 127.0.0.1:55489. La comparación mediante row_to_json en servidor confirmó igualdad de las filas anteriores para demo_space (2), demo_profile_version (2), kb_entry (2), kb_document (1), demo_authorization (1), demo_limits (1), demo_admin_audit (11) y user (1). La primera comparación del ensayo utilizó parsers JS modificados por Drizzle y no fue válida; se corrigió a una representación estable del servidor antes de tocar la base local.

Typecheck y git diff --check aprobados. No se modificaron credenciales ni hubo llamadas facturables. La configuración local solo tiene una fila demo_limits; se mantienen las validaciones existentes que requieren política global y del espacio. No se rellenaron presupuestos ni configuraciones por iniciativa del agente.

Contratos externos consultados: https://openrouter.ai/docs/api/api-reference/generations/get-generation y https://github.com/OpenRouterTeam/docs/blob/main/api_reference/limits.mdx. El identificador de generación permite consultar total_cost. La estimación del proveedor no cubre universalmente cargos por petición/plugins/imágenes. Es necesario fijar el modo de texto y validar precios/modelo/cargos y cota antes de reservar. El adaptador actual chatJson devuelve texto y realiza reintentos, por lo que no se usó para gastos de demo. Pendientes: ledger monetario y sus pruebas, adaptador sin reintentos ambiguos, reconciliación por ID, exposición de consumo en la interfaz, prueba del reintento frontend y build final. La funcionalidad de IA real continúa pendiente; no se considera completada esta entrega.


## DC-F2A-REAL-02 — 2026-11-05

IMPLEMENTADO LOCALMENTE y PROBADO con proveedor controlado. Integración real preparada y deshabilitada; aprobación funcional con generación OpenRouter real pendiente de autorización del propietario.

### Circuito implementado

La API existente acepta send con provider=openrouter y reconcile con operationId. Autenticación Better Auth y permisos owner/admin se conservan. Solo el backend resuelve la credencial existente mediante resolveAiProvider. Se exige base URL oficial de OpenRouter y habilitación explícita DEMO_REAL_ENABLED=true. No se modificaron archivos de entorno ni claves. La comprobación local encontró cero credenciales ai_credentials y ninguna OPENROUTER_API_TOKEN en el entorno. La habilitación real sigue false.

El modo determinista permanece disponible para diagnóstico únicamente si DEMO_SIMULATED_ENABLED=true; ninguna ruta diagnóstica llama a un proveedor facturable. El flujo real no reutiliza chatJson.

### Reserva, uso y conciliación

0039_demo_llm_consumption añade campos de evidencia, modelo, huella de entrada, texto y attempted_at en demo_usage_operation, y un índice parcial que permite solo una operación reserved/uncertain por sesión. Se usa el ledger existente; no se duplican tablas financieras. Las sumas del ledger son la fuente de autorización y se serializan sobre organización y sesión en PostgreSQL. Cada operación es única por organización/requestKey y vincula org/espacio/sesión/actor. Misma clave con entrada distinta se rechaza. La reserva se confirma antes de cualquier POST externo. Una segunda transacción revalida estado, expiración y versiones de políticas antes de marcar uncertain y attempted_at. Esa es la frontera conservadora anterior al envío. No hay HTTP dentro de transacciones.

Se comprueban presupuestos global, espacio y sesión, ventanas vigentes, contadores y concurrencia. Las excepciones de presupuesto activas aumentan únicamente el ámbito explícitamente autorizado. Las solicitudes pendientes protegen su reserva. El presupuesto por sesión debe ser explícito y positivo en el snapshot; si falta, iniciar una sesión nueva después de configurarlo. Los importes se contabilizan en micro-USD con redondeo conservador hacia arriba; el costo decimal original y los tokens del proveedor se guardan como evidencia. Los contadores reales se separan de las respuestas deterministas anteriores.

La liquidación confirmada es idempotente y atómica con historial y auditoría. El costo real conocido reemplaza la reserva y libera la diferencia no gastada. Si la sesión se cerró o venció, se registra el costo sin incorporar una respuesta tardía a su historial. Un timeout, HTTP no confirmado, cuerpo inválido o fallo después del envío deja uncertain, sin reintento de generación. Si existe ID del proveedor, reconcile consulta GET generation y utiliza total_cost. Sin ID se conserva la reserva y se informa que requiere evidencia externa; no hay botón para liberarla arbitrariamente. Una operación reserved que nunca llegó a attempted_at puede liberarse de forma segura bajo bloqueo. Si el costo supera la cota, se conserva evidencia e importe y se bloquean nuevas llamadas de la organización para revisión.

### Contrato OpenRouter

El adaptador consulta GET models para el modelo configurado, exige precios verificables y parámetros de texto/max_tokens. Cota conservadora: precio de prompt por todo context_length más precio de completion por hasta 512 tokens. Se usan enteros a 18 decimales para tarifas y conversión hacia arriba a micro-USD. La petición fija max_tokens, max_price de prompt/completion, max_price request/image=0, sin fallback ni herramientas/plugins. Modelos con variantes, routers, precios adicionales no soportados, escritura de cache facturable o datos insuficientes se bloquean antes de generar. Esa cota puede ser mucho mayor que el costo esperado del mensaje; no se presenta como cargo confirmado.

El único POST no se reintenta. Se guardan ID, modelo, usage y costo cuando OpenRouter los devuelve. Fuentes oficiales consultadas: https://openrouter.ai/docs/guides/routing/provider-selection y https://openrouter.ai/docs/api/api-reference/generations/get-generation. El contrato depende de que el proveedor respete sus topes de precio/tokens; un exceso activa el bloqueo descrito, no una autorización automática de sobreconsumo.

### Migración local y respaldo

0039 aplicada primero en PostgreSQL 16 descartable tmp/demo-f2a02-pg, puerto 55529. Después se generó respaldo legible de vocero_demo_dev: tmp/dc-f2a03-backup/vocero_demo_dev-1793918465849.dump, 176775 bytes, SHA-256 1685aad9f080f5f412510216eeb11ae73dcb63604b0522fa9bbfac57cc44f615. Se aplicó únicamente 0039 sobre el historial esperado de 39 migraciones anteriores. Se compararon las huellas de filas previas mediante row_to_json y se conservaron todos los datos de Fase 1: espacios 2, perfiles 2, KB manual/fragmentos 2, documentos 1, autorizaciones 1, límites 1, auditorías 11 y usuarios 1. Se conserva el ensayo de restauración ya aprobado.

### Pruebas y archivos

Seis pruebas integradas con PostgreSQL sintético y OpenRouter controlado verifican reserva antes de ejecutar, idempotencia concurrente, liquidación única, resultado incierto, conciliación repetida, presupuesto entre sesiones, liberación nunca enviada, permisos de ámbito, conocimiento propio frente a KB comercial/otro espacio/otra org, contrato HTTP sin cargos y pérdida de ACK desde React/Chrome. La prueba de navegador ejecutó un único proveedor controlado al perder y reintentar la respuesta, y creó una sola sesión al perder el ACK del inicio. Pruebas previas de dominio, formato y pestañas: 6/6. Siete escenarios de borradores y aislamiento en Chrome aprobados. Typecheck y git diff --check aprobados. Build aislado aprobado. Después se ajustó created_at de la reserva a clock_timestamp para que la espera del bloqueo no la asigne a una ventana anterior. La repetición integrada de ese ajuste fue rechazada por la revisión automática con blocked by policy, sin motivo más específico. La ejecución integrada aprobada corresponde a la versión inmediatamente anterior a ese ajuste; no se afirma que la repetición se ejecutara.

Archivos nuevos: infra/finance.ts, infra/openrouter.ts, migración y snapshot 0039, tests/unit/demo-center-finance-postgres.integration.test.ts. Adaptados: schema.ts, journal, API simulator/route.ts, infra/simulator.ts, index.ts y componente simulator.tsx. El historial y la pantalla existente ahora muestran modelo, estado de operación, costo confirmado, reserva, uso reportado y presupuesto disponible en USD. Rama demo-center-fase-1, sin commit/push/despliegue.

### Primera revisión real autorizada en Windows

1. Revisar y aprobar los controles. Configurar una credencial y modelo OpenRouter aptos desde Ajustes → IA, sin compartir la clave por chat.
2. Configurar políticas global y de Pizza Nova vigentes, presupuestos positivos global/espacio/por sesión y contadores positivos. No se modificaron esas decisiones por cuenta del agente.
3. Solo tras autorizar el primer gasto, habilitar DEMO_REAL_ENABLED=true en el entorno local y reiniciar la instancia local. Mantener diagnóstico deshabilitado para el uso normal.
4. Seleccionar Pizza Nova, iniciar una sesión nueva para fijar perfil y snapshot de límites, y enviar una pregunta sobre productos u horarios. Revisar respuesta, modelo, operación, tokens, costo confirmado y reserva. Si la cota no se puede verificar, la operación queda bloqueada; no se sustituye el modelo automáticamente.
5. Si el resultado es incierto, usar Conciliar costo cuando haya ID. No crear una generación duplicada para resolver una incertidumbre. El historial persistido se recupera desde el selector.

La primera generación real y la medición en la cuenta del propietario no se ejecutaron. Son la aprobación funcional pendiente; no se declara completada Fase 2A en producción ni se inicia Fase 2B.

## DC-F2A-REAL-03 — 2026-11-05

PROBADO en DEV: suite financiera PostgreSQL descartable 7/7. Se agregó una prueba que retiene el lock de organización y verifica que created_at de la reserva es posterior a su liberación. Incluye reserva, concurrencia, idempotencia, liquidación, incertidumbre, conciliación y reintento React/Chrome con proveedor controlado; ninguna llamada facturable. Se levantó únicamente el clúster sintético previo de puerto 55529.

Lectura local de configuración: ai_credentials sin filas, OPENROUTER_API_TOKEN ausente, OPENROUTER_MODEL ausente y DEMO_REAL_ENABLED distinto de true. Existe una política de espacio activa con ventana vigente, presupuesto de espacio cero y presupuesto de sesión nulo; no hay política global. No se modificó configuración. Se añadió lectura autenticada de estado del proveedor y modelo seleccionado antes de la primera operación, sin devolver credenciales. Falta revisión visual de ese ajuste. Los tokens y costo dependen de datos reportados por el proveedor. El máximo de salida está fijado en código a min(512, context_length), no se configura en la UI. El significado operativo de cero no se presume: el código exige importes y contadores positivos para habilitar solicitudes.

Pendiente aceptación funcional: configurar credencial/modelo y ambas políticas según decisión del propietario, crear nueva sesión para fijar snapshot, habilitar explícitamente DEMO_REAL_ENABLED en entorno local y autorizar la primera generación facturable. Cota = tarifa por token de entrada multiplicada por context_length más tarifa de salida por máximo 512 tokens, redondeada hacia arriba a micro-USD. Si la cotización o capacidad del modelo no cumple restricciones, se bloquea antes de generar. Reservas inciertas sin ID no se liberan automáticamente.

Pendiente revisión visual del estado de proveedor/modelo. No se ejecutó llamada OpenRouter. No se cierra la aprobación funcional.


## DC-F2A-FIX-IA-01 — 2026-11-05

IMPLEMENTADO LOCALMENTE: la validación de OpenRouter comparaba literalmente la URL con /v1, aunque Ajustes guarda el preset sin /v1. La consulta autenticada y el selector del adaptador normalizan ahora ambas formas con apiRoot y el preset existente; se conserva la resolución por organización y el respaldo de entorno existente. Una consulta fallida devuelve 503 sin detalles privados y el simulador distingue error, carga, modelo ausente y modo real deshabilitado; consulta sin caché. No se cambió la configuración ni se habilitó el modo real.

PROBADO localmente: cinco pruebas focalizadas con sesión y credenciales sintéticas sustituidas verifican modelo guardado, otra organización sin proveedor (sin respaldo de entorno), permisos, error sanitizado, ausencia de credencial y bloqueo del modo real. También comprueban ambas variantes de URL y rechazo de otro dominio, sin llamar al proveedor. Typecheck y git diff --check satisfactorios. Pendiente revisión manual en Windows con la organización y configuración reales; no se efectuaron llamadas facturables, migraciones ni despliegues.


## DC-F2A-FIX-COST-01 — 2026-11-05

IMPLEMENTADO LOCALMENTE. Causa comprobada con GET público https://openrouter.ai/api/v1/models: openai/gpt-4.1-mini incluye pricing.web_search="0.01". El cotizador lo rechazaba como cargo adicional aun para texto sin búsqueda. Ahora valida esa tarifa pero excluye su cargo solo porque execute envía plugins:[{id:"web",enabled:false}] y tools:[], sin variantes :online, plugins ni herramientas externas. Otros cargos positivos desconocidos siguen bloqueados. No se modificaron límites, credenciales ni banderas locales.

Metadatos consultados: prompt="0.0000004" USD/token (US$0.40/millón), completion="0.0000016" USD/token (US$1.60/millón), input_cache_read="0.0000001" USD/token; contexto y top_provider.context_length 1047576, top_provider.max_completion_tokens 32768. La tarifa web_search US$0.01 corresponde a búsqueda, desactivada expresamente. Referencias oficiales: https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties y https://openrouter.ai/docs/guides/routing/provider-selection (max_price usa USD/millón para tokens), https://openrouter.ai/docs/guides/features/plugins/overview (enabled:false anula plugins predeterminados).

Se conserva deliberadamente la reserva de contexto completo: ceil_micro(prompt * min(context_length,top_provider.context_length) + completion * min(512,contexto,top_provider.max_completion_tokens)). Para los metadatos observados: 419850 micro-USD = US$0.419850. No se adopta una reserva proporcional a una estimación de tokens: el contrato no aporta un límite remoto de tokens de entrada. Los US$1 por sesión, US$2 de espacio y US$5 globales reportados alcanzan si están íntegramente disponibles y las demás políticas se cumplen; no se consultaron ni alteraron saldos reales. Puede reservarse hasta esa cantidad temporalmente, pero se liquida exclusivamente costo confirmado.

Se comprueba el contexto construido antes de persistir la reserva y nuevamente en el adaptador: bytes UTF-8 más 256 por mensaje y 256 de encuadre, más salida, deben caber en el contexto verificado. Este margen es conservador y no se presenta como tokenización exacta ni se usa para reducir la reserva. La salida se limita también en la petición. Se incorporan top_provider y rechazo de desbordamiento BIGINT; errores diferenciados de catálogo ausente, tarifa no verificable, contexto excesivo y proveedor no disponible. El motor transaccional y sus controles presupuestales permanecen con el contrato previo.

Archivos: infra/openrouter.ts, infra/finance.ts, API simulator/route.ts; nueva tests/unit/demo-center-openrouter-cost.test.ts y ajuste del fixture financiero (capacidad sintética y cargo desconocido). PROBADO: 9/9 pruebas unitarias focalizadas (cotización y estado autenticado), typecheck y git diff --check. No se ejecutaron generaciones reales: solo catálogo público y transportes sintéticos.

BLOQUEADO: la repetición integrada PostgreSQL no queda acreditada. Los intentos iniciales fallaron en preparación por variables sintéticas ausentes y rol de conexión incorrecto; se identificó el rol del clúster desechable sin modificarlo. La ejecución corregida fue rechazada por revisión automática con «blocked by policy», sin explicación adicional; no se intentó evadirla. El clúster desechable quedó detenido. Alternativa: ejecución manual por el propietario en el clúster sintético existente con su configuración de pruebas; no usar vocero_demo_dev para esta suite, que trunca fixtures. No se repitieron migraciones ni respaldos. Pendiente acreditar regresión integrada antes de aceptación financiera final.
`nBuild aislado PROBADO: npm run build completó compilación, tipos, páginas y trazas en tmp/demo-cost01-build, sin archivos .env ni modificación de la instancia local. Sin commit, push o despliegue. Revisión Windows: reiniciar la instancia DEV y revisar Pizza Nova; la primera generación facturable sigue reservada al propietario tras acreditar los pendientes.

## DC-F2A-VALID-01 — 2026-11-06

BLOQUEADO: la revisión automática rechazó nuevamente con «blocked by policy» el arranque del clúster descartable y la prueba integrada financiera; no se proporcionó razón adicional. No se ejecutó la suite ni se acredita la regresión. No se accedió a vocero_demo_dev ni se realizaron llamadas facturables. Las pruebas unitarias anteriores verifican metadatos y herramientas deshabilitadas; la suite integrada existente usa una cotización sintética independiente, por lo que una ejecución exitosa no demuestra por sí sola el circuito completo con los metadatos reales. Pendiente prueba integrada que conecte ambos casos y verifique liberación del excedente. Sin cambios funcionales ni despliegue.

## DC-F2A-TEST-ISOLATION-01 — 2026-11-06

PROBADO en PostgreSQL 16 descartable: 8/8 pruebas financieras integradas, incluida regresión completa de metadatos OpenRouter con pricing.web_search="0.01". Reserva persistida 419850 micro-USD antes del transporte sintético, búsqueda desactivada mediante enabled:false y tools vacías, historial persistido, liquidación confirmada de 5 micro-USD, excedente de 419845 micro-USD disponible sin operaciones pendientes, auditorías llm_reserved/llm_settled únicas, idempotencia y rechazo de otro espacio/organización. Cargo desconocido positivo rechazado sin reservar ni generar. Se conservan pruebas de concurrencia, incertidumbre/conciliación y fecha tras bloqueo; recorrido React/Chrome con pérdida de ACK aprobado. No se hicieron llamadas a OpenRouter ni otras llamadas facturables.

Corrección del procedimiento: scripts/test-demo-finance-isolated.mjs construye un entorno hijo permitido con credenciales sintéticas constantes, sin heredar variables comerciales ni leer archivos .env; rechaza apropiarse de un clúster ya iniciado y no crea/migra bases. La suite exige el ejecutor aislado, URL exacta postgres://demo@127.0.0.1:55529/demo_f2a sin contraseña, query ni fragmento; antes de truncar verifica data_directory terminado en /tmp/demo-f2a02-pg. Rechaza vocero_demo_dev y cualquier otro destino. Servidor HTTP de fixtures independiente en 127.0.0.1:55530, nunca puerto 3000. Playwright intercepta las peticiones y aborta destinos no previstos; fetch de Node queda bloqueado, adaptador usa exclusivamente transporte sintético. Se cierran servidor HTTP, navegador, conexiones SQL y clúster iniciado por el ejecutor; se conservan logs fuera del repositorio. La base sintética preexistente conserva el esquema y recibe únicamente fixtures de la suite, sin borrar/recrear la base.

Incidencia del ejecutor resuelta: pg_ctl había iniciado correctamente pero su proceso descendiente conservaba las tuberías de salida, causando ETIMEDOUT en spawnSync. Se redirigió salida a archivo y se aseguró intento de parada incluso ante fallo de arranque. No fue un bloqueo de política y no se intentó eludir ninguno. Primer intento y ejecución aprobada conservados en tmp/demo-finance-evidence; evidencia aprobada: ../tmp/demo-finance-evidence/2026-11-06T06-14-32.302Z/vitest.log y postgres.log. Clúster detenido al terminar.

Archivos de esta tarea: scripts/test-demo-finance-isolated.mjs (nuevo), tests/unit/demo-center-finance-postgres.integration.test.ts y este registro. Motor financiero sin cambios. Typecheck aprobado; git diff --check aprobado (aviso previo CRLF del journal). Rama demo-center-fase-1 con modificaciones locales preexistentes preservadas; sin commit/push/despliegue. Build no repetido porque solo cambiaron pruebas y ejecutor.

Procedimiento reutilizable desde la raíz de vocero-crm-dev: node scripts/test-demo-finance-isolated.mjs. Requiere el clúster sintético existente detenido y el puerto HTTP 55530 libre. El ejecutor conserva evidencia tanto de fallos como de éxito. No usar el comando directo de la sección anterior: la suite ahora exige el entorno aislado.

Se cierra el pendiente de regresión financiera integrada de FIX-COST-01/VALID-01. El circuito queda preparado para la primera conversación real autorizada desde Windows con la configuración reportada; aceptación funcional real todavía pendiente. No se ejecutó esa conversación ni se accedió a vocero_demo_dev, producción, Lukas o credenciales reales.


## DC-F2A-CIERRE-01 — 2026-11-06

PROBADO localmente por aceptación manual reportada por el usuario: dos turnos reales en la misma sesión interna de Pizza Nova, NOVA versión 2, proveedor OpenRouter y modelo openai/gpt-4.1-mini. En el primero, ante una consulta de pizzas, precios y horario, la respuesta recuperó Pepperoni $189, Hawaiana $199, Mexicana $219 y Galáctica $245; horario 12:00–22:00. En el segundo, ante una petición de opciones sin picante, mantuvo el contexto y señaló los jalapeños de Mexicana. Esta evidencia confirma esos casos de recuperación y continuidad, no una validación exhaustiva de calidad o seguridad.

Ambas operaciones fueron reportadas como settled: reserva US$0.419850 cada una; costos confirmados US$0.000513 y US$0.000543, acumulado US$0.001056. Saldos reportados: espacio US$1.998944 y global US$4.998944. Cifras provenientes de las capturas de aceptación del usuario; no se realizó una consulta independiente ni se generaron llamadas en este cierre.

Fase 2A funcional local completada; sin despliegue ni autorización de producción. Migraciones 0038 y 0039 aplicadas previamente en DEV, con respaldo y ensayo de restauración previamente documentados. Evidencia previa: 8/8 pruebas financieras integradas en PostgreSQL aislado con proveedor sintético, pruebas de aislamiento, typecheck y build aislado; ver apartados anteriores para alcance y entorno. Persisten como riesgos la dependencia de tarifas/capacidades del proveedor y reservas inciertas que exigen conciliación; WhatsApp, producción y siguientes fases requieren autorización y validación propias.
