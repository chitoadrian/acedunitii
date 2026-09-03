/* A user's manual confirmation, never a confirmation from Google. */
(function (root) {
    'use strict';
    const types = new Set(['task', 'event', 'evaluation', 'project', 'goal', 'stage']);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const table = 'google_calendar_manual_links';
    const columns = 'entity_type,entity_id,confirmed_at';
    const labels = { task: 'Tarea', event: 'Evento', evaluation: 'Evaluación', project: 'Proyecto', goal: 'Meta', stage: 'Etapa' };
    const entityLabel = type => labels[type] || 'Elemento';
    const savedLabel = type => `${entityLabel(type)} ${['task', 'evaluation', 'goal', 'stage'].includes(type) ? 'guardada' : 'guardado'} en el calendario`;
    const agendaTypes = new Set(['evaluation', 'project', 'goal', 'stage']);
    const removalTitle = type => agendaTypes.has(type)
        ? `¿Quitar ${['evaluation', 'goal', 'stage'].includes(type) ? 'esta' : 'este'} ${entityLabel(type).toLowerCase()} del calendario?`
        : '¿Quitar la confirmación de Google Calendar?';
    function removalDescription(type, confirmed) {
        const location = type === 'evaluation' ? 'Evaluaciones' : 'Metas y Proyectos';
        const feminine = ['evaluation', 'goal', 'stage'].includes(type);
        const base = agendaTypes.has(type)
            ? `Se quitará únicamente de tu Agenda de AC Edunity. ${feminine ? 'La' : 'El'} ${entityLabel(type).toLowerCase()} seguirá existiendo en ${location}.`
            : type === 'event' ? 'El evento seguirá visible en Calendario. Solo se quitará su confirmación de Google Calendar.'
            : 'La tarea seguirá intacta en Tareas. Las tareas no se muestran en Agenda; solo se quitará su confirmación de Google Calendar.';
        return base + (confirmed ? ' También se quitará la confirmación de AC Edunity. Si guardaste una copia en Google Calendar, puedes abrir Google Calendar para eliminarla allí.' : '');
    }

    function createController({ getUserId, getClient, onChange = () => {}, onError = () => {} }) {
        let owner = '', generation = 0, loaded = false, loading = null, loadFailed = false;
        let confirmed = new Map(), opened = new Set(), pending = new Set(), deleted = new Set();
        const keyFor = (type, id) => types.has(type) && uuid.test(id || '') ? `${type}:${id}` : '';
        function reset() {
            owner = ''; generation++; loaded = false; loading = null; loadFailed = false;
            confirmed = new Map(); opened = new Set(); pending = new Set(); deleted = new Set();
        }
        function scope() {
            const id = String(getUserId() || '');
            if (id !== owner) { reset(); owner = id; }
            return owner;
        }
        function state(type, id) {
            const user = scope(), key = keyFor(type, id);
            return { valid: Boolean(user && key && !deleted.has(key)), loaded, loadFailed, busy: pending.has(key),
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
                    confirmed = new Map(rows.filter(row => keyFor(row.entity_type, row.entity_id) && !deleted.has(keyFor(row.entity_type, row.entity_id)) && row.confirmed_at)
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
            if (!user || !key || deleted.has(key) || confirmed.has(key)) return;
            opened.add(key);
            onChange();
        }
        async function mutate(type, id, remove) {
            const user = scope(), key = keyFor(type, id), version = generation;
            if (!user || !key || deleted.has(key) || pending.has(key) || (!remove && !opened.has(key))) return false;
            pending.add(key); onChange();
            try {
                if (!await load()) return false;
                if (scope() !== user || generation !== version || deleted.has(key)) return false;
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
                if (scope() !== user || generation !== version || deleted.has(key)) return false;
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
        function forget(type, id) {
            scope(); const key = keyFor(type, id);
            if (!key) return;
            deleted.add(key); confirmed.delete(key); opened.delete(key); onChange();
        }
        async function removeFromCalendar(type, id) {
            const user = scope(), key = keyFor(type, id), version = generation;
            if (!user || !key || deleted.has(key) || pending.has(key)) return false;
            pending.add(key); onChange();
            try {
                if (!await load() || scope() !== user || generation !== version) return false;
                const { data, error } = await getClient().rpc('remove_from_academic_calendar', {
                    p_entity_type: type, p_entity_id: id
                });
                if (error) throw error;
                if (scope() !== user || generation !== version || deleted.has(key)) return false;
                if (!data?.row || data.row.id !== id) throw new Error('missing_calendar_entity');
                confirmed.delete(key); opened.delete(key);
                return data;
            } catch (error) {
                if (scope() === user && generation === version) onError('calendar-remove', error);
                return false;
            } finally {
                if (scope() === user && generation === version) { pending.delete(key); onChange(); }
            }
        }
        return { state, load, reset, markOpened, forget, removeFromCalendar, confirm: (type, id) => mutate(type, id, false),
            remove: (type, id) => mutate(type, id, true) };
    }
    root.createGoogleCalendarManualController = createController;
    root.getGoogleCalendarEntityLabel = entityLabel;
    root.getGoogleCalendarSavedLabel = savedLabel;
    if (typeof document === 'undefined') return;

    function content(type, id) {
        const s = controller.state(type, id);
        const disabled = !s.valid || s.busy || (!s.loaded && !s.loadFailed);
        const button = (action, label, primary = false) => `<button type="button" class="${primary ? 'btn-primary' : 'btn-secondary'} btn-small" data-gcal-action="${action}" ${action === 'confirm' ? 'title="Pulsa aquí cuando hayas guardado el evento en Google Calendar." aria-label="Confirmo que ya lo guardé en Google Calendar"' : ''} ${disabled ? 'disabled' : ''}>${label}</button>`;
        if (s.confirmed) return `<span class="gcal-manual-success" role="status" title="Confirmado manualmente por ti; no verificado por Google">✓ ${savedLabel(type)}</span><button type="button" class="gcal-manual-remove" data-gcal-action="remove" aria-label="Quitar confirmación" title="Quitar confirmación" ${disabled ? 'disabled' : ''}>${s.busy ? '…' : '×'}</button>`;
        if (s.loadFailed) return `${button('retry', 'Reintentar estado')}<small>No se pudo consultar tu confirmación.</small>`;
        if (s.opened) return button('confirm', s.busy ? 'Guardando…' : savedLabel(type), true);
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
        afterDelete(type, id) {
            const confirmed = controller.state(type, id).confirmed;
            controller.forget(type, id);
            return confirmed ? 'Elemento eliminado de AC Edunity. Recuerda eliminar también la copia guardada en Google Calendar.' : 'Elemento eliminado de AC Edunity.';
        },
        renderCalendarRemove(type, id) {
            if (!types.has(type) || !uuid.test(id || '')) return '';
            return `<button type="button" class="btn-secondary btn-small gcal-entity-delete" data-gcal-calendar-remove="${type}" data-gcal-id="${id}" aria-label="Quitar del calendario" title="Quitar del calendario"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg></button>`;
        },
        requestCalendarRemoval(type, id, trigger) {
            if (!controller.state(type, id).valid || controller.state(type, id).busy) return;
            return confirmCalendarRemoval(type, id, trigger);
        },
        render(type, id) {
            if (!types.has(type) || !uuid.test(id || '')) return '';
            const s = controller.state(type, id);
            if (s.valid && !s.loaded && !s.loadFailed) void controller.load();
            return `<div class="gcal-manual-controls" data-gcal-manual data-gcal-type="${type}" data-gcal-id="${id}" tabindex="-1" aria-live="polite">${content(type, id)}</div>`;
        }
    };
    async function removeFromAcademicCalendar(type, id) {
        const result = await controller.removeFromCalendar(type, id);
        if (!result) return false;
        if (result.hidden) {
            if (type === 'evaluation') replaceWorkspaceItem('evaluations', mapSavedEvaluationRow(result.row));
            else mergeGpSavedRow({project:'projects',goal:'goals',stage:'project_stages'}[type], result.row);
        }
        renderCalendarSection(loadWorkspace());
        return result;
    }
    root.removeFromAcademicCalendar = removeFromAcademicCalendar;
    function confirmCalendarRemoval(type, id, trigger = document.activeElement) {
        if (!controller.state(type, id).valid || document.querySelector('.gcal-delete-modal')) return;
        const owner = currentUser.id;
        const modal = document.createElement('div');
        modal.className = 'quick-modal gcal-delete-modal';
        modal.innerHTML = `<div class="quick-modal-card evaluation-delete-card" role="dialog" aria-modal="true" aria-labelledby="gcal-delete-title" aria-describedby="gcal-delete-copy"><h3 id="gcal-delete-title">${removalTitle(type)}</h3><p id="gcal-delete-copy">${removalDescription(type, controller.state(type,id).confirmed)}</p><div class="evaluation-delete-actions"><button type="button" class="btn-secondary btn-small" data-cancel>Cancelar</button><button type="button" class="btn-primary btn-small" data-confirm>Quitar del calendario</button></div></div>`;
        const cancel = modal.querySelector('[data-cancel]'), submit = modal.querySelector('[data-confirm]');
        let busy = false, completed = false;
        const close = () => { modal.remove(); document.removeEventListener('keydown', keydown); if (trigger?.isConnected) trigger.focus(); };
        const keydown = event => {
            if (event.key === 'Escape' && !busy) { event.preventDefault(); close(); }
            if (event.key === 'Tab') { event.preventDefault(); (document.activeElement === cancel ? submit : cancel).focus(); }
        };
        cancel.onclick = () => { if (!busy) close(); };
        modal.onclick = event => { if (event.target === modal && !busy) close(); };
        submit.onclick = async () => {
            if (busy) return;
            if (completed) { window.open('https://calendar.google.com/calendar/', '_blank', 'noopener,noreferrer'); return; }
            if (currentUser?.id !== owner) { close(); return; }
            busy = true; cancel.disabled = true; submit.disabled = true; submit.textContent = 'Quitando…';
            try {
                const result = await removeFromAcademicCalendar(type, id);
                if (result) {
                    const message = result.hidden ? 'Se quitó de la Agenda de AC Edunity.' : 'Se quitó la confirmación. El registro original permanece intacto.';
                    notify(message, 'success');
                    if (!result.had_confirmation) { close(); return; }
                    completed = true; busy = false; cancel.disabled = false; submit.disabled = false;
                    modal.querySelector('h3').textContent = message;
                    modal.querySelector('p').textContent = 'Tu copia en Google Calendar no se eliminó automáticamente.';
                    cancel.textContent = 'Entendido'; submit.textContent = 'Abrir Google Calendar'; cancel.focus(); return;
                }
            } catch (_) { notify('No se pudo quitar del calendario. Inténtalo nuevamente.', 'error'); }
            busy = false; cancel.disabled = false; submit.disabled = false; submit.textContent = 'Quitar del calendario'; submit.focus();
        };
        document.body.appendChild(modal); document.addEventListener('keydown', keydown); cancel.focus();
    }
    document.addEventListener('click', async event => {
        const trash = event.target.closest('[data-gcal-calendar-remove]');
        if (trash) { root.ACGoogleCalendarManual.requestCalendarRemoval(trash.dataset.gcalCalendarRemove, trash.dataset.gcalId, trash); return; }
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
