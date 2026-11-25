/* Private Exam pilot. No uploaded image or PDF is persisted by the client. */
window.ACEdunityExam = (() => {
    const PDF_MODULE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs';
    const PDF_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs';
    let userId = '';
    let access = { exam_enabled: false, autopilot_enabled: false };
    let activeAttempt = null;
    let busy = false;
    let accessGeneration = 0;

    const node = id => document.getElementById(id);
    function status(message, kind = '') {
        const target = node('exam-status');
        if (target) { target.textContent = message; target.dataset.kind = kind; }
    }
    function setBusy(value) {
        busy = value;
        ['exam-recognize', 'exam-generate'].forEach(id => { if (node(id)) node(id).disabled = value; });
    }
    function showAccess() {
        const mapping = { 'edunity-exam': access.exam_enabled, 'edunity-autopilot': access.autopilot_enabled };
        Object.entries(mapping).forEach(([section, enabled]) => {
            const menu = document.querySelector(`.sidebar-nav [data-section="${section}"]`);
            if (menu) menu.hidden = !enabled;
            if (node(section)) node(section).hidden = !enabled;
        });
    }
    function reset() {
        accessGeneration += 1;
        userId = '';
        access = { exam_enabled: false, autopilot_enabled: false };
        activeAttempt = null;
        setBusy(false);
        if (node('exam-files')) node('exam-files').value = '';
        if (node('exam-text')) node('exam-text').value = '';
        if (node('exam-source-name')) node('exam-source-name').value = '';
        if (node('exam-quiz')) node('exam-quiz').textContent = '';
        if (node('exam-history')) node('exam-history').textContent = '';
        status('');
        showAccess();
    }
    async function loadAccess(id) {
        reset();
        if (!id) return;
        const generation = accessGeneration;
        const { data, error } = await getSupabaseClient().from('edunity_feature_access')
            .select('exam_enabled,autopilot_enabled').eq('user_id', id).maybeSingle();
        if (generation !== accessGeneration) return;
        if (error) { console.warn('[exam] No se pudo comprobar el acceso privado'); return; }
        userId = id;
        access = { exam_enabled: data?.exam_enabled === true, autopilot_enabled: data?.autopilot_enabled === true };
        showAccess();
    }
    function canAccess(section) {
        if (section === 'edunity-exam') return access.exam_enabled;
        if (section === 'edunity-autopilot') return access.autopilot_enabled;
        return true;
    }
    async function call(action, payload = {}) {
        if (!access.exam_enabled || !userId) throw new Error('Exam no está habilitado para esta cuenta.');
        const { data, error } = await getSupabaseClient().functions.invoke('edunity-exam', { body: { action, ...payload } });
        if (error) {
            let detail = null;
            try { if (error.context?.json) detail = await error.context.json(); } catch { /* Network errors have no JSON body. */ }
            throw new Error(detail?.error || 'No se pudo comunicar con Exam. Inténtalo de nuevo.');
        }
        if (data?.error) throw new Error(data.error);
        return data;
    }
    async function imageData(file) {
        if (file.size > 3_000_000) throw new Error(`La imagen ${file.name} supera 3 MB.`);
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error(`No se pudo abrir ${file.name}.`));
            reader.readAsDataURL(file);
        });
    }
    async function readPdf(file) {
        if (file.size > 5_000_000) throw new Error(`El PDF ${file.name} supera 5 MB.`);
        const pdfjs = await import(PDF_MODULE);
        pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER;
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        if (pdf.numPages > 3) status(`Se leerán las primeras 3 páginas de ${file.name}.`);
        const chunks = [];
        for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const extracted = content.items.map(item => item.str || '').join(' ').trim();
            if (extracted.length >= 80) { chunks.push(`Página ${i}: ${extracted}`); continue; }
            const viewport = page.getViewport({ scale: 1.25 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            const image = canvas.toDataURL('image/jpeg', .72);
            canvas.width = canvas.height = 0;
            if (image.length * .75 > 3_000_000) throw new Error(`La página ${i} es demasiado grande para reconocerla.`);
            const result = await call('recognize', { image });
            chunks.push(`Página ${i}: ${result.text}`);
        }
        return chunks.join('\n\n');
    }
    async function recognize() {
        if (busy) return;
        const owner = userId;
        const files = [...(node('exam-files')?.files || [])];
        if (!files.length || files.length > 3) { status('Selecciona entre 1 y 3 archivos.', 'error'); return; }
        setBusy(true);
        status('Reconociendo el material…');
        try {
            const chunks = [];
            for (const file of files) {
                if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
                    chunks.push(await readPdf(file));
                } else if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                    const result = await call('recognize', { image: await imageData(file) });
                    chunks.push(result.text);
                } else throw new Error(`Tipo de archivo no admitido: ${file.name}.`);
                if (owner !== userId) return;
            }
            node('exam-text').value = chunks.filter(Boolean).join('\n\n').slice(0, 30000);
            if (!node('exam-source-name').value) node('exam-source-name').value = files[0].name.slice(0, 180);
            status('Contenido listo. Revísalo y corrige cualquier lectura errónea.');
        } catch (error) { status(error.message || 'No se pudo reconocer el material.', 'error'); }
        finally { setBusy(false); }
    }
    function el(tag, className, value) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (value != null) element.textContent = String(value);
        return element;
    }
    function renderQuiz(attempt) {
        const root = node('exam-quiz');
        root.replaceChildren();
        const completed = Boolean(attempt.completed_at);
        const form = el('form');
        form.id = 'exam-answer-form';
        attempt.questions.forEach((question, index) => {
            const field = el('fieldset', 'exam-question');
            field.append(el('legend', '', `${index + 1}. ${question.prompt}`));
            question.options.forEach((option, choice) => {
                const label = el('label', 'exam-option');
                const input = el('input');
                input.type = 'radio'; input.name = `exam-answer-${index}`; input.value = String(choice);
                input.disabled = completed;
                input.checked = completed && attempt.answers?.[index] === choice;
                label.append(input, el('span', '', option));
                field.append(label);
            });
            if (completed) {
                const feedback = attempt.feedback?.[index];
                const result = el('div', 'exam-result');
                result.append(el('strong', '', feedback?.correct ? 'Correcto' : 'Para reforzar'));
                result.append(el('p', '', `Respuesta: ${question.options[question.correct_index]}`));
                result.append(el('p', '', question.explanation));
                field.append(result);
            }
            form.append(field);
        });
        if (completed) root.append(el('div', 'exam-result', `Calificación: ${(attempt.score / 10).toFixed(1)}/10 (${attempt.score}%)`));
        else {
            const button = el('button', 'btn-primary', 'Corregir respuestas');
            button.type = 'submit';
            form.append(button);
            form.addEventListener('submit', event => { event.preventDefault(); grade(); });
        }
        root.append(form);
    }
    async function generate() {
        if (busy) return;
        const owner = userId;
        const source_name = node('exam-source-name').value.trim();
        const recognized_text = node('exam-text').value.trim();
        if (!source_name || recognized_text.length < 80) { status('Revisa el nombre y agrega al menos 80 caracteres de contenido.', 'error'); return; }
        setBusy(true); status('Generando preguntas…');
        try {
            const data = await call('generate', { source_name, recognized_text,
                difficulty: node('exam-difficulty').value, count: Number(node('exam-count').value) });
            if (owner !== userId) return;
            activeAttempt = data.attempt;
            renderQuiz(activeAttempt);
            status('Simulacro listo. Responde todas las preguntas.');
            try { await history(); } catch { /* The active exam remains available. */ }
        } catch (error) { status(error.message || 'No se pudo generar el simulacro.', 'error'); }
        finally { setBusy(false); }
    }
    async function grade() {
        if (busy || !activeAttempt) return;
        const owner = userId;
        const form = node('exam-answer-form');
        const answers = activeAttempt.questions.map((_, index) => {
            const selected = form.querySelector(`input[name="exam-answer-${index}"]:checked`);
            return selected ? Number(selected.value) : -1;
        });
        if (answers.includes(-1)) { status('Responde todas las preguntas antes de corregir.', 'error'); return; }
        setBusy(true); status('Corrigiendo…');
        try {
            const data = await call('grade', { attempt_id: activeAttempt.id, answers });
            if (owner !== userId) return;
            activeAttempt = data.attempt;
            renderQuiz(activeAttempt);
            status(`Calificación: ${(activeAttempt.score / 10).toFixed(1)}/10. Revisa las explicaciones.`);
            try { await history(); } catch { /* The graded exam remains available. */ }
        } catch (error) { status(error.message || 'No se pudieron corregir las respuestas.', 'error'); }
        finally { setBusy(false); }
    }
    async function history() {
        if (!access.exam_enabled) return;
        const owner = userId;
        const data = await call('history');
        if (owner !== userId) return;
        const root = node('exam-history');
        root.replaceChildren();
        const attempts = data.attempts || [];
        if (!attempts.length) { root.append(el('p', 'exam-help', 'Todavía no hay simulacros.')); return; }
        attempts.forEach(attempt => {
            const item = el('div', 'exam-history-item');
            item.append(el('strong', '', `${attempt.source_name} · ${attempt.completed_at ? `${(attempt.score / 10).toFixed(1)}/10` : 'Pendiente'}`));
            item.append(el('span', '', new Date(attempt.created_at).toLocaleString('es-EC')));
            const open = el('button', 'btn-secondary btn-small', 'Ver simulacro');
            open.type = 'button';
            open.addEventListener('click', async () => {
                const currentOwner = userId;
                try {
                    const result = await call('get_attempt', { attempt_id: attempt.id });
                    if (currentOwner !== userId) return;
                    activeAttempt = result.attempt;
                    renderQuiz(activeAttempt);
                    node('exam-quiz').scrollIntoView({ behavior: 'smooth', block: 'start' });
                } catch (error) { status(error.message || 'No se pudo abrir el simulacro.', 'error'); }
            });
            item.append(open);
            const weak = [...new Set((attempt.feedback || []).filter(f => !f.correct).map(f => f.topic))];
            if (weak.length) {
                const list = el('div', 'exam-topic-list');
                weak.forEach(topic => list.append(el('span', '', topic)));
                item.append(list);
            }
            root.append(item);
        });
    }
    async function enter(section) {
        if (section !== 'edunity-exam' || !access.exam_enabled) return;
        try { await history(); } catch { status('No se pudo cargar el historial.', 'error'); }
    }
    return { loadAccess, canAccess, reset, enter, recognize, generate };
})();
