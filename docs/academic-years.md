# Años lectivos de AC Edunity

Implementado y verificado el 15 de octubre de 2026.

## Arquitectura

- `user_academic_years`: un ciclo por usuario/inicio; etiqueta y fechas generadas en PostgreSQL, XP y racha independientes.
- `user_academic_year_preferences`: última selección y último ciclo actual reconocido. Se mantiene separada de las preferencias globales existentes.
- `academic-years.js`: fecha central en America/Guayaquil, estado del selector, guardas de cuenta/ciclo y operaciones académicas filtradas en servidor.
- `academicTable()`: SELECT/UPDATE/DELETE incluyen año y propietario; INSERT/UPSERT asignan el año y propietario. Los hijos grade_items se protegen mediante su padre y RLS.
- Se conservaron las FKs existentes a materias/proyectos para no romper los embeds PostgREST de los workers.
- Los hijos almacenan un año indexado derivado del padre. Un trigger comprueba año, dueño y relaciones; el año de un registro existente no se puede reasignar. Esto evita divergencias sin consultas por tarjeta.
- Caché académica local: usuario + UUID de año. Los extras anteriores solo se leen para 2026–2027; el perfil y preferencias de experiencia siguen siendo globales por cuenta.
- Al cambiar se limpia el workspace visible, se invalidan respuestas anteriores y se recargan los módulos en paralelo. Se conserva la sección actual. No se cierra la sesión ni se recarga el navegador.

## Migraciones aplicadas en Supabase

1. `20261015130622_add_academic_year_management.sql`
2. `20261015132831_optimize_academic_year_indexes.sql`

La primera crea tablas, RLS, funciones, triggers, NOT NULL y backfill. La segunda añade cobertura en el orden de las FKs, conservando los índices orientados a consultas por usuario.

El backfill asignó 2026–2027 a **9 cuentas** y **200 registros** existentes. No se regeneraron UUID, no se copiaron materias ni se eliminaron registros. Para evitar efectos laterales de recordatorios/timestamps, los triggers de usuario se suspendieron únicamente durante los UPDATE de backfill de la migración.

| Tabla | Registros asociados | Año nulo |
| --- | ---: | ---: |
| subjects | 18 | 0 |
| tasks | 4 | 0 |
| events | 1 | 0 |
| attendance | 1 | 0 |
| resources | 3 | 0 |
| grades | 17 | 0 |
| grade_items | 22 | 0 |
| recent_activity | 0 | 0 |
| internal_notifications | 6 | 0 |
| user_activity_events | 107 | 0 |
| evaluations | 3 | 0 |
| projects | 1 | 0 |
| goals | 0 | 0 |
| project_stages | 1 | 0 |
| project_subtasks | 3 | 0 |
| google_calendar_manual_links | 0 | 0 |
| academic_notification_states | 13 | 0 |

Se compararon huellas MD5 de la representación completa de cada fila antes/después, excluyendo solo el nuevo campo academic_year_id: **todas coincidieron**. Profiles, user_preferences y los cuatro ledgers de correo también quedaron idénticos. Relaciones padre/hijo discrepantes: **0**.

## Seguridad y calendario

RLS de años y selección usa `(select auth.uid()) = user_id`. Las FKs compuestas vinculan año + propietario. Los triggers validan materias, proyectos, etapas, subtareas, tareas vinculadas y fuentes de avisos. No se añadió acceso anónimo ni claves de servidor al cliente.

El ciclo cambia el **1 de abril a las 00:00 de America/Guayaquil**. Enero, febrero y marzo siguen en el iniciado el abril anterior. El fin académico es el último día de febrero, incluidos años bisiestos. Marzo no crea un ciclo nuevo. El RPC idempotente inicializa el año al entrar y supera una selección antigua cuando detecta un ciclo nuevo; después respeta la selección manual de historial. En una sesión abierta se comprueba al llegar la medianoche local y al volver a la pestaña; una operación/formulario activo pospone de forma segura el cambio.

Los años anteriores conservan sus acciones de edición. No se crean ciclos anteriores a 2026 ni futuros desde el cliente.

## Pruebas

- 28 pruebas Node: aislamiento del helper, límites de abril/Ecuador, bisiestos, respuestas obsoletas, rollback de selección, cambio de cuenta y regresiones existentes de avisos, horas y Google Calendar.
- PostgreSQL local desechable con snapshot del esquema real: backfill, datos preservados, dos roles autenticados, RLS, relaciones cruzadas rechazadas, hijos derivados, calificaciones independientes y avisos creados con el mismo payload del worker.
- Simulación local de abril de 2027: año nuevo vacío, XP cero, cambio a historial y vuelta, selección tras recarga, creación de materia/tarea y UUID de año correcto.
- Navegador Chrome + PostgreSQL local: formularios reales de Materia y Tarea, selector, recarga y las 13 secciones autenticadas; 1440x900, 1024x768, 768x1024, 430x932, 390x844 y 360x800; oscuro/claro, sin errores nuevos de consola ni overflow del control.
- Supabase real: backfill aplicado, 0 nulos, 0 relaciones discrepantes y comprobación de RLS con rol authenticated en transacción revertida. No se crearon usuarios ni datos académicos de prueba en producción.
- Validación sintáctica de los cinco JS modificados y git diff --check.

Las pruebas E2E de CRUD/recarga/cambio de ciclo se hicieron contra PostgreSQL local, no mediante contraseñas reales de dos usuarios de producción. No se enviaron correos de prueba.

## Recordatorios

Fuentes desplegadas verificadas iguales al repositorio:

| Worker | Versión | Estado |
| --- | ---: | --- |
| task-reminders | 3 | ACTIVE |
| event-reminders | 2 | ACTIVE |
| evaluation-reminders | 2 | ACTIVE |
| project-reminders | 4 | ACTIVE |

Los cuatro cron siguen activos con `*/15 * * * *`; última ejecución observada: succeeded. No se modificaron workers, programación, fechas, claves de idempotencia ni filas de deliveries. Los workers continúan seleccionando por fecha real, independientemente del año que el usuario esté consultando.

Advisors: sin nuevas incidencias de seguridad y sin FKs nuevas sin índice. Permanecen avisos previos de protección de contraseñas filtradas desactivada y optimizaciones de políticas/índices antiguos, fuera de este alcance. [Referencia de seguridad de contraseñas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Ejecutar pruebas locales

`node --test tests/academic-years.test.cjs tests/academic-notifications.test.cjs tests/time-consistency.test.mjs tests/google-calendar-manual.test.mjs`

Las pruebas PostgreSQL necesitan `@electric-sql/pglite@0.5.10` en NODE_PATH; las de navegador también Playwright y un Chrome local. El snapshot de `tests/fixtures/academic-years-before.sql` solo contiene esquema, sin datos de usuarios.

`node tests/academic-years-migration.test.cjs`

Servir el repositorio localmente y definir TEST_BASE_URL, TEST_BROWSER y opcionalmente TEST_SCREENSHOT_DIR:

`node tests/academic-years-browser.cjs`

## Caché

Todos los scripts modificados y los nuevos recursos usan `20261015-academic-years-v1`. style.css, auth-ui.css, settings.css y time-utils.js conservaron sus versiones porque no cambiaron.
