# Configuración WhatsApp Zernio V1

En Configuración → WhatsApp el propietario puede seleccionar la vista Meta/Zernio. La selección visual no cambia el proveedor activo; el botón de activación/desconexión sí lo cambia. La pantalla Meta y sus rutas se conservan.

Zernio permite consultar cuentas usando una API key (nunca se devuelve completa), seleccionar explícitamente una cuenta WhatsApp activa identificada como ModoNext, confirmar su accountId, guardar cifrado y comprobar conexión/webhook por lectura. Cuentas sin nombre/usuario ModoNext y GH Inversiones están excluidas; renombrar correctamente la cuenta en Zernio si no aparece, sin confundir un profileId con accountId.

Guardar siempre deja enabled=false. Solo una activación explícita utiliza el canal; Lukas conserva su interruptor y banderas independientes, apagados en este despliegue. La desconexión solo desactiva el proveedor local, conserva credenciales y no desvincula WhatsApp Business ni modifica Meta. Una solicitud externa iniciada no es cancelable.

El registro del webhook es otra operación explícita, con confirmación de cuenta. Incluye message.received/message.sent, secreto generado y cifrado en servidor, HMAC-SHA256 y filtro accountIds exclusivo. Reutiliza solo el webhook con URL, nombre de instancia y cuenta exactos; conflictos no se sobrescriben. Un advisory lock PostgreSQL serializa registros. Antes del HTTP se persiste webhook_pending=true: tras timeout/reinicio no se vuelve a crear sin comprobar si apareció el webhook propio. Probar conexión concilia el estado si ya existe. Si permanece incierto y no aparece, revisar en el panel de Zernio; no reiniciar el indicador a ciegas. No se ha registrado ningún webhook real durante desarrollo/verificación.

Migraciones aditivas 0029_easy_bucky (enabled=false) y 0030_lucky_eternals (webhook_pending=false). No eliminan información. El migrador existente las aplica al arrancar. Reversión a imagen anterior: establecer primero ZERNIO_WHATSAPP_ENABLED=false, detener cualquier entrada autorizada y evaluar envíos iniciados; conservar columnas y datos. La imagen anterior no conoce enabled, por lo que no debe revertirse con la bandera global true si hay credenciales guardadas. No hay downgrade SQL destructivo.

La bandera ZERNIO_WHATSAPP_ENABLED habilita la disponibilidad del canal en la instalación; enabled controla cada conexión. Los demás flags ZERNIO_NEA_* permanecen false/ausentes. Configuración operativa cifrada en la tabla existente, sin secretos en Git.

Contratos reutilizados: transporte zernioFetch, cuentas y fetchZernioWebhooks; documentación del proveedor https://docs.zernio.com/webhooks y https://docs.zernio.com/webhooks/inbox. No se modifica Nea ni el motor de colas.
