import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import '../google-calendar-manual.js';

const create = globalThis.createGoogleCalendarManualController;
const id = 'b2f158ae-a768-4d8f-9767-b20ae3ef48f1';
const user = '00000000-0000-4000-8000-000000000001';
const kinds = ['task', 'event', 'evaluation', 'project', 'goal', 'stage'];
function backend() {
    const rows = new Map(), calls = [];
    let failure = false, pause = null;
    return {
        rows, calls,
        fail(value) { failure = value; },
        pause(value) { pause = value; },
        from(table) {
            assert.equal(table, 'google_calendar_manual_links');
            let op = 'select', payload, filters = {}, range = [0, 999];
            const query = {
                select() { return query; }, eq(key, value) { filters[key] = value; return query; },
                order() { return query; }, range(a, b) { range = [a, b]; return query; },
                upsert(data, options) {
                    assert.equal(options.onConflict, 'user_id,entity_type,entity_id');
                    op = 'upsert'; payload = data; return query;
                },
                delete() { op = 'delete'; return query; }, single() { return query; },
                async then(resolve, reject) {
                    try {
                        calls.push({ op, filters: { ...filters }, payload });
                        if (pause) await pause;
                        if (failure) return resolve({ error: { code: 'TEST_FAILURE' } });
                        const matches = row => Object.entries(filters).every(([k, v]) => row[k] === v);
                        if (op === 'upsert') {
                            const key = `${payload.user_id}:${payload.entity_type}:${payload.entity_id}`;
                            const row = rows.get(key) || { ...payload, confirmed_at: new Date().toISOString() };
                            rows.set(key, row); return resolve({ data: row });
                        }
                        const found = [...rows.values()].filter(matches);
                        if (op === 'delete') for (const [key, row] of rows) { if (matches(row)) rows.delete(key); }
                        resolve({ data: found.slice(range[0], range[1] + 1) });
                    } catch (error) { reject(error); }
                }
            };
            return query;
        }
    };
}

for (const kind of kinds) test(`${kind}: explicit confirmation, persistence and exact unmark`, async () => {
    const db = backend(), options = { getUserId: () => user, getClient: () => db };
    const c = create(options);
    await c.load();
    assert.equal(c.state(kind, id).confirmed, false);
    assert.equal(await c.confirm(kind, id), false, 'No confirmation before opening');
    c.markOpened(kind, id);
    assert.equal(c.state(kind, id).opened, true);
    assert.equal(c.state(kind, id).confirmed, false, 'Opening is not a confirmation');
    const results = await Promise.all([c.confirm(kind, id), c.confirm(kind, id)]);
    assert.deepEqual(results, [true, false], 'Double click must be locked');
    assert.equal(db.rows.size, 1);
    assert.equal(c.state(kind, id).confirmed, true);
    assert.equal(c.state(kind, id).opened, false);
    const reloaded = create(options);
    await reloaded.load();
    assert.equal(reloaded.state(kind, id).confirmed, true);
    assert.equal(await reloaded.remove(kind, id), true);
    assert.equal(reloaded.state(kind, id).confirmed, false);
    assert.equal(db.rows.size, 0);
    assert.deepEqual(db.calls.at(-1).filters, { user_id: user, entity_type: kind, entity_id: id });
});

test('batch loading, account isolation and unauthenticated actions', async () => {
    const db = backend(); let account = user;
    const c = create({ getUserId: () => account, getClient: () => db });
    await Promise.all(kinds.map(() => c.load()));
    assert.equal(db.calls.length, 1, 'All cards share one query');
    c.markOpened('task', id); await c.confirm('task', id);
    account = '00000000-0000-4000-8000-000000000002';
    await c.load();
    assert.equal(c.state('task', id).confirmed, false);
    account = user; await c.load();
    assert.equal(c.state('task', id).confirmed, true);
    account = ''; c.markOpened('task', id);
    assert.equal(await c.confirm('task', id), false);
    assert.equal(c.state('task', id).valid, false);
    assert.equal(c.state('invalid', id).valid, false);
});

test('errors never falsely confirm or remove; retry succeeds', async () => {
    const db = backend(), errors = [];
    const c = create({ getUserId: () => user, getClient: () => db, onError: op => errors.push(op) });
    db.fail(true); assert.equal(await c.load(), false);
    assert.equal(c.state('task', id).loadFailed, true);
    db.fail(false); await c.load(); c.markOpened('task', id);
    db.fail(true); assert.equal(await c.confirm('task', id), false);
    assert.equal(c.state('task', id).confirmed, false);
    db.fail(false); await c.confirm('task', id);
    db.fail(true); assert.equal(await c.remove('task', id), false);
    assert.equal(c.state('task', id).confirmed, true);
    assert.deepEqual(errors, ['load', 'confirm', 'remove']);
});

test('response for a previous account cannot update current UI', async () => {
    const db = backend(); let account = user, release;
    const c = create({ getUserId: () => account, getClient: () => db });
    await c.load(); c.markOpened('task', id);
    db.pause(new Promise(resolve => { release = resolve; }));
    const write = c.confirm('task', id);
    await new Promise(resolve => setImmediate(resolve));
    account = ''; c.reset(); release();
    assert.equal(await write, false);
    assert.equal(c.state('task', id).confirmed, false);
});

test('a temporarily unavailable client can retry without getting stuck', async () => {
    const db = backend(); let available = false;
    const c = create({ getUserId: () => user, getClient: () => {
        if (!available) throw new Error('unavailable');
        return db;
    } });
    assert.equal(await c.load(), false);
    available = true;
    assert.equal(await c.load(), true);
    assert.equal(c.state('task', id).loadFailed, false);
});

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const taskStart = source.indexOf('function getTaskGoogleCalendarUrl');
const taskSource = source.slice(taskStart, source.indexOf('function renderTasks', taskStart));
test('TEMPLATE preserves explicit task hours, timezone and midnight rollover', () => {
    const ctx = vm.createContext({ URLSearchParams, normalizeDate: x => x?.slice(0, 10), getTaskPriorityLabel: x => x });
    vm.runInContext(source.slice(source.indexOf('function toGoogleCalendarDate'), source.indexOf('function openGoogleCalendarForEvent')), ctx);
    vm.runInContext(taskSource, ctx);
    for (const [time, dates] of [
        ['00:00', '20260905T000000/20260905T010000'],
        ['12:00', '20260905T120000/20260905T130000'],
        ['18:30', '20260905T183000/20260905T193000'],
        ['23:30', '20260905T233000/20260906T003000']
    ]) {
        const url = new URL(ctx.getTaskGoogleCalendarUrl({ title: 'Prueba', due: '2026-09-05', dueTime: time }));
        assert.equal(url.searchParams.get('dates'), dates);
        assert.equal(url.searchParams.get('ctz'), 'America/Guayaquil');
        assert.equal(url.searchParams.get('action'), 'TEMPLATE');
    }
    const allDay = new URL(ctx.getGoogleCalendarUrl({ title: 'Día', date: '2026-12-31', allDay: true }));
    assert.equal(allDay.searchParams.get('dates'), '20261231/20270101');
});

test('blocked window never marks opened; all four opening paths share controller', () => {
    let handle = null; const opened = [], notifications = [];
    const workspace = { tasks: [{ id, title: 'Prueba', due: '2026-09-05' }], events: [{ id, date: '2026-09-05' }], evaluations: [{ id, title: 'Prueba', date: '2026-09-05', topics: [] }] };
    const ctx = vm.createContext({ URLSearchParams, loadWorkspace: () => workspace,
        normalizeDate: x => x?.slice(0, 10), getTaskPriorityLabel: x => x,
        window: { open: url => { assert.ok(url.startsWith('https://calendar.google.com/calendar/render?')); return handle; } },
        ACGoogleCalendarManual: { markOpened: (...args) => opened.push(args) }, notify: (...args) => notifications.push(args) });
    vm.runInContext(taskSource, ctx);
    vm.runInContext(source.slice(source.indexOf('function toGoogleCalendarDate'), source.indexOf('function openEventForm')), ctx);
    vm.runInContext(source.slice(source.indexOf('function openGoogleCalendarForEvaluation'), source.indexOf('function prepareEvaluationWithTutor')), ctx);
    const actions = [() => ctx.openTaskInGoogleCalendar(id), () => ctx.openGoogleCalendarEvent(id),
        () => ctx.openGoogleCalendarForEvaluation(id), () => ctx.openAgendaItemInGoogleCalendar({ kind: 'project', entityId: id, date: '2026-09-05', title: 'Prueba' })];
    actions.forEach(action => action()); assert.equal(opened.length, 0);
    handle = {}; actions.forEach(action => action());
    assert.deepEqual(opened.map(([kind]) => kind), ['task', 'event', 'evaluation', 'project']);
    assert.equal(handle.opener, null);
});
