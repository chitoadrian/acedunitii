const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
function declaration(name) {
    return [...source.matchAll(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'gm'))].at(-1)[0];
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function context(names, values = {}) {
    const scope = vm.createContext({ console: { log() {}, info() {} },
        measureAppOperation: async (_, operation) => operation(), ...values });
    vm.runInContext(names.map(declaration).join('\n'), scope);
    return scope;
}
function fixture() {
    const pending = deferred(), calls = [], scopeValue = { userId: 'owner', yearId: 'year', generation: 1 };
    const resource = { id: 'pdf', title: 'Metadata', fileName: 'note.pdf', fileLoaded: false, fileDataUrl: '' };
    const scope = context(['ensureResourceFile'], {
        currentUser: { id: 'owner' }, workspaceState: { resources: [resource] }, resourceFileRequests: new Map(),
        academicYearManager: { scope: () => scopeValue, matches: value => value.yearId === scopeValue.yearId },
        academicTable: table => ({ select(columns) { calls.push({ table, columns }); return {
            eq(key, value) { calls.at(-1).filter = [key, value]; return { single: () => pending.promise }; }
        }; } })
    });
    return { scope, scopeValue, resource, pending, calls };
}

test('Startup selects only real metadata columns, never the PDF payload, while retaining all cards', () => {
    const columns = source.match(/const RESOURCE_METADATA_COLUMNS = '([^']+)'/)[1];
    assert.equal(columns.includes('file_url'), false);
    for (const name of ['id', 'user_id', 'subject_id', 'title', 'file_name', 'description', 'created_at', 'academic_year_id']) assert.ok(columns.split(',').includes(name));
    assert.match(declaration('syncWorkspaceFromSupabase'), /academicTable\('resources'\)\.select\(RESOURCE_METADATA_COLUMNS\)/);
    const scope = context(['mapSavedResourceRow'], { getWorkspaceSubjectName: () => 'Subject' });
    assert.equal(scope.mapSavedResourceRow({ id: 'a' }).fileLoaded, false);
    assert.equal(scope.mapSavedResourceRow({ id: 'a', file_url: null }).fileLoaded, true);
});

test('One selected PDF is fetched once, concurrent clicks share the request, and no global sync occurs', async () => {
    const f = fixture(), first = f.scope.ensureResourceFile('pdf'), second = f.scope.ensureResourceFile('pdf');
    assert.equal(first, second); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].table, 'resources'); assert.equal(f.calls[0].columns, 'id,file_url');
    assert.deepEqual(f.calls[0].filter, ['id', 'pdf']);
    f.scope.workspaceState.resources[0] = { ...f.resource, title: 'Newer metadata' };
    f.pending.resolve({ data: { id: 'pdf', file_url: 'data:application/pdf;base64,TEST' }, error: null });
    const loaded = await first;
    assert.equal(loaded.title, 'Newer metadata'); assert.equal(loaded.fileLoaded, true);
    assert.equal(loaded.fileDataUrl, 'data:application/pdf;base64,TEST');
    await f.scope.ensureResourceFile('pdf'); assert.equal(f.calls.length, 1);
    assert.equal(f.scope.resourceFileRequests.size, 0);
});

test('Late file responses cannot cross accounts/years, resurrect deleted resources or overwrite new uploads', async () => {
    const wrong = fixture(); wrong.scope.currentUser = { id: 'another-owner' };
    await assert.rejects(wrong.scope.ensureResourceFile('pdf'), /no está disponible/); assert.equal(wrong.calls.length, 0);
    const stale = fixture(), pending = stale.scope.ensureResourceFile('pdf');
    stale.scope.scopeCaptured = stale.scopeValue; stale.scopeValue.yearId = 'different-year';
    stale.scope.academicYearManager.matches = () => false;
    stale.pending.resolve({ data: { id: 'pdf', file_url: 'old' } });
    await assert.rejects(pending, /año lectivo cambió/); assert.equal(stale.scope.workspaceState.resources[0].fileLoaded, false);
    const deleted = fixture(), deletedPending = deleted.scope.ensureResourceFile('pdf');
    deleted.scope.workspaceState.resources = []; deleted.pending.resolve({ data: { id: 'pdf', file_url: 'old' } });
    await assert.rejects(deletedPending, /ya no está disponible/);
    const edited = fixture(), editPending = edited.scope.ensureResourceFile('pdf');
    edited.scope.workspaceState.resources = [{ ...edited.resource, fileLoaded: true, fileDataUrl: 'new-upload' }];
    edited.pending.resolve({ data: { id: 'pdf', file_url: 'old-upload' } });
    assert.equal((await editPending).fileDataUrl, 'new-upload');
});

test('Read errors leave metadata intact and release the in-flight slot for retry', async () => {
    const f = fixture(), request = f.scope.ensureResourceFile('pdf');
    f.pending.resolve({ error: new Error('offline') });
    await assert.rejects(request, /offline/);
    assert.equal(f.scope.resourceFileRequests.size, 0);
    assert.equal(f.scope.workspaceState.resources[0].fileLoaded, false);
});

test('Editing metadata never writes null over an unloaded PDF; replacement uploads still save the new file', async () => {
    let form, saved;
    const resource = { id: 'pdf', title: 'Old title', fileName: 'note.pdf', fileLoaded: false, fileDataUrl: '', description: 'Description' };
    const scope = context(['openResourceForm'], {
        loadWorkspace: () => ({ resources: [resource], subjects: [] }), openQuickForm: config => { form = config; },
        getSubjectOptions: () => ['General'], findSubjectByName: () => null,
        readFileAsDataUrl: async () => 'data:application/pdf;base64,NEW', getCurrentSupabaseUser: async () => ({ id: 'owner' }),
        academicTable: () => ({ update(payload) { saved = payload; const builder = { eq: () => builder, select: () => builder,
            single: async () => ({ data: { id: resource.id, ...payload, file_url: payload.file_url || 'old-pdf' }, error: null }) }; return builder; } }),
        replaceWorkspaceItem() {}, mapSavedResourceRow: value => value, pushRecentMessage() {}, refreshResourceViews() {}, notify() {}
    });
    scope.openResourceForm('pdf');
    const values = { title: 'New title', subject: 'General', description: 'Edited', tag: 'Apunte' };
    assert.equal(await form.onSubmit(values), true);
    assert.equal(Object.hasOwn(saved, 'file_url'), false, 'Postgres keeps the existing file untouched');
    assert.equal(saved.title, 'New title');
    scope.openResourceForm('pdf');
    assert.equal(await form.onSubmit({ ...values, file: { name: 'new.pdf', type: 'application/pdf' } }), true);
    assert.equal(saved.file_url, 'data:application/pdf;base64,NEW');
});

test('PDF viewing reserves its original tab synchronously and reuses it after the read', async () => {
    const pending = deferred(), calls = [], resource = { id: 'pdf', title: 'Test', fileLoaded: false };
    const tab = { document: { title: '', body: {} }, close: () => calls.push('close') };
    const scope = context(['viewResource'], {
        loadWorkspace: () => ({ resources: [resource] }), window: { open: () => { calls.push('open'); return tab; } },
        ensureResourceFile: () => { calls.push('read'); return pending.promise; },
        openPdfResource: (_, __, suppliedTab) => { assert.equal(suppliedTab, tab); calls.push('show'); }, notify() {}
    });
    scope.viewResource('pdf'); assert.deepEqual(calls, ['open', 'read']);
    pending.resolve({ ...resource, fileLoaded: true, fileDataUrl: 'PDF' });
    await Promise.resolve(); await Promise.resolve(); assert.deepEqual(calls, ['open', 'read', 'show']);
});
