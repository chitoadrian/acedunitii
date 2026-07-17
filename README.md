# AC Edunity - Gestión Educativa Inteligente Personalizada

## 🎯 Descripción del Proyecto

**AC Edunity** es un prototipo funcional de plataforma web para gestión educativa personalizada, inspirada visualmente en ClickUp. Diseñada como un avance de proyecto de grado, ofrece una interfaz moderna tipo SaaS con funcionalidades educativas completas y un asistente IA simulado.

## ✨ Características Principales

### 1. **Landing Page Atractiva**
- Logo y marca visual con gradientes modernos
- Sección de héroe con valor propuesto
- Tarjetas flotantes de beneficios
- Navegación limpia
- Responsive design completo

### 2. **Sistema de Autenticación**
- Formulario de inicio de sesión
- Formulario de registro
- Almacenamiento de datos en localStorage
- Validación de credenciales

**Credenciales de prueba:**
- Email: `adrian@example.com`
- Contraseña: `password123`

### 3. **Dashboard Personalizado**
- Bienvenida personalizada: "Hola Adrian 👋"
- 6 tarjetas con estadísticas clave:
  - Tareas Pendientes
  - Próximo Examen
  - Promedio Actual
  - Racha de Estudio
  - Nivel y XP
  - Tiempo Estudiado

### 4. **Menú Lateral Moderno**
- Navegación SPA (Single Page Application)
- Items con iconos: 🏠 📚 ✓ 📅 📊 🤖 🎮 🎒
- Indicador activo de sección
- Responsive en mobile

### 5. **Secciones Funcionales**

#### 📚 Materias
- Tarjetas de 4 materias (Matemática, Física, Programación, Inglés)
- Métricas: Promedio, Tareas, Progreso
- Barras de progreso con gradientes
- Información de última actividad

#### ✓ Tareas
- Lista completa de tareas académicas
- Filtros: Todas, Pendientes, Completadas
- Prioridades (Alta, Media, Baja)
- Checkbox para marcar completadas
- Opción para agregar nuevas tareas

#### 📅 Calendario
- Visualización de mes actual (Junio 2026)
- Eventos académicos de ejemplo
- Categorías: Exámenes, Entregas, Clases, Proyectos
- Fechas destacadas

#### 📊 Notas
- Registro de calificaciones por materia
- Formulario para agregar notas
- Cálculo automático de promedios
- Historial de evaluaciones

#### 🤖 Asistente IA Simulado
- **Generar Resumen**: Crea resúmenes automáticos de temas
- **Crear Preguntas**: Genera preguntas de práctica
- **Crear Flashcards**: Prepara flashcards para estudiar
- Resultados descargables como TXT
- Opción copiar al portapapeles

#### 🎮 Progreso y Gamificación
- Display de nivel actual
- Barra de XP (Experiencia)
- Racha de estudio (días consecutivos)
- 12 Logros desbloqueables
- Estadísticas: Horas estudiadas, Tareas completadas

#### 🎒 Mochila Digital
- Almacenamiento de recursos académicos
- Tarjetas de recursos con iconos
- Botones Ver y Descargar
- Ejemplos: Apuntes, Guías, Informes, Videos

### 6. **Tema Claro/Oscuro**
- Toggle en landing page y sidebar
- Paleta de colores adaptable:
  - **Oscuro**: #292d34 (por defecto)
  - **Claro**: #ffffff
- Transiciones suaves
- Preferencias guardadas en localStorage

### 7. **Diseño Responsivo**
- Optimizado para computadora (1200px+)
- Tablet (768px - 1199px)
- Mobile (< 768px)
- Sidebar adaptable
- Menú horizontal en mobile

## 🎨 Paleta de Colores

```css
Fondo Oscuro:    #292d34
Blanco:          #ffffff
Morado:          #7b68ee
Azul/Celeste:    #49ccf9
Rosado:          #fd71af
Amarillo:        #ffc800
```

## 📁 Estructura de Archivos

```
AC Edunity/
├── index.html       # Estructura HTML completa (16 secciones)
├── style.css        # Estilos modernos tipo SaaS (900+ líneas)
├── app.js          # Lógica y funcionalidades en JavaScript puro
└── README.md       # Este archivo
```

## 🚀 Cómo Usar

### Instalación
1. No requiere instalación
2. Simplemente abre `index.html` en un navegador moderno

### Acceso a la Aplicación
1. Abre el archivo `index.html`
2. Haz clic en "Inicia sesión" en la landing page
3. Usa las credenciales de prueba:
   - Email: `adrian@example.com`
   - Contraseña: `password123`

### Funcionalidades Disponibles
- ✅ Navegación entre secciones sin recargar
- ✅ Cambio de tema claro/oscuro
- ✅ Agregar nuevas tareas
- ✅ Marcar tareas como completadas
- ✅ Filtrar tareas
- ✅ Registrar notas y ver promedios
- ✅ Usar asistente IA simulado
- ✅ Ver calendario de eventos
- ✅ Explorar logros desbloqueados
- ✅ Acceder a recursos en mochila digital
- ✅ Cerrar sesión

## 💻 Tecnologías Utilizadas

- **HTML5**: Estructura semántica completa
- **CSS3**:
  - Flexbox y Grid
  - Gradientes lineales
  - Animaciones suaves
  - Media queries para responsividad
  - Variables CSS para temas dinámicos
- **JavaScript Puro**:
  - DOM manipulation
  - Event listeners
  - localStorage para persistencia
  - Funciones simuladas para IA

## 📊 Datos Simulados

Todos los datos están almacenados localmente y son simulados:
- Usuarios: Sistema de autenticación mock
- Tareas: 6 tareas de ejemplo
- Notas: 4 materias con calificaciones
- Eventos: Calendario con 5 eventos académicos
- Logros: 12 logros desbloqueables
- Recursos: 6 archivos en mochila digital

## 🔒 Seguridad

⚠️ **Importante**: Este es un prototipo funcional. No implementa:
- Hash de contraseñas
- Validación de seguridad real
- Protección CSRF/XSS en producción
- Encriptación de datos

## 🚀 Próximas Etapas de Desarrollo

El proyecto está preparado para integración con:

1. **Backend (Node.js/Python)**
   - APIs RESTful
   - Autenticación real (JWT)
   - Base de datos

2. **Supabase**
   - Almacenamiento en PostgreSQL
   - Autenticación con Supabase Auth
   - Realtime updates

3. **IA Real**
   - Integración con OpenAI API
   - Generación de contenido real
   - Análisis de rendimiento

4. **Hosting**
   - Despliegue en Vercel, Netlify o Hostinger
   - CI/CD pipeline
   - Dominio personalizado

## 🎓 Notas para Presentación

### Puntos Fuertes
- ✅ Diseño profesional tipo SaaS
- ✅ Interfaz intuitiva y moderna
- ✅ Todas las funcionalidades base operativas
- ✅ Código limpio y comentado
- ✅ Completamente responsive
- ✅ Tema claro/oscuro
- ✅ Animaciones suaves

### Alcance
- 11 secciones funcionales principales
- 12 logros gamificados
- Sistema de tareas dinámico
- Asistente IA simulado
- Calendario de eventos
- Sistema de notas con promedios

## 📋 Requisitos de Presentación Satisfechos

- ✅ Landing page con descripción clara
- ✅ Login y registro visuales
- ✅ Dashboard con bienvenida personalizada
- ✅ Menú lateral con 8 opciones
- ✅ 4 materias con progreso
- ✅ Gestión de tareas
- ✅ Calendario académico
- ✅ Sistema de notas
- ✅ Asistente IA simulado
- ✅ Sistema de progreso y logros
- ✅ Mochila digital
- ✅ Modo claro/oscuro
- ✅ Diseño responsivo
- ✅ Código limpio y ordenado
- ✅ Preparado para Supabase/IA real

## 📞 Contacto

Proyecto de Grado - AC Edunity
Gestión Educativa Inteligente Personalizada
Año: 2026

---

**¡El proyecto está listo para presentación!** 🎉

Este prototipo demuestra una comprensión completa de desarrollo web moderno, UX/UI design y funcionalidades educativas. Está preparado para evolucionar hacia una plataforma de producción con backend, base de datos e IA real.
