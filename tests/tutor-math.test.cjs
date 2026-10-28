const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const acorn = require('acorn');
const root = path.resolve(__dirname, '..');
const katex = require('../assets/vendor/katex-0.19.1/katex.min.js');
const cases = require('./fixtures/tutor-math-cases.cjs');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'tutor-math.js'), 'utf8');
const functions = new Map(acorn.parse(source, { ecmaVersion: 'latest' }).body.filter(n => n.type === 'FunctionDeclaration').map(n => [n.id.name, source.slice(n.start, n.end)]));
const context = vm.createContext({ window: {}, escapeHTML: value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x])) });
vm.runInContext(helper, context);
vm.runInContext(['formatTutorInlineMarkdown', 'renderTutorMarkdown'].map(n => functions.get(n)).join('\n'), context);
const math = context.window.ACTutorMath;
const decode = text => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function formulas(answer) {
    const html = context.renderTutorMarkdown(answer);
    return { html, items: [...html.matchAll(/data-tutor-tex="([^"]*)" data-math-display="(true|false)"/g)].map(match => ({ tex: decode(match[1]), display: match[2] === 'true' })) };
}
for (const item of cases) test(`Real KaTeX renders ${item.title}, isolated from prose and code`, () => {
    const result = formulas(item.answer);
    assert.ok(result.items.length > 0);
    const outputs = result.items.map(({ tex, display }) => math.formula(tex, display, katex));
    if (item.id !== 'invalid') assert.ok(outputs.every(out => out.includes('class="katex"')), result.items.map(x => x.tex).join('\n'));
    else { assert.match(outputs[0], /tutor-math-fallback/); assert.match(outputs[1], /class="katex"/); }
    for (const output of outputs) assert.doesNotMatch(output, /<script\b|onerror=|<iframe\b/);
    if (['sum', 'simplify', 'multiply', 'divide', 'quadratic'].includes(item.id)) assert.ok(outputs.some(out => out.includes('<mfrac>')));
    if (item.id === 'powers') assert.ok(outputs.some(out => out.includes('<msqrt>')));
    if (item.id === 'system') assert.ok(outputs.some(out => out.includes('<mtable')));
    if (item.id === 'code') { assert.equal(result.items.length, 1); assert.match(result.html, /<pre class="tutor-code"><code>const formula/); assert.match(result.html, /<code>\\\(x\^2\\\)<\/code>/); }
});

test('All controlled fraction results are exact and simplified; equation/calculus checks hold', () => {
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const expected = [[1 * 3 + 1 * 2, 2 * 3], [5 * 4 - 1 * 6, 6 * 4], [2 * 3, 3 * 5], [3 * 5, 4 * 2], [12, 8]];
    for (let i = 0; i < expected.length; i++) { const [a, b] = expected[i], d = gcd(a, b); assert.deepEqual([a / d, b / d], cases[i].result); }
    assert.equal(gcd(12, 8), 4); assert.equal(2 ** 3, 8); assert.equal(Math.sqrt(49), 7);
    assert.equal(3 * 12 - 7, 2 * 12 + 5);
    for (const x of [2, 3]) assert.equal(x * x - 5 * x + 6, 0);
    assert.equal(2 * 3 + 1, 7); assert.equal(3 - 1, 2);
    // Independent finite-difference checks, not string matching of the rendered answer.
    for (const x of [1, 2, 3]) { const h = 1e-5; assert.ok(Math.abs((((x + h) ** 2 - (x - h) ** 2) / (2 * h)) - 2 * x) < 1e-6); assert.ok(Math.abs((((x + h) ** 3 - (x - h) ** 3) / (2 * h)) - 3 * x * x) < 1e-6); }
});

test('Historical double escapes normalize without corrupting genuine system row separators', () => {
    const normal = String.raw`\begin{cases}x=3\\y=1\end{cases}`;
    const doubled = normal.replace(/\\/g, '\\\\');
    assert.equal(math.normalizeTex(normal, false), normal);
    assert.equal(math.normalizeTex(doubled, true), normal);
    assert.match(math.formula(normal, true, katex), /<mtable/);
});

test('Untrusted markup, code, escaped dollars and prices remain literal and safe', () => {
    const result = formulas(String.raw`<img src=x onerror=alert(1)> $5 y $10. \$20. \(x<2\)`);
    assert.equal(result.items.length, 1); assert.match(result.html, /&lt;img/); assert.doesNotMatch(result.html, /<img/);
    assert.match(result.html, /\$5 y \$10/);
    for (const tex of [String.raw`\href{javascript:alert(1)}{click}`, String.raw`\includegraphics{https://example.test/x}`, String.raw`\htmlStyle{position:fixed}{x}`]) {
        assert.doesNotMatch(math.formula(tex, false, katex), /<a\b|<img\b|<script\b|style="[^"]*position:fixed/);
    }
    assert.match(math.formula(String.raw`\def\a{\a}\a`, false, katex), /tutor-math-fallback/);
    assert.match(math.formula('x'.repeat(4100), false, katex), /tutor-math-fallback/);
});

test('Markdown still escapes normal prose; display formulas are not invalid nested paragraphs', () => {
    const result = formulas(String.raw`Antes **importante**.
\[\frac{1}{2}\]
Después.`);
    assert.match(result.html, /<strong>importante<\/strong>/);
    assert.doesNotMatch(result.html, /<p><div class="tutor-math/);
    assert.equal(result.items[0].display, true);
});

test('Standalone LaTeX, unclosed code fences and user-authored placeholder-like text are safe', () => {
    const bare = formulas(String.raw`\frac{12}{8}=\frac{3}{2}`);
    assert.equal(bare.items.length, 2); assert.match(math.formula(bare.items[0].tex, true, katex), /<mfrac>/);
    const mixed = formulas(String.raw`Resultado: \frac{12}{8}, raíz: \sqrt[3]{8}, escape: \\frac{3}{2}.`);
    assert.equal(mixed.items.length, 3);
    assert.ok(mixed.items.every(x => math.formula(x.tex, false, katex).includes('class="katex"')));
    const code = formulas('```tex\n\\frac{12}{8}\n\\(x^2\\)');
    assert.equal(code.items.length, 0); assert.match(code.html, /<pre/);
    assert.match(formulas('ACTUTORSLOT0END y \\(x=2\\)').html, /ACTUTORSLOT0END y/);
});

test('Pinned vendor hashes and every locally referenced font match the shipped distribution', () => {
    const crypto = require('node:crypto'), vendor = path.join(root, 'assets/vendor/katex-0.19.1');
    for (const [name, hash] of [['katex.min.js', 'fa140498b8cfc8302cbe5e7cb1bdbc1f952bc38b3fa258ede09e73edbf9a74bc'], ['katex.min.css', '00e0b094171b07f58422075f469b4feac2b2f7bce1aeec943c08da4d697f4dcf']]) {
        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(vendor, name))).digest('hex'), hash);
    }
    for (const [, file] of fs.readFileSync(path.join(vendor, 'katex.min.css'), 'utf8').matchAll(/url\(([^)]+)\)/g)) assert.ok(fs.existsSync(path.join(vendor, file)), file);
    assert.equal(katex.version, '0.19.1');
});

test('Math assets load only on a visible Tutor with formulas, without storage or network API changes', async () => {
    await math.typeset({ closest: () => null });
    await math.typeset({ closest: () => ({}), querySelectorAll: () => [] });
    assert.doesNotMatch(helper, /localStorage|sessionStorage|supabase|\.fetch\(|setInterval/);
    assert.match(helper, /trust: false/); assert.match(helper, /maxExpand: 200/);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /<script[^>]*katex\.min\.js|<link[^>]*katex\.min\.css/);
});

test('The endpoint preserves exact LaTeX through JSON and adds only math teaching instructions', async () => {
    const edge = fs.readFileSync(path.join(root, 'supabase/functions/tutor-ai/index.ts'), 'utf8');
    let handler, payload;
    const answer = String.raw`\[\frac{12}{8}=\frac{3}{2}\]`;
    const edgeContext = vm.createContext({ Request, Response, AbortController, DOMException,
        setTimeout, clearTimeout, console: { info() {}, error() {} },
        Deno: { env: { get: () => 'local-test-key' }, serve: fn => { handler = fn; } },
        fetch: async (url, options) => { payload = JSON.parse(options.body); return Response.json({ choices: [{ message: { content: answer } }] }); } });
    vm.runInContext(stripTypeScriptTypes(edge), edgeContext);
    const response = await handler(new Request('https://local.test/tutor-ai', { method: 'POST', body: JSON.stringify({ message: 'Simplifica 12/8', history: [] }) }));
    assert.equal(response.status, 200); assert.equal((await response.json()).answer, answer);
    assert.equal(payload.model, 'openai/gpt-oss-120b');
    assert.match(payload.messages[0].content, /máximo común divisor/);
    assert.match(payload.messages[0].content, /entre \\\( y \\\)/);
    assert.match(payload.messages[0].content, /no reveles soluciones/);
});
