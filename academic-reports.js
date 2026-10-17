/* Annual reports: read-only normalization and on-demand, local PDF generation. */
(function (root) {
    'use strict';
    const EMPTY = 'No se registraron datos en esta sección durante este año lectivo.';
    const text = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const fixed = value => value === null || value === undefined ? 'Sin calificaciones' : Number(value).toFixed(2);
    const status = value => ({ completed: 'Completado', pending: 'Pendiente', in_progress: 'En progreso', paused: 'Pausado', overdue: 'Vencida', upcoming: 'Próxima' })[value] || text(value);
    const deleted = row => row._record_deleted === true;
    const recordState = row => deleted(row) ? 'Eliminada posteriormente' : 'Conservada';
    function getStudentDisplayName(...candidates) {
        for (const value of candidates) {
            if (typeof value !== 'string') continue;
            const name = text(value);
            if (name && !/^(undefined|null|estudiante)$/i.test(name) && !name.includes('@') &&
                !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(name)) return name;
        }
        return 'Estudiante';
    }
    const studentName = getStudentDisplayName;
    function filename(name, year) {
        const safe = studentName(name).replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim();
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
            const unique = new Map();
            rows[name].forEach(row => { if (!unique.has(row.id) || !deleted(row)) unique.set(row.id, row); });
            rows[name] = [...unique.values()];
            if (dateFields[name] || ['subjects','projects','resources'].includes(name)) {
                const date = dateFields[name];
                rows[name] = [...rows[name]].sort((a,b) => (date ? String(a[date] || '9999').localeCompare(String(b[date] || '9999')) : 0)
                    || text(a.title || a.name).localeCompare(text(b.title || b.name), 'es', { numeric: true }));
            }
        }
        const subjectNames = new Map(rows.subjects.map(row => [row.id, row.name]));
        const currentSubjectNames = new Map(rows.subjects.filter(row => !deleted(row)).map(row => [row.id,row.name]));
        // Restore SET NULL associations only in this report, never in workspace or database rows.
        const formerSubjects = new Map();
        rows.subjects.filter(deleted).forEach(subject => Object.entries(subject._history_metadata?.related_records || {}).forEach(([table, ids]) =>
            ids.forEach(id => formerSubjects.set(`${table}:${id}`, subject.id))));
        for (const table of names) rows[table] = rows[table].map(row => ({ ...row, _report_subject_id: row.subject_id || formerSubjects.get(`${table}:${row.id}`) || null }));
        const subject = row => subjectNames.get(row._report_subject_id) || 'Sin materia';
        const items = new Map();
        const gradeIds = new Set(rows.grades.map(row => row.id));
        for (const item of rows.grade_items) {
            if (!gradeIds.has(item.grade_id)) throw new Error('Una calificación no pertenece al reporte.');
            if (!items.has(item.grade_id)) items.set(item.grade_id, []);
            items.get(item.grade_id).push({ ...item, activity: item.activity, date: item.item_date, value: number(item.value) });
        }
        const grades = rows.grades.map(row => ({ ...row, subject: (deleted(row) ? subjectNames.get(row._report_subject_id) : currentSubjectNames.get(row.subject_id)) || 'General', period: row.period || 'p1', category: row.category || 'partial1',
            value: row.final_value !== null && row.final_value !== undefined && row.final_value !== '' && Number.isFinite(Number(row.final_value)) ? Number(row.final_value) : undefined, items: items.get(row.id) || [] }));
        const currentGrades = grades.filter(row => !deleted(row)).map(row => ({ ...row, items: row.items.filter(item => !deleted(item)) })).filter(row => row.items.length || row.value !== undefined);
        const tasks = rows.tasks.map(row => ({ ...row, due: row.due_date || '', dueTime: row.due_time || '', subject: subject(row), status: helpers.taskStatus(row.status) }));
        const stages = rows.project_stages.map(row => ({ ...row, projectId: row.project_id, dueDate: row.due_date || '' }));
        const subtasks = rows.project_subtasks.map(row => ({ ...row, projectId: row.project_id, stageId: row.stage_id, dueDate: row.due_date || '' }));
        const workspace = { grades: currentGrades, tasks, subjects: rows.subjects, projects: rows.projects, projectStages: stages, projectSubtasks: subtasks };
        const attendance = helpers.attendance(rows.attendance.filter(row => !deleted(row)));
        const attendanceHistory = helpers.attendance(rows.attendance);
        // Mutually exclusive balance: completed (including later deletions), current states, other deletions.
        const taskCounts = { completed: 0, pending: 0, overdue: 0, upcoming: 0, deleted: 0 };
        tasks.forEach(task => {
            const visual = task.status === 'completed' ? 'completed' : deleted(task) ? 'deleted' : helpers.taskVisualStatus(task);
            taskCounts[visual]++;
        });
        const pendingTasks = taskCounts.pending + taskCounts.overdue + taskCounts.upcoming;
        const projects = rows.projects.map(project => {
            const context = project._history_metadata;
            const stats = helpers.projectStats(project, { ...workspace,
                projectStages: stages.filter(row => deleted(project) ? context?.stage_ids?.includes(row.id) : !deleted(row)),
                projectSubtasks: subtasks.filter(row => deleted(project) ? context?.subtask_ids?.includes(row.id) : !deleted(row)) });
            return { ...project, stats, state: stats.progress === 100 ? 'completed' : stats.progress > 0 ? 'in_progress' : 'pending' };
        });
        const evaluationCompleted = rows.evaluations.filter(row => row.status === 'completed').length;
        const gradeCount = grades.reduce((sum, grade) => sum + helpers.gradeItems(grade).length, 0);
        const average = currentGrades.length ? helpers.averageGrade(workspace) : null;
        const removedGradeCount = grades.reduce((sum, grade) => sum + (grade.items.length ? grade.items.filter(item => deleted(grade) || deleted(item)).length : deleted(grade) ? helpers.gradeItems(grade).length : 0), 0);
        const countDeleted = table => rows[table].filter(deleted).length;
        const overview = table => `Creados: ${rows[table].length} · Conservados: ${rows[table].length - countDeleted(table)} · Eliminados posteriormente: ${countDeleted(table)}.`;
        const summary = [
            ['Materias creadas', rows.subjects.length], ['Total de tareas', tasks.length],
            ['Tareas completadas', taskCounts.completed], ['Tareas pendientes (incluye próximas y vencidas)', pendingTasks],
            ['Tareas próximas', taskCounts.upcoming], ['Tareas vencidas', taskCounts.overdue],
            ['Tareas eliminadas sin completar', taskCounts.deleted], ['Tareas eliminadas (incluye completadas)', countDeleted('tasks')],
            ['Evaluaciones registradas', rows.evaluations.length], ['Evaluaciones completadas', evaluationCompleted],
            ['Calificaciones registradas (casilleros)', gradeCount], ['Calificaciones eliminadas (casilleros)', removedGradeCount], ['Promedio final de registros conservados', fixed(average)],
            ['Registros de asistencia creados', attendanceHistory.total], ['Asistencia de registros conservados', attendance.total ? `${attendance.percentage}%` : 'Sin datos'],
            ['Metas creadas', rows.goals.length], ['Proyectos creados', projects.length],
            ['Proyectos completados', projects.filter(project => project.state === 'completed').length],
            ['Recursos guardados', rows.resources.length], ['Eventos del calendario', rows.events.length],
            ['Actividad académica registrada', number(raw.activity?.count)]
        ];
        const sections = [];
        const add = (title, headers, body, note = '', extra = {}) => sections.push({ title, headers, body: body.map(row => row.map(text)), note, ...extra });
        const subjectGrades = row => currentGrades.filter(grade => grade.subject_id === row.id);
        add('Materias del año', ['Materia', 'Tareas', 'Evaluaciones', 'Notas', 'Promedio final', 'Registro'], rows.subjects.map(row => [row.name,
            tasks.filter(task => task._report_subject_id === row.id).length, rows.evaluations.filter(e => e._report_subject_id === row.id).length,
            grades.filter(g => g._report_subject_id === row.id).reduce((sum,g) => sum + helpers.gradeItems(g).length, 0),
            fixed(helpers.gradeSummary(subjectGrades(row)).average), recordState(row)]), overview('subjects'));
        add('Tareas del año', ['Tarea', 'Materia', 'Fecha y hora', 'Estado académico', 'Registro', 'Prioridad'], tasks.map(row => [
            row.title, subject(row), helpers.dateTime(row.due_date, row.due_time), row.status === 'completed' ? 'Completada' : deleted(row) ? 'Eliminada' : status(helpers.taskVisualStatus(row)), recordState(row), helpers.priority(row.priority)
        ]), `${overview('tasks')} Completadas: ${taskCounts.completed} (incluye completadas eliminadas). Pendientes actuales: ${taskCounts.pending}; próximas: ${taskCounts.upcoming}; vencidas: ${taskCounts.overdue}; eliminadas sin completar: ${taskCounts.deleted}.`, { kind: 'tasks' });
        add('Evaluaciones', ['Evaluación / materia', 'Tipo', 'Fecha y hora', 'Estado académico', 'Registro'], rows.evaluations.map(row => [
            `${row.title} / ${subject(row)}`, row.evaluation_type, helpers.dateTime(row.evaluation_date, row.evaluation_time), status(row.status), recordState(row)
        ]), `${overview('evaluations')} Completadas: ${evaluationCompleted}; no completadas: ${rows.evaluations.length - evaluationCompleted}.`);
        const gradeGroups = new Map();
        grades.forEach(grade => { if (!gradeGroups.has(grade.subject)) gradeGroups.set(grade.subject, []); gradeGroups.get(grade.subject).push(grade); });
        const gradeState = value => value === null ? 'Sin calificaciones' : text(helpers.gradeStatus(value)).replace(/^./, x => x.toUpperCase());
        add('Rendimiento académico', ['Materia', 'Registradas', 'Eliminadas', 'Promedio final', 'Estado'], [...gradeGroups].map(([name, group]) => {
            const kept = currentGrades.filter(grade => grade.subject === name), final = kept.length ? helpers.gradeSummary(kept).average : null;
            return [name, group.reduce((sum,g) => sum + helpers.gradeItems(g).length, 0), group.reduce((sum,g) => sum + (g.items.length ? g.items.filter(i => deleted(g) || deleted(i)).length : deleted(g) ? helpers.gradeItems(g).length : 0), 0), fixed(final), gradeState(final)];
        }), `Registradas: ${gradeCount}; eliminadas: ${removedGradeCount}. El promedio final usa exclusivamente registros conservados. Fórmula compartida: parciales 70% + examen 30%, por periodo y materia. No se calcula un promedio histórico mezclando versiones o notas eliminadas. Los casilleros reemplazados al editar se cuentan por su UUID, no como actividades nuevas demostradas.`, { kind: 'grades' });
        add('Asistencia', ['Registro', 'Presentes', 'Faltas', 'Atrasos', 'Justificadas', 'Total'], attendanceHistory.total ? [
            ['Conservados', attendance.present, attendance.absent, attendance.late, attendance.justified, attendance.total],
            ['Eliminados', attendanceHistory.present-attendance.present, attendanceHistory.absent-attendance.absent, attendanceHistory.late-attendance.late, attendanceHistory.justified-attendance.justified, countDeleted('attendance')]
        ] : [], `Registros creados: ${attendanceHistory.total}. Estados recuperados sin inventar datos. El porcentaje general considera solo los registros conservados, con el criterio actual de AC Edunity.`, { kind: 'attendance' });
        add('Metas', ['Meta / materia', 'Progreso', 'Estado académico', 'Fecha', 'Registro'], rows.goals.map(row => [
            `${row.title} / ${subject(row)}`, `${number(row.progress)}%`, status(row.status), helpers.dateTime(row.target_date), recordState(row)
        ]), `${overview('goals')} Completadas: ${rows.goals.filter(row => row.status === 'completed').length}.`, { progress: rows.goals.map(row => ({ title: row.title, value: number(row.progress), record: recordState(row) })) });
        add('Proyectos', ['Proyecto', 'Progreso', 'Etapas', 'Subtareas', 'Estado', 'Registro'], projects.map(row => [
            row.title, `${row.stats.progress}%`, `${row.stats.completedStages}/${row.stats.stages.length}`, `${row.stats.completedSubtasks}/${row.stats.subtasks.length}`, status(row.state), recordState(row)
        ]), `${overview('projects')} El progreso usa hijos conservados o los presentes al eliminar el proyecto, no versiones eliminadas anteriormente.`, { progress: projects.map(row => ({ title: row.title, value: row.stats.progress, record: recordState(row) })) });
        const projectNames = new Map(projects.map(row => [row.id,row.title])), stageNames = new Map(stages.map(row => [row.id,row.title]));
        const stageStatus = row => helpers.stageStatus(row,subtasks.filter(item => item.stageId===row.id &&
            (deleted(row) ? row._history_metadata?.subtask_ids?.includes(item.id) : !deleted(item))));
        add('Etapas y subtareas', ['Elemento / proyecto', 'Etapa', 'Estado', 'Fecha y hora', 'Registro'], [
            ...stages.map(row => [`Etapa: ${row.title} / ${projectNames.get(row.projectId) || 'Sin proyecto'}`, row.title, status(stageStatus(row)), helpers.dateTime(row.due_date,row.due_time), recordState(row)]),
            ...subtasks.map(row => [`Subtarea: ${row.title} / ${projectNames.get(row.projectId) || 'Sin proyecto'}`, stageNames.get(row.stageId) || 'Sin etapa', status(row.status), helpers.dateTime(row.due_date,row.due_time), recordState(row)])
        ], `Etapas creadas: ${stages.length}; eliminadas: ${countDeleted('project_stages')}. Subtareas creadas: ${subtasks.length}; eliminadas: ${countDeleted('project_subtasks')}.`);
        add('Calendario y eventos', ['Evento / materia', 'Tipo', 'Fecha y hora', 'Registro'], rows.events.map(row => [
            `${row.title} / ${subject(row)}`, row.type || 'Evento', helpers.dateTime(row.event_date, row.event_time), recordState(row)
        ]), `${overview('events')} Las tareas y evaluaciones se detallan en sus propias secciones.`);
        add('Mochila y recursos', ['Recurso', 'Materia', 'Tipo', 'Registro'], rows.resources.map(row => [
            row.title || row.file_name, subject(row), row.file_name?.match(/\.([a-z0-9]{1,10})$/i)?.[1].toUpperCase() || row.tag || 'Recurso', recordState(row)
        ]), `${overview('resources')} No se incrustan archivos ni enlaces privados.`);
        add('Progreso del año', ['Métrica anual', 'Valor'], [
            ['Actividad registrada', number(raw.activity?.count)], ['Puntos de actividad', number(raw.activity?.points)],
            ['Días con actividad registrada', number(raw.activity?.active_days)], ['Tareas completadas', taskCounts.completed],
            ['XP del año lectivo', number(year.xp)], ['Nivel según XP del año', helpers.level(number(year.xp))],
            ['Racha almacenada en el año', number(year.streak)]
        ], 'XP y racha provienen del registro del año lectivo, no del perfil global. El ciclo inicial conserva el saldo migrado de 2026. No se atribuyen al año logros globales sin un registro anual verificable.');
        const name = studentName(raw.student_name);
        const legacyEvidence = (raw.legacy_evidence || []).filter(row => names.includes(row.entity_type) && number(row.count) > 0);
        return { year, studentName: name, generatedAt: raw.generated_at, filename: filename(name, year), summary, sections,
            metrics: { subjects: rows.subjects.length, tasks: tasks.length, completed: taskCounts.completed, evaluations: rows.evaluations.length,
                average, gradeState: gradeState(average), attendance: attendance.total ? attendance.percentage : null, projects: projects.length, resources: rows.resources.length },
            taskCounts, legacyEvidence, history: { tasks: { total: tasks.length, retained: tasks.length-countDeleted('tasks'), deleted: countDeleted('tasks') } } };
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
    // Presentation only: never change the normalized academic totals or source rows.
    function formatReportStatus(value, feminine = false) {
        const complete = feminine ? 'Completada' : 'Completado';
        const labels = { preparing: 'En preparación', scheduled: 'Programada', completed: complete, pending: 'Pendiente',
            pending_internal: 'Pendiente', completed_internal: complete, cancelled: 'Cancelada', paused: 'Pausado',
            in_progress: 'En progreso', overdue: 'Vencida', upcoming: 'Próxima', Completado: complete };
        return Object.hasOwn(labels,value) ? labels[value] : (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ ]+$/.test(text(value)) ? text(value) : 'Sin especificar');
    }
    function formatEvaluationStatus(value) { return formatReportStatus(value, true); }
    function presentSection(item) {
        const historical = value => value === 'Eliminada posteriormente';
        const hasHistory = item.body.some(row => row.some(historical));
        const rowHistory = value => historical(value) ? value : '';
        const base = { ...item, note: '', secondary: true, empty: EMPTY };
        const historyNote = count => count ? ` · ${count} ${count===1 ? 'eliminación posterior' : 'eliminaciones posteriores'}` : '';
        const removed = item.body.filter(row => row.some(historical)).length;
        switch (item.title) {
        case 'Materias del año':
            return { ...base, title: 'MATERIAS DEL AÑO', secondary: false, kind: 'subjects',
                note: `${item.body.length} ${item.body.length===1 ? 'materia registrada' : 'materias registradas'} · ${item.body.length-removed} ${item.body.length-removed===1 ? 'activa' : 'activas'} · ${removed} ${removed===1 ? 'eliminada' : 'eliminadas'} posteriormente.`,
                headers: ['Materia','Tareas','Evaluaciones','Calificaciones','Promedio','Estado'], widths: [45,17,25,27,34,26],
                body: item.body.map(row => [...row.slice(0,5), historical(row[5]) ? row[5] : 'Activa']) };
        case 'Tareas del año':
            return { ...base, title: 'ACTIVIDAD DE TAREAS', secondary: false,
                headers: ['Tarea','Materia','Fecha','Estado','Prioridad',...(hasHistory ? ['Historial'] : [])],
                widths: hasHistory ? [47,25,31,23,21,27] : [57,35,36,26,20],
                body: item.body.map(row => [row[0],row[1],row[2].replace(/\s*·\s*/, '\n'),formatReportStatus(row[3],true),row[5],...(hasHistory ? [rowHistory(row[4])] : [])]) };
        case 'Evaluaciones':
            return { ...base, title: 'EVALUACIONES', note: `${item.body.length} ${item.body.length===1 ? 'evaluación registrada' : 'evaluaciones registradas'}${historyNote(removed)}.`,
                headers: ['Evaluación','Materia','Tipo','Fecha','Estado',...(hasHistory ? ['Historial'] : [])],
                widths: hasHistory ? [36,31,23,30,27,27] : [43,34,26,34,37],
                body: item.body.map(row => { const split=row[0].lastIndexOf(' / '); return [split<0 ? row[0] : row[0].slice(0,split),split<0 ? 'Sin materia' : row[0].slice(split+3),row[1],row[2],formatEvaluationStatus(row[3]),...(hasHistory ? [rowHistory(row[4])] : [])]; }) };
        case 'Rendimiento académico': {
            const hasDeletedGrades = item.body.some(row => number(row[2]) > 0);
            return { ...base, title: 'RENDIMIENTO ACADÉMICO', secondary: false,
                note: 'El promedio considera las calificaciones vigentes: parciales 70% y examen 30%, por periodo y materia. Las calificaciones eliminadas o sustituidas se mantienen en el historial, sin afectar el promedio.',
                headers: ['Materia','Calificaciones',...(hasDeletedGrades ? ['Eliminadas'] : []),'Promedio','Desempeño'],
                widths: hasDeletedGrades ? [49,26,25,28,46] : [62,29,32,51],
                body: [...item.body].sort((a,b)=>a[0].localeCompare(b[0],'es')).map(row => [row[0],row[1],...(hasDeletedGrades ? [row[2]] : []),row[3],row[4]]) };
        }
        case 'Asistencia':
            return { ...base, title: 'ASISTENCIA', secondary: false, empty: 'No se registraron asistencias durante este año lectivo.' };
        case 'Metas':
            return { ...base, title: 'METAS', cards: item.body.map(row=>row.map((cell,index)=>index===2 ? formatReportStatus(cell,true) : cell)), note: item.body.length ? `${item.body.length} ${item.body.length===1 ? 'meta registrada' : 'metas registradas'}${historyNote(removed)}.` : '', empty: 'No se registraron metas durante este año lectivo.',
                headers: ['Meta / materia','Progreso','Estado','Fecha',...(hasHistory ? ['Historial'] : [])],
                body: item.body.map(row => [row[0],row[1],formatReportStatus(row[2],true),row[3],...(hasHistory ? [rowHistory(row[4])] : [])]) };
        case 'Proyectos':
            return { ...base, title: 'PROYECTOS', cards: item.body.map(row=>row.map((cell,index)=>index===4 ? formatReportStatus(cell) : cell)), note: item.body.length ? `${item.body.length} ${item.body.length===1 ? 'proyecto registrado' : 'proyectos registrados'}${historyNote(removed)}.` : '', empty: 'No se registraron proyectos durante este año lectivo.',
                headers: ['Proyecto','Progreso','Etapas','Subtareas','Estado',...(hasHistory ? ['Historial'] : [])],
                body: item.body.map(row => [...row.slice(0,4),formatReportStatus(row[4]),...(hasHistory ? [rowHistory(row[5])] : [])]) };
        case 'Etapas y subtareas':
            return { ...base, title: 'DETALLE DE PROYECTOS',
                headers: ['Elemento / proyecto','Etapa','Estado','Fecha',...(hasHistory ? ['Historial'] : [])],
                widths: hasHistory ? [53,28,25,37,31] : [69,37,26,42],
                body: item.body.map(row => [row[0],row[1],formatReportStatus(row[2]),row[3],...(hasHistory ? [rowHistory(row[4])] : [])]) };
        case 'Calendario y eventos':
            return { ...base, title: 'CALENDARIO Y EVENTOS', empty: 'No se registraron eventos independientes durante este año lectivo.',
                note: item.body.length ? `${item.body.length} ${item.body.length===1 ? 'evento independiente' : 'eventos independientes'}${historyNote(removed)}.` : '',
                headers: ['Evento / materia','Tipo','Fecha',...(hasHistory ? ['Historial'] : [])],
                widths: hasHistory ? [64,32,44,34] : [84,38,52],
                body: item.body.map(row => [...row.slice(0,3),...(hasHistory ? [rowHistory(row[3])] : [])]) };
        case 'Mochila y recursos':
            return { ...base, title: 'RECURSOS DE ESTUDIO', note: `${item.body.length} ${item.body.length===1 ? 'recurso guardado' : 'recursos guardados'}${historyNote(removed)}.`,
                headers: ['Recurso','Materia','Tipo',...(hasHistory ? ['Historial'] : [])], widths: hasHistory ? [63,49,28,34] : [80,60,34],
                body: item.body.map(row => [...row.slice(0,3),...(hasHistory ? [rowHistory(row[3])] : [])]) };
        case 'Progreso del año': return { ...base, title: 'PROGRESO DEL ESTUDIANTE', secondary: false };
        default: return base;
        }
    }
    async function createDocument(report) {
        const [jsPDF, logo] = await Promise.all([libraries(), logoData()]);
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        doc.setProperties({ title: 'Reporte académico anual ' + report.year.label, author: 'AC Edunity', subject: 'Historial y balance del año lectivo', creator: 'AC Edunity' });
        const ink = [26,36,65], accent = [104,74,194], blue = [41,108,201], muted = [79,91,112], line = [221,226,236], paper = [247,249,252];
        const success = [56,139,106], warning = [177,122,36], danger = [184,87,87];
        const spacing = { section: 10, table: 6, cards: 5, divider: 4 };
        const generated = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'long', timeStyle: 'short', hour12: true }).format(new Date(report.generatedAt));
        const generatedDate = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'long' }).format(new Date(report.generatedAt));
        const whitePaper = () => { doc.saveGraphicsState(); doc.setFillColor(255,255,255); doc.rect(0,0,210,297,'F'); doc.restoreGraphicsState(); };
        whitePaper(); doc.internal.events.subscribe('addPage', whitePaper);
        let y = 31;
        function font(size, style = 'normal', color = ink) { doc.setFont('helvetica',style); doc.setFontSize(size); doc.setTextColor(...color); }
        function lines(value, width, size = 9) { font(size); return String(value ?? '').split(/\r?\n/).flatMap(part=>doc.splitTextToSize(text(part),width)); }
        function write(value, x, top, width, size = 9, color = muted, style = 'normal') {
            font(size,style,color);
            const parts = doc.splitTextToSize(text(value),width);
            doc.text(parts,x,top,{ lineHeightFactor: 1.2 });
            return parts.length * size * .3528 * 1.2;
        }
        function ensureSpace(height) {
            if (y + height <= 273) return false;
            doc.addPage(); y = 31; return true;
        }
        function drawSectionHeader(title, note = '', reserve = 20, secondary = false, options = {}) {
            const noteHeight = note ? lines(note,174,8.5).length * 8.5 * .3528 * 1.2 + 4 : 0;
            const separation = y > 31 ? options.separation || 0 : 0;
            const moved = ensureSpace(separation + (secondary ? 7 : 9) + noteHeight + reserve);
            if (!moved && separation) {
                if (options.divider) { doc.setDrawColor(...line);doc.setLineWidth(.2);doc.line(18,y-2,192,y-2);doc.setDrawColor(...accent);doc.line(18,y-2,34,y-2); }
                y += separation;
            }
            doc.setDrawColor(...(secondary ? line : accent)); doc.setLineWidth(secondary ? .4 : .8); doc.line(18,y-4,18,y+1);
            font(secondary ? 11 : 15,'bold',ink); doc.text(title,22,y); y += secondary ? 7 : 9;
            if (note) y += write(note,18,y,174,8.5) + 4;
        }
        function drawMetricCard(x, top, width, label, value, height = 31, centered = false) {
            doc.setFillColor(255,255,255); doc.setDrawColor(...line); doc.setLineWidth(.2); doc.roundedRect(x,top,width,height,1.5,1.5,'FD');
            const textX = centered ? x+width/2 : x+5, alignment = centered ? 'center' : 'left';
            const accentX = centered ? textX-3.5 : x+5;
            doc.setDrawColor(...blue); doc.setLineWidth(.6); doc.line(accentX,top+5,accentX+7,top+5);
            let size=19; font(size,'bold',ink);
            while(doc.getTextWidth(String(value)) > width-10 && size > 9) font(--size,'bold',ink);
            doc.text(String(value),textX,top+16,{align:alignment});
            font(8,'normal',muted);doc.text(doc.splitTextToSize(text(label),width-10),textX,top+23,{align:alignment});
        }
        function drawMetricGrid(metrics, columns = 4, height = 31, after = 4, options = {}) {
            const gap=spacing.cards, width=(174-gap*(columns-1))/columns, total=Math.ceil(metrics.length/columns)*(height+gap);
            // Keep the complete grid and its trailing notes together, never individual rows.
            ensureSpace(total+after+(options.tail || 0));
            metrics.forEach((item,index) => drawMetricCard(18+(index%columns)*(width+gap),y+Math.floor(index/columns)*(height+gap),width,item[0],item[1],height,options.centered));
            y += total+after;
        }
        function drawProgressBar(label, value, max = 100, color = blue) {
            font(9,'bold',ink); const labelLines = doc.splitTextToSize(text(label),140);
            ensureSpace(Math.max(6,labelLines.length*3.8)+15);
            doc.text(labelLines,18,y); font(9,'normal',muted);
            doc.text(value === null ? 'Sin datos' : (max === 10 ? fixed(value)+' / 10' : String(value)+'%'),192,y,{align:'right'});
            y += Math.max(6,labelLines.length*3.8);
            doc.setFillColor(233,237,245); doc.roundedRect(18,y,174,4,1.6,1.6,'F');
            const ratio = value === null ? 0 : Math.max(0,Math.min(1,Number(value)/max));
            if (ratio > 0) { doc.setFillColor(...color); doc.roundedRect(18,y,174*ratio,4,Math.min(1.6,87*ratio),1.6,'F'); }
            y += 11;
        }
        function drawStatusBadge(label, x, top) {
            const good = /excelente|completad/i.test(label), approved=/aprobado/i.test(label), improve=/necesita mejorar/i.test(label);
            font(9,'bold',good ? success : approved ? blue : improve ? warning : muted);
            const width = Math.min(78,doc.getTextWidth(label)+8);
            doc.setFillColor(...(good ? [238,247,242] : improve ? [252,246,234] : [241,245,251])); doc.roundedRect(x,top-4,width,8,2,2,'F');
            doc.text(label,x+4,top+1);
        }
        function drawEmptyState(message = EMPTY, after = spacing.section) {
            const content = lines(message,162,9), height = content.length*3.9+10;
            ensureSpace(height+8); doc.setFillColor(...paper); doc.setDrawColor(...line); doc.setLineWidth(.2);
            doc.roundedRect(18,y,174,height,2,2,'FD'); write(message,24,y+7,162,9); y += height+after;
        }
        function columnWidths(item) {
            if (item.widths) return item.widths;
            return item.headers.map(() => 174/item.headers.length);
        }
        function tableHeight(item) {
            const widths=columnWidths(item), sample=item.body.length<=8 ? item.body : item.body.slice(0,1);
            const rowHeight=row=>Math.max(...row.map((cell,i)=>lines(cell,widths[i]-6,8.5).length))*8.5*.35278*1.15+6;
            const height=rowHeight(item.headers)+sample.reduce((sum,row)=>sum+rowHeight(row),0)+1.5;
            return height <= 205 ? height : rowHeight(item.headers) + rowHeight(sample[0]);
        }
        function drawTable(item) {
            const widths=columnWidths(item);
            ensureSpace(tableHeight(item));
            doc.autoTable({
                startY:y, margin:{top:28,right:18,bottom:24,left:18}, tableWidth:174,
                head:[item.headers], body:item.body, theme:'striped', showHead:'everyPage', rowPageBreak:'avoid',
                columnStyles:Object.fromEntries(widths.map((width,index)=>[index,{cellWidth:width}])),
                styles:{font:'helvetica',fontSize:8.5,cellPadding:spacing.table/2,textColor:ink,lineColor:line,lineWidth:{bottom:.1},overflow:'linebreak',valign:'middle'},
                headStyles:{fillColor:[237,241,248],textColor:ink,fontStyle:'bold',fontSize:8.5},
                bodyStyles:{fillColor:[255,255,255]},alternateRowStyles:{fillColor:paper},
                didParseCell(data) {
                    if (data.section !== 'body') return;
                    const content=String(data.cell.raw);
                    if (item.kind==='subjects') {
                        data.cell.styles.cellPadding={top:2.9,bottom:2.9,left:3,right:3};
                        if(content==='Sin calificaciones') data.cell.styles.textColor=muted;
                    }
                    if (/^Eliminad/.test(content)) data.cell.styles.textColor=danger;
                    else if (/^(Completad|Excelente)/i.test(content)) data.cell.styles.textColor=success;
                    else if (/^Aprobado/i.test(content)) data.cell.styles.textColor=blue;
                    else if (/^Necesita mejorar/i.test(content)) data.cell.styles.textColor=warning;
                }
            });
            y=doc.lastAutoTable.finalY+(item.kind==='subjects' ? spacing.table+2 : spacing.section);
        }
        function drawTaskBalance() {
            const counts=report.taskCounts;
            const groups=[['Completadas',counts.completed,[68,131,116]],['Pendientes',counts.pending,[67,115,176]],
                ['Próximas',counts.upcoming,[112,102,181]],['Vencidas',counts.overdue,[187,119,104]],['Eliminadas sin completar',counts.deleted,[139,145,160]]];
            const total=report.metrics.tasks;
            ensureSpace(39); font(9,'bold'); doc.text('Distribución de tareas creadas',18,y); y+=7;
            let x=18;
            doc.setFillColor(233,237,245); doc.rect(x,y,174,5,'F');
            groups.forEach(([,count,color])=>{const width=total ? count/total*174 : 0;if(width){doc.setFillColor(...color);doc.rect(x,y,width,5,'F');x+=width;}});
            y+=12;
            groups.forEach(([label,count,color],index)=>{const column=index%2,row=Math.floor(index/2);doc.setFillColor(...color);doc.circle(19+column*88,y+row*5-1,1,'F');write(label+': '+count,23+column*88,y+row*5,82,8);});
            y+=21;
        }
        const totals = new Map(report.summary);
        const total = key => totals.get(key) ?? 0;
        function drawActivityBalance() {
            drawSectionHeader('BALANCE DE ACTIVIDAD','',58,true);
            const columns = [
                ['Tareas', [['Completadas',report.taskCounts.completed],['Pendientes sin vencer',report.taskCounts.pending],['Próximas',report.taskCounts.upcoming],['Vencidas',report.taskCounts.overdue],['Eliminadas sin completar',report.taskCounts.deleted],['Eliminadas en total',report.history.tasks.deleted]]],
                ['Registros académicos', [['Calificaciones registradas',total('Calificaciones registradas (casilleros)')],['Calificaciones eliminadas',total('Calificaciones eliminadas (casilleros)')],['Asistencias registradas',total('Registros de asistencia creados')],['Evaluaciones completadas',total('Evaluaciones completadas')],['Metas registradas',total('Metas creadas')],['Proyectos completados',total('Proyectos completados')],['Eventos independientes',total('Eventos del calendario')]]]
            ];
            columns.forEach(([title,entries],index)=>{
                const x=18+index*90;
                font(9,'bold',ink);doc.text(title,x,y);
                doc.setDrawColor(...line);doc.setLineWidth(.2);doc.line(x,y+3,x+84,y+3);
                entries.forEach(([label,value],row)=>{const top=y+10+row*6;write(label,x,top,70,8.5);font(9,'bold',ink);doc.text(String(value),x+84,top,{align:'right'});});
            });
            y+=55;
        }
        function barAt(x,top,width,value,max=100,color=blue) {
            doc.setFillColor(233,237,245);doc.roundedRect(x,top,width,3.5,1.2,1.2,'F');
            const ratio=value===null ? 0 : Math.max(0,Math.min(1,number(value)/max));
            if(ratio>0){doc.setFillColor(...color);doc.roundedRect(x,top,width*ratio,3.5,Math.min(1.2,width*ratio/2),1.2,'F');}
        }
        function drawSpotlight(label,value,max,badge='',after=9) {
            ensureSpace(49);doc.setFillColor(...paper);doc.setDrawColor(...line);doc.setLineWidth(.2);doc.roundedRect(18,y,174,42,2,2,'FD');
            const centered=max===100, textX=centered ? 105 : 24, alignment=centered ? 'center' : 'left';
            font(8.5,'bold',muted);doc.text(label,textX,y+9,{align:alignment});
            font(25,'bold',ink);doc.text(value===null ? 'Sin datos' : max===10 ? fixed(value)+' / 10' : value+'%',textX,y+24,{align:alignment});
            if(badge)drawStatusBadge(badge,136,y+20);
            barAt(24,y+32,162,value,max,accent);y+=42+after;
        }
        function drawPlanCards(item) {
            item.cards.forEach(row=>{
                const project=item.title==='PROYECTOS', titleWidth=project ? 132 : 162;
                const titleHeight=lines(row[0],titleWidth,10).length*4.3;
                const history=row[project ? 5 : 4]==='Eliminada posteriormente' ? ' · Eliminada posteriormente' : '';
                if(project){
                    const height=titleHeight+31+(history ? 6 : 0);
                    ensureSpace(height+spacing.cards);doc.setFillColor(255,255,255);doc.setDrawColor(...line);doc.setLineWidth(.2);doc.roundedRect(18,y,174,height,2,2,'FD');
                    write(row[0],24,y+8,titleWidth,10,ink,'bold');font(13,'bold',accent);doc.text(row[1],186,y+8,{align:'right'});
                    const barTop=y+titleHeight+12;barAt(24,barTop,162,parseFloat(row[1]),100,accent);
                    write(row[4],24,barTop+12,50,9);write('Etapas: '+row[2],80,barTop+12,50,9);write('Subtareas: '+row[3],136,barTop+12,50,9);
                    if(history)write(history.slice(3),24,barTop+18,162,8.5);
                    y+=height+spacing.cards;return;
                }
                const detail=project ? `${row[4]} · Etapas: ${row[2]} · Subtareas: ${row[3]}${history}` : `${row[2]} · Fecha: ${row[3]}${history}`;
                const detailHeight=lines(detail,162,8.5).length*3.6, height=titleHeight+detailHeight+24;
                ensureSpace(height+8);doc.setFillColor(255,255,255);doc.setDrawColor(...line);doc.setLineWidth(.2);doc.roundedRect(18,y,174,height,2,2,'FD');
                write(row[0],24,y+8,162,10,ink,'bold');
                const top=y+titleHeight+14;
                font(9,'bold',accent);doc.text(row[1],186,top,{align:'right'});barAt(24,top-3,139,parseFloat(row[1]),100,accent);
                write(detail,24,top+8,162,8.5);y+=height+8;
            });
        }
        // Institutional white cover; the official logo and the student's supplied name stay unchanged.
        doc.setDrawColor(...line);doc.setLineWidth(.3);doc.line(18,23,192,23);
        doc.setDrawColor(...blue);doc.setLineWidth(1);doc.line(18,23,41,23);doc.setDrawColor(...accent);doc.line(41,23,53,23);
        doc.saveGraphicsState(); doc.circle(105,43,14,null); doc.clip(); doc.discardPath();
        doc.addImage(logo,'PNG',91,29,28,28,undefined,'FAST'); doc.restoreGraphicsState();
        font(12,'bold',blue); doc.text('AC EDUNITY',105,74,{align:'center'});
        font(24,'bold',ink); doc.text('REPORTE ACADÉMICO ANUAL',105,96,{align:'center'});
        font(13,'normal',muted); doc.text('Año lectivo '+report.year.label,105,110,{align:'center'});
        doc.setLineWidth(.8); doc.setDrawColor(...blue); doc.line(75,124,105,124);doc.setDrawColor(...accent);doc.line(105,124,135,124);
        doc.setFillColor(...paper);doc.roundedRect(18,144,174,70,2,2,'F');
        font(9,'bold',accent);doc.text('ESTUDIANTE',24,155);
        const nameHeight=write(report.studentName,24,168,162,19,ink,'bold');
        const dateTop=Math.max(191,170+nameHeight);
        font(9,'bold',accent);doc.text('FECHA DE GENERACIÓN',24,dateTop);write(generatedDate,24,dateTop+10,162,10);
        font(10,'normal',blue);doc.text('Generado por AC Edunity',105,244,{align:'center'});
        font(9,'normal',muted);doc.text('Gestión educativa inteligente y personalizada',105,253,{align:'center'});
        font(9,'normal',muted);doc.text('edunity.me',105,262,{align:'center'});
        doc.addPage(); y=32;
        drawSectionHeader('RESUMEN ACADÉMICO DEL AÑO','Año lectivo '+report.year.label,76);
        drawMetricGrid([['Materias',report.metrics.subjects],['Tareas creadas',report.metrics.tasks],['Tareas completadas',report.metrics.completed],['Evaluaciones',report.metrics.evaluations],
            ['Promedio general',report.metrics.average===null ? 'Sin datos' : fixed(report.metrics.average)+' / 10'],['Asistencia',report.metrics.attendance===null ? 'Sin datos' : report.metrics.attendance+'%'],['Proyectos',report.metrics.projects],['Recursos',report.metrics.resources]]);
        drawActivityBalance();
        drawTaskBalance();
        y+=write(`Tareas vigentes: ${report.history.tasks.retained} · Eliminadas posteriormente: ${report.history.tasks.deleted}. Pendientes en total: ${total('Tareas pendientes (incluye próximas y vencidas)')} (incluye próximas y vencidas).`,18,y,174,8)+4;
        write('Las completadas incluyen las eliminadas después de completarse. La actividad anterior al historial completo se presenta por separado cuando no existe información detallada.',18,y,174,8);
        doc.addPage();y=31;
        report.sections.forEach(source=>{
            const item=presentSection(source);
            const compactPlans=item.cards?.length>0 && item.cards.length<=3;
            const isProgress=item.title==='PROGRESO DEL ESTUDIANTE', values=isProgress ? new Map(item.body) : null, value=key=>values?.get(key) ?? 0;
            const progressNote='Estos indicadores corresponden únicamente a la actividad registrada en el año lectivo seleccionado.';
            const pointsNote='Puntos de actividad del año: '+value('Puntos de actividad')+'.';
            const progressTail=isProgress ? lines(progressNote,174,9).length*9*.3528*1.2+3+lines(pointsNote,174,8.5).length*8.5*.3528*1.2+3+(report.legacyEvidence.length ? 0 : 42) : 0;
            const extra=item.kind==='grades' ? 61 : item.kind==='attendance' ? 100 : item.kind==='tasks' ? 10 : 0;
            const reserve=compactPlans ? 45 : isProgress ? 2*(27+spacing.cards)+progressTail : item.body.length ? Math.min(195,tableHeight(item)+extra) : 22;
            drawSectionHeader(item.title,item.note,reserve,item.secondary,item.kind==='tasks' ? {separation:spacing.divider,divider:true} : {});
            if (item.kind==='grades') {
                drawSpotlight('PROMEDIO GENERAL',report.metrics.average,10,report.metrics.gradeState);
                font(9,'bold',ink);doc.text('RENDIMIENTO POR MATERIA',18,y);y+=7;
            }
            if(item.kind==='tasks'){
                const pending=total('Tareas pendientes (incluye próximas y vencidas)');
                y+=write(`${report.metrics.tasks} ${number(report.metrics.tasks)===1 ? 'creada' : 'creadas'} · ${report.taskCounts.completed} ${number(report.taskCounts.completed)===1 ? 'completada' : 'completadas'} · ${pending} ${number(pending)===1 ? 'pendiente' : 'pendientes'} · ${report.taskCounts.overdue} ${number(report.taskCounts.overdue)===1 ? 'vencida' : 'vencidas'}`,18,y,174,9,muted)+4;
            }
            if(item.kind==='attendance' && item.body.length){
                drawSpotlight('ASISTENCIA GENERAL',report.metrics.attendance,100,'',spacing.table);
                const kept=item.body[0],removed=item.body[1];
                drawMetricGrid([['Presentes',kept[1]],['Faltas',kept[2]],['Atrasos',kept[3]],['Justificadas',kept[4]]],4,29,0,{centered:true});
                const count=total('Registros de asistencia creados');
                y+=write(`${count} ${number(count)===1 ? 'asistencia registrada' : 'asistencias registradas'} · ${kept[5]} ${number(kept[5])===1 ? 'vigente' : 'vigentes'} · ${removed[5]} ${number(removed[5])===1 ? 'eliminada' : 'eliminadas'} posteriormente.`,18,y,174,8.5)+5;
                if(number(removed[5])) y+=write(`Historial eliminado: Presentes ${removed[1]} · Faltas ${removed[2]} · Atrasos ${removed[3]} · Justificadas ${removed[4]}.`,18,y,174,8.5)+5;
            } else if(isProgress){
                drawMetricGrid([['XP del año',value('XP del año lectivo')],['Nivel alcanzado',value('Nivel según XP del año')],['Días activos',value('Días con actividad registrada')],['Actividades registradas',value('Actividad registrada')],['Racha',value('Racha almacenada en el año')],['Tareas completadas',value('Tareas completadas')]],3,27,0,{tail:progressTail});
                y+=write(progressNote,18,y,174,9)+3;
                y+=write(pointsNote,18,y,174,8.5)+3;
            } else if(compactPlans) drawPlanCards(item);
            else if(item.body.length) drawTable(item);
            else drawEmptyState(item.empty,item.title==='METAS' ? spacing.table : spacing.section);
        });
        if (report.legacyEvidence.length) {
            const labels={tasks:'Tareas',grades:'Calificaciones',attendance:'Asistencia',events:'Eventos',resources:'Recursos'};
            const historyTable={headers:['Tipo de actividad','Registros anteriores'],body:report.legacyEvidence.map(row=>[labels[row.entity_type]||'Actividad académica',String(row.count)])};
            // The short history table and editorial closing are one final keep-together block.
            drawSectionHeader('REGISTROS HISTÓRICOS ANTERIORES','Antes de habilitar el historial completo de AC Edunity se registraron algunas actividades cuya información detallada ya no se encuentra disponible. Estas cifras se muestran únicamente como referencia y no se incorporan a los totales detallados del reporte.',tableHeight(historyTable)+spacing.section+42,true,{separation:spacing.divider});
            drawTable(historyTable);
        }
        ensureSpace(42);doc.setDrawColor(...line);doc.setLineWidth(.3);doc.line(18,y,192,y);doc.setDrawColor(...blue);doc.setLineWidth(.6);doc.line(18,y,34,y);doc.setDrawColor(...accent);doc.line(34,y,42,y);y+=12;
        font(13,'bold',ink);doc.text('FIN DEL REPORTE',18,y);y+=8;
        font(10,'bold',blue);doc.text('AC Edunity · Año lectivo '+report.year.label,18,y);y+=7;
        y+=write('Este documento resume la actividad académica registrada en AC Edunity durante el año lectivo seleccionado.',18,y,174,9)+5;
        write('Generado el: '+generated+' · edunity.me',18,y,174,8);
        function drawPageHeader() {
            font(8.5,'bold');doc.text('AC EDUNITY',18,15);font(8.5,'normal',muted);doc.text(report.year.label,192,15,{align:'right'});
            doc.setDrawColor(...line);doc.setLineWidth(.2);doc.line(18,20,192,20);
        }
        function drawPageFooter(page,total) {
            doc.setDrawColor(...line);doc.setLineWidth(.2);doc.line(18,279,192,279);
            write('Reporte académico de '+report.studentName,18,285,133,7.5);
            font(7.5,'normal',muted);doc.text('Página '+page+' de '+total,192,285,{align:'right'});
            doc.text('edunity.me',192,292,{align:'right'});
        }
        const pageCount=doc.getNumberOfPages();
        for(let page=1;page<=pageCount;page++){doc.setPage(page);if(page>1)drawPageHeader();drawPageFooter(page,pageCount);}
        return doc;
    }
    root.ACAcademicReports = { normalize, filename, studentName, getStudentDisplayName, createDocument, formatEvaluationStatus, formatReportStatus, presentSection };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.ACAcademicReports;
})(typeof globalThis !== 'undefined' ? globalThis : window);
