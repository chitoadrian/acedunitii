/* A user's manual confirmation, never a confirmation from Google. */
(function (root) {
    'use strict';
    const types = new Set(['task', 'event', 'evaluation', 'project', 'goal', 'stage']);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const table = 'google_calendar_manual_links';
    const columns = 'entity_type,entity_id,confirmed_at';

    function createController({ getUserId, getClient, onChange = () => {}, onError = () => {} }) {
        let owner = '', generation = 0, loaded = false, loading = null, loadFailed = false;
        let confirmed = new Map(), opened = new Set(), pending = new Set();
        const keyFor = (type, id) => types.has(type) && uuid.test(id || '') ? `${type}:${id}` : '';
        function reset() {
            owner = ''; generation++; loaded = false; loading = null; loadFailed = false;
            confirmed = new Map(); opened = new Set(); pending = new Set();
        }
        function scope() {
            const id = String(getUserId() || '');
            if (id !== owner) { reset(); owner = id; }
            return owner;
        }
        function state(type, id) {
            const user = scope(), key = keyFor(type, id);
            return { valid: Boolean(user && key), loaded, loadFailed, busy: pending.has(key),
                confirmed: confirmed.has(key), opened: opened.has(key) };
        }
        function load() {
            const user = scope();
            if (!user || loaded) return Promise.resolve(loaded);
            if (loading) return loading;
            const version = generation;
            loadFailed = false;
            loading = Promise.resolve().then(async () => {
                try {
                    const rows = [];
                    // One batch (paged only for large accounts), not one request per card.
                    for (let offset = 0; ; offset += 1000) {
                        const { data, error } = await getClient().from(table).select(columns)
                            .eq('user_id', user).order('entity_type').order('entity_id').range(offset, offset + 999);
                        if (error) throw error;
                        if (scope() !== user || generation !== version) return false;
                        rows.push(...(data || []));
                        if ((data || []).length < 1000) break;
                    }
                    confirmed = new Map(rows.filter(row => keyFor(row.entity_type, row.entity_id) && row.confirmed_at)
                        .map(row => [keyFor(row.entity_type, row.entity_id), row.confirmed_at]));
                    loaded = true;
                    return true;
                } catch (error) {
                    if (scope() === user && generation === version) { loadFailed = true; onError('load', error); }
                    return false;
                } finally {
                    if (scope() === user && generation === version) { loading = null; onChange(); }
                }
            });
            return loading;
        }
        function markOpened(type, id) {
            const user = scope(), key = keyFor(type, id);
            if (!user || !key || confirmed.has(key)) return;
            opened.add(key);
            onChange();
        }
        async function mutate(type, id, remove) {
            const user = scope(), key = keyFor(type, id), version = generation;
            if (!user || !key || pending.has(key) || (!remove && !opened.has(key))) return false;
            pending.add(key); onChange();
            try {
                if (!await load()) return false;
                if (scope() !== user || generation !== version) return false;
                if (!remove && confirmed.has(key)) return true;
                let response;
                if (remove) {
                    response = await getClient().from(table).delete().eq('user_id', user)
                        .eq('entity_type', type).eq('entity_id', id).select('entity_id');
                } else {
                    response = await getClient().from(table).upsert({ user_id: user, entity_type: type, entity_id: id },
                        { onConflict: 'user_id,entity_type,entity_id' }).select(columns).single();
                }
                if (response.error) throw response.error;
                if (scope() !== user || generation !== version) return false;
                if (remove) { confirmed.delete(key); opened.delete(key); }
                else {
                    if (!response.data?.confirmed_at) throw new Error('missing_confirmation');
                    confirmed.set(key, response.data.confirmed_at);
                    opened.delete(key);
                }
                return true;
            } catch (error) {
                if (scope() === user && generation === version) onError(remove ? 'remove' : 'confirm', error);
                return false;
            } finally {
                if (scope() === user && generation === version) { pending.delete(key); onChange(); }
            }
        }
        return { state, load, reset, markOpened, confirm: (type, id) => mutate(type, id, false),
            remove: (type, id) => mutate(type, id, true) };
    }
    root.createGoogleCalendarManualController = createController;
    if (typeof document === 'undefined') return;

    function content(type, id) {
        const s = controller.state(type, id);
        const disabled = !s.valid || s.busy || (!s.loaded && !s.loadFailed);
        const button = (action, label, primary = false) => `<button type="button" class="${primary ? 'btn-primary' : 'btn-secondary'} btn-small" data-gcal-action="${action}" ${disabled ? 'disabled' : ''}>${label}</button>`;
        if (s.confirmed) return `<span class="gcal-manual-success" role="status" title="Confirmado manualmente por ti; no verificado por Google">✓ Agendado correctamente</span>${button('remove', s.busy ? 'Quitando…' : 'Desmarcar')}<small>Confirmado manualmente por ti.</small>`;
        if (s.loadFailed) return `${button('retry', 'Reintentar estado')}<small>No se pudo consultar tu confirmación.</small>`;
        if (s.opened) return `<span class="gcal-manual-opened" role="status">Abierto en Google Calendar</span>${button('confirm', s.busy ? 'Guardando…' : 'Ya lo guardé', true)}`;
        return button('open', 'Agregar a Google Calendar');
    }
    function refresh() {
        const active = document.activeElement;
        const focusHost = active?.closest?.('[data-gcal-manual]');
        const action = active?.dataset?.gcalAction;
        document.querySelectorAll('[data-gcal-manual]').forEach(host => {
            host.innerHTML = content(host.dataset.gcalType, host.dataset.gcalId);
            if (host === focusHost) {
                const target = host.querySelector(`[data-gcal-action="${action}"]:not(:disabled)`)
                    || host.querySelector('button:not(:disabled)');
                if (target) target.focus({ preventScroll: true });
                else host.focus({ preventScroll: true });
            }
        });
    }
    const controller = createController({
        getUserId: () => typeof currentUser !== 'undefined' ? currentUser?.id : '',
        getClient: () => getSupabaseClient(),
        onChange: refresh,
        onError: (operation, error) => {
            console.warn('[Google Calendar manual]', { operation, code: error?.code || 'unavailable' });
            if (operation !== 'load') notify('No se pudo guardar el cambio. Inténtalo nuevamente.', 'error');
        }
    });
    root.ACGoogleCalendarManual = {
        ...controller,
        render(type, id) {
            if (!types.has(type) || !uuid.test(id || '')) return '';
            const s = controller.state(type, id);
            if (s.valid && !s.loaded && !s.loadFailed) void controller.load();
            return `<div class="gcal-manual-controls" data-gcal-manual data-gcal-type="${type}" data-gcal-id="${id}" tabindex="-1" aria-live="polite">${content(type, id)}</div>`;
        }
    };
    document.addEventListener('click', async event => {
        const button = event.target.closest('[data-gcal-action]');
        const host = button?.closest('[data-gcal-manual]');
        if (!host || button.disabled) return;
        const type = host.dataset.gcalType, id = host.dataset.gcalId, action = button.dataset.gcalAction;
        if (!controller.state(type, id).valid) return;
        if (action === 'retry') { void controller.load(); refresh(); return; }
        if (action === 'confirm' || action === 'remove') {
            const ok = await controller[action](type, id);
            if (ok) notify(action === 'confirm' ? 'Confirmación manual guardada. Marcaste este elemento como agendado.' : 'Confirmación retirada. No se eliminó ningún evento de Google.', 'success');
            return;
        }
        if (action !== 'open' || !controller.state(type, id).loaded) return;
        // Synchronous window.open stays within the user's gesture (popup-safe).
        if (type === 'task') openTaskInGoogleCalendar(id);
        else if (type === 'event') openGoogleCalendarEvent(id);
        else if (type === 'evaluation') openGoogleCalendarForEvaluation(id);
        else {
            const item = getGoalsProjectsCalendarItems(loadWorkspace()).find(row => row.kind === type && row.entityId === id);
            if (item) openAgendaItemInGoogleCalendar(item);
        }
    });
})(globalThis);
