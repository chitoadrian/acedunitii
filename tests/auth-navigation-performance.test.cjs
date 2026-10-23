const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const notices = fs.readFileSync(path.join(__dirname, '../academic-notifications.js'), 'utf8');

function declaration(text, name) {
    const matches = [...text.matchAll(new RegExp(`^(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'gm'))];
    assert.ok(matches.length, name);
    return matches.at(-1)[0];
}
function context(functions, globals = {}, text = source) {
    const scope = vm.createContext({ console: { info() {}, log() {}, warn() {} }, performance: { now: () => 0 }, ...globals });
    vm.runInContext(functions.map(name => declaration(text, name)).join('\n'), scope);
    return scope;
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const renderNames = ['renderDashboard', 'renderSubjects', 'renderTasks', 'renderCalendarSection', 'renderGrades',
    'renderAttendance', 'renderProgress', 'renderBackpack', 'renderProfile', 'renderEvaluations', 'renderGoalsProjects'];

function renderingContext() {
    const calls = [], workspace = { tasks: [], xp: 0, streak: 0 };
    const scope = context(['logAppTiming', 'invalidateWorkspaceSections', 'renderWorkspaceSection', 'refreshWorkspaceUI'], {
        workspaceState: workspace, renderedWorkspace: null, renderedWorkspaceProgress: '',
        currentSection: 'dashboard', dirtyWorkspaceSections: new Set(),
        loadWorkspace: () => scope.workspaceState, window: { ACAcademicNotifications: { refresh() {} } },
        updateGradeSubjectOptions: () => calls.push('grade-options'),
        ...Object.fromEntries(renderNames.map(name => [name, () => calls.push(name)]))
    });
    return { scope, calls };
}

test('First paint renders only the visible module; visited views are reused without queries', () => {
    const { scope, calls } = renderingContext();
    scope.refreshWorkspaceUI();
    assert.deepEqual(calls, ['renderDashboard']);
    scope.renderWorkspaceSection('dashboard');
    assert.equal(calls.length, 1, 'showDashboard/navigateTo do not render twice');
    scope.renderWorkspaceSection('grades');
    assert.deepEqual(calls, ['renderDashboard', 'renderGrades', 'grade-options']);
    scope.renderWorkspaceSection('grades');
    assert.equal(calls.length, 3);
    for (const id of ['subjects', 'tasks', 'calendar', 'attendance', 'progress', 'backpack', 'profile', 'evaluations', 'goals-projects']) scope.renderWorkspaceSection(id);
    assert.equal(renderNames.every(name => calls.includes(name)), true);
});

test('Directed CRUD and year/account replacements invalidate cached views, including in-place XP updates', () => {
    const { scope, calls } = renderingContext();
    scope.refreshWorkspaceUI(); scope.renderWorkspaceSection('tasks'); scope.renderWorkspaceSection('calendar');
    scope.workspaceState = { ...scope.workspaceState, tasks: [{ id: 'new-task' }] };
    scope.renderWorkspaceSection('tasks'); scope.renderWorkspaceSection('calendar');
    assert.equal(calls.filter(name => name === 'renderTasks').length, 2);
    assert.equal(calls.filter(name => name === 'renderCalendarSection').length, 2);
    scope.workspaceState.xp = 20;
    scope.renderWorkspaceSection('dashboard');
    assert.equal(calls.filter(name => name === 'renderDashboard').length, 2);
    scope.workspaceState = { tasks: [], xp: 0, streak: 0 };
    scope.renderWorkspaceSection('dashboard');
    assert.equal(calls.filter(name => name === 'renderDashboard').length, 3);
});

function bootstrapContext() {
    const calls = [], frames = [], preferences = deferred();
    const user = { id: 'account-a' }, profile = { id: user.id, full_name: 'Test' };
    const scope = context(['logAppTiming', 'bootstrapAuthenticatedApp'], {
        authOperationGeneration: 1, currentUser: null, dashboardAuthorizedUserId: '',
        setTutorAuthenticatedUser() {}, ensureProfileRow: async () => profile,
        getPublicUserFromAuth: value => ({ id: value.id }),
        switchAppSettingsUser: (_, options) => { calls.push(['preferences', options.deferReminders]); return preferences.promise; },
        ensureAcademicYearForUser: async () => calls.push(['year']),
        syncWorkspaceFromSupabase: async options => calls.push(['workspace', options.profile]),
        academicYearManager: { scope: () => ({ yearId: 'year-a' }), matches: () => true },
        localStorage: { setItem() {} }, requestWelcomeEmailForConfirmedUser() {}, updateDashboardGreeting() {}, loadWorkspace: () => ({}),
        runSmartReminders: async () => calls.push(['reminders']),
        window: { requestAnimationFrame: callback => frames.push(callback), ACAcademicNotifications: { start: async () => calls.push(['notices']) } }
    });
    return { scope, calls, frames, preferences, user, profile };
}

test('Remote preferences/notices never block a fully loaded, validated academic workspace', async () => {
    const f = bootstrapContext();
    await f.scope.bootstrapAuthenticatedApp(f.user);
    assert.equal(f.scope.dashboardAuthorizedUserId, f.user.id);
    assert.equal(f.calls.find(call => call[0] === 'workspace')[1], f.profile, 'reuse the exact fresh own profile');
    assert.deepEqual(f.calls.map(call => call[0]), ['preferences', 'year', 'workspace']);
    f.frames[0]();
    assert.equal(f.calls.at(-1)[0], 'notices');
    f.preferences.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(f.calls.at(-1)[0], 'reminders');
});

test('Logout/account change cancels deferred work and stale bootstrap authorization', async () => {
    const f = bootstrapContext();
    await f.scope.bootstrapAuthenticatedApp(f.user);
    f.scope.authOperationGeneration++;
    f.frames[0](); f.preferences.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(f.calls.some(call => ['notices', 'reminders'].includes(call[0])), false);
    const stale = bootstrapContext(), profile = deferred();
    stale.scope.ensureProfileRow = () => profile.promise;
    const boot = stale.scope.bootstrapAuthenticatedApp(stale.user);
    stale.scope.authOperationGeneration++; profile.resolve(stale.profile);
    await assert.rejects(boot, /sesión cambió/);
    assert.equal(stale.scope.dashboardAuthorizedUserId, '');
    assert.equal(stale.calls.some(call => ['workspace', 'notices', 'reminders'].includes(call[0])), false);
});

test('Fresh bootstrap profile removes exactly one query; later explicit sync still refreshes it', async () => {
    const calls = [];
    const user = { id: 'account-a', name: 'Test' }, profile = { id: user.id, full_name: 'Test' };
    function query(table) {
        const builder = new Proxy({}, { get(_, key) {
            if (key === 'then') return resolve => { calls.push(table); return Promise.resolve({ data: table === 'profiles' ? profile : [], error: null }).then(resolve); };
            return () => builder;
        } });
        return builder;
    }
    const scope = context(['syncWorkspaceFromSupabase'], {
        currentUser: user, profileState: null,
        academicYearManager: { scope: () => ({ yearId: 'year-a' }), matches: () => true, selected: () => ({ xp: 0, streak: 0 }) },
        getSupabaseClient: () => ({ from: query }), academicTable: query,
        mapProjectStageRow: value => value, mapProjectSubtaskRow: value => value,
        localStorage: { setItem() {} }, mergeWorkspaceState: value => value
    });
    const first = await scope.syncWorkspaceFromSupabase({ profile });
    assert.equal(calls.length, 11);
    assert.equal(calls.includes('profiles'), false);
    assert.equal(first.tasks.length, 0);
    calls.length = 0;
    await scope.syncWorkspaceFromSupabase();
    assert.equal(calls.length, 12);
    assert.equal(calls.filter(name => name === 'profiles').length, 1);
    calls.length = 0;
    await scope.syncWorkspaceFromSupabase({ profile: { id: 'another-account' } });
    assert.equal(calls.includes('profiles'), true, 'a foreign profile can never substitute the own-profile query');
});

test('Supabase validation, ownership, cycle filters and recovery remain on their original paths', async () => {
    let session = { user: { id: 'a' } }, remote = { id: 'a', email_confirmed_at: 'confirmed' };
    const scope = context(['isConfirmedAuthUser', 'getValidatedAuthUser'], { getSupabaseClient: () => ({ auth: {
        getSession: async () => ({ data: { session } }), getUser: async () => ({ data: { user: remote } })
    } }) });
    assert.equal((await scope.getValidatedAuthUser()).id, 'a');
    remote = { id: 'b', email_confirmed_at: 'confirmed' }; assert.equal(await scope.getValidatedAuthUser(), null);
    remote = { id: 'a' }; assert.equal(await scope.getValidatedAuthUser(), null);
    session = null; assert.equal(await scope.getValidatedAuthUser(), null);
    const sync = declaration(source, 'syncWorkspaceFromSupabase');
    assert.match(sync, /profile\?\.id === currentUser\.id/);
    assert.match(sync, /academicYearManager\.matches\(scope\)/);
    assert.match(sync, /academicTable\('grade_items'\)/);
    assert.match(declaration(source, 'handleLogin'), /await getValidatedAuthUser\(\)/);
    assert.match(declaration(source, 'showDashboard'), /dashboardAuthorizedUserId !== authUser\.id/);
});

test('Notification bell stays hidden until read/dismissed states finish loading; stale loads cannot reopen it', async () => {
    const pending = deferred();
    const scope = context([], {
        ownerId: '', latestWorkspace: null, stateLoadGeneration: 0, loadingStates: false,
        notifications: [], stateRows: [], center: { hidden: true },
        mount: () => true, shouldShowBell: (_, authenticated) => authenticated,
        closePanel() {}, render() {}, document: { body: { classList: { contains: () => true } } },
        root: { currentSection: 'dashboard', getSupabaseClient() {}, academicTable: () => {
            const builder = { select: () => builder, eq: () => pending.promise }; return builder;
        } },
        refresh: () => { scope.updateVisibility('dashboard'); return []; }
    });
    for (const name of ['loadStates', 'updateVisibility', 'start', 'stop']) {
        const local = notices.match(new RegExp(`^    (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, 'm'))[0];
        vm.runInContext(local, scope);
    }
    const started = scope.start({ userId: 'a', workspace: {} });
    assert.equal(scope.center.hidden, true);
    scope.stop(); pending.resolve({ data: [] }); await started;
    assert.equal(scope.center.hidden, true);
    assert.equal(scope.ownerId, '');
});
