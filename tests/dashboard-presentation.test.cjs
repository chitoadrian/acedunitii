const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'dashboard-ui.css'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
const wanted = new Set(['getDashboardNextStep', 'renderDashboard', 'dashboardCard', 'getDashboardIconName', 'escapeHTML', 'emptyStateHTML', 'weeklyActivityInitialHTML', 'weeklyActivityGridHTML', 'normalizeFiveDayActivityRows', 'getFiveDayPlaceholders', 'getGuayaquilDateParts', 'getNextEvent', 'getLevel']);
const nodes = ast.body.filter(n => n.type === 'FunctionDeclaration' && wanted.has(n.id.name) || n.type === 'VariableDeclaration' && n.declarations.some(d => ['FIVE_DAY_LABELS', 'FIVE_DAY_BLOCK_ANCHOR_UTC', 'DAY_IN_MILLISECONDS'].includes(d.id.name)));
const now = Date.parse('2026-10-26T10:00:00-05:00');
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
function createRenderer() {
    const section = { innerHTML: '' }, calls = { preferences: 0, countdown: 0, queued: 0 };
    const context = vm.createContext({
        Date: FixedDate, Intl, document: { getElementById: () => section },
        currentUser: { id: 'fixture-user', name: 'Ana María' },
        ACEdunityTime: {}, appIconHTML: (name, cls) => `<span class="${cls}" aria-hidden="true">ICON:${name}</span>`, appIconSvg: name => `<svg data-icon="${name}"></svg>`,
        getTaskVisualStatus: task => task.status === 'completed' ? 'completed' : task.visualStatus || 'pending',
        sortEvaluations: rows => [...rows].sort((a, b) => a.date.localeCompare(b.date)), getEvaluationDaysUntil: () => 2,
        getEvaluationSubject: (workspace, row) => workspace.subjects.find(s => s.id === row.subjectId),
        getEvaluationCountdown: () => '02 días', formatEvaluationCompactDate: date => date,
        getAverageGrade: workspace => workspace.grades.length ? 8.5 : 0,
        normalizeDate: value => String(value || '').slice(0, 10),
        applyDashboardModulePreferences: () => calls.preferences++, ensureEvaluationCountdownTimer: () => calls.countdown++,
        queueMicrotask: () => calls.queued++
    });
    vm.runInContext(fs.readFileSync(path.join(root, 'time-utils.js'), 'utf8'), context);
    vm.runInContext(nodes.map(n => source.slice(n.start, n.end)).join('\n'), context);
    return { context, calls, render: workspace => { context.renderDashboard(workspace); return section.innerHTML; } };
}
const empty = () => ({ subjects: [], tasks: [], events: [], evaluations: [], grades: [], resources: [], xp: 0 });
const workspace = () => ({ subjects: [{ id: 's1', name: 'Matemática' }], tasks: [{ id: 't1', title: 'Pendiente real', subject: 'Matemática', due: '2026-10-27', dueTime: '12:00', status: 'pending' }, { id: 't2', title: 'Finalizada', status: 'completed' }], events: [], evaluations: [], grades: [{}], resources: [{}], xp: 1365 });

test('Next step chooses one actual upcoming item, respecting explicit Guayaquil time and AM/PM', () => {
    const { context } = createRenderer(), state = workspace();
    state.events.push({ title: 'Evento a medianoche', date: '2026-10-27', time: '00:00', subject: 'Lengua' });
    state.evaluations.push({ title: 'Evaluación más próxima', date: '2026-10-26', time: '14:30', status: 'pending', subject: 'Matemática' });
    const before = JSON.stringify(state), result = context.getDashboardNextStep(state, now);
    assert.equal(result.title, 'Evaluación más próxima');
    assert.equal(result.route, 'evaluations');
    assert.match(result.meta, /2:30 PM/);
    state.evaluations[0].status = 'completed';
    assert.equal(context.getDashboardNextStep(state, now).title, 'Evento a medianoche');
    assert.match(context.getDashboardNextStep(state, now).meta, /12:00 AM/);
    state.evaluations[0].status = 'pending';
    assert.equal(JSON.stringify(state), before);
});
test('Completed items never become recommendations; an existing undated/overdue task can be revisited', () => {
    const { context } = createRenderer(), state = workspace();
    state.tasks[0].due = '';
    assert.equal(context.getDashboardNextStep(state, now).title, 'Pendiente real');
    assert.match(context.getDashboardNextStep(state, now).meta, /Sin fecha límite/);
    state.tasks[0].due = '2026-10-24';
    assert.equal(context.getDashboardNextStep(state, now).route, 'tasks');
    state.tasks[0].status = 'completed';
    assert.equal(context.getDashboardNextStep(state, now).title, 'Todo al día. Puedes organizar tu próxima actividad.');
});
test('New presenter is synchronous and has no network, database, storage or listener side effects', () => {
    const node = ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'getDashboardNextStep');
    assert.doesNotMatch(source.slice(node.start, node.end), /await|fetch\(|\.rpc\(|\.from\(|localStorage|sessionStorage|addEventListener|setTimeout|setInterval/);
    const state = workspace(), before = JSON.stringify(state), renderer = createRenderer();
    renderer.render(state);
    assert.equal(JSON.stringify(state), before);
    assert.deepEqual(renderer.calls, { preferences: 1, countdown: 1, queued: 1 });
});
test('Original four metrics, XP values and task/grade bar values remain in the Dashboard', () => {
    const html = createRenderer().render(workspace());
    for (const value of ['Materias activas', 'Tareas pendientes', 'Próximo evento', 'Promedio actual', '8.50', 'Nivel 6 - 365/1000 XP', '1365 XP acumulado', '635 XP para completar el ciclo actual.', '46%']) assert.ok(html.includes(value), value);
    assert.match(html, /style="width:46%"/);
    assert.match(html, /style="width:50%"/);
    assert.match(html, /style="width:85%"/);
});
test('Six quick destinations and every customization key remain intact', () => {
    const html = createRenderer().render(workspace());
    const actions = html.split('class="quick-actions-bar dashboard-hero-actions"')[1].split('</div>')[0];
    assert.deepEqual([...actions.matchAll(/onclick="navigateTo\('([^']+)'\)"/g)].map(m => m[1]), ['subjects', 'tasks', 'calendar', 'evaluations', 'backpack', 'ai-assistant']);
    for (const key of ['subjects', 'tasks', 'calendar', 'grades', 'tutor', 'nextEvaluation', 'progress', 'day', 'studentCenter', 'weekly']) assert.equal((html.match(new RegExp('data-dashboard-module="' + key + '"', 'g')) || []).length, 1, key);
    assert.match(html, /data-dashboard-modules-empty hidden/);
    assert.match(html, /onclick="navigateTo\('settings'\); openSettingsModal\('dashboard'\)"/);
    assert.match(css, /\[data-dashboard-module\]\[hidden\]/);
});
test('Student center retains four real actions and completion states, with readable completed text', () => {
    const html = createRenderer().render(workspace());
    assert.match(html, /3 de 4 pasos completados/);
    for (const label of ['Crea una materia', 'Agrega una tarea', 'Agenda un evento', 'Sube un apunte']) assert.ok(html.includes(label));
    assert.match(html, /class="dashboard-step-check"/);
    assert.match(css, /\.dashboard-steps li\.done \{ text-decoration: none !important/);
    assert.doesNotMatch(html, /<del>|<s>/);
});
test('Empty and filled evaluations preserve the exact existing actions and timer target', () => {
    const renderer = createRenderer(), state = workspace();
    assert.match(renderer.render(state), /No tienes evaluaciones próximas/);
    assert.match(renderer.render(state), /Crear evaluación/);
    state.evaluations.push({ id: 'evaluation-1', title: 'Examen real', subject: 'Matemática', subjectId: 's1', date: '2026-10-28', time: '00:00', status: 'pending', type: 'Examen' });
    const html = renderer.render(state);
    assert.match(html, /data-evaluation-countdown="evaluation-1"/);
    assert.match(html, /viewEvaluationFromDashboard\('evaluation-1'\)/);
    assert.match(html, /12:00 AM/);
});
test('Empty states stay available, and hostile academic titles are safely escaped', () => {
    const renderer = createRenderer();
    const html = renderer.render(empty());
    assert.match(html, /Tu día está libre/);
    assert.match(html, /0 de 4 pasos completados/);
    const state = workspace(); state.tasks[0].title = '<img src=x onerror="alert(1)">';
    const safe = renderer.render(state);
    assert.doesNotMatch(safe, /<img src=x/);
    assert.match(safe, /&lt;img/);
});
test('Five-day dates, counts, heights and keyboard tooltip access are preserved', () => {
    const { context } = createRenderer();
    const rows = [{ day_key: 'sat', day_label: 'Sáb', full_day: 'Sábado', points: 10, activity_count: 2 }, { day_key: 'sun', points: 20, activity_count: 3 }];
    const html = context.weeklyActivityGridHTML(rows);
    assert.equal((html.match(/class="weekly-activity-day[\s"]/g) || []).length, 5);
    assert.equal((html.match(/tabindex="0"/g) || []).length, 5);
    assert.match(html, /10 puntos en 2 actividades/);
    assert.match(html, /--weekly-bar-height:50%/);
    assert.match(html, /--weekly-bar-height:100%/);
    assert.match(context.weeklyActivityGridHTML([]), /weekly-activity-grid is-empty/);
});
test('CSS is isolated, adaptive, reduced-motion safe and never hides document overflow', () => {
    assert.match(css, /dashboard-compact-workspace/);
    assert.match(css, /@media \(max-width: 600px\)/);
    assert.match(css, /@media \(max-width: 900px\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.doesNotMatch(css, /infinite|overflow-x:\s*hidden|:root|#landing-page|\.sidebar/);
    assert.match(css, /button:focus-visible/);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(html, /dashboard-ui\.css\?v=20261026-weekly-progress-premium-v2/);
    assert.match(html, /app\.js\?v=\d{8}-[a-z0-9-]+/);
});
test('Legacy ring minimum height, checklist placement and the 768px flow boundary are explicitly handled', () => {
    assert.match(css, /\.dashboard-xp-ring \{[^}]*min-height: 0 !important;[^}]*max-height: none !important/);
    assert.match(css, /\.dashboard-steps button \{[^}]*grid-column: 3 !important; grid-row: 1 !important/);
    assert.match(css, /@media \(min-width: 768px\) and \(max-width: 768px\)/);
    assert.match(css, /#app-page\.page\.active:has\(> \.main-content > #dashboard\.section\.active\)/);
});
test('Dashboard text, semantic accents and primary buttons retain AA contrast in both themes', () => {
    const luminance = hex => {
        const rgb = hex.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    const palettes = [...css.matchAll(/--dc-surface: (#[A-F\d]{6});([\s\S]*?)--dc-track:/g)];
    assert.equal(palettes.length, 2);
    for (const [, surface, block] of palettes) {
        for (const [, key, color] of block.matchAll(/--dc-(text|muted|blue|purple|cyan|amber): (#[A-F\d]{6});/g)) assert.ok(ratio(color, surface) >= 4.5, `${key}: ${color} on ${surface}`);
    }
    for (const color of ['#5368CB', '#6252C3']) assert.ok(ratio('#FFFFFF', color) >= 4.5);
});
