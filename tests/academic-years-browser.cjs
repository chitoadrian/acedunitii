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
        // Only this disposable DB simulates 2027; production clock/data are untouched.
        await db.exec("create or replace function public.current_academic_start_year(p_at timestamptz default now()) returns integer language sql stable as $$ select 2027 $$");
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
        await db.exec('set role authenticated');
        const quoted = name => { if (!/^[a-z_]+$/.test(name)) throw new Error('invalid identifier'); return `"${name}"`; };
        let queue = Promise.resolve();
        async function execute(request) {
            const job = queue.then(async () => {
                try {
                    if (request.rpc) {
                        if (request.rpc === 'ensure_academic_year_for_user') return { data: (await db.query('select public.ensure_academic_year_for_user() v')).rows[0].v, error: null };
                        if (request.rpc === 'get_five_day_activity') return { data: (await db.query('select * from public.get_five_day_activity($1)', [request.args.p_academic_year_id])).rows, error: null };
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
        await page.selectOption('#academic-year-select', old.id);
        await page.waitForFunction(() => !academicYearManager.state.switching);
        assert.ok((await page.locator('#subjects').innerText()).includes('Materia histórica'));
        await boot();
        assert.equal(await page.inputValue('#academic-year-select'), old.id, 'reload preserves explicit historical selection');
        await page.selectOption('#academic-year-select', current.id);
        await page.waitForFunction(() => !academicYearManager.state.switching);
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
        const sections = ['dashboard','subjects','tasks','calendar','evaluations','grades','attendance','goals-projects','progress','backpack','profile','settings','ai-assistant'];
        const outputDir = process.env.TEST_SCREENSHOT_DIR;
        if (outputDir) fs.mkdirSync(outputDir, { recursive: true });
        for (const [width, height] of [[1440,900],[1024,768],[768,1024],[430,932],[390,844],[360,800]]) {
            await page.setViewportSize({ width, height });
            for (const theme of ['dark','light']) {
                await page.evaluate(theme => document.body.classList.toggle('light-theme', theme === 'light'), theme);
                for (const section of sections) {
                    await page.evaluate(section => navigateTo(section), section);
                    const measure = await page.locator('#academic-year-select').evaluate(select => {
                        const r = select.getBoundingClientRect();
                        return { width: r.width, left: r.left, right: r.right, viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth };
                    });
                    assert.ok(measure.width > 0 && measure.left >= 0 && measure.right <= width, JSON.stringify({width,theme,section,measure}));
                    // Existing wide module content is checked separately from the new toolbar.
                    if (section === 'subjects' || section === 'dashboard') assert.equal(measure.overflow, false, `${width}/${theme}/${section}`);
                }
                if (outputDir && [1440,390].includes(width)) {
                    await page.evaluate(() => navigateTo('dashboard'));
                    await page.waitForTimeout(1500);
                    await page.screenshot({ path: path.join(outputDir, `academic-years-${theme}-${width}.png`) });
                }
            }
        }
        assert.deepEqual(errors, []);
        console.log('PASS: real forms + local PostgreSQL, selector/year switching, historical reload, isolated task persistence, 13 sections, 6 viewport sizes, dark/light, no new console errors.');
    } finally { if (browser) await browser.close(); await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
