const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scrollbar = css.slice(css.indexOf('/* Page scrollbar only:'));

test('Seven public preview bars retain exact labels, heights and no new markup', () => {
    const graph = html.match(/<div class="mockup-bars"[^>]*>(.*?)<\/div>/)[1];
    assert.deepEqual([...graph.matchAll(/<small>(.*?)<\/small>/g)].map(x=>x[1]), ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']);
    assert.deepEqual([...graph.matchAll(/--bar:(\d+)%/g)].map(x=>Number(x[1])), [42,65,54,82,70,48,76]);
    assert.match(html,/style\.css\?v=20261022-weekly-bars-page-scrollbar-v1/);
});

test('Only public bars oscillate: subtle scale, stable baseline and opposite even phases', () => {
    assert.match(css, /#landing-page \.hero-visual\.active \.mockup-bars i \{\s*animation: heroPanelBarOscillate 4\.8s ease-in-out infinite;/);
    assert.match(css, /span:nth-child\(even\) i \{ animation-delay: -2\.4s; \}/);
    assert.match(css, /transform-origin: center bottom/);
    assert.match(css, /@keyframes heroPanelBarOscillate \{\s*0%, 100% \{ transform: scaleY\(\.94\); \}\s*50% \{ transform: scaleY\(1\); \}/);
    assert.doesNotMatch(css, /animation: heroPanelBarGrow|animation-duration: 160ms; animation-delay: 0ms/);
});

test('Existing reduced-motion, disabled animations and performance preferences stop motion', () => {
    assert.match(css, /html\.performance-mode #landing-page \.hero-visual\.active \.mockup-bars i,\s*html\.reduce-app-motion #landing-page \.hero-visual\.active \.mockup-bars i \{\s*animation: none;\s*transform: scaleY\(1\);/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*#landing-page \.dashboard-mockup::before, #landing-page \.panel-status, #landing-page \.hero-visual\.active \.mockup-bars i \{ animation: none !important; \}/);
});

test('Scrollbar skin targets only page scrollers, with WebKit and Firefox fallbacks', () => {
    assert.match(scrollbar, /scrollbar-color: var\(--page-scroll-thumb\) var\(--page-scroll-track\) !important/);
    assert.match(scrollbar, /scrollbar-width: thin !important/);
    assert.match(scrollbar, /@supports selector\(::-webkit-scrollbar\)/);
    assert.match(scrollbar, /width: 10px !important/);
    assert.match(scrollbar, /border-radius: 999px !important/);
    assert.match(scrollbar, /::-webkit-scrollbar-thumb:hover/);
    assert.match(scrollbar, /@media \(forced-colors: active\)/);
    assert.doesNotMatch(scrollbar.replace(/\/\*[\s\S]*?\*\//g,''), /overflow|height:\s*(?:100|calc)|scroll-behavior|#ai-assistant|#dashboard|\.sidebar|\*::/);
});

test('Both scrollbar palettes distinguish the thumb from its track by at least 3:1', () => {
    const luminance = hex => {
        const c=hex.match(/\w\w/g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
        return .2126*c[0]+.7152*c[1]+.0722*c[2];
    };
    for(const [thumb,track] of [['4c9daf','101b2a'],['3c8192','eaf0f5']]) {
        const a=luminance(thumb),b=luminance(track),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        assert.ok(ratio>=3,ratio);
    }
    assert.match(scrollbar,/html:root:has\(body:is\(\.light-theme, \.light-mode, \[data-theme="light"\]\)\)/);
});
