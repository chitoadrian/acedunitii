/* Print-only, vector project maps. No academic queries, writes, or screen capture. */
(function (root) {
    'use strict';
    const colors = {
        ink: '#26344D', muted: '#627087', line: '#B7C3D6', border: '#D9E1ED',
        project: '#EEF2FF', projectBorder: '#8190CD', stage: '#F5F7FC',
        completed: '#EAF5EF', completedInk: '#2D7055', activeInk: '#514A99'
    };
    let libraryPromise = null;
    let logoPromise = null;

    function library() {
        if (root.jspdf?.jsPDF) return Promise.resolve(root.jspdf.jsPDF);
        if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
            const existing = document.querySelector('script[src*="jspdf-4.2.1.umd.min.js"]');
            const script = existing || document.createElement('script');
            const fail = () => {
                if (!existing) script.remove();
                reject(new Error('No se pudo cargar el generador PDF.'));
            };
            const done = () => root.jspdf?.jsPDF ? resolve(root.jspdf.jsPDF) : fail();
            script.addEventListener('load', done, { once: true });
            script.addEventListener('error', fail, { once: true });
            if (!existing) {
                script.src = 'assets/vendor/jspdf-4.2.1.umd.min.js';
                script.async = true;
                document.head.appendChild(script);
            }
        }).catch(error => { libraryPromise = null; throw error; });
        return libraryPromise;
    }
    function logo() {
        if (!logoPromise) logoPromise = fetch('favicon-192.png?v=20261022-official-branding-v1')
            .then(response => response.ok ? response.blob() : null)
            .then(blob => blob && new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            })).catch(() => null);
        return logoPromise;
    }
    function buildDocument(snapshot, { jsPDF, logoData = null, exportedAt = new Date() } = {}) {
        if (!jsPDF || !snapshot?.project) throw new Error('No se pudo preparar el proyecto para exportar.');
        const project = snapshot.project;
        const stages = snapshot.stages || [];
        const goals = snapshot.goals || [];
        const subtaskCount = stages.reduce((sum, stage) => sum + stage.subtasks.length, 0);
        const longTitle = [project.title, ...stages.map(s => s.title), ...stages.flatMap(s => s.subtasks.map(t => t.title)), ...goals.map(g => g.title)].some(title => String(title).length > 220);
        const large = stages.length > 5 || subtaskCount > 18 || longTitle;
        const width = large ? 420 : 297;
        let height = large ? 297 : 210;
        const margin = large ? 18 : 14;
        const rootWidth = large ? 84 : 58;
        const stageWidth = large ? 88 : 60;
        const rootGap = large ? 18 : 14;
        const taskGap = large ? 20 : 15;
        const rootX = margin;
        const stageX = rootX + rootWidth + rootGap;
        const taskX = stageX + stageWidth + taskGap;
        const taskWidth = width - margin - taskX;
        let doc;
        let headerLines;
        let bodyTop;
        let capacity;
        const font = (size, weight = 'normal') => { doc.setFont('helvetica', weight); doc.setFontSize(size); };
        const wrap = (text, space, size, weight = 'normal') => {
            font(size, weight);
            return doc.splitTextToSize(String(text || ''), space);
        };
        const makeDoc = () => {
            doc = new jsPDF({ orientation: width > height ? 'landscape' : 'portrait', unit: 'mm', format: [width, height], compress: true });
            headerLines = wrap(project.title, width - margin * 2, 11, 'bold');
            bodyTop = 40 + headerLines.length * 4.8;
            capacity = height - margin - 12 - bodyTop;
        };
        makeDoc();
        function node(kind, title, detail, nodeWidth, label) {
            const size = kind === 'project' ? 12 : kind === 'stage' ? 10.5 : 10;
            const lineHeight = size * .352778 * 1.3;
            const lines = wrap(title, nodeWidth - 10, size, kind === 'subtask' ? 'normal' : 'bold');
            const details = wrap(detail, nodeWidth - 10, 8.5);
            return { kind, title, detail, label, width: nodeWidth, lines, details, size, lineHeight,
                height: 12 + Math.max(1, lines.length) * lineHeight + details.length * 3.6 };
        }
        const projectNode = node('project', project.title, [project.subject, project.statusLabel, `${project.progress}% completado`].filter(Boolean).join(' · '), rootWidth, 'Proyecto principal');
        const stageNodes = stages.map((stage, index) => ({ stage, index,
            box: node('stage', stage.title, `${stage.statusLabel} · ${stage.progress}%`, stageWidth, `Etapa ${index + 1}`),
            tasks: stage.subtasks.map((task, taskIndex) => ({ ...node('subtask', task.title, task.statusLabel, taskWidth, `Subtarea ${taskIndex + 1}`), status: task.status, id: task.id }))
        }));
        const goalNodes = goals.map(goal => ({ ...node('goal', goal.title, `${goal.statusLabel} · ${goal.progress}%`, stageWidth, 'Meta vinculada'), status: goal.status }));
        // Rare exceptionally long names get a taller sheet, never tiny text or truncation.
        const tallest = Math.max(projectNode.height, ...stageNodes.map(s => s.box.height), ...stageNodes.flatMap(s => s.tasks.map(t => t.height)), ...goalNodes.map(g => g.height));
        if (tallest > capacity) { height += Math.ceil(tallest - capacity) + 8; makeDoc(); }

        const pages = [];
        let page = [], used = 0;
        const flush = () => { if (page.length) pages.push(page); page = []; used = 0; };
        const available = () => capacity - used - (page.length ? 9 : 0);
        const addBranch = branch => { used += (page.length ? 9 : 0) + branch.height; page.push(branch); };
        stageNodes.forEach(({ stage, index, box, tasks }) => {
            const parts = [];
            let offset = 0;
            do {
                if (available() < Math.max(box.height, tasks[offset]?.height || 0)) flush();
                const group = [];
                let tasksHeight = 0;
                while (offset < tasks.length) {
                    const nextHeight = tasksHeight + (group.length ? 4 : 0) + tasks[offset].height;
                    if (group.length && Math.max(box.height, nextHeight) > available()) break;
                    tasksHeight = nextHeight;
                    group.push(tasks[offset++]);
                }
                const branch = { kind: 'stage', box, tasks: group, status: stage.status, index, continuation: '', height: Math.max(box.height, tasksHeight), tasksHeight };
                parts.push(branch);
                addBranch(branch);
                if (offset < tasks.length) flush();
            } while (offset < tasks.length);
            if (parts.length > 1) parts.forEach((part, i) => { part.continuation = `Parte ${i + 1}/${parts.length}`; });
        });
        goalNodes.forEach(box => {
            if (box.height > available()) flush();
            addBranch({ kind: 'goal', box, tasks: [], status: box.status, height: box.height, tasksHeight: 0 });
        });
        if (page.length || !pages.length) pages.push(page);
        const date = new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(exportedAt);
        function line(x1, y1, x2, y2) { doc.setDrawColor(colors.line); doc.setLineWidth(.35); doc.line(x1, y1, x2, y2); }
        function paintNode(box, x, y, status = '', continuation = '') {
            const completed = status === 'completed';
            doc.setFillColor(box.kind === 'project' ? colors.project : completed ? colors.completed : box.kind === 'stage' ? colors.stage : '#FFFFFF');
            doc.setDrawColor(box.kind === 'project' ? colors.projectBorder : colors.border);
            doc.setLineWidth(.3);
            doc.roundedRect(x, y, box.width, box.height, 2.5, 2.5, 'FD');
            font(7.5, 'bold'); doc.setTextColor(colors.muted);
            doc.text([box.label, continuation].filter(Boolean).join(' · '), x + 5, y + 5.5);
            font(box.size, box.kind === 'subtask' ? 'normal' : 'bold'); doc.setTextColor(colors.ink);
            doc.text(box.lines, x + 5, y + 11, { lineHeightFactor: 1.3 });
            font(8.5); doc.setTextColor(completed ? colors.completedInk : status === 'in_progress' ? colors.activeInk : colors.muted);
            doc.text(box.details, x + 5, y + 12 + Math.max(1, box.lines.length) * box.lineHeight, { lineHeightFactor: 1.2 });
        }
        pages.forEach((items, pageIndex) => {
            if (pageIndex) doc.addPage([width, height], width > height ? 'landscape' : 'portrait');
            doc.setFillColor('#FFFFFF'); doc.rect(0, 0, width, height, 'F');
            if (logoData) doc.addImage(logoData, 'PNG', margin, 10, 9, 9);
            font(9, 'bold'); doc.setTextColor('#4B5791'); doc.text('AC EDUNITY', margin + (logoData ? 12 : 0), 15.5);
            font(18, 'bold'); doc.setTextColor(colors.ink); doc.text('Mapa del proyecto', margin, 27);
            font(11, 'bold'); doc.text(headerLines, margin, 34, { lineHeightFactor: 1.22 });
            font(8); doc.setTextColor(colors.muted); doc.text(`Exportado: ${date} · America/Guayaquil`, width - margin, 15.5, { align: 'right' });
            line(margin, bodyTop - 6, width - margin, bodyTop - 6);
            const groupHeight = items.reduce((sum, item) => sum + item.height, 0) + Math.max(0, items.length - 1) * 9;
            let top = bodyTop + (capacity - groupHeight) / 2;
            const centerY = bodyTop + capacity / 2;
            const layouts = items.map(item => {
                const layout = { ...item, top, centerY: top + item.height / 2 };
                top += item.height + 9;
                return layout;
            });
            if (layouts.length) {
                const trunkX = stageX - rootGap / 2;
                line(rootX + rootWidth, centerY, trunkX, centerY);
                line(trunkX, layouts[0].centerY, trunkX, layouts.at(-1).centerY);
                layouts.forEach(item => {
                    line(trunkX, item.centerY, stageX, item.centerY);
                    const stageY = item.centerY - item.box.height / 2;
                    if (item.tasks.length) {
                        const taskTrunkX = taskX - taskGap / 2;
                        let taskTop = item.top + (item.height - item.tasksHeight) / 2;
                        const positions = item.tasks.map(task => { const position = { task, top: taskTop, centerY: taskTop + task.height / 2 }; taskTop += task.height + 4; return position; });
                        line(stageX + stageWidth, item.centerY, taskTrunkX, item.centerY);
                        line(taskTrunkX, positions[0].centerY, taskTrunkX, positions.at(-1).centerY);
                        positions.forEach(position => {
                            line(taskTrunkX, position.centerY, taskX, position.centerY);
                            paintNode(position.task, taskX, position.top, position.task.status);
                        });
                    } else if (item.kind === 'stage') {
                        font(9); doc.setTextColor(colors.muted); doc.text('Sin subtareas registradas', taskX, item.centerY + 1);
                    }
                    paintNode(item.box, stageX, stageY, item.status, item.continuation);
                });
            } else {
                font(11); doc.setTextColor(colors.muted); doc.text('Este proyecto todavía no tiene etapas registradas.', stageX, centerY, { maxWidth: width - margin - stageX });
            }
            paintNode(projectNode, rootX, centerY - projectNode.height / 2, project.status);
            line(margin, height - margin - 3, width - margin, height - margin - 3);
            font(8); doc.setTextColor(colors.muted);
            doc.text(`${stages.length} ${stages.length === 1 ? 'etapa' : 'etapas'} · ${subtaskCount} ${subtaskCount === 1 ? 'subtarea' : 'subtareas'} · ${project.progress}% completado`, margin, height - margin + 2);
            doc.text(`Página ${pageIndex + 1} de ${pages.length}`, width - margin, height - margin + 2, { align: 'right' });
        });
        doc.setProperties({ title: `Mapa del proyecto - ${project.title}`, subject: 'Mapa académico del proyecto', author: 'AC Edunity', creator: 'AC Edunity' });
        return { doc, pages: pages.length, format: { width, height }, nodeCount: 1 + stages.length + subtaskCount + goals.length };
    }
    const api = { buildDocument, async create(snapshot) { const [jsPDF, logoData] = await Promise.all([library(), logo()]); return buildDocument(snapshot, { jsPDF, logoData }); } };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ACProjectMapPDF = api;
})(typeof window === 'object' ? window : globalThis);
