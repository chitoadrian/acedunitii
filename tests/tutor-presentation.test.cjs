const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'tutor-ui.css'), 'utf8');
const functions = new Map(acorn.parse(source, { ecmaVersion: 'latest' }).body
    .filter(node => node.type === 'FunctionDeclaration')
    .map(node => [node.id.name, source.slice(node.start, node.end)]));
function load(names, context) {
    vm.runInContext(names.map(name => {
        assert.ok(functions.has(name), name);
        return functions.get(name);
    }).join('\n'), context);
}

test('The five existing mode handlers retain storage and actions while exposing visual mode', () => {
    const label = { dataset: {} }, stored = [], actions = [];
    const context = vm.createContext({ tutorState: {}, lastIntent: '',
        document: { getElementById: () => label, querySelectorAll: () => [] },
        setTutorStorageValue: (...args) => stored.push(args), handleTutorModeAction: mode => actions.push(mode) });
    load(['getTutorModeName', 'setTutorMode'], context);
    for (const mode of ['explain', 'practice', 'review', 'flashcards', 'exam']) {
        context.setTutorMode(mode, { classList: { add: () => {} } });
        assert.equal(label.dataset.mode, mode);
        assert.equal(context.tutorState.mode, mode);
        assert.equal(label.textContent, `Modo ${context.getTutorModeName(mode)}`);
        assert.deepEqual(stored.at(-1), ['acStudyTutorMode', mode]);
        assert.ok(html.includes(`data-tutor-mode="${mode}" onclick="setTutorMode('${mode}', this)"`));
        assert.ok(html.includes(`data-mode-guide="${mode}"`));
        assert.ok(css.includes(`[data-mode="${mode}"]`));
    }
    assert.deepEqual(actions, ['practice', 'review', 'flashcards', 'exam']);
});

test('Restoring a saved mode updates presentation without sending an AI request', () => {
    const label = { dataset: {} }, history = [{ role: 'user', content: 'Local test' }];
    const context = vm.createContext({ activeTutorUserId: '', tutorAuthGeneration: 0,
        tutorRequestInProgress: false, tutorRequestOwnerId: '', tutorState: {},
        normalizeTutorUserId: id => id || '', resetTutorConversationMemory: () => {},
        renderTutorConversation: () => {}, getTutorHistory: () => history,
        getTutorPendingQuestion: () => null,
        getTutorStorageValue: key => key === 'acStudyTutorMode' ? 'practice' : '',
        document: { getElementById: () => label } });
    load(['getTutorModeName', 'setTutorAuthenticatedUser'], context);
    context.setTutorAuthenticatedUser({ id: 'local-user' });
    assert.equal(label.dataset.mode, 'practice');
    assert.equal(label.textContent, 'Modo practicar');
    assert.equal(context.tutorState.history, history);
});

test('Clearing a local chat resets the visual mode and only removes scoped keys', () => {
    const label = { dataset: { mode: 'exam' } }, messages = {}, removed = [];
    const context = vm.createContext({ activeTutorUserId: 'local-user', tutorState: { mode: 'exam' },
        TUTOR_LEGACY_STORAGE_KEYS: ['history', 'mode'],
        document: { getElementById: id => id === 'tutor-messages' ? messages : label },
        getTutorScopedStorageKey: (id, key) => `${id}/${key}`,
        resetTutorConversationMemory: () => { context.tutorState.mode = 'explain'; },
        localStorage: { removeItem: key => removed.push(key) }, applyTutorSuggestionPreference: () => {} });
    load(['clearTutorChat'], context); context.clearTutorChat();
    assert.equal(label.dataset.mode, 'explain');
    assert.equal(label.textContent, 'Modo explicar');
    assert.deepEqual(removed, ['local-user/history', 'local-user/mode']);
    assert.match(messages.innerHTML, /Chat limpio/);
});

test('Suggestions only fill and focus the composer; authored text is not overwritten', () => {
    const input = { value: '', focus: () => {}, setSelectionRange: () => {} }, notices = [];
    const context = vm.createContext({ document: { getElementById: () => input }, notify: (...args) => notices.push(args) });
    load(['useTutorSuggestion'], context);
    context.useTutorSuggestion('Explícame un tema paso a paso con un ejemplo sencillo.');
    assert.equal(input.value, 'Explícame un tema sobre ');
    context.useTutorSuggestion('Crea cinco preguntas para repasar mi próxima evaluación.');
    assert.equal(input.value, 'Prepárame una evaluación sobre ');
    input.value = 'Mi pregunta todavía no enviada';
    context.useTutorSuggestion('Ayúdame a crear un plan breve de estudio para hoy.');
    assert.equal(input.value, 'Mi pregunta todavía no enviada');
    assert.equal(notices.length, 1);
});

test('Existing send flow keeps busy state, duplicate-send guard and user-scoped history', async () => {
    let resolveReply; const response = new Promise(resolve => { resolveReply = resolve; });
    const busy = [], history = [], messages = [], input = { value: 'Pregunta', focus: () => {} };
    let requests = 0;
    const context = vm.createContext({ console, activeTutorUserId: 'local-user', tutorAuthGeneration: 1,
        tutorRequestInProgress: false, tutorRequestOwnerId: '', normalizeTutorUserId: id => id || '',
        getSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: 'local-user' } } } }) } }),
        document: { getElementById: () => input }, setTutorSendingState: value => busy.push(value),
        appendTutorMessage: (...args) => messages.push(args), addTutorHistory: (...args) => history.push(args),
        showTutorThinking: () => ({ remove: () => {} }),
        requestTutorAI: () => { requests++; return response; }, notify: () => {} });
    load(['sendTutorMessage'], context);
    const first = context.sendTutorMessage('Pregunta');
    await new Promise(resolve => setImmediate(resolve));
    await context.sendTutorMessage('Duplicado');
    assert.deepEqual(busy, [true]); assert.equal(requests, 1); assert.equal(input.value, '');
    resolveReply({ answer: 'Respuesta simulada' }); await first;
    assert.deepEqual(busy, [true, false]);
    assert.deepEqual(history, [['user', 'Pregunta', 'local-user'], ['assistant', 'Respuesta simulada', 'local-user']]);
    assert.equal(messages.length, 2); assert.equal(context.tutorRequestInProgress, false);
});

test('The request uses the original authenticated endpoint, history and academic context', async () => {
    const calls = [], workspace = { subjects: [{ id: 's' }], tasks: [{ id: 't' }], resources: [] };
    const context = vm.createContext({ console, loadWorkspace: () => workspace,
        getTutorAIHistoryPayload: () => [{ role: 'user', content: 'Anterior' }],
        getSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: {} } }) },
            functions: { invoke: async (...args) => { calls.push(args); return { data: { ok: true, answer: 'Local' } }; } } }) });
    load(['requestTutorAI'], context);
    assert.equal((await context.requestTutorAI('Nueva pregunta')).answer, 'Local');
    assert.equal(calls.length, 1); assert.equal(calls[0][0], 'tutor-ai');
    assert.equal(calls[0][1].body.message, 'Nueva pregunta');
    assert.equal(calls[0][1].body.context.tasks, workspace.tasks);
    assert.equal(calls[0][1].body.history[0].content, 'Anterior');
});

test('Existing Markdown preserves readable headings/lists and escapes untrusted markup', () => {
    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
    const context = vm.createContext({ escapeHTML });
    load(['formatTutorInlineMarkdown', 'renderTutorMarkdown'], context);
    const result = context.renderTutorMarkdown('# Título\n\n- **Idea**\n- Segundo\n\n1. Paso\n2. Otro\n\n<script>test()</script>');
    assert.match(result, /<h3>Título<\/h3>/); assert.match(result, /<ul>/); assert.match(result, /<ol>/);
    assert.match(result, /<strong>Idea<\/strong>/); assert.match(result, /&lt;script&gt;/);
    assert.doesNotMatch(result, /<script>/);
});

test('Tutor presentation stays scoped and supports responsive, keyboard and reduced motion', () => {
    assert.match(css, /body:is\(\.light-theme/);
    assert.match(css, /@media \(max-width: 767px\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /:focus-visible/);
    assert.match(css, /\.tutor-chat-card:has\(\.tutor-auto-suggestions\[hidden\]\)/);
    assert.match(css, /minmax\(0, 1fr\)/);
    assert.doesNotMatch(css, /(?:#dashboard|#landing-page|#tasks|\.sidebar)\s*\{/);
    assert.match(html, /id="tutor-messages" tabindex="0" aria-label="Conversación con Tutor IA"/);
    assert.match(html, /aria-describedby="tutor-mode-description"/);
    assert.match(html, /onclick="generateTutorAnswer\(\)"/);
});

test('Both themes keep AA text contrast for chat, muted copy and active mode labels', () => {
    const luminance = hex => {
        const c = hex.match(/\w\w/g).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
        return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
    };
    for (const [text, background] of [['edf2fc', '192132'], ['aab9d0', '131c2c'], ['b5a7f3', '2c2e4b'], ['25324a', 'ffffff'], ['596981', 'f7f8fc'], ['6551aa', 'f0ecfa']]) {
        const values = [luminance(text), luminance(background)].sort((a, b) => b - a);
        assert.ok((values[0] + .05) / (values[1] + .05) >= 4.5, `${text} / ${background}`);
    }
});
