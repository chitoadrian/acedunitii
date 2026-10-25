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
    // Other scoped CSS refinements can advance the shared stylesheet cache version.
    assert.match(html,/href="style\.css\?v=\d{8}-[a-z0-9-]+"/);
});

test('Only public bars grow on a synchronized 5.4-second clock without changing layout', () => {
    assert.match(css, /#landing-page \.hero-visual\.active \.mockup-bars i \{\s*animation: heroPanelBarGrow1 5\.4s ease-in-out infinite both;/);
    assert.match(css, /transform-origin: center bottom/);
    assert.doesNotMatch(css, /heroPanelBarOscillate|animation-delay: -2\.4s/);
    const animatedRules = [...css.matchAll(/([^{}]+)\{([^{}]*heroPanelBarGrow\d[^{}]*)\}/g)];
    assert.equal(animatedRules.length,7);
    for(const [,selector,body] of animatedRules) {
        assert.ok(selector.trim().startsWith('#landing-page .hero-visual.active .mockup-bars'));
        assert.doesNotMatch(body,/width:|height:|margin:|padding:|position:|background:|box-shadow:/);
    }
});

test('Lun to Dom stagger only the growth, then hold, reset together and loop without jumps', () => {
    const frames = [];
    for(let i=1;i<=7;i++) {
        if(i>1) assert.ok(css.includes(`#landing-page .hero-visual.active .mockup-bars > span:nth-child(${i}) i { animation-name: heroPanelBarGrow${i}; }`));
        const keyframes = css.match(new RegExp(`@keyframes heroPanelBarGrow${i} \\{([\\s\\S]*?)\\n\\}`))[1];
        const groups = [...keyframes.matchAll(/([\d%,\s]+)\{\s*transform: scaleY\((\d)\);\s*\}/g)];
        assert.equal(groups.length,2);
        const timeline = groups.flatMap(([,percentages,scale])=>[...percentages.matchAll(/(\d+)%/g)].map(x=>({time:Number(x[1]),scale:Number(scale)}))).sort((a,b)=>a.time-b.time);
        const start = (i-1)*4, full = start+20;
        assert.deepEqual(timeline.filter(x=>x.scale===1).map(x=>x.time),[full,70]);
        assert.equal(timeline[0].scale,0);
        assert.equal(timeline.at(-1).scale,0);
        assert.ok(timeline.some(x=>x.time===start && x.scale===0));
        assert.ok(timeline.some(x=>x.time===90 && x.scale===0));
        assert.equal(timeline.at(-1).time,100);
        assert.doesNotMatch(keyframes,/opacity|height|width|translate|scaleY\((?![01]\))/);
        frames.push({start,full});
    }
    assert.deepEqual(frames.map(x=>x.start),[0,4,8,12,16,20,24]);
    assert.ok(Math.abs((70-frames.at(-1).full)*5.4/100-1.404)<1e-9); // All seven fully visible together.
    assert.ok(frames.at(-1).full<70);
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
