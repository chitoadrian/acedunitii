const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../backpack-ui.css'), 'utf8');
const functions = new Map(acorn.parse(source, { ecmaVersion: 'latest' }).body.filter(n => n.type === 'FunctionDeclaration').map(n => [n.id.name, source.slice(n.start, n.end)]));
function load(names, scope) { vm.runInContext(names.map(n => { assert.ok(functions.has(n), n); return functions.get(n); }).join('\n'), scope); }
function rendering(historical = false) {
    const list = { innerHTML: '', querySelectorAll: () => [] };
    const header = { innerHTML: '' }, section = { querySelector: selector => selector === '.section-header' ? header : null };
    const scope = vm.createContext({ document: { activeElement: null, getElementById: () => section, querySelector: () => list },
        academicYearManager: { state: { historical } }, ensureBackpackToolbar() {}, bindBackpackToolbar() {},
        getBackpackResourcesForView: ws => ws.resources, getResourceColor: () => '#8b5cf6', getAcademicColorValue: x => x,
        getAcademicCardStyle: x => `--subject-color:${x}`, emptyStateHTML: () => '<p>empty</p>' });
    load(['escapeHTML', 'backpackCardIcon', 'getResourceStatus', 'formatResourceDate', 'getRelativeResourceDate', 'renderBackpack'], scope);
    return { scope, list };
}

test('Compact cards preserve every real value and ID; all four actions have icon labels/tooltips', () => {
    const f = rendering(), resource = { id: 'pdf-id', title: 'Álgebra', subject: 'Matemática', fileName: 'guia-completa.pdf', description: 'Descripción', tag: 'Guía', uploadedAt: '2026-10-20T12:00:00Z' };
    const before = JSON.stringify(resource); f.scope.renderBackpack({ resources: [resource], subjects: [] });
    assert.equal(JSON.stringify(resource), before);
    assert.match(f.list.innerHTML, /class="bp-resource-card" style="--subject-color:#8b5cf6"/);
    for (const value of ['Álgebra', 'Matemática', 'guia-completa.pdf', 'Descripción', 'Guía', '20/10/2026']) assert.ok(f.list.innerHTML.includes(value));
    for (const [action, label] of [['view', 'Ver recurso'], ['ai', 'Preguntar a Tutor'], ['edit', 'Editar'], ['delete', 'Eliminar']]) {
        assert.ok(f.list.innerHTML.includes(`data-resource-${action}="pdf-id" aria-label="${label}" data-tooltip="${label}"`));
    }
    assert.equal((f.list.innerHTML.match(/class="bp-card-action/g) || []).length, 5); // footer + four buttons
    assert.match(f.list.innerHTML, /aria-hidden="true" focusable="false"/);
    assert.doesNotMatch(f.list.innerHTML, />Ver<\/button>|>Preguntar a Tutor<\/button>|resource-actions-grid|neon-lines/);
});

test('Long titles/files stay complete, long descriptions are expandable, and hostile text is escaped', () => {
    const f = rendering(), title = '<img onerror="bad"> ' + 'Título completo '.repeat(20), description = '<script>bad()</script> ' + 'Descripción completa. '.repeat(40);
    f.scope.renderBackpack({ resources: [{ id: 'a"b', title, fileName: 'archivo-largo.pdf'.repeat(12), description }], subjects: [] });
    assert.ok(f.list.innerHTML.includes(f.scope.escapeHTML(title)));
    assert.ok(f.list.innerHTML.includes(f.scope.escapeHTML(description)));
    assert.match(f.list.innerHTML, /<details><summary>Ver descripción completa<\/summary>/);
    assert.match(f.list.innerHTML, /data-resource-view="a&quot;b"/);
    assert.doesNotMatch(f.list.innerHTML, /<img|<script>/);
});

test('Historical cards keep read actions but cannot expose enabled edit/delete actions', () => {
    const f = rendering(true); f.scope.renderBackpack({ resources: [{ id: 'historical', title: 'Historia' }], subjects: [] });
    assert.match(f.list.innerHTML, /data-resource-edit="historical"[^>]+ disabled/);
    assert.match(f.list.innerHTML, /data-resource-delete="historical"[^>]+ disabled/);
    assert.doesNotMatch(f.list.innerHTML, /data-resource-view="historical"[^>]+ disabled/);
    const renderer = functions.get('renderBackpack');
    for (const handler of ['viewResource(button.dataset.resourceView)', 'askAIAboutResource(button.dataset.resourceAi)', 'openResourceForm(button.dataset.resourceEdit)', 'openResourceDeleteDialog(button.dataset.resourceDelete, button)']) assert.ok(renderer.includes(handler));
    assert.doesNotMatch(renderer, /\.from\(|syncWorkspaceFromSupabase|fetch\(/);
});

test('Existing status logic presents new, used and pending without inventing resource states', () => {
    const f = rendering(); f.scope.renderBackpack({ resources: [
        { id: 'new', title: 'Nuevo', uploadedAt: new Date().toISOString() },
        { id: 'used', title: 'Usado', usedAI: true }, { id: 'old', title: 'Antiguo', uploadedAt: '2020-01-01' }
    ], subjects: [] });
    for (const state of ['new', 'used', 'pending']) assert.ok(f.list.innerHTML.includes(`data-state="${state}"`));
});

test('Rerendering search preserves keyboard focus and the exact selection without changing filter data', () => {
    const f = rendering(), calls = [], originalLookup = f.scope.document.getElementById;
    f.scope.document.activeElement = { id: 'backpack-search', selectionStart: 2, selectionEnd: 4 };
    const replacement = { focus(options) { calls.push(['focus', options.preventScroll]); }, setSelectionRange(start, end) { calls.push(['selection', start, end]); } };
    f.scope.document.getElementById = id => id === 'backpack-search' ? replacement : originalLookup(id);
    f.scope.renderBackpack({ resources: [{ id: 'search-result', title: 'Guía' }], subjects: [] });
    assert.deepEqual(calls, [['focus', true], ['selection', 2, 4]]);
});

test('Original search, subject/type filters and sorting keep their values, order and source data', () => {
    const resources = [{ id: 'a', title: 'Raíces', subject: 'Matemática', tag: 'Guia', type: 'PDF', uploadedAt: '2026-01-01' },
        { id: 'b', title: 'Texto', subject: 'Lengua', tag: 'Apunte', type: 'PDF', uploadedAt: '2026-02-01' }];
    const scope = vm.createContext({ backpackFilterText: '', backpackSubjectFilter: 'all', backpackTypeFilter: 'all', backpackSortMode: 'recent',
        normalizeTutorText: x => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() });
    load(['getBackpackResourcesForView'], scope);
    const ids = () => Array.from(scope.getBackpackResourcesForView({ resources }), x => x.id), before = JSON.stringify(resources);
    assert.deepEqual(ids(), ['b', 'a']); scope.backpackSortMode = 'oldest'; assert.deepEqual(ids(), ['a', 'b']);
    scope.backpackFilterText = 'raices'; assert.deepEqual(ids(), ['a']); scope.backpackFilterText = '';
    scope.backpackSubjectFilter = 'Lengua'; assert.deepEqual(ids(), ['b']); scope.backpackSubjectFilter = 'all';
    scope.backpackTypeFilter = 'Guia'; assert.deepEqual(ids(), ['a']); assert.equal(JSON.stringify(resources), before);
});

function dialogFixture() {
    const handlers = {}, nodes = {}, calls = [];
    const document = { activeElement: null, querySelector: () => nodes.modal || null,
        createElement: () => modal, getElementById: () => fallback,
        addEventListener: (name, callback) => { handlers[name] = callback; }, removeEventListener: name => { delete handlers[name]; },
        body: { appendChild: value => { nodes.modal = value; } } };
    const button = () => ({ disabled: false, textContent: '', isConnected: true, focus() { document.activeElement = this; }, addEventListener(name, callback) { this[name] = callback; } });
    const cancel = button(), confirm = button(), trigger = button(), fallback = button();
    const error = { hidden: true, textContent: '' }, card = { focus() { document.activeElement = this; }, setAttribute() {} };
    const modal = { innerHTML: '', classList: { add() {} },
        querySelector: selector => selector === '[role="dialog"]' ? card : selector.includes('data-cancel') ? cancel : selector.includes('data-confirm') ? confirm : error,
        querySelectorAll: () => [cancel, confirm].filter(node => !node.disabled), contains: node => [cancel, confirm, card].includes(node),
        addEventListener(name, callback) { this[name] = callback; }, remove() { delete nodes.modal; }, getAnimations: () => [] };
    const state = { historical: false }; let matches = true, result = true;
    const scope = vm.createContext({ document, currentUser: { id: 'owner' }, loadWorkspace: () => ({ resources: [{ id: 'test-resource', title: '<Test>' }] }),
        academicYearManager: { state, scope: () => ({ yearId: 'year' }), matches: () => matches },
        deleteResource: async id => { calls.push(id); return typeof result === 'function' ? result() : result; } });
    load(['escapeHTML', 'backpackCardIcon', 'openResourceDeleteDialog'], scope);
    return { scope, modal, card, nodes, confirm, cancel, trigger, fallback, error, calls, document, handlers, state,
        tick: () => new Promise(resolve => setImmediate(resolve)), setResult: value => { result = value; }, changeYear: () => { matches = false; } };
}

test('Resource confirmation opens/cancels/Escapes safely, traps focus and restores the trigger', async () => {
    const f = dialogFixture(); f.scope.openResourceDeleteDialog('test-resource', f.trigger);
    assert.equal(f.calls.length, 0); assert.equal(f.document.activeElement, f.cancel);
    assert.match(f.modal.innerHTML, /¿Seguro que quieres eliminar este recurso\?/); assert.match(f.modal.innerHTML, /&lt;Test&gt;/);
    f.confirm.focus(); let prevented = false; f.handlers.keydown({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(f.document.activeElement, f.cancel);
    f.handlers.keydown({ key: 'Escape', preventDefault() {} }); await f.tick();
    assert.equal(f.nodes.modal, undefined); assert.equal(f.calls.length, 0); assert.equal(f.document.activeElement, f.trigger);
    f.scope.openResourceDeleteDialog('test-resource', f.trigger); f.modal.click({ target: { closest: () => true } }); await f.tick();
    assert.equal(f.nodes.modal, undefined); assert.equal(f.calls.length, 0);
});

test('Only confirmation deletes the exact resource once; repeated clicks and Escape are locked while busy', async () => {
    const f = dialogFixture(); let finish; f.setResult(() => new Promise(resolve => { finish = resolve; }));
    f.scope.openResourceDeleteDialog('test-resource', f.trigger); const first = f.confirm.click(); await f.confirm.click();
    assert.deepEqual(f.calls, ['test-resource']); assert.equal(f.confirm.disabled, true); assert.equal(f.cancel.disabled, true);
    f.handlers.keydown({ key: 'Escape', preventDefault() {} }); assert.ok(f.nodes.modal);
    finish(true); await first; await f.tick(); assert.equal(f.nodes.modal, undefined); assert.equal(f.document.activeElement, f.fallback);
});

test('Failed deletion remains retryable; changed accounts/years and history cannot confirm', async () => {
    const f = dialogFixture(); f.setResult(false); f.scope.openResourceDeleteDialog('test-resource', f.trigger); await f.confirm.click();
    assert.ok(f.nodes.modal); assert.equal(f.error.hidden, false); assert.match(f.error.textContent, /Tus datos se conservan/);
    f.setResult(true); await f.confirm.click(); await f.tick(); assert.equal(f.nodes.modal, undefined);
    for (const change of [g => g.changeYear(), g => { g.scope.currentUser = { id: 'other' }; }, g => { g.state.historical = true; }]) {
        const g = dialogFixture(); g.scope.openResourceDeleteDialog('test-resource', g.trigger); change(g); await g.confirm.click(); assert.equal(g.calls.length, 0);
    }
    const historical = dialogFixture(); historical.state.historical = true; historical.scope.openResourceDeleteDialog('test-resource'); assert.equal(historical.nodes.modal, undefined);
});

test('The existing delete still targets resource ID and authenticated owner, and reports success/failure to the modal', async () => {
    const calls = []; let fail = false;
    const scope = vm.createContext({ beginWorkspaceDelete: () => true, finishWorkspaceDelete() {}, loadWorkspace: () => ({ resources: [{ id: 'uuid', title: 'Test' }] }),
        getCurrentSupabaseUser: async () => ({ id: 'owner' }),
        academicTable: table => { const query = { delete() { calls.push(['delete', table]); return query; }, eq(key, value) { calls.push([key, value]); return query; }, then(resolve) { resolve({ error: fail ? new Error('Test failure') : null }); } }; return query; },
        pushRecentMessage() {}, removeWorkspaceItems() {}, refreshResourceViews() {}, notify() {}, logSupabaseError() {} });
    load(['deleteResource'], scope); assert.equal(await scope.deleteResource('uuid'), true);
    assert.deepEqual(calls, [['delete', 'resources'], ['id', 'uuid'], ['user_id', 'owner']]);
    fail = true; assert.equal(await scope.deleteResource('uuid'), false);
});

test('Styling is backpack-only, uses natural equal row heights and provides 44px accessible actions', () => {
    assert.match(css, /align-items: stretch !important/); assert.match(css, /grid-auto-rows: auto !important/);
    assert.match(css, /margin-top: auto/); assert.match(css, /min-width: 44px/);
    assert.match(css, /:focus-visible::after/); assert.match(css, /@media \(hover: hover\)/);
    assert.match(css, /prefers-reduced-motion/); assert.match(css, /light-theme/);
    assert.doesNotMatch(css, /line-clamp|text-overflow: ellipsis|overflow-x: hidden|#dashboard|#ai-assistant|\.sidebar/);
    assert.match(functions.get('renderBackpack'), /searchHadFocus[\s\S]*?focus\(\{ preventScroll: true \}\)/);
    assert.match(functions.get('renderBackpack'), /selectionStart, document\.activeElement\.selectionEnd/);
    assert.match(functions.get('renderBackpack'), /setSelectionRange\(\.\.\.searchSelection\)/);
});
