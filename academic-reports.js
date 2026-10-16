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
    async function createDocument(report) {
        const [jsPDF, logo] = await Promise.all([libraries(), logoData()]);
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        doc.setProperties({ title: 'Reporte académico anual ' + report.year.label, author: 'AC Edunity', subject: 'Historial y balance del año lectivo', creator: 'AC Edunity' });
        const ink = [26,36,65], accent = [100,76,181], blue = [41,108,201], muted = [94,105,125], line = [221,226,237], paper = [249,250,253];
        const generated = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'long', timeStyle: 'short', hour12: true }).format(new Date(report.generatedAt));
        const whitePaper = () => { doc.saveGraphicsState(); doc.setFillColor(255,255,255); doc.rect(0,0,210,297,'F'); doc.restoreGraphicsState(); };
        whitePaper(); doc.internal.events.subscribe('addPage', whitePaper);
        let y = 31;
        function font(size, style = 'normal', color = ink) { doc.setFont('helvetica',style); doc.setFontSize(size); doc.setTextColor(...color); }
        function lines(value, width, size = 9) { font(size); return doc.splitTextToSize(text(value),width); }
        function write(value, x, top, width, size = 9, color = muted, style = 'normal') {
            font(size,style,color);
            const parts = doc.splitTextToSize(text(value),width);
            doc.text(parts,x,top,{ lineHeightFactor: 1.2 });
            return parts.length * size * .3528 * 1.2;
        }
        function ensureSpace(height) { if (y + height > 273) { doc.addPage(); y = 31; } }
        function drawSectionHeader(title, note = '', reserve = 20) {
            const noteLines = note ? lines(note,174,9) : [];
            ensureSpace(12 + noteLines.length * 3.9 + reserve);
            doc.setDrawColor(...accent); doc.setLineWidth(.8); doc.line(18,y-4,18,y+1);
            font(15,'bold',ink); doc.text(title,22,y); y += 8;
            if (note) y += write(note,18,y,174,9) + 4;
        }
        function drawMetricCard(x, top, width, label, value) {
            doc.setFillColor(...paper); doc.setDrawColor(...line); doc.setLineWidth(.2); doc.roundedRect(x,top,width,31,2,2,'FD');
            doc.setDrawColor(...blue); doc.setLineWidth(.6); doc.line(x+5,top+5,x+12,top+5);
            font(String(value).length > 10 ? 10 : 19,'bold',ink); doc.text(String(value),x+5,top+17);
            write(label,x+5,top+24,width-10,8,muted);
        }
        function drawMetricGrid(metrics) {
            ensureSpace(72);
            metrics.forEach((item,index) => drawMetricCard(18+(index%4)*45.5,y+Math.floor(index/4)*37,37.5,item[0],item[1]));
            y += 78;
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
            const good = /aprobado|excelente/i.test(label);
            font(9,'bold',good ? [42,105,85] : muted);
            const width = Math.min(78,doc.getTextWidth(label)+8);
            doc.setFillColor(...(good ? [235,246,241] : [242,242,249])); doc.roundedRect(x,top-4,width,8,2,2,'F');
            doc.text(label,x+4,top+1);
        }
        function drawEmptyState() {
            const content = lines(EMPTY,162,9), height = content.length*3.9+12;
            ensureSpace(height+8); doc.setFillColor(...paper); doc.setDrawColor(...line); doc.setLineWidth(.2);
            doc.roundedRect(18,y,174,height,2,2,'FD'); write(EMPTY,24,y+8,162,9); y += height+12;
        }
        function columnWidths(item) {
            if (item.kind === 'tasks') return [53,25,27,24,27,18];
            if (item.kind === 'grades') return [50,22,22,30,50];
            if (item.title === 'Materias del año') return [47,17,26,16,28,40];
            return item.headers.map(() => 174/item.headers.length);
        }
        function tableHeight(item) {
            const widths=columnWidths(item), sample=item.body.length<=8 ? item.body : item.body.slice(0,1);
            const rowHeight=row=>Math.max(...row.map((cell,i)=>lines(cell,widths[i]-4.8,8.3).length))*3.5+4.8;
            const height=12+sample.reduce((sum,row)=>sum+rowHeight(row),0);
            return height <= 210 ? height : 12 + rowHeight(sample[0]);
        }
        function drawTable(item) {
            const widths=columnWidths(item);
            ensureSpace(tableHeight(item));
            doc.autoTable({
                startY:y, margin:{top:28,right:18,bottom:24,left:18}, tableWidth:174,
                head:[item.headers], body:item.body, theme:'grid', showHead:'everyPage', rowPageBreak:'avoid',
                columnStyles:Object.fromEntries(widths.map((width,index)=>[index,{cellWidth:width}])),
                styles:{font:'helvetica',fontSize:8.3,cellPadding:2.4,textColor:ink,lineColor:line,lineWidth:.15,overflow:'linebreak'},
                headStyles:{fillColor:[235,238,247],textColor:ink,fontStyle:'bold',fontSize:8.3},
                bodyStyles:{fillColor:[255,255,255]},alternateRowStyles:{fillColor:[250,251,253]},
                didParseCell(data) {
                    if (data.section !== 'body') return;
                    const content=String(data.cell.raw);
                    if (/^Eliminad/.test(content)) data.cell.styles.textColor=[127,80,92];
                    else if (/^(Completad|Aprobado|Excelente)/i.test(content)) data.cell.styles.textColor=[42,105,85];
                }
            });
            y=doc.lastAutoTable.finalY+13;
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
        // Formal white cover, with the existing official circular logo.
        doc.saveGraphicsState(); doc.circle(105,43,14,null); doc.clip(); doc.discardPath();
        doc.addImage(logo,'PNG',91,29,28,28,undefined,'FAST'); doc.restoreGraphicsState();
        font(12,'bold',blue); doc.text('AC EDUNITY',105,74,{align:'center'});
        font(26,'bold',ink); doc.text('REPORTE ACADÉMICO ANUAL',105,97,{align:'center'});
        font(13,'normal',muted); doc.text('Año lectivo '+report.year.label,105,112,{align:'center'});
        doc.setLineWidth(.8); doc.setDrawColor(...blue); doc.line(75,124,105,124);doc.setDrawColor(...accent);doc.line(105,124,135,124);
        doc.setFillColor(...paper); doc.roundedRect(18,144,174,43,2,2,'F');
        font(9,'bold',accent); doc.text('ESTUDIANTE',24,155);
        write(report.studentName,24,167,162,19,ink,'bold');
        font(9,'bold',accent);doc.text('FECHA DE GENERACIÓN',18,207);write(generated,18,217,174,10);
        font(10,'normal',blue);doc.text('Generado por AC Edunity',105,251,{align:'center'});
        font(9,'normal',muted);doc.text('Gestión educativa inteligente y personalizada',105,260,{align:'center'});
        doc.addPage(); y=32;
        drawSectionHeader('RESUMEN DEL AÑO LECTIVO','Totales recuperables del ciclo: registros conservados y snapshots de eliminaciones. El promedio y la asistencia general utilizan registros conservados.',76);
        drawMetricGrid([['Materias creadas',report.metrics.subjects],['Tareas creadas',report.metrics.tasks],['Tareas completadas',report.metrics.completed],['Evaluaciones',report.metrics.evaluations],
            ['Promedio general',report.metrics.average===null ? 'Sin datos' : fixed(report.metrics.average)+' / 10'],['Asistencia',report.metrics.attendance===null ? 'Sin datos' : report.metrics.attendance+'%'],['Proyectos',report.metrics.projects],['Recursos',report.metrics.resources]]);
        drawSectionHeader('Balance académico','Las categorías no se duplican: las completadas incluyen las eliminadas después de completarse. Las demás eliminadas se cuentan aparte.',65);
        drawTaskBalance();
        write('Conservadas: '+report.history.tasks.retained+' · Eliminadas posteriormente: '+report.history.tasks.deleted+' · Total creado: '+report.history.tasks.total,18,y,174,9);
        y+=14;
        write('Cobertura: los snapshots completos comienzan al habilitar este historial. Las acciones anteriores sin fila recuperable se identifican por separado; no se inventan registros.',18,y,174,8.5);
        doc.addPage();y=31;
        drawSectionHeader('Balance del año','Indicadores acumulados del ciclo y estado actual/final, sin mezclar totales históricos con registros conservados.',50);
        drawTable({headers:['Indicador del año','Resultado'],body:report.summary.map(row=>row.map(text))});
        report.sections.forEach(item=>{
            const progressHeight=(item.progress || []).reduce((height,row)=>height+Math.max(6,lines(row.title+' · '+row.record,140,9).length*3.8)+11,0);
            const extra=item.kind==='grades' ? 40 : item.kind==='attendance' ? 22 : progressHeight;
            const noteHeight=lines(item.note,174,9).length*3.9+10;
            const reserve=item.body.length ? tableHeight(item)+extra : 40;
            drawSectionHeader(item.title,item.note,noteHeight+reserve<=242 ? reserve : 35+extra);
            if (item.kind==='grades') {
                drawProgressBar('Promedio final de registros conservados',report.metrics.average,10,accent);
                ensureSpace(14);drawStatusBadge(report.metrics.gradeState,18,y);y+=14;
            }
            if (item.kind==='attendance') drawProgressBar('Asistencia general (registros conservados)',report.metrics.attendance);
            if (item.progress) item.progress.forEach(row=>drawProgressBar(row.title+' · '+row.record,row.value,100,accent));
            if (item.body.length) drawTable(item); else drawEmptyState();
        });
        if (report.legacyEvidence.length) {
            const labels={tasks:'Tareas',grades:'Calificaciones (grupos)',attendance:'Asistencia',events:'Eventos',resources:'Recursos'};
            drawSectionHeader('Evidencia anterior sin snapshot','Actividad verificable cuyo registro fuente ya no está disponible. No permite reconstruir títulos, fechas límite ni notas. Estas cifras NO se suman a los totales de registros completos.',40);
            drawTable({headers:['Entidad','Registros fuente no disponibles'],body:report.legacyEvidence.map(row=>[labels[row.entity_type]||row.entity_type,String(row.count)])});
        }
        ensureSpace(50);doc.setDrawColor(...line);doc.setLineWidth(.3);doc.line(18,y,192,y);y+=12;
        font(14,'bold',ink);doc.text('FIN DEL REPORTE',18,y);y+=8;
        font(10,'bold',blue);doc.text('AC Edunity · Año lectivo '+report.year.label,18,y);y+=8;
        y+=write('Este reporte refleja la actividad académica registrada en AC Edunity durante el año lectivo seleccionado.',18,y,174,9)+5;
        write('Fecha de generación: '+generated,18,y,174,8);
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
        const total=doc.getNumberOfPages();
        for(let page=1;page<=total;page++){doc.setPage(page);if(page>1)drawPageHeader();drawPageFooter(page,total);}
        return doc;
    }
    root.ACAcademicReports = { normalize, filename, studentName, createDocument };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.ACAcademicReports;
})(typeof globalThis !== 'undefined' ? globalThis : window);
