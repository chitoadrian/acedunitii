// Local end-to-end test: actual app/scripts + disposable PostgreSQL (PGlite).
// Requires AC_SCHEMA_FIXTURE, TEST_BROWSER and TEST_BASE_URL. Sends no email.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { chromium } = require('playwright');
const userId = '10000000-0000-4000-8000-000000000001';

(async () => {
    const db = new PGlite();
    let browser;
    try {
        await db.exec(fs.readFileSync(process.env.AC_SCHEMA_FIXTURE || path.join(__dirname, 'fixtures/academic-years-before.sql'), 'utf8'));
        await db.query('insert into auth.users(id) values($1)', [userId]);
        await db.query("insert into public.profiles(id,full_name,xp) values($1,'Prueba local',250)", [userId]);
        await db.query("insert into public.subjects(user_id,name) values($1,'Materia histórica')", [userId]);
        await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261015130622_add_academic_year_management.sql'), 'utf8'));
        await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261015132831_optimize_academic_year_indexes.sql'), 'utf8'));
        await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261015141942_annual_academic_reports.sql'), 'utf8'));
        // Older activity is evidence, not a fabricated full record.
        const legacy=await db.query("insert into public.tasks(user_id,title) values($1,'ANTERIOR AL HISTORIAL') returning id",[userId]);
        await db.query('delete from public.tasks where id=$1',[legacy.rows[0].id]);
        await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261015161306_academic_record_history.sql'), 'utf8'));
        await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261015161909_optimize_academic_history_fk.sql'), 'utf8'));
        // Only this disposable DB simulates 2027; production clock/data are untouched.
        await db.exec("create or replace function public.current_academic_start_year(p_at timestamptz default now()) returns integer language sql stable as $$ select 2027 $$");
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
        await db.exec('set role authenticated');
        const quoted = name => { if (!/^[a-z_]+$/.test(name)) throw new Error('invalid identifier'); return `"${name}"`; };
        let queue = Promise.resolve(), reportInvocations = 0, reportGate = null;
        async function execute(request) {
            const job = queue.then(async () => {
                try {
                    if (request.rpc) {
                        if (request.rpc === 'ensure_academic_year_for_user') return { data: (await db.query('select public.ensure_academic_year_for_user() v')).rows[0].v, error: null };
                        if (request.rpc === 'get_five_day_activity') return { data: (await db.query('select * from public.get_five_day_activity($1)', [request.args.p_academic_year_id])).rows, error: null };
                        if (request.rpc === 'get_academic_year_report') { reportInvocations++; if (reportGate) await reportGate; return { data: (await db.query('select public.get_academic_year_report($1) v', [request.args.p_academic_year_id])).rows[0].v, error: null }; }
                        if (request.rpc === 'increment_academic_year_progress') return { data: (await db.query('select * from public.increment_academic_year_progress($1,$2,$3)', [request.args.p_year_id, request.args.p_delta, request.args.p_bump_streak])).rows[0], error: null };
                        throw new Error(`Unsupported test RPC: ${request.rpc}`);
                    }
                    const params = [], bind = value => { params.push(value); return `$${params.length}`; };
                    const filters = request.filters.map(([kind, key, value]) => {
                        const column = quoted(key);
                        if (kind === 'eq') return `${column}=${bind(value)}`;
                        if (kind === 'is') return `${column} is ${value === null ? 'null' : 'not null'}`;
                        if (kind === 'in') return value.length ? `${column} in (${value.map(bind).join(',')})` : 'false';
                        throw new Error(`Unsupported test filter: ${kind}`);
                    });
                    const where = filters.length ? ` where ${filters.join(' and ')}` : '';
                    let sql;
                    if (request.method === 'insert' || request.method === 'upsert') {
                        const rows = Array.isArray(request.payload) ? request.payload : [request.payload];
                        const keys = Object.keys(rows[0]);
                        sql = `insert into public.${quoted(request.table)} (${keys.map(quoted).join(',')}) values ${rows.map(row => `(${keys.map(key => bind(row[key])).join(',')})`).join(',')}`;
                        if (request.method === 'upsert') sql += ` on conflict (${request.conflict.split(',').map(quoted).join(',')}) do update set ${keys.filter(key => !request.conflict.split(',').includes(key)).map(key => `${quoted(key)}=excluded.${quoted(key)}`).join(',')}`;
                        sql += ' returning *';
                    } else if (request.method === 'update') {
                        sql = `update public.${quoted(request.table)} set ${Object.entries(request.payload).map(([key, value]) => `${quoted(key)}=${bind(value)}`).join(',')}${where} returning *`;
                    } else if (request.method === 'delete') sql = `delete from public.${quoted(request.table)}${where} returning *`;
                    else sql = `select * from public.${quoted(request.table)}${where}${request.orders.length ? ` order by ${request.orders.map(([key, asc]) => `${quoted(key)} ${asc ? 'asc' : 'desc'}`).join(',')}` : ''}${request.limit ? ` limit ${Number(request.limit)}` : ''}`;
                    const rows = (await db.query(sql, params)).rows;
                    return { data: request.single ? rows[0] || null : rows, error: request.single === 'required' && !rows[0] ? { message: 'No row' } : null };
                } catch (error) { return { data: null, error: { message: error.message, code: error.code } }; }
            });
            queue = job.then(() => {}); return job;
        }
        browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER });
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        const libraryRequests = [];
        page.on('request', request => { if (request.url().includes('/assets/vendor/jspdf')) libraryRequests.push(request.url()); });
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.exposeFunction('academicTestQuery', execute);
        const boot = async () => {
            await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:4184', { waitUntil: 'networkidle' });
            await page.evaluate(async userId => {
                const user = { id: userId, email: 'local-test@example.test', email_confirmed_at: '2026-01-01', user_metadata: { full_name: 'Prueba local' } };
                const makeQuery = table => {
                    const state = { table, method: 'select', filters: [], orders: [] };
                    const builder = new Proxy({}, { get(_, key) {
                        if (key === 'then') return (resolve, reject) => window.academicTestQuery(state).then(resolve, reject);
                        return (...args) => {
                            if (['insert', 'upsert', 'update', 'delete'].includes(key)) { state.method = key; state.payload = args[0]; if (key === 'upsert') state.conflict = args[1].onConflict; }
                            if (['eq', 'in', 'is'].includes(key)) state.filters.push([key, ...args]);
                            if (key === 'order') state.orders.push([args[0], args[1]?.ascending !== false]);
                            if (key === 'limit') state.limit = args[0];
                            if (key === 'single' || key === 'maybeSingle') state.single = key === 'single' ? 'required' : 'optional';
                            return builder;
                        };
                    } }); return builder;
                };
                supabaseClient = {
                    from: makeQuery,
                    rpc: (rpc, args) => window.academicTestQuery({ rpc, args }),
                    auth: { getUser: async () => ({ data: { user }, error: null }), getSession: async () => ({ data: { session: { user } }, error: null }) },
                    functions: { invoke: async () => ({ data: { ok: true, status: 'test-no-email' } }) }
                };
                await bootstrapAuthenticatedApp(user);
                await showDashboard('subjects', { validatedUser: user });
            }, userId);
            await page.waitForTimeout(300);
        };
        await boot();
        assert.equal(await page.locator('#academic-year-select option').count(), 2);
        assert.ok((await page.locator('#subjects').innerText()).includes('Materia histórica') === false, 'new cycle must start empty');
        const years = await page.evaluate(() => academicYearManager.state.years);
        const old = years.find(y => y.start_year === 2026), current = years.find(y => y.start_year === 2027);
        assert.equal(await page.locator('#academic-year-label').innerText(), current.label);
        assert.ok((await page.locator('#academic-year-select option:checked').innerText()).includes('Año actual'));
        await page.selectOption('#academic-year-select', old.id);
        await page.waitForFunction(() => !academicYearManager.state.switching);
        assert.equal(await page.locator('#academic-year-label').innerText(), old.label, 'closed control shows only the selected year');
        assert.equal(await page.locator('#academic-year-state').count(), 0, 'no visible state badge under the selector');
        assert.equal(await page.evaluate(() => academicYearManager.state.historical), true, 'historical state is retained internally');
        assert.equal(await page.locator('#academic-report-year').textContent(), old.label);
        assert.ok((await page.locator('#subjects').innerText()).includes('Materia histórica'));
        await boot();
        assert.equal(await page.inputValue('#academic-year-select'), old.id, 'reload preserves explicit historical selection');
        await page.selectOption('#academic-year-select', current.id);
        await page.waitForFunction(() => !academicYearManager.state.switching);
        assert.equal(await page.evaluate(() => academicYearManager.state.historical), false);
        assert.equal(await page.locator('#academic-report-year').textContent(), current.label);
        assert.equal(await page.locator('.academic-year-toolbar #academic-year-report').count(), 0);
        assert.equal(await page.locator('#settings #academic-year-report').count(), 1, 'the original report control is only in settings');
        const futureError = await page.evaluate(async () => {
            try { await academicYearManager.select('future-year', async () => {}); } catch (error) { return error.message; }
        });
        assert.ok(futureError.includes('1 de abril de 2028'));
        await page.evaluate(() => selectAcademicYear('future-year'));
        assert.ok((await page.locator('#app-toast').innerText()).includes('No puedes cambiar al próximo año lectivo todavía.'));
        // Create through the application's real form handlers and persist in local PostgreSQL.
        await page.evaluate(() => openSubjectForm());
        await page.locator('.quick-modal input[name="name"]').fill('PRUEBA AÑO LECTIVO');
        await page.locator('.quick-modal form').evaluate(form => form.requestSubmit());
        await page.waitForFunction(() => loadWorkspace().subjects.some(s => s.name === 'PRUEBA AÑO LECTIVO'));
        await page.evaluate(() => openTaskForm());
        await page.locator('.quick-modal input[name="title"]').fill('PRUEBA TAREA AÑO LECTIVO');
        await page.locator('.quick-modal form').evaluate(form => form.requestSubmit());
        await page.waitForFunction(() => loadWorkspace().tasks.some(t => t.title === 'PRUEBA TAREA AÑO LECTIVO'));
        const persisted = (await db.query("select academic_year_id from public.tasks where title='PRUEBA TAREA AÑO LECTIVO'")).rows;
        assert.equal(persisted[0].academic_year_id, current.id);
        // The original native select remains operable by keyboard, including year changes.
        const firstYear = await page.locator('#academic-year-select option').first().getAttribute('value');
        const lastYear = await page.locator('#academic-year-select option').last().getAttribute('value');
        await page.locator('#academic-year-select').press('Home');
        await page.waitForFunction(id => academicYearManager.state.selectedId === id && !academicYearManager.state.switching, firstYear);
        await page.locator('#academic-year-select').press('End');
        await page.waitForFunction(id => academicYearManager.state.selectedId === id && !academicYearManager.state.switching, lastYear);
        await page.selectOption('#academic-year-select', current.id);
        await page.waitForFunction(() => !academicYearManager.state.switching);
        const sections = ['dashboard','subjects','tasks','calendar','evaluations','grades','attendance','goals-projects','progress','backpack','profile','settings','ai-assistant'];
        const outputDir = process.env.TEST_SCREENSHOT_DIR;
        if (outputDir) fs.mkdirSync(outputDir, { recursive: true });
        const viewports=process.env.TEST_PDF_ONLY ? [] : [[1920,1080],[1440,900],[1366,768],[1024,768],[768,1024],[430,932],[390,844],[360,800]];
        for (const [width, height] of viewports) {
            await page.setViewportSize({ width, height });
            for (const theme of ['dark','light']) {
                await page.evaluate(theme => document.body.classList.toggle('light-theme', theme === 'light'), theme);
                for (const section of sections) {
                    await page.evaluate(section => navigateTo(section), section);
                    const measure = await page.locator('.academic-year-control').evaluate(control => {
                        const r = control.getBoundingClientRect();
                        const bell = document.querySelector('.academic-notification-center')?.getBoundingClientRect();
                        const sidebar = document.querySelector('.app-sidebar-control').getBoundingClientRect();
                        const label = document.getElementById('academic-year-label');
                        const overlaps = other => other && other.width > 0 && r.left < other.right && r.right > other.left && r.top < other.bottom && r.bottom > other.top;
                        return { width: r.width, left: r.left, right: r.right, top: r.top, viewport: innerWidth,
                            overflow: document.documentElement.scrollWidth > innerWidth, overlap: Boolean(overlaps(bell) || overlaps(sidebar)),
                            clipped: label.scrollWidth > label.clientWidth, label: label.textContent };
                    });
                    assert.ok(measure.width > 0 && measure.left >= 0 && measure.right <= width, JSON.stringify({width,theme,section,measure}));
                    assert.equal(measure.width, width <= 768 ? 150 : 156);
                    assert.equal(measure.top, width <= 768 ? 14 : 18);
                    assert.equal(measure.overlap, false, 'year selector must not overlap header controls');
                    assert.equal(measure.clipped, false, 'year range must fit without truncation');
                    assert.equal(measure.label, current.label);
                    assert.equal(await page.locator('#academic-year-report').isVisible(), section === 'settings');
                    if (section === 'settings') {
                        const card = page.locator('.settings-card--report');
                        await card.scrollIntoViewIfNeeded();
                        await page.waitForTimeout(300);
                        const layout = await card.evaluate(el => {
                            const r = el.getBoundingClientRect(), button = el.querySelector('button').getBoundingClientRect();
                            const peer = document.querySelector('.settings-card--tutor');
                            return { left: r.left, right: r.right, width: r.width, peerWidth: peer.getBoundingClientRect().width,
                                overflow: document.documentElement.scrollWidth > innerWidth || el.scrollWidth > el.clientWidth,
                                buttonFits: button.left >= r.left && button.right <= r.right && button.bottom <= r.bottom,
                                position: getComputedStyle(el.querySelector('button')).position,
                                radius: getComputedStyle(el).borderRadius, peerRadius: getComputedStyle(peer).borderRadius };
                        });
                        assert.ok(layout.left >= 0 && layout.right <= width, JSON.stringify({width,theme,layout}));
                        assert.equal(layout.overflow, false, `${width}/${theme}/settings overflow`);
                        assert.equal(layout.buttonFits, true);
                        assert.notEqual(layout.position, 'fixed');
                        assert.ok(Math.abs(layout.width - layout.peerWidth) < 1, 'report uses the existing grid slot');
                        assert.equal(layout.radius, layout.peerRadius);
                        if (outputDir) await page.screenshot({ path: path.join(outputDir, `settings-report-${theme}-${width}.png`) });
                    }
                    // Existing wide module content is checked separately from the new toolbar.
                    if (section === 'subjects' || section === 'dashboard') assert.equal(measure.overflow, false, `${width}/${theme}/${section}`);
                }
                if (outputDir && [1440,768,390,360].includes(width)) {
                    await page.evaluate(() => navigateTo('dashboard'));
                    await page.waitForTimeout(1500);
                    await page.screenshot({ path: path.join(outputDir, `academic-years-${theme}-${width}.png`) });
                    await page.locator('#academic-year-select').click();
                    await page.screenshot({ path: path.join(outputDir, `academic-years-menu-${theme}-${width}.png`) });
                    await page.keyboard.press('Escape');
                }
            }
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.evaluate(() => toggleSidebarCollapse());
        const rightWithCollapsedSidebar = await page.locator('.academic-year-control').evaluate(el => el.getBoundingClientRect().right);
        assert.equal(rightWithCollapsedSidebar, 1440 - 130, 'selector remains right-aligned when sidebar is collapsed');
        await page.locator('#academic-year-select').focus();
        assert.equal(await page.locator('.academic-year-control').evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
        // Actual download, from the real button and the real read-only report RPC.
        const pdfDir = process.env.TEST_PDF_DIR;
        assert.equal(libraryRequests.length, 0, 'PDF libraries must not load before the user asks for a report');
        if (pdfDir) {
            fs.mkdirSync(pdfDir, { recursive: true });
            const reportSubject=(await db.query("select id from public.subjects where name='PRUEBA AÑO LECTIVO' and user_id=$1",[userId])).rows[0].id;
            for(const [category,value,remove] of [['partial1',8,false],['partial2',10,false],['exam',6,false],['exam',2,true]]){
                const grade=(await db.query("insert into public.grades(user_id,academic_year_id,subject_id,category,final_value) values($1,$2,$3,$4,$5) returning id",[userId,current.id,reportSubject,category,value])).rows[0];
                await db.query("insert into public.grade_items(grade_id,activity,value) values($1,'ACTUAL 2027 Nota de prueba',$2)",[grade.id,value]);
                if(remove)await db.query('delete from public.grades where id=$1',[grade.id]);
            }
            for(const status of ['Asisti','Falta','Atraso','Justificado']){
                const row=(await db.query("insert into public.attendance(user_id,academic_year_id,subject_id,date,status) values($1,$2,$3,'2027-05-15',$4) returning id",[userId,current.id,reportSubject,status])).rows[0];
                if(status==='Falta')await db.query('delete from public.attendance where id=$1',[row.id]);
            }
            for(const remove of [false,true]){
                const project=(await db.query("insert into public.projects(user_id,academic_year_id,title) values($1,$2,$3) returning id",[userId,current.id,remove?'ACTUAL 2027 Proyecto eliminado':'ACTUAL 2027 Proyecto conservado'])).rows[0];
                const stage=(await db.query("insert into public.project_stages(user_id,project_id,title) values($1,$2,'Etapa de prueba') returning id",[userId,project.id])).rows[0];
                await db.query("insert into public.project_subtasks(user_id,project_id,stage_id,title,status) values($1,$2,$3,'Subtarea terminada','completed')",[userId,project.id,stage.id]);
                if(!remove)await db.query("insert into public.project_subtasks(user_id,project_id,stage_id,title) values($1,$2,$3,'Subtarea pendiente')",[userId,project.id,stage.id]);
                const goal=(await db.query("insert into public.goals(user_id,academic_year_id,title,progress,status) values($1,$2,$3,$4,$5) returning id",[userId,current.id,remove?'ACTUAL 2027 Meta eliminada':'ACTUAL 2027 Meta conservada',remove?100:80,remove?'completed':'in_progress'])).rows[0];
                const resource=(await db.query("insert into public.resources(user_id,academic_year_id,title,file_name,file_url) values($1,$2,$3,'material.pdf','https://private.example/secret') returning id",[userId,current.id,remove?'ACTUAL 2027 Recurso eliminado':'ACTUAL 2027 Recurso conservado'])).rows[0];
                const evaluation=(await db.query("insert into public.evaluations(user_id,academic_year_id,subject_id,title,evaluation_date,status) values($1,$2,$3,$4,'2027-05-15',$5) returning id",[userId,current.id,reportSubject,remove?'ACTUAL 2027 Evaluación eliminada':'ACTUAL 2027 Evaluación conservada',remove?'completed':'pending'])).rows[0];
                const event=(await db.query("insert into public.events(user_id,academic_year_id,title,event_date) values($1,$2,$3,'2027-05-15') returning id",[userId,current.id,remove?'ACTUAL 2027 Evento eliminado':'ACTUAL 2027 Evento conservado'])).rows[0];
                if(remove)for(const [table,row] of [['projects',project],['goals',goal],['resources',resource],['evaluations',evaluation],['events',event]])await db.query(`delete from public.${table} where id=$1`,[row.id]);
            }
            const stress=await db.query("insert into public.tasks(user_id,academic_year_id,title,due_date,due_time,status) select $1,$2,'ACTUAL 2027 Tarea extensa '||n||' - Investigación y actividades académicas con un título largo para comprobar el ajuste del contenido',case when n%3=1 then date '2020-05-15' else date '2027-05-15' end,time '12:00',case when n%3=0 then 'completed' else 'pending' end from generate_series(1,180) n returning id", [userId,current.id]);
            await db.query('delete from public.tasks where user_id=$1 and id=any($2::uuid[])',[userId,stress.rows.slice(0,10).map(row=>row.id)]);
            assert.equal((await db.query('select count(*)::int n from public.tasks where academic_year_id=$1',[current.id])).rows[0].n,171);
            await page.evaluate(()=>{const create=ACAcademicReports.createDocument;ACAcademicReports.createDocument=report=>{window.testAnnualReport=report;return create(report);};});
            for (const [year, theme] of [[current,'dark'],[old,'light']]) {
                await page.selectOption('#academic-year-select', year.id);
                await page.waitForFunction(() => !academicYearManager.state.switching);
                await page.evaluate(theme => document.body.classList.toggle('light-theme', theme === 'light'), theme);
                await page.setViewportSize({ width: 390, height: 844 });
                await page.evaluate(() => navigateTo('settings'));
                await page.locator('.settings-card--report').scrollIntoViewIfNeeded();
                await page.waitForTimeout(300);
                assert.equal(await page.locator('#academic-report-year').textContent(), year.label);
                if (outputDir) await page.screenshot({ path: path.join(outputDir, `academic-report-${theme}-${year.start_year}.png`) });
                const downloadPromise = page.waitForEvent('download');
                const beforeReport = reportInvocations;
                let releaseReport;
                reportGate = new Promise(resolve => { releaseReport = resolve; });
                try {
                    await page.locator('#academic-year-report').click();
                    await page.waitForFunction(() => academicReportGenerating);
                    assert.equal(await page.locator('#academic-year-report').isDisabled(), true);
                    assert.equal(await page.locator('#academic-year-report').getAttribute('aria-busy'), 'true');
                    assert.equal(await page.locator('#academic-year-report').innerText(), 'Generando reporte…');
                    assert.equal(await page.locator('#academic-year-select').isDisabled(), true);
                    await page.evaluate(() => generateAcademicYearReport()); // A second request must not start another download.
                } finally { releaseReport(); reportGate = null; }
                const download = await downloadPromise;
                assert.equal(download.suggestedFilename(), `Reporte de Prueba local - ${year.start_year}-${year.end_year}.pdf`);
                await download.saveAs(path.join(pdfDir, download.suggestedFilename()));
                const generated=await page.evaluate(()=>window.testAnnualReport);
                if(year.id===current.id){
                    assert.deepEqual(generated.history.tasks,{total:181,retained:171,deleted:10});
                    assert.equal(generated.taskCounts.completed,60);
                    assert.equal(generated.taskCounts.deleted,7);
                    assert.equal(Object.values(generated.taskCounts).reduce((a,b)=>a+b),181);
                    assert.equal(generated.metrics.average,8.1);
                    assert.equal(generated.metrics.attendance,100);
                    assert.equal(generated.sections.find(x=>x.title==='Proyectos').progress.find(x=>x.record==='Eliminada posteriormente').value,100);
                    assert.equal(generated.sections.find(x=>x.title==='Etapas y subtareas').body.filter(x=>x[2]==='Completado').length,3);
                }
                fs.writeFileSync(path.join(pdfDir,`metrics-${year.start_year}.json`),JSON.stringify({metrics:generated.metrics,history:generated.history,taskCounts:generated.taskCounts}));
                await page.waitForFunction(() => !academicReportGenerating);
                assert.equal(await page.locator('#academic-year-report').isEnabled(), true);
                assert.equal(reportInvocations, beforeReport + 1, 'double click must not duplicate the read or PDF');
            }
            await boot();
            assert.equal(await page.inputValue('#academic-year-select'), old.id, 'report generation does not change the selected historical year');
            assert.equal(reportInvocations, 2, 'one read-only snapshot per requested report');
            assert.equal(libraryRequests.length, 2, 'PDF libraries load once each, on demand');
        }
        await page.evaluate(() => showLanding());
        assert.equal(await page.locator('.academic-year-control').isVisible(), false, 'selector is not shown on public pages');
        assert.deepEqual(errors, []);
        console.log(`PASS: real forms + local PostgreSQL, future/history states, keyboard/year switching, historical reload, viewport matrix: ${viewports.length} sizes / 13 sections / dark-light; settings report, current/historical PDF downloads when TEST_PDF_DIR is set; no new console errors.`);
    } finally { if (browser) await browser.close(); await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
