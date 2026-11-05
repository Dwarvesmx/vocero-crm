# Demo Center · Fase 1 en DEV

2026-11-04. Rama local `demo-center-fase-1` sobre `5263953`. Implementación administrativa local con verificación focalizada. Sin publicación ni despliegue.

## Revisión local

1. Preparar PostgreSQL 16 desechable en loopback y un directorio de medios vacío. Usar un entorno de proceso con credenciales exclusivamente sintéticas para la app, `DATABASE_URL` local, `MEDIA_STORE=local`, `MEDIA_DIR` de prueba y `APP_BASE_URL=http://localhost:3000`. Usar las variables requeridas de `.env.example` sin copiar configuración productiva.
2. Aplicar las migraciones con `pnpm db:migrate`, iniciar `pnpm dev` y crear el primer propietario en `/register` de esa base desechable.
3. Abrir `/demo-center` como propietario. Crear dos espacios con plantillas ficticias. Publicar dos versiones en uno, activar su configuración y consultar la auditoría. Cargar el mismo TXT en ambos espacios y comprobar resultados separados al buscar. Registrar y revocar un teléfono ficticio, y editar límites y excepciones. La política global se configura desde la vista sin un espacio seleccionado.
4. Las pruebas automatizadas llaman a los handlers con una sesión simulada. La navegación de navegador con Better Auth real queda pendiente de revisión manual.

## Archivos y decisiones

- `src/server/demo-center/` contiene la entrada pública del módulo, validaciones de dominio y adaptadores Drizzle y KB. La pantalla y las rutas administrativas usan la entrada pública. El módulo reutiliza permisos, cifrado y almacenamiento del CRM.
- `src/app/(app)/demo-center/`, `src/components/demo-center/`, `src/app/api/demo-center/` y `src/lib/nav.ts` contienen pantalla, navegación y API administrativa.
- `src/lib/db/schema.ts` y migraciones 0034 (fundamentos), 0035 (KB y verificación de ámbito), 0036 (estructuras de ejecución) y 0037 (excepciones) con snapshots y journal. 0035 sustituye el índice de SHA por únicos parciales comercial y demo dentro de la transacción. Los originales usan IDs opacos separados con el almacenamiento existente.
- Los lectores y mutadores comerciales de KB filtran explícitamente el ámbito comercial. La administración de teléfonos exige formato internacional con prefijo y muestra solo el sufijo. El BSUID queda como estructura para una vinculación verificada futura. Configurar un espacio activo solo cambia su estado administrativo.
- Las políticas global, por espacio y por sesión almacenan límites separados. Las excepciones son registros auditados, acotados por monto y vencimiento. La aplicación efectiva de cuotas corresponde a Fase 2.

## Evidencia

- PostgreSQL 16.15 local, clúster nuevo `tmp/demo-center-f1-pg`, puerto 55489. Cadena completa hasta 0037 aplicada en dos bases sintéticas. Rollback transaccional ensayado desde 0033 con fixture de organización y verificación de que desaparecen las estructuras recién creadas. No equivale a un downgrade de una base que ya confirmó las migraciones.
- 61 pruebas focalizadas en ocho archivos. Incluyen API administrativa con PostgreSQL, versiones y auditoría, permisos, mismo SHA, fragmento cruzado rechazado por PostgreSQL, exclusión comercial, teléfonos, límites, excepciones, regresión comercial de KB con PDF/DOCX/TXT, perfil, navegación, onboarding e ingesta/ruta Zernio. No hubo llamadas externas.
- Typecheck, compilación Next y comprobación de whitespace ejecutados en DEV. La prueba de PostgreSQL exige explícitamente base, clúster y medios locales de pruebas.

## Continuidad

Fase 2 requiere cerrar la cobertura de ámbito para todas las superficies de mensajes y despachos antes de crear filas demo o en cuarentena, terminar el contrato de metadatos de outbox/recepción y su persistencia en Nea, y verificar reservas, revocación y carreras contra proveedores simulados. Los tipos y tablas reservados carecen de productores en Fase 1. Quedan por verificar los contratos de puertos con adaptadores falsos y la regresión de interfaz con una sesión real local. La vinculación BSUID, el orden de eventos externos y la prueba supervisada del canal corresponden a Fase 3.

## DC-F1-FIX-01 — 2026-11-04

El propietario reportó acceso autenticado, creación y persistencia de un espacio ficticio en Windows. La comprobación fue informada por el propietario.

- DC-F1-001: el contenedor principal app-shell usa overflow-hidden y Demo Center carecía de un área de desplazamiento. page.tsx añade scroll vertical local con foco por teclado.
- DC-F1-002: los formularios hermanos de espacio y límites usaban el mismo UUID como clave. admin.tsx distingue las claves por función y ámbito, y reinicia también el formulario de excepciones al cambiar de ámbito.
- DC-F1-003: se amplió el área de trabajo, se acotó la columna lateral y se añadieron enlaces de sección accesibles. Los formularios permanecen montados durante la navegación por secciones. knowledge.tsx ajusta su ancho y destino del enlace.
- Evidencia local: vitest run tests/unit/nav.test.ts tests/unit/onboarding-page.test.ts, 16 pruebas aprobadas. tsc --noEmit, next build y git diff --check aprobados.
- Pendiente: comprobar en Windows con sesión autenticada el scroll, las teclas, la selección de espacios, la ausencia de advertencias React y la distribución móvil y escritorio. No se accedió a la base local del usuario. El cambio de un espacio a otro reinicia los formularios del ámbito anterior, por lo que conviene guardar antes de cambiar.

## DC-F1-UI-02 — 2026-11-04

Las anclas se sustituyeron por pestañas con paneles montados y atributo hidden, navegación por flechas, Inicio y Fin, y estado seleccionado accesible. Conocimiento quedó dentro del área administrativa. La configuración global tiene entrada propia, separada de la creación y de cada espacio. Los formularios conservan sus valores al cambiar de pestaña. Los enlaces del panel lateral solicitan confirmación ante cambios y el navegador advierte al recargar o cerrar. Como medida conservadora, la advertencia puede mantenerse incluso después de guardar, para no perder borradores de otras secciones. La navegación por historial del navegador dentro de la aplicación no quedó verificada.

Archivos modificados: page.tsx, admin.tsx, knowledge.tsx y tests/unit/demo-center-tabs.test.ts. Pruebas: dos casos de renderizado estático de pestañas y ámbito global, 16 regresiones de navegación/onboarding, tsc --noEmit, next build y git diff --check aprobados. Pendiente revisar en Windows la interacción real, borradores, historial, teclado, scroll y pantallas pequeñas.

## DC-F1-CIERRE-02 — 2026-11-04

El propietario reporta revisión autenticada local de espacios, perfiles, documentos, autorizaciones, límites y auditoría. Esa evidencia es comunicada por el propietario.

KB-01: el buscador usaba un INNER JOIN con documentos y omitía entradas manuales. Se añadieron resultados manuales con búsqueda léxica y filtros de organización y espacio, conservando el filtro documental de habilitación. Prueba PostgreSQL 16.15 en clúster desechable nuevo, datos sintéticos y puerto 55519: búsqueda manual y documental, aislamiento de dos espacios y dos organizaciones, y exclusión de documento deshabilitado aprobados.

UI-03/UI-04: se compara cada formulario persistente contra su referencia, excluyendo la búsqueda. Guardado exitoso actualiza únicamente la referencia del formulario enviado; la captura de teléfono y entrada manual se limpia si no cambió mientras se guardaba. Se conservan otros borradores y se muestran mensajes por operación. Falta verificar interactivamente en navegador los escenarios de edición, reversión, guardado y navegación.

LIM-01/02/03: duración e inactividad se presentan en minutos, presupuestos en USD con conversión entera a micro-USD y ventanas en horario local. Se comprueban fechas y duración. La semántica operativa de cero y presupuesto opcional continúa pendiente, según ARQ-01; Fase 2 no se activa. ASI-01 y AUD-01 mejoran el historial de versiones y la presentación de acciones y fechas. Los campos obligatorios de límite se identifican en la ventana.

Archivos: src/server/demo-center/infra/knowledge.ts, src/components/demo-center/admin.tsx, src/components/demo-center/knowledge.tsx, src/components/demo-center/format.ts, tests/unit/demo-center-format.test.ts y tests/unit/demo-center-knowledge-cierre-postgres.integration.test.ts. Pruebas DEV: integración PostgreSQL aislado 1/1 y 19/19 de pestañas, perfil y extracción documental. Pruebas de conversión de USD y hora local: 2/2. Typecheck y git diff --check aprobados. La compilación Next llegó a typecheck pero falló al recopilar páginas por ausencia de una entrada en .next, incluso al repetirla secuencialmente. No se pudo asegurar que el directorio de build estuviera aislado de la instancia local. Build pendiente. Pendiente revisión manual de cambios sin guardar, conversión de fechas al cambiar zona horaria y validaciones en móvil. No se usó la base del propietario.

## DC-F1-FIX-03 — 2026-11-04

UI-03: al serializar formularios, FormData produce para el selector vacío un File sin nombre cuya fecha puede variar entre lecturas. Por eso un cambio en la búsqueda volvía a comparar el formulario de archivo y detectaba una diferencia ficticia. El campo temporal ahora no invoca el detector y la serialización representa un archivo vacío de forma estable. Se conservan las referencias independientes por formulario.

Prueba de interacción real con Chrome headless, componentes reales, datos sintéticos y transporte simulado: selección sin cambios, escribir, borrar y ejecutar búsqueda, edición real, restauración, guardado y borrador de otra sección aprobados. Guion scripts/test-demo-drafts.mjs. Regresión focalizada: 9 pruebas de pestañas, formato y extracción documental aprobadas. Typecheck aprobado. La prueba PostgreSQL de recuperación y aislamiento de DC-F1-CIERRE-02 se conserva como evidencia anterior, ya que esta corrección no modifica su lógica.

Build: se observó un proceso next dev activo en el mismo repositorio, cuyo directorio .next coincide con el usado por next build. Esto representa una colisión posible y consistente con los manifiestos ausentes observados anteriormente, pero no demuestra por sí solo la causa histórica de cada fallo. Una copia aislada del código sin .env ni datos, con node_modules enlazado y sin otro proceso sobre su propio .next, compiló correctamente en dos ejecuciones consecutivas. No se detuvo el proceso del usuario ni se limpió su .next.
