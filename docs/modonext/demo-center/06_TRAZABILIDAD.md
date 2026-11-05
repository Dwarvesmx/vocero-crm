# Matriz de trazabilidad y pruebas propuestas

Estado PLANEADO, 2026-11-04. Cada caso usa datos sintéticos y DB/almacenamiento desechables; aserciones en CRM y Nea, incluyendo ausencia de accesos/efectos. Fases: 1 administración, 2 simulación, 3 integración de canal. No son pruebas ejecutadas.

| Requisito | Componente | Fase | Prueba automatizable y resultado esperado |
|---|---|---:|---|
| Espacio y perfil | CRUD/roles/versiones | 1 | Dos espacios, perfiles distintos; usuario ajeno 403/404, versión publicada inmutable; desactivar incrementa generación. |
| KB aislada | documentos, fragmentos, objetos, rutas | 1–2 | Mismo SHA en A/B aceptado independientemente; consultar/preview/borrar ID A desde B denegado; búsqueda A nunca devuelve B ni comercial; credencial sin scope denegada. |
| Un teléfono cambia A→B | ruta, sesión, ingesta | 2–3 | Crear A, mensaje, sustituir por B y enviar otro; IDs y memoria separados, A final, B solo ve B, comercial no ve ambos. |
| Dos teléfonos simultáneos | rutas/locks | 2 | A y B en paralelo, sin intercambio de perfil/mensajes/objetos y una asignación por identidad. |
| Vencimiento/inactividad | sesión/reloj DB | 2–3 | Avanzar reloj controlado sin ejecutar cron; contexto, LLM y salida denegados; ruta bloqueada, no fallback comercial. |
| Revocación/desactivación | ruta/outbox | 2–3 | Revocar antes de reserva → cero llamadas externas; durante `iniciado` → estado incierto/conciliación y sin falsa garantía de cancelación; reactivar no revive sesión. |
| Webhooks duplicados | HMAC/inbox | 3 | Mismo evento antes y después de cambio de sesión conserva asignación inicial, un mensaje y un despacho; firma mala 401 sin efectos. |
| No autorizado / BSUID | autorización | 2–3 | Número no autorizado no inicia demo; BSUID sin vínculo verificable no accede; comportamiento comercial ordinario conservado si no hay ruta bloqueada. |
| Memoria antigua | Nea store/cache | 2 | Misma identidad, dos sesiones y reinicio worker: nueva sesión no recibe memoria/perfil/ficha de anterior o comercial; ID cruzado rechazado. |
| Transferencia humana | handoff/outbox | 2–3 | Pausa humana global prevalece; handoff demo no pausa comercial; aviso solo si autorización vigente; cambios concurrentes no se sobrescriben. |
| Respuesta tardía | scope/generation | 2–3 | Sobre A persistido, sustituir a B, reintentar respuesta de A con IDs válidos: rechazo y cero llamada si no iniciada; no reconstruir con B. |
| Presupuestos concurrentes | buckets/ledger | 2 | N procesos reservan simultáneamente cerca del tope global y por espacio; suma liquidada+reservada no excede límite; duplicado no vuelve a reservar. Timeout conserva incierto; sin tarifa confiable bloquea. |
| Reintentos despacho | outbox/dispatch_inbox | 2 | Caída tras ACK y reinicio: mismo ID/bytes/contexto, una ejecución lógica; mismo ID con hash distinto 409; mensajes nuevos no se mezclan entre ámbitos. |
| Lukas ordinario | ingesta/contexto/salida | 2–3 | Teléfono sin demo sigue flujo existente con misma semántica y handoff; no ve demo; ruta bloqueada no cambia a comercial hasta restitución auditada. |
| Sesiones/cuotas | ledger/administración | 1–2 | Dos sesiones compiten por última cuota, solo una inicia; mensaje duplicado no cuenta; excepción auditada, caducada se rechaza y no evade global. |
| Permisos y trazabilidad | API/admin audit | 1–2 | Identificadores alterados o admin de otra org rechazados; transacción fallida sin auditoría parcial; log no contiene secretos ni texto. |
| Rollback / migraciones | esquema/feature flag | 1–3 | Migrar copia sintética de esquema previo, conservar filas/índices; rollback de código solo con versión compatible y bandera apagada, sin exposición de registros demo. |
| Efectos colaterales | herramientas/seguimiento | 2 | Agenda/ficha/reset/seguimiento y rutas heredadas rechazan scope demo salvo implementación explícita; un turno concurrente no modifica objetos comerciales. |
| Confidencialidad | bandeja/SSE/export/medios | 2–3 | Cada superficie comercial excluye contenido demo; rol demo sin permiso no puede leer otra sesión; descarga por ID manipulado falla. |

| Modularidad / extracción | dominio, puertos, adaptadores | 1–2 | Regla de imports impide dependencias cíclicas o infraestructura en dominio; otro módulo no accede tablas demo directamente; adaptador falso cumple mismo contrato. |
| Compatibilidad de versiones | CRM/Nea despacho | 2–3 | Contrato legado comercial funciona; capacidad demo ausente deniega sin fallback; versiones y sobre inconsistente rechazados. |
| Retorno a Lukas / mensajes retrasados | ruta, cuarentena, UI, outbox | 2–3 | Cierre/vencimiento/revocación bloquean; mensajes blocked nunca llegan a Lukas; restitución solo admin tras conciliar iniciado/incierto; simultaneidad, evento retrasado ambiguo y reintento de generación anterior quedan retenidos. |
| Bloqueo sin descuido | cola administrativa | 1–2 | Reloj avanza hasta revisión; alerta interna aparece y se repite idempotentemente sin cambiar ruta; rol sin permiso no restituye. |
| Vínculo BSUID | autorización y binding | 1–3 | Identidad igual a teléfono solo cuando tipo y normalización son fiables; BSUID sin prueba, cuenta ajena, prueba vencida/revocada y colisión denegados; asociación demostrada permite sesión única. |
| Sesiones simultáneas | concurrency_bucket | 2 | N transacciones compiten por última plaza global/espacio; solo una gana, terminar dos veces libera una vez y expiración se reconcilia sin cron. |
| Límites separados | ledger sesión/espacio/global | 2 | Entradas, respuestas, inicios y llamadas tienen claves y contadores separados; duplicados sin doble conteo, salidas canceladas siguen contadas, umbral cualquiera bloquea sin afectar comercial. |
| Presupuesto por sesión | reservas | 2 | Tope de sesión se respeta aunque espacio/global tengan margen; timeout conserva reserva en ventana original y reintento facturable exige reserva propia. |
| Webhook y escritura cruzada | firma/cuenta/scope | 3 | Firma mala o cuenta ajena no modifica rutas, sesiones ni objetos; actor autorizado de A no puede escribir en B; app local con proveedores simulados. |

## Evidencia de Fase 1

| Grupo | Estado DEV | Evidencia |
|---|---|---|
| Espacios, perfiles, permisos y auditoría | PROBADO | API administrativa con PostgreSQL, dos ámbitos, versiones, rechazo de escrituras cruzadas y versión obsoleta. |
| KB y separación comercial | PROBADO | Mismo SHA, documentos distintos, fragmentos cruzados rechazados y regresión comercial con formatos soportados. |
| Autorizaciones, límites y excepciones | PROBADO | Alta con consulta enmascarada y revocación, validación de contadores, política global con conflicto de versión y excepción temporal. |
| Migraciones | PROBADO | Aplicación en PostgreSQL 16.15 y rollback transaccional desde 0033 con fixture. |
| Interfaz y arquitectura | IMPLEMENTADO LOCALMENTE | Compilación Next y typecheck. Pendientes recorrido autenticado en navegador y prueba de puertos con adaptadores falsos. |
| Ejecución, canal y costes reales | PLANEADO | Fases 2 y 3. |

[Registro de Fase 1](07_FASE_1_DEV.md).
