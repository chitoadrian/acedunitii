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
        // Only this disposable DB simulates 2027; production clock/data are untouched.
        await db.exec("create or replace function public.current_academic_start_year(p_at timestamptz default now()) returns integer language sql stable as $$ select 2027 $$");
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
        await db.exec('set role authenticated');
        const quoted = name => { if (!/^[a-z_]+$/.test(name)) throw new Error('invalid identifier'); return `"${name}"`; };
        let queue = Promise.resolve(), reportInvocations = 0;
        async function execute(request) {
            const job = queue.then(async () => {
                try {
                    if (request.rpc) {
                        if (request.rpc === 'ensure_academic_year_for_user') return { data: (await db.query('select public.ensure_academic_year_for_user() v')).rows[0].v, error: null };
                        if (request.rpc === 'get_five_day_activity') return { data: (await db.query('select * from public.get_five_day_activity($1)', [request.args.p_academic_year_id])).rows, error: null };
                        if (request.rpc === 'get_academic_year_report') { reportInvocations++; return { data: (await db.query('select public.get_academic_year_report($1) v', [request.args.p_academic_year_id])).rows[0].v, error: null }; }
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
        assert.equal(await page.locator('#academic-year-state').innerText(), 'Año histórico · Solo consulta');
        assert.ok((await page.locator('#subjects').innerText()).includes('Materia histórica'));
        await boot();
        assert.equal(await page.inputValue('#academic-year-select'), old.id, 'reload preserves explicit historical selection');
        await page.selectOption('#academic-year-select', current.id);
        await page.waitForFunction(() => !academicYearManager.state.switching);
        assert.equal(await page.locator('#academic-year-state').innerText(), 'Año actual');
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
        for (const [width, height] of [[1920,1080],[1440,900],[1366,768],[1024,768],[768,1024],[430,932],[390,844],[360,800]]) {
            await page.setViewportSize({ width, height });
            for (const theme of ['dark','light']) {
                await page.evaluate(theme => document.body.classList.toggle('light-theme', theme === 'light'), theme);
                for (const section of sections) {
                    await page.evaluate(section => navigateTo(section), section);
                    const measure = await page.locator('.academic-year-control').evaluate(control => {
                        const r = control.getBoundingClientRect();
                        const bell = document.querySelector('.academic-notification-center')?.getBoundingClientRect();
                        const sidebar = document.querySelector('.app-sidebar-control').getBoundingClientRect();
                        const report = document.getElementById('academic-year-report').getBoundingClientRect();
                        const label = document.getElementById('academic-year-label');
                        const overlaps = other => other && other.width > 0 && r.left < other.right && r.right > other.left && r.top < other.bottom && r.bottom > other.top;
                        return { width: r.width, left: r.left, right: r.right, top: r.top, viewport: innerWidth,
                            overflow: document.documentElement.scrollWidth > innerWidth, overlap: Boolean(overlaps(bell) || overlaps(sidebar)),
                            clipped: label.scrollWidth > label.clientWidth, label: label.textContent,
                            reportFits: report.left >= 0 && report.right < r.left && report.top === r.top };
                    });
                    assert.ok(measure.width > 0 && measure.left >= 0 && measure.right <= width, JSON.stringify({width,theme,section,measure}));
                    assert.equal(measure.width, width <= 768 ? 150 : 156);
                    assert.equal(measure.top, width <= 768 ? 14 : 18);
                    assert.equal(measure.overlap, false, 'year selector must not overlap header controls');
                    assert.equal(measure.clipped, false, 'year range must fit without truncation');
                    assert.equal(measure.label, current.label);
                    assert.equal(measure.reportFits, true, 'report action fits next to selector without overlap');
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
            await db.query("insert into public.tasks(user_id,academic_year_id,title,due_date,due_time) select $1,$2,'ACTUAL 2027 Tarea extensa '||n||' - Investigación y actividades académicas con un título largo para comprobar el ajuste del contenido',date '2027-05-15',time '12:00' from generate_series(1,180) n", [userId,current.id]);
            for (const [year, theme] of [[current,'dark'],[old,'light']]) {
                await page.selectOption('#academic-year-select', year.id);
                await page.waitForFunction(() => !academicYearManager.state.switching);
                await page.evaluate(theme => document.body.classList.toggle('light-theme', theme === 'light'), theme);
                await page.setViewportSize({ width: 390, height: 844 });
                if (outputDir) await page.screenshot({ path: path.join(outputDir, `academic-report-${theme}-${year.start_year}.png`) });
                const downloadPromise = page.waitForEvent('download');
                await page.locator('#academic-year-report').click();
                const download = await downloadPromise;
                assert.equal(download.suggestedFilename(), `Reporte de Prueba local - ${year.start_year}-${year.end_year}.pdf`);
                await download.saveAs(path.join(pdfDir, download.suggestedFilename()));
                await page.waitForFunction(() => !academicReportGenerating);
                assert.equal(await page.locator('#academic-year-report').isEnabled(), true);
            }
            await boot();
            assert.equal(await page.inputValue('#academic-year-select'), old.id, 'report generation does not change the selected historical year');
            assert.equal(reportInvocations, 2, 'one read-only snapshot per requested report');
            assert.equal(libraryRequests.length, 2, 'PDF libraries load once each, on demand');
        }
        await page.evaluate(() => showLanding());
        assert.equal(await page.locator('.academic-year-control').isVisible(), false, 'selector is not shown on public pages');
        assert.deepEqual(errors, []);
        console.log('PASS: real forms + local PostgreSQL, future/history states, native keyboard/year switching, historical reload, 13 sections, 8 viewport sizes, dark/light, report button fits; PDF downloads when TEST_PDF_DIR is set; no new console errors.');
    } finally { if (browser) await browser.close(); await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
