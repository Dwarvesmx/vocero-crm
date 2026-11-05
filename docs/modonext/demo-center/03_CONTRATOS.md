# Contratos CRM / Nea V1

Estado PLANEADO, 2026-11-04. IDs opacos `string` de 1–128 caracteres; fecha ISO 8601 UTC; importes enteros micro-USD en decimal serializado como string (sin redondeo ni pérdida JS). Campos obligatorios, desconocidos rechazados en v1; verificar longitud y pertenencia en servidor. El contrato nuevo es aditivo y la ruta comercial histórica no cambia. La autenticación de servicio y HMAC de despacho existentes se conservan; ser un servicio autenticado no autoriza libremente una sesión.

```ts
type Scope = {kind:'demo'; organizationId:string; spaceId:string; sessionId:string; conversationId:string; authorizationId:string; routeGeneration:number; profileVersionId:string};
type DemoDispatch = {contractVersion:1; dispatchId:string; scope:Scope; expiresAt:string; visitor:{contactId:string; channel:'whatsapp'; identity:string}; messageIds:string[]; messages:Array<{id:string; text:string}>};
type DemoResponse = {contractVersion:1; dispatchId:string; responseId:string; scope:Scope; text:string; handoffReason?:string};
type KnowledgeQuery = {contractVersion:1; dispatchId:string; scope:Scope; query:string; limit:number};
type OutputDecision = {allowed:boolean; code:'ok'|'expired'|'revoked'|'superseded'|'disabled'|'unauthorized'|'handoff'|'window_closed'|'quota_exceeded'|'conflict'; reservationId?:string};
```
```python
from typing import Literal, TypedDict
class DemoScope(TypedDict):
    kind: Literal['demo']
    organizationId: str
    spaceId: str
    sessionId: str
    conversationId: str
    authorizationId: str
    routeGeneration: int
    profileVersionId: str
```

El sobre de despacho existente conserva organization/conversation/contact/messages y firma HMAC; `demo` contiene Scope y versión; `DemoDispatch` muestra la proyección lógica, no reemplaza los campos legados. Persistir bytes canónicos firmados o snapshot inmutable antes del primer intento: mismo `dispatchId`, bytes y hash en reintentos; el agrupamiento y mensaje nuevo generan otro despacho. El ACK de Nea solo sigue a persistencia de sobre íntegro y deduplicación `(organizationId,dispatchId)`; mismo ID/cuerpo distinto es 409 y alerta. CRM entrega versión 1 solo tras capacidad explícita de Nea; sin capacidad, demo queda bloqueada, jamás degradar a Lukas. Despacho antiguo sin `demo` sigue comercial y no accede a mensajes demo. En Nea `dispatch_inbox`, `pending_send` y trabajo de fondo preservan el scope íntegro; reintentos no reconstruyen contexto desde la asignación actual.

1. **Espacio**: `{id,organizationId,name,status,generation,limitsVersion}`; draft→active→disabled; reactivación explícita aumenta generation, no revive sesiones. Admin con permiso de organización, validación de versión optimista; conflictos 409.
2. **Perfil**: `{id,spaceId,version,name,tone,instructions,escalationRules,greeting,role,tools}`; versión publicada inmutable, edición crea otra; sesión fija versión. Herramientas son intersección de política segura demo y perfil, no permisos concedidos por el modelo.
3. **Sesión**: `{id,scope,state,startedAt,expiresAt,idleDeadline,limitsSnapshot}`. active→expired/revoked/superseded/closed; estados finales irreversibles. Cierre, vencimiento o revocación bloquean la ruta; sustitución la bloquea salvo instalación atómica de una sesión sucesora válida. Comprobar reloj DB en cada puerta, no confiar en cron.
4. **Autorización telefónica**: `{id,spaceId,channel,phone,state,expiresAt,version}`; teléfono canónico normalizado, visualización restringida y datos minimizados; active→revoked, reautorizar con nueva versión. Con vínculo BSUID desconocido, denegar.
5. **Conversación/contexto**: Nea pide por `dispatchId` y Scope, no identidad; CRM verifica correspondencia de todos los IDs, vigencia y mensaje. Responde únicamente perfil fijado, mensajes de sesión, datos mínimos de visitante y reglas; nunca ficha, agenda, notas, historial ni KB comercial. No exponer teléfono fuera de necesidad de transporte. Sin fallback; 404 genérico ante ID ajeno, 409/410 ámbito inválido o vencido.
6. **Despacho**: como arriba; crearlo en transacción con el mensaje y ámbito seleccionado, firma y ACK durable. Falla transitoria 503 con reintento; dato inválido 422 sin reintento; sesión revocada descarta ejecución y salida.
7. **Respuesta**: `DemoResponse`; `responseId` generado y persistido antes del primer intento; CRM comprueba alcance, asociación a despacho y contenido, deduplica por `(org,responseId)` con hash de solicitud. Mismo ID/diferente contenido 409; devolución exitosa solo confirma aceptación durable, no entrega WhatsApp. Nea conserva propósito de handoff y scope en `pending_send`.
8. **KB**: consulta `KnowledgeQuery` por servicio autenticado y despacho vigente; servidor deriva org/space desde sesión verificada, no confía en scope del cliente. Respuesta `{chunks:[{documentId,chunkId,text}], truncated:boolean}` máximo 6 y tamaño acotado; falla cerrada, no KB comercial. Documento listo y habilitado, ambos filtros de espacio en documento y fragmento.
9. **Salida**: decisión OutputDecision bajo bloqueo transaccional inmediatamente antes de `retenido→iniciado`; comprobar sesión, generación, autorización, espacio, control humano, cuenta/hilo, ventana, límites y deduplicación. Incierto no se reenvía ciegamente. Ver límite de cancelación en 04.
10. **Límites/consumo**: `{scope,windowStart,windowEnd,maxConcurrentSessions,maxSessionsStarted,maxInboundMessages,maxAssistantResponses,maxProviderCalls,budgetMicroUsd,maxDurationSeconds,maxIdleSeconds}`; operación `{operationKey, reservationMicroUsd, actualMicroUsd?, status}`. 429 `quota_exceeded`, 503 si contabilidad/precio no confiable; reservar antes de proveedor, liquidar una vez; excepciones solo admin auditado, acotadas por monto y vencimiento.
11. **Revocación/vencimiento**: con bloqueo de ruta/sesión, incrementar generation, fijar estado final y bloquear ruta, salvo sustitución atómica por una sesión sucesora válida; cancelar pendiente/retenido, indicar descarte a workers y revalidar antes de efectos. Ya iniciado queda incierto/conciliación según transporte. Handoff no puede revivir sesión.
12. **Auditoría**: `{actorUserId,action,targetId,previousVersion,newVersion,reasonCode,occurredAt,requestId,result}` para cambios, excepción, revocación y restitución comercial; transaccional, sin contenido ni credenciales. Acceso administrativo por sesión, membresía y permisos actuales; mutaciones con protección CSRF/origen existente, autorización a nivel espacio y versión.

Errores 401 servicio/sesión inválidos, 403 rol insuficiente, 404 recurso ajeno/no encontrado, 409 contexto obsoleto o idempotencia conflictiva, 410 vencido, 422 contrato inválido, 429 cuota, 503 dependencia insegura; no exponer datos de otro espacio. `responseId`, `dispatchId` y `operationKey` no son credenciales. Fallos antes de confirmar transacción se reintentan con la misma clave; incertidumbre externa se concilia, no se repite a ciegas.

## Identidad y retorno comercial

Resolución propuesta: `{organizationId, accountRef, channel, receivedIdentity:{kind:'phone'|'bsuid', value:string}, eventId}` procede solo del evento autenticado. Resultado `{decision:'demo', authorizationId, bindingId?, sessionId, routeGeneration}` o `{decision:'commercial'|'blocked'}`; una identidad ambigua, vínculo inválido/revocado/expirado o cuenta distinta nunca produce `demo`. El servidor normaliza con las reglas del canal, busca autorización activa por org/espacio y compara teléfono solo cuando el tipo fue acreditado; BSUID requiere `demo_identity_binding` verificado con evidencia independiente fiable asociada a la cuenta. Un ID aportado por interfaz, contacto, nombre o modelo no prueba vínculo. Si no hay mecanismo fiable para demostrarlo, esa identidad queda bloqueada para demo, sin cambiar la ruta comercial previa por mera falta de coincidencia; una identidad ya en ruta demo/bloqueada permanece bloqueada.

Procedimiento futuro: administrador con permiso registra teléfono canónico y espacio en UI; solicita al visitante iniciar contacto por el canal existente; UI muestra identidad observada enmascarada y estado pendiente. Verifica la asociación mediante evidencia fiable procedente del proveedor o comprobación fuera de banda autorizada y documentada; confirma vínculo en UI con actor, método y vigencia; sistema valida cuenta, autorización y unicidad, luego permite crear sesión. Nunca hacer prueba real en ARQ-01. Sin evidencia fiable no activar; no inferir del contenido del mensaje ni del hecho de compartir contacto CRM. Los valores concretos y el método de verificación del proveedor deberán validarse en Fase 3.

Acción `restoreCommercial(routeId,expectedGeneration,reason)` solo para administrador con permiso de organización; devuelve nueva generación y punto de corte durable. Bloquea ruta, sesión y outbox; exige ausencia o conciliación explícita de trabajo externo iniciado/incierto, cancela pendientes y conserva todo mensaje `blocked` en cuarentena. La restitución afecta solo eventos inequívocamente posteriores al corte; no retransmite mensajes previos ni crea un turno con ellos. Si el orden de evento es incierto, cuarentena y revisión humana. Peticiones duplicadas con misma clave y parámetros devuelven resultado anterior; generación obsoleta 409. Historial comercial sigue filtrado por ámbito. Auditoría atómica registra actor, motivo, generación y resultado, sin texto/teléfono.
