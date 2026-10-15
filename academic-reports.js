/* Annual reports: read-only normalization and on-demand, local PDF generation. */
(function (root) {
    'use strict';
    const EMPTY = 'No se registraron datos en esta sección durante este año lectivo.';
    const text = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const fixed = value => value === null || value === undefined ? 'Sin calificaciones' : Number(value).toFixed(2);
    const status = value => ({ completed: 'Completado', pending: 'Pendiente', in_progress: 'En progreso', paused: 'Pausado', overdue: 'Vencida', upcoming: 'Próxima' })[value] || text(value);
    function studentName(value) {
        const name = text(value);
        return !name || /^(undefined|null)$/i.test(name) || name.includes('@') ? 'Estudiante' : name;
    }
    function filename(name, year) {
        const safe = studentName(name).replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim().slice(0, 150);
        return `Reporte de ${safe || 'Estudiante'} - ${year.start_year}-${year.end_year}.pdf`;
    }
    function normalize(raw, helpers) {
        if (!raw?.year?.id || !raw.year.user_id) throw new Error('No se pudo verificar el año del reporte.');
        const year = raw.year, owner = year.user_id;
        const names = ['subjects','tasks','events','evaluations','attendance','resources','grades','projects','goals','project_stages','project_subtasks','grade_items'];
        const dateFields = { tasks: 'due_date', evaluations: 'evaluation_date', events: 'event_date', attendance: 'date', goals: 'target_date' };
        const rows = {};
        for (const name of names) {
            rows[name] = Array.isArray(raw[name]) ? raw[name] : [];
            if (rows[name].some(row => row.academic_year_id !== year.id || (name !== 'grade_items' && row.user_id !== owner))) {
                throw new Error('Se detectaron datos fuera del año o de la cuenta del reporte.');
            }
            if (dateFields[name] || ['subjects','projects','resources'].includes(name)) {
                const date = dateFields[name];
                rows[name] = [...rows[name]].sort((a,b) => (date ? String(a[date] || '9999').localeCompare(String(b[date] || '9999')) : 0)
                    || text(a.title || a.name).localeCompare(text(b.title || b.name), 'es', { numeric: true }));
            }
        }
        const subjectNames = new Map(rows.subjects.map(row => [row.id, row.name]));
        const subject = row => subjectNames.get(row.subject_id) || 'Sin materia';
        const items = new Map();
        const gradeIds = new Set(rows.grades.map(row => row.id));
        for (const item of rows.grade_items) {
            if (!gradeIds.has(item.grade_id)) throw new Error('Una calificación no pertenece al reporte.');
            if (!items.has(item.grade_id)) items.set(item.grade_id, []);
            items.get(item.grade_id).push({ activity: item.activity, date: item.item_date, value: number(item.value) });
        }
        const grades = rows.grades.map(row => ({ ...row, subject: subjectNames.get(row.subject_id) || 'General', period: row.period || 'p1', category: row.category || 'partial1', value: number(row.final_value), items: items.get(row.id) || [] }));
        const tasks = rows.tasks.map(row => ({ ...row, due: row.due_date || '', dueTime: row.due_time || '', subject: subject(row), status: helpers.taskStatus(row.status) }));
        const stages = rows.project_stages.map(row => ({ ...row, projectId: row.project_id, dueDate: row.due_date || '' }));
        const subtasks = rows.project_subtasks.map(row => ({ ...row, projectId: row.project_id, stageId: row.stage_id, dueDate: row.due_date || '' }));
        const workspace = { grades, tasks, subjects: rows.subjects, projects: rows.projects, projectStages: stages, projectSubtasks: subtasks };
        const attendance = helpers.attendance(rows.attendance.map(row => ({ ...row, status: row.status || 'Asisti' })));
        const taskCounts = { completed: 0, pending: 0, overdue: 0, upcoming: 0 };
        tasks.forEach(task => {
            const visual = helpers.taskVisualStatus(task);
            taskCounts[visual]++;
        });
        const pendingTasks = tasks.length - taskCounts.completed;
        const projects = rows.projects.map(project => {
            const stats = helpers.projectStats(project, workspace);
            return { ...project, stats, state: stats.progress === 100 ? 'completed' : stats.progress > 0 ? 'in_progress' : 'pending' };
        });
        const evaluationCompleted = rows.evaluations.filter(row => row.status === 'completed').length;
        const gradeCount = grades.reduce((sum, grade) => sum + helpers.gradeItems(grade).length, 0);
        const average = grades.length ? helpers.averageGrade(workspace) : null;
        const summary = [
            ['Materias creadas', rows.subjects.length], ['Total de tareas', tasks.length],
            ['Tareas completadas', taskCounts.completed], ['Tareas pendientes (incluye próximas y vencidas)', pendingTasks],
            ['Tareas próximas', taskCounts.upcoming], ['Tareas vencidas', taskCounts.overdue],
            ['Evaluaciones registradas', rows.evaluations.length], ['Evaluaciones completadas', evaluationCompleted],
            ['Calificaciones registradas (casilleros)', gradeCount], ['Promedio general del año', fixed(average)],
            ['Registros de asistencia', attendance.total], ['Porcentaje de asistencia', `${attendance.percentage}%`],
            ['Metas creadas', rows.goals.length], ['Proyectos creados', projects.length],
            ['Proyectos completados', projects.filter(project => project.state === 'completed').length],
            ['Recursos guardados', rows.resources.length], ['Eventos del calendario', rows.events.length],
            ['Actividad académica registrada', number(raw.activity?.count)]
        ];
        const sections = [];
        const add = (title, headers, body, note = '') => sections.push({ title, headers, body: body.map(row => row.map(text)), note });
        const subjectGrades = row => grades.filter(grade => grade.subject_id === row.id);
        add('Materias del año', ['Materia', 'Tareas', 'Evaluaciones', 'Promedio'], rows.subjects.map(row => [row.name,
            tasks.filter(task => task.subject_id === row.id).length, rows.evaluations.filter(e => e.subject_id === row.id).length,
            fixed(helpers.gradeSummary(subjectGrades(row)).average)]));
        add('Resumen de tareas', ['Tarea / materia', 'Fecha y hora', 'Estado', 'Prioridad'], tasks.map(row => [
            `${row.title} / ${subject(row)}`, helpers.dateTime(row.due_date, row.due_time), status(helpers.taskVisualStatus(row)), helpers.priority(row.priority)
        ]), `Total: ${tasks.length} · Completadas: ${taskCounts.completed} · Pendientes: ${pendingTasks} · Próximas: ${taskCounts.upcoming} · Vencidas: ${taskCounts.overdue}.`);
        add('Evaluaciones', ['Evaluación / materia', 'Tipo', 'Fecha y hora', 'Estado'], rows.evaluations.map(row => [
            `${row.title} / ${subject(row)}`, row.evaluation_type, helpers.dateTime(row.evaluation_date, row.evaluation_time), status(row.status)
        ]), `Registradas: ${rows.evaluations.length} · Completadas: ${evaluationCompleted}.`);
        const gradeGroups = new Map();
        grades.forEach(grade => { if (!gradeGroups.has(grade.subject)) gradeGroups.set(grade.subject, []); gradeGroups.get(grade.subject).push(grade); });
        add('Calificaciones', ['Materia', 'Calificaciones', 'Promedio'], [...gradeGroups].map(([name, group]) => [
            name, group.reduce((sum, grade) => sum + helpers.gradeItems(grade).length, 0), fixed(helpers.gradeSummary(group).average)
        ]), `Promedio general del año: ${fixed(average)}. Fórmula actual de AC Edunity: promedio de parciales 70% + examen 30%, por periodo; promedio de periodos y materias disponibles.`);
        add('Asistencia', ['Clases', 'Presentes', 'Faltas', 'Atrasos', 'Justificadas', 'Asistencia'], attendance.total ? [[
            attendance.total, attendance.present, attendance.absent, attendance.late, attendance.justified, `${attendance.percentage}%`
        ]] : [], 'Se utiliza el mismo criterio de asistencia de la plataforma (presentes, atrasos y justificadas).');
        add('Metas', ['Meta / materia', 'Progreso', 'Estado', 'Fecha'], rows.goals.map(row => [
            `${row.title} / ${subject(row)}`, `${number(row.progress)}%`, status(row.status), helpers.dateTime(row.target_date)
        ]), `Creadas: ${rows.goals.length} · Completadas: ${rows.goals.filter(row => row.status === 'completed').length} · Pendientes: ${rows.goals.filter(row => row.status !== 'completed').length}.`);
        add('Proyectos', ['Proyecto', 'Progreso', 'Etapas', 'Subtareas', 'Estado'], projects.map(row => [
            row.title, `${row.stats.progress}%`, `${row.stats.completedStages}/${row.stats.stages.length}`, `${row.stats.completedSubtasks}/${row.stats.subtasks.length}`, status(row.state)
        ]), 'Progreso y estado derivados con la lógica real de etapas y subtareas de AC Edunity.');
        add('Calendario y eventos', ['Evento / materia', 'Tipo', 'Fecha y hora'], rows.events.map(row => [
            `${row.title} / ${subject(row)}`, row.type || 'Evento', helpers.dateTime(row.event_date, row.event_time)
        ]), `Eventos: ${rows.events.length} · Tareas con fecha: ${tasks.filter(row => row.due_date).length} · Evaluaciones: ${rows.evaluations.length} · Etapas con fecha: ${stages.filter(row => row.dueDate).length}. Las tareas y evaluaciones se detallan en sus secciones.`);
        add('Mochila y recursos', ['Recurso', 'Materia', 'Tipo'], rows.resources.map(row => [
            row.title || row.file_name, subject(row), row.file_name?.match(/\.([a-z0-9]{1,10})$/i)?.[1].toUpperCase() || row.tag || 'Recurso'
        ]), `Recursos guardados: ${rows.resources.length}. No se incrustan archivos ni enlaces privados en el PDF.`);
        add('Progreso del año', ['Métrica anual', 'Valor'], [
            ['Actividad registrada', number(raw.activity?.count)], ['Puntos de actividad', number(raw.activity?.points)],
            ['Días con actividad registrada', number(raw.activity?.active_days)], ['Tareas completadas', taskCounts.completed],
            ['XP del año lectivo', number(year.xp)], ['Nivel según XP del año', helpers.level(number(year.xp))],
            ['Racha almacenada en el año', number(year.streak)]
        ], 'XP y racha provienen del registro del año lectivo, no del perfil global. El ciclo inicial conserva el saldo migrado de 2026. No se atribuyen al año logros globales sin un registro anual verificable.');
        const name = studentName(raw.student_name);
        return { year, studentName: name, generatedAt: raw.generated_at, filename: filename(name, year), summary, sections };
    }

    let librariesPromise = null;
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src; script.async = true;
            script.onload = resolve;
            script.onerror = () => { script.remove(); reject(new Error('No se pudo cargar el generador PDF. Inténtalo de nuevo.')); };
            document.head.append(script);
        });
    }
    async function libraries() {
        if (!librariesPromise) librariesPromise = (async () => {
            if (!root.jspdf) await loadScript('assets/vendor/jspdf-4.2.1.umd.min.js');
            if (!root.jspdf.jsPDF.API.autoTable) await loadScript('assets/vendor/jspdf-autotable-5.0.9.min.js');
            return root.jspdf.jsPDF;
        })().catch(error => { librariesPromise = null; throw error; });
        return librariesPromise;
    }
    async function logoData() {
        const response = await fetch('favicon-192.png');
        if (!response.ok) throw new Error('No se pudo cargar el logo del reporte.');
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
        });
    }
    async function createDocument(report) {
        const [jsPDF, logo] = await Promise.all([libraries(), logoData()]);
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        doc.setProperties({ title: `Reporte académico ${report.year.label}`, author: 'AC Edunity', subject: 'Resumen anual del estudiante', creator: 'AC Edunity' });
        const navy = [26, 36, 65], purple = [104, 74, 194], blue = [41, 108, 201], muted = [93, 105, 125];
        const generated = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'long', timeStyle: 'short', hour12: true }).format(new Date(report.generatedAt));
        // Explicit white paper on the cover and on pages added by AutoTable, in either app theme.
        const whitePaper = () => {
            doc.saveGraphicsState(); doc.setFillColor(255, 255, 255); doc.rect(0, 0, 210, 297, 'F'); doc.restoreGraphicsState();
        };
        whitePaper(); doc.internal.events.subscribe('addPage', whitePaper);
        doc.saveGraphicsState();
        doc.circle(105, 46, 14, null); doc.clip(); doc.discardPath();
        doc.addImage(logo, 'PNG', 91, 32, 28, 28, undefined, 'FAST');
        doc.restoreGraphicsState();
        doc.setTextColor(...blue); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('AC EDUNITY', 105, 76, { align: 'center' });
        doc.setTextColor(...navy); doc.setFontSize(28); doc.text('REPORTE ACADÉMICO', 105, 99, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(13); doc.setTextColor(...muted);
        doc.text(`Año lectivo ${report.year.label}`, 105, 113, { align: 'center' });
        doc.setDrawColor(217, 222, 237); doc.setLineWidth(.3); doc.line(18, 130, 192, 130);
        doc.setTextColor(...purple); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('ESTUDIANTE', 18, 151);
        doc.setTextColor(...navy); doc.setFontSize(19);
        const nameLines = doc.splitTextToSize(report.studentName, 174);
        doc.text(nameLines, 18, 163);
        let y = 163 + nameLines.length * 8 + 14;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...purple); doc.text('FECHA DE GENERACIÓN', 18, y);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...muted);
        doc.text(doc.splitTextToSize(generated, 174), 18, y + 9);
        doc.setTextColor(...blue); doc.setFontSize(10); doc.text('Generado por AC Edunity', 105, 251, { align: 'center' });
        doc.setTextColor(...muted); doc.setFontSize(9); doc.text('Gestión educativa inteligente y personalizada · edunity.me', 105, 260, { align: 'center' });
        doc.addPage(); y = 31;
        function section(title, headers, body, note) {
            doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
            const noteLines = note ? doc.splitTextToSize(note, 174) : [];
            // Keep short tables together; long tables reserve the title, note, header and first row.
            doc.setFontSize(8.7);
            const previewRows = body.length ? (body.length <= 8 ? body : body.slice(0, 1)) : [[EMPTY]];
            const rowsHeight = previewRows.reduce((height, row) => height + 5.2 + 3.6 * Math.max(...row.map(cell =>
                doc.splitTextToSize(text(cell), 174 / (body.length ? headers.length : 1) - 5.2).length)), 0);
            if (y + 8 + (noteLines.length ? noteLines.length * 4.2 + 5 : 0) + 10 + rowsHeight > 273) { doc.addPage(); y = 31; }
            doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...purple); doc.text(title, 18, y);
            y += 8;
            if (note) {
                doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...muted);
                doc.text(noteLines, 18, y); y += noteLines.length * 4.2 + 5;
            }
            doc.autoTable({
                startY: y, margin: { top: 28, right: 18, bottom: 24, left: 18 },
                head: [headers], body: body.length ? body : [[{ content: EMPTY, colSpan: headers.length, styles: { fontStyle: 'italic', textColor: muted } }]],
                theme: 'grid', showHead: 'everyPage', rowPageBreak: 'avoid',
                styles: { font: 'helvetica', fontSize: 8.7, cellPadding: 2.6, textColor: navy, lineColor: [225, 230, 241], lineWidth: .15, overflow: 'linebreak' },
                headStyles: { fillColor: [236,239,247], textColor: navy, fontStyle: 'bold', fontSize: 8.8 },
                bodyStyles: { fillColor: [255,255,255] }, alternateRowStyles: { fillColor: [249,250,252] }
            });
            y = doc.lastAutoTable.finalY + 14;
        }
        section('Resumen general', ['Indicador del año', 'Resultado'], report.summary.map(row => row.map(text)));
        report.sections.forEach(item => section(item.title, item.headers, item.body, item.note));
        const total = doc.getNumberOfPages();
        for (let page = 1; page <= total; page++) {
            doc.setPage(page);
            if (page > 1) {
                doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...navy); doc.text('AC EDUNITY', 18, 15);
                doc.setFont('helvetica', 'normal'); doc.setTextColor(...muted); doc.text(report.year.label, 192, 15, { align: 'right' });
                doc.setDrawColor(217,222,237); doc.setLineWidth(.2); doc.line(18, 20, 192, 20);
            }
            doc.setDrawColor(225,230,241); doc.line(18, 279, 192, 279);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...muted);
            doc.text(doc.splitTextToSize(`Reporte académico de ${report.studentName}`, 135), 18, 285);
            doc.text(`Página ${page} de ${total}`, 192, 285, { align: 'right' });
        }
        return doc;
    }
    root.ACAcademicReports = { normalize, filename, studentName, createDocument };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.ACAcademicReports;
})(typeof globalThis !== 'undefined' ? globalThis : window);
