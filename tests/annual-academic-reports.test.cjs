const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const reports = require('../academic-reports.js');
// Execute the actual grade functions, not a second implementation of the formula.
const source = fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const wanted = new Set(['getGradeItems','getGradeFinalValue','getGradePeriod','getGradeCategory','getCategoryGrades','getCategoryAverage','averageNumbers','calculatePeriodAverage','getSubjectGradeSummary','getAverageGrade','getGradeStatus']);
const ast = acorn.parse(source,{ecmaVersion:'latest'});
const definitions = ast.body.filter(node => node.type === 'FunctionDeclaration' && wanted.has(node.id.name) || node.type === 'VariableDeclaration' && node.declarations.some(d=>d.id.name==='gradePeriods'));
const context = vm.createContext({});
vm.runInContext(definitions.map(node=>source.slice(node.start,node.end)).join('\n'),context);
const gpSource=fs.readFileSync(path.join(__dirname,'../goals-projects.js'),'utf8');
const gpAst=acorn.parse(gpSource,{ecmaVersion:'latest'});
vm.runInContext(gpAst.body.filter(node=>node.type==='FunctionDeclaration' && ['getProjectStageProgress','getProjectStageStatus'].includes(node.id.name)).map(node=>gpSource.slice(node.start,node.end)).join('\n'),context);
const year = {id:'year',user_id:'user',start_year:2026,end_year:2027,label:'2026 - 2027',xp:250,streak:2};
const row = values => ({academic_year_id:'year',user_id:'user',...values});
const helpers = {
    gradeSummary: context.getSubjectGradeSummary, averageGrade: context.getAverageGrade, gradeItems: context.getGradeItems, gradeStatus: context.getGradeStatus,
    taskStatus: s=>s||'pending', taskVisualStatus: task=>task.status==='completed'?'completed':'pending', priority:s=>s,
    attendance: records=>({total:records.length,percentage:0,present:0,absent:0,late:0,justified:0}),
    projectStats: ()=>({progress:0,stages:[],subtasks:[],completedStages:0,completedSubtasks:0}),
    stageStatus: context.getProjectStageStatus,
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
    assert.equal(report.sections.length,11);
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
    assert.equal(report.summary.find(x=>x[0]==='Promedio final de registros conservados')[1],'8.10');
    assert.equal(report.sections.find(x=>x.title==='Rendimiento académico').body[0][3],'8.10');
});
test('Historical totals are disjoint, preserve completed deletions and never change current grade average',()=>{
    const raw={year,student_name:'Ana',tasks:[row({id:'t1',status:'completed',_record_deleted:true}),row({id:'t2',status:'pending',_record_deleted:true}),row({id:'t3',status:'pending'})],
        subjects:[row({id:'s',name:'Matemática'})],grades:[row({id:'g1',subject_id:'s',final_value:8}),row({id:'g2',subject_id:'s',final_value:2,_record_deleted:true})],
        grade_items:[row({id:'i1',grade_id:'g1',value:8}),row({id:'i2',grade_id:'g2',value:2,_record_deleted:true})]};
    const report=reports.normalize(raw,helpers);
    assert.deepEqual(report.history.tasks,{total:3,retained:1,deleted:2});
    assert.equal(Object.values(report.taskCounts).reduce((a,b)=>a+b),3);
    assert.equal(report.taskCounts.completed,1);
    assert.equal(report.metrics.average,8);
    assert.equal(report.sections.find(x=>x.kind==='tasks').body.find(x=>x[3]==='Completada')[4],'Eliminada posteriormente');
    const duplicate=reports.normalize({...raw,tasks:[...raw.tasks,raw.tasks[0]]},helpers);
    assert.equal(duplicate.metrics.tasks,3);
});
test('Deleted/replaced grade items are counted but excluded from the retained average',()=>{
    const report=reports.normalize({year,subjects:[row({id:'s',name:'Matemática'})],grades:[row({id:'g',subject_id:'s',final_value:9})],grade_items:[row({id:'a',grade_id:'g',value:9}),row({id:'b',grade_id:'g',value:1,_record_deleted:true})]},helpers);
    assert.equal(report.metrics.average,9);
    assert.equal(report.summary.find(x=>x[0]==='Calificaciones registradas (casilleros)')[1],2);
    assert.equal(report.summary.find(x=>x[0]==='Calificaciones eliminadas (casilleros)')[1],1);
});
test('Prior activity without snapshots stays separate from complete-record totals',()=>{
    const report=reports.normalize({year,legacy_evidence:[{entity_type:'tasks',count:4}]},helpers);
    assert.equal(report.metrics.tasks,0);
    assert.equal(report.legacyEvidence[0].count,4);
});
test('Former subject associations do not change the current workspace grade grouping',()=>{
    const report=reports.normalize({year,subjects:[row({id:'old1',name:'Borrada 1',_record_deleted:true,_history_metadata:{related_records:{grades:['g1']}}}),row({id:'old2',name:'Borrada 2',_record_deleted:true,_history_metadata:{related_records:{grades:['g2']}}}),row({id:'live',name:'Vigente'})],grades:[row({id:'g1',subject_id:null,final_value:2}),row({id:'g2',subject_id:null,final_value:8}),row({id:'g3',subject_id:'live',final_value:10})]},helpers);
    assert.equal(report.metrics.average,7.5); // General (2+8)/2 = 5; Vigente = 10; existing subject average = 7.5.
});
test('A nullable empty grade group is not invented as a zero or a recorded mark',()=>{
    const report=reports.normalize({year,grades:[row({id:'empty',final_value:null})]},helpers);
    assert.equal(report.metrics.average,null);
    assert.equal(report.summary.find(x=>x[0]==='Calificaciones registradas (casilleros)')[1],0);
});
test('Normalization rejects cross-year, cross-account and orphaned grade items',()=>{
    assert.throws(()=>reports.normalize({year,tasks:[row({academic_year_id:'other'})]},helpers),/fuera del año/);
    assert.throws(()=>reports.normalize({year,tasks:[row({user_id:'other'})]},helpers),/fuera del año/);
    assert.throws(()=>reports.normalize({year,grade_items:[row({grade_id:'missing'})]},helpers),/calificación/);
});
test('Student-facing evaluation statuses never expose internal values',()=>{
    for(const [value,label] of Object.entries({preparing:'En preparación',scheduled:'Programada',completed:'Completada',pending:'Pendiente',pending_internal:'Pendiente',completed_internal:'Completada'})) assert.equal(reports.formatEvaluationStatus(value),label);
    assert.equal(reports.formatEvaluationStatus('unknown_internal'),'Sin especificar');
});
test('Presentation hides redundant history columns, preserves deleted states and does not mutate report data',()=>{
    const report=reports.normalize({year,tasks:[row({id:'t',title:'Trabajo',status:'completed'})],evaluations:[row({id:'e',title:'Prueba',status:'preparing'})]},helpers);
    const before=JSON.stringify(report);
    const tasks=reports.presentSection(report.sections.find(s=>s.kind==='tasks'));
    assert.deepEqual(tasks.headers,['Tarea','Materia','Fecha','Estado','Prioridad']);
    assert.equal(tasks.body[0][3],'Completada');
    const evaluations=reports.presentSection(report.sections.find(s=>s.title==='Evaluaciones'));
    assert.equal(evaluations.body[0][4],'En preparación');
    assert.equal(JSON.stringify(report),before);
    const archived=reports.normalize({year,tasks:[row({id:'t',title:'Trabajo',status:'completed',_record_deleted:true})]},helpers);
    const historical=reports.presentSection(archived.sections.find(s=>s.kind==='tasks'));
    assert.equal(historical.headers.at(-1),'Historial');
    assert.equal(historical.body[0].at(-1),'Eliminada posteriormente');
    assert.equal(historical.body[0][3],'Completada');
    for(const section of report.sections.map(reports.presentSection)){
        if(section.widths) assert.equal(section.widths.reduce((a,b)=>a+b),174);
        section.body.forEach(cells=>assert.equal(cells.length,section.headers.length));
    }
});
test('Task layout keeps date and AM/PM time together on separate lines without changing source data',()=>{
    for(const record of ['Conservada','Eliminada posteriormente']){
        const section={title:'Tareas del año',kind:'tasks',headers:[],body:[['Trabajo','Matemática','30 sept 2026 · 12:00 PM','Completada',record,'Alta']]};
        const before=JSON.stringify(section),shown=reports.presentSection(section);
        assert.equal(shown.body[0][2],'30 sept 2026\n12:00 PM');
        assert.equal(shown.body[0][3],'Completada');
        assert.equal(shown.widths.reduce((a,b)=>a+b),174);
        assert.equal(shown.body[0].length,shown.headers.length);
        assert.equal(JSON.stringify(section),before);
    }
});
