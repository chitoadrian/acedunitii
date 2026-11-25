# Piloto privado de Edunity Exam

Estado: código en `codex/edunity-exam-autopilot`. Sin despliegue.

## Acceso

La migración `20261125010000_private_exam_access.sql` crea `edunity_feature_access` sin filas iniciales. Ningún estudiante obtiene acceso por defecto. El cliente solo puede leer su propia habilitación; no puede concedérsela. `exam_materials` y `exam_attempts` tienen RLS activa y no conceden acceso al cliente. La función `edunity-exam` comprueba el JWT con Supabase Auth y la habilitación antes de cada operación. Toda lectura o escritura de intentos incluye el ID del usuario autenticado.

Tras revisar y autorizar el despliegue, aplicar primero la migración, después desplegar `edunity-exam` y finalmente habilitar **solo** el UUID de la cuenta de prueba confirmada:

```sql
insert into public.edunity_feature_access (user_id, exam_enabled, autopilot_enabled)
values ('<UUID_VERIFICADO_DE_LA_CUENTA_DE_PRUEBA>', true, false)
on conflict (user_id) do update
set exam_enabled = excluded.exam_enabled,
    autopilot_enabled = excluded.autopilot_enabled;
```

El UUID debe comprobarse en Supabase Auth antes de ejecutar el cambio. No se habilita Autopilot en esta fase.

## Flujo de Exam

- Se admiten hasta tres fotografías JPG, PNG o WebP de 3 MB cada una, o PDF de hasta 5 MB. Para PDF se procesan las primeras tres páginas.
- Los PDF con texto seleccionable se leen en el navegador con PDF.js. Las imágenes y páginas escaneadas se envían una a una a Groq con `qwen/qwen3.8-27b`.
- Las imágenes y los PDF no se guardan. El estudiante revisa y puede editar el texto reconocido antes de generar el examen. El texto aprobado, las preguntas, los intentos y la calificación se guardan en Supabase.
- La generación usa `openai/gpt-oss-120b` con el secreto `GROQ_API_KEY` ya utilizado por Tutor IA. Produce de 3 a 8 preguntas cerradas. La corrección es determinista y las explicaciones provienen de la generación.
- Las respuestas correctas no se entregan al cliente antes de corregir. El historial muestra la calificación y los temas fallados.

## Comprobaciones antes de publicar

1. Confirmar que la cuenta de prueba tiene correo verificado y contraseña propia.
2. Confirmar que la cuenta real de Groq permite el modelo de visión y revisar sus límites gratuitos. Una imagen usa 2048 tokens de entrada según la documentación de Groq.
3. Validar con un material ficticio sin datos personales: foto impresa, PDF digital y PDF escaneado; revisar la transcripción antes del examen.
4. Verificar que la cuenta de prueba ve Exam, genera y corrige un simulacro, y recupera su historial desde el celular.
5. Verificar con otra cuenta **sin consultar sus datos académicos** que no aparece el menú y que una llamada directa a `edunity-exam` recibe `403`.
6. Comprobar que la vista del Tutor, la Mochila y la navegación actual siguen funcionando en temas claro y oscuro.

No aplicar migraciones ni desplegar funciones en el proyecto activo sin autorización de publicación. Para deshabilitar el piloto después de publicarlo, poner `exam_enabled = false` para el usuario de prueba; el backend dejará de aceptar nuevas llamadas.

## Reversión

El corte inmediato es `supabase/rollback/20261125010000_disable_private_exam.sql`. Desactiva las dos banderas y la función empieza a responder `403` sin borrar el historial. A continuación, restaurar en el sitio la versión anterior de `main` y comprobar el inicio de sesión, el Tutor y la Mochila. Si es necesario, retirar el despliegue de `edunity-exam`; nunca modificar `tutor-ai` para revertir Exam. La eliminación de tablas es una operación posterior que requiere revisar y exportar los datos de prueba antes de borrarlos.
