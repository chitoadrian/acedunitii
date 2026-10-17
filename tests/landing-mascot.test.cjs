const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'landing-mascot.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const petStart = html.indexOf('<div class="study-pet"');
const pet = html.slice(petStart, html.indexOf('</svg>', petStart) + 6);

test('Original mascot keeps the existing accessible interaction target and exact CTA', () => {
    assert.equal((html.match(/id="study-pet"/g) || []).length, 1);
    assert.equal((html.match(/landing-mascot\.css\?v=/g) || []).length, 1);
    assert.ok(html.indexOf('class="landing-mascot-slot"') < petStart);
    assert.ok(petStart < html.indexOf('class="hero-right hero-visual'));
    assert.match(pet, /id="study-pet" role="button" tabindex="0" aria-label="Regístrate e inicia tu estudio"/);
    assert.match(pet, /<div class="pet-bubble"><strong>Regístrate<\/strong> e inicia tu estudio<\/div>/);
    assert.match(pet, /class="pet-robot" aria-hidden="true"/);
    assert.match(pet, /class="edunity-bot".*focusable="false"/);
    assert.doesNotMatch(pet, /onclick|<script|<image|<foreignObject|<animate|https?:\/\/(?!www\.w3\.org)/);
});

test('Inline SVG is self-contained and every paint reference resolves to a unique definition', () => {
    const ids = [...pet.matchAll(/\bid="(edunity-bot-[^"]+)"/g)].map(x => x[1]);
    assert.equal(new Set(ids).size, ids.length);
    for (const [, id] of pet.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(id), id);
    assert.match(pet, />AC<\/text>/);
    assert.equal((pet.match(/class="edunity-bot-eyes"/g) || []).length, 1);
});

test('Scoped CSS animates only the illustration, respects reduced motion and supports both themes', () => {
    assert.match(css, /#landing-page #study-pet \{[\s\S]*?animation: none !important/);
    assert.match(css, /@media \(max-width: 767px\)/);
    assert.match(css, /\.landing-mascot-slot \{[\s\S]*?min-height: 108px/);
    assert.match(css, /#study-pet\[style\] \{ position: fixed !important; \}/);
    assert.match(css, /body:is\(\.light-theme, \.light-mode, \[data-theme="light"\]\)/);
    assert.match(css, /:focus-visible/);
    assert.match(css, /:active \.pet-robot/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important;[\s\S]*transition: none !important;/);
    for (const name of ['float', 'breathe', 'blink', 'glance', 'wave-greet', 'antenna']) {
        assert.match(css, new RegExp(`@keyframes edunity-bot-${name} \\{`));
    }
});

test('Existing register destination, keyboard activation and drag guard are retained', () => {
    const init = js.slice(js.indexOf('function initStudyPet()'), js.indexOf('// SUPABASE AUTH + DATOS REALES'));
    assert.match(init, /if \(moved\) return;\s*showRegister\(\);/);
    assert.match(init, /event\.key === 'Enter' \|\| event\.key === ' '/);
    assert.match(init, /pet\.setPointerCapture\(event\.pointerId\)/);
    assert.match(init, /pet\.addEventListener\('pointercancel', stopDrag\)/);
});
