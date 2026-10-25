const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
function declaration(name) {
    const matches = [...source.matchAll(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'gm'))];
    assert.ok(matches.length, name);
    return matches.at(-1)[0];
}
function rendering(historical = false, filter = 'all') {
    const list = { innerHTML: '', querySelectorAll: () => [] };
    const calendarCalls = [];
    const scope = vm.createContext({ document: { getElementById: () => list },
        currentTaskFilter: filter, academicYearManager: { state: { historical } },
        getAcademicColorValue: () => '#8b5cf6', getAcademicCardStyle: () => '--subject-color:#8b5cf6',
        emptyStateHTML: () => '<p>empty</p>',
        ACGoogleCalendarManual: { render: (...args) => { calendarCalls.push(args); return '<button aria-label="Agregar a Google Calendar"></button>'; } }
    });
    vm.runInContext(['escapeHTML', 'normalizeDate', 'getTodayStart', 'parseTaskDate', 'getTaskDaysRemaining',
        'getTaskVisualStatus', 'getTaskStatusLabel', 'getTaskDaysText', 'getTaskPriorityClass', 'getTaskPriorityLabel',
        'taskCardIcon', 'renderTasks'].map(declaration).join('\n'), scope);
    return { scope, list, calendarCalls };
}
const date = offset => { const day = new Date(); day.setDate(day.getDate() + offset); return day.toISOString().slice(0, 10); };
const tasks = [
    { id: 'a', title: 'Pendiente', due: date(10), priority: 'media', remindersEnabled: false },
    { id: 'b', title: 'Próxima', due: date(1), priority: 'alta', remindersEnabled: true },
    { id: 'c', title: 'Vencida', due: date(-1), priority: 'baja', remindersEnabled: false },
    { id: 'd', title: 'Completada', status: 'completed', due: date(-1), priority: 'media', remindersEnabled: true }
];
test('Real status/priority/reminder values are presented without changing or sorting source records', () => {
    const f = rendering(), before = JSON.stringify(tasks);
    f.scope.renderTasks({ tasks, subjects: [] });
    const html = f.list.innerHTML;
    for (const state of ['pending', 'upcoming', 'completed', 'overdue']) assert.match(html, new RegExp(`data-status="${state}"`));
    for (const priority of ['high', 'medium', 'low']) assert.match(html, new RegExp(`data-priority="${priority}"`));
    assert.match(html, /data-reminders="true"/); assert.match(html, /data-reminders="false"/);
    assert.match(html, /onclick="toggleTask\(this\)" checked/);
    assert.equal(JSON.stringify(tasks), before);
    assert.equal(f.calendarCalls.length, 4);
    assert.ok(f.calendarCalls.every(call => call[0] === 'task' && call[2].compact === true));
    assert.doesNotMatch(html, /task-card-modern|task-meta-grid|data-task-complete/);
});
test('Icon actions retain the exact existing ids; all long text is escaped and accessible', () => {
    const f = rendering(), description = '<script>unsafe</script> ' + 'Detalles completos. '.repeat(40);
    f.scope.renderTasks({ tasks: [{ id: 'safe-id', title: '<img> & título largo '.repeat(8), description }], subjects: [] });
    const html = f.list.innerHTML;
    assert.match(html, /data-task-edit="safe-id" aria-label="Editar" data-tooltip="Editar"/);
    assert.match(html, /data-task-delete="safe-id" aria-label="Eliminar" data-tooltip="Eliminar"/);
    assert.match(html, /<details><summary>Ver descripción completa<\/summary>/);
    assert.ok(html.includes(f.scope.escapeHTML(description)));
    assert.doesNotMatch(html, /<script>|<img>/);
    assert.match(html, /aria-hidden="true" focusable="false"/);
});
test('Filters still use real status and historical cards cannot expose edit/delete/toggle writes', () => {
    const f = rendering(true, 'completed'); f.scope.renderTasks({ tasks, subjects: [] });
    assert.equal((f.list.innerHTML.match(/<article /g) || []).length, 1);
    assert.match(f.list.innerHTML, /onclick="toggleTask\(this\)" checked disabled/);
    assert.match(f.list.innerHTML, /data-task-edit="d"[^>]+ disabled/);
    assert.match(f.list.innerHTML, /data-task-delete="d"[^>]+ disabled/);
    assert.equal(f.calendarCalls.length, 1);
});

function dialogFixture() {
    const handlers = {}, calls = [], nodes = {};
    const document = { activeElement: null,
        querySelector: selector => selector === '.task-delete-modal' ? nodes.modal || null : nodes.fallback,
        createElement: () => modal,
        addEventListener: (name, callback) => { handlers[name] = callback; },
        removeEventListener: name => { delete handlers[name]; },
        body: { appendChild: value => { nodes.modal = value; } }
    };
    const button = () => ({ disabled: false, textContent: '', isConnected: true,
        focus() { document.activeElement = this; },
        addEventListener(name, callback) { this[name] = callback; } });
    const cancel = button(), confirm = button(), trigger = button(), fallback = button();
    nodes.fallback = fallback;
    const error = { hidden: true, textContent: '' }, card = { focus() { document.activeElement = this; }, setAttribute() {} };
    const modal = { innerHTML: '', classList: { add() {} },
        querySelector: selector => selector === '[role="dialog"]' ? card : selector.includes('data-cancel') ? cancel : selector.includes('data-confirm') ? confirm : error,
        querySelectorAll: () => [cancel, confirm].filter(node => !node.disabled),
        contains: node => [cancel, confirm, card].includes(node),
        addEventListener(name, callback) { this[name] = callback; }, remove() { delete nodes.modal; }, getAnimations: () => [] };
    const state = { historical: false }; let matches = true, result = true;
    const scope = vm.createContext({ document, currentUser: { id: 'owner' },
        loadWorkspace: () => ({ tasks: [{ id: 'task-id', title: '<Test>' }] }),
        academicYearManager: { state, scope: () => ({ yearId: 'year' }), matches: () => matches },
        taskCardIcon: () => '<svg/>',
        deleteTask: async id => { calls.push(id); return typeof result === 'function' ? result() : result; }
    });
    vm.runInContext(declaration('escapeHTML') + '\n' + declaration('openTaskDeleteDialog'), scope);
    const tick = () => new Promise(resolve => setImmediate(resolve));
    return { scope, nodes, modal, card, confirm, cancel, trigger, fallback, error, calls, document, handlers, state, tick,
        setResult: value => { result = value; }, changeYear: () => { matches = false; } };
}
test('Opening/cancelling/Escape never deletes; focus is trapped and restored', async () => {
    const f = dialogFixture(); f.scope.openTaskDeleteDialog('task-id', f.trigger);
    assert.equal(f.calls.length, 0); assert.equal(f.document.activeElement, f.cancel);
    assert.match(f.modal.innerHTML, /¿Seguro que quieres borrar la tarea\?/);
    assert.match(f.modal.innerHTML, /&lt;Test&gt;/);
    f.confirm.focus(); let prevented = false;
    f.handlers.keydown({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(f.document.activeElement, f.cancel);
    f.handlers.keydown({ key: 'Escape', preventDefault() {} }); await f.tick();
    assert.equal(f.nodes.modal, undefined); assert.equal(f.calls.length, 0);
    assert.equal(f.document.activeElement, f.trigger); assert.equal(f.handlers.keydown, undefined);
    f.scope.openTaskDeleteDialog('task-id', f.trigger);
    f.modal.click({ target: { closest: () => true } }); await f.tick();
    assert.equal(f.calls.length, 0); assert.equal(f.nodes.modal, undefined);
});
test('Confirmation calls the existing delete once, locks duplicate input, then restores safe focus', async () => {
    const f = dialogFixture(); let finish;
    f.setResult(() => new Promise(resolve => { finish = resolve; }));
    f.scope.openTaskDeleteDialog('task-id', f.trigger);
    const first = f.confirm.click(); await f.confirm.click();
    assert.deepEqual(f.calls, ['task-id']); assert.equal(f.confirm.disabled, true); assert.equal(f.cancel.disabled, true);
    assert.equal(f.confirm.textContent, 'Eliminando…');
    f.handlers.keydown({ key: 'Escape', preventDefault() {} }); assert.ok(f.nodes.modal);
    finish(true); await first; await f.tick();
    assert.equal(f.nodes.modal, undefined); assert.equal(f.document.activeElement, f.fallback);
});
test('Failed deletion preserves the dialog/data and allows retry without a second confirmation', async () => {
    const f = dialogFixture(); f.setResult(false); f.scope.openTaskDeleteDialog('task-id', f.trigger);
    await f.confirm.click();
    assert.ok(f.nodes.modal); assert.equal(f.confirm.disabled, false); assert.equal(f.error.hidden, false);
    assert.match(f.error.textContent, /Tus datos se conservan/);
    f.setResult(true); await f.confirm.click(); await f.tick();
    assert.deepEqual(f.calls, ['task-id', 'task-id']); assert.equal(f.nodes.modal, undefined);
});
test('A changed account/year or historical scope cannot submit the dialog', async () => {
    const f = dialogFixture(); f.scope.openTaskDeleteDialog('task-id', f.trigger); f.changeYear();
    await f.confirm.click(); assert.equal(f.calls.length, 0); assert.equal(f.error.hidden, false);
    const g = dialogFixture(); g.state.historical = true; g.scope.openTaskDeleteDialog('task-id', g.trigger);
    assert.equal(g.nodes.modal, undefined); assert.equal(g.calls.length, 0);
});
test('New CSS is isolated, keeps touch/focus/reduced motion, and does not modify global styles', () => {
    const css = fs.readFileSync(path.join(__dirname, '../task-cards.css'), 'utf8');
    assert.doesNotMatch(css, /#landing-page|#login-page|\.sidebar|#dashboard|\.task-meta-grid/);
    assert.match(css, /min-width: 44px/); assert.match(css, /:focus-visible::after/);
    assert.match(css, /overflow: visible/); assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /light-theme/); assert.match(css, /task-dialog-card-out 180ms/);
    assert.match(css, /task-dialog-card-in 200ms/);
});

test('Compact Calendar preserves open/confirm/remove/retry actions and stays compact on refresh', async () => {
    const id = '60000000-0000-4000-8000-000000000003';
    const host = { dataset: { gcalType: 'task', gcalId: id, gcalCompact: 'true' }, innerHTML: '' };
    let fail = false;
    function query() {
        let single = false;
        const q = { select: () => q, eq: () => q, order: () => q, range: () => q, delete: () => q,
            upsert: () => q, single: () => { single = true; return q; },
            then(resolve, reject) { return Promise.resolve({ data: single ? { confirmed_at: '2026-10-25T00:00:00Z' } : [], error: fail ? new Error('fixture') : null }).then(resolve, reject); } };
        return q;
    }
    const scope = vm.createContext({ currentUser: { id: 'owner' },
        academicYearManager: { selected: () => ({ id: 'year' }) }, academicTable: query,
        document: { activeElement: null, querySelectorAll: () => [host], addEventListener() {} },
        console: { warn() {} }, notify() {} });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../google-calendar-manual.js'), 'utf8'), scope);
    const calendar = scope.ACGoogleCalendarManual; await calendar.load();
    assert.match(calendar.render('task', id, { compact: true }), /data-gcal-compact="true"/);
    assert.match(host.innerHTML, /data-gcal-action="open"/);
    assert.match(host.innerHTML, /aria-label="Agregar a Google Calendar"/);
    calendar.markOpened('task', id);
    assert.match(host.innerHTML, /data-gcal-action="confirm"/);
    assert.equal(await calendar.confirm('task', id), true);
    assert.match(host.innerHTML, /data-gcal-action="remove"/);
    assert.match(host.innerHTML, /is-confirmed/);
    assert.equal(await calendar.remove('task', id), true);
    assert.match(host.innerHTML, /data-gcal-action="open"/);
    assert.doesNotMatch(calendar.render('event', id, { compact: true }), /data-gcal-compact="true"|task-card__action/);
    assert.match(calendar.render('event', id), />Agregar a Google Calendar<\/button>/);
    fail = true; calendar.reset(); await calendar.load();
    assert.match(host.innerHTML, /data-gcal-action="retry"/);
    assert.match(host.innerHTML, /aria-label="Reintentar estado de Google Calendar"/);
});
