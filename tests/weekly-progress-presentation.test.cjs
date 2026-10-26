const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'dashboard-ui.css'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
const names = new Set(['handleWeeklyActivityTooltip', 'weeklyActivityGridHTML', 'normalizeFiveDayActivityRows', 'getFiveDayPlaceholders', 'getGuayaquilDateParts', 'escapeHTML']);
const nodes = ast.body.filter(n => n.type === 'FunctionDeclaration' && names.has(n.id.name) || n.type === 'VariableDeclaration' && n.declarations.some(d => ['FIVE_DAY_LABELS', 'FIVE_DAY_BLOCK_ANCHOR_UTC', 'DAY_IN_MILLISECONDS'].includes(d.id.name)));
const context = vm.createContext({ Date, Intl });
vm.runInContext(nodes.map(n => source.slice(n.start, n.end)).join('\n'), context);
const rows = [12, 0, 35, 9, 20].map((points, i) => ({ points, activity_count: [1, 0, 3, 1, 2][i] }));

test('Five real dates and the existing normalized bar percentages remain unchanged', () => {
    const before = JSON.stringify(rows), html = context.weeklyActivityGridHTML(rows);
    assert.deepEqual([...html.matchAll(/--weekly-bar-height:(\d+)%/g)].map(m => Number(m[1])), [34, 0, 100, 26, 57]);
    assert.equal((html.match(/class="weekly-activity-day[\s"]/g) || []).length, 5);
    assert.equal((html.match(/ has-activity"/g) || []).length, 4);
    assert.equal(JSON.stringify(rows), before);
    assert.equal(context.normalizeFiveDayActivityRows(rows).length, 5);
});
test('Tooltips expose only verified points/counts, without inferring academic event types', () => {
    const html = context.weeklyActivityGridHTML(rows);
    assert.match(html, /35 puntos/);
    assert.match(html, /3 actividades registradas/);
    assert.match(html, /1 actividad registrada/);
    assert.match(html, /Sin actividad registrada/);
    assert.doesNotMatch(html, /tareas completadas|materias creadas|apuntes subidos/);
    const unknownCount = context.weeklyActivityGridHTML([{ points: 7 }]);
    assert.match(unknownCount, /7 puntos/);
    assert.doesNotMatch(unknownCount, /0 actividades registradas/);
});
test('Every day is a native keyboard/touch button with one safely escaped described tooltip', () => {
    const html = context.weeklyActivityGridHTML([{ points: 5, activity_count: 1, full_day: '<img src=x onerror=alert(1)>' }]);
    assert.equal((html.match(/<button type="button" class="weekly-activity-day/g) || []).length, 5);
    assert.equal((html.match(/role="tooltip"/g) || []).length, 5);
    for (let i = 0; i < 5; i++) {
        assert.match(html, new RegExp(`aria-describedby="weekly-activity-tooltip-${i}"`));
        assert.equal((html.match(new RegExp(`id="weekly-activity-tooltip-${i}"`, 'g')) || []).length, 1);
    }
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /&lt;img/);
    assert.match(html, /onfocusout="handleWeeklyActivityTooltip\(event\)"/);
});
function fixture() {
    const buttons = Array.from({ length: 5 }, () => {
        const attributes = new Set();
        return {
            attributes, focused: false,
            hasAttribute: key => attributes.has(key),
            setAttribute: key => attributes.add(key),
            removeAttribute: key => attributes.delete(key),
            toggleAttribute(key, on) { on ? attributes.add(key) : attributes.delete(key); },
            focus() { this.focused = true; },
            contains(node) { return node === this; }
        };
    });
    const grid = { contains: button => buttons.includes(button), querySelectorAll: () => buttons };
    const send = (index, type, extra = {}) => context.handleWeeklyActivityTooltip({ currentTarget: grid, target: { closest: () => buttons[index] }, type, ...extra });
    return { buttons, send };
}
test('Tap toggles one tooltip at a time, without academic writes or layout mutations', () => {
    const { buttons, send } = fixture();
    send(0, 'click');
    assert.ok(buttons[0].hasAttribute('data-tooltip-open'));
    assert.ok(buttons[0].focused);
    send(1, 'click');
    assert.ok(!buttons[0].hasAttribute('data-tooltip-open'));
    assert.ok(buttons[1].hasAttribute('data-tooltip-open'));
    send(1, 'click');
    assert.ok(!buttons[1].hasAttribute('data-tooltip-open'));
    assert.ok(buttons[1].hasAttribute('data-tooltip-dismissed'));
});
test('Escape dismisses while retaining focus, and leaving a day clears its temporary state', () => {
    const { buttons, send } = fixture();
    send(0, 'click');
    let prevented = false;
    send(0, 'keydown', { key: 'ArrowRight', preventDefault() { throw new Error('not Escape'); } });
    assert.ok(buttons[0].hasAttribute('data-tooltip-open'));
    send(0, 'keydown', { key: 'Escape', preventDefault() { prevented = true; } });
    assert.ok(prevented);
    assert.ok(buttons[0].focused);
    assert.ok(buttons[0].hasAttribute('data-tooltip-dismissed'));
    send(0, 'focusout', { relatedTarget: buttons[0] });
    assert.ok(buttons[0].hasAttribute('data-tooltip-dismissed'));
    send(0, 'focusout', { relatedTarget: buttons[1] });
    assert.equal(buttons[0].attributes.size, 0);
});
test('Loading and zero activity never acquire active styling or invented counts', () => {
    const loading = context.weeklyActivityGridHTML([], { loading: true });
    assert.doesNotMatch(loading, / has-activity/);
    assert.match(loading, /Cargando actividad/);
    const empty = context.weeklyActivityGridHTML([]);
    assert.equal((empty.match(/--weekly-bar-height:0%/g) || []).length, 5);
    assert.doesNotMatch(empty, / has-activity/);
});
test('Presentation has no new requests, persistence, timers or per-card listeners', () => {
    for (const node of nodes.filter(n => n.type === 'FunctionDeclaration' && ['weeklyActivityGridHTML', 'handleWeeklyActivityTooltip'].includes(n.id.name))) assert.doesNotMatch(source.slice(node.start, node.end), /fetch\(|\.from\(|\.rpc\(|localStorage|sessionStorage|setTimeout|setInterval|addEventListener/);
    assert.match(css, /align-self: stretch !important;\s+min-height: 330px/);
    assert.match(css, /min-height: 330px !important;\s+transform: none !important/);
    assert.match(css, /dashboard-weekly-grow 600ms[^;]+ 1 both/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /body:is\(\.reduce-app-motion, \.performance-mode\)[^\n]*\.weekly-activity-bar \{ animation: none/);
    assert.match(css, /weekly-activity-day:hover:not\(\[data-tooltip-dismissed\]\)/);
});
test('Gold bars and labels remain readable against both theme tracks', () => {
    const luminance = hex => hex.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    const palettes = [...css.matchAll(/--weekly-gold-top: (#[A-F\d]{6});\s+--weekly-gold-base: (#[A-F\d]{6});\s+--weekly-gold-text: (#[A-F\d]{6});/g)];
    assert.equal(palettes.length, 2);
    for (const [i, [, top, base, text]] of palettes.entries()) {
        const track = i === 0 ? '#202A3D' : '#F5F7FC';
        assert.ok(ratio(top, track) >= 3);
        assert.ok(ratio(base, track) >= 3);
        assert.ok(ratio(text, track) >= 4.5);
    }
});
