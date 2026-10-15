const test = require('node:test');
const assert = require('node:assert/strict');
const { getCurrentAcademicYear, createManager, TABLES } = require('../academic-years.js');

test('April boundary and March transition use Ecuador, including leap February', () => {
    for (const date of ['2026-10-15', '2027-01-15', '2027-02-15', '2027-03-15']) {
        assert.equal(getCurrentAcademicYear(new Date(`${date}T12:00:00-05:00`)).label, '2026 - 2027');
    }
    assert.equal(getCurrentAcademicYear(new Date('2027-04-01T04:59:59Z')).startYear, 2026);
    assert.equal(getCurrentAcademicYear(new Date('2027-04-01T05:00:00Z')).startYear, 2027);
    assert.equal(getCurrentAcademicYear(new Date('2027-04-01T05:00:00Z')).endDate, '2028-02-29');
});

function fixture(owner = 'account-a') {
    const calls = [], years = [2026, 2027].map(n => ({ id: `year-${n}`, user_id: owner, start_year: n, label: `${n} - ${n + 1}` }));
    const client = {
        rpc: async () => ({ data: { years, current_id: years[1].id, selected_id: years[0].id }, error: null }),
        from(name) {
            const call = { name, filters: [] }; calls.push(call);
            const builder = new Proxy({}, { get(_, key) {
                if (key === 'then') return resolve => resolve({ data: { user_id: owner }, error: null });
                return (...args) => {
                    if (['select', 'insert', 'update', 'delete', 'upsert'].includes(key)) { call.method ||= key; if (['insert', 'update', 'upsert'].includes(key)) call.payload = args[0]; }
                    if (key === 'eq') call.filters.push(args);
                    return builder;
                };
            } });
            return builder;
        }
    };
    return { calls, client, owner };
}

test('Every academic table filters the server by cycle and owner; all mutations carry the cycle', async () => {
    const f = fixture(), manager = createManager(); await manager.start(f.client, f.owner);
    await manager.select('year-2027', async () => {});
    for (const name of TABLES) {
        await manager.table(name).select('*');
        assert.deepEqual(f.calls.at(-1).filters.find(x => x[0] === 'academic_year_id'), ['academic_year_id', 'year-2027']);
        if (name !== 'grade_items') assert.ok(f.calls.at(-1).filters.some(x => x[0] === 'user_id' && x[1] === f.owner));
        await manager.table(name).insert({ title: 'Test' });
        assert.equal(f.calls.at(-1).payload.academic_year_id, 'year-2027');
        await manager.table(name).update({ title: 'Updated' }).eq('id', 'item');
        assert.ok(f.calls.at(-1).filters.some(x => x[0] === 'academic_year_id'));
        await manager.table(name).delete().eq('id', 'item');
        assert.ok(f.calls.at(-1).filters.some(x => x[0] === 'academic_year_id'));
    }
    assert.throws(() => manager.table('profiles'));
    assert.throws(() => manager.table('tasks').insert({ academic_year_id: 'wrong' }));
    assert.throws(() => manager.table('tasks').insert({ user_id: 'someone-else' }));
});

test('Future selection performs no write; history is readable but academic mutations are blocked', async () => {
    const f = fixture(), manager = createManager(); await manager.start(f.client, f.owner);
    const before = f.calls.length;
    await assert.rejects(manager.select('year-2028', async () => {}), /1 de abril de 2028/);
    assert.equal(f.calls.length, before);
    assert.equal(manager.state.historical, true);
    await manager.table('tasks').select();
    for (const method of ['insert','upsert','update','delete']) assert.throws(() => manager.table('tasks')[method]({ title: 'Forbidden' }), /Año histórico/);
    await manager.select('year-2027', async () => {});
    assert.equal(manager.state.historical, false);
    await manager.table('tasks').insert({ title: 'Allowed' });
});

test('Switching persists selection, invalidates stale builders, restores on failure, and isolates account changes', async () => {
    const f = fixture(), manager = createManager(); await manager.start(f.client, f.owner);
    const stale = manager.table('tasks').select();
    await manager.select('year-2027', async scope => assert.equal(scope.yearId, 'year-2027'));
    await assert.rejects(async () => { await stale; }, /cambió/);
    await manager.table('tasks').insert({ title: 'New cycle' });
    assert.equal(f.calls.at(-1).payload.academic_year_id, 'year-2027');
    await assert.rejects(manager.select('year-2026', async () => { throw new Error('offline'); }), /offline/);
    assert.equal(manager.selected().id, 'year-2027');
    manager.reset(); assert.equal(manager.selected(), null); assert.throws(() => manager.table('tasks'));
    const second = fixture('account-b'); await manager.start(second.client, second.owner);
    assert.equal(manager.selected().user_id, 'account-b');
});

test('Actual production callers cannot bypass the academic table helper', () => {
    const fs = require('node:fs');
    for (const file of ['app.js', 'goals-projects.js']) {
        const source = fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8');
        const names = [...TABLES].join('|');
        assert.equal(new RegExp(`(?:getSupabaseClient\\(\\)|sb)\\s*\\.from\\(['\"](${names})['\"]\\)`).test(source), false, file);
    }
});
