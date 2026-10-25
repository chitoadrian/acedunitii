const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8');
const wanted = new Set(['renderGrades', 'escapeHTML', 'getGradeItems', 'getGradeFinalValue', 'getGradePeriod', 'getGradeCategory', 'getGradeCategoryLabel', 'getCategoryGrades', 'getCategoryAverage', 'averageNumbers', 'calculatePeriodAverage', 'getSubjectGradeSummary', 'getAverageGrade', 'getGradeStatus', 'formatGradeValue']);
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
const definitions = ast.body.filter(node => node.type === 'FunctionDeclaration' && wanted.has(node.id.name) || node.type === 'VariableDeclaration' && node.declarations.some(d => ['gradePeriods', 'gradeCategories'].includes(d.id.name)));
const container = { innerHTML: '', querySelectorAll: () => [] };
const context = vm.createContext({ document: { querySelector: () => container }, gradeSortMode: 'subject' });
vm.runInContext(definitions.map(node => source.slice(node.start, node.end)).join('\n'), context);
const grade = (subject, category, value, period = 'p1') => ({ subject, category, period, value });
const workspace = { grades: [grade('Álgebra', 'partial1', 8), grade('Álgebra', 'partial2', 10), grade('Álgebra', 'exam', 6), grade('Biología', 'partial1', 9.5), grade('Lengua', 'partial1', 5)] };
function render(sort = 'subject') { context.gradeSortMode = sort; context.renderGrades(workspace); return container.innerHTML; }
test('Summary preserves the actual average, formula and accessible sort action', () => {
    const html = render();
    assert.match(html, new RegExp('grade-summary-value">' + context.getAverageGrade(workspace).toFixed(2)));
    assert.match(html, /Promedio general:/);
    assert.match(html, /Fórmula: promedio de parciales 70% \+ examen 30%\./);
    assert.match(html, /aria-label="Ordenar calificaciones" onchange="setGradeSort\(this.value\)"/);
});
test('All fourteen table headings and every academic cell remain present', () => {
    const html = render();
    assert.equal((html.match(/scope="col"/g) || []).length, 14);
    assert.equal((html.match(/class="grade-table-cell /g) || []).length, 36);
    for (const heading of ['Asignatura', 'Promedio', 'Periodo 1', 'Periodo 2', 'Periodo 3', 'Parcial 1', 'Parcial 2', 'Examen']) assert.ok(html.includes('>' + heading + '<'));
    assert.match(html, /3 calificaciones/);
    assert.match(html, /1 calificación</);
});
test('The real 70/30 formula and low, approved and excellent states are unchanged', () => {
    assert.equal(context.getSubjectGradeSummary(workspace.grades.filter(g => g.subject === 'Álgebra')).average, 8.1);
    const html = render();
    for (const [state, value] of [['aprobado', '8.10'], ['excelente', '9.50'], ['necesita-mejorar', '5.00']]) assert.match(html, new RegExp('period-average-cell ' + state + '">\\s*<strong>' + value));
    assert.equal(JSON.stringify(workspace), JSON.stringify({ grades: [grade('Álgebra', 'partial1', 8), grade('Álgebra', 'partial2', 10), grade('Álgebra', 'exam', 6), grade('Biología', 'partial1', 9.5), grade('Lengua', 'partial1', 5)] }));
});
test('Sorting is still the existing subject/high/low ordering', () => {
    const subjects = html => [...html.matchAll(/class="period-subject-cell" scope="row">\s*<strong>([^<]+)<\/strong>/g)].map(match => match[1]);
    assert.deepEqual(subjects(render()), ['Álgebra', 'Biología', 'Lengua']);
    assert.deepEqual(subjects(render('high')), ['Biología', 'Álgebra', 'Lengua']);
    assert.deepEqual(subjects(render('low')), ['Lengua', 'Álgebra', 'Biología']);
});
test('Empty and filled cells retain their original actions and mobile period details', () => {
    const html = render();
    assert.match(html, /period-grade-cell empty[\s\S]*?<strong>--<\/strong>\s*<span>Agregar<\/span>/);
    assert.match(html, /<span>Periodo<\/span>/);
    assert.equal((html.match(/class="mobile-grade-period"/g) || []).length, 9);
    assert.equal((html.match(/data-grade-add="true"/g) || []).length, 63);
    for (const value of ['partial1', 'partial2', 'exam']) assert.match(html, new RegExp('data-category="' + value + '"'));
});
test('Presentation is scoped to grades, keeps sticky subjects and existing phone cards', () => {
    const block = css.split('/* Calificaciones: tabla semántica reconstruida y alineada */')[1].split('/* Sidebar brand logo:')[0];
    assert.match(block, /min-width: 1404px !important/);
    assert.match(block, /\.period-subject-cell\s*\{\s*position: sticky !important/);
    assert.match(block, /\.grades-table-wrapper::-webkit-scrollbar-thumb/);
    assert.match(block, /\.period-average \.period-grade-cell span/);
    assert.match(block, /\.period-grade-cell:focus-visible/);
    assert.match(css, /#app-page\.page\.active #grades \.period-subject-row/);
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    assert.match(html, /style\.css\?v=20261025-grades-visual-refinement-v1/);
    assert.match(html, /app\.js\?v=20261025-grades-visual-refinement-v1/);
});
test('Refined semantic text and primary action retain AA contrast in both themes', () => {
    const luminance = hex => {
        const values = hex.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
    };
    for (const [surface, colors] of [['#FFFFFF', ['#4267B2', '#28724F', '#AA4854', '#5C6B80']], ['#222B3B', ['#8CAAE8', '#6AC99B', '#E58A8F', '#ACB8CA']], ['#F6F8FB', ['#427657', '#97563D']], ['#4267B2', ['#F8FAFC']]]) {
        for (const color of colors) {
            const values = [luminance(surface), luminance(color)].sort((a, b) => a - b);
            assert.ok((values[1] + .05) / (values[0] + .05) >= 4.5, `${color} on ${surface}`);
        }
    }
});
