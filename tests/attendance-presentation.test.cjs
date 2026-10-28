const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'attendance-ui.css'), 'utf8');
const gpCss = fs.readFileSync(path.join(root, 'goals-projects-ui.css'), 'utf8');
const calendarCss = fs.readFileSync(path.join(root, 'calendar-ui.css'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
const functions = new Map(ast.body.filter(n => n.type === 'FunctionDeclaration').map(n => [n.id.name, source.slice(n.start, n.end)]));
const icons = ast.body.find(n => n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === 'attendanceIcons'));
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
function setup() {
    const container = { innerHTML: '', querySelectorAll: () => [] };
    const ctx = vm.createContext({ Date, Intl, escapeHTML,
        document: { getElementById: () => container }, normalizeDate: value => String(value || '').slice(0, 10),
        getSubjectOptions: ws => ws.subjects.map(s => s.name),
        emptyStateHTML: value => typeof value === 'string' ? value : value.title
    });
    const names = ['attendanceIconSvg', 'getAttendanceStatusLabel', 'getAttendanceStatusKey', 'isAttendancePositive', 'getAttendanceStats', 'getAttendanceSubjectStats', 'getAttendanceTodayParts', 'getAttendanceCalendarDays', 'attendanceStatCard', 'renderAttendance'];
    vm.runInContext('let currentAttendanceFilter="all"; const ATTENDANCE_TIME_ZONE="America/Guayaquil";\n' + source.slice(icons.start, icons.end) + '\n' + names.map(n => functions.get(n)).join('\n'), ctx);
    return { ctx, container };
}
const workspace = () => ({ subjects: [{ name: 'Materia <segura>' }], attendance: ['Asisti', 'Falta', 'Atraso', 'Justificado'].map((status, i) => ({ id: `id-${i}`, subject: 'Materia <segura>', status, date: `2026-10-0${i + 1}` })) });

test('Attendance keeps its real positive-status formula and all four states', () => {
    const { ctx } = setup(), stats = ctx.getAttendanceStats(workspace().attendance);
    assert.deepEqual(JSON.parse(JSON.stringify(stats)), { total: 4, present: 1, absent: 1, late: 1, justified: 1, positive: 3, percentage: 75 });
    assert.equal(ctx.getAttendanceStats([]).percentage, 0);
    assert.deepEqual(['Asisti', 'Falta', 'Atraso', 'Justificado'].map(s => ctx.getAttendanceStatusLabel(s)), ['Presente', 'Falta', 'Atraso', 'Justificado']);
});

test('Original renderer keeps chronological order, exact action IDs, filters and source records', () => {
    const ws = workspace(), before = JSON.stringify(ws), { ctx, container } = setup(); ctx.renderAttendance(ws);
    assert.equal(JSON.stringify(ws), before);
    assert.equal((container.innerHTML.match(/<article class="attendance-card /g) || []).length, 4);
    assert.ok(container.innerHTML.indexOf('data-attendance-edit="id-3"') < container.innerHTML.indexOf('data-attendance-edit="id-0"'));
    assert.match(container.innerHTML, /Materia &lt;segura&gt;/);
    for (let i = 0; i < 4; i++) assert.match(container.innerHTML, new RegExp(`data-attendance-delete="id-${i}"`));
    for (const filter of ['all', 'present', 'absent', 'late', 'justified']) assert.ok(container.innerHTML.includes(`data-attendance-filter="${filter}"`));
    vm.runInContext('currentAttendanceFilter="absent"', ctx); ctx.renderAttendance(ws);
    assert.equal((container.innerHTML.match(/<article class="attendance-card /g) || []).length, 1);
    assert.match(container.innerHTML, /data-attendance-edit="id-1"/);
});

test('Calendar remains Monday-first, leap-year aware and tied to Ecuador rather than UTC midnight', () => {
    const { ctx } = setup();
    const cells = ctx.getAttendanceCalendarDays([], new Date('2026-11-01T04:30:00Z'));
    const today = cells.find(cell => cell.isToday);
    assert.equal(today.iso, '2026-10-31');
    assert.equal(cells.filter(cell => !cell.empty).length, 31);
    assert.equal(cells.findIndex(cell => !cell.empty), 3);
    assert.equal(ctx.getAttendanceCalendarDays([], new Date('2028-02-20T12:00:00Z')).filter(c => !c.empty).length, 29);
});

test('Attendance styles are isolated, wrap instead of hiding overflow, and support both themes', () => {
    assert.match(css, /body:is\(\.light-theme/);
    assert.match(css, /#app-page #attendance \.attendance-filter \{[\s\S]*?flex-wrap: wrap/);
    assert.match(css, /grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
    assert.match(css, /@media \(max-width: 600px\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /:focus-visible/);
    assert.doesNotMatch(css, /overflow-x: hidden|#calendar|#dashboard|\.sidebar\s*\{|#landing-page/);
    assert.match(css, /\.progress-fill \{ min-width: 0/);
});

test('Goal/project metadata circles remove the inherited label padding without touching map icons', () => {
    assert.match(gpCss, /\.gp-card-meta > span > \.gp-meta-icon \{[\s\S]*?padding: 0 !important/);
    assert.match(gpCss, /\.gp-card-meta > span > \.gp-meta-icon \{[\s\S]*?box-sizing: border-box !important/);
    assert.match(gpCss, /\.gp-card-meta > span > \.gp-meta-icon svg \{[\s\S]*?width: 12px/);
    assert.match(calendarCss, /\.calendar-sync-icon::after \{[\s\S]*?inset: auto 0 0 auto/);
    assert.match(calendarCss, /\.calendar-sync-icon::after \{[\s\S]*?transform: none/);
});

test('Status and text colors retain AA contrast in dark and light surfaces', () => {
    const luminance = hex => {
        const values = hex.match(/\w\w/g).map(c => parseInt(c, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
        return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
    };
    const ratio = (a, b) => { const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (light + .05) / (dark + .05); };
    for (const color of ['edf2fc', 'acbad0', 'a0b0c7', '8bd4b5', 'f2a4b0', 'e7c184', '8cc9f4']) assert.ok(ratio(color, '1e283a') >= 4.5, color);
    for (const color of ['25324a', '596981', '62718a', '1d7250', 'b24057', '8d611b', '316c98']) assert.ok(ratio(color, 'f5f7fc') >= 4.5, color);
});
