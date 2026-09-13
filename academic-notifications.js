(function registerAcademicNotificationCenter(root) {
    'use strict';

    const TIME_ZONE = 'America/Guayaquil';
    const OFFSET = '-05:00';
    const VISIBLE_SECTIONS = new Set([
        'dashboard', 'subjects', 'tasks', 'calendar', 'evaluations', 'goals-projects',
        'grades', 'attendance', 'ai-assistant', 'progress', 'backpack', 'profile'
    ]);
    const FALLBACK_TIMES = Object.freeze({
        task: '18:00',
        evaluation: '23:59',
        project: '23:59',
        stage: '23:59',
        subtask: '23:59',
        event: '08:00'
    });
    const ICONS = Object.freeze({
        task: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"></rect><path d="m8 12 3 3 5-6"></path></svg>',
        evaluation: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1.2 2H20v16H4V5h3.8L9 3Z"></path><path d="M8 10h8M8 14h5M8 18h7"></path></svg>',
        project: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3"></path></svg>',
        stage: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v5H5zM5 15h14v5H5zM12 9v6"></path></svg>',
        subtask: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3"></rect><path d="m8.5 12 2.2 2.2 4.8-5"></path></svg>',
        event: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3"></rect><path d="M8 3v4M16 3v4M4 10h16M8 14h3M14 14h2"></path></svg>'
    });

    let ownerId = '';
    let stateRows = [];
    let notifications = [];
    let latestWorkspace = null;
    let center = null;
    let bell = null;
    let panel = null;
    let list = null;
    let badge = null;
    let subtitle = null;
    let markAllButton = null;
    let panelOpen = false;
    let stateLoadGeneration = 0;

    function escapeHTML(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function normalizeDate(value) {
        const text = String(value || '').slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
    }

    function normalizeTime(value) {
        const normalized = root.ACEdunityTime?.normalize24HourTime?.(value);
        if (normalized) return normalized;
        const match = String(value || '').trim().match(/^(\d{2}):(\d{2})/);
        if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return '';
        return `${match[1]}:${match[2]}`;
    }

    function deadlineFromLocal(dateValue, timeValue, fallbackTime = '23:59') {
        const date = normalizeDate(dateValue);
        const time = normalizeTime(timeValue) || fallbackTime;
        if (!date || !normalizeTime(time)) return null;
        const deadline = new Date(`${date}T${time}:00${OFFSET}`);
        return Number.isNaN(deadline.getTime()) ? null : deadline;
    }

    function buildNotificationKey(type, id, dateValue, timeValue, fallbackTime) {
        const date = normalizeDate(dateValue);
        const time = normalizeTime(timeValue) || fallbackTime;
        return `${type}:${String(id || '')}:${date}:${time}`;
    }

    function stageIsCompleted(stage, workspace) {
        const subtasks = (workspace.projectSubtasks || []).filter(item => item.stageId === stage.id);
        return subtasks.length
            ? subtasks.every(item => item.status === 'completed')
            : stage.status === 'completed';
    }

    function projectIsCompleted(project, workspace) {
        if (project.status === 'completed') return true;
        const stages = (workspace.projectStages || []).filter(item => item.projectId === project.id);
        return stages.length > 0 && stages.every(stage => stageIsCompleted(stage, workspace));
    }

    function createCandidate({ type, id, title, date, time, projectId = '', fallbackTime, now }) {
        const dueAt = deadlineFromLocal(date, time, fallbackTime);
        if (!id || !String(title || '').trim() || !dueAt || dueAt.getTime() > now.getTime()) return null;
        const cleanTitle = String(title).trim();
        const copy = {
            task: `${cleanTitle} venció.`,
            evaluation: `${cleanTitle} ya finalizó.`,
            project: `El proyecto ${cleanTitle} llegó a su fecha límite.`,
            stage: `La etapa ${cleanTitle} llegó a su fecha límite.`,
            subtask: `La subtarea ${cleanTitle} venció.`,
            event: `El evento ${cleanTitle} ya ocurrió.`
        }[type];
        return {
            key: buildNotificationKey(type, id, date, time, fallbackTime),
            type,
            id: String(id),
            projectId: String(projectId || ''),
            title: cleanTitle,
            message: copy,
            dueAt: dueAt.toISOString(),
            dueAtMs: dueAt.getTime()
        };
    }

    function buildAcademicNotificationCandidates(workspace = {}, nowValue = new Date()) {
        const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
        if (Number.isNaN(now.getTime())) return [];
        const candidates = [];
        const add = config => {
            const candidate = createCandidate({ ...config, now });
            if (candidate) candidates.push(candidate);
        };

        (workspace.tasks || []).forEach(item => {
            if (item.status === 'completed') return;
            add({ type: 'task', id: item.id, title: item.title, date: item.due, time: item.dueTime, fallbackTime: FALLBACK_TIMES.task });
        });
        (workspace.evaluations || []).forEach(item => {
            if (item.status === 'completed') return;
            add({ type: 'evaluation', id: item.id, title: item.title, date: item.date, time: item.time, fallbackTime: FALLBACK_TIMES.evaluation });
        });
        (workspace.projects || []).forEach(item => {
            if (projectIsCompleted(item, workspace)) return;
            add({ type: 'project', id: item.id, projectId: item.id, title: item.title, date: item.dueDate, time: item.dueTime, fallbackTime: FALLBACK_TIMES.project });
        });
        (workspace.projectStages || []).forEach(item => {
            if (stageIsCompleted(item, workspace)) return;
            add({ type: 'stage', id: item.id, projectId: item.projectId, title: item.title, date: item.dueDate, time: item.dueTime, fallbackTime: FALLBACK_TIMES.stage });
        });
        (workspace.projectSubtasks || []).forEach(item => {
            if (item.status === 'completed') return;
            add({ type: 'subtask', id: item.id, projectId: item.projectId, title: item.title, date: item.dueDate, time: item.dueTime, fallbackTime: FALLBACK_TIMES.subtask });
        });
        (workspace.events || []).forEach(item => {
            add({ type: 'event', id: item.id, title: item.title, date: item.date || item.day, time: item.time, fallbackTime: FALLBACK_TIMES.event });
        });

        return candidates.sort((a, b) => b.dueAtMs - a.dueAtMs || a.key.localeCompare(b.key));
    }

    function stateMapFromRows(rows = []) {
        return new Map(rows.map(row => [row.notification_key || row.key, row]));
    }

    function mergeNotificationStates(candidates = [], rows = []) {
        const states = stateMapFromRows(rows);
        return candidates
            .map(candidate => {
                const saved = states.get(candidate.key) || {};
                return { ...candidate, readAt: saved.read_at || null, dismissedAt: saved.dismissed_at || null };
            })
            .filter(item => !item.dismissedAt)
            .sort((a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt)) || b.dueAtMs - a.dueAtMs || a.key.localeCompare(b.key));
    }

    function unreadCount(items = []) {
        return items.filter(item => !item.readAt && !item.dismissedAt).length;
    }

    function unreadBadgeLabel(count) {
        const total = Math.max(0, Number(count) || 0);
        return total > 9 ? '9+' : String(total);
    }

    function applyLocalNotificationState(rows = [], keys = [], changes = {}, nowValue = new Date()) {
        const now = nowValue instanceof Date ? nowValue.toISOString() : new Date(nowValue).toISOString();
        const stateMap = stateMapFromRows(rows);
        keys.forEach(key => {
            const previous = stateMap.get(key) || { notification_key: key, read_at: null, dismissed_at: null, created_at: now };
            stateMap.set(key, { ...previous, ...changes, notification_key: key, updated_at: now });
        });
        return [...stateMap.values()];
    }

    function notificationNavigation(item) {
        const map = {
            task: { section: 'tasks' },
            evaluation: { section: 'evaluations', detail: 'evaluation' },
            project: { section: 'goals-projects', detail: 'project', tab: 'summary' },
            stage: { section: 'goals-projects', detail: 'project', tab: 'stages' },
            subtask: { section: 'goals-projects', detail: 'project', tab: 'stages' },
            event: { section: 'calendar' }
        };
        return map[item?.type] || { section: 'dashboard' };
    }

    function shouldShowBell(sectionId, authenticated = true) {
        return Boolean(authenticated && VISIBLE_SECTIONS.has(String(sectionId || '')) && sectionId !== 'settings');
    }

    function formatWhen(isoValue, nowValue = new Date()) {
        const date = new Date(isoValue);
        const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
        const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
        const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
        const yesterdayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now.getTime() - 86400000));
        const dayLabel = dateKey === todayKey ? 'Hoy' : dateKey === yesterdayKey ? 'Ayer' : new Intl.DateTimeFormat('es-EC', { timeZone: TIME_ZONE, day: '2-digit', month: 'short' }).format(date).replace('.', '');
        const timeLabel = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true }).format(date).replace(/\u202f/g, ' ');
        return `${dayLabel} · ${timeLabel}`;
    }

    function mount() {
        if (typeof document === 'undefined') return null;
        center = document.getElementById('academic-notification-center');
        if (center) return center;
        const main = document.querySelector('#app-page .main-content');
        if (!main) return null;

        center = document.createElement('div');
        center.id = 'academic-notification-center';
        center.className = 'academic-notification-center';
        center.hidden = true;
        center.innerHTML = `
            <button class="academic-notification-bell" type="button" title="Avisos" aria-label="Abrir avisos académicos" aria-haspopup="dialog" aria-expanded="false">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>
                <span class="academic-notification-badge" hidden></span>
            </button>
            <section class="academic-notification-panel" role="dialog" aria-modal="false" aria-labelledby="academic-notification-title" hidden>
                <header class="academic-notification-header">
                    <div><h2 id="academic-notification-title">Avisos académicos</h2><p class="academic-notification-subtitle">Todo al día</p></div>
                    <button class="academic-notification-close" type="button" aria-label="Cerrar avisos">×</button>
                </header>
                <div class="academic-notification-toolbar"><button type="button" class="academic-notification-mark-all" hidden>Marcar todo como leído</button></div>
                <div class="academic-notification-list" tabindex="-1"></div>
            </section>`;
        main.appendChild(center);
        bell = center.querySelector('.academic-notification-bell');
        panel = center.querySelector('.academic-notification-panel');
        list = center.querySelector('.academic-notification-list');
        badge = center.querySelector('.academic-notification-badge');
        subtitle = center.querySelector('.academic-notification-subtitle');
        markAllButton = center.querySelector('.academic-notification-mark-all');

        bell.addEventListener('click', () => panelOpen ? closePanel() : openPanel());
        center.querySelector('.academic-notification-close').addEventListener('click', () => closePanel());
        markAllButton.addEventListener('click', markAllRead);
        list.addEventListener('click', handleListClick);
        document.addEventListener('pointerdown', event => {
            if (panelOpen && !center.contains(event.target)) closePanel(false);
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && panelOpen) {
                event.preventDefault();
                closePanel();
            }
        });
        return center;
    }

    function render() {
        if (!mount()) return;
        const unread = unreadCount(notifications);
        badge.hidden = unread === 0;
        badge.textContent = unreadBadgeLabel(unread);
        subtitle.textContent = notifications.length ? `${unread} ${unread === 1 ? 'pendiente' : 'pendientes'}` : 'Todo al día';
        markAllButton.hidden = unread === 0;
        bell.setAttribute('aria-label', unread ? `Abrir avisos académicos, ${unread} sin leer` : 'Abrir avisos académicos');

        if (!notifications.length) {
            list.innerHTML = `<div class="academic-notification-empty">${ICONS.task}<strong>Todo al día</strong><p>No tienes vencimientos pendientes.</p></div>`;
            return;
        }

        list.innerHTML = notifications.map(item => `
            <article class="academic-notification-item ${item.readAt ? 'is-read' : 'is-unread'}" data-notification-key="${escapeHTML(item.key)}">
                <span class="academic-notification-icon type-${escapeHTML(item.type)}">${ICONS[item.type] || ICONS.task}</span>
                <div class="academic-notification-copy">
                    <span>${escapeHTML({ task: 'Tarea', evaluation: 'Evaluación', project: 'Proyecto', stage: 'Etapa', subtask: 'Subtarea', event: 'Evento' }[item.type])}</span>
                    <strong>${escapeHTML(item.message)}</strong>
                    <time datetime="${escapeHTML(item.dueAt)}">${escapeHTML(formatWhen(item.dueAt))}</time>
                </div>
                <div class="academic-notification-actions">
                    <button type="button" data-notification-view="${escapeHTML(item.key)}">Ver</button>
                    ${item.readAt ? '' : `<button type="button" class="academic-notification-read" data-notification-read="${escapeHTML(item.key)}" aria-label="Marcar aviso de ${escapeHTML(item.title)} como leído">✓</button>`}
                    <button type="button" class="academic-notification-dismiss" data-notification-dismiss="${escapeHTML(item.key)}" aria-label="Descartar aviso de ${escapeHTML(item.title)}">×</button>
                </div>
            </article>`).join('');
    }

    function openPanel() {
        if (!panel || center.hidden) return;
        panelOpen = true;
        panel.hidden = false;
        center.classList.add('is-open');
        bell.setAttribute('aria-expanded', 'true');
        panel.querySelector('.academic-notification-close')?.focus();
    }

    function closePanel(restoreFocus = true) {
        if (!panel) return;
        panelOpen = false;
        panel.hidden = true;
        center?.classList.remove('is-open');
        bell?.setAttribute('aria-expanded', 'false');
        if (restoreFocus && !center?.hidden) bell?.focus();
    }

    async function loadStates() {
        const generation = ++stateLoadGeneration;
        stateRows = [];
        if (!ownerId || typeof root.getSupabaseClient !== 'function') return;
        const { data, error } = await root.getSupabaseClient()
            .from('academic_notification_states')
            .select('notification_key,read_at,dismissed_at,created_at,updated_at')
            .eq('user_id', ownerId);
        if (generation !== stateLoadGeneration || !ownerId) return;
        if (error) throw error;
        stateRows = data || [];
    }

    async function persistState(keys, changes) {
        if (!ownerId || !keys.length) return false;
        const previous = stateRows;
        const now = new Date();
        stateRows = applyLocalNotificationState(stateRows, keys, changes, now);
        refresh(latestWorkspace);
        const rowsByKey = stateMapFromRows(stateRows);
        const payload = keys.map(key => {
            const row = rowsByKey.get(key);
            return {
                user_id: ownerId,
                notification_key: key,
                read_at: row.read_at || null,
                dismissed_at: row.dismissed_at || null,
                updated_at: row.updated_at
            };
        });
        try {
            const { error } = await root.getSupabaseClient()
                .from('academic_notification_states')
                .upsert(payload, { onConflict: 'user_id,notification_key' });
            if (error) throw error;
            return true;
        } catch (error) {
            stateRows = previous;
            refresh(latestWorkspace);
            console.warn('[ACADEMIC NOTIFICATIONS] No se pudo guardar el estado:', { message: error?.message || 'network_error', code: error?.code || null });
            root.notify?.('No se pudo guardar el estado del aviso. Inténtalo nuevamente.', 'error');
            return false;
        }
    }

    async function markRead(key) {
        const item = notifications.find(entry => entry.key === key);
        if (!item || item.readAt) return true;
        return persistState([key], { read_at: new Date().toISOString() });
    }

    async function markAllRead() {
        const keys = notifications.filter(item => !item.readAt).map(item => item.key);
        if (!keys.length) return;
        await persistState(keys, { read_at: new Date().toISOString() });
    }

    async function dismiss(key) {
        const now = new Date().toISOString();
        await persistState([key], { read_at: now, dismissed_at: now });
    }

    function navigateNotification(item) {
        const target = notificationNavigation(item);
        root.navigateTo?.(target.section);
        if (target.detail === 'evaluation' && typeof root.openEvaluationDetail === 'function') {
            root.openEvaluationDetail(item.id);
        }
        if (target.detail === 'project' && item.projectId && typeof root.openProjectDetail === 'function') {
            root.openProjectDetail(item.projectId, target.tab);
        }
    }

    async function handleListClick(event) {
        const viewButton = event.target.closest('[data-notification-view]');
        if (viewButton) {
            const item = notifications.find(entry => entry.key === viewButton.dataset.notificationView);
            if (!item) return;
            await markRead(item.key);
            closePanel(false);
            navigateNotification(item);
            return;
        }
        const readButton = event.target.closest('[data-notification-read]');
        if (readButton) {
            await markRead(readButton.dataset.notificationRead);
            return;
        }
        const dismissButton = event.target.closest('[data-notification-dismiss]');
        if (dismissButton) await dismiss(dismissButton.dataset.notificationDismiss);
    }

    function refresh(workspace) {
        latestWorkspace = workspace || latestWorkspace || root.loadWorkspace?.() || {};
        const candidates = buildAcademicNotificationCandidates(latestWorkspace);
        notifications = mergeNotificationStates(candidates, stateRows);
        render();
        updateVisibility(root.currentSection || document.querySelector('#app-page .section.active')?.id || 'dashboard');
        return notifications;
    }

    function updateVisibility(sectionId) {
        if (!mount()) return false;
        const authenticated = Boolean(ownerId && document.body.classList.contains('is-dashboard'));
        const visible = shouldShowBell(sectionId, authenticated);
        center.hidden = !visible;
        if (!visible) closePanel(false);
        return visible;
    }

    async function start({ userId, workspace } = {}) {
        mount();
        ownerId = String(userId || '');
        latestWorkspace = workspace || root.loadWorkspace?.() || {};
        try {
            await loadStates();
        } catch (error) {
            console.warn('[ACADEMIC NOTIFICATIONS] No se pudieron cargar estados:', { message: error?.message || 'network_error', code: error?.code || null });
        }
        return refresh(latestWorkspace);
    }

    function stop() {
        stateLoadGeneration += 1;
        ownerId = '';
        stateRows = [];
        notifications = [];
        latestWorkspace = null;
        closePanel(false);
        if (center) center.hidden = true;
        render();
    }

    const api = Object.freeze({
        start,
        stop,
        refresh,
        updateVisibility,
        buildAcademicNotificationCandidates,
        buildNotificationKey,
        deadlineFromLocal,
        mergeNotificationStates,
        unreadCount,
        unreadBadgeLabel,
        applyLocalNotificationState,
        notificationNavigation,
        shouldShowBell,
        formatWhen,
        constants: { TIME_ZONE, FALLBACK_TIMES, VISIBLE_SECTIONS }
    });

    root.ACAcademicNotifications = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
