const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'progress-ui.css'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
const names = new Set(['renderProgress', 'progressStatCard', 'progressStatIconSvg', 'achievementIconSvg', 'getLevel', 'isAttendancePositive', 'escapeHTML', 'getGradeItems', 'getGradeFinalValue', 'getGradePeriod', 'getGradeCategory', 'getCategoryGrades', 'getCategoryAverage', 'averageNumbers', 'calculatePeriodAverage', 'getSubjectGradeSummary', 'getAverageGrade']);
const nodes = ast.body.filter(node => node.type === 'FunctionDeclaration' && names.has(node.id.name) || node.type === 'VariableDeclaration' && node.declarations.some(d => d.id.name === 'gradePeriods'));
function render(workspace) {
    const element = { innerHTML: '' };
    const context = vm.createContext({ document: { querySelector: () => element }, emptyStateHTML: () => '<div data-empty-progress>Tu progreso empieza aquí</div>' });
    vm.runInContext(nodes.map(node => source.slice(node.start, node.end)).join('\n'), context);
    context.renderProgress(workspace);
    return element.innerHTML;
}
const empty = xp => ({ xp, streak: 0, tasks: [], attendance: [], grades: [], subjects: [], resources: [] });
const active = xp => ({ ...empty(xp), streak: 7, subjects: [{ name: 'Materia' }], tasks: [{ status: 'completed' }, { status: 'pending' }], attendance: Array.from({ length: 5 }, () => ({ status: 'Asisti' })), resources: [{ usedAI: true }], grades: [{ subject: 'Materia', period: 'p1', category: 'partial1', value: 8.5 }] });

for (const xp of [0, 35, 249, 250, 1125, 2432, 24999]) {
    test(`Real XP and level remain unchanged at ${xp} XP`, () => {
        const state = active(xp), before = JSON.stringify(state), html = render(state);
        const level = Math.max(1, Math.floor(xp / 250) + 1), current = xp % 250, percent = Math.min(100, current / 250 * 100);
        assert.match(html, new RegExp('<h2>Nivel ' + level + '</h2>'));
        assert.ok(html.includes(`${xp} XP acumulado`));
        assert.ok(html.includes(`${250 - current} XP para nivel ${level + 1}`));
        assert.ok(html.includes(`${current}/250 XP en este nivel`));
        assert.ok(html.includes(`style="width:${percent}%"`));
        assert.ok(html.includes(`--progress-percent:${percent}`));
        assert.ok(html.includes(`aria-valuemax="250" aria-valuenow="${current}"`));
        assert.equal(JSON.stringify(state), before);
    });
}

test('All five original statistics retain their labels, values and descriptions', () => {
    const html = render(active(1125));
    assert.equal((html.match(/class="progress-metric metric-/g) || []).length, 5);
    for (const text of ['Racha actual', 'Logros desbloqueados', 'Estado', 'Actividad académica', 'Tareas completadas', 'días activos', 'insignias premium', 'sigue avanzando', 'acciones registradas', 'retos terminados', '11/11']) assert.ok(html.includes(text));
    assert.match(render(empty(0)), />Inicial</);
});

test('Exactly eleven existing achievements, with real conditions and readable locked states', () => {
    for (const [workspace, count] of [[empty(0), 0], [active(1125), 11], [active(35), 10]]) {
        const html = render(workspace);
        assert.equal((html.match(/class="progress-reward is-/g) || []).length, 11);
        assert.equal((html.match(/class="progress-reward is-unlocked"/g) || []).length, count);
        for (const name of ['Primera materia', 'Primera tarea', 'Tarea completada', 'Primer apunte', 'Uso de Tutor', 'Primera racha', '7 días de racha', 'Nivel 5 alcanzado', 'Estudiante constante', 'Buen promedio', 'Primer PDF']) assert.ok(html.includes('<h4>' + name + '</h4>'));
        assert.match(html, /<p>Pregunta con un apunte<\/p>/);
        assert.match(html, /<p>Alcanza 8.00 o más<\/p>/);
    }
    assert.match(render(empty(0)), /data-empty-progress/);
    assert.doesNotMatch(render(active(35)), /data-empty-progress/);
});

test('Journey preserves levels 1–5 and marks only the real current level', () => {
    for (const [xp, current] of [[0, 1], [250, 2], [1125, 5], [2432, null]]) {
        const html = render(empty(xp));
        assert.equal((html.match(/class="progress-journey-step /g) || []).length, 5);
        assert.equal((html.match(/aria-current="step"/g) || []).length, current === null ? 0 : 1);
        for (let level = 1; level <= 5; level++) assert.ok(html.includes('<strong>Nivel ' + level + '</strong>'));
        if (current) assert.match(html, new RegExp('aria-current="step">\\s*<span class="progress-journey-node">' + current));
    }
});

test('Percentage display avoids floating-point noise without changing the true bar value', () => {
    const html = render(empty(35));
    assert.match(html, /14% del nivel/);
    assert.doesNotMatch(html, /14\.000000000000002% del nivel/);
    assert.match(render(empty(0)), /class="progress-radial is-empty"/);
    assert.match(css, /\.progress-radial\.is-empty \.progress-radial-ring \{ visibility: hidden; \}/);
});

test('Presentation is scoped, adaptive and respects one-shot/reduced motion', () => {
    assert.match(css, /#app-page #progress/);
    assert.match(css, /@media \(max-width: 767px\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /html\.reduce-app-motion #progress/);
    assert.match(css, /ac-progress-ring-enter 900ms/);
    assert.doesNotMatch(css, /infinite|@import|:root|overflow-x:\s*hidden/);
    assert.doesNotMatch(css, /opacity:\s*0\.[0-5]\b/);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(html, /progress-ui\.css\?v=20261025-premium-progress-v1/);
    assert.match(html, /app\.js\?v=\d{8}-[a-z0-9-]+/);
});

test('Primary, secondary and semantic text retain readable contrast in both themes', () => {
    const luminance = hex => hex.match(/[a-f0-9]{2}/gi).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    for (const [surface, colors] of [['#1B2232', ['#F2F5FD', '#ADB9CE', '#B2A4FF', '#8DB9FF', '#67D6D4', '#F1BC76']], ['#FFFFFF', ['#202A3F', '#5D6C83', '#6953BD', '#4267AF', '#247F86', '#996020']], ['#F5F7FC', ['#202A3F', '#5D6C83', '#5F6F86']]]) {
        for (const color of colors) {
            const values = [luminance(surface), luminance(color)].sort((a, b) => a - b);
            assert.ok((values[1] + .05) / (values[0] + .05) >= 4.5, `${color} on ${surface}`);
        }
    }
});
