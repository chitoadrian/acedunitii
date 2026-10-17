/* Academic scopes are resolved by Supabase; dates always use mainland Ecuador. */
(function (root) {
    'use strict';
    const TABLES = new Set(['subjects', 'tasks', 'events', 'evaluations', 'attendance', 'resources',
        'grades', 'grade_items', 'projects', 'goals', 'project_stages', 'project_subtasks',
        'user_activity_events', 'recent_activity', 'internal_notifications',
        'google_calendar_manual_links', 'academic_notification_states']);

    function getCurrentAcademicYear(at = new Date()) {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Guayaquil', year: 'numeric', month: 'numeric'
        }).formatToParts(at).map(part => [part.type, part.value]));
        const startYear = Number(parts.year) - (Number(parts.month) < 4 ? 1 : 0);
        const endYear = startYear + 1;
        const februaryEnd = new Date(Date.UTC(endYear, 2, 0)).getUTCDate();
        return { startYear, endYear, label: `${startYear} - ${endYear}`,
            startDate: `${startYear}-04-01`, endDate: `${endYear}-02-${februaryEnd}` };
    }

    function createManager({ onChange = () => {} } = {}) {
        let client = null, ownerId = '', years = [], selectedId = '', currentId = '', generation = 0;
        let pending = 0, switching = false;
        let currentStartYear = 0, welcome = null, welcomeSaving = false;
        const scope = () => ({ userId: ownerId, yearId: selectedId, generation });
        const matches = value => Boolean(value && value.userId === ownerId && value.yearId === selectedId && value.generation === generation);
        const selected = () => years.find(year => year.id === selectedId) || null;
        function reset() {
            generation++; ownerId = ''; years = []; selectedId = ''; currentId = ''; client = null;
            pending = 0; switching = false; currentStartYear = 0; welcome = null; welcomeSaving = false; onChange();
        }
        async function start(sb, userId) {
            reset(); client = sb; ownerId = String(userId || '');
            const version = generation;
            const { data, error } = await client.rpc('ensure_academic_year_for_user');
            if (version !== generation || ownerId !== userId) throw new Error('La cuenta cambió durante la carga.');
            if (error) throw error;
            const serverCurrent = (data?.years || []).find(year => year.id === data?.current_id && year.user_id === ownerId);
            currentStartYear = Number(data?.current_start_year || serverCurrent?.start_year);
            years = (data?.years || []).filter(year => year.user_id === ownerId && year.start_year <= currentStartYear).sort((a, b) => b.start_year - a.start_year);
            currentId = data?.current_id || ''; selectedId = data?.selected_id || '';
            if (!selected() || !years.some(year => year.id === currentId)) throw new Error('No se pudo resolver el año lectivo.');
            const previous = years.find(year => year.start_year < currentStartYear);
            welcome = data?.welcome_year_id === currentId && previous
                ? { yearId: currentId, label: serverCurrent.label, previousLabel: previous.label } : null;
            onChange(); return selected();
        }
        async function acknowledgeWelcome() {
            if (!welcome || welcomeSaving) return false;
            const version = generation, userId = ownerId, yearId = welcome.yearId;
            welcomeSaving = true; onChange();
            try {
                const { data, error } = await client.rpc('acknowledge_academic_year_welcome', { p_academic_year_id: yearId });
                if (error) throw error;
                if (version !== generation || userId !== ownerId) return false;
                if (data?.acknowledged !== true || data?.year_id !== yearId) throw new Error('No se pudo confirmar el nuevo año lectivo.');
                welcome = null; onChange(); return true;
            } finally { if (version === generation && userId === ownerId) { welcomeSaving = false; onChange(); } }
        }
        async function select(id, load) {
            if (id === selectedId) return;
            if (!ownerId || pending || switching) throw new Error('Espera a que termine la operación actual.');
            if (!years.some(year => year.id === id)) throw new Error(`No puedes cambiar al próximo año lectivo todavía. El año ${currentStartYear + 1} - ${currentStartYear + 2} estará disponible a partir del 1 de abril de ${currentStartYear + 1}.`);
            const previousId = selectedId, version = generation, userId = ownerId;
            switching = true; onChange();
            try {
                const { error } = await client.from('user_academic_year_preferences')
                    .update({ selected_academic_year_id: id, updated_at: new Date().toISOString() })
                    .eq('user_id', userId).select('user_id').single();
                if (error) throw error;
                if (version !== generation || userId !== ownerId) return;
                selectedId = id; generation++; onChange();
                try {
                    await load(scope());
                } catch (error) {
                    if (userId !== ownerId) throw error;
                    selectedId = previousId; generation++;
                    const rollback = await client.from('user_academic_year_preferences')
                        .update({ selected_academic_year_id: previousId }).eq('user_id', userId);
                    if (rollback.error) console.warn('[ACADEMIC YEARS] No se pudo restaurar la selección remota.', rollback.error.code);
                    throw error;
                }
            } finally { switching = false; onChange(); }
        }
        function guard(builder, captured) {
            return new Proxy(builder, {
                get(target, key) {
                    if (key === 'then') return (resolve, reject) => {
                        if (!matches(captured)) return Promise.reject(new Error('El año lectivo cambió.')).then(resolve, reject);
                        pending++; onChange();
                        return Promise.resolve(target).then(result => {
                            if (!matches(captured)) throw new Error('El año lectivo cambió durante la operación.');
                            return result;
                        }).finally(() => {
                            if (captured.generation === generation) pending = Math.max(0, pending - 1);
                            onChange();
                        }).then(resolve, reject);
                    };
                    const value = target[key];
                    return typeof value === 'function' ? (...args) => guard(value.apply(target, args), captured) : value;
                }
            });
        }
        function table(name, sb = client) {
            if (!TABLES.has(name)) throw new Error(`Tabla académica no admitida: ${name}`);
            const captured = scope();
            if (!captured.userId || !captured.yearId || !selected()) throw new Error('Selecciona un año lectivo válido.');
            const filter = query => {
                if (name !== 'grade_items') query = query.eq('user_id', captured.userId);
                return guard(query.eq('academic_year_id', captured.yearId), captured);
            };
            const payload = (values, stampScope = true) => {
                const stamp = row => {
                    if (row.academic_year_id && row.academic_year_id !== captured.yearId) throw new Error('El registro pertenece a otro año.');
                    if (row.user_id && row.user_id !== captured.userId) throw new Error('El registro pertenece a otra cuenta.');
                    return { ...row, ...(stampScope ? {
                        ...(name !== 'grade_items' ? { user_id: captured.userId } : {}), academic_year_id: captured.yearId
                    } : {}) };
                };
                return Array.isArray(values) ? values.map(stamp) : stamp(values);
            };
            const writable = () => {
                if (selectedId !== currentId && !['academic_notification_states', 'google_calendar_manual_links', 'internal_notifications', 'recent_activity', 'user_activity_events'].includes(name)) {
                    throw new Error('Año histórico: solo puedes consultar sus datos.');
                }
            };
            return {
                select: (...args) => filter(sb.from(name).select(...args)),
                insert: (values, options) => { writable(); return guard(sb.from(name).insert(payload(values), options), captured); },
                upsert: (values, options) => { writable(); return guard(sb.from(name).upsert(payload(values), options), captured); },
                update: (values, options) => { writable(); return filter(sb.from(name).update(payload(values, false), options)); },
                delete: options => { writable(); return filter(sb.from(name).delete(options)); }
            };
        }
        function updateProgress(row) {
            if (!row || row.user_id !== ownerId) return;
            years = years.map(year => year.id === row.id ? row : year); onChange();
        }
        return { start, select, reset, table, scope, matches, selected, updateProgress, acknowledgeWelcome,
            get state() { return { ownerId, years: years.slice(), selectedId, currentId, currentStartYear, historical: Boolean(selectedId && selectedId !== currentId), pending, switching, welcome: welcome && { ...welcome }, welcomeSaving }; } };
    }

    function createSelector(element, onSelect) {
        const trigger = element.querySelector('#academic-year-trigger'), menu = element.querySelector('[role="listbox"]');
        let signature = '', state = null;
        const options = () => [...menu.querySelectorAll('[role="option"]')];
        function close(focus = false) { menu.hidden = true; trigger.setAttribute('aria-expanded','false'); if(focus) trigger.focus(); }
        function open(last = false) {
            if(trigger.disabled) return;
            menu.hidden = false; trigger.setAttribute('aria-expanded','true');
            const items=options();(last ? items.at(-1) : items.find(item=>item.getAttribute('aria-selected')==='true') || items[0])?.focus();
        }
        trigger.addEventListener('click',()=>menu.hidden ? open() : close());
        trigger.addEventListener('keydown',event=>{
            if(event.key==='ArrowDown' || event.key==='ArrowUp'){event.preventDefault();open(event.key==='ArrowUp');}
            if(event.key==='Escape'){event.preventDefault();close(true);}
        });
        menu.addEventListener('click',event=>{
            const item=event.target.closest('[role="option"]');if(!item || trigger.disabled)return;
            close(true);onSelect(item.dataset.yearId);
        });
        menu.addEventListener('keydown',event=>{
            const items=options(), index=items.indexOf(document.activeElement);
            if(event.key==='Escape'){event.preventDefault();close(true);return;}
            if(event.key==='Tab'){close();return;}
            const next=event.key==='Home' ? 0 : event.key==='End' ? items.length-1 : event.key==='ArrowDown' ? (index+1)%items.length : event.key==='ArrowUp' ? (index-1+items.length)%items.length : -1;
            if(next>=0){event.preventDefault();items[next]?.focus();}
        });
        document.addEventListener('pointerdown',event=>{if(!element.contains(event.target))close();});
        element.addEventListener('focusout',event=>{if(event.relatedTarget && !element.contains(event.relatedTarget))close();});
        return { close, update(next, disabled) {
            state=next;trigger.disabled=disabled;
            const key=state.years.map(year=>`${year.id}:${year.label}:${year.id===state.currentId}:${year.id===state.selectedId}`).join('|');
            if(key!==signature){
                signature=key;menu.querySelectorAll('[role="option"]').forEach(item=>item.remove());
                for(const year of state.years){
                    const item=document.createElement('button');item.type='button';item.setAttribute('role','option');item.tabIndex=-1;item.dataset.yearId=year.id;
                    item.setAttribute('aria-selected',String(year.id===state.selectedId));
                    const check=document.createElement('span');check.className='academic-year-check';check.setAttribute('aria-hidden','true');check.textContent=year.id===state.selectedId ? '✓' : '';
                    const label=document.createElement('span');label.className='academic-year-option-label';label.textContent=year.label;
                    const badge=document.createElement('span');badge.className='academic-year-option-badge';badge.textContent=year.id===state.currentId ? 'Año actual' : 'Histórico';
                    item.append(check,label,badge);menu.append(item);
                }
            }
            if(disabled)close();
        } };
    }
    root.ACAcademicYears = { getCurrentAcademicYear, createManager, createSelector, TABLES };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.ACAcademicYears;
})(typeof globalThis !== 'undefined' ? globalThis : window);
