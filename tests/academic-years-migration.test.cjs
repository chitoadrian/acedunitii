// Run with PGlite on NODE_PATH and AC_SCHEMA_FIXTURE pointing to a schema-only
// snapshot taken before this migration. Never connects to a remote database.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261015130622_add_academic_year_management.sql'), 'utf8');
const users = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'];
const q = (db, sql, args = []) => db.query(sql, args).then(r => r.rows);

(async () => {
    const db = new PGlite();
    try {
        await db.exec(fs.readFileSync(process.env.AC_SCHEMA_FIXTURE || path.join(__dirname, 'fixtures/academic-years-before.sql'), 'utf8'));
        for (const id of users) await q(db, 'insert into auth.users(id) values($1);', [id]);
        await q(db, 'insert into public.profiles(id,xp,streak) values($1,425,4)', [users[0]]);
        const [subject] = await q(db, 'insert into public.subjects(user_id,name) values($1,$2) returning id', [users[0], 'Historical subject']);
        const [task] = await q(db, 'insert into public.tasks(user_id,subject_id,title,status,due_date,due_time) values($1,$2,$3,$4,$5,$6) returning id', [users[0], subject.id, 'Historical task', 'pending', '2026-10-15', '12:00']);
        await q(db, "insert into public.task_reminder_deliveries(user_id,task_id,reminder_type,status,scheduled_for,task_due_at,sent_at) values($1,$2,'due_24h','sent',now(),now(),now())", [users[0], task.id]);
        const [grade] = await q(db, "insert into public.grades(user_id,subject_id,final_value) values($1,$2,9.5) returning id", [users[0], subject.id]);
        await q(db, "insert into public.grade_items(grade_id,activity,value) values($1,'Original note',9.5)", [grade.id]);
        const [project] = await q(db, "insert into public.projects(user_id,subject_id,title) values($1,$2,'Historical project') returning id", [users[0], subject.id]);
        const [stage] = await q(db, "insert into public.project_stages(user_id,project_id,title) values($1,$2,'Stage') returning id", [users[0], project.id]);
        await q(db, "insert into public.project_subtasks(user_id,project_id,stage_id,task_id,title) values($1,$2,$3,$4,'Subtask')", [users[0], project.id, stage.id, task.id]);
        const tracked = ['profiles', 'subjects', 'tasks', 'grades', 'grade_items', 'projects', 'project_stages', 'project_subtasks', 'user_activity_events', 'task_reminder_deliveries'];
        const before = {};
        for (const t of tracked) before[t] = await q(db, `select to_jsonb(t) row from public.${t} t order by to_jsonb(t)::text`);
        await db.exec(migration);
        await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261015132831_optimize_academic_year_indexes.sql'), 'utf8'));
        for (const t of tracked) {
            const after = await q(db, `select to_jsonb(t)-'academic_year_id' row from public.${t} t order by (to_jsonb(t)-'academic_year_id')::text`);
            assert.deepEqual(after, before[t], `${t}: backfill changed existing data`);
        }
        assert.equal((await q(db, 'select count(*)::int n from public.user_academic_years'))[0].n, 2);
        assert.equal((await q(db, 'select xp from public.user_academic_years where user_id=$1', [users[0]]))[0].xp, 425);
        const scoped = ['subjects','tasks','grades','grade_items','projects','project_stages','project_subtasks','user_activity_events'];
        for (const t of scoped) assert.equal((await q(db, `select count(*)::int n from public.${t} where academic_year_id is null`))[0].n, 0);
        const asUser = async id => { await db.exec('reset role'); await q(db, "select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec('set role authenticated'); };
        await asUser(users[0]);
        const [first] = await q(db, 'select public.ensure_academic_year_for_user() state');
        await q(db, 'select public.ensure_academic_year_for_user()');
        assert.equal((await q(db, 'select count(*)::int n from public.user_academic_years'))[0].n, 1, 'idempotent and RLS isolated');
        await asUser(users[1]);
        assert.equal((await q(db, 'select count(*)::int n from public.tasks'))[0].n, 0);
        await assert.rejects(q(db, 'insert into public.subjects(user_id,name,academic_year_id) values($1,$2,$3)', [users[1], 'Forbidden', first.state.selected_id]));
        await db.exec('reset role');
        // Simulate April 1 exclusively inside this local disposable PostgreSQL instance.
        await db.exec("create or replace function public.current_academic_start_year(p_at timestamptz default now()) returns integer language sql stable as $$ select 2027 $$");
        await asUser(users[0]);
        const [next] = await q(db, 'select public.ensure_academic_year_for_user() state');
        assert.notEqual(next.state.selected_id, first.state.selected_id);
        assert.equal(next.state.years.length, 2);
        assert.equal(next.state.years[0].xp, 0);
        assert.equal((await q(db, 'select count(*)::int n from public.tasks where academic_year_id=$1', [next.state.selected_id]))[0].n, 0);
        const [newSubject] = await q(db, 'insert into public.subjects(user_id,name,academic_year_id) values($1,$2,$3) returning id', [users[0], 'New cycle subject', next.state.selected_id]);
        await assert.rejects(q(db, 'insert into public.tasks(user_id,title,subject_id,academic_year_id) values($1,$2,$3,$4)', [users[0], 'Cross-cycle rejected', subject.id, next.state.selected_id]));
        const [newTask] = await q(db, 'insert into public.tasks(user_id,title,subject_id,due_date,due_time,academic_year_id) values($1,$2,$3,$4,$5,$6) returning *', [users[0], 'New cycle task', newSubject.id, '2027-04-05', '00:00', next.state.selected_id]);
        assert.equal(newTask.due_time, '00:00:00');
        assert.equal(newTask.reminders_enabled, false);
        const [newGrade] = await q(db, 'insert into public.grades(user_id,subject_id,final_value,academic_year_id) values($1,$2,7.5,$3) returning id', [users[0], newSubject.id, next.state.selected_id]);
        const [newGradeItem] = await q(db, "insert into public.grade_items(grade_id,activity,value) values($1,'New note',7.5) returning academic_year_id", [newGrade.id]);
        assert.equal(newGradeItem.academic_year_id, next.state.selected_id);
        for (const [table, fields, values] of [
            ['events', ['title','event_date'], ['Event','2027-04-05']],
            ['attendance', ['date','status'], ['2027-04-05','Asisti']],
            ['resources', ['title'], ['Resource']],
            ['evaluations', ['title','evaluation_date'], ['Evaluation','2027-04-05']],
            ['goals', ['title'], ['Goal']]
        ]) {
            const columns = ['user_id','subject_id','academic_year_id',...fields];
            const [row] = await q(db, `insert into public.${table}(${columns.join(',')}) values(${columns.map((_,i)=>'$'+(i+1)).join(',')}) returning academic_year_id`, [users[0],newSubject.id,next.state.selected_id,...values]);
            assert.equal(row.academic_year_id,next.state.selected_id,table);
        }
        await assert.rejects(q(db, "insert into public.internal_notifications(user_id,task_id,notification_type,title,message,scheduled_for) values($1,$2,'due_2h','Local','Local',now())", [users[0],newTask.id]));
        await db.exec('reset role; set role service_role');
        const [internal] = await q(db, "insert into public.internal_notifications(user_id,task_id,notification_type,title,message,scheduled_for) values($1,$2,'due_2h','Local','Local',now()) returning academic_year_id", [users[0],newTask.id]);
        assert.equal(internal.academic_year_id,next.state.selected_id,'unchanged worker insert inherits its task cycle');
        await asUser(users[0]);
        await q(db, "insert into public.google_calendar_manual_links(user_id,entity_type,entity_id) values($1,'task',$2)", [users[0],newTask.id]);
        await q(db, "insert into public.academic_notification_states(user_id,notification_key) values($1,$2)", [users[0],`task:${newTask.id}:2027-04-05:00:00`]);
        assert.equal((await q(db, 'select avg(final_value)::numeric(4,2)::text value from public.grades where academic_year_id=$1', [next.state.selected_id]))[0].value, '7.50');
        const [newProject] = await q(db, 'insert into public.projects(user_id,title,academic_year_id) values($1,$2,$3) returning id', [users[0], 'New project', next.state.selected_id]);
        const [newStage] = await q(db, "insert into public.project_stages(user_id,project_id,title) values($1,$2,'New stage') returning *", [users[0], newProject.id]);
        assert.equal(newStage.academic_year_id, next.state.selected_id, 'stage inherits the project cycle');
        await assert.rejects(q(db, "insert into public.project_subtasks(user_id,project_id,stage_id,task_id,title) values($1,$2,$3,$4,'Invalid link')", [users[0], newProject.id, newStage.id, task.id]));
        await q(db, "insert into public.project_subtasks(user_id,project_id,stage_id,task_id,title) values($1,$2,$3,$4,'Valid link')", [users[0], newProject.id, newStage.id, newTask.id]);
        await q(db, 'update public.user_academic_year_preferences set selected_academic_year_id=$1 where user_id=$2', [first.state.selected_id, users[0]]);
        const [reloaded] = await q(db, 'select public.ensure_academic_year_for_user() state');
        assert.equal(reloaded.state.selected_id, first.state.selected_id, 'historical selection survives reload within the same cycle');
        assert.equal((await q(db, 'select final_value from public.grades where academic_year_id=$1', [first.state.selected_id]))[0].final_value, '9.5');
        const [activity] = await q(db, 'select academic_year_id from public.user_activity_events where source_id=$1', [newTask.id]);
        assert.equal(activity.academic_year_id, next.state.selected_id, 'activity inherits source, not selected preference');
        assert.equal((await q(db, 'select count(*)::int n from public.get_five_day_activity($1)', [next.state.selected_id]))[0].n, 5);
        await db.exec('reset role');
        assert.deepEqual(await q(db, 'select to_jsonb(t) row from public.task_reminder_deliveries t order by to_jsonb(t)::text'), before.task_reminder_deliveries, 'reminder idempotency ledger unchanged');
        console.log('PASS: backfill, 2 accounts/RLS, idempotency, April rollover, historical reload, grades, relation isolation, child inheritance, activity, reminders.');
    } finally { await db.close(); }
})().catch(error => { console.error(error.message, error.code || '', error.where || ''); process.exitCode = 1; });
