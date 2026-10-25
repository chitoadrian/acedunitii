const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8');
const declaration = name => [...source.matchAll(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'gm'))].at(-1)?.[0];

test('Evaluation cards retain dynamic subject styles, every state/topic/priority and existing action ids', () => {
    const container = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
    const subjectStyles = [];
    const scope = vm.createContext({ document: { getElementById: () => container },
        evaluationStatusOptions: ['pending', 'preparing', 'prepared', 'completed'].map(value => ({ value, label: value })),
        evaluationPriorityOptions: ['high', 'medium', 'low'].map(value => ({ value, label: value })),
        evaluationStatusFilter: 'all', evaluationSubjectFilter: 'all',
        sortEvaluations: rows => rows, getEvaluationDaysUntil: () => 3,
        getEvaluationSubject: (workspace, evaluation) => workspace.subjects.find(subject => subject.id === evaluation.subjectId),
        getAcademicCardStyle: color => { subjectStyles.push(color); return `--subject-color:${color}`; },
        formatEvaluationDate: value => value, getEvaluationCountdown: () => '03 días · 02 h · 01 min · 09 s',
        ACEdunityTime: { formatTime24ForDisplay: value => value }, ensureEvaluationCountdownTimer() {}, emptyStateHTML: () => 'empty'
    });
    vm.runInContext(['escapeHTML', 'getEvaluationStatusLabel', 'getEvaluationPriorityLabel', 'renderEvaluations'].map(declaration).join('\n'), scope);
    const colors = ['#ec4899', '#f97316', '#2563eb', '#10b981'];
    const workspace = { subjects: colors.map((color, id) => ({ id, name: `Materia ${id}`, color })),
        evaluations: ['pending', 'preparing', 'prepared', 'completed'].map((status, i) => ({
            id: `eval-${i}`, subjectId: i, title: i ? `Evaluación ${i}` : '<Título largo> '.repeat(30),
            status, priority: ['high', 'medium', 'low', 'medium'][i], topics: Array.from({ length: i }, (_, n) => `Tema ${n}`),
            date: '2026-10-29', time: i ? '12:15' : '', type: 'Examen', showInCalendar: true, remindersEnabled: false })) };
    const before = JSON.stringify(workspace); scope.renderEvaluations(workspace);
    assert.deepEqual(subjectStyles, colors);
    assert.equal(JSON.stringify(workspace), before);
    for (const state of ['pending', 'preparing', 'prepared', 'completed']) assert.match(container.innerHTML, new RegExp(`evaluation-status status-${state}`));
    for (const priority of ['high', 'medium', 'low']) assert.match(container.innerHTML, new RegExp(`evaluation-priority priority-${priority}`));
    assert.match(container.innerHTML, />0 temas<\/span>/); assert.match(container.innerHTML, />1 tema<\/span>/);
    assert.match(container.innerHTML, />3 temas<\/span>/); assert.match(container.innerHTML, /&lt;Título largo&gt;/);
    for (const action of ['view', 'edit', 'calendar', 'reminder', 'delete']) assert.match(container.innerHTML, new RegExp(`data-evaluation-${action}="eval-0"`));
    assert.equal((container.innerHTML.match(/data-evaluation-tutor=/g) || []).length, 3);
});

test('Countdown logic remains exact for Guayaquil, past dates and manually completed evaluations', () => {
    const now = Date.parse('2026-10-25T12:00:00-05:00');
    class FixedDate extends Date { static now() { return now; } }
    const scope = vm.createContext({ Date: FixedDate });
    vm.runInContext(declaration('getEvaluationCountdown'), scope);
    assert.equal(scope.getEvaluationCountdown({ date: '2026-10-26', time: '12:00' }), '01 días · 00 h · 00 min · 00 s');
    assert.equal(scope.getEvaluationCountdown({ date: '2026-10-26', time: '00:00' }), 'Hoy · 12 h · 00 min · 00 s');
    assert.equal(scope.getEvaluationCountdown({ date: '2026-10-24', time: '18:30' }), 'Evaluación finalizada');
    assert.equal(scope.getEvaluationCountdown({ date: '2026-10-26', time: '18:30', status: 'completed' }), 'Evaluación finalizada');
    assert.equal(scope.getEvaluationCountdown({ date: '' }), 'Sin fecha');
});

test('Compact CSS retains an uncut content flow, neutral frame, dynamic accent and unchanged column breakpoints', () => {
    const cardRule = css.match(/#evaluations \.evaluation-card \{([^}]+)\}/)[1];
    assert.match(cardRule, /padding: 15px 17px/); assert.match(cardRule, /gap: 8px/);
    assert.match(cardRule, /overflow: visible/); assert.doesNotMatch(cardRule, /(?:^|;)\s*(?:max-)?height:/);
    assert.doesNotMatch(cardRule, /border: [^;]*--subject-color/);
    assert.match(css, /inset 3px 0 0 var\(--subject-color\)/);
    assert.match(css, /#evaluations \.evaluation-card-meta \{[^}]*flex-wrap: wrap/);
    assert.match(css, /#evaluations \.evaluation-card h3 \{[^}]*overflow-wrap: anywhere/);
    assert.match(css, /#evaluations \.evaluation-menu button:focus-visible/);
    assert.match(css, /@media \(max-width: 1120px\) \{ \.evaluation-card-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(css, /#evaluations \.evaluation-card:hover,[\s\S]*?#evaluations \.evaluation-tutor-button \{ transition: none; transform: none; \}/);
});

test('Light subject labels keep their individual hue with AA contrast across the existing palette', () => {
    assert.match(css, /#evaluations \.evaluation-subject \{ color: color-mix\(in srgb, var\(--subject-color\) 58%, #172033\)/);
    const luminance = rgb => rgb.map(value => value / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const palette = source.match(/const subjectColorMap = \{([^}]+)\}/)[1].match(/#[0-9a-f]{6}/gi);
    for (const hex of palette) {
        const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16));
        const mixed = rgb.map((value, index) => value * .58 + [23, 32, 51][index] * .42);
        assert.ok((luminance([250, 250, 250]) + .05) / (luminance(mixed) + .05) >= 4.5, hex);
    }
});
