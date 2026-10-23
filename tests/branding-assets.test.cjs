const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const version = '20261022-official-branding-v1';
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const read = name => fs.readFileSync(path.join(root, name));

test('Official PNG assets have real PNG headers and expected high-density sizes', () => {
    const sizes = {'favicon.png':[512,512], 'favicon-192.png':[192,192], 'favicon-48.png':[48,48],
        'favicon-32.png':[32,32], 'favicon-16.png':[16,16], 'apple-touch-icon.png':[180,180],
        'assets/ac-edunity-logo.png':[868,1044], 'assets/branding/edunity-official-source.png':[1254,1254]};
    for (const [name, size] of Object.entries(sizes)) {
        const png = read(name);
        assert.equal(png.subarray(0,8).toString('hex'), '89504e470d0a1a0a', name);
        assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], size, name);
    }
});

test('ICO contains multiple native browser icon sizes', () => {
    const ico = read('favicon.ico');
    assert.equal(ico.readUInt16LE(2), 1);
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({length:count}, (_,i) => ico[6+i*16] || 256);
    assert.deepEqual(sizes, [16,32,48,64,128,256]);
});

test('Mobile manifest and every browser icon reference use existing versioned assets', () => {
    const manifest = JSON.parse(read('site.webmanifest'));
    for (const icon of manifest.icons) {
        assert.ok(icon.src.endsWith('?v='+version));
        assert.ok(fs.existsSync(path.join(root, icon.src.split('?')[0])));
        assert.equal(icon.purpose, 'any');
    }
    const links = [...html.matchAll(/<link[^>]+rel="(?:icon|shortcut icon|apple-touch-icon|manifest)"[^>]+href="([^"]+)"/g)];
    assert.equal(links.length, 7);
    for (const [,src] of links) {
        assert.ok(src.endsWith('?v='+version));
        assert.ok(fs.existsSync(path.join(root, src.split('?')[0])));
    }
});

test('All ten existing logo slots remain present and point to approved versioned assets', () => {
    const logos = [...html.matchAll(/<img\b[^>]+alt="(?:Logo )?AC Edunity"[^>]*>/g)].map(x=>x[0]);
    assert.equal(logos.length, 10);
    for (const logo of logos) assert.match(logo, new RegExp('src="(?:favicon(?:-192)?\\.png|assets/ac-edunity-logo\\.png)\\?v='+version+'"'));
    assert.equal((html.match(/href="branding\.css\?v=/g) || []).length,1);
    assert.doesNotMatch(html, /20260727-transparent-v1|favicon\.png\?v=20260827/);
});

test('The social card is a valid RIFF/WebP asset and both sharing tags agree', () => {
    const webp = read('assets/og-image.webp');
    assert.equal(webp.toString('ascii',0,4),'RIFF');
    assert.equal(webp.toString('ascii',8,12),'WEBP');
    assert.equal(webp.readUInt32LE(4)+8,webp.length);
    const urls = [...html.matchAll(/(?:property="og:image"|name="twitter:image") content="([^"]+)"/g)].map(x=>x[1]);
    assert.deepEqual(urls, Array(2).fill('https://edunity.me/assets/og-image.webp?v='+version));
});

test('Brand CSS touches only logos and the report changes only its branding resource version', () => {
    const css = read('branding.css').toString();
    assert.doesNotMatch(css, /@keyframes|animation:|button|input|\.auth-card\s*\{/);
    assert.match(css,/clip-path: none !important/);
    assert.match(css,/object-fit: contain !important/);
    assert.match(read('academic-reports.js').toString(), new RegExp("fetch\\('favicon-192\\.png\\?v="+version+"'\\)"));
});
