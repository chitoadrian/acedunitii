// Disposable academic data. Never inserted into a real Supabase project.
function createGoalsWorkspace(kind = 'showcase') {
    let sequence = 500;
    const id = () => `60000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`;
    const subjects = [{ id: id(), name: 'Investigación académica', color: '#6889C9' }, { id: id(), name: 'Diseño de proyectos', color: 'Morado' }];
    const workspace = { subjects, projects: [], goals: [], projectStages: [], projectSubtasks: [] };
    const project = (title, status = 'in_progress') => {
        const item = { id: id(), subjectId: subjects[0].id, subject: subjects[0].name, title, description: 'Datos locales desechables para comprobar la planificación, las relaciones y la presentación del mapa.', startDate: '2026-10-01', dueDate: '2026-12-20', dueTime: '15:30', priority: 'high', status, showInCalendar: false, remindersEnabled: false };
        workspace.projects.push(item); return item;
    };
    const stage = (parent, title, status = 'pending') => {
        const item = { id: id(), projectId: parent.id, title, description: 'Etapa local de prueba.', position: workspace.projectStages.filter(s => s.projectId === parent.id).length, dueDate: '2026-12-10', dueTime: '12:00', status, showInCalendar: false, remindersEnabled: false };
        workspace.projectStages.push(item); return item;
    };
    const subtask = (parent, title, status = 'pending', priority = 'medium') => {
        const item = { id: id(), projectId: parent.projectId, stageId: parent.id, taskId: '', title, description: 'Descripción legible de una actividad de prueba, sin datos académicos reales.', dueDate: '2026-12-05', dueTime: '14:00', priority, status, position: workspace.projectSubtasks.filter(t => t.stageId === parent.id).length, remindersEnabled: false };
        workspace.projectSubtasks.push(item); return item;
    };
    const goal = (title, progress, projectId = '') => {
        const item = { id: id(), subjectId: subjects[1].id, subject: subjects[1].name, projectId, title, description: 'Organizar el estudio y documentar los avances con claridad. La información de esta meta se utiliza únicamente en pruebas locales.', targetDate: '2026-12-22', priority: progress === 100 ? 'low' : 'medium', status: progress === 100 ? 'completed' : progress ? 'in_progress' : 'pending', progress, showInCalendar: false };
        workspace.goals.push(item); return item;
    };
    if (kind === 'empty-workspace') return workspace;
    if (kind === 'empty') { project('PRUEBA - Proyecto por planificar', 'pending'); return workspace; }
    if (kind === 'large') {
        const p = project('PRUEBA - Investigación académica y desarrollo de soluciones educativas');
        for (let i = 0; i < 8; i++) {
            const s = stage(p, `Etapa ${i + 1} - ${['Análisis', 'Planificación', 'Investigación', 'Diseño', 'Desarrollo', 'Validación', 'Documentación', 'Presentación'][i]}`);
            for (let j = 0; j < 12; j++) subtask(s, `Actividad ${i + 1}.${j + 1} - Revisar fuentes, analizar resultados y documentar las conclusiones del proyecto`, j % 3 === 0 ? 'completed' : 'pending', j % 2 ? 'medium' : 'high');
        }
        goal('PRUEBA - Entregar las evidencias de investigación', 35, p.id);
        return workspace;
    }
    if (kind === 'long') {
        const p = project('PRUEBA - Diseño de una estrategia de investigación académica para comprender, organizar y comunicar los resultados de proyectos educativos interdisciplinarios, con énfasis en planificación, evaluación y colaboración entre estudiantes');
        const s = stage(p, 'Etapa de análisis, revisión de antecedentes y construcción de una propuesta fundamentada con criterios verificables, fuentes académicas y decisiones metodológicas explicadas de forma clara para todos los integrantes del equipo');
        subtask(s, 'Actividad de prueba con un título extenso: recopilar las fuentes, comparar las perspectivas, registrar las evidencias y explicar cómo cada decisión contribuye al objetivo general del proyecto, sin omitir nombres, números ni contenidos académicos importantes, incluyendo términos como evaluación, organización, análisis y colaboración', 'completed', 'high');
        subtask(s, 'Revisión final de los resultados y sus conclusiones', 'pending', 'low');
        return workspace;
    }
    const p = project('PRUEBA - Organización de un proyecto académico');
    const first = stage(p, 'Definir el alcance y reunir las fuentes');
    subtask(first, 'Identificar el problema y las necesidades', 'completed', 'high');
    subtask(first, 'Revisar las fuentes académicas', 'pending', 'medium');
    subtask(first, 'Documentar las decisiones del equipo', 'in_progress', 'low');
    if (kind === 'small') return workspace;
    const second = stage(p, 'Construcción del prototipo y validación');
    subtask(second, 'Diseñar una solución inicial', 'completed', 'high');
    const long = subtask(second, 'Probar la solución y explicar los resultados', 'pending', 'medium');
    long.description = 'Descripción extensa de prueba. '.repeat(24);
    long.dueDate = '2026-09-01';
    const empty = project('PRUEBA - Nueva propuesta por organizar', 'pending');
    stage(empty, 'Etapa pendiente sin subtareas');
    project('PRUEBA - Proyecto sin etapas', 'pending');
    const complete = project('PRUEBA - Proyecto finalizado', 'completed');
    const completedStage = stage(complete, 'Entrega de evidencias', 'completed');
    subtask(completedStage, 'Organizar el documento final', 'completed');
    subtask(completedStage, 'Presentar los resultados', 'completed');
    stage(complete, 'Cierre académico sin subtareas', 'completed');
    goal('PRUEBA - Preparar la presentación del proyecto', 35, p.id);
    goal('PRUEBA - Completar la planificación de estudio', 100, p.id);
    goal('PRUEBA - Organizar los próximos objetivos', 0);
    return workspace;
}
module.exports = { createGoalsWorkspace };
