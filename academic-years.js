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
        const scope = () => ({ userId: ownerId, yearId: selectedId, generation });
        const matches = value => Boolean(value && value.userId === ownerId && value.yearId === selectedId && value.generation === generation);
        const selected = () => years.find(year => year.id === selectedId) || null;
        function reset() {
            generation++; ownerId = ''; years = []; selectedId = ''; currentId = ''; client = null;
            pending = 0; switching = false; onChange();
        }
        async function start(sb, userId) {
            reset(); client = sb; ownerId = String(userId || '');
            const version = generation;
            const { data, error } = await client.rpc('ensure_academic_year_for_user');
            if (version !== generation || ownerId !== userId) throw new Error('La cuenta cambió durante la carga.');
            if (error) throw error;
            years = (data?.years || []).filter(year => year.user_id === ownerId).sort((a, b) => b.start_year - a.start_year);
            currentId = data?.current_id || ''; selectedId = data?.selected_id || '';
            if (!selected() || !years.some(year => year.id === currentId)) throw new Error('No se pudo resolver el año lectivo.');
            onChange(); return selected();
        }
        async function select(id, load) {
            if (id === selectedId) return;
            if (!ownerId || !years.some(year => year.id === id) || pending || switching) throw new Error('Espera a que termine la operación actual.');
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
            return {
                select: (...args) => filter(sb.from(name).select(...args)),
                insert: (values, options) => guard(sb.from(name).insert(payload(values), options), captured),
                upsert: (values, options) => guard(sb.from(name).upsert(payload(values), options), captured),
                update: (values, options) => filter(sb.from(name).update(payload(values, false), options)),
                delete: options => filter(sb.from(name).delete(options))
            };
        }
        function updateProgress(row) {
            if (!row || row.user_id !== ownerId) return;
            years = years.map(year => year.id === row.id ? row : year); onChange();
        }
        return { start, select, reset, table, scope, matches, selected, updateProgress,
            get state() { return { ownerId, years: years.slice(), selectedId, currentId, pending, switching }; } };
    }

    root.ACAcademicYears = { getCurrentAcademicYear, createManager, TABLES };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.ACAcademicYears;
})(typeof globalThis !== 'undefined' ? globalThis : window);
