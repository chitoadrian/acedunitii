const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'calendar-ui.css'), 'utf8');
const functions = new Map(acorn.parse(source, { ecmaVersion: 'latest' }).body
    .filter(node => node.type === 'FunctionDeclaration')
    .map(node => [node.id.name, source.slice(node.start, node.end)]));
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
function setup(workspace) {
    const calendar = { innerHTML: '' }, agenda = { innerHTML: '', querySelectorAll: () => [] };
    const calls = [];
    const context = vm.createContext({ Date, Intl, URLSearchParams, escapeHTML,
        document: { getElementById: () => calendar, querySelector: () => agenda },
        loadWorkspace: () => workspace, getGoalsProjectsCalendarItems: ws => ws.planning || [],
        getAcademicCardStyle: () => '--subject-color:#8b5cf6;', isEventSoon: () => false,
        ACEdunityTime: { formatTime24ForDisplay: (time, fallback) => time || fallback },
        emptyStateHTML: (title, label, action) => `<div class="empty-state">${title}<button onclick="${action}">${label}</button></div>`,
        ACGoogleCalendarManual: {
            renderCalendarRemove: (type, id) => { calls.push(['remove', type, id]); return `<button data-gcal-calendar-remove="${type}" data-gcal-id="${id}">Quitar</button>`; },
            render: (type, id) => { calls.push(['google', type, id]); return `<div data-gcal-type="${type}" data-gcal-id="${id}"></div>`; }
        }
    });
    vm.runInContext('let calendarViewDate = new Date(2026,9,1);\n' +
        ['getCalendarDateKey', 'getEventDateKey', 'taskCardIcon', 'calendarAgendaActionHTML', 'generateCalendar', 'changeCalendarMonth', 'renderCalendarSection']
            .map(name => functions.get(name)).join('\n'), context);
    return { context, calendar, agenda, calls };
}
const workspace = () => ({ subjects: [{ id: 's', name: 'Matemática', color: 'Morado' }],
    events: [{ id: 'e', title: 'Evento <seguro>', subjectId: 's', type: 'Recordatorio', date: '2026-10-28', time: '12:00', remindersEnabled: true }],
    evaluations: [{ id: 'v', title: 'Evaluación', type: 'Examen', date: '2026-10-28', time: '14:30', showInCalendar: true },
        { id: 'hidden', title: 'NO VISIBLE', date: '2026-10-28', showInCalendar: false }],
    planning: [{ id: 'p', entityId: 'project-id', projectId: 'project-id', title: 'Proyecto', kind: 'project', calendarType: 'Proyecto', date: '2026-10-29' }]
});

test('Agenda preserves real records, chronological order, IDs, subjects and reminder data', () => {
    const ws = workspace(), before = JSON.stringify(ws), { context, agenda, calls } = setup(ws);
    context.renderCalendarSection(ws);
    assert.equal(JSON.stringify(ws), before);
    assert.equal((agenda.innerHTML.match(/class="event-item event-custom/g) || []).length, 3);
    assert.ok(agenda.innerHTML.indexOf('Evento &lt;seguro&gt;') < agenda.innerHTML.indexOf('<h4>Evaluación'));
    assert.ok(agenda.innerHTML.indexOf('<h4>Evaluación') < agenda.innerHTML.indexOf('<h4>Proyecto'));
    assert.doesNotMatch(agenda.innerHTML, /NO VISIBLE/);
    assert.match(agenda.innerHTML, /Matemática/);
    assert.match(agenda.innerHTML, /28 oct 2026 · 12:00/);
    for (const [type, id] of [['event', 'e'], ['evaluation', 'v'], ['project', 'project-id']]) {
        assert.ok(calls.some(call => call.join('/') === `remove/${type}/${id}`));
        assert.ok(calls.some(call => call.join('/') === `google/${type}/${id}`));
    }
    for (const attribute of ['data-event-edit="e"', 'data-event-delete="e"', 'data-calendar-evaluation="v"', 'data-calendar-planning="project-id"']) assert.ok(agenda.innerHTML.includes(attribute));
    assert.doesNotMatch(agenda.innerHTML, /data-event-delete="v"/);
});

test('Month counts include all visible activity sources and exclude hidden evaluations', () => {
    const { context, calendar } = setup(workspace()); context.generateCalendar();
    assert.match(calendar.innerHTML, /28 de Octubre de 2026: 2 actividades/);
    assert.match(calendar.innerHTML, /29 de Octubre de 2026: 1 actividades/);
    assert.doesNotMatch(calendar.innerHTML, /NO VISIBLE/);
    assert.equal((calendar.innerHTML.match(/calendar-event-marker/g) || []).length, 2);
});

for (const [year, month, days, leading] of [[2026, 9, 31, 3], [2026, 10, 30, 6], [2028, 1, 29, 1], [2027, 1, 28, 0]]) {
    test(`Month ${year}-${month + 1} retains Monday-first grid and ${days} actual days`, () => {
        const { context, calendar } = setup({ events: [], evaluations: [] });
        vm.runInContext(`calendarViewDate = new Date(${year},${month},1)`, context); context.generateCalendar();
        assert.equal((calendar.innerHTML.match(/tabindex="0"/g) || []).length, days);
        const cells = calendar.innerHTML.slice(calendar.innerHTML.indexOf('calendar-grid-wide'));
        assert.equal((cells.split('tabindex="0"')[0].match(/calendar-day muted/g) || []).length, leading);
        assert.doesNotMatch(calendar.innerHTML, /calendar-event-marker/);
    });
}

test('Month navigation crosses a year boundary without changing or filtering agenda records', () => {
    const ws = workspace(), before = JSON.stringify(ws), { context, calendar } = setup(ws);
    vm.runInContext('calendarViewDate = new Date(2026,11,1)', context);
    context.changeCalendarMonth(1); assert.match(calendar.innerHTML, /Enero 2027/);
    context.changeCalendarMonth(-1); assert.match(calendar.innerHTML, /Diciembre 2026/);
    assert.equal(JSON.stringify(ws), before);
});

test('Empty agenda keeps its existing create action and no invented activities', () => {
    const { context, agenda } = setup({ events: [], evaluations: [] });
    context.renderCalendarSection({ events: [], evaluations: [] });
    assert.match(agenda.innerHTML, /No tienes eventos programados/);
    assert.match(agenda.innerHTML, /Agendar evento/);
    assert.match(agenda.innerHTML, /addCalendarEventUI\(\)/);
    assert.doesNotMatch(agenda.innerHTML, /event-item event-custom/);
});

test('Icon actions retain accessible labels, escaped IDs and the original handlers', () => {
    const { context } = setup(workspace());
    const html = context.calendarAgendaActionHTML('eye', 'Ver "evaluación"', 'data-calendar-evaluation', 'a"b');
    assert.match(html, /aria-label="Ver &quot;evaluación&quot;"/);
    assert.match(html, /data-calendar-evaluation="a&quot;b"/);
    assert.match(html, /<svg[^>]+aria-hidden="true"/);
    const render = functions.get('renderCalendarSection');
    for (const handler of ['openEventForm(button.dataset.eventEdit)', 'deleteEvent(button.dataset.eventDelete)', 'openEvaluationDetail(button.dataset.calendarEvaluation)']) assert.ok(render.includes(handler));
    assert.doesNotMatch(render, /getSupabaseClient|\.from\(|syncWorkspaceFromSupabase|setInterval|fetch\(/);
});

test('Calendar styling is isolated, keeps seven columns and supports mobile/light/reduced motion', () => {
    assert.match(css, /body\.light-theme #app-page #calendar/);
    assert.match(css, /@media \(max-width: 767px\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /\.calendar-day \{[\s\S]*?height: auto !important/);
    assert.match(css, /#custom-events-list \{ max-height: none !important; overflow: visible/);
    assert.match(source, /grid-template-columns: repeat\(7, 1fr\)/);
    assert.doesNotMatch(css, /(?:#tasks|#dashboard|#grades|#landing-page|\.sidebar)\s*\{/);
    assert.match(css, /\.event-notification-field \{\s*grid-column: 1 \/ -1/);
});
