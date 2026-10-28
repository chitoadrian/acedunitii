/* Tutor-only presentation. Raw messages/history never change; KaTeX loads on demand. */
(function (root) {
    'use strict';
    const version = '0.19.1';
    const base = `assets/vendor/katex-${version}/`;
    let libraryPromise = null;
    const assetPromises = new Map();
    const escape = value => String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));

    function readable(tex) {
        return String(tex).replace(/\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
            .replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')
            .replace(/\\(?:times|cdot)\b/g, '×').replace(/\\div\b/g, '÷')
            .replace(/\\(?:left|right|displaystyle|textstyle)\b/g, '')
            .replace(/\\([a-zA-Z]+)/g, '$1').replace(/[{}]/g, '')
            .replace(/\s+/g, ' ').trim().slice(0, 500) || 'Expresión matemática';
    }

    function normalizeTex(tex, doubled) {
        // JSON decoding is already done by the API. Never unescape the entire message:
        // the genuine \\ row separators in cases/matrices must survive.
        if (!doubled || !/(?:^|[^\\])\\\\[a-zA-Z]/.test(tex)) return tex;
        return tex.replace(/\\{2,}/g, slashes => '\\'.repeat(Math.ceil(slashes.length / 2)));
    }

    function bareFormulaEnd(text, start) {
        const command = text.slice(start).match(/^\\{1,2}(dfrac|tfrac|frac|sqrt)\b/);
        if (!command) return -1;
        let cursor = start + command[0].length;
        const whitespace = () => { while (/[ \t]/.test(text[cursor] || 'x')) cursor++; };
        whitespace();
        if (command[1] === 'sqrt' && text[cursor] === '[') {
            const end = text.indexOf(']', cursor + 1);
            if (end === -1 || end - cursor > 100) return -1;
            cursor = end + 1;
        }
        for (let group = 0; group < (command[1] === 'sqrt' ? 1 : 2); group++) {
            whitespace();
            if (text[cursor] !== '{') return -1;
            let depth = 0;
            do {
                const char = text[cursor++];
                if (char === '\\' && /[{}]/.test(text[cursor] || '')) { cursor++; continue; }
                if (char === '{') depth++;
                if (char === '}') depth--;
            } while (depth && cursor < text.length && cursor - start <= 4096);
            if (depth) return -1;
        }
        return cursor;
    }

    function markdown(value, renderText) {
        const source = String(value || '').replace(/\r\n?/g, '\n');
        let prefix = 'ACTUTORSLOT';
        while (source.includes(prefix)) prefix += 'X';
        const slots = [];
        const slot = (html, block = false) => {
            const token = `${prefix}${slots.length}END`;
            slots.push({ token, html, block });
            return block ? `\n\n${token}\n\n` : token;
        };
        // Protect fenced and inline code before looking for any math delimiters.
        const lines = source.split('\n'), protectedLines = [];
        for (let i = 0; i < lines.length; i++) {
            const fence = lines[i].match(/^ {0,3}(`{3,}|~{3,})[^\n]*$/);
            if (!fence) { protectedLines.push(lines[i]); continue; }
            const code = [], marker = fence[1][0], length = fence[1].length;
            while (++i < lines.length) {
                const close = lines[i].match(/^ {0,3}(`+|~+)\s*$/);
                if (close && close[1][0] === marker && close[1].length >= length) break;
                code.push(lines[i]);
            }
            protectedLines.push(slot(`<pre class="tutor-code"><code>${escape(code.join('\n'))}</code></pre>`, true));
        }
        const text = protectedLines.join('\n').replace(/(`+)([^`]*?)\1/g,
            (_, ticks, code) => slot(`<code>${escape(code)}</code>`));
        const delimiters = [
            ['\\\\[', '\\\\]', true, true], ['\\\\(', '\\\\)', false, true],
            ['\\[', '\\]', true, false], ['\\(', '\\)', false, false],
            ['$$', '$$', true, false], ['$', '$', false, false]
        ];
        let prepared = '', index = 0, count = 0;
        const mathSlot = (tex, display, doubled) => {
            const clean = normalizeTex(tex.trim(), doubled);
            const tag = display ? 'div' : 'span';
            return slot(`<${tag} class="tutor-math ${display ? 'tutor-math-block' : 'tutor-math-inline'}" data-tutor-tex="${escape(clean)}" data-math-display="${display}">${escape(readable(clean))}</${tag}>`, display);
        };
        while (index < text.length) {
            if (text[index] === '\\' && text[index - 1] !== '\\' && count < 200) {
                const bareEnd = bareFormulaEnd(text, index);
                if (bareEnd !== -1) {
                    prepared += mathSlot(text.slice(index, bareEnd), false, text[index + 1] === '\\');
                    index = bareEnd; count++; continue;
                }
            }
            const opener = delimiters.find(([start]) => text.startsWith(start, index));
            if (!opener || (index > 0 && text[index - 1] === '\\') || count >= 200) {
                prepared += text[index++]; continue;
            }
            const [start, end, display, doubled] = opener;
            let close = text.indexOf(end, index + start.length);
            if (start === '$') {
                // Do not confuse ordinary prices (e.g. $5 y $10) with inline math.
                if (/\s/.test(text[index + 1] || '')) close = -1;
                while (close !== -1 && (/\s/.test(text[close - 1]) || text[close - 1] === '\\')) close = text.indexOf(end, close + 1);
                if (close !== -1 && text.slice(index, close).includes('\n')) close = -1;
            }
            if (close === -1) { prepared += text[index++]; continue; }
            const tex = text.slice(index + start.length, close);
            prepared += mathSlot(tex, display, doubled); count++;
            index = close + end.length;
        }
        // Also accept an unambiguous standalone LaTeX formula without delimiters.
        prepared = prepared.replace(/^(\s*)(\\(?:dfrac|tfrac|frac|sqrt|int|sum|lim|begin|displaystyle)\b[^\n]*)$/gm,
            (_, space, tex) => count++ < 200 ? mathSlot(tex, true, false) : `${space}${tex}`);
        let html = renderText(prepared);
        for (const item of slots) {
            if (item.block) html = html.split(`<p>${item.token}</p>`).join(item.html);
        }
        return html.replace(new RegExp(`${prefix}(\\d+)END`, 'g'), (_, number) => slots[Number(number)].html);
    }

    function loadAsset(tag, url) {
        if (assetPromises.has(url)) return assetPromises.get(url);
        const promise = new Promise((resolve, reject) => {
            const element = document.createElement(tag);
            let timer;
            const finish = error => {
                root.clearTimeout(timer);
                element.onload = element.onerror = null;
                if (error) { element.remove(); reject(error); } else resolve();
            };
            element.onload = () => finish();
            element.onerror = () => finish(new Error('No se pudo cargar el formato matemático.'));
            if (tag === 'link') { element.rel = 'stylesheet'; element.href = url; }
            else { element.src = url; element.async = true; }
            timer = root.setTimeout(() => finish(new Error('Tiempo de carga agotado.')), 15000);
            document.head.appendChild(element);
        }).catch(error => { assetPromises.delete(url); throw error; });
        assetPromises.set(url, promise);
        return promise;
    }

    function library() {
        if (!libraryPromise) libraryPromise = Promise.all([
            loadAsset('link', `${base}katex.min.css`),
            root.katex ? Promise.resolve() : loadAsset('script', `${base}katex.min.js`)
        ]).then(() => {
            if (!root.katex?.renderToString) throw new Error('Formato matemático no disponible.');
            return root.katex;
        }).catch(error => { libraryPromise = null; throw error; });
        return libraryPromise;
    }

    function formula(tex, display, engine) {
        try {
            if (tex.length > 4096) throw new Error('Expresión demasiado larga.');
            return engine.renderToString(tex, {
                displayMode: display, output: 'htmlAndMathml', throwOnError: true,
                trust: false, strict: 'error', maxSize: 10, maxExpand: 200, macros: {}
            });
        } catch (_) {
            return `<span class="tutor-math-fallback" title="No se pudo interpretar esta expresión matemática.">${escape(readable(tex))}</span>`;
        }
    }

    function typeset(container) {
        if (!container || !container.closest('#ai-assistant.active')) return Promise.resolve();
        const slots = [...container.querySelectorAll('[data-tutor-tex]:not([data-math-state])')];
        if (!slots.length) return Promise.resolve();
        slots.forEach(element => { element.dataset.mathState = 'loading'; });
        return library().then(engine => {
            const history = document.getElementById('tutor-messages');
            const top = history?.scrollTop || 0;
            const follow = history && history.scrollHeight - top - history.clientHeight < 72;
            for (const element of slots) {
                if (!element.isConnected) continue;
                element.innerHTML = formula(element.dataset.tutorTex, element.dataset.mathDisplay === 'true', engine);
                element.dataset.mathState = 'rendered';
                // Only exceptionally wide equations get their own keyboard-scrollable region.
                if (element.scrollWidth > element.clientWidth + 1) { element.tabIndex = 0; element.setAttribute('aria-label', 'Fórmula matemática, desplazamiento horizontal'); }
            }
            if (history?.isConnected) history.scrollTop = follow ? history.scrollHeight : top;
        }).catch(() => {
            for (const element of slots) {
                if (!element.isConnected) continue;
                element.textContent = readable(element.dataset.tutorTex);
                element.classList.add('tutor-math-fallback');
                delete element.dataset.mathState; // Safe retry on the next visit; no polling.
            }
        });
    }

    root.ACTutorMath = Object.freeze({ markdown, typeset, formula, normalizeTex, version });
})(typeof window !== 'undefined' ? window : globalThis);
