const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const reports = require('../academic-reports.js');
// Execute the actual grade functions, not a second implementation of the formula.
const source = fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const wanted = new Set(['getGradeItems','getGradeFinalValue','getGradePeriod','getGradeCategory','getCategoryGrades','getCategoryAverage','averageNumbers','calculatePeriodAverage','getSubjectGradeSummary','getAverageGrade']);
const ast = acorn.parse(source,{ecmaVersion:'latest'});
const definitions = ast.body.filter(node => node.type === 'FunctionDeclaration' && wanted.has(node.id.name) || node.type === 'VariableDeclaration' && node.declarations.some(d=>d.id.name==='gradePeriods'));
const context = vm.createContext({});
vm.runInContext(definitions.map(node=>source.slice(node.start,node.end)).join('\n'),context);
const year = {id:'year',user_id:'user',start_year:2026,end_year:2027,label:'2026 - 2027',xp:250,streak:2};
const row = values => ({academic_year_id:'year',user_id:'user',...values});
const helpers = {
    gradeSummary: context.getSubjectGradeSummary, averageGrade: context.getAverageGrade, gradeItems: context.getGradeItems,
    taskStatus: s=>s||'pending', taskVisualStatus: task=>task.status==='completed'?'completed':'pending', priority:s=>s,
    attendance: records=>({total:records.length,percentage:0,present:0,absent:0,late:0,justified:0}),
    projectStats: ()=>({progress:0,stages:[],subtasks:[],completedStages:0,completedSubtasks:0}),
    level: xp=>Math.floor(xp/250)+1, dateTime:(date,time)=>[date,time].filter(Boolean).join(' ')||'Sin fecha'
};
test('Exact filename, sanitization, real name, no email/undefined fallback',()=>{
    assert.equal(reports.filename('Adrian Maximiliano Chito Vargas',year),'Reporte de Adrian Maximiliano Chito Vargas - 2026-2027.pdf');
    assert.equal(reports.filename(' Ana / María: * ',year),'Reporte de Ana María - 2026-2027.pdf');
    assert.equal(reports.filename('null',year),'Reporte de Estudiante - 2026-2027.pdf');
    assert.equal(reports.studentName('private@example.com'),'Estudiante');
});
test('No data still produces all report sections and zero totals',()=>{
    const report=reports.normalize({year,student_name:'Ana',generated_at:'2026-10-15T12:00:00Z'},helpers);
    assert.equal(report.sections.length,10);
    assert.equal(report.summary.find(x=>x[0]==='Total de tareas')[1],0);
    assert.equal(report.sections.find(x=>x.title==='Evaluaciones').body.length,0);
});
test('Real grade formula is shared with Calificaciones (70/30, periods, annual average)',()=>{
    const raw={year,student_name:'Ana',subjects:[row({id:'s',name:'Matemática'})],grades:[
        row({id:'g1',subject_id:'s',period:'p1',category:'partial1',final_value:8}),
        row({id:'g2',subject_id:'s',period:'p1',category:'partial2',final_value:10}),
        row({id:'g3',subject_id:'s',period:'p1',category:'exam',final_value:6})
    ],grade_items:[row({id:'i1',grade_id:'g1',value:8}),row({id:'i2',grade_id:'g2',value:10}),row({id:'i3',grade_id:'g3',value:6})]};
    const report=reports.normalize(raw,helpers);
    assert.equal(report.summary.find(x=>x[0]==='Promedio general del año')[1],'8.10');
    assert.equal(report.sections.find(x=>x.title==='Calificaciones').body[0][2],'8.10');
});
test('Normalization rejects cross-year, cross-account and orphaned grade items',()=>{
    assert.throws(()=>reports.normalize({year,tasks:[row({academic_year_id:'other'})]},helpers),/fuera del año/);
    assert.throws(()=>reports.normalize({year,tasks:[row({user_id:'other'})]},helpers),/fuera del año/);
    assert.throws(()=>reports.normalize({year,grade_items:[row({grade_id:'missing'})]},helpers),/calificación/);
});
