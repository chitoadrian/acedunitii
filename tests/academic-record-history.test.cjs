// Real PostgreSQL semantics in a disposable PGlite DB. No remote data or email.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const migrations = ['20261015130622_add_academic_year_management.sql','20261015132831_optimize_academic_year_indexes.sql','20261015141942_annual_academic_reports.sql'];
const historyMigration = '20261015161306_academic_record_history.sql';
const users = ['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'];
(async () => {
    const db = new PGlite();
    const q = (sql,args=[]) => db.query(sql,args).then(r=>r.rows);
    const as = async id => { await db.exec('reset role'); await q("select set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec('set role authenticated'); };
    try {
        await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/academic-years-before.sql'),'utf8'));
        for(const id of users) await q('insert into auth.users(id) values($1)',[id]);
        for(const name of migrations) await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8'));
        await as(users[0]);
        const year = (await q('select public.ensure_academic_year_for_user() data'))[0].data.selected_id;
        const insert = async (table,values) => (await q(`insert into public.${table}(${Object.keys(values).join(',')}) values(${Object.keys(values).map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(values)))[0];
        const subject=await insert('subjects',{user_id:users[0],academic_year_id:year,name:'Materia histórica de prueba'});
        const tasks=[];
        for(let n=0;n<5;n++) tasks.push(await insert('tasks',{user_id:users[0],academic_year_id:year,subject_id:subject.id,title:`Tarea ${n+1}`,status:n===0?'completed':'pending'}));
        const grade=await insert('grades',{user_id:users[0],subject_id:subject.id,academic_year_id:year,final_value:8});
        const item=await insert('grade_items',{grade_id:grade.id,activity:'Nota original',value:8});
        const tables=['subjects','tasks','events','evaluations','attendance','resources','grades','grade_items','goals','projects','project_stages','project_subtasks','user_activity_events'];
        await db.exec('reset role');
        const before={};
        for(const t of tables) before[t]=await q(`select to_jsonb(e) data from public.${t} e order by id`);
        await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',historyMigration),'utf8'));
        await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261015161909_optimize_academic_history_fk.sql'),'utf8'));
        for(const t of tables) assert.deepEqual(await q(`select to_jsonb(e) data from public.${t} e order by id`),before[t],`migration changed ${t}`);
        assert.equal((await q('select count(*)::int n from public.academic_record_history'))[0].n,0,'no fabricated backfill');
        await as(users[0]);
        const report = async y => (await q('select public.get_academic_year_report($1) data',[y||year]))[0].data;
        assert.equal((await report()).tasks.length,5);
        await q('delete from public.tasks where id=any($1::uuid[])',[[tasks[0].id,tasks[1].id]]);
        const after=await report();
        assert.equal((await q('select count(*)::int n from public.tasks'))[0].n,3);
        assert.equal(after.tasks.length,5);
        assert.equal(after.tasks.filter(x=>x._record_deleted).length,2);
        assert.equal(after.tasks.find(x=>x.id===tasks[0].id).status,'completed');
        assert.equal(new Set(after.tasks.map(x=>x.id)).size,5);
        // Users have SELECT-own only, including direct API attempts and permission-changing payloads.
        for(const sql of ['insert into public.academic_record_history select * from public.academic_record_history',
            'update public.academic_record_history set snapshot=\'{}\'::jsonb','delete from public.academic_record_history']) await assert.rejects(q(sql),/permission denied/);
        await as(users[1]);
        assert.equal((await q('select count(*)::int n from public.academic_record_history'))[0].n,0);
        await assert.rejects(report(),/no está disponible/);
        await as(users[0]);
        // Child deletes before parent (the actual subject UI flow).
        await q('delete from public.tasks where subject_id=$1',[subject.id]);
        await q('delete from public.subjects where id=$1',[subject.id]);
        assert.equal((await report()).tasks.length,5);
        assert.equal((await report()).subjects[0]._record_deleted,true);
        // A grade's SET NULL subject and cascading grade items remain reconstructable.
        assert.ok((await report()).subjects[0]._history_metadata.related_records.grades.includes(grade.id));
        await q('delete from public.grades where id=$1',[grade.id]);
        const graded=await report();
        assert.equal(graded.grades.find(x=>x.id===grade.id)._record_deleted,true);
        assert.equal(graded.grade_items.find(x=>x.id===item.id)._record_deleted,true);
        assert.equal(Number(graded.grade_items.find(x=>x.id===item.id).value),8);
        const auxiliary=await insert('subjects',{user_id:users[0],academic_year_id:year,name:'Materia auxiliar'});
        const evaluation=await insert('evaluations',{user_id:users[0],academic_year_id:year,subject_id:auxiliary.id,title:'Evaluación eliminada',evaluation_date:'2026-10-15'});
        await q('delete from public.evaluations where id=$1',[evaluation.id]);
        assert.equal((await report()).evaluations.find(x=>x.id===evaluation.id)._record_deleted,true);
        const project=await insert('projects',{user_id:users[0],academic_year_id:year,title:'Proyecto con cascada'});
        const stage=await insert('project_stages',{user_id:users[0],project_id:project.id,title:'Etapa con cascada'});
        const subtask=await insert('project_subtasks',{user_id:users[0],project_id:project.id,stage_id:stage.id,title:'Subtarea completada',status:'completed'});
        await q('delete from public.projects where id=$1',[project.id]);
        const cascaded=await report();
        for(const [table,row] of [['projects',project],['project_stages',stage],['project_subtasks',subtask]]) assert.equal(cascaded[table].find(x=>x.id===row.id)._record_deleted,true,table);
        assert.deepEqual(cascaded.projects[0]._history_metadata.stage_ids,[stage.id]);
        for(const [table,fields] of [['events',{title:'Evento',event_date:'2026-10-15'}],['attendance',{date:'2026-10-15',status:'Falta'}],['resources',{title:'Recurso',file_url:'https://private.example/file'}],['goals',{title:'Meta'}]]) {
            const row=await insert(table,{user_id:users[0],academic_year_id:year,subject_id:auxiliary.id,...fields});
            await q(`delete from public.${table} where id=$1`,[row.id]);
            const archived=(await report())[table].find(x=>x.id===row.id);
            assert.equal(archived._record_deleted,true,table);
            assert.equal(archived.file_url,undefined,'private URLs never enter report payload');
        }
        const prior=(await report()).tasks.length;
        await insert('tasks',{user_id:users[0],academic_year_id:year,title:'Nueva después del reporte'});
        assert.equal((await report()).tasks.length,prior+1,'on-demand snapshot is fresh');
        // Delete rollback also rolls back its history write.
        await db.exec('begin');
        await q('delete from public.tasks');
        await db.exec('rollback');
        assert.equal((await report()).tasks.filter(x=>!x._record_deleted).length,1);
        await db.exec('reset role');
        await db.exec("create or replace function public.current_academic_start_year(p_at timestamptz default now()) returns integer language sql stable as $$select 2027$$");
        await as(users[0]);
        const next=(await q('select public.ensure_academic_year_for_user() data'))[0].data.selected_id;
        assert.equal((await report(next)).tasks.length,0);
        assert.equal((await report(year)).tasks.length,6);
        await assert.rejects(q('delete from public.tasks where academic_year_id=$1',[year]),/Año histórico/);
        await as(users[1]);
        const own=(await q('select public.ensure_academic_year_for_user() data'))[0].data.selected_id;
        const other=await insert('tasks',{user_id:users[1],academic_year_id:own,title:'Otra cuenta'});
        await q('delete from public.tasks where id=$1',[other.id]);
        assert.equal((await report(own)).tasks.length,1);
        assert.equal((await q('select count(*)::int n from public.academic_record_history'))[0].n,1);
        await assert.rejects(report(year),/no está disponible/);
        console.log('PASS HISTORY: 5 tasks -> 3 workspace / 5 report / 2 deleted; completion retained; 12 entities; parent/child cascades; RLS/no DML; 2 users/years; historical readonly; fresh snapshot; rollback; zero current rows changed by migration.');
    } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
