const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'goals-projects.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'goals-projects-ui.css'), 'utf8');
const { createGoalsWorkspace } = require('./fixtures/goals-projects-workspace.cjs');
const { buildDocument } = require('../project-map-pdf.js');
const { jsPDF } = require('../assets/vendor/jspdf-4.2.1.umd.min.js');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
const functions = new Map(ast.body.filter(n => n.type === 'FunctionDeclaration').map(n => [n.id.name, source.slice(n.start, n.end)]));
const names = ['getProjectStats', 'getProjectStageProgress', 'getProjectStageStatus', 'getProjectMapPdfSnapshot', 'gpLabel', 'gpSubjectCardStyle', 'renderProjectCard', 'renderGoalCard', 'gpMenu', 'renderProjectMap', 'getProjectMapFileName'];
const context = vm.createContext({
    Date, Intl, getGuayaquilDateKey: () => '2026-10-26',
    escapeHTML: value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x])),
    appIconHTML: (name, cls) => `<span class="${cls}" aria-hidden="true"><svg data-icon="${name}"></svg></span>`,
    getAcademicCardStyle: color => `--subject-color:${color === 'Morado' ? '#8b5cf6' : color};`,
    gpDate: value => value || 'Sin fecha', emptyStateHTML: () => '<p>Sin etapas</p>'
});
vm.runInContext('const collapsedProjectStages=new Set(); let projectMapDownloading=false; let projectMapPdfDownloading=false;\n' + names.map(n => functions.get(n)).join('\n'), context);

test('Project percentages retain the original mean of stage percentages, not a new subtask formula', () => {
    const ws = createGoalsWorkspace();
    const stats = context.getProjectStats(ws.projects[0], ws);
    assert.equal(stats.progress, 42); // mean(33,50), not 2/5=40.
    assert.equal(stats.completedSubtasks, 2);
    assert.equal(stats.pendingSubtasks, 3);
    assert.equal(stats.overdue, 1);
    assert.equal(stats.completedStages, 0);
    assert.equal(context.getProjectStats(ws.projects[3], ws).progress, 100);
    assert.equal(context.getProjectStageProgress({ status: 'completed' }, []), 100);
    assert.equal(context.getProjectStageProgress({ status: 'pending' }, []), 0);
});

for (const kind of ['small', 'large', 'long', 'empty', 'showcase']) {
    test(`The ${kind} map and immutable PDF snapshot keep every real relationship and title`, () => {
        const ws = createGoalsWorkspace(kind), original = JSON.stringify(ws), project = ws.projects[0];
        const stats = context.getProjectStats(project, ws), snapshot = context.getProjectMapPdfSnapshot(project, ws);
        const html = context.renderProjectMap(project, stats, ws);
        assert.equal(snapshot.stages.length, stats.stages.length);
        assert.equal(snapshot.stages.flatMap(s => s.subtasks).length, stats.subtasks.length);
        assert.equal((html.match(/class="gp-node subtask /g) || []).length, stats.subtasks.length);
        assert.equal((html.match(/class="gp-node stage /g) || []).length, stats.stages.length);
        assert.equal(snapshot.goals.length, ws.goals.filter(g => g.projectId === project.id).length);
        for (const stage of snapshot.stages) {
            for (const task of stage.subtasks) assert.equal(ws.projectSubtasks.find(t => t.id === task.id).stageId, stage.id);
            assert.ok(html.includes(context.escapeHTML(stage.title)));
        }
        snapshot.project.title = 'Only a snapshot';
        assert.equal(JSON.stringify(ws), original);
        assert.match(html, /tabindex="0" role="region"/);
        assert.match(html, /onclick="downloadProjectMap\('/);
        assert.match(html, /onclick="downloadProjectMapPdf\('/);
    });
}

test('Collapse affects the visual tree only, never the exported academic snapshot', () => {
    const ws = createGoalsWorkspace(), project = ws.projects[0];
    vm.runInContext(`collapsedProjectStages.add('${ws.projectStages[0].id}');`, context);
    const snapshot = context.getProjectMapPdfSnapshot(project, ws);
    const html = context.renderProjectMap(project, context.getProjectStats(project, ws), ws);
    assert.match(html, /3 subtareas ocultas/);
    assert.equal(snapshot.stages[0].subtasks.length, 3);
    assert.equal((html.match(/class="gp-node subtask /g) || []).length, 2);
    vm.runInContext('collapsedProjectStages.clear();', context);
});

test('Card metadata, safe subject accents, original menus and accessible actions survive', () => {
    const ws = createGoalsWorkspace();
    const html = context.renderProjectCard(ws.projects[0], ws);
    assert.match(html, /--subject-color:#6889C9/);
    assert.match(html, /2\/5 subtareas/);
    assert.match(html, /42%/);
    assert.match(html, /aria-label="Opciones del proyecto"/);
    for (const callback of ['openProjectForm', 'toggleGpCalendar', 'openGpDelete', 'openProjectDetail']) assert.ok(html.includes(callback));
    const goal = context.renderGoalCard(ws.goals[0], ws);
    assert.ok(goal.includes(ws.goals[0].description));
    assert.match(goal, /35% completado/);
    assert.match(goal, /toggleGpComplete\('goal'/);
    const complete = context.renderProjectCard(ws.projects[3], ws);
    assert.match(complete, /Todas las etapas están completadas/);
});

test('Untrusted academic titles/descriptions remain escaped in cards and map attributes', () => {
    const ws = createGoalsWorkspace('small');
    ws.projects[0].title = '<img src=x onerror="bad()">';
    ws.projectStages[0].title = '" onclick="bad()';
    ws.projectSubtasks[0].title = '<script>bad()</script>';
    const html = context.renderProjectCard(ws.projects[0], ws) + context.renderProjectMap(ws.projects[0], context.getProjectStats(ws.projects[0], ws), ws);
    assert.doesNotMatch(html, /<img src=x|<script>bad|aria-label="[^"]*" onclick="bad/);
    assert.match(html, /&lt;script&gt;/);
});

function recordPDF() {
    const calls = [];
    function RecordingPDF(options) {
        const doc = new jsPDF(options);
        for (const method of ['roundedRect', 'rect', 'line', 'text', 'setFillColor']) {
            const original = doc[method];
            doc[method] = function (...args) { calls.push({ method, args, page: doc.internal.getCurrentPageInfo().pageNumber }); return original.apply(doc, args); };
        }
        return doc;
    }
    return { calls, RecordingPDF };
}

for (const kind of ['small', 'large', 'long', 'empty', 'showcase']) {
    test(`The actual jsPDF exporter lays out the ${kind} map without clipped nodes or tiny text`, () => {
        const ws = createGoalsWorkspace(kind), snapshot = context.getProjectMapPdfSnapshot(ws.projects[0], ws);
        const original = JSON.stringify(snapshot), { calls, RecordingPDF } = recordPDF();
        const result = buildDocument(snapshot, { jsPDF: RecordingPDF, exportedAt: new Date('2026-10-26T17:00:00Z') });
        assert.equal(JSON.stringify(snapshot), original);
        assert.equal(result.nodeCount, 1 + snapshot.stages.length + snapshot.stages.flatMap(s => s.subtasks).length + snapshot.goals.length);
        assert.equal(result.pages, result.doc.getNumberOfPages());
        assert.ok(result.doc.output('arraybuffer').byteLength > 3000);
        for (const { args: [x, y, w, h] } of calls.filter(c => c.method === 'roundedRect')) {
            assert.ok(x >= 14 && x + w <= result.format.width - 13);
            assert.ok(y > 38 && y + h < result.format.height - 25);
        }
        const labels = calls.filter(c => c.method === 'text').map(c => Array.isArray(c.args[0]) ? c.args[0].join('') : c.args[0]).join('').replace(/\s+/g, '');
        for (const title of [snapshot.project.title, ...snapshot.stages.map(s => s.title), ...snapshot.stages.flatMap(s => s.subtasks.map(t => t.title)), ...snapshot.goals.map(g => g.title)]) assert.ok(labels.includes(title.replace(/\s+/g, '')));
        const whitePages = calls.filter(c => c.method === 'rect' && c.args[0] === 0 && c.args[1] === 0 && c.args[4] === 'F');
        assert.equal(whitePages.length, result.pages);
        assert.equal(kind === 'large' ? result.pages > 1 : result.pages >= 1, true);
        assert.equal(result.format.width, ['large', 'long'].includes(kind) ? 420 : 297);
    });
}

test('The print representation never screenshots a dark map or performs academic operations', () => {
    const pdf = fs.readFileSync(path.join(root, 'project-map-pdf.js'), 'utf8');
    assert.doesNotMatch(pdf, /htmlToImage|html2canvas|\.from\(|\.rpc\(|supabase|localStorage|sessionStorage/);
    assert.match(pdf, /doc\.roundedRect/);
    assert.match(pdf, /doc\.line/);
    assert.match(pdf, /setFillColor\('#FFFFFF'\)/);
    assert.match(pdf, /America\/Guayaquil/);
    assert.match(pdf, /assets\/vendor\/jspdf-4\.2\.1\.umd\.min\.js/);
    assert.doesNotMatch(pdf, /https:\/\//);
    const download = functions.get('downloadProjectMapPdf');
    assert.match(download, /if\(projectMapPdfDownloading\)return/);
    assert.match(download, /currentUser\?\.id!==ownerId\|\|!academicYearManager\.matches\(scope\)/);
    assert.doesNotMatch(download, /syncWorkspaceFromSupabase|refreshWorkspaceUI|\.from\(|\.rpc\(/);
});

test('Filename preserves the existing Ecuador timestamp and sanitization, only changing PDF suffix', () => {
    assert.equal(context.getProjectMapFileName('Proyecto: Educación / Diseño?', new Date('2026-10-27T02:15:00Z')), 'mapa de Proyecto Educación Diseño - 2026-10-26_21-15.png');
    assert.match(functions.get('downloadProjectMapPdf'), /getProjectMapFileName\(project\.title\)\.replace/);
});

test('All added selectors remain scoped to this module, including the 768px compatibility rule', () => {
    for (const line of css.split('\n').filter(line => line.includes('{') && !line.trim().startsWith('@'))) assert.ok(line.includes('#goals-projects') || line.trim() === '', line);
    assert.match(css, /width: max-content !important; min-width: 100%/);
    assert.match(css, /\.gp-map-shell[^}]*overflow: auto !important/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /\.gp-project-progress \{[^}]*grid-template-columns: minmax\(0, 1fr\) !important/);
    assert.doesNotMatch(css, /#landing|#dashboard|#login|#register|#sidebar|\.sidebar\s*\{/);
});

test('Text and semantic states meet AA contrast against both card surfaces', () => {
    const luminance = hex => hex.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    const palettes = [...css.matchAll(/--pgp-surface: (#[A-F\d]{6});[\s\S]*?--pgp-track: (#[A-F\d]{6});/g)];
    assert.equal(palettes.length, 2);
    for (const palette of palettes) for (const [, color] of palette[0].matchAll(/--pgp-(?:text|muted|indigo|blue|cyan|green|amber|red): (#[A-F\d]{6});/g)) assert.ok(ratio(color, palette[1]) >= 4.5, color);
});

test('PDF busy state blocks duplicate export, cancels after a cycle change, and restores controls', async () => {
    const ws = createGoalsWorkspace('small');
    let resolveExport, downloadCount = 0, renderCount = 0, scopeMatches = true;
    const messages = [];
    const exportPromise = new Promise(resolve => { resolveExport = resolve; });
    const sandbox = vm.createContext({
        currentUser: { id: 'owner-a' }, academicYearManager: { scope: () => 'year-a', matches: () => scopeMatches },
        loadWorkspace: () => ws, getProjectMapPdfSnapshot: () => ({ project: ws.projects[0] }),
        renderGoalsProjects: () => { renderCount++; }, window: { ACProjectMapPDF: { create: () => exportPromise } },
        notify: (...args) => messages.push(args), console: { error() {} },
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, setTimeout: fn => fn(),
        getProjectMapFileName: () => 'mapa de prueba.png', document: { body: { appendChild() {} }, createElement: () => ({ click() { downloadCount++; }, remove() {} }) }
    });
    vm.runInContext(`let projectMapPdfDownloading=false;let activeProjectId='${ws.projects[0].id}';let activeProjectTab='map';\n${functions.get('downloadProjectMapPdf')}`, sandbox);
    const first = sandbox.downloadProjectMapPdf(ws.projects[0].id);
    await sandbox.downloadProjectMapPdf(ws.projects[0].id);
    assert.equal(renderCount, 1);
    scopeMatches = false;
    resolveExport({ doc: { output: () => new Blob() } });
    await first;
    assert.equal(downloadCount, 0);
    assert.equal(messages.at(-1)[1], 'error');
    assert.match(messages.at(-1)[0], /año lectivo cambió/);
    assert.equal(vm.runInContext('projectMapPdfDownloading', sandbox), false);
    assert.equal(renderCount, 2);
});

test('Lazy PDF library failures remove only their own script and allow a clean retry', async () => {
    const scripts = [], removed = [];
    const sandbox = vm.createContext({
        module: { exports: {} }, fetch: async () => ({ ok: false }),
        document: {
            querySelector: () => scripts.find(s => !s.removed) || null,
            createElement: () => { const s = { handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; }, remove() { this.removed = true; removed.push(this); } }; return s; },
            head: { appendChild(s) { scripts.push(s); queueMicrotask(() => s.handlers.error()); } }
        }
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'project-map-pdf.js'), 'utf8'), sandbox);
    for (let i = 0; i < 2; i++) await assert.rejects(sandbox.module.exports.create({ project: {} }), /No se pudo cargar/);
    assert.equal(scripts.length, 2);
    assert.equal(removed.length, 2);
});

test('Card rows share natural heights and internal tracks, with a bottom-aligned flex fallback', () => {
    assert.match(css, /\.gp-grid \{[^}]*gap: 16px !important; align-items: stretch !important; container-type: inline-size/);
    assert.match(css, /\.gp-card \{[^}]*display: flex !important; flex-direction: column;[^}]*max-width: 480px !important; min-height: 0 !important/);
    assert.match(css, /\.gp-card > \* \{ flex-shrink: 0; \}/);
    assert.match(css, /\.gp-project-open \{[^}]*margin: auto 0 0 !important/);
    assert.match(css, /@supports \(grid-template-rows: subgrid\)/);
    assert.match(css, /@container \(min-width: 676px\)/);
    assert.match(css, /grid-template-rows: subgrid; grid-row: span 9/);
    for (const [name, row] of [['gp-card-top',1],['gp-card-heading',2],['gp-card-description',3],['gp-card-badges',4],['gp-card-progress-copy',5],['gp-progress',6],['gp-card-guidance',7],['gp-card-meta',8],['gp-project-open',9]]) assert.match(css, new RegExp(`\\.gp-card > \\.${name} \\{ grid-row: ${row}; \\}`));
    assert.match(css, /:not\(:has\(> \.gp-card-description\)\) > \.gp-card-heading \{ grid-row: 2 \/ 4; align-content: start/);
    assert.doesNotMatch(css, /\.gp-card \{[^}]*(?:height:\s*\d+px|min-height:\s*[1-9]\d*px)/);
});
