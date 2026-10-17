const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
function declaration(name) {
    const start = source.lastIndexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const end = source.indexOf('\nfunction ', start + 1);
    return source.slice(start, end < 0 ? undefined : end);
}
const context = vm.createContext({});
vm.runInContext(['escapeHTML', 'appIconSvg', 'appIconHTML', 'emptyStateHTML'].map(declaration).join('\n'), context);
const render = context.emptyStateHTML;

test('Module presets retain the exact existing entry points and distinct SVG icons', () => {
    const cases = [
        ['addSubjectUI()', 'Aún no tienes materias', 'Crear materia'],
        ['addTaskUI()', 'Aún no tienes tareas', 'Crear tarea'],
        ['addCalendarEventUI()', 'Tu agenda está vacía', 'Agendar evento'],
        ['openEvaluationForm()', 'Aún no tienes evaluaciones', 'Nueva evaluación'],
        ['showAddGradeForm()', 'Aún no tienes calificaciones', 'Agregar calificación'],
        ['addAttendanceUI()', 'Aún no tienes registros de asistencia', 'Registrar asistencia'],
        ['addResourceUI()', 'Tu mochila está vacía', 'Subir PDF']
    ];
    const icons = new Set();
    for (const [action, title, label] of cases) {
        const html = render('Legacy copy', 'Legacy label', action);
        assert.ok(html.includes(`<h3 class="empty-state__title">${title}</h3>`));
        assert.ok(html.includes(`onclick="${action}"`));
        assert.ok(html.includes(`>${label}</button>`));
        assert.match(html, /data-empty-kind="initial"/);
        assert.match(html, /aria-hidden="true"/);
        icons.add(html.match(/<svg.*?<\/svg>/s)[0]);
        assert.doesNotMatch(html, /🎒|Empieza cuando|empty-icon/);
    }
    assert.equal(icons.size, cases.length);
});
test('Filter states stay compact and preserve the existing clear handler', () => {
    const html = render('No encontramos materias con esa búsqueda.', 'Limpiar búsqueda', 'clearSubjectSearch()');
    assert.match(html, /empty-state--compact/);
    assert.match(html, /data-empty-kind="filtered"/);
    assert.match(html, /onclick="clearSubjectSearch\(\)"/);
    assert.doesNotMatch(html, /<svg/);
});
test('Evaluation filter keeps the delegated attribute, without a new listener', () => {
    const html = render({ title: 'Sin resultados', icon: false, variant: 'compact', kind: 'filtered', primaryAction: { label: 'Mostrar todas', clearEvaluations: true } });
    assert.match(html, /data-clear-evaluation-filters/);
    assert.doesNotMatch(html, /onclick|<svg/);
});
test('Object API separates title/description, supports two actions and escapes text', () => {
    const html = render({ icon: 'target', title: '<img>', description: 'A & B', variant: 'embedded', primaryAction: { label: 'Nuevo proyecto', action: 'openProjectForm()' }, secondaryAction: { label: 'Nueva meta', action: 'openGoalForm()' } });
    assert.match(html, /&lt;img&gt;/);
    assert.match(html, /A &amp; B/);
    assert.match(html, /empty-state--embedded/);
    assert.match(html, /empty-state__button--secondary/);
    assert.equal((html.match(/<button/g) || []).length, 2);
});
test('Unknown variant/kind and hostile content cannot escape attributes', () => {
    const html = render({ title: '"<script>', variant: '" onclick="bad()', kind: '"bad', primaryAction: { label: '"<img>', action: 'doThing("safe")' } });
    assert.match(html, /data-empty-kind="contextual"/);
    assert.match(html, /onclick="doThing\(&quot;safe&quot;\)"/);
    assert.doesNotMatch(html, /<script>|<img>|onclick="bad/);
});
test('CSS is scoped to the student app, with theme, mobile and accessible focus variants', () => {
    const css = fs.readFileSync(path.join(root, 'student-empty-states.css'), 'utf8');
    assert.match(css, /#app-page/);
    assert.match(css, /light-theme/);
    assert.match(css, /@media \(max-width: 767px\)/);
    assert.match(css, /:focus-visible/);
    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /#app-page#app-page .empty-state.student-empty-state/);
    assert.match(css, /data-empty-kind="initial"/);
    assert.doesNotMatch(css, /#landing-page|#login-page|#ai-assistant/);
});
test('Both ends of the primary action gradient retain AA contrast with white text', () => {
    const css = fs.readFileSync(path.join(root, 'student-empty-states.css'), 'utf8');
    function luminance(hex) {
        return hex.match(/../g).map(part => parseInt(part, 16) / 255)
            .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
            .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    }
    for (const token of ['empty-accent', 'empty-accent-end']) {
        const hex = css.match(new RegExp(`--${token}: #([0-9a-f]{6})`))[1];
        assert.ok(1.05 / (luminance(hex) + .05) >= 4.5, token);
    }
});
