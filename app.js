console.log("APP.JS NUEVO AC EDUNITY CARGADO");
console.log("VERSIÓN GROQ ACTIVA");

/* ============================================
   AC Edunity - LÓGICA PRINCIPAL
   JavaScript puro - Funcionalidades SPA
   ============================================ */

// ============================================
// ESTADO GLOBAL
// ============================================

let currentUser = null;
let currentSection = 'dashboard';
let isDarkTheme = !localStorage.getItem('theme') || localStorage.getItem('theme') === 'dark';
let isTabletOrSmaller = window.innerWidth <= 768;
let calendarViewDate = new Date(2026, 5, 1);
let sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
const INTERFACE_SOUND_STORAGE_KEY = 'ac_interface_sounds_enabled';
const INTERFACE_SOUND_SRC = 'assets/click.mp3';
let interfaceSoundsEnabled = localStorage.getItem(INTERFACE_SOUND_STORAGE_KEY) !== 'false';
let interfaceSoundAudio = null;
let lastInterfaceSoundAt = 0;
let lastInterfaceErrorAt = 0;
const interfacePointerStart = new WeakMap();

// Datos simulados de usuarios. En el futuro esto puede conectarse con Supabase.
const defaultUsers = {
    'adrian@example.com': {
        password: 'password123',
        name: 'Adrian Maximiliano Chito Vargas'
    },
    'test@example.com': {
        password: 'test123',
        name: 'Usuario Prueba'
    }
};

function getUsers() {
    const storedUsers = localStorage.getItem('simulatedUsers');
    if (!storedUsers) return { ...defaultUsers };

    try {
        return { ...defaultUsers, ...JSON.parse(storedUsers) };
    } catch (error) {
        localStorage.removeItem('simulatedUsers');
        return { ...defaultUsers };
    }
}

function saveUsers(users) {
    localStorage.setItem('simulatedUsers', JSON.stringify(users));
}

function getPublicUser(email, userRecord = {}) {
    const { password, ...publicData } = userRecord;
    return { email, ...publicData };
}

// Mensajes visuales propios de AC Edunity. Evitan ventanas nativas del navegador.
let toastTimeout = null;

function notify(message, type = 'info') {
    if (type === 'error') {
        lastInterfaceErrorAt = performance.now();
    }

    let toast = document.getElementById('app-toast');

    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'app-toast';
        toast.className = 'app-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.className = `app-toast ${type} show`;

    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => {
        toast.classList.remove('show');
    }, 3200);
}

function showToast(message, type = 'info') {
    notify(message, type);
}

function initInterfaceSound() {
    if (interfaceSoundAudio) return interfaceSoundAudio;
    interfaceSoundAudio = new Audio(INTERFACE_SOUND_SRC);
    interfaceSoundAudio.preload = 'auto';
    interfaceSoundAudio.volume = 0.17;
    interfaceSoundAudio.load();
    return interfaceSoundAudio;
}

function updateInterfaceSoundControls() {
    document.querySelectorAll('[data-interface-sound-toggle]').forEach(input => {
        input.checked = interfaceSoundsEnabled;
        input.setAttribute('aria-checked', String(interfaceSoundsEnabled));
    });
    document.body.classList.toggle('interface-sounds-off', !interfaceSoundsEnabled);
}

function applyInterfaceSoundPreference(enabled, { persistLocal = true } = {}) {
    interfaceSoundsEnabled = enabled !== false;
    if (persistLocal) {
        localStorage.setItem(INTERFACE_SOUND_STORAGE_KEY, interfaceSoundsEnabled ? 'true' : 'false');
    }
    updateInterfaceSoundControls();
}

async function persistInterfaceSoundPreference(enabled) {
    try {
        const sb = getSupabaseClient();
        const { data, error } = await sb.auth.getUser();
        if (error || !data?.user) return;

        await sb.auth.updateUser({
            data: {
                ...(data.user.user_metadata || {}),
                interface_sounds_enabled: enabled
            }
        });
    } catch (error) {
        console.warn('[UI SOUND] No se pudo guardar la preferencia remota:', error);
    }
}

function loadInterfaceSoundPreferenceFromUser(user) {
    const remoteValue = user?.user_metadata?.interface_sounds_enabled;
    if (typeof remoteValue === 'boolean') {
        applyInterfaceSoundPreference(remoteValue);
        return;
    }
    applyInterfaceSoundPreference(localStorage.getItem(INTERFACE_SOUND_STORAGE_KEY) !== 'false', { persistLocal: false });
}

function playInterfaceSound() {
    if (!interfaceSoundsEnabled) return;

    const now = performance.now();
    if (now - lastInterfaceSoundAt < 180) return;
    if (now - lastInterfaceErrorAt < 140) return;

    const audio = initInterfaceSound();
    lastInterfaceSoundAt = now;
    audio.pause();
    audio.currentTime = 0;
    audio.volume = 0.17;
    const playPromise = audio.play();
    if (playPromise?.catch) {
        playPromise.catch(() => {});
    }
}

function animateInterfacePress(target) {
    if (!target || target.classList.contains('ui-press-feedback')) return;
    target.classList.add('ui-press-feedback');
    window.setTimeout(() => target.classList.remove('ui-press-feedback'), 170);
}

function isDisabledActionTarget(target) {
    return !!target?.closest?.('button:disabled, [aria-disabled="true"], .disabled, [disabled]');
}

function getInterfaceActionTarget(event) {
    const target = event.target?.closest?.('button, a, [role="button"], input[type="button"], input[type="submit"]');
    if (!target || isDisabledActionTarget(target)) return null;
    if (target.closest('.google-tools-sidebar')) return null;
    return target;
}

function shouldSkipInterfaceClickSound(event, target) {
    if (!target) return true;
    if (event.detail && event.detail > 1) return true;

    const startedAt = interfacePointerStart.get(target);
    if (startedAt && performance.now() - startedAt > 650) return true;

    const form = target.closest('form');
    if (form && !form.checkValidity()) return true;
    if (form && form.closest('#login-page, #register-page, .password-modal')) return true;
    if (target.type === 'submit') return true;

    return false;
}

function bindInterfaceSoundEvents() {
    if (document.body.dataset.interfaceSoundsBound === 'true') return;
    document.body.dataset.interfaceSoundsBound = 'true';

    document.addEventListener('pointerdown', event => {
        const target = getInterfaceActionTarget(event);
        if (target) interfacePointerStart.set(target, performance.now());
    }, { passive: true });

    document.addEventListener('click', event => {
        const target = getInterfaceActionTarget(event);
        if (shouldSkipInterfaceClickSound(event, target)) return;
        if (performance.now() - lastInterfaceErrorAt < 140) return;
        animateInterfacePress(target);
        playInterfaceSound();
    });

    document.addEventListener('submit', event => {
        const form = event.target;
        if (!form || !form.checkValidity()) return;
        if (form.closest('#login-page, #register-page, .password-modal')) return;
        window.setTimeout(() => {
            if (performance.now() - lastInterfaceErrorAt < 220) return;
            playInterfaceSound();
        }, 0);
    }, true);
}

function toggleInterfaceSounds(enabled) {
    applyInterfaceSoundPreference(Boolean(enabled));
    persistInterfaceSoundPreference(interfaceSoundsEnabled);
    if (interfaceSoundsEnabled) {
        playInterfaceSound();
        notify('Sonidos de interfaz activados.', 'success');
    } else {
        notify('Sonidos de interfaz desactivados.', 'info');
    }
}

function setAuthMessage(pageId, message, type = 'error', action = null) {
    const page = document.getElementById(`${pageId}-page`);
    const card = page ? page.querySelector('.auth-card') : null;
    if (!card) {
        notify(message, type);
        return;
    }

    let messageBox = card.querySelector('.auth-message');
    if (!messageBox) {
        messageBox = document.createElement('div');
        messageBox.className = 'auth-message';
        messageBox.setAttribute('role', 'status');
        card.appendChild(messageBox);
    }

    messageBox.textContent = message;
    messageBox.className = `auth-message ${type}`;

    if (action?.label && typeof action.onClick === 'function') {
        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.className = 'btn-secondary btn-small';
        actionButton.textContent = action.label;
        actionButton.addEventListener('click', action.onClick);
        messageBox.appendChild(document.createElement('br'));
        messageBox.appendChild(actionButton);
    }
}

function clearAuthMessages() {
    document.querySelectorAll('.auth-message').forEach(message => message.remove());
}

function translateSupabaseError(message = '') {
    const text = String(message || '').toLowerCase();

    if (text.includes('user already registered') || text.includes('already registered') || text.includes('already exists') || text.includes('email exists')) {
        return 'Este correo ya está registrado. Inicia sesión o usa otro correo.';
    }

    if (text.includes('rate limit') || text.includes('too many requests') || text.includes('over_email_send_rate_limit') || text.includes('email rate limit') || text.includes('for security purposes')) {
        return 'Se alcanzó el límite de intentos. Espera unos minutos e intenta otra vez.';
    }

    if (text.includes('invalid login credentials') || text.includes('invalid credentials') || text.includes('invalid email or password')) {
        return 'Correo o contraseña incorrectos.';
    }

    if (text.includes('email not confirmed') || text.includes('not confirmed')) {
        return 'Debes confirmar tu correo antes de iniciar sesión.';
    }

    if (text.includes('password should be at least') || text.includes('weak password')) {
        return 'La contraseña es muy corta o débil. Usa una contraseña más segura.';
    }

    if (text.includes('invalid email')) {
        return 'Escribe un correo válido.';
    }

    if (text.includes('failed to fetch') || text.includes('network') || text.includes('fetch')) {
        return 'No se pudo conectar con Supabase. Revisa tu conexión e intenta otra vez.';
    }

    return 'No se pudo completar la acción. Revisa los datos e intenta otra vez.';
}

function isAlreadyRegisteredError(message = '') {
    return translateSupabaseError(message) === 'Este correo ya está registrado. Inicia sesión o usa otro correo.';
}

function showLoginWithEmail(email = '') {
    showLogin();
    const loginEmail = document.getElementById('login-email');
    if (loginEmail) {
        loginEmail.value = email;
        const password = document.getElementById('login-password');
        if (password) password.focus();
    }
}

function bindAuthForms() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const logoutBtn = document.getElementById('logoutBtn');

    if (loginForm && !loginForm.dataset.supabaseBound) {
        loginForm.dataset.supabaseBound = 'true';
        loginForm.addEventListener('submit', handleLogin);
    }

    if (registerForm && !registerForm.dataset.supabaseBound) {
        registerForm.dataset.supabaseBound = 'true';
        registerForm.addEventListener('submit', handleRegister);
    }

    if (logoutBtn && !logoutBtn.dataset.supabaseBound) {
        logoutBtn.dataset.supabaseBound = 'true';
        logoutBtn.addEventListener('click', handleLogout);
    }
}

function openQuickForm(config) {
    const existingModal = document.querySelector('.quick-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.className = 'quick-modal';
    modal.innerHTML = `
        <div class="quick-modal-card" role="dialog" aria-modal="true" aria-label="${escapeHTML(config.title)}">
            <button class="quick-modal-close" type="button" aria-label="Cerrar">x</button>
            <h3>${escapeHTML(config.title)}</h3>
            <form class="quick-modal-form">
                ${config.fields.map(field => `
                    <label>
                        <span>${escapeHTML(field.label)}</span>
                        ${renderQuickField(field)}
                    </label>
                `).join('')}
                <div class="quick-modal-actions">
                    <button class="btn-primary btn-small" type="submit">${escapeHTML(config.submitLabel || 'Guardar')}</button>
                </div>
            </form>
        </div>
    `;

    const closeModal = () => modal.remove();
    modal.addEventListener('click', event => {
        if (event.target === modal || event.target.classList.contains('quick-modal-close')) {
            closeModal();
        }
    });

    modal.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const values = Object.fromEntries(formData.entries());
        closeModal();
        config.onSubmit(values);
    });

    document.body.appendChild(modal);
    const firstInput = modal.querySelector('input, textarea, select');
    if (firstInput) firstInput.focus();
}

function renderQuickField(field) {
    if (field.type === 'textarea') {
        return `
            <textarea
                name="${escapeHTML(field.name)}"
                placeholder="${escapeHTML(field.placeholder || '')}"
                rows="${field.rows || 4}"
                ${field.required === false ? '' : 'required'}
            >${escapeHTML(field.value || '')}</textarea>
        `;
    }

    if (field.type === 'select') {
        const options = (field.options || []).map(option => {
            const value = getOptionValue(option);
            const label = getOptionLabel(option);
            const selected = String(field.value || '') === String(value) ? 'selected' : '';
            return `<option value="${escapeHTML(value)}" ${selected}>${escapeHTML(label)}</option>`;
        }).join('');

        return `<select name="${escapeHTML(field.name)}" ${field.required === false ? '' : 'required'}>${options}</select>`;
    }

    if (field.type === 'choice-grid') {
        const options = (field.options || []).map((option, index) => {
            const value = getOptionValue(option);
            const label = getOptionLabel(option);
            const tone = typeof option === 'string' ? '' : option.tone || '';
            const iconClass = typeof option === 'string' ? '' : option.iconClass || '';
            const checked = String(field.value || '') === String(value) || (!field.value && index === 0) ? 'checked' : '';
            return `
                <label class="choice-pill ${escapeHTML(iconClass)}" style="${tone ? `--choice-color:${escapeHTML(tone)}` : ''}">
                    <input type="radio" name="${escapeHTML(field.name)}" value="${escapeHTML(value)}" ${checked} ${field.required === false ? '' : 'required'}>
                    <span class="choice-dot" aria-hidden="true"></span>
                    <strong>${escapeHTML(label)}</strong>
                </label>
            `;
        }).join('');

        return `<div class="choice-grid">${options}</div>`;
    }

    if (field.type === 'checkbox') {
        return `
            <span class="quick-check">
                <input type="checkbox" name="${escapeHTML(field.name)}" value="yes" ${field.checked ? 'checked' : ''}>
                <span>${escapeHTML(field.help || 'Activar')}</span>
            </span>
        `;
    }

    if (field.type === 'file') {
        return `
            <input
                type="file"
                name="${escapeHTML(field.name)}"
                accept="${escapeHTML(field.accept || '')}"
                ${field.required === false ? '' : 'required'}
            >
        `;
    }

    return `
        <input
            type="${field.type || 'text'}"
            name="${escapeHTML(field.name)}"
            value="${escapeHTML(field.value || '')}"
            placeholder="${escapeHTML(field.placeholder || '')}"
            ${field.required === false ? '' : 'required'}
        >
    `;
}

// ============================================
// INICIALIZACION LEGACY (reemplazada por Supabase al final del archivo)
// ============================================

function legacyInitializeAppLocal() {
    // Cargar tema guardado
    if (isDarkTheme) {
        document.body.classList.remove('light-theme');
        updateThemeIcon('theme');
    } else {
        document.body.classList.add('light-theme');
        updateThemeIcon('theme');
    }

    // Al abrir el link publico siempre se muestra primero el menu principal.
    currentUser = null;
    localStorage.removeItem('currentUser');
    showLanding();

    // Event listeners para responsive
    window.addEventListener('resize', handleWindowResize);

    // Generar calendario
    generateCalendar();
    renderSavedSubjects();
    renderSavedCalendarEvents();
    initStudyPet();
    initLandingReveal();
    initLandingWheelControl();
}

function initLandingReveal() {
    const revealItems = document.querySelectorAll(
        '#landing-page .reveal, #landing-page .reveal-left, #landing-page .reveal-right, #landing-page .reveal-scale'
    );

    if (!revealItems.length) return;

    const updateRevealItems = () => {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 720;
        revealItems.forEach(item => {
            const rect = item.getBoundingClientRect();
            const isVisible = rect.top < viewportHeight * 0.92 && rect.bottom > viewportHeight * -0.08;
            item.classList.toggle('active', isVisible);
        });
    };

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
        revealItems.forEach(item => item.classList.add('active'));
        return;
    }

    const revealObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            entry.target.classList.toggle('active', entry.isIntersecting);
        });
    }, {
        threshold: 0.01,
        rootMargin: '120px 0px 120px 0px'
    });

    revealItems.forEach(item => revealObserver.observe(item));
    updateRevealItems();

    const safeRevealResize = () => window.requestAnimationFrame(updateRevealItems);

    window.addEventListener('resize', safeRevealResize, { passive: true });
    window.setTimeout(() => {
        if (document.body.classList.contains('is-landing')) updateRevealItems();
    }, 700);
    window.setTimeout(() => {
        if (document.body.classList.contains('is-landing')) {
            revealItems.forEach(item => item.classList.add('active'));
        }
    }, 1800);
}

function resetLandingReveal() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const revealItems = document.querySelectorAll(
        '#landing-page .reveal, #landing-page .reveal-left, #landing-page .reveal-right, #landing-page .reveal-scale'
    );

    revealItems.forEach(item => item.classList.remove('active'));

    window.requestAnimationFrame(() => {
        revealItems.forEach(item => {
            const rect = item.getBoundingClientRect();
            const visible = rect.top < window.innerHeight * 0.84 && rect.bottom > 0;
            item.classList.toggle('active', visible);
        });
    });
}

function initLandingWheelControl() {
    // Mantener el scroll nativo evita bloqueos de rueda/touchpad en navegadores
    // del colegio y moviles; las animaciones reveal se controlan por scroll pasivo.
}

function findScrollProblems() {
    const scrollContainers = [...document.querySelectorAll('*')]
        .filter((el) => {
            const style = getComputedStyle(el);
            return (
                el.scrollHeight > el.clientHeight &&
                ['auto', 'scroll'].includes(style.overflowY)
            );
        })
        .map((el) => ({
            tag: el.tagName,
            id: el.id,
            className: el.className,
            overflowY: getComputedStyle(el).overflowY,
            height: getComputedStyle(el).height,
            maxHeight: getComputedStyle(el).maxHeight,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight
        }));

    console.table(scrollContainers);
    return scrollContainers;
}

window.findScrollProblems = findScrollProblems;
window.findScrollContainers = findScrollProblems;

// ============================================
// NAVEGACION DE PAGINAS
// ============================================

function showPage(pageId) {
    const selectedPage = document.getElementById(pageId);
    if (!selectedPage) return;

    // Ocultar todas las paginas
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });

    // Mostrar página seleccionada
    selectedPage.classList.add('active');
    const isLanding = pageId === 'landing-page';
    const isDashboard = pageId === 'app-page';
    document.documentElement.classList.toggle('landing-mode', isLanding);
    document.documentElement.classList.toggle('is-landing', isLanding);
    document.documentElement.classList.toggle('is-dashboard', isDashboard);
    document.body.classList.toggle('landing-mode', isLanding);
    document.body.classList.toggle('is-landing', isLanding);
    document.body.classList.toggle('is-dashboard', isDashboard);
    document.body.classList.toggle('landing-active', isLanding);
    document.body.classList.toggle('student-active', isDashboard);
    window.scrollTo(0, 0);

    // Si es la app, mostrar la seccion por defecto
    if (pageId === 'app-page' && !currentUser) {
        showLanding();
    }

    if (pageId === 'app-page') {
        applySidebarCollapsedState();
    }

    if (isLanding && window.location.search.includes('debugScroll=1')) {
        window.requestAnimationFrame(() => findScrollProblems());
    }
}

function finishBooting() {
    document.body.classList.remove('app-booting');
    document.documentElement.classList.remove('app-booting');
    const bootLoader = document.getElementById('app-boot-loader');
    if (bootLoader) {
        bootLoader.setAttribute('aria-hidden', 'true');
    }
}

function legacyShowLandingLocal() {
    currentUser = null;
    localStorage.removeItem('currentUser');
    showPage('landing-page');
    resetLandingReveal();
}

async function showLogin() {
    clearAuthMessages();
    try {
        const sb = getSupabaseClient();
        const { data: sessionData } = await sb.auth.getSession();
        const authUser = sessionData?.session?.user;
        if (authUser) {
            console.log("[APP] Sesión activa encontrada desde Iniciar sesión");
            currentUser = getPublicUserFromAuth(authUser);
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            await bootstrapAuthenticatedApp(authUser);
            showDashboard(getStoredAppView());
            return;
        }
    } catch (error) {
        console.warn('[APP] No se pudo comprobar la sesión activa antes del login:', error);
    }
    showPage('login-page');
}

function showRegister() {
    clearAuthMessages();
    showPage('register-page');
}

function startPrototype() {
    showRegister();
}

function legacyShowAppLocal() {
    showPage('app-page');
    updateDashboardGreeting();
    navigateTo('dashboard');
}

function updateDashboardGreeting() {
    const dashboardTitle = document.querySelector('#dashboard .section-header h1');
    if (dashboardTitle) {
        const firstName = currentUser?.name ? currentUser.name.split(' ')[0] : 'Adrian';
        dashboardTitle.textContent = `Hola ${firstName}`;
    }

    updateProfileInfo();
}

function updateProfileInfo() {
    const profileName = document.getElementById('profile-name');
    const profileAvatar = document.querySelector('.profile-avatar');

    if (profileName && currentUser?.name) {
        profileName.textContent = currentUser.name;
    }

    if (profileAvatar && currentUser?.name) {
        const initials = currentUser.name
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map(part => part[0].toUpperCase())
            .join('');
        profileAvatar.textContent = initials || 'AC';
    }
}

// ============================================
// AUTENTICACIÓN LEGACY LOCAL (no usada con Supabase)
// ============================================

function legacyHandleLoginLocal(event) {
    event.preventDefault();
    clearAuthMessages();

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value.trim();

    const users = getUsers();

    // Validar contra usuarios simulados
    if (users[email] && users[email].password === password) {
        currentUser = {
            email: email,
            name: users[email].name
        };

        localStorage.setItem('currentUser', JSON.stringify(currentUser));

        // Limpiar formulario
        document.getElementById('login-email').value = '';
        document.getElementById('login-password').value = '';

        showApp();
        notify('Sesión iniciada correctamente.', 'success');
        playInterfaceSound();
    } else {
        setAuthMessage('login', 'Correo o contraseña incorrectos. Revisa tus datos o crea una cuenta nueva.', 'error');
    }
}

function legacyHandleRegisterLocal(event) {
    event.preventDefault();
    clearAuthMessages();

    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value.trim();

    if (!name || !email || !password) {
        setAuthMessage('register', 'Completa nombre, correo y contraseña para crear tu cuenta.', 'error');
        return;
    }

    const users = getUsers();

    // Simular registro persistente en localStorage
    users[email] = {
        password: password,
        name: name
    };
    saveUsers(users);

    currentUser = {
        email: email,
        name: name
    };

    localStorage.setItem('currentUser', JSON.stringify(currentUser));

    // Limpiar formulario
    document.getElementById('register-name').value = '';
    document.getElementById('register-email').value = '';
    document.getElementById('register-password').value = '';

    showApp();
    notify('Cuenta creada correctamente. Ya puedes personalizar AC Edunity.', 'success');
}

function legacyHandleLogoutLocal() {
    currentUser = null;
    localStorage.removeItem('currentUser');
    showLanding();
    notify('Sesión cerrada.', 'info');
}

// ============================================
// NAVEGACION SPA
// ============================================

function navigateTo(sectionId, evt) {
    if (evt && evt.preventDefault) evt.preventDefault();

    // Remover clase active de secciones
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });

    // Remover clase active de nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    // Agregar clase active a la sección seleccionada
    const section = document.getElementById(sectionId);
    if (section) {
        section.classList.add('active');
    } else {
        navigateTo('dashboard');
        return;
    }

    // Agregar clase active al nav item correspondiente
    const navItem = document.querySelector(`[data-section="${sectionId}"]`);
    if (navItem) {
        navItem.classList.add('active');
    }

    currentSection = sectionId;
    rememberAppView(sectionId);

    // Scroll al top en mobile
    if (isTabletOrSmaller) {
        document.querySelector('.main-content').scrollTop = 0;
        closeSidebar();
    }
}

// ============================================
// MODO CLARO/OSCURO
// ============================================

function toggleTheme() {
    isDarkTheme = !isDarkTheme;

    if (isDarkTheme) {
        document.body.classList.remove('light-theme');
        localStorage.setItem('theme', 'dark');
        updateThemeIcon('theme');
    } else {
        document.body.classList.add('light-theme');
        localStorage.setItem('theme', 'light');
        updateThemeIcon('theme');
    }
}

function updateThemeIcon(icon) {
    const sunIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>';
    const moonIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A7.5 7.5 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"></path></svg>';
    document.querySelectorAll('.theme-toggle').forEach(btn => {
        btn.innerHTML = isDarkTheme ? moonIcon : sunIcon;
        btn.setAttribute('aria-label', isDarkTheme ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
        btn.classList.toggle('is-light', !isDarkTheme);
    });
}

// ============================================
// SIDEBAR RESPONSIVE
// ============================================

let sidebarOpen = false;

function applySidebarCollapsedState() {
    const appPage = document.getElementById('app-page');
    const control = document.querySelector('.app-sidebar-control');
    if (!appPage) return;

    const effectiveCollapsed = !isTabletOrSmaller && sidebarCollapsed;
    appPage.classList.toggle('sidebar-collapsed', effectiveCollapsed);
    if (control) {
        const label = isTabletOrSmaller
            ? (sidebarOpen ? 'Cerrar barra lateral' : 'Abrir barra lateral')
            : (effectiveCollapsed ? 'Abrir barra lateral' : 'Cerrar barra lateral');
        control.setAttribute('title', label);
        control.setAttribute('aria-label', label);
    }
}

function toggleSidebarCollapse() {
    if (isTabletOrSmaller) {
        toggleSidebar();
        return;
    }

    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed));
    applySidebarCollapsedState();
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    sidebarOpen = !sidebarOpen;

    if (sidebarOpen) {
        sidebar.classList.add('open');
    } else {
        sidebar.classList.remove('open');
    }
    applySidebarCollapsedState();
}

function closeSidebar() {
    const sidebar = document.querySelector('.sidebar');
    sidebar.classList.remove('open');
    sidebarOpen = false;
    applySidebarCollapsedState();
}

function handleWindowResize() {
    isTabletOrSmaller = window.innerWidth <= 768;
    if (window.innerWidth > 768) {
        closeSidebar();
    }
    applySidebarCollapsedState();
}

// ============================================
// TAREAS
// ============================================

function toggleTask(checkbox) {
    const taskItem = checkbox.closest('.task-item');
    if (checkbox.checked) {
        taskItem.setAttribute('data-status', 'completed');
    } else {
        taskItem.setAttribute('data-status', 'pending');
    }
}

function filterTasks(filter, button) {
    // Actualizar boton activo
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    if (button) {
        button.classList.add('active');
    }

    // Filtrar tareas
    const tasks = document.querySelectorAll('.task-item');
    tasks.forEach(task => {
        const status = task.getAttribute('data-status');
        if (filter === 'all') {
            task.style.display = 'flex';
        } else if (filter === status) {
            task.style.display = 'flex';
        } else {
            task.style.display = 'none';
        }
    });
}

function addTaskUI() {
    openQuickForm({
        title: 'Nueva tarea',
        submitLabel: 'Crear tarea',
        fields: [
            { name: 'topic', label: 'Tarea', placeholder: 'Ej: Resolver ejercicios' },
            { name: 'subject', label: 'Materia', placeholder: 'Ej: Matemática' }
        ],
        onSubmit: values => createTask(values.topic, values.subject)
    });
}

function createTask(topic, subject) {
    if (!topic || !subject) {
        notify('Completa la tarea y la materia.', 'error');
        return;
    }

    const tasksList = document.getElementById('tasks-list');

    const newTask = document.createElement('div');
    newTask.className = 'task-item';
    newTask.setAttribute('data-status', 'pending');
    newTask.innerHTML = `
        <div class="task-checkbox">
            <input type="checkbox" onclick="toggleTask(this)">
        </div>
        <div class="task-content">
            <h4>${escapeHTML(topic)}</h4>
            <p class="task-subject">Materia: ${escapeHTML(subject)}</p>
            <p class="task-date">Vence: Proximamente</p>
        </div>
        <div class="task-priority medium">Media</div>
    `;

    tasksList.appendChild(newTask);
    notify('Tarea agregada correctamente.', 'success');
}

// ============================================
// MATERIAS PERSONALIZADAS
// ============================================

function getSavedSubjects() {
    try {
        return JSON.parse(localStorage.getItem('customSubjects')) || [];
    } catch (error) {
        localStorage.removeItem('customSubjects');
        return [];
    }
}

function saveSubjects(subjects) {
    localStorage.setItem('customSubjects', JSON.stringify(subjects));
}

function addSubjectUI() {
    openQuickForm({
        title: 'Nueva materia',
        submitLabel: 'Crear materia',
        fields: [
            { name: 'name', label: 'Nombre de la materia', placeholder: 'Ej: Matemática' },
            { name: 'tasks', label: 'Tareas pendientes', type: 'number', value: '0' }
        ],
        onSubmit: values => {
            const subject = {
                name: values.name.trim(),
                tasks: values.tasks.trim() || '0',
                progress: 0,
                color: 'custom'
            };

            const subjects = getSavedSubjects();
            subjects.push(subject);
            saveSubjects(subjects);
            renderSubjectCard(subject);
            updateSubjectCounter();
            notify(`Materia "${subject.name}" creada correctamente.`, 'success');
        }
    });
}

function renderSavedSubjects() {
    getSavedSubjects().forEach(renderSubjectCard);
    updateSubjectCounter();
}

function renderSubjectCard(subject) {
    const grid = document.querySelector('.subjects-grid');
    if (!grid) return;

    const card = document.createElement('div');
    card.className = 'subject-card subject-custom';
    card.innerHTML = `
        <div class="subject-header">
            <h3>${escapeHTML(subject.name)}</h3>
            <span class="subject-icon"></span>
        </div>
        <div class="subject-stats">
            <div class="stat">
                <span class="stat-name">Promedio</span>
                <span class="stat-num">--</span>
            </div>
            <div class="stat">
                <span class="stat-name">Tareas</span>
                <span class="stat-num">${escapeHTML(subject.tasks)}</span>
            </div>
            <div class="stat">
                <span class="stat-name">Progreso</span>
                <span class="stat-num">${subject.progress}%</span>
            </div>
        </div>
        <div class="progress-bar">
            <div class="progress-fill" style="width: ${subject.progress}%; background: linear-gradient(90deg, #7c3aed, #06b6d4)"></div>
        </div>
        <p class="last-activity">Ultima actividad: creada por el estudiante</p>
        <button class="btn-secondary btn-small" type="button">Acceder</button>
    `;

    const accessButton = card.querySelector('button');
    if (accessButton) {
        accessButton.addEventListener('click', () => openSubject(subject.name));
    }

    grid.appendChild(card);
}

function updateSubjectCounter() {
    const totalSubjects = 4 + getSavedSubjects().length;
    const cards = document.querySelectorAll('.stat-card');

    cards.forEach(card => {
        const label = card.querySelector('.stat-label');
        if (label && label.textContent.includes('Materias Activas')) {
            const value = card.querySelector('.stat-value');
            const subtext = card.querySelector('.stat-subtext');
            if (value) value.textContent = totalSubjects;
            if (subtext) subtext.textContent = 'Materias creadas y activas en tu cuenta';
        }
    });
}

function escapeHTML(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function polishSpanishText(value) {
    let text = String(value || '');
    const replacements = [
        [/\bcontrasena\b/g, 'contrase\u00f1a'],
        [/\bContrasena\b/g, 'Contrase\u00f1a'],
        [/\bsesion\b/g, 'sesi\u00f3n'],
        [/\bSesion\b/g, 'Sesi\u00f3n'],
        [/\bacademico\b/g, 'acad\u00e9mico'],
        [/\bacademica\b/g, 'acad\u00e9mica'],
        [/\bacademicas\b/g, 'acad\u00e9micas'],
        [/\bdescripcion\b/g, 'descripci\u00f3n'],
        [/\bDescripcion\b/g, 'Descripci\u00f3n'],
        [/\binformacion\b/g, 'informaci\u00f3n'],
        [/\bInformacion\b/g, 'Informaci\u00f3n'],
        [/\bdefinicion\b/g, 'definici\u00f3n'],
        [/\bDefinicion\b/g, 'Definici\u00f3n'],
        [/\bcaracteristicas\b/g, 'caracter\u00edsticas'],
        [/\bCaracteristicas\b/g, 'Caracter\u00edsticas'],
        [/\bformula\b/g, 'f\u00f3rmula'],
        [/\bFormula\b/g, 'F\u00f3rmula'],
        [/\bpractica\b/g, 'pr\u00e1ctica'],
        [/\bPractica\b/g, 'Pr\u00e1ctica'],
        [/\bteoria\b/g, 'teor\u00eda'],
        [/\bTeoria\b/g, 'Teor\u00eda'],
        [/\bMatematica\b/g, 'Matem\u00e1tica'],
        [/\bmatematica\b/g, 'matem\u00e1tica'],
        [/\bFisica\b/g, 'F\u00edsica'],
        [/\bfisica\b/g, 'f\u00edsica'],
        [/\bProgramacion\b/g, 'Programaci\u00f3n'],
        [/\bprogramacion\b/g, 'programaci\u00f3n'],
        [/\bQuimica\b/g, 'Qu\u00edmica'],
        [/\bquimica\b/g, 'qu\u00edmica'],
        [/\btermica\b/g, 't\u00e9rmica'],
        [/\benergia\b/g, 'energ\u00eda'],
        [/\bEnergia\b/g, 'Energ\u00eda'],
        [/\blimites\b/g, 'l\u00edmites'],
        [/\bLimites\b/g, 'L\u00edmites'],
        [/\blimite\b/g, 'l\u00edmite'],
        [/\bLimite\b/g, 'L\u00edmite'],
        [/\binteres\b/g, 'inter\u00e9s'],
        [/\bInteres\b/g, 'Inter\u00e9s'],
        [/\bdias\b/g, 'd\u00edas'],
        [/\bdia\b/g, 'd\u00eda'],
        [/\banos\b/g, 'a\u00f1os'],
        [/\bano\b/g, 'a\u00f1o'],
        [/\bdespues\b/g, 'despu\u00e9s'],
        [/\bTambien\b/g, 'Tambi\u00e9n'],
        [/\btambien\b/g, 'tambi\u00e9n'],
        [/\bpodra\b/g, 'podr\u00e1'],
        [/\bAqui\b/g, 'Aqu\u00ed'],
        [/\baqui\b/g, 'aqu\u00ed'],
        [/\bmas\b/g, 'm\u00e1s'],
        [/\brapido\b/g, 'r\u00e1pido'],
        [/\brapida\b/g, 'r\u00e1pida'],
        [/\bbasico\b/g, 'b\u00e1sico'],
        [/\bbasicos\b/g, 'b\u00e1sicos'],
        [/\butil\b/g, '\u00fatil'],
        [/\butiles\b/g, '\u00fatiles'],
        [/\bcompanero\b/g, 'compa\u00f1ero'],
        [/\bcompanera\b/g, 'compa\u00f1era'],
        [/\bexplicacion\b/g, 'explicaci\u00f3n'],
        [/\bExplicacion\b/g, 'Explicaci\u00f3n'],
        [/\bconclusion\b/g, 'conclusi\u00f3n'],
        [/\bConclusion\b/g, 'Conclusi\u00f3n'],
        [/\bsituacion\b/g, 'situaci\u00f3n'],
        [/\bsituaciones\b/g, 'situaciones'],
        [/\boperacion\b/g, 'operaci\u00f3n'],
        [/\bnumeros\b/g, 'n\u00fameros'],
        [/\bnumero\b/g, 'n\u00famero'],
        [/\bgraficas\b/g, 'gr\u00e1ficas'],
        [/\bgrafica\b/g, 'gr\u00e1fica'],
        [/\bcalculo\b/g, 'c\u00e1lculo'],
        [/\bcredito\b/g, 'cr\u00e9dito'],
        [/\bprestamos\b/g, 'pr\u00e9stamos'],
        [/\bdolares\b/g, 'd\u00f3lares'],
        [/\binversion\b/g, 'inversi\u00f3n'],
        [/\binformatica\b/g, 'inform\u00e1tica'],
        [/\bmatematico\b/g, 'matem\u00e1tico'],
        [/\bfenomeno\b/g, 'fen\u00f3meno'],
        [/\bfenomenos\b/g, 'fen\u00f3menos'],
        [/\baplicacion\b/g, 'aplicaci\u00f3n'],
        [/\brelacion\b/g, 'relaci\u00f3n'],
        [/\bvalido\b/g, 'v\u00e1lido'],
        [/\bvalida\b/g, 'v\u00e1lida'],
        [/\bpagina\b/g, 'p\u00e1gina'],
        [/\bpaginas\b/g, 'p\u00e1ginas'],
        [/\bproxima\b/g, 'pr\u00f3xima'],
        [/\bProxima\b/g, 'Pr\u00f3xima'],
        [/\bproximas\b/g, 'pr\u00f3ximas'],
        [/\bProximas\b/g, 'Pr\u00f3ximas'],
        [/\bcomun\b/g, 'com\u00fan'],
        [/\bdificil\b/g, 'dif\u00edcil'],
        [/\bfacil\b/g, 'f\u00e1cil'],
        [/\bpodrias\b/g, 'podr\u00edas'],
        [/\bguardarias\b/g, 'guardar\u00edas'],
        [/\breconocerias\b/g, 'reconocer\u00edas'],
        [/\bexplicarias\b/g, 'explicar\u00edas'],
        [/\busarias\b/g, 'usar\u00edas'],
        [/\btendrias\b/g, 'tendr\u00edas'],
        [/\bsera\b/g, 'ser\u00e1'],
        [/\btendra\b/g, 'tendr\u00e1'],
        [/\boptica\b/g, '\u00f3ptica'],
        [/\bmecanica\b/g, 'mec\u00e1nica'],
        [/\bparticulas\b/g, 'part\u00edculas'],
        [/\bdilatacion\b/g, 'dilataci\u00f3n'],
        [/\bque tema\b/g, 'qu\u00e9 tema'],
        [/\bque quieres\b/g, 'qu\u00e9 quieres'],
        [/\bQue es\b/g, 'Qu\u00e9 es'],
        [/\bQue son\b/g, 'Qu\u00e9 son'],
        [/\bQue significa\b/g, 'Qu\u00e9 significa'],
        [/\bQue debo\b/g, 'Qu\u00e9 debo'],
        [/\bQue dato\b/g, 'Qu\u00e9 dato'],
        [/\bQue ejemplo\b/g, 'Qu\u00e9 ejemplo'],
        [/\bQue duda\b/g, 'Qu\u00e9 duda'],
        [/\bQue conceptos\b/g, 'Qu\u00e9 conceptos'],
        [/\bQue parte\b/g, 'Qu\u00e9 parte'],
        [/\bQue forma\b/g, 'Qu\u00e9 forma'],
        [/\bComo se\b/g, 'C\u00f3mo se'],
        [/\bComo lo\b/g, 'C\u00f3mo lo'],
        [/\bComo funciona\b/g, 'C\u00f3mo funciona'],
        [/\bCual es\b/g, 'Cu\u00e1l es'],
        [/\bCuanto\b/g, 'Cu\u00e1nto'],
        [/\bCuales son\b/g, 'Cu\u00e1les son'],
        [/\bPor que\b/g, 'Por qu\u00e9'],
        [/\bPara que\b/g, 'Para qu\u00e9'],
        [/\bpara que\b/g, 'para qu\u00e9'],
        [/\bEn que\b/g, 'En qu\u00e9'],
        [/\ben que\b/g, 'en qu\u00e9']
    ];
    replacements.forEach(([pattern, replacement]) => {
        text = text.replace(pattern, replacement);
    });
    return text;
}

function appIconSvg(name) {
    const icons = {
        book: '<svg viewBox="0 0 24 24"><path d="M5 5.5A3.5 3.5 0 0 1 8.5 2H20v17H8.5A3.5 3.5 0 0 0 5 22V5.5Z"></path><path d="M5 5.5A3.5 3.5 0 0 1 8.5 9H20"></path><path d="M9 5h6"></path></svg>',
        check: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"></rect><path d="m8 12 3 3 5-6"></path></svg>',
        calendar: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="3"></rect><path d="M8 3v4"></path><path d="M16 3v4"></path><path d="M4 10h16"></path><path d="M8 14h3"></path><path d="M14 14h2"></path></svg>',
        chart: '<svg viewBox="0 0 24 24"><path d="M4 19h16"></path><path d="M7 16V9"></path><path d="M12 16V5"></path><path d="M17 16v-4"></path><path d="M6 9h2"></path><path d="M11 5h2"></path><path d="M16 12h2"></path></svg>',
        trend: '<svg viewBox="0 0 24 24"><path d="M4 18 10 12l4 4 6-8"></path><path d="M14 8h6v6"></path><path d="M4 21h16"></path></svg>',
        bot: '<svg viewBox="0 0 24 24"><rect x="5" y="7" width="14" height="11" rx="4"></rect><path d="M12 7V4"></path><circle cx="9" cy="12" r="1"></circle><circle cx="15" cy="12" r="1"></circle><path d="M9.5 15h5"></path><path d="M3 11v3"></path><path d="M21 11v3"></path></svg>',
        folder: '<svg viewBox="0 0 24 24"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z"></path><path d="M4 10h16"></path></svg>',
        file: '<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7V3Z"></path><path d="M14 3v5h5"></path><path d="M9 13h6"></path><path d="M9 17h4"></path></svg>',
        list: '<svg viewBox="0 0 24 24"><path d="M8 6h12"></path><path d="M8 12h12"></path><path d="M8 18h12"></path><path d="M4 6h.01"></path><path d="M4 12h.01"></path><path d="M4 18h.01"></path></svg>',
        clock: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="3"></rect><path d="M8 3v4"></path><path d="M16 3v4"></path><path d="M4 10h16"></path><circle cx="12" cy="15" r="3"></circle><path d="M12 13.5V15l1.2.8"></path></svg>',
        user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"></circle><path d="M5 20a7 7 0 0 1 14 0"></path></svg>',
        flask: '<svg viewBox="0 0 24 24"><path d="M9 3h6"></path><path d="M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"></path><path d="M8 15h8"></path></svg>',
        code: '<svg viewBox="0 0 24 24"><path d="m8 9-4 3 4 3"></path><path d="m16 9 4 3-4 3"></path><path d="m14 5-4 14"></path></svg>',
        globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3a14 14 0 0 1 0 18"></path><path d="M12 3a14 14 0 0 0 0 18"></path></svg>',
        palette: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 1.4-3.4 1.8 1.8 0 0 1 1.2-3.1H18a6 6 0 0 0 0-12h-6Z"></path><circle cx="7.5" cy="10" r=".7"></circle><circle cx="10" cy="7.5" r=".7"></circle><circle cx="14" cy="7.5" r=".7"></circle></svg>'
    };
    return icons[name] || icons.book;
}

function appIconHTML(name, className = 'app-icon') {
    return `<span class="${className}" aria-hidden="true">${appIconSvg(name)}</span>`;
}

function achievementIconSvg(name) {
    const icons = {
        subject: '<svg viewBox="0 0 24 24"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v16H7.5A2.5 2.5 0 0 0 5 21V5.5Z"></path><path d="M5 5.5A2.5 2.5 0 0 1 7.5 8H19"></path><path d="M9 12h6"></path></svg>',
        task: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"></rect><path d="m8 12 3 3 5-6"></path></svg>',
        done: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="m8 12.5 2.7 2.7L16 9.5"></path></svg>',
        note: '<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7V3Z"></path><path d="M14 3v5h5"></path><path d="M9 13h6"></path><path d="M9 17h4"></path></svg>',
        ai: '<svg viewBox="0 0 24 24"><rect x="5" y="7" width="14" height="11" rx="4"></rect><path d="M12 7V4"></path><circle cx="9" cy="12" r="1"></circle><circle cx="15" cy="12" r="1"></circle><path d="M9.5 15h5"></path><path d="M3 11v3"></path><path d="M21 11v3"></path></svg>',
        streak: '<svg viewBox="0 0 24 24"><path d="M13 3s1 4-2 6c-2.4 1.6-4 3.7-4 6.4A5.5 5.5 0 0 0 12.5 21a5.8 5.8 0 0 0 5.8-5.8c0-3.3-2.2-5.4-4.1-7.2-.9-.8-1.3-2-1.2-5Z"></path><path d="M11 17c0-1.2.8-2 1.8-2.8.6.9 1.2 1.6 1.2 2.7A1.5 1.5 0 0 1 12.5 18 1.5 1.5 0 0 1 11 17Z"></path></svg>',
        level: '<svg viewBox="0 0 24 24"><path d="M12 3 15 9l6 .9-4.5 4.3 1.1 6.1L12 17.3 6.4 20.3l1.1-6.1L3 9.9 9 9l3-6Z"></path></svg>',
        attendance: '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="3"></rect><path d="M9 3v4"></path><path d="M15 3v4"></path><path d="m8.5 13 2.2 2.2 4.8-5"></path></svg>',
        average: '<svg viewBox="0 0 24 24"><path d="M4 19h16"></path><path d="M7 16V9"></path><path d="M12 16V5"></path><path d="M17 16v-4"></path><path d="M6 9h2"></path><path d="M11 5h2"></path><path d="M16 12h2"></path></svg>',
        pdf: '<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7V3Z"></path><path d="M14 3v5h5"></path><path d="M9 13h6"></path><path d="M9 17h3"></path></svg>',
        constant: '<svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 0 1 12-5"></path><path d="M17 4v5h-5"></path><path d="M19 12a7 7 0 0 1-12 5"></path><path d="M7 20v-5h5"></path></svg>',
        lock: '<svg viewBox="0 0 24 24"><rect x="6" y="10" width="12" height="10" rx="3"></rect><path d="M8.5 10V7.8a3.5 3.5 0 0 1 7 0V10"></path></svg>'
    };
    return icons[name] || icons.level;
}

function achievementIconHTML(name, unlocked) {
    const lock = unlocked ? '' : `<span class="achievement-lock" aria-hidden="true">${achievementIconSvg('lock')}</span>`;
    return `<span class="progress-achievement-icon" aria-hidden="true">${achievementIconSvg(name)}${lock}</span>`;
}

function getDashboardIconName(icon) {
    const map = {
        subjects: 'book',
        tasks: 'check',
        calendar: 'calendar',
        grades: 'chart',
        xp: 'trend',
        streak: 'trend',
        assistant: 'bot',
        level: 'trend'
    };
    return map[icon] || 'chart';
}

function getSubjectVisualIconName(icon) {
    const map = {
        math: 'chart',
        chemistry: 'flask',
        history: 'globe',
        programming: 'code',
        robotics: 'bot',
        literature: 'book',
        sports: 'trend',
        art: 'palette',
        biology: 'globe',
        'book-blue': 'book'
    };
    return map[normalizeSubjectIcon(icon)] || 'book';
}

function getProfileStatIconName(label, icon) {
    const key = normalizeTutorText(`${label || ''} ${icon || ''}`);
    if (key.includes('materia')) return 'book';
    if (key.includes('tarea')) return 'check';
    if (key.includes('pdf')) return 'file';
    if (key.includes('xp') || key.includes('nivel')) return 'trend';
    if (key.includes('racha') || key.includes('logro')) return 'chart';
    return 'chart';
}

function openSubject(subjectName) {
    notify(`Abriendo ${subjectName}. En la siguiente version tendra su panel propio.`, 'info');
}

function openResource(resourceName) {
    notify(`Abriendo ${resourceName}. Vista simulada por ahora.`, 'info');
}

// ============================================
// NOTAS
// ============================================

function showAddGradeForm() {
    const form = document.getElementById('add-grade-form');
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function hideAddGradeForm() {
    document.getElementById('add-grade-form').style.display = 'none';
}

function addGrade(event) {
    event.preventDefault();

    const subject = document.getElementById('grade-subject').value;
    const evaluation = document.getElementById('grade-evaluation').value;
    const value = parseFloat(document.getElementById('grade-value').value);

    if (value < 0 || value > 10) {
        notify('La nota debe estar entre 0 y 10.', 'error');
        return;
    }

    // Encontrar la tarjeta de la materia y agregar la nota
    const subjectEmojis = {
        'Matematica': '',
        'Fisica': '',
        'Programacion': '',
        'Ingles': ''
    };

    const gradeCard = Array.from(document.querySelectorAll('.grade-card')).find(card => {
        return card.textContent.includes(subject);
    });

    if (gradeCard) {
        const gradesList = gradeCard.querySelector('.grades-list');

        // Crear nuevo elemento de nota
        const newGrade = document.createElement('div');
        newGrade.className = 'grade-item';
        newGrade.innerHTML = `
            <span class="grade-name">${evaluation}</span>
            <span class="grade-value">${value.toFixed(1)}</span>
        `;

        // Insertar antes del promedio
        const averageItem = gradesList.querySelector('.grade-average').closest('.grade-item');
        if (averageItem) {
            gradesList.insertBefore(newGrade, averageItem);
            updateAverageGrade(gradeCard);
        }

        notify(`Nota ${value} registrada para ${subject}.`, 'success');
    }

    // Limpiar formulario
    document.getElementById('add-grade-form').reset();
    hideAddGradeForm();
}

function updateAverageGrade(gradeCard) {
    const grades = Array.from(gradeCard.querySelectorAll('.grade-item:not(:last-child) .grade-value'))
        .map(el => parseFloat(el.textContent))
        .filter(g => !isNaN(g));

    if (grades.length > 0) {
        const average = (grades.reduce((a, b) => a + b, 0) / grades.length).toFixed(2);
        gradeCard.querySelector('.grade-average').textContent = average;
    }
}

// ============================================
// ASISTENTE IA SIMULADO
// ============================================

function generateSummary() {
    const topic = document.getElementById('ai-topic').value.trim();

    if (!topic) {
        notify('Ingresa un tema para usar el asistente IA.', 'error');
        return;
    }

    const summaries = {
        default: ` Resumen de: ${topic}\n\n` +
            `Este es un resumen generado simuladamente sobre "${topic}".\n\n` +
            `Puntos principales:\n` +
            ` Definicion: Explicacion detallada del concepto\n` +
            ` Caracteristicas: Propiedades principales del tema\n` +
            ` Aplicaciones: Usos practicos en la vida real\n` +
            ` Ejemplos: Casos de estudio relevantes\n` +
            ` Importancia: Por qué es importante aprender esto\n\n` +
            `Este resumen fue generado para ayudarte a estudiar de manera eficiente. ` +
            `Utiliza este contenido como base para tu aprendizaje.`
    };

    const summary = summaries.default;

    showAIResult(' Resumen Generado', summary);
}

function generateQuestions() {
    const topic = document.getElementById('ai-topic').value.trim();

    if (!topic) {
        notify('Ingresa un tema para usar el asistente IA.', 'error');
        return;
    }

    const questions = ` Preguntas de Práctica: ${topic}\n\n` +
        `1. Cuáles son los conceptos principales de ${topic}?\n` +
        `   Respuesta: [Tu respuesta aquí]\n\n` +
        `2. ¿Cómo se aplica ${topic} en la práctica?\n` +
        `   Respuesta: [Tu respuesta aquí]\n\n` +
        `3. Cuáles son los errores comunes al estudiar ${topic}?\n` +
        `   Respuesta: [Tu respuesta aquí]\n\n` +
        `4. Explica la relacion entre ${topic} y otros temas relacionados.\n` +
        `   Respuesta: [Tu respuesta aquí]\n\n` +
        `5. Por qué es importante dominar ${topic}?\n` +
        `   Respuesta: [Tu respuesta aquí]`;

    showAIResult(' Preguntas Generadas', questions);
}

function generateFlashcards() {
    const topic = document.getElementById('ai-topic').value.trim();

    if (!topic) {
        notify('Ingresa un tema para usar el asistente IA.', 'error');
        return;
    }

    const flashcards = ` Flashcards para ${topic}\n\n` +
        `\n` +
        ` TARJETA 1                       \n` +
        `\n` +
        ` PREGUNTA:                       \n` +
        ` Qué es ${topic}?               \n` +
        `                                 \n` +
        ` RESPUESTA (Voltea):             \n` +
        ` Definicion detallada...         \n` +
        `\n\n` +
        `\n` +
        ` TARJETA 2                       \n` +
        `\n` +
        ` PREGUNTA:                       \n` +
        ` Caracteristicas de ${topic}      \n` +
        `                                 \n` +
        ` RESPUESTA (Voltea):             \n` +
        ` Listar caracteristicas clave... \n` +
        `\n\n` +
        `\n` +
        ` TARJETA 3                       \n` +
        `\n` +
        ` PREGUNTA:                       \n` +
        ` Aplicaciones prácticas          \n` +
        `                                 \n` +
        ` RESPUESTA (Voltea):             \n` +
        ` Ejemplos de uso...              \n` +
        ``;

    showAIResult(' Flashcards Generadas', flashcards);
}

function showAIResult(title, content) {
    const polishedContent = polishSpanishText(content);
    const polishedTitle = polishSpanishText(title);
    if (appendTutorMessage('bot', polishedContent, polishedTitle)) {
        return;
    }

    const outputSection = document.getElementById('ai-output-section');
    if (!outputSection) return;
    document.getElementById('result-title').textContent = polishedTitle;
    document.getElementById('result-content').textContent = polishedContent;
    outputSection.style.display = 'block';
}

function closeAIResult() {
    const outputSection = document.getElementById('ai-output-section');
    if (outputSection) outputSection.style.display = 'none';
}

function copyToClipboard() {
    const content = document.getElementById('result-content')?.textContent || '';
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(content).then(() => {
            notify('Contenido copiado al portapapeles.', 'success');
        }).catch(() => {
            fallbackCopy(content);
        });
        return;
    }

    fallbackCopy(content);
}

// ============================================
// CALENDARIO PERSONALIZADO
// ============================================

function getSavedEvents() {
    try {
        return JSON.parse(localStorage.getItem('customCalendarEvents')) || [];
    } catch (error) {
        localStorage.removeItem('customCalendarEvents');
        return [];
    }
}

function saveEvents(events) {
    localStorage.setItem('customCalendarEvents', JSON.stringify(events));
}

function addCalendarEventUI() {
    openQuickForm({
        title: 'Nuevo evento',
        submitLabel: 'Agregar evento',
        fields: [
            { name: 'title', label: 'Evento académico', placeholder: 'Ej: Examen de Matematica' },
            { name: 'day', label: 'Día del mes', type: 'number', value: '18' },
            { name: 'type', label: 'Tipo', value: 'exposición' },
            { name: 'time', label: 'Hora o detalle', value: 'Por definir' }
        ],
        onSubmit: values => {
            const event = {
                title: values.title.trim(),
                day: values.day.trim().padStart(2, '0'),
                type: values.type.trim() || 'evento',
                time: values.time.trim() || 'Por definir'
            };

            const events = getSavedEvents();
            events.push(event);
            saveEvents(events);
            renderCalendarEvent(event);
            notify(`Evento "${event.title}" agregado al calendario.`, 'success');
        }
    });
}

function renderSavedCalendarEvents() {
    getSavedEvents().forEach(renderCalendarEvent);
}

function renderCalendarEvent(event) {
    const list = document.getElementById('custom-events-list');
    if (!list) return;

    const item = document.createElement('div');
    item.className = 'event-item event-custom';
    item.innerHTML = `
        <div class="event-date">
            <span class="day">${escapeHTML(event.day)}</span>
            <span class="month">Jun</span>
        </div>
        <div class="event-content">
            <h4>${escapeHTML(event.title)}</h4>
            <p>${escapeHTML(event.time)}</p>
            <span class="event-badge">${escapeHTML(event.type)}</span>
        </div>
    `;

    list.appendChild(item);
}

function fallbackCopy(content) {
    const textarea = document.createElement('textarea');
    textarea.value = content;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    notify('Contenido copiado al portapapeles.', 'success');
}

function downloadResult() {
    const title = document.getElementById('result-title')?.textContent || 'Tutor';
    const content = document.getElementById('result-content')?.textContent || '';

    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content));
    element.setAttribute('download', `${title}.txt`);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

// ============================================
// CALENDARIO
// ============================================

function generateCalendar() {
    const miniCalendar = document.getElementById('mini-calendar');
    const now = new Date(2026, 5, 5); // Junio 5, 2026

    // Crear estructura del calendario
    let html = `
        <div style="margin-bottom: 16px;">
            <h4 style="text-align: center; margin-bottom: 12px; color: var(--text-primary);">Junio 2026</h4>
            <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;">
    `;

    // Días de la semana
    const days = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
    days.forEach(day => {
        html += `<div style="text-align: center; font-size: 11px; font-weight: 600; color: var(--text-secondary); padding: 8px 0;">${day}</div>`;
    });

    // Días del mes
    const firstDay = new Date(2026, 5, 1).getDay();
    const daysInMonth = 30;

    // Espacios vacíos antes del primer día
    for (let i = 0; i < firstDay; i++) {
        html += `<div style="padding: 8px; text-align: center; font-size: 12px; color: var(--text-tertiary);">-</div>`;
    }

    // Días del mes
    for (let day = 1; day <= daysInMonth; day++) {
        const isToday = day === 5;
        const hasEvent = [8, 10, 12, 15, 20].includes(day);
        const bgColor = isToday ? 'var(--color-cyan)' : hasEvent ? 'var(--color-purple)' : 'transparent';
        const textColor = (isToday || hasEvent) ? 'white' : 'var(--text-primary)';

        html += `
            <div style="
                padding: 8px;
                text-align: center;
                font-size: 12px;
                font-weight: 600;
                background-color: ${bgColor};
                border-radius: 4px;
                color: ${textColor};
                cursor: pointer;
                transition: all 200ms;
            " onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
                ${day}
            </div>
        `;
    }

    html += `</div></div>`;
    miniCalendar.innerHTML = html;
}

// ============================================
// MOCHILA DIGITAL
// ============================================

function downloadResource(filename) {
    notify(`Descarga simulada: ${filename}.`, 'info');
}

// ============================================
// ESPACIO PERSONAL DEL ESTUDIANTE
// ============================================

function getWorkspaceKey() {
    return `acStudyWorkspace:${currentUser?.email || 'guest'}`;
}

const gradebookResetVersion = 'period-gradebook-v1';

function renderSavedSubjects() {}

function renderSavedCalendarEvents() {}

function getEmptyWorkspace() {
    return {
        subjects: [],
        tasks: [],
        events: [],
        grades: [],
        attendance: [],
        resources: [],
        xp: 0,
        streak: 0,
        recent: []
    };
}

function loadWorkspace() {
    if (!currentUser?.email) return getEmptyWorkspace();

    try {
        const workspace = { ...getEmptyWorkspace(), ...JSON.parse(localStorage.getItem(getWorkspaceKey())) };
        if (workspace.gradebookResetVersion !== gradebookResetVersion) {
            workspace.grades = [];
            workspace.gradebookResetVersion = gradebookResetVersion;
            workspace.recent = [
                { text: 'La libreta de calificaciones inició desde cero con el nuevo sistema por periodos.', time: 'Ahora' },
                ...(workspace.recent || [])
            ].slice(0, 6);
            localStorage.setItem(getWorkspaceKey(), JSON.stringify(workspace));
        }
        return workspace;
    } catch (error) {
        localStorage.removeItem(getWorkspaceKey());
        return getEmptyWorkspace();
    }
}

function saveWorkspace(workspace) {
    if (!currentUser?.email) return;
    localStorage.setItem(getWorkspaceKey(), JSON.stringify(workspace));
}

function ensureWorkspace() {
    if (!currentUser?.email) return;
    if (!localStorage.getItem(getWorkspaceKey())) {
        saveWorkspace(getEmptyWorkspace());
    }
}

function addRecent(workspace, text) {
    workspace.recent = [
        { text, time: 'Ahora' },
        ...(workspace.recent || [])
    ].slice(0, 6);
}

function addXP(workspace, amount) {
    workspace.xp = Math.max(0, (workspace.xp || 0) + amount);
    workspace.streak = workspace.xp > 0 ? Math.max(1, workspace.streak || 0) : 0;
}

function getLevel(xp) {
    return Math.max(1, Math.floor((xp || 0) / 250) + 1);
}

function getAverageGrade(workspace) {
    if (!workspace.grades.length) return 0;
    const grouped = workspace.grades.reduce((acc, grade) => {
        const subject = grade.subject || 'General';
        acc[subject] = acc[subject] || [];
        acc[subject].push(grade);
        return acc;
    }, {});
    const subjectAverages = Object.values(grouped)
        .map(grades => getSubjectGradeSummary(grades).average)
        .filter(value => value !== null);
    if (!subjectAverages.length) return 0;
    return subjectAverages.reduce((sum, value) => sum + value, 0) / subjectAverages.length;
}

function getNextEvent(workspace) {
    return workspace.events[0] || null;
}

function refreshWorkspaceUI() {
    const workspace = loadWorkspace();
    renderDashboard(workspace);
    renderSubjects(workspace);
    renderTasks(workspace);
    renderCalendarSection(workspace);
    renderGrades(workspace);
    renderAttendance(workspace);
    renderProgress(workspace);
    renderBackpack(workspace);
    updateGradeSubjectOptions(workspace);
}

function legacyShowAppWithLocalWorkspace() {
    ensureWorkspace();
    showPage('app-page');
    updateDashboardGreeting();
    refreshWorkspaceUI();
    navigateTo('dashboard');
}

function legacyHandleRegisterWithLocalWorkspace(event) {
    event.preventDefault();
    clearAuthMessages();

    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value.trim();

    if (!name || !email || !password) {
        setAuthMessage('register', 'Completa nombre, correo y contraseña para crear tu cuenta.', 'error');
        return;
    }

    const users = getUsers();
    const createdAt = new Date().toISOString();
    users[email] = {
        password,
        name,
        role: 'Estudiante',
        career: 'Informatica',
        bio: 'Construyendo mi camino de aprendizaje.',
        interests: 'Organización académica, IA educativa, productividad',
        avatarStyle: 'initials',
        avatarText: '',
        createdAt,
        goals: []
    };
    saveUsers(users);

    currentUser = getPublicUser(email, users[email]);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    saveWorkspace(getEmptyWorkspace());

    document.getElementById('register-name').value = '';
    document.getElementById('register-email').value = '';
    document.getElementById('register-password').value = '';

    showApp();
    notify('Bienvenido a AC Edunity. Empieza creando tu primera materia.', 'success');
}

function legacyHandleLoginWithLocalWorkspace(event) {
    event.preventDefault();
    clearAuthMessages();

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const users = getUsers();

    if (users[email] && users[email].password === password) {
        currentUser = getPublicUser(email, users[email]);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        ensureWorkspace();
        document.getElementById('login-email').value = '';
        document.getElementById('login-password').value = '';
        showApp();
        notify('Sesión iniciada correctamente.', 'success');
        playInterfaceSound();
    } else {
        setAuthMessage('login', 'Correo o contraseña incorrectos. Revisa tus datos o crea una cuenta nueva.', 'error');
    }
}

function renderDashboard(workspace) {
    const section = document.getElementById('dashboard');
    if (!section) return;

    const firstName = currentUser?.name ? currentUser.name.split(' ')[0] : 'Estudiante';
    const pending = workspace.tasks.filter(task => task.status !== 'completed').length;
    const completed = workspace.tasks.filter(task => task.status === 'completed').length;
    const nextEvent = getNextEvent(workspace);
    const average = getAverageGrade(workspace);
    const level = getLevel(workspace.xp);
    const isEmpty = !workspace.subjects.length && !workspace.tasks.length && !workspace.events.length && !workspace.grades.length && !workspace.resources.length;

    section.innerHTML = `
        <div class="section-header">
            <h1>Hola ${escapeHTML(firstName)}</h1>
            <p class="subtitle">${isEmpty ? 'Bienvenido a AC Edunity. Empieza creando tu primera materia.' : 'Este es el resumen actualizado de tu espacio académico.'}</p>
        </div>

        <div class="dashboard-grid">
            ${dashboardCard('subjects', 'Materias Activas', workspace.subjects.length, workspace.subjects.length ? 'Materias creadas por ti' : 'Sin materias todavía', workspace.subjects.length ? 100 : 0)}
            ${dashboardCard('tasks', 'Tareas Pendientes', pending, `${completed} completadas`, workspace.tasks.length ? Math.round((completed / workspace.tasks.length) * 100) : 0)}
            ${dashboardCard('calendar', 'Próximo evento', nextEvent ? nextEvent.title : 'Sin eventos', nextEvent ? `${nextEvent.day} - ${nextEvent.type}` : 'Agenda tu primer examen o entrega', nextEvent ? 70 : 0)}
            ${dashboardCard('grades', 'Promedio Actual', average ? average.toFixed(2) : '--', workspace.grades.length ? `${workspace.grades.length} notas registradas` : 'Aún no hay notas', average ? average * 10 : 0)}
            ${dashboardCard('xp', 'XP Acumulado', workspace.xp || 0, `Nivel ${level}`, Math.min(100, ((workspace.xp || 0) % 250) / 2.5))}
            ${dashboardCard('streak', 'Racha de estudio', workspace.streak || 0, 'días activos', workspace.streak ? 100 : 0)}
            ${dashboardCard('AI', 'Recomendación IA', workspace.resources.length ? 'Repasa un PDF' : 'Sube un apunte', workspace.resources.length ? 'Tutor puede crear cuestionarios' : 'Sube tus apuntes y estudia con ayuda de Tutor', workspace.resources.length ? 85 : 25)}
        </div>

        <div class="dashboard-row">
            <div class="card starter-card">
                <h3>Centro del estudiante</h3>
                <ol class="starter-list">
                    <li class="${workspace.subjects.length ? 'done' : ''}">Crea una materia</li>
                    <li class="${workspace.tasks.length ? 'done' : ''}">Agrega una tarea</li>
                    <li class="${workspace.events.length ? 'done' : ''}">Agenda un examen</li>
                    <li class="${workspace.resources.length ? 'done' : ''}">Sube un apunte</li>
                    <li class="${workspace.resources.some(resource => resource.usedAI) ? 'done' : ''}">Pregunta a la IA</li>
                </ol>
            </div>

            <div class="card">
                <h3>Actividad reciente</h3>
                ${workspace.recent.length ? `
                    <ul class="activity-list">${workspace.recent.map(item => `
                        <li><span class="activity-time">${escapeHTML(item.time)}</span><span class="activity-text">${escapeHTML(item.text)}</span></li>
                    `).join('')}</ul>
                ` : emptyStateHTML('Tu actividad aparecerá cuando empieces a usar la plataforma.', 'Crear primera materia', 'addSubjectUI()')}
            </div>



            <div class="card weekly-progress-card">
                <h3>Progreso semanal</h3>
                <div class="weekly-chart" aria-label="Progreso semanal simulado">
                    ${[15, 20, 25, 30, 35, 40, Math.min(95, 20 + completed * 12)].map(value => `<span class="week-day" style="height:${value}%"></span>`).join('')}
                </div>
                <p class="chart-caption">${completed ? `Has completado ${completed} tarea(s).` : 'Tu gráfico crecerá cuando completes actividades.'}</p>
            </div>
        </div>
    `;
}

function dashboardCard(icon, label, value, subtext, progress) {
    return `
        <div class="stat-card">
            <div class="stat-header">${appIconHTML(getDashboardIconName(icon), `stat-icon stat-icon-${escapeHTML(icon)} dashboard-icon`)}<span class="stat-label">${escapeHTML(label)}</span></div>
            <div class="stat-value">${escapeHTML(value)}</div>
            <div class="stat-subtext">${escapeHTML(subtext)}</div>
            <div class="progress-bar"><div class="progress-fill" style="width:${Math.max(0, Math.min(100, progress))}%"></div></div>
        </div>
    `;
}

function emptyStateHTML(message, buttonText, action) {
    return `
        <div class="empty-state">
            <div class="empty-icon"></div>
            <h3>${escapeHTML(message)}</h3>
            <button class="btn-primary btn-small" onclick="${action}">${escapeHTML(buttonText)}</button>
        </div>
    `;
}

function addSubjectUI() {
    openQuickForm({
        title: 'Crear materia',
        submitLabel: 'Guardar materia',
        fields: [
            { name: 'name', label: 'Nombre de la materia', placeholder: 'Ej: Matemática' },
            { name: 'color', label: 'Color identificador', type: 'select', options: subjectColorOptions }
        ],
        onSubmit: values => {
            const workspace = loadWorkspace();
            const subject = {
                id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
                name: values.name.trim(),
                color: values.color || 'Morado',
                createdAt: new Date().toISOString()
            };
            workspace.subjects.push(subject);
            addXP(workspace, 30);
            addRecent(workspace, `Creaste la materia ${subject.name}.`);
            saveWorkspace(workspace);
            refreshWorkspaceUI();
            notify(`Materia "${subject.name}" creada correctamente.`, 'success');
        }
    });
}

function renderSubjects(workspace) {
    const grid = document.querySelector('.subjects-grid');
    if (!grid) return;

    grid.innerHTML = workspace.subjects.length ? workspace.subjects.map(subject => {
        const taskCount = workspace.tasks.filter(task => task.subject === subject.name).length;
        const completed = workspace.tasks.filter(task => task.subject === subject.name && task.status === 'completed').length;
        const progress = taskCount ? Math.round((completed / taskCount) * 100) : 0;
        return `
            <div class="subject-card subject-custom">
                <div class="subject-header"><h3>${escapeHTML(subject.name)}</h3><span class="subject-icon"></span></div>
                <div class="subject-stats">
                    <div class="stat"><span class="stat-name">Progreso</span><span class="stat-num">${progress}%</span></div>
                    <div class="stat"><span class="stat-name">Tareas</span><span class="stat-num">${taskCount}</span></div>
                    <div class="stat"><span class="stat-name">Color</span><span class="stat-num">${escapeHTML(subject.color)}</span></div>
                </div>
                <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
                <p class="last-activity">Ultima actividad: creada por el estudiante</p>
                <button class="btn-secondary btn-small" data-subject-id="${escapeHTML(subject.id)}">Acceder</button>
            </div>
        `;
    }).join('') : emptyStateHTML('No tienes materias registradas todavía.', 'Crear primera materia', 'addSubjectUI()');

    grid.querySelectorAll('[data-subject-id]').forEach(button => {
        button.addEventListener('click', () => {
            const subject = workspace.subjects.find(item => item.id === button.dataset.subjectId);
            if (subject) openSubject(subject.name);
        });
    });
}

function addTaskUI() {
    const workspace = loadWorkspace();
    const subjectOptions = workspace.subjects.length ? workspace.subjects.map(subject => subject.name) : ['General'];
    openQuickForm({
        title: 'Agregar tarea',
        submitLabel: 'Guardar tarea',
        fields: [
            { name: 'title', label: 'Tarea', placeholder: 'Ej: Taller de funciones' },
            { name: 'subject', label: 'Materia', type: 'select', options: subjectOptions },
            { name: 'due', label: 'Fecha o detalle', value: 'Proximamente' }
        ],
        onSubmit: values => {
            const fresh = loadWorkspace();
            fresh.tasks.push({
                id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
                title: values.title.trim(),
                subject: values.subject,
                due: values.due.trim(),
                status: 'pending'
            });
            addXP(fresh, 15);
            addRecent(fresh, `Agregaste la tarea ${values.title.trim()}.`);
            saveWorkspace(fresh);
            refreshWorkspaceUI();
            notify('Tarea agregada correctamente.', 'success');
        }
    });
}

function renderTasks(workspace) {
    const list = document.getElementById('tasks-list');
    if (!list) return;

    list.innerHTML = workspace.tasks.length ? workspace.tasks.map(task => `
        <div class="task-item" data-status="${escapeHTML(task.status)}" data-id="${escapeHTML(task.id)}">
            <div class="task-checkbox"><input type="checkbox" onclick="toggleTask(this)" ${task.status === 'completed' ? 'checked' : ''}></div>
            <div class="task-content">
                <h4>${escapeHTML(task.title)}</h4>
                <p class="task-subject">Materia: ${escapeHTML(task.subject)}</p>
                <p class="task-date">${task.status === 'completed' ? 'Completada' : `Vence: ${escapeHTML(task.due)}`}</p>
            </div>
            <div class="task-priority ${task.status === 'completed' ? 'low' : 'medium'}">${task.status === 'completed' ? 'Completada' : 'Pendiente'}</div>
        </div>
    `).join('') : emptyStateHTML('No tienes tareas pendientes.', 'Agregar tarea', 'addTaskUI()');
}

function toggleTask(checkbox) {
    const taskItem = checkbox.closest('.task-item');
    const taskId = taskItem?.dataset.id;
    const workspace = loadWorkspace();
    const task = workspace.tasks.find(item => item.id === taskId);
    if (!task) return;

    task.status = checkbox.checked ? 'completed' : 'pending';
    if (checkbox.checked) {
        addXP(workspace, 25);
        addRecent(workspace, `Completaste la tarea ${task.title}.`);
    }
    saveWorkspace(workspace);
    refreshWorkspaceUI();
}

function filterTasks(filter, button) {
    currentTaskFilter = filter || 'all';
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    if (button) button.classList.add('active');
    renderTasks(loadWorkspace());
}

function addCalendarEventUI() {
    openQuickForm({
        title: 'Agendar evento',
        submitLabel: 'Guardar evento',
        fields: [
            { name: 'title', label: 'Evento académico', placeholder: 'Ej: Examen de Matematica' },
            { name: 'day', label: 'Fecha o día', value: 'Por definir' },
            { name: 'type', label: 'Tipo', type: 'select', options: eventTypeOptions },
            { name: 'time', label: 'Hora o detalle', value: 'Por definir' }
        ],
        onSubmit: values => {
            const workspace = loadWorkspace();
            workspace.events.push({
                id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
                title: values.title.trim(),
                day: values.day.trim(),
                type: values.type,
                time: values.time.trim()
            });
            addXP(workspace, 20);
            addRecent(workspace, `Agendaste ${values.title.trim()}.`);
            saveWorkspace(workspace);
            refreshWorkspaceUI();
            notify('Evento agregado al calendario.', 'success');
        }
    });
}

function renderCalendarSection(workspace) {
    const container = document.querySelector('.calendar-container');
    if (!container) return;

    container.innerHTML = `
        <div class="calendar-mini" id="mini-calendar"></div>
        <div class="events-list">
            <h3>Agenda académica</h3>
            <div id="custom-events-list">
                ${workspace.events.length ? workspace.events.map(event => `
                    <div class="event-item event-custom">
                        <div class="event-date"><span class="day">${escapeHTML(event.day)}</span><span class="month">AC</span></div>
                        <div class="event-content"><h4>${escapeHTML(event.title)}</h4><p>${escapeHTML(event.time)}</p><span class="event-badge">${escapeHTML(event.type)}</span></div>
                    </div>
                `).join('') : emptyStateHTML('No tienes eventos programados.', 'Agendar evento', 'addCalendarEventUI()')}
            </div>
        </div>
    `;
    generateCalendar();
}

function getCalendarDateKey(year, month, day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getEventDateKey(event) {
    const source = String(event.date || event.day || '').trim();
    const match = source.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
}

function changeCalendarMonth(offset) {
    calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() + offset, 1);
    generateCalendar();
}

function generateCalendar() {
    const miniCalendar = document.getElementById('mini-calendar');
    if (!miniCalendar) return;

    const workspace = loadWorkspace();
    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const visibleCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    const todayKey = getCalendarDateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

    const eventsByDate = workspace.events.reduce((acc, event) => {
        const dateKey = getEventDateKey(event);
        if (dateKey) {
            acc[dateKey] = acc[dateKey] || [];
            acc[dateKey].push(event);
        }
        return acc;
    }, {});

    let html = `
        <div class="calendar-toolbar">
            <button class="calendar-month-btn" type="button" onclick="changeCalendarMonth(-1)" aria-label="Mes anterior">‹</button>
            <div class="calendar-title-block">
                <div class="calendar-title">${monthNames[month]} ${year}</div>
                <p>Calendario académico mensual</p>
            </div>
            <button class="calendar-month-btn" type="button" onclick="changeCalendarMonth(1)" aria-label="Mes siguiente">›</button>
        </div>
        <div class="calendar-grid calendar-grid-wide">
    `;
    ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(day => {
        html += `<div class="calendar-day-label">${day}</div>`;
    });
    for (let i = 0; i < visibleCells; i++) {
        const day = i - firstWeekday + 1;
        if (day < 1 || day > daysInMonth) {
            html += '<div class="calendar-day muted">-</div>';
        } else {
            const dateKey = getCalendarDateKey(year, month, day);
            const dayEvents = eventsByDate[dateKey] || [];
            const title = dayEvents.map(event => event.title).join(', ');
            html += `
                <div class="calendar-day ${dayEvents.length ? 'has-event' : ''} ${dateKey === todayKey ? 'is-today' : ''}" title="${escapeHTML(title)}">
                    <span class="calendar-day-number">${day}</span>
                    ${dayEvents.length ? `<span class="calendar-event-marker">${dayEvents.length}</span>` : ''}
                </div>
            `;
        }
    }
    html += '</div>';
    miniCalendar.innerHTML = html;
}

function showAddGradeForm() {
    const workspace = loadWorkspace();
    const subjectOptions = workspace.subjects.length ? workspace.subjects.map(subject => subject.name) : ['General'];
    openQuickForm({
        title: 'Agregar nota',
        submitLabel: 'Guardar nota',
        fields: [
            { name: 'subject', label: 'Materia', type: 'select', options: subjectOptions },
            { name: 'evaluation', label: 'Evaluacion', placeholder: 'Ej: Parcial 1' },
            { name: 'value', label: 'Nota (0-10)', type: 'number', placeholder: '8.5' }
        ],
        onSubmit: values => {
            const value = Number(values.value);
            if (Number.isNaN(value) || value < 0 || value > 10) {
                notify('La nota debe estar entre 0 y 10.', 'error');
                return;
            }
            const fresh = loadWorkspace();
            fresh.grades.push({ id: String(Date.now()), subject: values.subject, evaluation: values.evaluation.trim(), value });
            addXP(fresh, 20);
            addRecent(fresh, `Registraste una nota en ${values.subject}.`);
            saveWorkspace(fresh);
            refreshWorkspaceUI();
            notify('Nota guardada correctamente.', 'success');
        }
    });
}

function hideAddGradeForm() {}

function renderGrades(workspace) {
    const container = document.querySelector('.grades-container');
    if (!container) return;

    if (!workspace.grades.length) {
        container.innerHTML = emptyStateHTML('No has registrado calificaciones.', 'Agregar calificación', 'showAddGradeForm()');
        return;
    }

    const average = getAverageGrade(workspace);
    const grouped = workspace.grades.reduce((acc, grade) => {
        const subject = grade.subject || 'General';
        acc[subject] = acc[subject] || [];
        acc[subject].push(grade);
        return acc;
    }, {});

    const subjectRows = Object.entries(grouped).map(([subject, grades]) => {
        const sortedGrades = [...grades].sort((a, b) => {
            if (gradeSortMode === 'date') return (b.date || '').localeCompare(a.date || '');
            if (gradeSortMode === 'high') return getGradeFinalValue(b) - getGradeFinalValue(a);
            if (gradeSortMode === 'low') return getGradeFinalValue(a) - getGradeFinalValue(b);
            return (a.evaluation || '').localeCompare(b.evaluation || '');
        });
        const subjectAverage = sortedGrades.reduce((sum, grade) => sum + getGradeFinalValue(grade), 0) / sortedGrades.length;
        return { subject, grades: sortedGrades, average: subjectAverage };
    }).sort((a, b) => a.subject.localeCompare(b.subject));

    if (gradeSortMode === 'high') subjectRows.sort((a, b) => b.average - a.average);
    if (gradeSortMode === 'low') subjectRows.sort((a, b) => a.average - b.average);

    container.innerHTML = `
        <div class="grades-toolbar">
            <div class="grade-summary">
                <strong>Promedio general: ${average.toFixed(2)}</strong>
                <span class="grade-status ${getGradeStatus(average).replace(' ', '-')}">${getGradeStatus(average)}</span>
            </div>
            <select onchange="setGradeSort(this.value)">
                <option value="subject" ${gradeSortMode === 'subject' ? 'selected' : ''}>Ordenar por materia</option>
                <option value="date" ${gradeSortMode === 'date' ? 'selected' : ''}>Ordenar por fecha</option>
                <option value="high" ${gradeSortMode === 'high' ? 'selected' : ''}>Nota mayor</option>
                <option value="low" ${gradeSortMode === 'low' ? 'selected' : ''}>Nota menor</option>
            </select>
        </div>
        <div class="gradebook-panel">
            <div class="gradebook-header">
                <span>Materia</span>
                <span>Calificaciónes registradas</span>
                <span>Promedio</span>
            </div>
            <div class="gradebook-body">
                ${subjectRows.map(row => `
                    <div class="gradebook-row">
                        <div class="gradebook-subject">
                            <strong>${escapeHTML(row.subject)}</strong>
                            <small>${row.grades.length} ${row.grades.length === 1 ? 'calificación' : 'calificaciones'}</small>
                        </div>
                        <div class="gradebook-scores">
                            ${row.grades.map(grade => {
                                const items = getGradeItems(grade);
                                const value = getGradeFinalValue(grade);
                                const status = getGradeStatus(value).replace(' ', '-');
                                const itemLabel = items.length === 1 ? '1 actividad' : `${items.length} actividades`;
                                return `
                                    <div class="gradebook-score ${status} ${items.length > 1 ? 'has-items' : ''}" title="${escapeHTML(grade.evaluation || 'Calificación')} - ${escapeHTML(itemLabel)}">
                                        <button class="score-action score-edit" data-grade-edit="${escapeHTML(grade.id)}" aria-label="Editar calificación">Editar</button>
                                        <span class="score-value">${formatGradeValue(value)}</span>
                                        <span class="score-label">${escapeHTML(grade.evaluation || 'Nota')}</span>
                                        <span class="score-count">${escapeHTML(itemLabel)}</span>
                                        <button class="score-action score-delete" data-grade-delete="${escapeHTML(grade.id)}" aria-label="Eliminar calificación">Eliminar</button>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                        <div class="gradebook-average">
                            <strong>${row.average.toFixed(2)}</strong>
                            <span class="grade-status ${getGradeStatus(row.average).replace(' ', '-')}">${getGradeStatus(row.average)}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    container.querySelectorAll('[data-grade-edit]').forEach(button => button.addEventListener('click', () => openGradeForm(button.dataset.gradeEdit)));
    container.querySelectorAll('[data-grade-delete]').forEach(button => button.addEventListener('click', () => deleteGrade(button.dataset.gradeDelete)));
}

function updateGradeSubjectOptions() {}

function addAttendanceUI() {
    openAttendanceForm();
}

function getAttendanceStatusLabel(status) {
    if (status === 'Asisti') return 'Presente';
    if (status === 'Falta') return 'Falta';
    if (status === 'Atraso') return 'Atraso';
    if (status === 'Justificado') return 'Justificado';
    return 'Pendiente';
}

function getAttendanceStatusKey(status) {
    if (status === 'Asisti') return 'present';
    if (status === 'Falta') return 'absent';
    if (status === 'Atraso') return 'late';
    if (status === 'Justificado') return 'justified';
    return 'pending';
}

function isAttendancePositive(status) {
    return status === 'Asisti' || status === 'Atraso' || status === 'Justificado';
}

function getAttendanceStats(records) {
    const total = records.length;
    const present = records.filter(item => item.status === 'Asisti').length;
    const absent = records.filter(item => item.status === 'Falta').length;
    const late = records.filter(item => item.status === 'Atraso').length;
    const justified = records.filter(item => item.status === 'Justificado').length;
    const positive = records.filter(item => isAttendancePositive(item.status)).length;
    const percentage = total ? Math.round((positive / total) * 100) : 0;
    return { total, present, absent, late, justified, positive, percentage };
}

function getAttendanceSubjectStats(workspace) {
    return getSubjectOptions(workspace).map(subject => {
        const records = workspace.attendance.filter(item => item.subject === subject);
        const stats = getAttendanceStats(records);
        return { subject, records, ...stats };
    }).filter(item => item.records.length);
}

function openAttendanceForm(attendanceId = null) {
    const workspace = loadWorkspace();
    const attendance = workspace.attendance.find(item => item.id === attendanceId);
    openQuickForm({
        title: attendance ? 'Editar asistencia' : 'Registrar asistencia',
        submitLabel: attendance ? 'Actualizar asistencia' : 'Guardar asistencia',
        fields: [
            { name: 'subject', label: 'Materia', type: 'select', options: getSubjectOptions(workspace), value: attendance?.subject || '' },
            { name: 'date', label: 'Fecha', type: 'date', value: normalizeDate(attendance?.date || new Date().toISOString()) },
            { name: 'status', label: 'Estado', type: 'choice-grid', options: attendanceStatusOptions, value: attendance?.status || 'Asisti' }
        ],
        onSubmit: async values => {
            const fresh = loadWorkspace();
            const subject = findSubjectByName(fresh, values.subject);

            try {
                const user = await getCurrentSupabaseUser();
                const attendanceData = {
                    user_id: user.id,
                    subject_id: subject?.id || null,
                    date: values.date,
                    status: values.status
                };
                console.log("[ATTENDANCE] guardando asistencia", attendanceData);

                if (attendanceId) {
                    const { data, error } = await getSupabaseClient()
                        .from('attendance')
                        .update(attendanceData)
                        .eq('id', attendanceId)
                        .eq('user_id', user.id)
                        .select();

                    if (error) {
                        console.error("[ATTENDANCE ERROR]", error);
                        logSupabaseError('attendance update', error);
                        throw error;
                    }
                    console.log("[ATTENDANCE] guardado correcto", data);
                    pushRecentMessage(`Editaste asistencia en ${values.subject}.`);
                } else {
                    const { data, error } = await getSupabaseClient()
                        .from('attendance')
                        .insert(attendanceData)
                        .select();

                    if (error) {
                        console.error("[ATTENDANCE ERROR]", error);
                        logSupabaseError('attendance insert', error);
                        throw error;
                    }
                    console.log("[ATTENDANCE] guardado correcto", data);
                    await updateProfileProgress(values.status === 'Asisti' ? 10 : 4, { bumpStreak: values.status === 'Asisti' });
                    pushRecentMessage(`Registraste asistencia en ${values.subject}.`);
                }

                await syncWorkspaceFromSupabase();
                refreshWorkspaceUI();
                notify(attendanceId ? 'Asistencia actualizada.' : 'Asistencia registrada.', 'success');
            } catch (error) {
                console.error("[ATTENDANCE ERROR]", error);
                notify(error.message || 'No se pudo guardar la asistencia.', 'error');
            }
        }
    });
}

async function deleteAttendance(attendanceId) {
    const workspace = loadWorkspace();
    const attendance = workspace.attendance.find(item => item.id === attendanceId);
    try {
        const user = await getCurrentSupabaseUser();
        const { error } = await getSupabaseClient()
            .from('attendance')
            .delete()
            .eq('id', attendanceId)
            .eq('user_id', user.id);

        if (error) {
            logSupabaseError('attendance delete', error);
            throw error;
        }

        if (attendance) pushRecentMessage(`Eliminaste asistencia de ${attendance.subject}.`);
        await syncWorkspaceFromSupabase();
        refreshWorkspaceUI();
        notify('Registro de asistencia eliminado.', 'info');
    } catch (error) {
        notify(error.message || 'No se pudo eliminar la asistencia.', 'error');
    }
}

function filterAttendance(filter, button) {
    currentAttendanceFilter = filter || 'all';
    document.querySelectorAll('#attendance .filter-btn').forEach(btn => btn.classList.remove('active'));
    if (button) button.classList.add('active');
    renderAttendance(loadWorkspace());
}

function getAttendanceCalendarDays(records) {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const offset = (firstDay.getDay() + 6) % 7;
    const cells = [];

    for (let i = 0; i < offset; i += 1) {
        cells.push({ empty: true });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
        const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const record = records.find(item => normalizeDate(item.date) === iso);
        cells.push({ day, record });
    }
    return cells;
}

function renderAttendance(workspace) {
    const container = document.getElementById('attendance-container');
    if (!container) return;

    if (!workspace.attendance.length) {
        container.innerHTML = emptyStateHTML('Todavía no registras asistencias. Comienza agregando tu primera clase.', '+ Registrar asistencia', 'addAttendanceUI()');
        return;
    }

    const stats = getAttendanceStats(workspace.attendance);
    const subjectStats = getAttendanceSubjectStats(workspace);
    const filterTabs = [
        ['all', 'Todos'],
        ['present', 'Presentes'],
        ['absent', 'Faltas'],
        ['late', 'Atrasos'],
        ['justified', 'Justificados']
    ];
    const filteredRecords = workspace.attendance
        .map(item => ({ ...item, statusKey: getAttendanceStatusKey(item.status) }))
        .filter(item => currentAttendanceFilter === 'all' || item.statusKey === currentAttendanceFilter)
        .sort((a, b) => normalizeDate(b.date).localeCompare(normalizeDate(a.date)));
    const calendarDays = getAttendanceCalendarDays(workspace.attendance);
    const lowSubject = subjectStats.find(item => item.percentage < 80);
    const bestSubject = subjectStats.find(item => item.percentage >= 90 && item.total >= 3);

    container.innerHTML = `
        <div class="attendance-overview">
            ${attendanceStatCard('classes', 'Clases', stats.total)}
            ${attendanceStatCard('present', 'Asistencias', stats.present)}
            ${attendanceStatCard('absent', 'Faltas', stats.absent)}
            ${attendanceStatCard('late', 'Atrasos', stats.late)}
            ${attendanceStatCard('percent', 'Asistencia general', `${stats.percentage}%`)}
        </div>

        <div class="attendance-alert ${lowSubject ? 'warning' : 'success'}">
            <strong>${lowSubject ? `Tu asistencia en ${escapeHTML(lowSubject.subject)} bajó de 80%.` : 'Llevas una buena racha de asistencia.'}</strong>
            <span>${lowSubject ? 'Revisa tus faltas y registra justificaciones si corresponde.' : (bestSubject ? `Excelente avance en ${escapeHTML(bestSubject.subject)}.` : 'Sigue registrando tus clases para medir tu progreso.')}</span>
        </div>

        <div class="attendance-layout">
            <section class="attendance-panel attendance-history-panel">
                <div class="attendance-panel-head">
                    <div>
                        <h3>Historial de asistencia</h3>
                        <p>Filtra tus clases por estado.</p>
                    </div>
                </div>
                <div class="attendance-filter task-filter-modern">
                    ${filterTabs.map(([key, label]) => `
                        <button class="filter-btn ${currentAttendanceFilter === key ? 'active' : ''}" type="button" data-attendance-filter="${key}">
                            ${label}
                        </button>
                    `).join('')}
                </div>
                <div class="attendance-grid">
                    ${filteredRecords.length ? filteredRecords.map(item => {
                        const key = getAttendanceStatusKey(item.status);
                        return `
                            <article class="attendance-card attendance-${key}">
                                <div class="attendance-card-icon" aria-hidden="true"></div>
                                <div class="attendance-card-main">
                                    <h3>${escapeHTML(item.subject || 'General')}</h3>
                                    <span class="attendance-status">${escapeHTML(getAttendanceStatusLabel(item.status))}</span>
                                    <p class="attendance-date">${escapeHTML(item.date || 'Sin fecha')}</p>
                                    <p class="attendance-note">${key === 'present' ? 'Clase asistida correctamente.' : key === 'absent' ? 'Clase marcada como falta.' : key === 'late' ? 'Llegada tarde registrada.' : 'Registro justificado.'}</p>
                                </div>
                                <div class="card-actions">
                                    <button class="btn-secondary btn-small" data-attendance-edit="${escapeHTML(item.id)}">Editar</button>
                                    <button class="btn-danger btn-small" data-attendance-delete="${escapeHTML(item.id)}">Eliminar</button>
                                </div>
                            </article>
                        `;
                    }).join('') : '<div class="dashboard-empty-note"><strong>No hay registros en este filtro.</strong><span>Cambia el filtro o registra una nueva clase.</span></div>'}
                </div>
            </section>

            <aside class="attendance-side">
                <section class="attendance-panel attendance-calendar-panel">
                    <h3>Calendario del mes</h3>
                    <div class="attendance-calendar-weekdays"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
                    <div class="attendance-calendar-grid">
                        ${calendarDays.map(cell => cell.empty ? '<span class="attendance-day empty"></span>' : `<span class="attendance-day ${cell.record ? `day-${getAttendanceStatusKey(cell.record.status)}` : ''}">${cell.day}</span>`).join('')}
                    </div>
                </section>

                <section class="attendance-panel attendance-subject-panel">
                    <h3>Seguimiento por materia</h3>
                    ${subjectStats.length ? subjectStats.map(item => `
                        <div class="attendance-subject-row">
                            <div>
                                <strong>${escapeHTML(item.subject)}</strong>
                                <span>${item.total} clases - ${item.present} presentes - ${item.absent} faltas</span>
                            </div>
                            <em>${item.percentage}%</em>
                            <div class="progress-bar"><div class="progress-fill" style="width:${item.percentage}%"></div></div>
                        </div>
                    `).join('') : '<p class="muted-panel">Cuando registres clases, aparecerán aquí.</p>'}
                </section>
            </aside>
        </div>
    `;

    container.querySelectorAll('[data-attendance-filter]').forEach(button => button.addEventListener('click', () => filterAttendance(button.dataset.attendanceFilter, button)));
    container.querySelectorAll('[data-attendance-edit]').forEach(button => button.addEventListener('click', () => openAttendanceForm(button.dataset.attendanceEdit)));
    container.querySelectorAll('[data-attendance-delete]').forEach(button => button.addEventListener('click', () => deleteAttendance(button.dataset.attendanceDelete)));
}

function attendanceStatCard(type, label, value) {
    return `
        <div class="attendance-stat-card stat-${type}">
            <span class="attendance-stat-icon" aria-hidden="true"></span>
            <div>
                <strong>${escapeHTML(value)}</strong>
                <p>${escapeHTML(label)}</p>
            </div>
        </div>
    `;
}

function addResourceUI() {
    const workspace = loadWorkspace();
    const subjectOptions = workspace.subjects.length ? workspace.subjects.map(subject => subject.name) : ['General'];
    openQuickForm({
        title: 'Subir apunte simulado',
        submitLabel: 'Guardar apunte',
        fields: [
            { name: 'title', label: 'Título', placeholder: 'Ej: Apunte de biologia' },
            { name: 'subject', label: 'Materia', type: 'select', options: subjectOptions },
            { name: 'content', label: 'Contenido del apunte', type: 'textarea', placeholder: 'Escribe aquí el contenido del apunte...' }
        ],
        onSubmit: values => {
            const fresh = loadWorkspace();
            fresh.resources.push({
                id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
                title: values.title.trim(),
                subject: values.subject,
                content: values.content.trim(),
                usedAI: false
            });
            addXP(fresh, 20);
            addRecent(fresh, `Subiste el apunte ${values.title.trim()}.`);
            saveWorkspace(fresh);
            refreshWorkspaceUI();
            notify('Apunte guardado en la mochila digital.', 'success');
        }
    });
}

function renderBackpack(workspace) {
    const section = document.getElementById('backpack');
    const container = document.querySelector('.backpack-container');
    if (!section || !container) return;

    const header = section.querySelector('.section-header');
    if (header && !header.querySelector('[data-action="add-resource"]')) {
        header.insertAdjacentHTML('beforeend', '<button class="btn-primary btn-small" data-action="add-resource" onclick="addResourceUI()">+ Subir apunte</button>');
    }

    container.innerHTML = workspace.resources.length ? workspace.resources.map(resource => `
        <div class="resource-card">
            ${appIconHTML('file', 'resource-icon resource-pdf-icon pdf-icon material-icon')}
            <h4>${escapeHTML(resource.title)}</h4>
            <p class="resource-type">${escapeHTML(resource.subject)}  Apunte simulado</p>
            <p class="resource-date">${escapeHTML(resource.content).slice(0, 120)}${resource.content.length > 120 ? '...' : ''}</p>
            <div class="resource-actions resource-actions-grid">
                <button class="btn-secondary btn-small" data-resource-view="${escapeHTML(resource.id)}">Ver</button>
                <button class="btn-secondary btn-small" data-resource-ai="${escapeHTML(resource.id)}">Preguntar a la IA</button>
            </div>
        </div>
    `).join('') : emptyStateHTML('No has subido apuntes todavía.', 'Subir primer apunte', 'addResourceUI()');

    container.querySelectorAll('[data-resource-view]').forEach(button => {
        button.addEventListener('click', () => {
            const resource = workspace.resources.find(item => item.id === button.dataset.resourceView);
            if (resource) openResource(resource.title);
        });
    });

    container.querySelectorAll('[data-resource-ai]').forEach(button => {
        button.addEventListener('click', () => askAIAboutResource(button.dataset.resourceAi));
    });
}

function askAIAboutResource(resourceId) {
    const workspace = loadWorkspace();
    const resource = workspace.resources.find(item => item.id === resourceId);
    if (!resource) return;

    resource.usedAI = true;
    addXP(workspace, 30);
    addRecent(workspace, `Usaste la IA con el apunte ${resource.title}.`);
    saveWorkspace(workspace);
    refreshWorkspaceUI();

    navigateTo('ai-assistant');
    const topic = document.getElementById('ai-topic');
    if (topic) {
        topic.value = `Analiza este apunte de ${resource.subject}: ${resource.title}\n\n${resource.content}`;
    }
    showAIResult('Análisis IA del apunte', buildAIResponse('explicacion', topic?.value || resource.content));
    notify('El apunte fue cargado en el asistente IA.', 'success');
}

function getAIInput() {
    return document.getElementById('ai-topic')?.value.trim() || '';
}

function buildAIResponse(type, topic) {
    const reference = topic.length > 380 ? `${topic.slice(0, 380)}...` : topic;
    const prefix = topic.includes('Analiza este apunte') ? 'Usando el apunte cargado como referencia simulada' : 'Usando el tema escrito por el estudiante';

    if (type === 'questions') {
        return `${prefix}:\n\n1. Cuál es la idea principal?\n2. Qué conceptos debes memorizar?\n3. Cómo se aplica en un ejemplo?\n4. Qué duda le preguntarias al profesor?\n\nReferencia:\n${reference}`;
    }

    if (type === 'flashcards') {
        return `${prefix}:\n\nTarjeta 1\nPregunta: Qué significa el contenido?\nRespuesta: Explicalo con tus palabras.\n\nTarjeta 2\nPregunta: Cuál es el dato mas importante?\nRespuesta: Identifica la información central.\n\nTarjeta 3\nPregunta: Cómo lo usarias?\nRespuesta: Crea un ejemplo corto.\n\nReferencia:\n${reference}`;
    }

    if (type === 'simple') {
        return `${prefix}:\n\nExplicación sencilla:\nLee el contenido, ubica la información mas importante y practica con un ejemplo propio.\n\nReferencia:\n${reference}`;
    }

    return `${prefix}:\n\nResumen:\nEl contenido se organiza en información principal, ejemplos y posibles preguntas de examen.\n\nReferencia:\n${reference}`;
}

function generateSummary() {
    const topic = getAIInput();
    if (!topic) {
        notify('Ingresa un tema o pega un texto corto para resumir.', 'error');
        return;
    }
    showAIResult('Resumen generado', buildAIResponse('summary', topic));
}

function generateQuestions() {
    const topic = getAIInput();
    if (!topic) {
        notify('Ingresa un tema o carga un apunte desde la mochila digital.', 'error');
        return;
    }
    showAIResult('Preguntas de práctica', buildAIResponse('questions', topic));
}

function generateFlashcards() {
    const topic = getAIInput();
    if (!topic) {
        notify('Ingresa un tema o carga un apunte desde la mochila digital.', 'error');
        return;
    }
    showAIResult('Flashcards generadas', buildAIResponse('flashcards', topic));
}

function generateSimpleExplanation() {
    const topic = getAIInput();
    if (!topic) {
        notify('Ingresa un tema o carga un apunte desde la mochila digital.', 'error');
        return;
    }
    showAIResult('Explicación sencilla', buildAIResponse('simple', topic));
}

// ============================================
// GESTIÓN ACADÉMICA AVANZADA
// ============================================

let gradeSortMode = 'subject';

const subjectColorMap = {
    Morado: '#7c3aed',
    Azul: '#2563eb',
    Rosado: '#ec4899',
    Cian: '#06b6d4',
    Verde: '#22c55e',
    Amarillo: '#f59e0b',
    Rojo: '#ef4444',
    Naranja: '#f97316'
};

const subjectColorOptions = [
    { value: 'Azul', label: 'Azul', tone: '#2563eb' },
    { value: 'Morado', label: 'Morado', tone: '#7c3aed' },
    { value: 'Verde', label: 'Verde', tone: '#22c55e' },
    { value: 'Rojo', label: 'Rojo', tone: '#ef4444' },
    { value: 'Naranja', label: 'Naranja', tone: '#f97316' },
    { value: 'Amarillo', label: 'Amarillo', tone: '#f59e0b' },
    { value: 'Rosado', label: 'Rosa', tone: '#ec4899' }
];

const subjectBookOptions = [
    { value: 'math', label: 'Matematicas', iconClass: 'choice-icon-math' },
    { value: 'chemistry', label: 'Química', iconClass: 'choice-icon-chemistry' },
    { value: 'history', label: 'Historia', iconClass: 'choice-icon-history' },
    { value: 'programming', label: 'Programación', iconClass: 'choice-icon-programming' },
    { value: 'robotics', label: 'Robotica', iconClass: 'choice-icon-robotics' },
    { value: 'literature', label: 'Literatura', iconClass: 'choice-icon-literature' },
    { value: 'sports', label: 'Educacion física', iconClass: 'choice-icon-sports' },
    { value: 'art', label: 'Arte', iconClass: 'choice-icon-art' },
    { value: 'biology', label: 'Biologia', iconClass: 'choice-icon-biology' },
    { value: 'book-blue', label: 'Libro azul', iconClass: 'choice-icon-book' }
];

let subjectFilterText = '';
let subjectSortMode = 'name';
let backpackFilterText = '';
let backpackSubjectFilter = 'all';
let backpackTypeFilter = 'all';
let backpackSortMode = 'recent';

const taskPriorityOptions = [
    { value: 'alta', label: 'Importante' },
    { value: 'media', label: 'Normal' },
    { value: 'baja', label: 'Más tarde' }
];

const taskStatusOptions = [
    { value: 'pending', label: 'Pendiente ahora' },
    { value: 'upcoming', label: 'Próxima / más tarde' },
    { value: 'completed', label: 'Completada' }
];

let currentTaskFilter = 'all';

const eventTypeOptions = [
    { value: 'examen', label: 'Examen' },
    { value: 'tarea', label: 'Tarea' },
    { value: 'exposición', label: 'Exposición' },
    { value: 'recordatorio', label: 'Recordatorio' }
];

const attendanceStatusOptions = [
    { value: 'Asisti', label: 'Presente', tone: '#00c875', iconClass: 'choice-icon-present' },
    { value: 'Falta', label: 'Falta', tone: '#fd71af', iconClass: 'choice-icon-absent' },
    { value: 'Atraso', label: 'Atraso', tone: '#ffc800', iconClass: 'choice-icon-late' },
    { value: 'Justificado', label: 'Justificado', tone: '#49ccf9', iconClass: 'choice-icon-justified' }
];

let currentAttendanceFilter = 'all';

function createId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getSubjectOptions(workspace) {
    return workspace.subjects.length ? workspace.subjects.map(subject => subject.name) : ['General'];
}

async function getCurrentSupabaseUser() {
    const sb = getSupabaseClient();
    const { data, error } = await sb.auth.getUser();
    if (error) {
        logSupabaseError('auth getUser', error);
        throw error;
    }
    if (!data.user) throw new Error('Inicia sesión para guardar datos en Supabase.');

    if (!currentUser || currentUser.id !== data.user.id) {
        currentUser = getPublicUserFromAuth(data.user, profileState);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
    }

    return data.user;
}

function findSubjectByName(workspace, subjectName = '') {
    const normalized = normalizeTutorText(subjectName);
    if (!normalized || normalized === 'general') return null;
    return workspace.subjects.find(subject => normalizeTutorText(subject.name) === normalized) || null;
}

function getSubjectNameById(subjects, subjectId = '') {
    return subjects.find(subject => subject.id === subjectId)?.name || '';
}

function getSubjectAverage(workspace, subjectName) {
    const grades = workspace.grades.filter(grade => grade.subject === subjectName);
    if (!grades.length) return 0;
    return grades.reduce((sum, grade) => sum + Number(grade.value || 0), 0) / grades.length;
}

function getGradeStatus(value) {
    if (value >= 9) return 'excelente';
    if (value >= 7) return 'aprobado';
    return 'necesita mejorar';
}

function getTaskStatusLabel(status) {
    if (status === 'completed') return 'Completada';
    if (status === 'overdue') return 'Vencida';
    if (status === 'upcoming') return 'Próxima / más tarde';
    return 'Pendiente ahora';
}

function getTaskPriorityLabel(priority) {
    if (priority === 'alta') return 'Alta';
    if (priority === 'baja') return 'Baja';
    if (priority === 'normal') return 'Normal';
    return 'Media';
}

function normalizeDate(value) {
    if (!value) return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10);
}

function getTodayStart() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

function parseTaskDate(value) {
    if (!value) return null;
    const parsed = new Date(`${normalizeDate(value)}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getTaskDaysRemaining(task) {
    const dueDate = parseTaskDate(task.due);
    if (!dueDate) return null;
    return Math.ceil((dueDate.getTime() - getTodayStart().getTime()) / 86400000);
}

function getTaskVisualStatus(task) {
    if (task.status === 'completed') return 'completed';
    const days = getTaskDaysRemaining(task);
    if (days === null) return 'pending';
    if (days < 0) return 'overdue';
    if (days <= 3) return 'upcoming';
    return 'pending';
}

function getTaskDaysText(task) {
    const days = getTaskDaysRemaining(task);
    if (days === null) return 'Sin fecha limite';
    if (task.status === 'completed') return 'Completada';
    if (days < 0) return `Venció hace ${Math.abs(days)} ${Math.abs(days) === 1 ? 'día' : 'días'}`;
    if (days === 0) return 'Vence hoy';
    if (days === 1) return 'Falta 1 día';
    return `Faltan ${days} días`;
}

function getTaskPriorityClass(priority) {
    if (priority === 'alta') return 'high';
    if (priority === 'baja') return 'low';
    if (priority === 'normal') return 'normal';
    return 'medium';
}

function getTaskReminderAlert(task) {
    // Futuro backend: aqui se puede conectar Supabase + Gmail API para enviar recordatorios reales.
    const visualStatus = getTaskVisualStatus(task);
    if (!task.emailReminder || !task.email || task.status === 'completed') return '';
    if (visualStatus !== 'upcoming' && visualStatus !== 'overdue') return '';
    return `Se enviaria un recordatorio a ${task.email} para la tarea: ${task.title}`;
}

function isEventSoon(event) {
    const dateValue = `${event.date || event.day || ''}T${event.time || '00:00'}`;
    const eventDate = new Date(dateValue);
    if (Number.isNaN(eventDate.getTime())) return false;
    const now = new Date();
    const diff = eventDate.getTime() - now.getTime();
    return diff >= 0 && diff <= 1000 * 60 * 60 * 48;
}

function getReminderMessage(event) {
    if (!event.emailReminder || !event.email) return '';
    return `Se enviaria un correo a ${event.email} recordando el evento.`;
}

function addSubjectUI() {
    openSubjectForm();
}

function openSubjectForm(subjectId = null) {
    const workspace = loadWorkspace();
    const subject = workspace.subjects.find(item => item.id === subjectId);

    openQuickForm({
        title: subject ? 'Editar materia' : 'Crear materia',
        submitLabel: subject ? 'Actualizar materia' : 'Guardar materia',
        fields: [
            { name: 'name', label: 'Nombre de la materia', value: subject?.name || '', placeholder: 'Ej: Matemática' },
            { name: 'icon', label: 'Icono o etiqueta', value: subject?.icon || '', placeholder: 'Ej: FIS, PROG' },
            { name: 'color', label: 'Color identificador', type: 'select', options: subjectColorOptions, value: subject?.color || 'Morado' }
        ],
        onSubmit: values => {
            const fresh = loadWorkspace();
            if (subjectId) {
                const item = fresh.subjects.find(entry => entry.id === subjectId);
                if (item) {
                    const oldName = item.name;
                    item.name = values.name.trim();
                    item.icon = values.icon.trim() || '';
                    item.color = values.color || 'Morado';
                    fresh.tasks.forEach(task => {
                        if (task.subject === oldName) task.subject = item.name;
                    });
                    fresh.grades.forEach(grade => {
                        if (grade.subject === oldName) grade.subject = item.name;
                    });
                    fresh.resources.forEach(resource => {
                        if (resource.subject === oldName) resource.subject = item.name;
                    });
                    addRecent(fresh, `Editaste la materia ${item.name}.`);
                }
            } else {
                fresh.subjects.push({
                    id: createId(),
                    name: values.name.trim(),
                    icon: values.icon.trim() || '',
                    color: values.color || 'Morado',
                    createdAt: new Date().toISOString()
                });
                addXP(fresh, 30);
                addRecent(fresh, `Creaste la materia ${values.name.trim()}.`);
            }
            saveWorkspace(fresh);
            refreshWorkspaceUI();
            notify(subjectId ? 'Materia actualizada.' : 'Materia creada correctamente.', 'success');
        }
    });
}

function deleteSubject(subjectId) {
    const workspace = loadWorkspace();
    const subject = workspace.subjects.find(item => item.id === subjectId);
    if (!subject) return;

    workspace.subjects = workspace.subjects.filter(item => item.id !== subjectId);
    workspace.tasks = workspace.tasks.filter(task => task.subject !== subject.name);
    workspace.grades = workspace.grades.filter(grade => grade.subject !== subject.name);
    workspace.resources = workspace.resources.filter(resource => resource.subject !== subject.name);
    addRecent(workspace, `Eliminaste la materia ${subject.name}.`);
    saveWorkspace(workspace);
    refreshWorkspaceUI();
    notify('Materia eliminada junto con sus datos relacionados.', 'info');
}

function renderSubjects(workspace) {
    const grid = document.querySelector('.subjects-grid');
    if (!grid) return;

    grid.innerHTML = workspace.subjects.length ? workspace.subjects.map(subject => {
        const taskCount = workspace.tasks.filter(task => task.subject === subject.name).length;
        const completed = workspace.tasks.filter(task => task.subject === subject.name && task.status === 'completed').length;
        const progress = taskCount ? Math.round((completed / taskCount) * 100) : 0;
        const average = getSubjectAverage(workspace, subject.name);
        const color = subjectColorMap[subject.color] || subjectColorMap.Morado;
        return `
            <div class="subject-card subject-custom ac-colored-card" style="--subject-color:${color}">
                <div class="subject-header">
                    <h3><span class="subject-icon"></span> ${escapeHTML(subject.name)}</h3>
                    <span class="subject-chip">${escapeHTML(subject.color || 'Morado')}</span>
                </div>
                <div class="subject-stats">
                    <div class="stat"><span class="stat-name">Progreso</span><span class="stat-num">${progress}%</span></div>
                    <div class="stat"><span class="stat-name">Tareas</span><span class="stat-num">${taskCount}</span></div>
                    <div class="stat"><span class="stat-name">Promedio</span><span class="stat-num">${average ? average.toFixed(2) : '--'}</span></div>
                </div>
                <div class="progress-bar"><div class="progress-fill" style="width:${progress}%; background:linear-gradient(90deg, ${color}, #06b6d4)"></div></div>
                <p class="last-activity">${taskCount ? `${completed} de ${taskCount} tareas completadas` : 'Sin tareas relacionadas todavía'}</p>
                <div class="card-actions">
                    <button class="btn-secondary btn-small" data-subject-edit="${escapeHTML(subject.id)}">Editar</button>
                    <button class="btn-danger btn-small" data-subject-delete="${escapeHTML(subject.id)}">Eliminar</button>
                </div>
            </div>
        `;
    }).join('') : emptyStateHTML('No tienes materias registradas todavía.', 'Crear primera materia', 'addSubjectUI()');

    grid.querySelectorAll('[data-subject-edit]').forEach(button => button.addEventListener('click', () => openSubjectForm(button.dataset.subjectEdit)));
    grid.querySelectorAll('[data-subject-delete]').forEach(button => button.addEventListener('click', () => deleteSubject(button.dataset.subjectDelete)));
}

function addTaskUI() {
    openTaskForm();
}

function openTaskForm(taskId = null) {
    const workspace = loadWorkspace();
    const task = workspace.tasks.find(item => item.id === taskId);
    openQuickForm({
        title: task ? 'Editar tarea' : 'Crear tarea',
        submitLabel: task ? 'Actualizar tarea' : 'Guardar tarea',
        fields: [
            { name: 'title', label: 'Título', value: task?.title || '', placeholder: 'Ej: Taller de funciones' },
            { name: 'subject', label: 'Materia', type: 'select', options: getSubjectOptions(workspace), value: task?.subject || '' },
            { name: 'description', label: 'Descripción', type: 'textarea', value: task?.description || '', placeholder: 'Detalles de la tarea' },
            { name: 'due', label: 'Fecha límite', type: 'date', value: normalizeDate(task?.due) },
            { name: 'priority', label: 'Prioridad', type: 'select', options: taskPriorityOptions, value: task?.priority || 'media' },
            { name: 'emailReminder', label: 'Recordarme por Gmail', type: 'checkbox', checked: !!task?.emailReminder, required: false, help: 'Mostrar alerta visual cuando esté próxima a vencer' },
            { name: 'email', label: 'Correo para notificación', type: 'email', value: task?.email || currentUser?.email || '', required: false, placeholder: 'usuario@gmail.com' }
        ],
        onSubmit: values => {
            const fresh = loadWorkspace();
            if (taskId) {
                const item = fresh.tasks.find(entry => entry.id === taskId);
                if (item) {
                    Object.assign(item, values, {
                        title: values.title.trim(),
                        description: values.description.trim(),
                        due: values.due,
                        priority: values.priority || 'media',
                        emailReminder: values.emailReminder === 'yes',
                        email: values.email.trim(),
                        status: item.status === 'completed' ? 'completed' : 'pending'
                    });
                }
                addRecent(fresh, `Editaste la tarea ${values.title.trim()}.`);
            } else {
                fresh.tasks.push({
                    id: createId(),
                    title: values.title.trim(),
                    subject: values.subject,
                    description: values.description.trim(),
                    due: values.due,
                    priority: values.priority || 'media',
                    emailReminder: values.emailReminder === 'yes',
                    email: values.email.trim(),
                    status: 'pending'
                });
                addXP(fresh, 15);
                addRecent(fresh, `Agregaste la tarea ${values.title.trim()}.`);
            }
            saveWorkspace(fresh);
            refreshWorkspaceUI();
            notify(taskId ? 'Tarea actualizada.' : 'Tarea creada correctamente.', 'success');
        }
    });
}

function deleteTask(taskId) {
    const workspace = loadWorkspace();
    const task = workspace.tasks.find(item => item.id === taskId);
    workspace.tasks = workspace.tasks.filter(item => item.id !== taskId);
    if (task) addRecent(workspace, `Eliminaste la tarea ${task.title}.`);
    saveWorkspace(workspace);
    refreshWorkspaceUI();
    notify('Tarea eliminada.', 'info');
}

function completeTask(taskId) {
    const workspace = loadWorkspace();
    const task = workspace.tasks.find(item => item.id === taskId);
    if (!task) return;
    task.status = 'completed';
    addXP(workspace, 25);
    addRecent(workspace, `Completaste la tarea ${task.title}.`);
    saveWorkspace(workspace);
    refreshWorkspaceUI();
    notify('Tarea marcada como completada.', 'success');
}

function getTaskGoogleCalendarUrl(task) {
    // Futuro backend: este enlace puede reemplazarse por Google Calendar API con OAuth del usuario.
    const date = normalizeDate(task.due) || normalizeDate(new Date().toISOString());
    const start = toGoogleCalendarDate(date, '08:00');
    const end = toGoogleCalendarDate(date, '09:00');
    const details = [
        task.description || 'Tarea académica creada en AC Edunity.',
        `Materia: ${task.subject || 'General'}`,
        `Prioridad: ${getTaskPriorityLabel(task.priority || 'media')}`
    ].join('\n');

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(task.title)}&dates=${start}/${end}&details=${encodeURIComponent(details)}&sf=true&output=xml`;
}

function openTaskInGoogleCalendar(taskId) {
    const workspace = loadWorkspace();
    const task = workspace.tasks.find(item => item.id === taskId);
    if (!task) return;
    const opened = window.open(getTaskGoogleCalendarUrl(task), '_blank', 'noopener,noreferrer');
    if (!opened) {
        notify('Permite ventanas emergentes para abrir Google Calendar.', 'info');
    }
}

function renderTasks(workspace) {
    const list = document.getElementById('tasks-list');
    if (!list) return;

    if (!workspace.tasks.length) {
        list.innerHTML = emptyStateHTML('No tienes tareas todavía. Crea tu primera tarea para organizar tus estudios.', '+ Crear tarea', 'addTaskUI()');
        return;
    }

    const counts = {
        all: workspace.tasks.length,
        pending: workspace.tasks.filter(task => getTaskVisualStatus(task) === 'pending').length,
        upcoming: workspace.tasks.filter(task => getTaskVisualStatus(task) === 'upcoming').length,
        completed: workspace.tasks.filter(task => getTaskVisualStatus(task) === 'completed').length,
        overdue: workspace.tasks.filter(task => getTaskVisualStatus(task) === 'overdue').length
    };
    const filteredTasks = workspace.tasks
        .map(task => ({ ...task, visualStatus: getTaskVisualStatus(task) }))
        .filter(task => currentTaskFilter === 'all' || task.visualStatus === currentTaskFilter)
        .sort((a, b) => {
            if (a.visualStatus === 'overdue' && b.visualStatus !== 'overdue') return -1;
            if (a.visualStatus !== 'overdue' && b.visualStatus === 'overdue') return 1;
            const dateA = parseTaskDate(a.due)?.getTime() || Number.MAX_SAFE_INTEGER;
            const dateB = parseTaskDate(b.due)?.getTime() || Number.MAX_SAFE_INTEGER;
            return dateA - dateB;
        });

    const filterTabs = [
        ['all', 'Todas'],
        ['pending', 'Pendientes'],
        ['upcoming', 'Próximas'],
        ['completed', 'Completadas'],
        ['overdue', 'Vencidas']
    ];

    list.innerHTML = `
        <div class="task-filter task-filter-modern">
            ${filterTabs.map(([key, label]) => `
                <button class="filter-btn ${currentTaskFilter === key ? 'active' : ''}" type="button" data-task-filter="${key}">
                    ${label}<span>${counts[key]}</span>
                </button>
            `).join('')}
        </div>
        <div class="task-summary-strip">
            <div><strong>${counts.pending}</strong><span>Pendientes</span></div>
            <div><strong>${counts.upcoming}</strong><span>Próximas</span></div>
            <div><strong>${counts.completed}</strong><span>Completadas</span></div>
            <div><strong>${counts.overdue}</strong><span>Vencidas</span></div>
        </div>
        <div class="task-board task-list-modern">
            ${filteredTasks.length ? filteredTasks.map(task => {
                const visualStatus = task.visualStatus;
                const reminder = getTaskReminderAlert(task);
                const priorityClass = getTaskPriorityClass(task.priority || 'media');
                const taskSubject = workspace.subjects.find(subject => subject.id === task.subjectId || subject.name === task.subject);
                const subjectColor = getAcademicColorValue(taskSubject?.color);
                const actionLayoutClass = task.status !== 'completed' ? 'has-complete' : 'no-complete';
                return `
                    <article class="task-item task-card-modern priority-${priorityClass}" style="${getAcademicCardStyle(subjectColor)}" data-status="${escapeHTML(visualStatus)}" data-id="${escapeHTML(task.id)}">
                        ${neonLinesHTML()}
                        <div class="task-card-main">
                            <label class="task-checkbox task-check-modern" title="Marcar como completada">
                                <input type="checkbox" onclick="toggleTask(this)" ${task.status === 'completed' ? 'checked' : ''}>
                                <span></span>
                            </label>
                            <div class="task-content">
                                <div class="task-title-row">
                                    <h4>${escapeHTML(task.title)}</h4>
                                    <span class="task-status status-${escapeHTML(visualStatus)}">${escapeHTML(getTaskStatusLabel(visualStatus))}</span>
                                </div>
                                <p class="task-subject" style="color:${subjectColor}">${escapeHTML(task.subject || 'General')}</p>
                                <p class="task-description">${escapeHTML(task.description || 'Sin descripción registrada.')}</p>
                                <div class="task-meta-grid">
                                    <span><strong>Fecha:</strong> ${escapeHTML(task.due || 'Sin fecha')}</span>
                                    <span><strong>Tiempo:</strong> ${escapeHTML(getTaskDaysText(task))}</span>
                                    <span><strong>Prioridad:</strong> <em class="task-priority ${priorityClass}">${escapeHTML(getTaskPriorityLabel(task.priority || 'media'))}</em></span>
                                    <span><strong>Gmail:</strong> ${task.emailReminder ? escapeHTML(task.email || 'correo pendiente') : 'Sin recordatorio'}</span>
                                </div>
                                ${reminder ? `<div class="task-reminder-alert">${escapeHTML(reminder)}</div>` : ''}
                            </div>
                        </div>
                        <div class="task-card-actions ${actionLayoutClass}">
                            <button class="btn-secondary btn-small" data-task-edit="${escapeHTML(task.id)}">Editar</button>
                            ${task.status !== 'completed' ? `<button class="btn-primary btn-small" data-task-complete="${escapeHTML(task.id)}">Completar</button>` : ''}
                            <button class="btn-secondary btn-small" data-task-calendar="${escapeHTML(task.id)}">Google Calendar</button>
                            <button class="btn-danger btn-small" data-task-delete="${escapeHTML(task.id)}">Eliminar</button>
                        </div>
                    </article>
                `;
            }).join('') : '<div class="dashboard-empty-note task-empty-filter"><strong>No hay tareas en este filtro.</strong><span>Cambia de filtro o crea una nueva tarea.</span></div>'}
        </div>
    `;

    list.querySelectorAll('[data-task-filter]').forEach(button => button.addEventListener('click', () => filterTasks(button.dataset.taskFilter, button)));
    list.querySelectorAll('[data-task-edit]').forEach(button => button.addEventListener('click', () => openTaskForm(button.dataset.taskEdit)));
    list.querySelectorAll('[data-task-delete]').forEach(button => button.addEventListener('click', () => deleteTask(button.dataset.taskDelete)));
    list.querySelectorAll('[data-task-complete]').forEach(button => button.addEventListener('click', () => completeTask(button.dataset.taskComplete)));
    list.querySelectorAll('[data-task-calendar]').forEach(button => button.addEventListener('click', () => openTaskInGoogleCalendar(button.dataset.taskCalendar)));
}

function addCalendarEventUI() {
    openEventForm();
}

function toGoogleCalendarDate(date, time) {
    if (!date) return '';
    const cleanTime = time || '08:00';
    return `${date.replaceAll('-', '')}T${cleanTime.replace(':', '')}00`;
}

function addMinutesToTime(time, minutes) {
    const [hours = 8, mins = 0] = (time || '08:00').split(':').map(Number);
    const date = new Date(2026, 0, 1, hours, mins + minutes, 0);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function getGoogleCalendarUrl(event) {
    const start = toGoogleCalendarDate(event.date, event.time || '08:00');
    const end = toGoogleCalendarDate(event.date, addMinutesToTime(event.time || '08:00', 60));
    const details = [
        `Evento creado desde AC Edunity.`,
        `Tipo: ${event.type || 'Evento académico'}.`,
        event.emailReminder ? 'Activa las notificaciones de Google Calendar para recibir avisos en correo y celular.' : ''
    ].filter(Boolean).join('\n');
    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: event.title || 'Evento AC Edunity',
        dates: `${start}/${end}`,
        details,
        trp: 'true'
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function openGoogleCalendarEvent(eventId) {
    const workspace = loadWorkspace();
    const event = workspace.events.find(item => item.id === eventId);
    if (!event) return;
    if (!event.date) {
        notify('Agrega una fecha antes de abrir Google Calendar.', 'error');
        return;
    }
    window.open(getGoogleCalendarUrl(event), '_blank', 'noopener');
    notify('Google Calendar se abrio con el evento listo para guardar.', 'info');
}

function openEventForm(eventId = null) {
    const workspace = loadWorkspace();
    const event = workspace.events.find(item => item.id === eventId);
    openQuickForm({
        title: event ? 'Editar evento' : 'Crear evento',
        submitLabel: event ? 'Actualizar evento' : 'Guardar evento',
        fields: [
            { name: 'title', label: 'Título del evento', value: event?.title || '', placeholder: 'Ej: Examen final' },
            { name: 'type', label: 'Tipo', type: 'select', options: eventTypeOptions, value: event?.type || 'recordatorio' },
            { name: 'subject', label: 'Materia', type: 'select', options: getSubjectOptions(workspace), value: event?.subject || 'General' },
            { name: 'date', label: 'Fecha', type: 'date', value: normalizeDate(event?.date) },
            { name: 'time', label: 'Hora', type: 'time', value: event?.time || '08:00' },
            { name: 'description', label: 'Descripción', type: 'textarea', rows: 3, value: event?.description || '', required: false, placeholder: 'Detalle del evento' },
            { name: 'email', label: 'Correo del usuario', type: 'email', value: event?.email || currentUser?.email || '', placeholder: 'usuario@email.com' },
            { name: 'emailReminder', label: 'Recordatorio por correo', type: 'checkbox', checked: Boolean(event?.emailReminder), help: 'Activar recordatorio por correo' },
            { name: 'googleCalendar', label: 'Abrir también en Google Calendar', type: 'checkbox', checked: !eventId, help: 'Se abrirá Google Calendar para guardar el evento y activar notificaciones reales.' }
        ],
        onSubmit: async values => {
            const fresh = loadWorkspace();
            const subject = findSubjectByName(fresh, values.subject);
            const payload = {
                title: values.title.trim(),
                type: values.type,
                subject: values.subject,
                subjectId: subject?.id || '',
                date: values.date,
                day: values.date,
                time: values.time,
                description: values.description?.trim() || '',
                email: values.email.trim(),
                emailReminder: values.emailReminder === 'yes',
                googleCalendar: values.googleCalendar === 'yes'
            };
            let savedEventId = eventId;

            try {
                const user = await getCurrentSupabaseUser();
                const eventData = {
                    user_id: user.id,
                    subject_id: subject?.id || null,
                    title: payload.title,
                    type: payload.type,
                    event_date: payload.date,
                    event_time: payload.time || null,
                    description: payload.description
                };
                console.log("[EVENTS] insertando evento", eventData);

                if (eventId) {
                    const { error } = await getSupabaseClient()
                        .from('events')
                        .update(eventData)
                        .eq('id', eventId)
                        .eq('user_id', user.id);

                    if (error) {
                        logSupabaseError('events update', error);
                        throw error;
                    }
                    pushRecentMessage(`Editaste el evento ${payload.title}.`);
                } else {
                    const { data, error } = await getSupabaseClient()
                        .from('events')
                        .insert(eventData)
                        .select()
                        .single();

                    if (error) {
                        logSupabaseError('events insert', error);
                        throw error;
                    }
                    savedEventId = data?.id || savedEventId;
                    await updateProfileProgress(20, { bumpStreak: true });
                    pushRecentMessage(`Agendaste ${payload.title}.`);
                }

                await syncWorkspaceFromSupabase();
                refreshWorkspaceUI();
                notify(payload.emailReminder ? getReminderMessage(payload) : 'Evento guardado correctamente.', 'success');
                if (payload.googleCalendar && savedEventId) {
                    openGoogleCalendarEvent(savedEventId);
                }
            } catch (error) {
                notify(error.message || 'No se pudo guardar el evento.', 'error');
            }

            // Futuro real: aqui se podria conectar EmailJS, un backend propio,
            // funciones de Supabase o servicios desplegados en Hostinger para enviar correos reales.
        }
    });
}

async function deleteEvent(eventId) {
    const workspace = loadWorkspace();
    const event = workspace.events.find(item => item.id === eventId);
    try {
        const user = await getCurrentSupabaseUser();
        const { error } = await getSupabaseClient()
            .from('events')
            .delete()
            .eq('id', eventId)
            .eq('user_id', user.id);

        if (error) {
            logSupabaseError('events delete', error);
            throw error;
        }

        if (event) pushRecentMessage(`Eliminaste el evento ${event.title}.`);
        await syncWorkspaceFromSupabase();
        refreshWorkspaceUI();
        notify('Evento eliminado.', 'info');
    } catch (error) {
        notify(error.message || 'No se pudo eliminar el evento.', 'error');
    }
}

function renderCalendarSection(workspace) {
    const container = document.querySelector('.calendar-container');
    if (!container) return;

    const events = [...workspace.events].sort((a, b) => `${a.date || ''} ${a.time || ''}`.localeCompare(`${b.date || ''} ${b.time || ''}`));
    container.innerHTML = `
        <div class="calendar-side">
            <div class="calendar-sync-card">
                <span class="calendar-sync-icon"></span>
                <h3>Conecta tus fechas con Google Calendar</h3>
                <p>Crea eventos en AC Edunity y abre Google Calendar para guardarlos con notificaciones en correo y celular.</p>
                <button class="btn-primary btn-small" type="button" onclick="addCalendarEventUI()">+ Crear evento</button>
            </div>
            <div class="calendar-mini" id="mini-calendar"></div>
        </div>
        <div class="events-list">
            <h3>Agenda académica</h3>
            <div id="custom-events-list">
                ${events.length ? events.map(event => {
                    const reminder = getReminderMessage(event);
                    return `
                        <div class="event-item event-custom ${isEventSoon(event) ? 'event-soon' : ''}">
                            <div class="event-date"><span class="day">${escapeHTML((event.date || event.day || '--').slice(-2))}</span><span class="month">${escapeHTML((event.date || '').slice(5, 7) || 'AC')}</span></div>
                            <div class="event-content">
                                <h4>${escapeHTML(event.title)}</h4>
                                <p>${escapeHTML(event.date || 'Sin fecha')}  ${escapeHTML(event.time || 'Sin hora')}</p>
                                <span class="event-badge">${escapeHTML(event.type)}</span>
                                ${isEventSoon(event) ? '<p class="event-alert">Evento cercano</p>' : ''}
                                ${reminder ? `<p class="email-simulation">${escapeHTML(reminder)}</p>` : ''}
                                <div class="card-actions">
                                    <button class="btn-secondary btn-small google-calendar-btn" data-google-event="${escapeHTML(event.id)}">Google Calendar</button>
                                    <button class="btn-secondary btn-small" data-event-edit="${escapeHTML(event.id)}">Editar</button>
                                    <button class="btn-danger btn-small" data-event-delete="${escapeHTML(event.id)}">Eliminar</button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('') : emptyStateHTML('No tienes eventos programados.', 'Agendar evento', 'addCalendarEventUI()')}
            </div>
        </div>
    `;
    generateCalendar();
    container.querySelectorAll('[data-google-event]').forEach(button => button.addEventListener('click', () => openGoogleCalendarEvent(button.dataset.googleEvent)));
    container.querySelectorAll('[data-event-edit]').forEach(button => button.addEventListener('click', () => openEventForm(button.dataset.eventEdit)));
    container.querySelectorAll('[data-event-delete]').forEach(button => button.addEventListener('click', () => deleteEvent(button.dataset.eventDelete)));
}

function showAddGradeForm() {
    openGradeForm();
}

function getGradeItems(grade) {
    if (Array.isArray(grade?.items) && grade.items.length) {
        return grade.items
            .map(item => ({
                activity: item.activity || item.name || '',
                date: item.date || '',
                value: Number(item.value)
            }))
            .filter(item => !Number.isNaN(item.value));
    }

    if (grade && grade.value !== undefined && grade.value !== '') {
        return [{
            activity: grade.evaluation || 'Calificación',
            date: grade.date || '',
            value: Number(grade.value)
        }].filter(item => !Number.isNaN(item.value));
    }

    return [];
}

function getGradeFinalValue(grade) {
    const items = getGradeItems(grade);
    if (!items.length) return Number(grade?.value || 0);
    return items.reduce((sum, item) => sum + Number(item.value || 0), 0) / items.length;
}

function getFirstGradeItemDate(items = []) {
    return items.find(item => item.date)?.date || '';
}

function formatGradeValue(value) {
    const numeric = Number(value || 0);
    return numeric.toFixed(numeric % 1 === 0 ? 0 : 2).replace(/\.00$/, '');
}

const gradePeriods = [
    { value: 'p1', label: 'Periodo 1' },
    { value: 'p2', label: 'Periodo 2' },
    { value: 'p3', label: 'Periodo 3' }
];

const gradeCategories = [
    { value: 'partial1', label: 'Parcial 1' },
    { value: 'partial2', label: 'Parcial 2' },
    { value: 'exam', label: 'Examen del periodo' }
];

function getGradePeriod(grade) {
    return grade?.period || 'p1';
}

function getGradeCategory(grade) {
    if (grade?.category) return grade.category;
    const text = `${grade?.evaluation || ''}`.toLowerCase();
    if (text.includes('examen')) return 'exam';
    if (text.includes('parcial 2') || text.includes('parcial dos')) return 'partial2';
    return 'partial1';
}

function getGradeCategoryLabel(category) {
    return gradeCategories.find(item => item.value === category)?.label || 'Parcial 1';
}

function getGradePeriodLabel(period) {
    return gradePeriods.find(item => item.value === period)?.label || 'Periodo 1';
}

function averageNumbers(values) {
    const valid = values.filter(value => value !== null && !Number.isNaN(Number(value)));
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + Number(value), 0) / valid.length;
}

function getCategoryGrades(grades, period, category) {
    return grades.filter(grade => getGradePeriod(grade) === period && getGradeCategory(grade) === category);
}

function getCategoryAverage(grades, period, category) {
    const values = getCategoryGrades(grades, period, category).map(getGradeFinalValue);
    return averageNumbers(values);
}

function calculatePeriodAverage(partial1, partial2, exam) {
    const partialAverage = averageNumbers([partial1, partial2]);
    if (partialAverage !== null && exam !== null) return partialAverage * 0.70 + exam * 0.30;
    if (partialAverage !== null) return partialAverage;
    if (exam !== null) return exam;
    return null;
}

function getSubjectGradeSummary(grades) {
    const periods = gradePeriods.map(period => {
        const partial1 = getCategoryAverage(grades, period.value, 'partial1');
        const partial2 = getCategoryAverage(grades, period.value, 'partial2');
        const exam = getCategoryAverage(grades, period.value, 'exam');
        const average = calculatePeriodAverage(partial1, partial2, exam);
        return { ...period, partial1, partial2, exam, average };
    });
    const average = averageNumbers(periods.map(period => period.average));
    return { periods, average };
}

function openGradeForm(gradeId = null, defaults = {}) {
    const workspace = loadWorkspace();
    const grade = workspace.grades.find(item => item.id === gradeId);
    const selectedPeriod = grade ? getGradePeriod(grade) : (defaults.period || 'p1');
    const selectedCategory = grade ? getGradeCategory(grade) : (defaults.category || 'partial1');
    const selectedSubject = grade?.subject || defaults.subject || '';
    const suggestedEvaluation = `${getGradeCategoryLabel(selectedCategory)} - ${getGradePeriodLabel(selectedPeriod)}`;
    const subjectOptions = getSubjectOptions(workspace).map(option => {
        const value = typeof option === 'string' ? option : option.value;
        const label = typeof option === 'string' ? option : option.label;
        return `<option value="${escapeHTML(value)}" ${String(selectedSubject) === String(value) ? 'selected' : ''}>${escapeHTML(label)}</option>`;
    }).join('');
    const periodOptions = gradePeriods.map(option => `<option value="${option.value}" ${selectedPeriod === option.value ? 'selected' : ''}>${option.label}</option>`).join('');
    const categoryOptions = gradeCategories.map(option => `<option value="${option.value}" ${selectedCategory === option.value ? 'selected' : ''}>${option.label}</option>`).join('');
    const items = getGradeItems(grade);
    const initialItems = items.length ? items : [{ activity: '', date: '', value: '' }];

    const existingModal = document.querySelector('.quick-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.className = 'quick-modal';
    modal.innerHTML = `
        <div class="quick-modal-card grade-modal-card" role="dialog" aria-modal="true" aria-label="${grade ? 'Editar calificación' : 'Registrar calificación'}">
            <button class="quick-modal-close" type="button" aria-label="Cerrar">x</button>
            <h3>${grade ? 'Editar calificación' : 'Registrar calificación'}</h3>
            <form class="quick-modal-form grade-modal-form">
                <label>
                    <span>Materia</span>
                    <select name="subject" required>${subjectOptions}</select>
                </label>
                <div class="grade-period-row">
                    <label>
                        <span>Periodo</span>
                        <select name="period" required>${periodOptions}</select>
                    </label>
                    <label>
                        <span>Tipo de nota</span>
                        <select name="category" required>${categoryOptions}</select>
                    </label>
                </div>
                <label>
                    <span>Grupo de calificación</span>
                    <input name="evaluation" value="${escapeHTML(grade?.evaluation || suggestedEvaluation)}" placeholder="Ej: Tarea 100% del Parcial 1" required>
                </label>
                <div class="grade-items-builder">
                    <div class="grade-items-head">
                        <strong>Casilleros de actividades</strong>
                        <button type="button" class="btn-secondary btn-small" id="add-grade-item">+ Agregar casillero</button>
                    </div>
                    <div class="grade-items-list">
                        ${initialItems.map(item => `
                            <div class="grade-item-row">
                                <input name="itemActivity" value="${escapeHTML(item.activity || '')}" placeholder="Actividad: divisiones, suma, lectura..." required>
                                <input name="itemDate" type="date" value="${escapeHTML(normalizeDate(item.date))}">
                                <input name="itemValue" type="number" min="0" max="10" step="0.01" value="${item.value !== '' ? escapeHTML(String(item.value)) : ''}" placeholder="Nota" required>
                                <button type="button" class="remove-grade-item" aria-label="Quitar casillero">x</button>
                            </div>
                        `).join('')}
                    </div>
                    <div class="grade-calculated-average">Promedio: <strong>--</strong></div>
                </div>
                <label>
                    <span>Observacion</span>
                    <textarea name="observation" rows="3" placeholder="Comentario opcional">${escapeHTML(grade?.observation || '')}</textarea>
                </label>
                <div class="quick-modal-actions">
                    <button class="btn-primary btn-small" type="submit">${grade ? 'Actualizar calificación' : 'Guardar calificación'}</button>
                </div>
            </form>
        </div>
    `;

    const closeModal = () => modal.remove();
    const list = modal.querySelector('.grade-items-list');
    const averageOutput = modal.querySelector('.grade-calculated-average strong');
    const rowTemplate = () => {
        const row = document.createElement('div');
        row.className = 'grade-item-row';
        row.innerHTML = `
            <input name="itemActivity" placeholder="Actividad: divisiones, suma, lectura..." required>
            <input name="itemDate" type="date">
            <input name="itemValue" type="number" min="0" max="10" step="0.01" placeholder="Nota" required>
            <button type="button" class="remove-grade-item" aria-label="Quitar casillero">x</button>
        `;
        return row;
    };

    const updateAveragePreview = () => {
        const values = Array.from(list.querySelectorAll('[name="itemValue"]'))
            .map(input => Number(input.value))
            .filter(value => !Number.isNaN(value));
        averageOutput.textContent = values.length ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2) : '--';
    };

    modal.addEventListener('click', event => {
        if (event.target === modal || event.target.classList.contains('quick-modal-close')) closeModal();
        if (event.target.id === 'add-grade-item') {
            list.appendChild(rowTemplate());
            updateAveragePreview();
        }
        if (event.target.classList.contains('remove-grade-item')) {
            if (list.children.length > 1) event.target.closest('.grade-item-row').remove();
            updateAveragePreview();
        }
    });

    modal.addEventListener('input', event => {
        if (event.target.name === 'itemValue') updateAveragePreview();
    });

    modal.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const submitButton = form.querySelector('button[type="submit"]');
        const originalButtonText = submitButton ? submitButton.textContent : '';
        const activities = Array.from(form.querySelectorAll('[name="itemActivity"]'));
        const dates = Array.from(form.querySelectorAll('[name="itemDate"]'));
        const values = Array.from(form.querySelectorAll('[name="itemValue"]'));
        const gradeItems = activities.map((input, index) => ({
            activity: input.value.trim(),
            date: dates[index].value,
            value: Number(values[index].value)
        })).filter(item => item.activity && !Number.isNaN(item.value));

        if (!gradeItems.length || gradeItems.some(item => item.value < 0 || item.value > 10)) {
            notify('Completa los casilleros con notas entre 0 y 10.', 'error');
            return;
        }

        const value = gradeItems.reduce((sum, item) => sum + item.value, 0) / gradeItems.length;
        const fresh = loadWorkspace();
        const subject = findSubjectByName(fresh, form.subject.value);
        const payload = {
            subject: form.subject.value,
            period: form.period.value,
            category: form.category.value,
            evaluation: form.evaluation.value.trim(),
            value,
            date: gradeItems[0]?.date || '',
            observation: form.observation.value.trim(),
            items: gradeItems
        };

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = 'Guardando...';
        }

        try {
            const user = await getCurrentSupabaseUser();
            const gradePayload = {
                user_id: user.id,
                subject_id: subject?.id || null,
                period: payload.period,
                category: payload.category,
                evaluation: payload.evaluation,
                final_value: Number(value.toFixed(2)),
                observation: payload.observation
            };
            console.log("[GRADES] guardando calificación", gradePayload);

            let savedGrade = null;
            if (gradeId) {
                const { data, error } = await getSupabaseClient()
                    .from('grades')
                    .update(gradePayload)
                    .eq('id', gradeId)
                    .eq('user_id', user.id)
                    .select()
                    .single();

                if (error) {
                    console.error("[GRADES ERROR]", error);
                    logSupabaseError('grades update', error);
                    throw error;
                }
                savedGrade = data;
                console.log("[GRADES] guardado correcto", data);

                const { error: deleteItemsError } = await getSupabaseClient()
                    .from('grade_items')
                    .delete()
                    .eq('grade_id', gradeId);

                if (deleteItemsError) {
                    console.error("[GRADES ERROR]", deleteItemsError);
                    logSupabaseError('grade_items delete before update', deleteItemsError);
                    throw deleteItemsError;
                }
                pushRecentMessage(`Editaste una calificación de ${payload.subject}.`);
            } else {
                const { data, error } = await getSupabaseClient()
                    .from('grades')
                    .insert(gradePayload)
                    .select()
                    .single();

                if (error) {
                    console.error("[GRADES ERROR]", error);
                    logSupabaseError('grades insert', error);
                    throw error;
                }
                savedGrade = data;
                console.log("[GRADES] guardado correcto", data);
                await updateProfileProgress(20, { bumpStreak: true });
                pushRecentMessage(`Registraste una calificación en ${payload.subject}.`);
            }

            const gradeItemPayload = gradeItems.map(item => ({
                grade_id: savedGrade.id,
                activity: item.activity,
                item_date: item.date || null,
                value: item.value
            }));
            console.log("[GRADE_ITEMS] guardando nota individual", gradeItemPayload);

            if (gradeItemPayload.length) {
                const { error: itemsError } = await getSupabaseClient()
                    .from('grade_items')
                    .insert(gradeItemPayload);

                if (itemsError) {
                    console.error("[GRADES ERROR]", itemsError);
                    logSupabaseError('grade_items insert', itemsError);
                    throw itemsError;
                }
            }

            await syncWorkspaceFromSupabase();
            refreshWorkspaceUI();
            closeModal();
            notify(gradeId ? 'Calificación actualizada.' : 'Calificación registrada.', 'success');
        } catch (error) {
            console.error("[GRADES ERROR]", error);
            notify(error.message || 'No se pudo guardar la calificación.', 'error');
        } finally {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = originalButtonText;
            }
        }
    });

    document.body.appendChild(modal);
    updateAveragePreview();
    modal.querySelector('input, textarea, select')?.focus();
}

async function deleteGrade(gradeId) {
    const workspace = loadWorkspace();
    const grade = workspace.grades.find(item => item.id === gradeId);
    try {
        const user = await getCurrentSupabaseUser();
        const { error: itemsError } = await getSupabaseClient()
            .from('grade_items')
            .delete()
            .eq('grade_id', gradeId);

        if (itemsError) {
            console.error("[GRADES ERROR]", itemsError);
            logSupabaseError('grade_items delete', itemsError);
            throw itemsError;
        }

        const { error } = await getSupabaseClient()
            .from('grades')
            .delete()
            .eq('id', gradeId)
            .eq('user_id', user.id);

        if (error) {
            console.error("[GRADES ERROR]", error);
            logSupabaseError('grades delete', error);
            throw error;
        }

        if (grade) pushRecentMessage(`Eliminaste una calificación de ${grade.subject}.`);
        await syncWorkspaceFromSupabase();
        refreshWorkspaceUI();
        notify('Calificación eliminada.', 'info');
    } catch (error) {
        console.error("[GRADES ERROR]", error);
        notify(error.message || 'No se pudo eliminar la calificación.', 'error');
    }
}

function openGradeBucket(subject, period, category) {
    const workspace = loadWorkspace();
    const grades = workspace.grades.filter(grade => (
        (grade.subject || 'General') === subject &&
        getGradePeriod(grade) === period &&
        getGradeCategory(grade) === category
    ));

    if (!grades.length) {
        openGradeForm(null, { subject, period, category });
        return;
    }

    const existingModal = document.querySelector('.quick-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.className = 'quick-modal';
    modal.innerHTML = `
        <div class="quick-modal-card grade-bucket-card" role="dialog" aria-modal="true" aria-label="Calificaciónes registradas">
            <button class="quick-modal-close" type="button" aria-label="Cerrar">x</button>
            <div class="grade-bucket-header">
                <div>
                    <h3>${escapeHTML(getGradeCategoryLabel(category))}</h3>
                    <p>${escapeHTML(subject)} - ${escapeHTML(getGradePeriodLabel(period))}</p>
                </div>
                <button class="btn-primary btn-small" type="button" data-grade-bucket-add>+ Agregar nota</button>
            </div>
            <div class="grade-bucket-list">
                ${grades.map(grade => {
                    const items = getGradeItems(grade);
                    const value = getGradeFinalValue(grade);
                    return `
                        <div class="grade-bucket-item">
                            <div>
                                <strong>${escapeHTML(grade.evaluation || 'Calificación')}</strong>
                                <span>${items.length} ${items.length === 1 ? 'casillero' : 'casilleros'} - Promedio ${formatGradeValue(value)}</span>
                            </div>
                            <div class="grade-bucket-actions">
                                <button class="btn-secondary btn-small" type="button" data-grade-bucket-edit="${escapeHTML(grade.id)}">Editar</button>
                                <button class="btn-danger btn-small" type="button" data-grade-bucket-delete="${escapeHTML(grade.id)}">Eliminar</button>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;

    const closeModal = () => modal.remove();
    modal.addEventListener('click', event => {
        if (event.target === modal || event.target.classList.contains('quick-modal-close')) closeModal();
        if (event.target.closest('[data-grade-bucket-add]')) {
            closeModal();
            openGradeForm(null, { subject, period, category });
        }
        const editButton = event.target.closest('[data-grade-bucket-edit]');
        if (editButton) {
            closeModal();
            openGradeForm(editButton.dataset.gradeBucketEdit);
        }
        const deleteButton = event.target.closest('[data-grade-bucket-delete]');
        if (deleteButton) {
            closeModal();
            deleteGrade(deleteButton.dataset.gradeBucketDelete);
        }
    });

    document.body.appendChild(modal);
}

function setGradeSort(mode) {
    gradeSortMode = mode;
    renderGrades(loadWorkspace());
}

function renderGrades(workspace) {
    const container = document.querySelector('.grades-container');
    if (!container) return;

    if (!workspace.grades.length) {
        container.innerHTML = emptyStateHTML('No has registrado calificaciones.', 'Agregar calificación', 'showAddGradeForm()');
        return;
    }

    const average = getAverageGrade(workspace);
    const grouped = workspace.grades.reduce((acc, grade) => {
        const subject = grade.subject || 'General';
        acc[subject] = acc[subject] || [];
        acc[subject].push(grade);
        return acc;
    }, {});

    const subjectRows = Object.entries(grouped).map(([subject, grades]) => {
        const summary = getSubjectGradeSummary(grades);
        return { subject, grades, summary, average: summary.average };
    }).sort((a, b) => a.subject.localeCompare(b.subject));

    if (gradeSortMode === 'high') subjectRows.sort((a, b) => (b.average || 0) - (a.average || 0));
    if (gradeSortMode === 'low') subjectRows.sort((a, b) => (a.average || 0) - (b.average || 0));

    const renderCell = (row, period, category = null) => {
        const value = category ? getCategoryAverage(row.grades, period.value, category) : period.average;
        const grades = category ? getCategoryGrades(row.grades, period.value, category) : [];
        const status = value === null ? 'empty' : getGradeStatus(value).replace(' ', '-');
        const label = category ? getGradeCategoryLabel(category) : period.label;
        const title = category ? `${row.subject} - ${period.label} - ${label}` : `${row.subject} - ${period.label}`;
        return `
            <button class="period-grade-cell ${status}" type="button" data-grade-add="true" data-subject="${escapeHTML(row.subject)}" data-period="${escapeHTML(period.value)}" data-category="${escapeHTML(category || 'partial1')}" title="${escapeHTML(title)}">
                <strong>${value === null ? '--' : formatGradeValue(value)}</strong>
                <span>${category ? (grades.length ? `${grades.length} nota${grades.length === 1 ? '' : 's'}` : 'Agregar') : 'Periodo'}</span>
            </button>
        `;
    };

    container.innerHTML = `
        <div class="grades-toolbar">
            <div class="grade-summary">
                <strong>Promedio general: ${average.toFixed(2)}</strong>
                <span class="grade-status ${getGradeStatus(average).replace(' ', '-')}">${getGradeStatus(average)}</span>
            </div>
            <div class="grade-formula-note">Fórmula: promedio de parciales 70% + examen 30%.</div>
            <select onchange="setGradeSort(this.value)">
                <option value="subject" ${gradeSortMode === 'subject' ? 'selected' : ''}>Ordenar por materia</option>
                <option value="high" ${gradeSortMode === 'high' ? 'selected' : ''}>Promedio mayor</option>
                <option value="low" ${gradeSortMode === 'low' ? 'selected' : ''}>Promedio menor</option>
            </select>
        </div>
        <div class="period-gradebook-panel">
            <div class="period-gradebook-table">
                <div class="period-head subject-head">Asignatura</div>
                <div class="period-head average-head">Promedio</div>
                ${gradePeriods.map(period => `
                    <div class="period-head period-average-head">${escapeHTML(period.label)}</div>
                    <div class="period-head partial-head">Parcial 1</div>
                    <div class="period-head partial-head">Parcial 2</div>
                    <div class="period-head exam-head">Examen</div>
                `).join('')}
                ${subjectRows.map(row => `
                    <div class="period-subject-cell">
                        <strong>${escapeHTML(row.subject)}</strong>
                        <small>${row.grades.length} ${row.grades.length === 1 ? 'calificación' : 'calificaciones'}</small>
                    </div>
                    <div class="period-average-cell ${row.average === null ? 'empty' : getGradeStatus(row.average).replace(' ', '-')}">
                        <strong>${row.average === null ? '--' : row.average.toFixed(2)}</strong>
                        <span>${row.average === null ? 'Sin datos' : getGradeStatus(row.average)}</span>
                    </div>
                    ${row.summary.periods.map(period => `
                        ${renderCell(row, period)}
                        ${renderCell(row, period, 'partial1')}
                        ${renderCell(row, period, 'partial2')}
                        ${renderCell(row, period, 'exam')}
                    `).join('')}
                `).join('')}
            </div>
        </div>
    `;

    container.querySelectorAll('[data-grade-add]').forEach(button => {
        button.addEventListener('click', () => openGradeBucket(
            button.dataset.subject,
            button.dataset.period,
            button.dataset.category
        ));
    });
}
function addResourceUI() {
    openResourceForm();
}

function openResourceForm(resourceId = null) {
    const workspace = loadWorkspace();
    const resource = workspace.resources.find(item => item.id === resourceId);
    openQuickForm({
        title: resource ? 'Editar PDF simulado' : 'Subir PDF simulado',
        submitLabel: resource ? 'Actualizar recurso' : 'Guardar recurso',
        fields: [
            { name: 'title', label: 'Título del recurso', value: resource?.title || '', placeholder: 'Ej: Guía de estudio' },
            { name: 'subject', label: 'Materia', type: 'select', options: getSubjectOptions(workspace), value: resource?.subject || '' },
            { name: 'file', label: 'Archivo PDF simulado', type: 'file', accept: '.pdf', required: !resource },
            { name: 'description', label: 'Descripción del apunte', type: 'textarea', value: resource?.description || resource?.content || '', placeholder: 'Describe de qué trata el PDF' }
        ],
        onSubmit: values => {
            const fresh = loadWorkspace();
            const fileName = values.file?.name || resource?.fileName || `${values.title.trim()}.pdf`;
            const payload = {
                title: values.title.trim(),
                subject: values.subject,
                fileName,
                description: values.description.trim(),
                content: values.description.trim(),
                type: 'PDF simulado'
            };

            if (resourceId) {
                const item = fresh.resources.find(entry => entry.id === resourceId);
                if (item) Object.assign(item, payload);
                addRecent(fresh, `Editaste el recurso ${payload.title}.`);
            } else {
                fresh.resources.push({ id: createId(), usedAI: false, ...payload });
                addXP(fresh, 20);
                addRecent(fresh, `Subiste el PDF simulado ${payload.title}.`);
            }
            saveWorkspace(fresh);
            refreshWorkspaceUI();
            notify(resourceId ? 'Recurso actualizado.' : 'PDF simulado guardado.', 'success');
        }
    });
}

async function deleteResource(resourceId) {
    const workspace = loadWorkspace();
    const resource = workspace.resources.find(item => item.id === resourceId);
    try {
        const user = await getCurrentSupabaseUser();
        const { error } = await getSupabaseClient()
            .from('resources')
            .delete()
            .eq('id', resourceId)
            .eq('user_id', user.id);

        if (error) {
            logSupabaseError('resources delete', error);
            throw error;
        }

        if (resource) pushRecentMessage(`Eliminaste el recurso ${resource.title}.`);
        await syncWorkspaceFromSupabase();
        refreshWorkspaceUI();
        notify('Recurso eliminado.', 'info');
    } catch (error) {
        notify(error.message || 'No se pudo eliminar el recurso.', 'error');
    }
}

function renderBackpack(workspace) {
    const section = document.getElementById('backpack');
    const container = document.querySelector('.backpack-container');
    if (!section || !container) return;

    const header = section.querySelector('.section-header');
    if (header && !header.querySelector('[data-action="add-resource"]')) {
        header.insertAdjacentHTML('beforeend', '<button class="btn-primary btn-small" data-action="add-resource" onclick="addResourceUI()">+ Subir PDF simulado</button>');
    }

    container.innerHTML = workspace.resources.length ? workspace.resources.map(resource => `
        <div class="resource-card">
            ${appIconHTML('file', 'resource-icon resource-pdf-icon pdf-icon material-icon')}
            <h4>${escapeHTML(resource.title)}</h4>
            <p class="resource-type">${escapeHTML(resource.subject)}  ${escapeHTML(resource.fileName || 'PDF simulado')}</p>
            <p class="resource-date">${escapeHTML(resource.description || resource.content || 'Sin descripción').slice(0, 130)}${(resource.description || resource.content || '').length > 130 ? '...' : ''}</p>
            <div class="resource-actions resource-actions-grid">
                <button class="btn-secondary btn-small" data-resource-view="${escapeHTML(resource.id)}">Ver</button>
                <button class="btn-secondary btn-small" data-resource-ai="${escapeHTML(resource.id)}">Preguntar a la IA</button>
                <button class="btn-secondary btn-small" data-resource-practice="${escapeHTML(resource.id)}">Practicar con PDF</button>
                <button class="btn-secondary btn-small" data-resource-edit="${escapeHTML(resource.id)}">Editar</button>
                <button class="btn-danger btn-small" data-resource-delete="${escapeHTML(resource.id)}">Eliminar</button>
            </div>
        </div>
    `).join('') : emptyStateHTML('No has subido apuntes todavía.', 'Subir primer PDF', 'addResourceUI()');

    container.querySelectorAll('[data-resource-view]').forEach(button => button.addEventListener('click', () => viewResource(button.dataset.resourceView)));
    container.querySelectorAll('[data-resource-ai]').forEach(button => button.addEventListener('click', () => askAIAboutResource(button.dataset.resourceAi)));
    container.querySelectorAll('[data-resource-practice]').forEach(button => button.addEventListener('click', () => practiceWithResource(button.dataset.resourcePractice)));
    container.querySelectorAll('[data-resource-edit]').forEach(button => button.addEventListener('click', () => openResourceForm(button.dataset.resourceEdit)));
    container.querySelectorAll('[data-resource-delete]').forEach(button => button.addEventListener('click', () => deleteResource(button.dataset.resourceDelete)));
}

function viewResource(resourceId) {
    const resource = loadWorkspace().resources.find(item => item.id === resourceId);
    if (!resource) return;
    showAIResult(`Vista simulada: ${resource.title}`, `Archivo: ${resource.fileName}\nMateria: ${resource.subject}\n\nDescripción:\n${resource.description || resource.content || 'Sin descripción'}\n\nNota: en una versión real aquí se abriría el PDF desde almacenamiento en Supabase, Hostinger o un backend propio.`);
    navigateTo('ai-assistant');
}

function markResourceAIUsed(resourceId, actionText) {
    const workspace = loadWorkspace();
    const resource = workspace.resources.find(item => item.id === resourceId);
    if (!resource) return null;
    resource.usedAI = true;
    addXP(workspace, 30);
    addRecent(workspace, actionText);
    saveWorkspace(workspace);
    refreshWorkspaceUI();
    return resource;
}

function askAIAboutResource(resourceId) {
    const resource = markResourceAIUsed(resourceId, 'Preguntaste a la IA sobre un PDF.');
    if (!resource) return;
    navigateTo('ai-assistant');
    setAIContextFromResource(resource);
    showAIResult('Respuesta de Tutor', buildResourceAIResponse(resource, 'summary'));
}

function practiceWithResource(resourceId) {
    const resource = markResourceAIUsed(resourceId, 'Iniciaste práctica con un PDF.');
    if (!resource) return;
    navigateTo('ai-assistant');
    setAIContextFromResource(resource);
    showAIResult('Zona de práctica con PDF', buildResourceAIResponse(resource, 'quiz'));
    notify('PDF cargado en la zona de estudio IA.', 'success');
}

function setAIContextFromResource(resource) {
    const topic = document.getElementById('ai-topic');
    if (topic) {
        topic.value = `PDF simulado: ${resource.title}\nMateria: ${resource.subject}\nArchivo: ${resource.fileName}\nDescripción: ${resource.description || resource.content}`;
    }
}

function buildResourceAIResponse(resource, type) {
    const base = `Basado en tu PDF de ${resource.subject}, "${resource.title}" (${resource.fileName}), `;
    const description = resource.description || resource.content || 'sin descripción detallada';

    if (type === 'quiz') {
        return `${base}aquí tienes 5 preguntas de practica:\n\n1. Cuál es la idea principal del PDF?\n2. Qué concepto se repite mas en el apunte?\n3. Cómo explicarias este tema a un companero?\n4. Qué ejemplo practico puedes crear?\n5. Qué pregunta podria aparecer en un examen?\n\nReferencia simulada: ${description}`;
    }
    if (type === 'open') {
        return `${base}aquí tienes preguntas abiertas:\n\n1. Explica con tus palabras el tema central.\n2. Relaciona el contenido con una clase anterior.\n3. Escribe una conclusion corta.\n\nReferencia simulada: ${description}`;
    }
    if (type === 'truefalse') {
        return `${base}practica verdadero/falso:\n\n1. El apunte tiene una idea principal identificable. (V)\n2. No es necesario repasar ejemplos. (F)\n3. Las definiciones ayudan a organizar el estudio. (V)\n4. El contenido no se puede convertir en preguntas. (F)\n\nReferencia simulada: ${description}`;
    }
    if (type === 'flashcards') {
        return `${base}flashcards sugeridas:\n\nTarjeta 1: Tema central / ${resource.title}\nTarjeta 2: Materia / ${resource.subject}\nTarjeta 3: Punto clave / ${description.slice(0, 100)}...`;
    }
    if (type === 'simple') {
        return `${base}explicacion sencilla:\n\nEste PDF puede estudiarse separando primero el tema, luego las ideas importantes y finalmente practicando con preguntas cortas.\n\nReferencia simulada: ${description}`;
    }
    return `${base}resumen simulado:\n\nEl recurso contiene información util para estudiar ${resource.subject}. Conviene convertirlo en preguntas, flashcards y ejemplos para reforzar el aprendizaje.\n\nReferencia simulada: ${description}`;
}

function getResourceFromAIInput() {
    const text = getAIInput();
    const title = (text.match(/PDF simulado: (.*)/) || [])[1]?.split('\n')[0];
    if (!title) return null;
    return loadWorkspace().resources.find(resource => resource.title === title) || null;
}

let currentTutorPdf = null;
let currentTutorTopic = getStoredTutorTopic();

function getStoredTutorTopic() {
    try {
        return localStorage.getItem('acStudyTutorTopic') || '';
    } catch (error) {
        return '';
    }
}

function setTutorTopic(topic) {
    currentTutorTopic = String(topic || '').trim();
    if (typeof tutorState !== 'undefined') {
        tutorState.topic = currentTutorTopic;
    }
    try {
        if (currentTutorTopic) {
            localStorage.setItem('acStudyTutorTopic', currentTutorTopic);
        }
    } catch (error) {
        // localStorage puede no estar disponible en algunos navegadores privados.
    }
}

function normalizeTutorText(text) {
    return String(text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function isTutorHistoryNearBottom(messages, threshold = 120) {
    if (!messages) return false;
    return messages.scrollHeight - messages.scrollTop - messages.clientHeight <= threshold;
}

function scrollTutorHistoryToEnd(messages, shouldScroll = true) {
    if (!messages || !shouldScroll) return;

    requestAnimationFrame(() => {
        messages.scrollTo({
            top: messages.scrollHeight,
            behavior: 'smooth'
        });
    });
}

function formatTutorInlineMarkdown(value) {
    return escapeHTML(String(value || ''))
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
}

function renderTutorMarkdown(value) {
    const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    let paragraph = [];
    let listType = '';
    let listItems = [];

    const flushParagraph = () => {
        if (!paragraph.length) return;
        output.push(`<p>${paragraph.map(formatTutorInlineMarkdown).join('<br>')}</p>`);
        paragraph = [];
    };

    const flushList = () => {
        if (!listType || !listItems.length) return;
        output.push(`<${listType}>${listItems.map(item => `<li>${formatTutorInlineMarkdown(item)}</li>`).join('')}</${listType}>`);
        listType = '';
        listItems = [];
    };

    lines.forEach(line => {
        const trimmed = line.trim();
        const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
        const unorderedItem = trimmed.match(/^[-*]\s+(.+)$/);
        const orderedItem = trimmed.match(/^\d+[.)]\s+(.+)$/);

        if (!trimmed) {
            flushParagraph();
            flushList();
            return;
        }

        if (/^_{3,}$|^-{3,}$|^\*{3,}$/.test(trimmed)) {
            flushParagraph();
            flushList();
            output.push('<hr>');
            return;
        }

        if (heading) {
            flushParagraph();
            flushList();
            const level = heading[1].length === 1 ? 'h3' : 'h4';
            output.push(`<${level}>${formatTutorInlineMarkdown(heading[2])}</${level}>`);
            return;
        }

        if (unorderedItem || orderedItem) {
            flushParagraph();
            const nextListType = unorderedItem ? 'ul' : 'ol';
            if (listType && listType !== nextListType) flushList();
            listType = nextListType;
            listItems.push((unorderedItem || orderedItem)[1]);
            return;
        }

        flushList();
        paragraph.push(trimmed);
    });

    flushParagraph();
    flushList();
    return output.join('');
}

function appendTutorMessage(type, content, title = '') {
    const messages = document.getElementById('tutor-messages');
    if (!messages) return false;

    const shouldFollowLatest = isTutorHistoryNearBottom(messages);
    const message = document.createElement('div');
    const isUser = type === 'user';
    message.className = `tutor-message ${isUser ? 'tutor-user' : 'tutor-bot'}`;

    const displayContent = isUser ? String(content || '') : polishSpanishText(content);
    const displayTitle = isUser ? String(title || '') : polishSpanishText(title);
    const safeContent = isUser
        ? `<p>${escapeHTML(displayContent).replace(/\n/g, '<br>')}</p>`
        : renderTutorMarkdown(displayContent);
    const safeTitle = displayTitle ? `<strong class="tutor-message-title">${escapeHTML(displayTitle)}</strong>` : '';
    message.innerHTML = `${safeTitle}${safeContent || '<p></p>'}`;

    messages.appendChild(message);
    scrollTutorHistoryToEnd(messages, shouldFollowLatest);
    return true;
}

function appendTutorPracticeCards(topic) {
    const messages = document.getElementById('tutor-messages');
    if (!messages) return false;

    const cleanTopic = escapeHTML(topic || 'tu tema');
    const lowerTopic = String(topic || '').toLowerCase();
    const isLimits = /limite|limites/.test(lowerTopic);
    const questions = isLimits
        ? [
            'Que significa que una funcion se acerque a un valor?',
            'Cuando existe un limite por izquierda y por derecha?',
            'Cómo reconocerias una discontinuidad en una grafica?',
            'Resuelve un ejemplo sencillo usando sustitucion directa.',
            'Explica con tus palabras para qué sirven los limites.'
        ]
        : [
            `Que es ${topic} con tus propias palabras?`,
            `Cuál es la idea principal de ${topic}?`,
            `Menciona un ejemplo practico de ${topic}.`,
            `Que parte de ${topic} te parece mas dificil y por que?`,
            `Cómo explicarias ${topic} a un companero en un minuto?`
        ];

    const message = document.createElement('div');
    message.className = 'tutor-message tutor-bot tutor-practice-response';
    message.innerHTML = `
        <strong>Practica sobre ${cleanTopic}</strong>
        <p>Responde estas tarjetas una por una. Cuando termines, puedes pedirme que revise tus respuestas.</p>
        <div class="tutor-practice-grid">
            ${questions.map((question, index) => `
                <article class="tutor-practice-card">
                    <span>${index + 1}</span>
                    <p>${escapeHTML(question)}</p>
                </article>
            `).join('')}
        </div>
    `;

    const shouldFollowLatest = isTutorHistoryNearBottom(messages);
    messages.appendChild(message);
    scrollTutorHistoryToEnd(messages, shouldFollowLatest);
    return true;
}

function generateTutorAnswer() {
    const topic = getAIInput();
    if (!topic) {
        notify('Escribe una pregunta o pega un texto.', 'error');
        return;
    }

    const answer = buildAIResponse('tutor', topic);
    appendTutorMessage('user', topic);
    showAIResult('Tutor', answer);

    const input = document.getElementById('ai-topic');
    if (input) {
        input.value = '';
        input.focus();
    }
}

function extractStudyTopic(prompt) {
    return normalizeTutorText(prompt)
        .replace(/pdf simulado cargado:[\s\S]*/g, '')
        .replace(/ayudame a|ayudame|por favor|porfa|explicame|explica|dime|hazme|hacer|investiga|ensename|dame|un resumen de|resumen de/g, '')
        .replace(/paso a paso|lo paso a paso|con detalle|detalladamente/g, '')
        .replace(/que es|que son|cual es|sobre|acerca de|este pdf|del pdf|de este pdf|mi pdf/g, '')
        .replace(/conceptos|concepto|debo aprender|aprender|del tema|tema/g, '')
        .replace(/\b(el|la|los|las|un|una|unos|unas|de|del)\b/g, ' ')
        .replace(/[?.,;:!]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isTutorFollowUp(prompt) {
    const text = normalizeTutorText(prompt);
    return Boolean(currentTutorTopic) && /(utilizarlo|usarlo|aplicarlo|eso|esto|lo anterior|vida cotidiana|ocasiones|ejemplo|sirve|para qué|cuando se usa|donde se usa|como se usa|ejercicios|conceptos|debo aprender|tema)/.test(text);
}

function isConceptRequest(prompt) {
    return /(concepto|conceptos|ideas clave|puntos clave|debo aprender|que debo aprender|aprender del tema)/.test(normalizeTutorText(prompt));
}

function isEmptyTutorTopic(topic) {
    const clean = normalizeTutorText(topic)
        .replace(/el tema que estas estudiando|tema que estas estudiando/g, '')
        .replace(/\b(tema|concepto|conceptos|dame|quiero|saber|aprender)\b/g, '')
        .trim();
    return clean.length < 3;
}

function getTutorConcepts(topic) {
    const plain = normalizeTutorText(topic);

    if (/interes compuesto|interes|compuesto/.test(plain)) {
        setTutorTopic('interes compuesto');
        return `Conceptos que debes aprender sobre interes compuesto:\n\n1. Capital inicial:\nEs el dinero con el que empiezas una inversion, ahorro o deuda.\n\n2. Tasa de interes:\nEs el porcentaje que se aplica en cada periodo. Por ejemplo, 10% se escribe como 0.10.\n\n3. Tiempo o periodos:\nEs la cantidad de veces que se aplica el interes. Puede ser en anos, meses o dias, segun el caso.\n\n4. Monto final:\nEs el dinero total que queda despues de aplicar el interes compuesto.\n\n5. Fórmula:\nA = P(1 + r)^t\nP es capital inicial, r es tasa, t es tiempo y A es monto final.\n\n6. Interes sobre interes:\nEs la idea mas importante: los intereses ganados se suman al capital y luego tambien generan nuevos intereses.\n\n7. Diferencia con interes simple:\nEn interes simple, el interes siempre se calcula sobre el capital inicial. En interes compuesto, se calcula sobre el capital mas los intereses acumulados.\n\n8. Uso real:\nSe usa en ahorros, inversiones, prestamos, tarjetas de credito y planes de retiro.\n\nSi dominas esos conceptos, ya puedes resolver ejercicios basicos de interes compuesto.`;
    }

    if (/limite|limites/.test(plain)) {
        setTutorTopic('limites');
        return `Conceptos que debes aprender sobre limites:\n\n1. Funcion:\nEs la expresion o regla que estas analizando.\n\n2. Variable x:\nEs el valor que se acerca a un numero determinado.\n\n3. Valor al que se acerca la funcion:\nEs el resultado que la funcion va tomando cuando x se aproxima al punto.\n\n4. Limite lateral izquierdo:\nAnaliza que pasa cuando x se acerca desde valores menores.\n\n5. Limite lateral derecho:\nAnaliza que pasa cuando x se acerca desde valores mayores.\n\n6. Existencia del limite:\nEl limite existe si el lado izquierdo y el lado derecho llegan al mismo valor.\n\n7. Continuidad:\nUna funcion es continua si no presenta saltos, huecos o cortes en el punto analizado.\n\n8. Uso real:\nLos limites sirven para entender continuidad, derivadas, graficas y cambios en funciones.`;
    }

    return `Para darte conceptos correctos necesito el tema exacto.\n\nEscribe, por ejemplo:\n- Dame conceptos de interes compuesto\n- Dame conceptos de limites\n- Dame conceptos de fotosintesis\n\nAsi te respondo con conceptos reales del tema, no con una plantilla general.`;
}

function getTutorExplanation(topic, originalPrompt) {
    const normalized = topic || currentTutorTopic || 'el tema que estas estudiando';
    const plainTopic = normalizeTutorText(normalized);
    const prompt = normalizeTutorText(originalPrompt);
    const pdfName = currentTutorPdf?.name || '';
    const pdfTopic = pdfName ? pdfName.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ') : '';

    if (isConceptRequest(originalPrompt)) {
        if (currentTutorTopic && isEmptyTutorTopic(topic)) {
            return getTutorConcepts(currentTutorTopic);
        }
        if (!isEmptyTutorTopic(normalized)) {
            return getTutorConcepts(normalized);
        }
        return getTutorConcepts('');
    }

    if (currentTutorPdf && /ejercicio|ejercicios|pregunta|preguntas|practica|practicar/.test(prompt)) {
        const pdfPlain = normalizeTutorText(`${pdfTopic} ${prompt}`);
        if (/limite|limites/.test(pdfPlain)) {
            setTutorTopic('limites');
            return `Ejercicios de practica basados en el PDF "${pdfName}":\n\n1. Concepto basico:\nExplica con tus palabras que significa que una funcion se acerque a un valor.\n\n2. Limite directo:\nSi f(x) = x + 3, cual es el limite cuando x se acerca a 2?\nRespuesta esperada: 5.\n\n3. Limites laterales:\nSi por la izquierda la funcion se acerca a 4 y por la derecha tambien se acerca a 4, el limite existe? Cuál es?\nRespuesta esperada: Si existe, y es 4.\n\n4. Caso donde no existe:\nSi por la izquierda la funcion se acerca a 2 y por la derecha se acerca a 6, existe el limite?\nRespuesta esperada: No existe, porque los dos lados no llegan al mismo valor.\n\n5. Aplicacion grafica:\nMira una grafica y observa hacia donde se acercan los valores de y cuando x se acerca al punto indicado.\n\nConsejo:\nPara resolver limites, primero intenta sustitucion directa. Si no funciona, revisa la grafica, simplifica la expresion o analiza los lados.`;
        }

        return `Ejercicios de practica basados en el PDF "${pdfName}":\n\n1. Explica el tema principal del PDF con tus palabras.\n2. Escribe tres conceptos importantes que aparezcan en el documento.\n3. Crea un ejemplo relacionado con ${pdfTopic || normalized}.\n4. Responde: para qué sirve este tema en clase?\n5. Resume el contenido en cinco lineas.\n\nCuando respondas, puedo ayudarte a revisar si esta correcto.`;
    }

    if (currentTutorPdf && /explica|explicame|que es|que son|entender|no entiendo/.test(prompt)) {
        const pdfPlain = normalizeTutorText(`${pdfTopic} ${prompt}`);
        if (/limite|limites/.test(pdfPlain)) {
            setTutorTopic('limites');
            return `Te explico el PDF "${pdfName}" de forma sencilla.\n\nEl tema es limites.\n\nUn limite sirve para saber a que valor se acerca una funcion cuando x se acerca a un numero. No se trata siempre de reemplazar y ya; muchas veces se trata de observar el comportamiento de la funcion cerca de ese punto.\n\nEjemplo sencillo:\nImagina que x se acerca a 2. Si al mirar la funcion, los valores de y se acercan a 5, entonces decimos que el limite es 5.\n\nLo mas importante:\n1. Mira el numero al que se acerca x.\n2. Observa a que valor se acerca la funcion.\n3. Revisa si por la izquierda y por la derecha se llega al mismo resultado.\n4. Si ambos lados coinciden, el limite existe.\n\nPara que sirve:\nLos limites sirven para entender continuidad, derivadas, graficas y cambios. Son una base importante del calculo.`;
        }
    }

    if (currentTutorPdf && /resumen|resume|resumir|pdf|apunte/.test(prompt)) {
        const sourceTopic = pdfTopic || normalized;
        if (/limite|limites/.test(normalizeTutorText(`${sourceTopic} ${prompt}`))) {
            setTutorTopic('limites');
            return `Resumen del PDF "${pdfName}":\n\nTema central:\nEl PDF trata sobre limites, un concepto de matematica que explica a que valor se acerca una funcion cuando la variable se aproxima a un numero.\n\nQue es un limite:\nUn limite sirve para estudiar el comportamiento de una funcion cerca de un punto. No siempre importa el valor exacto en ese punto; lo importante es hacia donde se acerca la funcion.\n\nIdea principal:\nSi x se acerca a un numero y los valores de la funcion se acercan a un mismo resultado, entonces ese resultado es el limite.\n\nLimites laterales:\n1. Limite por la izquierda: observa que pasa cuando x se acerca desde valores menores.\n2. Limite por la derecha: observa que pasa cuando x se acerca desde valores mayores.\n3. Si los dos lados llegan al mismo numero, el limite existe.\n4. Si llegan a numeros diferentes, el limite no existe.\n\nEjemplo:\nSi cuando x se acerca a 2, la funcion se acerca a 5 por ambos lados, entonces el limite es 5.\n\nPara que sirve:\nLos limites se usan para entender continuidad, cambios en funciones, derivadas, graficas y problemas donde una funcion se acerca a un valor sin tocarlo exactamente.\n\nResumen final:\nEl PDF explica que los limites ayudan a analizar tendencias. La clave es mirar que pasa cerca de un punto, comparar izquierda y derecha, y confirmar si ambos lados llegan al mismo valor.`;
        }

        return `Resumen del PDF "${pdfName}":\n\nTema central:\nEl documento se enfoca en ${sourceTopic}. Presenta conceptos principales, ejemplos y puntos que el estudiante debe organizar para estudiar mejor.\n\nIdeas principales:\n1. El tema se puede dividir en definicion, caracteristicas y ejemplos.\n2. Las partes importantes son los conceptos que se repiten o que aparecen como base para ejercicios.\n3. Los ejemplos ayudan a comprobar si el contenido fue entendido.\n4. Las preguntas de repaso sirven para practicar antes de una prueba.\n\nResumen corto:\nEste PDF explica ${sourceTopic} de manera introductoria. La idea principal es entender que significa el tema, reconocer sus elementos mas importantes y aplicarlo en ejercicios o situaciones de clase.\n\nConclusiones:\n- Identifica las definiciones clave.\n- Separa ejemplos de teoria.\n- Practica con preguntas cortas.\n- Explica el tema con tus propias palabras para comprobar que lo entendiste.\n\nPregunta de practica:\nCuál es la idea principal de ${sourceTopic} y que ejemplo podrias resolver para demostrarlo?`;
    }

    if (/interes compuesto|interes|compuesto/.test(plainTopic)) {
        setTutorTopic('interes compuesto');
        if (/ejercicio|ejercicios|practica|practicar|respuesta|respuestas|comprobar|resolver/.test(prompt)) {
            return `Claro. Aqui tienes 5 ejercicios de interes compuesto para resolver. Primero intenta hacerlos tu, y al final te dejo las respuestas para comprobar.\n\nFórmula:\nA = P(1 + r)^t\n\nDonde:\nA = monto final\nP = capital inicial\nr = tasa de interes en decimal\nt = tiempo o numero de periodos\n\nEjercicios:\n\n1. Una persona deposita 100 dolares al 10% anual durante 2 anos. Cuanto dinero tendra al final?\n\n2. Si inviertes 250 dolares al 8% anual durante 3 anos, cual sera el monto final?\n\n3. Un estudiante ahorra 500 dolares en una cuenta que genera 5% anual durante 4 anos. Cuanto tendra despues de ese tiempo?\n\n4. Una deuda de 300 dolares crece con interes compuesto del 12% anual durante 2 anos. Cual sera el monto final?\n\n5. Si una inversion de 1000 dolares crece al 6% anual durante 5 anos, cual sera el monto final aproximado?\n\nRespuestas para comprobar:\n\n1. A = 100(1 + 0.10)^2 = 121.00 dolares.\n\n2. A = 250(1 + 0.08)^3 = 314.93 dolares aproximadamente.\n\n3. A = 500(1 + 0.05)^4 = 607.75 dolares aproximadamente.\n\n4. A = 300(1 + 0.12)^2 = 376.32 dolares.\n\n5. A = 1000(1 + 0.06)^5 = 1338.23 dolares aproximadamente.\n\nCómo comprobarlos:\nConvierte el porcentaje a decimal, suma 1, eleva al tiempo y multiplica por el capital inicial.`;
        }

        if (/vida cotidiana|ocasiones|utilizar|usar|sirve|aplicar|aplicarlo/.test(prompt)) {
            return `El interes compuesto se usa en muchas situaciones de la vida cotidiana porque explica como crece una cantidad cuando se acumulan intereses sobre intereses.\n\nOcasiones donde se utiliza:\n1. Ahorros bancarios:\nSi guardas dinero en una cuenta que genera intereses, cada periodo el banco calcula intereses sobre el dinero inicial mas lo que ya ganaste.\n\n2. Inversiones:\nCuando inviertes en fondos, certificados o planes de ahorro, el dinero puede crecer con interes compuesto si las ganancias se reinvierten.\n\n3. Prestamos:\nAlgunos prestamos calculan intereses sobre saldos acumulados. Por eso, si se deja una deuda sin abonar a tiempo, puede aumentar mas rapido.\n\n4. Tarjetas de credito:\nSi dejas una deuda pendiente, los intereses pueden sumarse al saldo y luego generar mas intereses. Esto hace que la deuda crezca.\n\n5. Planes de retiro:\nMientras mas temprano empiezas a ahorrar, mas tiempo tiene el interes compuesto para hacer crecer el dinero.\n\nEjemplo de vida diaria:\nSi ahorras 100 dolares al 10% anual y no retiras las ganancias, despues del primer ano tienes 110. En el segundo ano ya no ganas interes sobre 100, sino sobre 110. Por eso crece mas rapido.\n\nConclusion:\nEl interes compuesto sirve para entender como crece el dinero con el tiempo, tanto para ganar mas en ahorros e inversiones como para evitar que una deuda aumente demasiado.`;
        }

        return `Interes compuesto\n\nQue es:\nEl interes compuesto es una forma de calcular ganancias o deudas donde los intereses se suman al capital inicial y despues tambien generan nuevos intereses. Por eso se dice que es "interes sobre interes".\n\nFormula principal:\nMonto final = Capital inicial x (1 + tasa) ^ tiempo\n\nTambien se puede escribir asi:\nA = P(1 + r)^t\n\nDonde:\nP = capital inicial, es decir, el dinero con el que empiezas.\nr = tasa de interes por periodo, escrita en decimal. Por ejemplo, 10% = 0.10.\nt = numero de periodos.\nA = monto final despues de aplicar el interes compuesto.\n\nCómo funciona:\nSi inviertes 100 dolares al 10% anual durante 3 anos:\nAno 1: 100 x 1.10 = 110\nAno 2: 110 x 1.10 = 121\nAno 3: 121 x 1.10 = 133.10\n\nResultado:\nAl final tendrias 133.10 dolares. La ganancia no fue solo 30, porque cada ano el interes se calculo sobre una cantidad mas grande.\n\nEn que se usa:\n1. Ahorros e inversiones.\n2. Prestamos y deudas.\n3. Tarjetas de credito.\n4. Cuentas bancarias.\n5. Crecimiento de dinero en el tiempo.\n\nDiferencia con interes simple:\nEn el interes simple, el interes siempre se calcula sobre el capital inicial.\nEn el interes compuesto, el interes se calcula sobre el capital inicial mas los intereses acumulados.\n\nEjemplo rapido:\nSi tienes 200 dolares al 5% durante 2 anos:\nA = 200(1 + 0.05)^2\nA = 200(1.05)^2\nA = 200 x 1.1025\nA = 220.50\n\nConclusion:\nEl interes compuesto es importante porque muestra como el dinero puede crecer mas rapido con el tiempo. Mientras mayor sea la tasa o mas largo sea el tiempo, mas grande sera el monto final.`;
    }

    if (/térmica|termodinamica|calor|temperatura/.test(plainTopic)) {
        return `La térmica es una parte de la física que estudia el calor, la temperatura y como la energía se transfiere entre los cuerpos.\n\nExplicación sencilla:\nCuando un cuerpo esta caliente, sus particulas se mueven con mas energía. Cuando esta frio, se mueven con menos energía. La térmica ayuda a entender como cambia esa energía y por que el calor pasa de un cuerpo caliente a uno mas frio.\n\nConceptos importantes:\n1. Temperatura: indica que tan caliente o frio esta un cuerpo.\n2. Calor: es energía que se transfiere por diferencia de temperatura.\n3. Equilibrio termico: ocurre cuando dos cuerpos llegan a la misma temperatura.\n4. Dilatacion: algunos materiales aumentan su tamano cuando se calientan.\n\nEjemplo:\nSi pones una cuchara fria dentro de una taza de cafe caliente, la cuchara se calienta porque recibe energía térmica del cafe.\n\nEn resumen:\nLa térmica explica como se comporta el calor y como afecta a los objetos.`;
    }

    if (/limite|limites/.test(plainTopic)) {
        setTutorTopic('limites');
        return `Un limite en matematica describe a que valor se acerca una funcion cuando la variable se aproxima a un numero.\n\nExplicación sencilla:\nNo siempre importa el valor exacto de la funcion en un punto. A veces importa hacia donde se acerca. Eso es un limite.\n\nEjemplo:\nSi x se acerca a 2 y la funcion se acerca a 5, decimos que el limite es 5.\n\nPara entender limites:\n1. Mira a que numero se acerca x.\n2. Observa a que valor se acerca la funcion.\n3. Revisa el comportamiento por la izquierda y por la derecha.\n4. Si ambos lados llegan al mismo valor, el limite existe.\n\nEn resumen:\nLos limites sirven para estudiar continuidad, derivadas y cambios en funciones.`;
    }

    if (/física/.test(plainTopic)) {
        return `La física es la ciencia que estudia la materia, la energía, el movimiento, las fuerzas y los fenomenos naturales.\n\nExplicación sencilla:\nLa física intenta responder preguntas como: por que cae un objeto, como se mueve un carro, como viaja la luz o como se transfiere el calor.\n\nRamas importantes:\n1. Mecanica: estudia movimiento y fuerzas.\n2. Termica: estudia calor y temperatura.\n3. Electricidad: estudia cargas y corriente electrica.\n4. Optica: estudia la luz.\n\nEjemplo:\nCuando lanzas una pelota, la física explica su velocidad, su trayectoria y por que vuelve a caer.\n\nEn resumen:\nLa física ayuda a entender como funciona el mundo que nos rodea.`;
    }

    if (isEmptyTutorTopic(normalized)) {
        return `Necesito que me digas el tema exacto para responder bien.\n\nPor ejemplo:\n- Qué es el interes compuesto?\n- Dame conceptos de limites\n- Explicame la fotosintesis\n- Dame ejercicios de ecuaciones\n\nAsi puedo darte una respuesta real sobre el tema, no una plantilla generica.`;
    }

    setTutorTopic(normalized);
    return fallbackInteligente(normalized, detectTutorIntent(originalPrompt));
}

function buildAIResponse(type, topic) {
    const resource = getResourceFromAIInput();
    if (resource) {
        if (type === 'questions') return buildResourceAIResponse(resource, 'quiz');
        if (type === 'flashcards') return buildResourceAIResponse(resource, 'flashcards');
        if (type === 'simple') return buildResourceAIResponse(resource, 'simple');
        if (type === 'open') return buildResourceAIResponse(resource, 'open');
        if (type === 'truefalse') return buildResourceAIResponse(resource, 'truefalse');
        return buildResourceAIResponse(resource, 'summary');
    }

    const reference = topic.length > 380 ? `${topic.slice(0, 380)}...` : topic;
    if (type === 'tutor') {
        const contextReference = isTutorFollowUp(reference)
            ? `${currentTutorTopic}. Pregunta del estudiante: ${reference}`
            : reference;
        const extractedTopic = isTutorFollowUp(reference)
            ? currentTutorTopic
            : extractStudyTopic(reference);
        return getTutorExplanation(extractedTopic, contextReference);
    }
    if (currentTutorPdf && type === 'summary') {
        return getTutorExplanation(extractStudyTopic(reference), reference);
    }
    if (type === 'quiz') {
        return `Cuestionario simulado sobre ${reference}:\n\n1. Explica el tema con tus palabras.\n2. Qué ejemplo puedes resolver?\n3. Cuál es el error mas comun?\n4. Cómo lo explicarias en clase?\n5. Qué debes repasar antes del examen?`;
    }
    if (type === 'open') {
        return `Preguntas abiertas:\n\n1. Explica ${reference} con tus palabras.\n2. Crea un ejemplo propio.\n3. Relaciona el tema con una situacion real.`;
    }
    if (type === 'truefalse') {
        return `Verdadero/Falso:\n\n1. El tema tiene conceptos clave que se pueden resumir. (V)\n2. No hace falta practicar. (F)\n3. Crear preguntas ayuda a estudiar. (V)\n4. Las flashcards sirven para repasar rapido. (V)`;
    }
    if (type === 'flashcards') {
        return `Flashcards:\n\nTarjeta 1\nPregunta: Qué es ${reference}?\nRespuesta: Escribe una definicion corta.\n\nTarjeta 2\nPregunta: Cuál es un ejemplo?\nRespuesta: Crea un caso practico.\n\nTarjeta 3\nPregunta: Qué debo recordar?\nRespuesta: La información principal y sus aplicaciones.`;
    }
    if (type === 'simple') {
        return `Explicación sencilla:\n\nPiensa en este tema como una idea principal con varias piezas alrededor. Primero entiende la definicion, luego mira ejemplos y finalmente practica respondiendo preguntas.`;
    }
    return `Resumen:\n\nEl contenido sobre ${reference} puede organizarse en definiciones, ideas clave, ejemplos y preguntas de practica. Para estudiar mejor, conviertelo en una lista corta y repasala con flashcards.`;
}

function generateQuiz() {
    const topic = getAIInput();
    if (!topic) {
        notify('Ingresa un tema o pega un texto corto.', 'error');
        return;
    }
    showAIResult('Cuestionario generado', buildAIResponse('quiz', topic));
}

function generatePracticeCards() {
    const input = document.getElementById('ai-topic');
    const typedTopic = getAIInput();
    const topic = typedTopic || tutorState.lastTopic || tutorState.topic || '';

    if (!topic) {
        notify('Escribe un tema o pega un texto corto para practicar.', 'error');
        return;
    }

    appendTutorMessage('user', `Practicar: ${topic}`);
    appendTutorPracticeCards(extractStudyTopic(topic) || topic);

    if (input) {
        input.value = '';
        input.focus();
    }
}

function generateOpenQuestions() {
    const topic = getAIInput();
    if (!topic) {
        notify('Ingresa un tema o pega un texto corto.', 'error');
        return;
    }
    showAIResult('Preguntas abiertas', buildAIResponse('open', topic));
}

function generateTrueFalse() {
    const topic = getAIInput();
    if (!topic) {
        notify('Ingresa un tema o pega un texto corto.', 'error');
        return;
    }
    showAIResult('Verdadero/Falso', buildAIResponse('truefalse', topic));
}

// ============================================
// TUTOR EDUCATIVO SIMULADO CON CONTEXTO
// Punto central para conectar el asistente con un servicio externo mas adelante.
// ============================================

const tutorState = {
    mode: getTutorStorageValue('acStudyTutorMode') || 'explain',
    topic: getTutorStorageValue('acStudyTutorTopic') || '',
    messages: [],
    lastTopic: getTutorStorageValue('acStudyTutorTopic') || '',
    lastIntent: '',
    lastAnswer: '',
    lastUserMessage: '',
    turnCount: 0,
    history: getTutorHistory(),
    pendingQuestion: getTutorPendingQuestion()
};
let lastTopic = tutorState.topic;
let lastSubtopic = getTutorStorageValue('acStudyTutorSubtopic') || '';
let lastIntent = '';
let chatHistory = tutorState.history;
let lastTutorResponse = getTutorStorageValue('acStudyLastTutorResponse') || '';
let tutorRequestInProgress = false;

function getTutorStorageValue(key) {
    try {
        return localStorage.getItem(key) || '';
    } catch (error) {
        return '';
    }
}

function setTutorStorageValue(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        // El prototipo puede ejecutarse en navegadores sin almacenamiento disponible.
    }
}

function getTutorHistory() {
    try {
        return JSON.parse(localStorage.getItem('acStudyTutorHistory') || '[]');
    } catch (error) {
        return [];
    }
}

function saveTutorHistory() {
    try {
        localStorage.setItem('acStudyTutorHistory', JSON.stringify(tutorState.history.slice(-16)));
    } catch (error) {
        // Historial solo local y opcional.
    }
}

function getTutorPendingQuestion() {
    try {
        return JSON.parse(localStorage.getItem('acStudyTutorPendingQuestion') || 'null');
    } catch (error) {
        return null;
    }
}

function saveTutorPendingQuestion() {
    try {
        if (tutorState.pendingQuestion) {
            localStorage.setItem('acStudyTutorPendingQuestion', JSON.stringify(tutorState.pendingQuestion));
        } else {
            localStorage.removeItem('acStudyTutorPendingQuestion');
        }
    } catch (error) {
        // Preguntas pendientes solo viven en el navegador.
    }
}

function rememberTutorTopic(topic) {
    const cleanTopic = String(topic || '').trim();
    if (!cleanTopic) return;
    tutorState.topic = cleanTopic;
    tutorState.lastTopic = cleanTopic;
    lastTopic = cleanTopic;
    currentTutorTopic = cleanTopic;
    setTutorStorageValue('acStudyTutorTopic', cleanTopic);
}

function rememberTutorSubtopic(subtopic) {
    const cleanSubtopic = String(subtopic || '').trim();
    if (!cleanSubtopic) return;
    lastSubtopic = cleanSubtopic;
    setTutorStorageValue('acStudyTutorSubtopic', cleanSubtopic);
}

function setTutorMode(mode, button) {
    tutorState.mode = mode || 'explain';
    tutorState.lastIntent = tutorState.mode;
    lastIntent = tutorState.mode;
    setTutorStorageValue('acStudyTutorMode', tutorState.mode);

    document.querySelectorAll('.tutor-tabs button').forEach(tab => tab.classList.remove('active'));
    if (button) button.classList.add('active');

    const label = document.getElementById('tutor-mode-label');
    if (label) label.textContent = `Modo ${getTutorModeName(tutorState.mode)}`;

    if (button && tutorState.mode !== 'explain') {
        handleTutorModeAction(tutorState.mode);
    }
}

function getTutorModeName(mode) {
    const names = {
        explain: 'explicar',
        practice: 'practicar',
        review: 'repasar',
        flashcards: 'flashcards',
        exam: 'examen'
    };
    return names[mode] || 'explicar';
}

function clearTutorChat() {
    const messages = document.getElementById('tutor-messages');
    if (!messages) return;

    resetTutorState();

    messages.innerHTML = `
        <div class="tutor-message tutor-bot">
            <strong>Tutor</strong>
            <p>Chat limpio. Escribe un tema o una pregunta y empezamos desde cero.</p>
        </div>
    `;
}

function resetTutorState() {
    tutorState.history = [];
    tutorState.messages = [];
    tutorState.lastTopic = '';
    tutorState.lastIntent = '';
    tutorState.lastAnswer = '';
    tutorState.lastUserMessage = '';
    tutorState.turnCount = 0;
    tutorState.topic = '';
    tutorState.pendingQuestion = null;
    lastTopic = '';
    lastIntent = '';
    lastSubtopic = '';
    chatHistory = tutorState.history;
    lastTutorResponse = '';
    currentTutorTopic = '';
    saveTutorHistory();
    saveTutorPendingQuestion();
    try {
        localStorage.removeItem('acStudyTutorTopic');
        localStorage.removeItem('acStudyTutorSubtopic');
        localStorage.removeItem('acStudyLastTutorResponse');
    } catch (error) {
        // Limpieza opcional de memoria local del Tutor.
    }
}

function addTutorHistory(role, content) {
    tutorState.history.push({
        role,
        content,
        topic: tutorState.topic,
        mode: tutorState.mode,
        at: new Date().toISOString()
    });
    tutorState.history = tutorState.history.slice(-16);
    chatHistory = tutorState.history;
    tutorState.messages.push({ role, content });
    tutorState.messages = tutorState.messages.slice(-12);
    if (role === 'user') {
        tutorState.lastUserMessage = content;
    }
    if (role === 'assistant') {
        tutorState.lastAnswer = content;
    }
    saveTutorHistory();
}

function normalizeTutorTopic(topic) {
    const text = normalizeTutorText(topic);
    const mappedTopics = [
        { pattern: /(calor especifico)/, topic: 'calor especifico' },
        { pattern: /(calor latente)/, topic: 'calor latente' },
        { pattern: /(física térmica|térmica|termodinamica|calor y temperatura|calor|temperatura|calorimetria)/, topic: 'física térmica' },
        { pattern: /(funciones geometricas|funcion geometrica|geometria con funciones)/, topic: 'funciones geometricas' },
        { pattern: /(funciones cuadraticas|funcion cuadratica|parabola|parabolas)/, topic: 'funciones cuadraticas' },
        { pattern: /(funciones lineales|funcion lineal|recta|rectas)/, topic: 'funciones lineales' },
        { pattern: /(funciones inversas|funcion inversa|inversa|inversas)/, topic: 'funciones inversas' },
        { pattern: /(interes compuesto|interes compuestos)/, topic: 'interes compuesto' },
        { pattern: /(multiplicacion|multiplicaciones|multiplicar|tabla de multiplicar)/, topic: 'multiplicaciones' },
        { pattern: /(matriz|matrices)/, topic: 'matrices' },
        { pattern: /(base de datos|bases de datos|sql)/, topic: 'SQL y bases de datos' },
        { pattern: /\bhtml\b/, topic: 'HTML' },
        { pattern: /\bcss\b/, topic: 'CSS' },
        { pattern: /(javascript|java script|\bjs\b)/, topic: 'JavaScript' },
        { pattern: /(porcentaje|porcentajes)/, topic: 'porcentajes' },
        { pattern: /(movimiento rectilineo|mru|movimiento)/, topic: 'movimiento rectilineo' },
        { pattern: /(energía|energía mecanica|energía cinetica|energía potencial)/, topic: 'energía' },
        { pattern: /(fuerza|leyes de newton)/, topic: 'fuerza' },
        { pattern: /(redes|red informatica|internet)/, topic: 'redes' }
    ];
    const match = mappedTopics.find(item => item.pattern.test(text));
    return match ? match.topic : text.trim();
}

function detectTutorTopic(message) {
    const text = normalizeTutorText(message);
    const knownTopic = normalizeTutorTopic(text);
    const isOnlyAction = /^(dame|hazme|quiero|necesito|puedes|ahora|otra|otro|explica|explicame)?\s*(ejemplos?|ejercicios?|preguntas?|resumen|repaso|flashcards|tarjetas|cuestionario|examen|conceptos?|usos?|aplicaciones?)\b/.test(text);

    if (isTutorFollowUp(message) || isOnlyAction) {
        return tutorState.lastTopic || tutorState.topic || currentTutorTopic || '';
    }

    if (knownTopic && knownTopic !== text) return knownTopic;

    const extracted = text
        .replace(/ayudame|por favor|porfa|explicame|explica|dime|hazme|hacer|dame|quiero|necesito|puedes|me puedes/g, ' ')
        .replace(/que es|que son|definicion|define|resumen|resumir|ejemplos|ejemplo|ejercicios|ejercicio|preguntas|pregunta|flashcards|cuestionario|conceptos|concepto|tema|del tema|debo aprender|pasos|paso a paso|para estudiar|para examen/g, ' ')
        .replace(/\b(el|la|los|las|un|una|unos|unas|de|del|en|para|con|sobre|acerca|mi|este|esta|esto|eso)\b/g, ' ')
        .replace(/[?.,;:!]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (extracted.length >= 3) return normalizeTutorTopic(extracted);
    return tutorState.lastTopic || tutorState.topic || '';
}

function isTutorFollowUp(message) {
    const text = normalizeTutorText(message);
    return /(eso|esto|lo anterior|sobre eso|de eso|ese tema|este tema|lo que dijiste|lo puedo usar|en que situaciones|vida cotidiana|dame ejemplos|otro ejemplo|explicame mejor|hazme ejercicios|dame ejercicios|como se usa|para qué sirve|cuando se usa|aplicaciones|usos|y ejemplos|ahora dame|tambien dame|continua|sigue)/.test(text);
}

function isFollowUpQuestion(message) {
    return isTutorFollowUp(message);
}

function updateTutorDemoContext(message) {
    const detectedTopic = detectTutorTopic(message);
    const followUp = isFollowUpQuestion(message);

    if (detectedTopic && (!followUp || !tutorState.lastTopic)) {
        rememberTutorTopic(detectedTopic);
    }

    const intent = detectTutorIntent(message);
    tutorState.lastIntent = intent;
    lastIntent = intent;
    return {
        topic: tutorState.lastTopic || tutorState.topic || detectedTopic,
        intent,
        isFollowUp: followUp
    };
}

function buildTutorFlashcards(topic) {
    const cleanTopic = topic || 'tu tema';
    if (normalizeTutorText(cleanTopic).includes('multiplic')) {
        return `Flashcards de multiplicaciones:\n\n1. Pregunta: Qué significa multiplicar?\nRespuesta: Sumar varias veces el mismo numero.\n\n2. Pregunta: Cuanto es 6 x 4?\nRespuesta: 24.\n\n3. Pregunta: Qué estrategia ayuda?\nRespuesta: Separar decenas y unidades para calcular mejor.`;
    }
    if (normalizeTutorText(cleanTopic).includes('física')) {
        return `Flashcards de física térmica:\n\n1. Pregunta: Qué es calor?\nRespuesta: Energía que se transfiere por diferencia de temperatura.\n\n2. Pregunta: Qué mide la temperatura?\nRespuesta: Qué tan caliente o frio esta un cuerpo.\n\n3. Pregunta: Qué es equilibrio térmico?\nRespuesta: Cuando dos cuerpos alcanzan la misma temperatura.`;
    }
    return `Flashcards de ${cleanTopic}:\n\n1. Pregunta: Qué es ${cleanTopic}?\nRespuesta: Es el concepto principal que debes comprender.\n\n2. Pregunta: Para que sirve?\nRespuesta: Para resolver actividades, explicar ideas y aplicar el tema en ejemplos.\n\n3. Pregunta: Cómo lo estudio?\nRespuesta: Lee la definicion, revisa un ejemplo y practica con preguntas.`;
}

function buildTutorExam(topic) {
    const cleanTopic = topic || 'tu tema';
    if (normalizeTutorText(cleanTopic).includes('multiplic')) {
        return `Mini examen de multiplicaciones:\n\n1. Resuelve 12 x 4.\n2. Resuelve 25 x 3.\n3. Explica por que 5 x 6 es igual a 6 x 5.\n4. Resuelve 18 x 5.\n5. Escribe un problema cotidiano que use multiplicacion.`;
    }
    if (normalizeTutorText(cleanTopic).includes('física')) {
        return `Mini examen de física térmica:\n\n1. Cuál es la diferencia entre calor y temperatura?\n2. Qué significa equilibrio térmico?\n3. Da un ejemplo de transferencia de calor en casa.\n4. Qué pasa cuando el hielo recibe calor?\n5. Para que sirve estudiar los cambios de estado?`;
    }
    return `Mini examen de ${cleanTopic}:\n\n1. Define el tema con tus palabras.\n2. Menciona dos conceptos importantes.\n3. Da un ejemplo sencillo.\n4. Explica para qué sirve.\n5. Crea una pregunta que podria salir en clase.`;
}

function handleTutorModeAction(mode) {
    const topic = tutorState.lastTopic || tutorState.topic || '';
    if (!topic) {
        appendTutorMessage('bot', 'Primero dime que tema quieres estudiar.', 'Tutor');
        return;
    }

    const actions = {
        practice: `Dame ejercicios de ${topic}`,
        review: `Repasa ${topic}`,
        flashcards: `Flashcards de ${topic}`,
        exam: `Examen de ${topic}`
    };

    sendTutorMessage(actions[mode] || `Explicame ${topic}`, getTutorModeName(mode));
}

function showTutorThinking() {
    const messages = document.getElementById('tutor-messages');
    if (!messages) return null;

    const thinking = document.createElement('div');
    thinking.className = 'tutor-message tutor-bot tutor-thinking';
    thinking.innerHTML = '<strong>Tutor</strong><p>Pensando...</p>';
    const shouldFollowLatest = isTutorHistoryNearBottom(messages);
    messages.appendChild(thinking);
    scrollTutorHistoryToEnd(messages, shouldFollowLatest);
    return thinking;
}

function setTutorSendingState(isSending) {
    const sendButton = document.querySelector('#ai-assistant .tutor-send');
    const input = document.getElementById('ai-topic');

    if (sendButton) {
        sendButton.disabled = Boolean(isSending);
        sendButton.classList.toggle('is-loading', Boolean(isSending));
        sendButton.textContent = isSending ? 'Pensando...' : 'Enviar';
    }

    if (input) {
        input.setAttribute('aria-busy', String(Boolean(isSending)));
    }
}

function detectTutorIntent(message) {
    const text = normalizeTutorText(message);

    if (tutorState.pendingQuestion && !/(otra pregunta|hazme preguntas|preguntas|cuestionario|examen|flashcards|resumen|explica|ejercicio)/.test(text)) {
        return 'answer-check';
    }
    if (/flashcard|tarjeta|tarjetas/.test(text)) return 'flashcards';
    if (/formula|formulas|ecuacion|regla/.test(text)) return 'formula';
    if (/cuestionario|examen|preparar examen|evaluacion/.test(text)) return 'exam';
    if (/pregunta|preguntas|practicar|practica/.test(text)) return 'practice';
    if (/ejercicio|ejercicios|resolver|problema|problemas/.test(text)) return 'exercises';
    if (/resumen|resume|resumir|repasar|repaso/.test(text)) return 'review';
    if (/ejemplo|ejemplos|vida cotidiana|utilizar|usar|aplicar|sirve|uso/.test(text)) return 'example';
    if (/paso|pasos|procedimiento|como se resuelve/.test(text)) return 'steps';
    if (/concepto|conceptos|ideas clave|puntos clave|debo aprender/.test(text)) return 'concepts';
    if (/que es|que son|definicion|define/.test(text)) return 'definition';
    if (/que es|definicion|define|explicame|explica|no entiendo|ayuda/.test(text)) return 'explain';

    if (tutorState.mode === 'practice') return 'practice';
    if (tutorState.mode === 'review') return 'review';
    if (tutorState.mode === 'flashcards') return 'flashcards';
    if (tutorState.mode === 'exam') return 'exam';
    return 'explain';
}

function extractTutorTopic(message, intent) {
    const text = normalizeTutorText(message);
    const foundTopic = findKnowledgeTopic(text);
    if (foundTopic) return foundTopic;

    if (tutorState.topic) {
        const currentProfile = getTopicProfile(tutorState.topic);
        if (findTutorSubtopic(text, currentProfile)) return tutorState.topic;
    }

    const followUp = /(eso|esto|lo anterior|del tema|este tema|utilizarlo|usarlo|aplicarlo|dame conceptos tema|conceptos tema|dame ejemplos|hazme preguntas|ahora ejercicios|resumelo|resumen|conceptos|ejemplos|ejercicios|flashcards|en que casos|cuando se usa|para qué sirve)/.test(text);
    if (followUp && tutorState.topic) return tutorState.topic;

    const clean = text
        .replace(/ayudame|por favor|porfa|explicame|explica|dime|hazme|hacer|dame|quiero|necesito|puedes/g, ' ')
        .replace(/que es|que son|definicion|resumen|resumir|ejemplos|ejemplo|ejercicios|ejercicio|preguntas|pregunta|flashcards|cuestionario|conceptos|concepto|tema|del tema|debo aprender|pasos|paso a paso/g, ' ')
        .replace(/\b(el|la|los|las|un|una|unos|unas|de|del|en|para|con|sobre|acerca|mi|este|esta)\b/g, ' ')
        .replace(/[?.,;:!]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (clean.length >= 3) return clean;
    return tutorState.topic || '';
}

const knowledgeBase = {
    'física térmica': {
        aliases: ['física térmica', 'térmica', 'termodinamica', 'calor y temperatura', 'cambio de estado', 'equilibrio térmico', 'conduccion', 'conveccion', 'radiacion'],
        title: 'física térmica',
        definition: 'La física térmica es la rama de la física que estudia el calor, la temperatura y los cambios de energía térmica entre los cuerpos.',
        explanation: 'La temperatura indica que tan caliente o frio esta un cuerpo. El calor es energía que se transfiere de un cuerpo a otro por diferencia de temperatura. El equilibrio térmico ocurre cuando dos cuerpos alcanzan la misma temperatura. En algunos procesos puede haber cambio de temperatura y en otros puede haber cambio de estado.',
        characteristics: ['La temperatura mide el estado termico de un cuerpo', 'El calor se transfiere por diferencia de temperatura', 'El equilibrio térmico ocurre cuando dos cuerpos llegan a la misma temperatura', 'Puede existir cambio de temperatura o cambio de estado', 'Relaciona masa, calor especifico y calor latente'],
        concepts: ['Calor', 'Temperatura', 'Equilibrio termico', 'Energía térmica', 'Calor especifico', 'Calor latente', 'Cambio de estado'],
        formula: 'Q = m * c * DeltaT\nQ = m * L\n\nDonde:\nQ es el calor.\nm es la masa.\nc es el calor especifico.\nDeltaT es el cambio de temperatura.\nL es el calor latente.',
        example: 'Si calientas agua en una olla, la energía del fuego pasa al agua como calor. Por eso aumenta su temperatura. Si sigue recibiendo calor, puede llegar a hervir y cambiar de liquido a vapor.',
        uses: 'Sirve para explicar calentamiento, enfriamiento, cambios de estado, equilibrio térmico, cocina, clima, motores, refrigeracion y procesos industriales.',
        exercises: ['Cuál es la diferencia entre calor y temperatura?', 'Que significa equilibrio térmico?', 'Para que sirve la formula Q = m * c * DeltaT?', 'Que ocurre cuando una sustancia cambia de estado?', 'Que representa el calor latente?'],
        answers: ['La temperatura mide que tan caliente o frio esta un cuerpo; el calor es energía transferida.', 'Que dos cuerpos alcanzan la misma temperatura.', 'Para calcular calor cuando cambia la temperatura.', 'La sustancia cambia de fase, por ejemplo de liquido a vapor.', 'La energía necesaria para cambiar de estado sin cambiar temperatura.'],
        flashcards: [['Que estudia la física térmica?', 'Calor, temperatura y energía térmica entre cuerpos.'], ['Que es calor?', 'Energía que se transfiere por diferencia de temperatura.'], ['Formula con cambio de temperatura', 'Q = m * c * DeltaT'], ['Formula con cambio de estado', 'Q = m * L']],
        subtopics: {
            calor: {
                definition: 'El calor es energía que se transfiere de un cuerpo a otro por diferencia de temperatura.',
                explanation: 'El calor siempre fluye espontaneamente del cuerpo con mayor temperatura al de menor temperatura hasta acercarse al equilibrio térmico.',
                example: 'Si tocas una taza caliente, el calor pasa de la taza a tu mano.',
                question: 'Cuál es la diferencia entre calor y temperatura?'
            },
            temperatura: {
                definition: 'La temperatura indica que tan caliente o frio esta un cuerpo.',
                explanation: 'Esta relacionada con la energía de movimiento de las particulas de una sustancia.',
                example: 'Un vaso con agua a 80 grados Celsius tiene mayor temperatura que uno a 20 grados Celsius.',
                question: 'Que mide la temperatura en un cuerpo?'
            },
            'equilibrio térmico': {
                definition: 'El equilibrio térmico ocurre cuando dos cuerpos en contacto alcanzan la misma temperatura.',
                explanation: 'Cuando se llega al equilibrio térmico, deja de haber transferencia neta de calor entre los cuerpos.',
                example: 'Una cuchara fria dentro de sopa caliente se calienta hasta acercarse a la temperatura de la sopa.',
                question: 'Que ocurre cuando dos cuerpos alcanzan equilibrio térmico?'
            },
            'cambio de estado': {
                definition: 'El cambio de estado es la transformacion de una sustancia de solido a liquido, liquido a gas, gas a liquido u otro estado por ganancia o perdida de calor.',
                explanation: 'Durante el cambio de estado, la energía recibida o liberada se usa para cambiar la estructura de la sustancia, no necesariamente para aumentar o disminuir la temperatura.',
                example: 'Cuando el hielo recibe calor, se derrite y pasa de solido a liquido. Cuando el agua hierve, pasa de liquido a vapor.',
                question: 'Que ocurre con la temperatura durante un cambio de estado?'
            },
            'calor especifico': {
                definition: 'El calor especifico es la cantidad de calor necesaria para aumentar en un grado la temperatura de una unidad de masa de una sustancia.',
                explanation: 'Un material con calor especifico alto necesita mas energía para calentarse.',
                example: 'El agua tiene calor especifico alto, por eso tarda mas en calentarse que algunos metales.',
                question: 'Que representa c en Q = m * c * DeltaT?'
            },
            'calor latente': {
                definition: 'El calor latente es la energía necesaria para qué una sustancia cambie de estado sin cambiar su temperatura.',
                explanation: 'Se usa en procesos como fusion, vaporizacion, condensacion y solidificacion.',
                example: 'El agua puede seguir recibiendo calor mientras hierve, pero su temperatura se mantiene casi constante durante el cambio a vapor.',
                question: 'Que representa L en Q = m * L?'
            },
            conduccion: {
                definition: 'La conduccion es la transferencia de calor por contacto directo entre particulas.',
                explanation: 'Ocurre con facilidad en solidos, especialmente en metales.',
                example: 'Una cuchara metalica se calienta cuando queda dentro de una olla caliente.',
                question: 'Por qué los metales conducen bien el calor?'
            },
            conveccion: {
                definition: 'La conveccion es la transferencia de calor por movimiento de un fluido, como liquidos o gases.',
                explanation: 'Las zonas calientes suben y las frias bajan, generando corrientes.',
                example: 'El agua caliente sube dentro de una olla mientras el agua mas fria baja.',
                question: 'En que estados de la materia ocurre principalmente la conveccion?'
            },
            radiacion: {
                definition: 'La radiacion es la transferencia de energía térmica mediante ondas, sin necesitar contacto directo.',
                explanation: 'Puede ocurrir incluso en el vacio.',
                example: 'El Sol calienta la Tierra por radiacion.',
                question: 'Por qué la radiacion no necesita contacto directo?'
            }
        }
    },
    'calor especifico': {
        aliases: ['calor especifico'],
        title: 'calor especifico',
        definition: 'El calor especifico es la cantidad de calor que necesita una unidad de masa de una sustancia para aumentar su temperatura en un grado.',
        explanation: 'Cada material necesita distinta energía para calentarse. Por eso el agua tarda mas en calentarse que otros materiales: tiene calor especifico alto.',
        characteristics: ['Depende del material', 'Se relaciona con cambios de temperatura', 'Aparece en la formula Q = m * c * DeltaT', 'Mientras mayor es c, mas calor se necesita'],
        concepts: ['Calor', 'Masa', 'Cambio de temperatura', 'Material', 'Energía térmica'],
        formula: 'Q = m * c * DeltaT',
        example: 'Para calentar una masa de agua se necesita mas energía que para calentar una masa similar de metal, porque el agua tiene mayor calor especifico.',
        uses: 'Se usa para calcular energía necesaria al calentar o enfriar sustancias.',
        exercises: ['Que representa c en Q = m * c * DeltaT?', 'Si c aumenta, se necesita mas o menos calor?', 'En que procesos se usa el calor especifico?'],
        answers: ['El calor especifico.', 'Mas calor.', 'En calentamiento o enfriamiento con cambio de temperatura.'],
        flashcards: [['c', 'Calor especifico'], ['Formula', 'Q = m * c * DeltaT'], ['Idea clave', 'Materiales distintos requieren distinta energía']]
    },
    'calor latente': {
        aliases: ['calor latente'],
        title: 'calor latente',
        definition: 'El calor latente es la energía que una sustancia absorbe o libera para cambiar de estado sin cambiar su temperatura.',
        explanation: 'Durante un cambio de estado, como hielo a agua o agua a vapor, la energía se usa para romper o formar enlaces, no para subir la temperatura.',
        characteristics: ['Ocurre en cambios de estado', 'No cambia la temperatura durante el proceso', 'Depende de la sustancia', 'Puede ser de fusion o vaporizacion'],
        concepts: ['Cambio de estado', 'Fusion', 'Vaporizacion', 'Energía', 'Masa'],
        formula: 'Q = m * L',
        example: 'Cuando el agua hierve, sigue recibiendo calor, pero su temperatura se mantiene cerca de 100 grados Celsius mientras cambia a vapor.',
        uses: 'Se usa para estudiar ebullicion, fusion, evaporacion, refrigeracion y cambios de fase.',
        exercises: ['Que representa L?', 'Por qué no cambia la temperatura durante el cambio de estado?', 'Que formula usa calor latente?'],
        answers: ['El calor latente.', 'Porque la energía se usa para cambiar de estado.', 'Q = m * L.'],
        flashcards: [['Calor latente', 'Energía para cambiar de estado'], ['Formula', 'Q = m * L'], ['Ejemplo', 'Agua hirviendo que pasa a vapor']]
    },
    'funciones geometricas': {
        aliases: ['funciones geometricas', 'funcion geometrica', 'geometricas', 'geometria con funciones'],
        title: 'funciones geometricas',
        definition: 'Las funciones geometricas son relaciones matematicas que ayudan a representar figuras, medidas y comportamientos graficos. Permiten estudiar rectas, curvas, areas, perimetros, volumenes, puntos, transformaciones y patrones dentro del plano o del espacio.',
        explanation: 'En geometria, una funcion puede describir como cambia una medida cuando cambia otra. Por ejemplo, una recta puede representarse con una funcion lineal, una parabola con una funcion cuadratica y el area de una figura puede depender de una variable como el lado o el radio.',
        characteristics: ['Relacionan variables con figuras o medidas', 'Se pueden representar en graficas', 'Ayudan a estudiar rectas, curvas y superficies', 'Permiten calcular areas, perimetros o volumenes', 'Conectan algebra y geometria'],
        concepts: ['Plano cartesiano', 'Puntos', 'Rectas', 'Curvas', 'Area', 'Perimetro', 'Funcion lineal', 'Funcion cuadratica', 'Transformaciones'],
        formula: 'Ejemplos: recta y = mx + b, parabola y = ax^2 + bx + c, area de un cuadrado A = l^2, perimetro P = 4l.',
        example: 'Una funcion lineal como y = 2x + 1 representa una recta. Una funcion cuadratica como y = x^2 representa una parabola. Si el lado de un cuadrado es x, su area se puede representar como A(x) = x^2.',
        uses: 'Sirven para interpretar graficas, resolver problemas de medidas, modelar figuras, calcular areas y entender como cambian las formas cuando cambian sus dimensiones.',
        exercises: ['Representa y = 2x + 1 en una grafica y describe que figura forma.', 'Si el lado de un cuadrado mide x, escribe la funcion de su area.', 'Explica por que y = x^2 forma una parabola.', 'Da un ejemplo de una funcion que represente un perimetro.', 'Identifica si y = 3x + 2 es lineal o cuadratica.'],
        answers: ['Forma una recta.', 'A(x) = x^2.', 'Porque al elevar x al cuadrado, los valores forman una curva simetrica.', 'P(x) = 4x para un cuadrado.', 'Es lineal.'],
        flashcards: [
            ['Que son funciones geometricas?', 'Relaciones matematicas que representan figuras, medidas o graficas.'],
            ['Que funcion representa una recta?', 'Una funcion lineal: y = mx + b.'],
            ['Que funcion representa una parabola?', 'Una funcion cuadratica: y = ax^2 + bx + c.'],
            ['Cómo se representa el area de un cuadrado?', 'A(x) = x^2.']
        ]
    },
    'funciones cuadraticas': {
        aliases: ['funciones cuadraticas', 'funcion cuadratica', 'parabolas', 'parabola'],
        title: 'funciones cuadraticas',
        definition: 'Una funcion cuadratica es una funcion polinomica de segundo grado cuya grafica es una parabola.',
        explanation: 'Se usa para representar situaciones donde hay crecimiento curvo, trayectoria, areas o maximos y minimos.',
        characteristics: ['Tiene una variable elevada al cuadrado', 'Su grafica es una parabola', 'Puede abrir hacia arriba o hacia abajo', 'Tiene vertice', 'Puede cortar al eje x en cero, uno o dos puntos'],
        concepts: ['Parabola', 'Vertice', 'Eje de simetria', 'Raices', 'Concavidad'],
        formula: 'f(x) = ax^2 + bx + c, con a diferente de 0.',
        example: 'f(x) = x^2 - 4 tiene una parabola que corta al eje x en x = -2 y x = 2.',
        uses: 'Se usa en física para trayectorias, en economia para ganancias y en geometria para areas.',
        exercises: ['Identifica a, b y c en f(x)=2x^2+3x-1.', 'Que forma tiene la grafica de una cuadratica?', 'Si a es positivo, hacia donde abre la parabola?'],
        answers: ['a=2, b=3, c=-1.', 'Una parabola.', 'Hacia arriba.'],
        flashcards: [['Formula general', 'f(x)=ax^2+bx+c'], ['Grafica', 'Parabola'], ['Vertice', 'Punto minimo o maximo de la parabola']]
    },
    'funciones lineales': {
        aliases: ['funciones lineales', 'funcion lineal', 'rectas', 'recta'],
        title: 'funciones lineales',
        definition: 'Una funcion lineal representa una relacion de cambio constante y su grafica es una recta.',
        explanation: 'Cada vez que x aumenta una cantidad, y cambia siempre en la misma proporcion.',
        characteristics: ['Grafica recta', 'Cambio constante', 'Tiene pendiente', 'Puede cortar el eje y'],
        concepts: ['Pendiente', 'Intercepto', 'Plano cartesiano', 'Variacion constante'],
        formula: 'y = mx + b, donde m es la pendiente y b es el corte con el eje y.',
        example: 'y = 2x + 1 significa que por cada aumento de 1 en x, y aumenta 2.',
        uses: 'Se usa para costos fijos y variables, velocidad constante y comparaciones proporcionales.',
        exercises: ['En y=3x+2, cual es la pendiente?', 'Grafica y=x+1.', 'Que representa b en y=mx+b?'],
        answers: ['La pendiente es 3.', 'Una recta que corta en 1.', 'El corte con el eje y.'],
        flashcards: [['Funcion lineal', 'Relacion con grafica recta'], ['Pendiente', 'Indica inclinacion'], ['Formula', 'y=mx+b']]
    },
    'interes compuesto': {
        aliases: ['interes compuesto', 'interes', 'compuesto'],
        title: 'interes compuesto',
        definition: 'El interes compuesto es el calculo donde los intereses se suman al capital inicial y luego tambien generan nuevos intereses.',
        explanation: 'Se llama interes sobre interes porque cada periodo se calcula sobre una cantidad mayor.',
        characteristics: ['Crecimiento acumulativo', 'Depende del capital inicial', 'Depende de la tasa', 'Depende del tiempo', 'Crece mas rapido que el interes simple'],
        concepts: ['Capital inicial', 'Tasa de interes', 'Tiempo', 'Monto final', 'Interes sobre interes'],
        formula: 'M = C(1 + i)^t o A = P(1 + r)^t.',
        example: 'Si inviertes 100 dolares al 10% por 2 anos: M = 100(1.10)^2 = 121 dolares.',
        uses: 'Se usa en ahorros, inversiones, prestamos, tarjetas de credito y planes de retiro.',
        exercises: ['Calcula 100 dolares al 10% por 2 anos.', 'Calcula 250 dolares al 8% por 3 anos.', 'Calcula 500 dolares al 5% por 4 anos.', 'Explica la diferencia con interes simple.', 'Convierte 12% a decimal.'],
        answers: ['121.00 dolares.', '314.93 dolares aproximadamente.', '607.75 dolares aproximadamente.', 'El simple calcula sobre capital inicial; el compuesto sobre capital mas intereses.', '0.12.'],
        flashcards: [['Formula', 'M = C(1+i)^t'], ['Capital', 'Dinero inicial'], ['Tasa', 'Porcentaje aplicado por periodo'], ['Clave', 'Interes sobre interes']]
    },
    'logica matematica': {
        aliases: ['logica matematica', 'logica', 'proposiciones'],
        title: 'logica matematica',
        definition: 'La lógica matemática estudia razonamientos, proposiciones y reglas para determinar si un argumento es válido.',
        explanation: 'Ayuda a analizar enunciados verdaderos o falsos usando conectores como y, o, no, entonces y si y solo si.',
        characteristics: ['Usa proposiciones', 'Trabaja con valores de verdad', 'Usa conectores lógicos', 'Permite construir tablas de verdad'],
        concepts: ['Proposición', 'Negacion', 'Conjuncion', 'Disyuncion', 'Implicacion', 'Tabla de verdad'],
        formula: 'Ejemplo: p -> q significa si p entonces q.',
        example: 'p: estudio. q: apruebo. p -> q significa: si estudio, entonces apruebo.',
        uses: 'Se usa en matematica, programación, circuitos y pensamiento critico.',
        exercises: ['Niega la proposición: hoy llueve.', 'Que significa p y q?', 'Crea una tabla de verdad para p o q.'],
        answers: ['Hoy no llueve.', 'Que p y q son verdaderas al mismo tiempo.', 'Es falsa solo cuando p y q son falsas.'],
        flashcards: [['Proposición', 'Enunciado verdadero o falso'], ['Negacion', 'Cambia el valor de verdad'], ['Implicacion', 'Si p entonces q']]
    },
    porcentajes: {
        aliases: ['porcentajes', 'porcentaje', 'tanto por ciento'],
        title: 'porcentajes',
        definition: 'Un porcentaje representa una parte de cada 100.',
        explanation: 'Sirve para comparar cantidades, descuentos, aumentos, notas y proporciones.',
        characteristics: ['Se expresa con %', 'Relaciona una parte con 100', 'Puede convertirse a decimal', 'Se usa en descuentos e incrementos'],
        concepts: ['Parte', 'Total', 'Porcentaje', 'Decimal', 'Proporcion'],
        formula: 'Porcentaje = (parte / total) x 100.',
        example: '20% de 50 es 10, porque 0.20 x 50 = 10.',
        uses: 'Descuentos, impuestos, estadisticas, notas y finanzas.',
        exercises: ['Calcula 15% de 200.', 'Que porcentaje es 25 de 100?', 'Convierte 8% a decimal.'],
        answers: ['30.', '25%.', '0.08.'],
        flashcards: [['Porcentaje', 'Parte de 100'], ['20%', '0.20'], ['Formula', '(parte/total)x100']]
    },
    calorimetria: {
        aliases: ['calorimetria'],
        title: 'calorimetria',
        definition: 'La calorimetria estudia la cantidad de calor que gana o pierde un cuerpo.',
        explanation: 'Relaciona calor, masa, calor especifico y cambio de temperatura.',
        characteristics: ['Mide transferencia de calor', 'Usa masa y temperatura', 'Depende del material', 'Se aplica en cambios termicos'],
        concepts: ['Calor', 'Masa', 'Calor especifico', 'Temperatura', 'Equilibrio termico'],
        formula: 'Q = m c DeltaT.',
        example: 'Si calientas agua, el calor necesario depende de la masa del agua y cuanto sube su temperatura.',
        uses: 'Laboratorio, cocina, física térmica e ingenieria.',
        exercises: ['Identifica m, c y DeltaT en Q=mcDeltaT.', 'Que pasa si aumenta la masa?', 'Que mide Q?'],
        answers: ['Masa, calor especifico y cambio de temperatura.', 'Se necesita mas calor.', 'Cantidad de calor.'],
        flashcards: [['Q', 'Calor'], ['c', 'Calor especifico'], ['DeltaT', 'Cambio de temperatura']]
    },
    'movimiento rectilineo': {
        aliases: ['movimiento rectilineo', 'mru'],
        title: 'movimiento rectilineo',
        definition: 'El movimiento rectilineo ocurre cuando un objeto se desplaza en linea recta.',
        explanation: 'Puede tener velocidad constante o aceleracion, dependiendo del tipo de movimiento.',
        characteristics: ['Trayectoria recta', 'Puede tener velocidad constante', 'Puede tener aceleracion', 'Relaciona distancia y tiempo'],
        concepts: ['Posicion', 'Distancia', 'Tiempo', 'Velocidad', 'Aceleracion'],
        formula: 'MRU: v = d/t. MRUA: vf = vi + at.',
        example: 'Un carro que avanza 100 m en linea recta durante 10 s tiene velocidad media de 10 m/s.',
        uses: 'Analizar autos, trenes, caidas idealizadas y desplazamientos simples.',
        exercises: ['Calcula v si d=100m y t=10s.', 'Que significa trayectoria recta?', 'Diferencia MRU y MRUA.'],
        answers: ['10 m/s.', 'Que se mueve en linea recta.', 'MRU velocidad constante; MRUA aceleracion.'],
        flashcards: [['MRU', 'Movimiento rectilineo uniforme'], ['Velocidad', 'Distancia / tiempo'], ['Aceleracion', 'Cambio de velocidad']]
    },
    energía: {
        aliases: ['energía'],
        title: 'energía',
        definition: 'La energía es la capacidad de realizar trabajo o producir cambios.',
        explanation: 'Puede aparecer como energía cinetica, potencial, térmica, electrica, quimica y mas.',
        characteristics: ['Se transforma', 'No se crea ni se destruye', 'Puede almacenarse', 'Puede transferirse'],
        concepts: ['Trabajo', 'Energía cinetica', 'Energía potencial', 'Transformacion', 'Conservacion'],
        formula: 'Energía cinetica: Ec = 1/2 mv^2. Energía potencial: Ep = mgh.',
        example: 'Una pelota en altura tiene energía potencial; al caer, se transforma en energía cinetica.',
        uses: 'Fisica, electricidad, maquinas, movimiento y vida diaria.',
        exercises: ['Da un ejemplo de energía cinetica.', 'Que energía tiene un objeto elevado?', 'Que dice la conservacion de energía?'],
        answers: ['Un carro en movimiento.', 'Energía potencial.', 'La energía se transforma, no desaparece.'],
        flashcards: [['Energía', 'Capacidad de producir cambios'], ['Cinetica', 'Energía por movimiento'], ['Potencial', 'Energía por posición']]
    },
    fuerza: {
        aliases: ['fuerza', 'newton', 'ley de newton'],
        title: 'fuerza',
        definition: 'La fuerza es una interaccion capaz de cambiar el movimiento o la forma de un cuerpo.',
        explanation: 'Puede empujar, jalar, acelerar, frenar o deformar un objeto.',
        characteristics: ['Tiene magnitud', 'Tiene direccion', 'Se mide en newtons', 'Puede cambiar la velocidad'],
        concepts: ['Masa', 'Aceleracion', 'Newton', 'Peso', 'Friccion'],
        formula: 'F = m a.',
        example: 'Si empujas una caja, aplicas una fuerza que puede moverla si supera la friccion.',
        uses: 'Movimiento, maquinas, deportes, transporte y estructuras.',
        exercises: ['Calcula F si m=5kg y a=2m/s2.', 'Que unidad mide la fuerza?', 'Da un ejemplo de fuerza.'],
        answers: ['10 N.', 'Newton.', 'Empujar una puerta.'],
        flashcards: [['Fuerza', 'Interaccion que cambia movimiento'], ['Formula', 'F=ma'], ['Unidad', 'Newton']]
    },
    'base de datos': {
        aliases: ['base de datos', 'bases de datos', 'database'],
        title: 'base de datos',
        definition: 'Una base de datos es un sistema organizado para almacenar, consultar y administrar información.',
        explanation: 'Permite guardar usuarios, tareas, calificaciones, recursos y otros datos de forma estructurada.',
        characteristics: ['Organiza datos', 'Usa tablas o colecciones', 'Permite consultas', 'Puede relacionar información'],
        concepts: ['Tabla', 'Registro', 'Campo', 'Clave primaria', 'Consulta', 'Relacion'],
        formula: 'Ejemplo SQL: SELECT * FROM usuarios;',
        example: 'AC Edunity podria tener tablas de usuarios, materias, tareas, notas y recursos.',
        uses: 'Aplicaciones web, bancos, tiendas, escuelas y plataformas educativas.',
        exercises: ['Nombra tres tablas para AC Edunity.', 'Que es un registro?', 'Para que sirve una clave primaria?'],
        answers: ['Usuarios, materias y tareas.', 'Una fila de datos.', 'Para identificar un registro.'],
        flashcards: [['Tabla', 'Conjunto de datos'], ['Registro', 'Fila'], ['Campo', 'Columna']]
    },
    html: {
        aliases: ['html'],
        title: 'HTML',
        definition: 'HTML es el lenguaje de marcado que estructura el contenido de una pagina web.',
        explanation: 'Define titulos, parrafos, botones, formularios, imagenes, enlaces y secciones.',
        characteristics: ['Usa etiquetas', 'Estructura contenido', 'No es lenguaje de programación', 'Trabaja junto a CSS y JavaScript'],
        concepts: ['Etiqueta', 'Atributo', 'Elemento', 'Formulario', 'Enlace'],
        formula: '<h1>Título</h1>',
        example: '<button>Enviar</button> crea un boton.',
        uses: 'Crear la estructura de sitios y aplicaciones web.',
        exercises: ['Qué etiqueta crea un título principal?', 'Para que sirve <a>?', 'Crea un parrafo HTML.'],
        answers: ['<h1>.', 'Para enlaces.', '<p>Texto</p>.'],
        flashcards: [['HTML', 'Estructura web'], ['Etiqueta', 'Marca contenido'], ['Atributo', 'Agrega información']]
    },
    css: {
        aliases: ['css'],
        title: 'CSS',
        definition: 'CSS es el lenguaje que da estilo visual a una pagina web.',
        explanation: 'Controla colores, fuentes, tamanos, bordes, sombras, layouts y responsive.',
        characteristics: ['Estiliza HTML', 'Usa selectores', 'Permite responsive', 'Controla animaciones'],
        concepts: ['Selector', 'Propiedad', 'Valor', 'Clase', 'Flexbox', 'Grid'],
        formula: '.card { color: blue; }',
        example: 'button { background: purple; } cambia el fondo de los botones.',
        uses: 'Diseno visual, interfaces, adaptacion movil y animaciones.',
        exercises: ['Que propiedad cambia color de texto?', 'Para que sirve display flex?', 'Crea una clase .box.'],
        answers: ['color.', 'Para alinear elementos.', '.box { padding: 10px; }.'],
        flashcards: [['CSS', 'Estilos web'], ['Selector', 'Elige elementos'], ['Grid', 'Layout en filas y columnas']]
    },
    javascript: {
        aliases: ['javascript', 'js'],
        title: 'JavaScript',
        definition: 'JavaScript es un lenguaje de programación que permite agregar interactividad a paginas web.',
        explanation: 'Sirve para responder clics, guardar datos locales, cambiar contenido, validar formularios y crear logica.',
        characteristics: ['Es dinamico', 'Manipula el DOM', 'Responde eventos', 'Puede guardar datos en localStorage'],
        concepts: ['Variable', 'Funcion', 'Evento', 'DOM', 'Array', 'Objeto'],
        formula: 'function saludar() { console.log("Hola"); }',
        example: 'Un boton puede ejecutar JavaScript cuando el usuario hace clic.',
        uses: 'Apps web, juegos, formularios, dashboards y asistentes simulados.',
        exercises: ['Que es una variable?', 'Para que sirve addEventListener?', 'Crea una funcion simple.'],
        answers: ['Un espacio para guardar datos.', 'Para escuchar eventos.', 'function hola() { return "hola"; }.'],
        flashcards: [['JS', 'Interactividad web'], ['DOM', 'Documento HTML manipulable'], ['Evento', 'Accion del usuario']]
    },
    redes: {
        aliases: ['redes', 'redes informaticas', 'internet'],
        title: 'redes informaticas',
        definition: 'Una red informatica conecta dispositivos para compartir información y recursos.',
        explanation: 'Permite comunicacion entre computadoras, servidores, celulares e internet.',
        characteristics: ['Conecta dispositivos', 'Usa protocolos', 'Puede ser local o global', 'Comparte datos'],
        concepts: ['IP', 'Router', 'Servidor', 'Cliente', 'Protocolo', 'LAN', 'WAN'],
        formula: 'Ejemplo de IP: 192.168.1.1.',
        example: 'Cuando entras a una pagina, tu equipo se comunica con un servidor mediante internet.',
        uses: 'Internet, escuelas, empresas, videojuegos, correos y plataformas web.',
        exercises: ['Que es una IP?', 'Diferencia LAN y WAN.', 'Para que sirve un router?'],
        answers: ['Direccion de un dispositivo.', 'LAN local, WAN amplia.', 'Conecta y dirige trafico.'],
        flashcards: [['Red', 'Dispositivos conectados'], ['Router', 'Dirige datos'], ['IP', 'Direccion de red']]
    }
};

function findKnowledgeTopic(text) {
    const normalizedText = normalizeTutorText(text);
    return Object.keys(knowledgeBase).find(key => {
        const topic = knowledgeBase[key];
        return topic.aliases.some(alias => normalizedText.includes(normalizeTutorText(alias)));
    }) || '';
}

function getTopicProfile(topic) {
    const key = normalizeTutorText(topic);
    const knownKey = findKnowledgeTopic(key) || key;

    return knowledgeBase[knownKey] || {
        title: topic,
        unknown: true
    };
}

function getTutorResponse(userMessage) {
    const response = buildTutorSimulatedReply(userMessage);
    return finalizeTutorResponse(response);
}

function detectIntent(message) {
    return detectTutorIntent(message);
}

function findTutorSubtopic(message, profile) {
    if (!profile?.subtopics) return '';
    const text = normalizeTutorText(message);
    return Object.keys(profile.subtopics).find(subtopic => text.includes(normalizeTutorText(subtopic))) || '';
}

function shouldUseLastSubtopic(intent, message) {
    if (!lastSubtopic) return false;
    const text = normalizeTutorText(message);
    if (findKnowledgeTopic(text)) return false;
    if (/concepto|conceptos|ideas clave|puntos clave/.test(text)) return false;
    return ['example', 'practice', 'exercises', 'flashcards', 'review', 'definition', 'explain', 'steps', 'formula', 'formulas'].includes(intent);
}

function buildSubtopicReply(profile, subtopic, intent) {
    const data = profile.subtopics?.[subtopic];
    if (!data) return '';
    rememberTutorSubtopic(subtopic);

    if (intent === 'example') {
        return `Ejemplo de ${subtopic} en ${profile.title}:\n\n${data.example}\n\nExplicacion:\n${data.explanation}`;
    }
    if (intent === 'practice' || intent === 'exercises') {
        tutorState.pendingQuestion = {
            topic: subtopic,
            question: data.question,
            expected: data.definition,
            keywords: [subtopic].concat(data.definition.split(' ').slice(0, 5)).map(normalizeTutorText)
        };
        saveTutorPendingQuestion();
        return `Vamos a practicar ${subtopic}.\n\nPregunta:\n${data.question}\n\nResponde con tus palabras y te dire si esta bien.`;
    }
    if (intent === 'flashcards') {
        return `Flashcards de ${subtopic}:\n\nTarjeta 1\nPregunta: Qué es ${subtopic}?\nRespuesta: ${data.definition}\n\nTarjeta 2\nPregunta: Dame un ejemplo.\nRespuesta: ${data.example}\n\nTarjeta 3\nPregunta: Qué debo recordar?\nRespuesta: ${data.explanation}`;
    }
    if (intent === 'review' || intent === 'summary') {
        return `Resumen de ${subtopic}:\n\n${data.definition}\n\n${data.explanation}\n\nEjemplo:\n${data.example}`;
    }

    return `${subtopic} en ${profile.title}:\n\nDefinicion:\n${data.definition}\n\nExplicación sencilla:\n${data.explanation}\n\nEjemplo:\n${data.example}\n\nPregunta de practica:\n${data.question}`;
}

function fallbackInteligente(topic, intent = 'explain') {
    const cleanTopic = cleanFallbackTopic(topic);
    rememberTutorTopic(cleanTopic);

    if (intent === 'practice' || intent === 'exercises') {
        return `Practica sobre ${cleanTopic}:\n\n1. Explica con tus palabras que significa ${cleanTopic}.\n2. Menciona una situacion donde se use ${cleanTopic}.\n3. Identifica una ventaja o utilidad de ${cleanTopic}.\n4. Crea un ejemplo corto relacionado con ${cleanTopic}.\n5. Escribe una duda que todavía tengas sobre ${cleanTopic}.\n\nResponde la pregunta 1 y te ayudo a revisar tu respuesta.`;
    }

    if (intent === 'flashcards') {
        return `Flashcards sobre ${cleanTopic}:\n\nTarjeta 1\nPregunta: Qué es ${cleanTopic}?\nRespuesta: Es un concepto que representa una idea, proceso o medida importante dentro de su materia y permite analizar una situacion concreta.\n\nTarjeta 2\nPregunta: Para que sirve ${cleanTopic}?\nRespuesta: Sirve para interpretar datos, tomar decisiones, resolver actividades o explicar un fenomeno segun el contexto.\n\nTarjeta 3\nPregunta: Cómo se estudia ${cleanTopic}?\nRespuesta: Primero se entiende la definicion, luego se revisa un ejemplo y finalmente se practica con ejercicios o preguntas.`;
    }

    if (intent === 'review') {
        return `Resumen de ${cleanTopic}:\n\n${cleanTopic} es un tema que se entiende mejor observando que representa, como se aplica y que decisiones permite tomar. La idea principal es reconocer sus elementos, relacionarlos con un ejemplo y practicar con preguntas cortas.\n\nPuntos clave:\n1. Identifica su definicion.\n2. Reconoce sus partes o variables.\n3. Mira como se aplica en una situacion real.\n4. Practica explicandolo con tus propias palabras.`;
    }

    if (intent === 'example') {
        return `Ejemplo de ${cleanTopic}:\n\nImagina que estas analizando ${cleanTopic} en una actividad de clase. Primero identificas el dato principal, luego revisas que significa y finalmente lo usas para tomar una decision o resolver una pregunta.\n\nEjemplo aplicado:\nSi el tema se relaciona con emprendimiento, puede ayudarte a comparar costos, beneficios, riesgos o resultados. Si se relaciona con ciencias, puede ayudarte a explicar una causa y una consecuencia. Si se relaciona con matematica, puede ayudarte a calcular o interpretar un valor.`;
    }

    return `${cleanTopic}:\n\nDefinición:\n${buildProbableDefinition(cleanTopic)}\n\nExplicación sencilla:\nPiensa en ${cleanTopic} como una idea que ayuda a entender, medir o explicar una situación. Para estudiarlo bien, conviene separar qué significa, dónde aparece y cómo se usa en un caso real.\n\nEjemplo:\nSi hablamos de ${cleanTopic} en una actividad académica, puedes tomar una situación concreta, identificar los datos importantes y explicar qué resultado o decisión se obtiene a partir de ese concepto.\n\nPara qué sirve:\nSirve para comprender mejor el tema, resolver tareas, preparar exposiciones, responder preguntas de examen y conectar la teoría con situaciones prácticas.\n\nPreguntas de práctica:\n1. ¿Qué significa ${cleanTopic} con tus propias palabras?\n2. ¿En qué situación real se puede usar ${cleanTopic}?\n3. ¿Qué dato o idea es más importante para entender ${cleanTopic}?\n4. ¿Cómo explicarías ${cleanTopic} a un compañero?\n5. ¿Qué ejemplo sencillo podrías crear sobre ${cleanTopic}?`;
}

function isFallbackFollowUpMessage(message) {
    const text = normalizeTutorText(message);
    return /^(dame|hazme|quiero|necesito|ahora|puedes|muestrame|explica|explicame)?\s*(ejemplo|ejemplos|pregunta|preguntas|ejercicio|ejercicios|resumen|resumelo|flashcards|tarjetas|conceptos|practica|practicar)\b/.test(text)
        || /(del tema|este tema|lo anterior|eso|esto)/.test(text);
}

function cleanFallbackTopic(topic) {
    const clean = normalizeTutorText(topic)
        .replace(/ayudame|por favor|porfa|explicame|explica|dime|hazme|hacer|dame|quiero|necesito|puedes/g, ' ')
        .replace(/que es|que son|definicion|resumen|resumir|ejemplos|ejemplo|ejercicios|ejercicio|preguntas|pregunta|flashcards|cuestionario|conceptos|concepto|tema|del tema|debo aprender|pasos|paso a paso/g, ' ')
        .replace(/\b(el|la|los|las|un|una|unos|unas|de|del|sobre|acerca)\b/g, ' ')
        .replace(/[?.,;:!]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return clean || 'este tema';
}

function buildProbableDefinition(topic) {
    if (/tasa|interes|rendimiento|financiamiento|prestamo/.test(topic)) {
        return `La ${topic} es un porcentaje o medida que permite entender el costo, ganancia o rendimiento real de una operacion durante un periodo determinado.`;
    }
    if (/emprendimiento|negocio|empresa|ventas|mercado/.test(topic)) {
        return `${topic} se relaciona con la forma de organizar, evaluar o mejorar una idea de negocio para tomar mejores decisiones.`;
    }
    if (/física|calor|energía|movimiento|fuerza/.test(topic)) {
        return `${topic} es un concepto de física que ayuda a explicar como ocurre un fenomeno natural y que variables participan en el proceso.`;
    }
    if (/matematica|funcion|ecuacion|numero|porcentaje/.test(topic)) {
        return `${topic} es un concepto matematico que permite representar, calcular o comparar cantidades para resolver problemas.`;
    }
    if (/html|css|javascript|programación|base de datos|redes|software/.test(topic)) {
        return `${topic} es un concepto de informatica que sirve para crear, organizar o hacer funcionar sistemas digitales.`;
    }
    return `${topic} es un concepto que se estudia para comprender una idea principal, aplicarla en ejemplos y usarla para resolver preguntas o actividades.`;
}

function similarityScore(a, b) {
    const wordsA = new Set(normalizeTutorText(a).split(/\s+/).filter(word => word.length > 3));
    const wordsB = new Set(normalizeTutorText(b).split(/\s+/).filter(word => word.length > 3));
    if (!wordsA.size || !wordsB.size) return 0;
    let shared = 0;
    wordsA.forEach(word => {
        if (wordsB.has(word)) shared += 1;
    });
    return shared / Math.max(wordsA.size, wordsB.size);
}

function finalizeTutorResponse(response) {
    let finalResponse = response;
    if (lastTutorResponse && similarityScore(lastTutorResponse, finalResponse) > 0.82) {
        finalResponse = `${finalResponse}\n\nPara verlo de otra forma:\nPiensa en un ejemplo concreto y responde: que cambia, que se conserva y que formula o idea explica ese cambio?`;
    }
    lastTutorResponse = finalResponse;
    setTutorStorageValue('acStudyLastTutorResponse', finalResponse);
    return finalResponse;
}

function buildTutorSimulatedReply(message) {
    const intent = detectTutorIntent(message);
    lastIntent = intent;
    const topic = extractTutorTopic(message, intent);

    if (intent === 'answer-check') {
        return checkTutorPracticeAnswer(message);
    }

    const activeTopic = topic || tutorState.topic || lastTopic || '';
    if (!activeTopic) {
        return fallbackInteligente(message, intent);
    }

    if (activeTopic) rememberTutorTopic(activeTopic);
    const profile = getTopicProfile(activeTopic || 'tu tema');
    const pdfIntro = '';
    const directSubtopic = findTutorSubtopic(message, profile);
    const activeSubtopic = directSubtopic || (shouldUseLastSubtopic(intent, message) ? lastSubtopic : '');

    if (profile.unknown) {
        const fallbackSource = isFallbackFollowUpMessage(message) ? activeTopic : message;
        return fallbackInteligente(fallbackSource || activeTopic, intent);
    }

    if (activeSubtopic && profile.subtopics?.[activeSubtopic]) {
        return buildSubtopicReply(profile, activeSubtopic, intent);
    }

    if (intent === 'concepts') {
        return `${pdfIntro}estos son los conceptos principales de ${profile.title}:\n\n${profile.concepts.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n\nExplicacion central:\n${profile.definition}`;
    }
    if (intent === 'definition') {
        return `${pdfIntro}${profile.title}:\n\nDefinicion:\n${profile.definition}\n\nExplicacion clara:\n${profile.explanation}\n\nEjemplo:\n${profile.example}`;
    }
    if (intent === 'review') {
        return `${pdfIntro}resumen de ${profile.title}:\n\n${profile.definition}\n\n${profile.explanation}\n\nIdeas clave:\n${profile.concepts.slice(0, 5).map((item, index) => `${index + 1}. ${item}`).join('\n')}\n\nEjemplo:\n${profile.example}`;
    }
    if (intent === 'example') {
        return `${pdfIntro}ejemplo de ${profile.title}:\n\n${profile.example}\n\nUso en la vida cotidiana:\n${profile.uses}`;
    }
    if (intent === 'formula' || intent === 'formulas') {
        return `${pdfIntro}formula o regla de ${profile.title}:\n\n${profile.formula}\n\nCómo interpretarla:\n${profile.explanation}\n\nEjemplo:\n${profile.example}`;
    }
    if (intent === 'steps') {
        return `Pasos para trabajar ${profile.title}:\n\n1. Lee la definicion: ${profile.definition}\n2. Identifica los conceptos clave: ${profile.concepts.slice(0, 4).join(', ')}.\n3. Revisa la regla o formula: ${profile.formula}\n4. Mira un ejemplo: ${profile.example}\n5. Practica con un ejercicio parecido.`;
    }
    if (intent === 'exercises') {
        const wantsAnswers = /respuesta|respuestas|comprobar|solucion|soluciones/.test(normalizeTutorText(message));
        return `Ejercicios de ${profile.title}:\n\n${profile.exercises.map((item, index) => `${index + 1}. ${item}`).join('\n')}${wantsAnswers ? `\n\nRespuestas para comprobar:\n${profile.answers.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '\n\nIntenta resolverlos primero. Si quieres, luego escribe "dame las respuestas" y las revisamos.'}`;
    }
    if (intent === 'flashcards') {
        const cards = profile.flashcards || [
            [`Que es ${profile.title}?`, profile.definition],
            ['Cuáles son conceptos clave?', profile.concepts.slice(0, 4).join(', ')],
            ['Donde se usa?', profile.uses]
        ];
        return `Flashcards de ${profile.title}:\n\n${cards.map((card, index) => `Tarjeta ${index + 1}\nPregunta: ${card[0]}\nRespuesta: ${card[1]}`).join('\n\n')}`;
    }
    if (intent === 'exam') {
        return `Cuestionario para examen sobre ${profile.title}:\n\n1. Define ${profile.title}.\n2. Menciona tres conceptos clave.\n3. Explica un ejemplo.\n4. Para que sirve este tema?\n5. Resuelve o analiza: ${profile.exercises[0]}\n\nCuando respondas, puedo revisar tus respuestas una por una.`;
    }
    if (intent === 'practice') {
        const questions = profile.exercises.slice(0, 5);
        const question = questions[0] || `Explica ${profile.title} con tus palabras.`;
        tutorState.pendingQuestion = {
            topic: profile.title,
            question,
            expected: profile.answers[0] || profile.definition,
            keywords: profile.concepts.concat(profile.title.split(' ')).map(normalizeTutorText)
        };
        saveTutorPendingQuestion();
        return `Vamos a practicar ${profile.title}.\n\nPreguntas:\n${questions.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n\nResponde la pregunta 1 con tus palabras y te dire si esta bien. No te muestro respuestas todavía para qué puedas practicar.`;
    }

    return `${pdfIntro}te explico ${profile.title}:\n\nDefinicion:\n${profile.definition}\n\nExplicacion:\n${profile.explanation}\n\nCaracteristicas:\n${profile.characteristics.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n\nFormula o regla:\n${profile.formula}\n\nEjemplo:\n${profile.example}\n\nPara que sirve:\n${profile.uses}\n\nPuedes pedirme: ejemplos, ejercicios, resumen, flashcards o preguntas para practicar.`;
}

function checkTutorPracticeAnswer(answer) {
    const pending = tutorState.pendingQuestion;
    if (!pending) return buildTutorSimulatedReply(answer);

    const normalizedAnswer = normalizeTutorText(answer);
    const hits = pending.keywords.filter(keyword => keyword && normalizedAnswer.includes(keyword)).length;
    const looksGood = hits > 0 || normalizedAnswer.length > 35;

    tutorState.pendingQuestion = null;
    saveTutorPendingQuestion();

    if (looksGood) {
        return `Vas bien. Tu respuesta se relaciona con ${pending.topic}.\n\nLo que esta correcto:\nMencionaste ideas conectadas con el tema o diste una explicacion con sentido.\n\nRespuesta esperada:\n${pending.expected}\n\nPara mejorar:\nAgrega una definicion breve y un ejemplo concreto.`;
    }

    return `Aun falta un poco. Tu respuesta no menciona claramente la idea principal de ${pending.topic}.\n\nRespuesta esperada:\n${pending.expected}\n\nIntenta responder otra vez usando una definicion y un ejemplo corto.`;
}

function getTutorWorkspaceContext() {
    const state = workspaceState || loadWorkspace();
    return {
        subjects: Array.isArray(state.subjects) ? state.subjects : [],
        tasks: Array.isArray(state.tasks) ? state.tasks : [],
        resources: Array.isArray(state.resources) ? state.resources : []
    };
}

function getTutorConversationContext() {
    const history = tutorState.history.slice(-12);
    if (history[history.length - 1]?.role === 'user') {
        history.pop();
    }

    return history
        .filter(item => item?.content)
        .map(item => ({
            role: item.role === 'assistant' ? 'assistant' : 'user',
            content: String(item.content || '').slice(0, 4000)
        }));
}

function getTutorAIHistoryPayload() {
    try {
        const history = getTutorConversationContext();
        if (!Array.isArray(history)) return [];

        const ignoredResponses = [
            'No pude conectarme con la IA.',
            'No pude conectar con Tutor IA.'
        ];

        return history
            .filter(item => {
                if (!item || !['user', 'assistant'].includes(item.role)) return false;
                const content = String(item.content || '').trim();
                if (!content) return false;
                return !ignoredResponses.some(message => content.startsWith(message));
            })
            .map(item => ({
                role: item.role,
                content: String(item.content).trim().slice(0, 4000)
            }))
            .slice(-12);
    } catch (error) {
        console.warn('[TUTOR IA HISTORY] No se pudo preparar el historial:', error?.message || error);
        return [];
    }
}

async function requestTutorAI(userMessage) {
    try {
        const sb = getSupabaseClient();
        const { data: sessionData } = await sb.auth.getSession();

        if (!sessionData?.session) {
            return {
                ok: false,
                answer: "Debes iniciar sesión para usar Tutor IA."
            };
        }

        const tutorWorkspace = typeof loadWorkspace === 'function' ? loadWorkspace() : (workspaceState || {});
        const { data, error } = await sb.functions.invoke("tutor-ai", {
            body: {
                message: userMessage,
                history: getTutorAIHistoryPayload(),
                context: {
                    subjects: tutorWorkspace?.subjects || [],
                    tasks: tutorWorkspace?.tasks || [],
                    resources: tutorWorkspace?.resources || []
                }
            }
        });

        if (error) throw error;
        if (!data?.ok) {
            const remoteError = new Error(data?.error || "Error al conectar con Tutor IA.");
            remoteError.details = data?.details || data;
            throw remoteError;
        }

        return {
            ok: true,
            answer: data.answer || "No se obtuvo respuesta."
        };

    } catch (error) {
        const response = error?.context;
        let responseBody = null;

        if (response && typeof response.clone === 'function') {
            try {
                responseBody = await response.clone().json();
            } catch (_) {
                try {
                    responseBody = await response.clone().text();
                } catch (_) {
                    responseBody = null;
                }
            }
        }

        console.error("[TUTOR IA]", JSON.stringify({
            status: response?.status || error?.status || null,
            message: error?.message || "Error al conectar con Tutor IA.",
            details: responseBody?.details || responseBody?.error || error?.details || responseBody || null
        }));

        return {
            ok: false,
            answer: "No pude conectarme con la IA. Inténtalo nuevamente."
        };
    }
}

function stringifyTutorAIError(error) {
    if (!error) return '';
    if (typeof error === 'string') return error;

    const parts = [
        error.message,
        error.error,
        error.code,
        error.status,
        error.details,
        error.hint
    ].filter(Boolean);

    try {
        parts.push(JSON.stringify(error));
    } catch (_) {
        parts.push(String(error));
    }

    return parts.join(' ');
}

function isTutorBillingError(error) {
    return false;
}

function getTutorAIErrorAnswer(error, userMessage) {
    if (isTutorBillingError(error)) {
        console.warn("[TUTOR IA FALLBACK]", error);
        return `Estoy listo para ayudarte. Aquí tienes una explicación sencilla:\n\n${generateTutorDemoAnswer(userMessage)}`;
    }

    return "No pude conectar con Tutor IA. Intenta nuevamente.";
}

function generateTutorDemoAnswer(message) {
    const text = normalizeTutorText(message);
    const context = updateTutorDemoContext(message);
    const currentTopic = normalizeTutorText(context.topic || tutorState.lastTopic || tutorState.topic);
    const wantsDailyUse = /(situaciones|vida cotidiana|usar|utilizar|aplicar|sirve|para qué|como se usa|cuando se usa)/.test(text) || (context.isFollowUp && /(uso|usar|utilizar|aplicar|situacion|ejemplo)/.test(text));
    const wantsExercises = /(ejercicios|practicar|practica|problemas|resolver)/.test(text) || context.intent === 'exercises' || context.intent === 'practice';
    const wantsFlashcards = /(flashcards|tarjetas)/.test(text) || context.intent === 'flashcards';
    const wantsExam = /(examen|cuestionario|evaluacion)/.test(text) || context.intent === 'exam';
    const wantsReview = /(resumen|resume|resumir|repasar|repaso)/.test(text) || context.intent === 'review';

    if (wantsFlashcards) {
        return buildTutorFlashcards(context.topic || tutorState.lastTopic || tutorState.topic || 'tu tema');
    }

    if (wantsExam) {
        return buildTutorExam(context.topic || tutorState.lastTopic || tutorState.topic || 'tu tema');
    }

    if (currentTopic === 'física térmica') {
        if (wantsDailyUse) {
            return "La física térmica se usa en muchas situaciones diarias. Por ejemplo, cuando hierves agua, cuando una cuchara metalica se calienta dentro de una sopa, cuando el hielo se derrite o cuando usas un termo para conservar una bebida caliente. En todos esos casos aparecen conceptos como calor, temperatura, transferencia de energía y equilibrio térmico.";
        }
        if (wantsExercises) {
            return "Aqui tienes ejercicios sencillos sobre física térmica:\n\n1. Explica que diferencia hay entre calor y temperatura.\n2. Menciona 3 ejemplos de transferencia de calor en casa.\n3. Por qué el hielo se derrite cuando lo dejamos fuera del congelador?\n4. Qué pasa con la temperatura del agua cuando recibe calor?\n5. Explica que es el equilibrio térmico con un ejemplo.";
        }
        return "La física térmica estudia el calor, la temperatura y cómo la energía se transfiere entre los cuerpos. Por ejemplo, cuando calientas agua, aumenta su temperatura porque recibe energía. También incluye temas como calor específico, equilibrio térmico y cambios de estado.";
    }

    if (currentTopic === 'multiplicaciones') {
        if (wantsExercises || context.isFollowUp) {
            return "Claro, aquí tienes ejercicios de multiplicaciones:\n\n1. 12 x 4 = ____\n2. 25 x 3 = ____\n3. 18 x 5 = ____\n4. 36 x 2 = ____\n5. 14 x 6 = ____\n\nConsejo: multiplica primero las unidades y luego las decenas.";
        }
        return "La multiplicacion es una suma repetida. Por ejemplo, 4 x 3 significa sumar 4 tres veces: 4 + 4 + 4 = 12.";
    }

    if (currentTopic === 'funciones inversas') {
        if (wantsExercises || context.isFollowUp) {
            return "Practiquemos funciones inversas:\n\n1. Si f(x) = x + 3, halla f^-1(x).\n2. Si f(x) = 2x, halla f^-1(x).\n3. Si f(x) = x - 5, halla f^-1(x).\n\nRecuerda: cambia f(x) por y, intercambia x con y y despeja y.";
        }
        return "Una funcion inversa deshace lo que hace la funcion original. Si una funcion convierte x en y, la inversa convierte y nuevamente en x.";
    }

    if (currentTopic === 'matrices') {
        if (wantsExercises) {
            return "Ejercicios de matrices:\n\n1. Escribe una matriz de 2 filas y 3 columnas.\n2. Suma dos matrices 2x2 con valores sencillos.\n3. Identifica la posición del elemento a23.\n4. Explica para qué sirve una matriz en organización de datos.\n5. Crea una matriz con notas de 3 estudiantes.";
        }
        return "Una matriz es una tabla de numeros organizada en filas y columnas. Sirve para ordenar datos, resolver sistemas de ecuaciones y representar información de forma compacta.";
    }

    if (currentTopic === 'sql y bases de datos') {
        if (wantsExercises) {
            return "Practica de SQL y bases de datos:\n\n1. Qué es una tabla?\n2. Para que sirve una clave primaria?\n3. Escribe una consulta SELECT sencilla.\n4. Explica la diferencia entre fila y columna.\n5. Qué dato guardarias en una tabla de estudiantes?";
        }
        return "SQL es un lenguaje para consultar y administrar bases de datos. Una base de datos organiza información en tablas, filas y columnas para guardar, buscar y relacionar datos.";
    }

    if (wantsReview) {
        return "Puedo ayudarte a resumir textos. Para un buen resumen, identifica la idea principal, elimina detalles repetidos y escribe las ideas importantes con tus propias palabras.";
    }

    if (wantsExercises || /(preguntas|pregunta)/.test(text)) {
        return "Puedo ayudarte a crear preguntas de estudio. Ejemplo: 1) ¿Cuál es la idea principal del tema? 2) ¿Qué conceptos son más importantes? 3) ¿Cómo se aplica este tema en un ejemplo?";
    }

    return "Puedo ayudarte como tutor académico con explicaciones, resúmenes, preguntas y organización de estudio. Dime el tema que quieres aprender y te doy una explicación sencilla, ejemplos o preguntas para practicar.";
}

// Version final del fallback local: mantiene tema, intencion y evita repetir respuestas.
function getTutorAIErrorAnswer(error, userMessage) {
    if (isTutorBillingError(error)) {
        console.warn("[TUTOR IA FALLBACK]", error);
        return `Estoy listo para ayudarte. Aqui tienes una explicacion sencilla:\n\n${generateTutorDemoAnswer(userMessage)}`;
    }

    return "No pude conectar con Tutor IA. Intenta nuevamente.";
}

function generateTutorDemoAnswer(message) {
    const topicFromMessage = detectTutorTopic(message);
    const followUp = isTutorFollowUp(message);
    const intent = normalizeTutorDemoIntent(detectTutorIntent(message), message);
    const topic = normalizeTutorTopic(topicFromMessage || (followUp ? tutorState.lastTopic : '') || tutorState.lastTopic || tutorState.topic || 'tu tema');

    if (topic && topic !== 'tu tema') {
        rememberTutorTopic(topic);
    }

    tutorState.lastIntent = intent;
    tutorState.lastUserMessage = String(message || '').trim();
    tutorState.turnCount += 1;
    lastIntent = intent;

    let answer = buildTutorAnswerByIntent(topic || 'tu tema', intent, message);

    if (tutorState.lastAnswer && similarityScore(tutorState.lastAnswer, answer) > 0.82) {
        answer = buildAlternativeTutorAnswer(topic || 'tu tema', intent, message);
    }

    tutorState.lastAnswer = answer;
    lastTutorResponse = answer;
    setTutorStorageValue('acStudyLastTutorResponse', answer);
    return answer;
}

function normalizeTutorDemoIntent(intent, message) {
    const text = normalizeTutorText(message);

    if (/flashcard|tarjeta|tarjetas/.test(text) || intent === 'flashcards') return 'flashcards';
    if (/cuestionario|examen|evaluacion|prueba/.test(text) || intent === 'exam') return 'quiz';
    if (/pregunta|preguntas/.test(text) || intent === 'practice') return 'practice';
    if (/ejercicio|ejercicios|resolver|problema|problemas|practicar|practica/.test(text) || intent === 'exercises') return 'practice';
    if (/resumen|resume|resumir|repasar|repaso/.test(text) || intent === 'review') return 'summary';
    if (/ejemplo|ejemplos/.test(text) || intent === 'example') return 'examples';
    if (/vida cotidiana|utilizar|usar|aplicar|sirve|uso|para qué|cuando se usa|como se usa|situaciones|casos/.test(text)) return 'uses';
    if (/formula|formulas|ecuacion|regla/.test(text) || intent === 'formula') return 'formula';
    if (/paso|pasos|procedimiento|como se resuelve/.test(text) || intent === 'steps') return 'clarify';
    if (/concepto|conceptos|ideas clave|puntos clave|debo aprender/.test(text) || intent === 'concepts') return 'summary';
    if (/que es|que son|definicion|define|explicame|explica|no entiendo|ayuda/.test(text) || intent === 'definition' || intent === 'explain') return 'explain';
    return 'general';
}

function buildTutorAnswerByIntent(topic, intent, message) {
    const knownAnswer = getKnownTopicAnswer(topic, intent, message);
    if (knownAnswer) return knownAnswer;

    if (intent === 'practice' || intent === 'quiz') {
        return `Practiquemos ${topic} sin mostrar respuestas todavía:\n\n1. Explica que significa ${topic} con tus palabras.\n2. Menciona dos ideas importantes del tema.\n3. Escribe un ejemplo donde se pueda aplicar.\n4. Qué duda te queda sobre ${topic}?\n5. Cómo lo explicarias en una exposición corta?\n\nResponde la pregunta 1 y te ayudo a revisarla.`;
    }

    if (intent === 'flashcards') {
        return `Flashcards de ${topic}:\n\nTarjeta 1\nPregunta: Qué es ${topic}?\nRespuesta: Es la idea principal que debes comprender para explicar el tema.\n\nTarjeta 2\nPregunta: Para que sirve ${topic}?\nRespuesta: Sirve para resolver actividades, interpretar situaciones y conectar teoria con ejemplos.\n\nTarjeta 3\nPregunta: Cómo se practica ${topic}?\nRespuesta: Con una definicion propia, un ejemplo y una pregunta de comprobacion.`;
    }

    if (intent === 'summary') {
        return `Resumen de ${topic}:\n\n${buildProbableDefinition(topic)}\n\nIdeas clave:\n1. Identifica que significa.\n2. Reconoce sus partes o variables.\n3. Mira un ejemplo concreto.\n4. Practica explicandolo con tus palabras.\n\nEn una frase: ${topic} se entiende mejor cuando lo conectas con una situacion real.`;
    }

    if (intent === 'examples' || intent === 'uses') {
        return `${topic} en situaciones reales:\n\n${buildProbableDefinition(topic)}\n\nEjemplo sencillo:\nImagina que debes resolver una actividad de clase relacionada con ${topic}. Primero identificas el dato principal, luego revisas qué significa y finalmente explicas cómo se aplica para obtener una respuesta.\n\nPara qué sirve:\nSirve para entender mejor el contenido, resolver tareas, preparar exámenes y explicar el tema con ejemplos propios.`;
    }

    if (intent === 'formula') {
        return `${topic} puede tener reglas, pasos o formulas segun la materia.\n\nCómo estudiarlo:\n1. Identifica que representa cada dato.\n2. Escribe la regla o formula que dio el profesor.\n3. Reemplaza valores con orden.\n4. Comprueba si el resultado tiene sentido.\n\nSi me escribes la formula exacta, te ayudo a aplicarla paso a paso.`;
    }

    return `${topic}:\n\n${buildProbableDefinition(topic)}\n\nExplicación sencilla:\nPara entender ${topic}, empieza por identificar que representa, donde aparece y como se usa. Luego conecta la definicion con un ejemplo concreto para qué no se quede solo como teoria.\n\nEjemplo:\nSi el tema aparece en una tarea, busca los datos principales, explica que significan y relaciona cada parte con la pregunta que debes responder.\n\nPuedes pedirme ejemplos, ejercicios, resumen o flashcards sobre ${topic}.`;
}

function getKnownTopicAnswer(topic, intent, message) {
    const profile = getTopicProfile(topic);
    if (!profile || profile.unknown) {
        return '';
    }

    const title = profile.title || topic;
    const intro = '';
    const exercises = Array.isArray(profile.exercises) && profile.exercises.length
        ? profile.exercises
        : [`Explica ${title} con tus palabras.`, `Da un ejemplo sencillo de ${title}.`, `Para que sirve ${title}?`];
    const concepts = Array.isArray(profile.concepts) && profile.concepts.length
        ? profile.concepts
        : ['definicion', 'uso', 'ejemplo', 'practica'];
    const characteristics = Array.isArray(profile.characteristics) && profile.characteristics.length
        ? profile.characteristics
        : ['Tiene una idea principal', 'Se puede explicar con ejemplos', 'Se aplica en actividades de clase'];

    if (intent === 'practice') {
        return `${intro}Preguntas para practicar ${title}:\n\n${exercises.slice(0, 5).map((item, index) => `${index + 1}. ${item}`).join('\n')}\n\nResponde la pregunta 1 y te doy retroalimentacion. No te muestro respuestas todavía para qué puedas practicar.`;
    }

    if (intent === 'quiz') {
        return `${intro}Cuestionario de ${title}:\n\n1. Define ${title} con tus palabras.\n2. Menciona tres conceptos importantes.\n3. Explica un ejemplo sencillo.\n4. Para que sirve este tema?\n5. Resuelve o analiza: ${exercises[0] || `un caso relacionado con ${title}`}.\n\nCuando termines, escribe tus respuestas y las revisamos.`;
    }

    if (intent === 'flashcards') {
        const cards = profile.flashcards || [
            [`Que es ${title}?`, profile.definition],
            ['Cuáles son ideas clave?', concepts.slice(0, 4).join(', ')],
            ['Donde se usa?', profile.uses]
        ];
        return `${intro}Flashcards de ${title}:\n\n${cards.map((card, index) => `Tarjeta ${index + 1}\nPregunta: ${card[0]}\nRespuesta: ${card[1]}`).join('\n\n')}`;
    }

    if (intent === 'summary') {
        return `${intro}Resumen de ${title}:\n\n${profile.definition}\n\nIdeas principales:\n${concepts.slice(0, 5).map((item, index) => `${index + 1}. ${item}`).join('\n')}\n\nEjemplo:\n${profile.example}`;
    }

    if (intent === 'examples') {
        return `${intro}Ejemplos de ${title}:\n\n${profile.example}\n\nOtro modo de verlo:\n${profile.uses}`;
    }

    if (intent === 'uses') {
        return `${intro}${title} se usa para:\n\n${profile.uses}\n\nEjemplo sencillo:\n${profile.example}`;
    }

    if (intent === 'formula') {
        return `${intro}Formula o regla de ${title}:\n\n${profile.formula}\n\nCómo interpretarla:\n${profile.explanation}\n\nEjemplo:\n${profile.example}`;
    }

    if (intent === 'clarify') {
        return `${intro}Te lo explico paso a paso sobre ${title}:\n\n1. Idea central: ${profile.definition}\n2. Cómo funciona: ${profile.explanation}\n3. Qué debes recordar: ${concepts.slice(0, 4).join(', ')}.\n4. Ejemplo: ${profile.example}`;
    }

    return `${intro}${title}:\n\nDefinicion:\n${profile.definition}\n\nExplicacion clara:\n${profile.explanation}\n\nCaracteristicas:\n${characteristics.slice(0, 5).map((item, index) => `${index + 1}. ${item}`).join('\n')}\n\nEjemplo:\n${profile.example}\n\nPuedes seguir preguntando: "dame ejemplos", "hazme preguntas" o "dame flashcards".`;
}

function buildAlternativeTutorAnswer(topic, intent, message) {
    const cleanTopic = topic || tutorState.lastTopic || 'tu tema';

    if (intent === 'practice' || intent === 'quiz') {
        return `Vamos con una practica diferente sobre ${cleanTopic}:\n\n1. Escribe una definicion corta de ${cleanTopic}.\n2. Crea un ejemplo de la vida real.\n3. Menciona un error comun al estudiar este tema.\n4. Haz una pregunta que podria salir en una prueba.\n5. Explica el tema en menos de cuatro lineas.\n\nEmpieza por la primera y te la reviso.`;
    }

    if (intent === 'examples' || intent === 'uses') {
        return `Otra forma de entender ${cleanTopic}:\n\nPiensa en una situacion de clase donde necesitas usar el tema para tomar una decision o resolver una pregunta. Lo importante es reconocer que dato cambia, que dato se mantiene y que conclusion puedes obtener.\n\nEjemplo rapido:\nSi ${cleanTopic} aparece en un ejercicio, primero escribe los datos, luego identifica la regla del tema y por ultimo explica el resultado con palabras simples.`;
    }

    if (intent === 'flashcards') {
        return `Flashcards nuevas de ${cleanTopic}:\n\nTarjeta 1\nPregunta: Cuál es la idea principal de ${cleanTopic}?\nRespuesta: Entender que representa y como se aplica.\n\nTarjeta 2\nPregunta: Qué ejemplo puedo usar?\nRespuesta: Un caso sencillo de clase o de la vida diaria.\n\nTarjeta 3\nPregunta: Cómo se comprueba que lo entendi?\nRespuesta: Explicandolo con tus palabras y resolviendo una pregunta corta.`;
    }

    return `Lo vemos de otra forma sobre ${cleanTopic}:\n\nEn vez de memorizar, intenta responder tres cosas:\n\n1. Qué significa ${cleanTopic}?\n2. Para que se usa?\n3. Cómo se aplicaria en un ejemplo?\n\nSi puedes responder esas tres, ya tienes una base fuerte. Ahora dime si quieres ejercicios o ejemplos mas concretos.`;
}

// Capa final del Tutor demo: distingue operaciones, formulas y teoria escolar.
function detectTutorIntent(message) {
    const text = normalizeTutorText(message);

    if (tutorState.pendingQuestion && !/(otra pregunta|hazme preguntas|preguntas|cuestionario|examen|flashcards|resumen|explica|ejercicio|calcula|resolver)/.test(text)) {
        return 'answer-check';
    }
    if (/(resolver|resuelve|calcula|calcular|resultado|hallar|halla)/.test(text)) return 'solve';
    if (/(ejercicio|ejercicios|practicar|practica|operaciones|problema|problemas)/.test(text)) return 'practice';
    if (/(formula|formulas|ecuacion|regla)/.test(text)) return 'formulas';
    if (/(resumen|resume|resumir|repasar|repaso)/.test(text)) return 'summary';
    if (/(ejemplo|ejemplos)/.test(text)) return 'examples';
    if (/(pregunta|preguntas|examen|cuestionario|evaluacion|prueba)/.test(text)) return 'quiz';
    if (/(flashcard|flashcards|tarjeta|tarjetas)/.test(text)) return 'flashcards';
    if (/(que es|que son|explica|explicame|concepto|definicion|define|no entiendo|ayuda)/.test(text)) return 'explain';
    if (/(vida cotidiana|situaciones|sirve|usar|utilizar|aplica|aplicar|uso|usos|para qué|cuando se usa|como se usa)/.test(text)) return 'uses';

    if (tutorState.mode === 'practice') return 'practice';
    if (tutorState.mode === 'review') return 'summary';
    if (tutorState.mode === 'flashcards') return 'flashcards';
    if (tutorState.mode === 'exam') return 'quiz';
    return 'general';
}

function normalizeTutorTopic(topic) {
    const text = normalizeTutorText(topic);

    if (/(física térmica|térmica|termodinamica|calor|temperatura|calorimetria)/.test(text)) return 'física';
    if (/multiplic/.test(text)) return 'multiplicaciones';
    if (/divisi/.test(text)) return 'divisiones';
    if (/(suma|sumas)/.test(text)) return 'sumas';
    if (/(resta|restas)/.test(text)) return 'restas';
    if (/(fraccion|fracciones)/.test(text)) return 'fracciones';
    if (/(ecuacion|ecuaciones)/.test(text)) return 'ecuaciones';
    if (/funci/.test(text) && /inversa/.test(text)) return 'funciones inversas';
    if (/(funciones geometricas|funcion geometrica|geometria con funciones)/.test(text)) return 'funciones geometricas';
    if (/(funciones cuadraticas|funcion cuadratica|parabola)/.test(text)) return 'funciones cuadraticas';
    if (/(sql|base de datos|bases de datos)/.test(text)) return 'SQL';
    if (/quim/.test(text)) return 'quimica';
    if (/bio/.test(text)) return 'biologia';
    if (/program/.test(text)) return 'programación';
    if (/historia/.test(text)) return 'historia';
    if (/emprendimiento/.test(text)) return 'emprendimiento';
    if (/contabilidad/.test(text)) return 'contabilidad';
    if (/(lengua|literatura)/.test(text)) return 'lengua y literatura';
    if (/operaciones/.test(text)) return 'operaciones';
    if (/porcentaje/.test(text)) return 'porcentajes';

    return text.trim();
}

function detectTutorTopic(message) {
    const text = normalizeTutorText(message);
    const directTopics = [
        'física térmica', 'física', 'calor', 'temperatura',
        'multiplicaciones', 'multiplicacion', 'divisiones', 'division',
        'sumas', 'suma', 'restas', 'resta', 'operaciones',
        'fracciones', 'fraccion', 'ecuaciones', 'ecuacion',
        'funciones inversas', 'funcion inversa', 'funciones geometricas',
        'matrices', 'sql', 'base de datos', 'quimica', 'biologia',
        'historia', 'emprendimiento', 'contabilidad', 'lengua',
        'literatura', 'programación', 'porcentajes'
    ];

    const direct = directTopics.find(topic => text.includes(normalizeTutorText(topic)));
    if (direct) return normalizeTutorTopic(direct);

    const patterns = [
        /resumen de (.+)/i,
        /ejercicios de (.+)/i,
        /operaciones de (.+)/i,
        /preguntas de (.+)/i,
        /explicame (.+)/i,
        /que es (.+)/i,
        /formulas de (.+)/i,
        /concepto de (.+)/i,
        /calcula (.+)/i,
        /resolver (.+)/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            return normalizeTutorTopic(match[1].replace(/[?.!]/g, '').trim());
        }
    }

    return '';
}

function detectSubjectType(message, topic = '') {
    const text = normalizeTutorText(`${message} ${topic}`);
    const numericKeywords = [
        'numero', 'numeros', 'operacion', 'operaciones', 'suma', 'sumas',
        'resta', 'restas', 'multiplicacion', 'multiplicaciones', 'division',
        'divisiones', 'fraccion', 'fracciones', 'decimal', 'decimales',
        'porcentaje', 'porcentajes', 'ecuacion', 'ecuaciones', 'calcular',
        'calculo', 'matematica', 'algebra'
    ];
    const formulaKeywords = [
        'física', 'quimica', 'calor', 'temperatura', 'velocidad',
        'fuerza', 'energía', 'densidad', 'presion', 'movimiento',
        'formula', 'formulas'
    ];
    const theoryKeywords = [
        'historia', 'biologia', 'lengua', 'literatura', 'emprendimiento',
        'religion', 'ciudadania', 'derecho', 'teoria', 'concepto',
        'definicion', 'resumen', 'contabilidad'
    ];

    if (numericKeywords.some(keyword => text.includes(keyword))) return 'numeric';
    if (formulaKeywords.some(keyword => text.includes(keyword))) return 'formula';
    if (theoryKeywords.some(keyword => text.includes(keyword))) return 'theory';
    return 'general';
}

function isTutorFollowUp(message) {
    const text = normalizeTutorText(message);
    return /(eso|ese tema|este tema|lo puedo|en que|dame mas|otro|otra|tambien|sobre eso|de eso|ahora dame|hazme|practicar|continua|sigue|mas ejemplos|mas ejercicios)/.test(text);
}

function generateTutorDemoAnswer(message) {
    const intent = detectTutorIntent(message);
    if (intent === 'answer-check') {
        return checkTutorPracticeAnswer(message);
    }

    const detectedTopic = detectTutorTopic(message);
    const followUp = isTutorFollowUp(message);
    let topic = detectedTopic || '';

    if (!topic && followUp && tutorState.lastTopic) {
        topic = tutorState.lastTopic;
    }
    if (!topic && tutorState.lastTopic && intent !== 'general') {
        topic = tutorState.lastTopic;
    }
    if (!topic) {
        topic = 'el tema que estas estudiando';
    }

    topic = normalizeTutorTopic(topic);
    if (detectedTopic) {
        rememberTutorTopic(topic);
    } else if (!tutorState.lastTopic && topic !== 'el tema que estas estudiando') {
        rememberTutorTopic(topic);
    }

    const subjectType = detectSubjectType(message, topic);
    let answer = buildSmartTutorAnswer(topic, intent, subjectType, message);

    if (tutorState.lastAnswer && similarityScore(tutorState.lastAnswer, answer) > 0.82) {
        answer = buildAlternativeTutorAnswer(topic, intent, subjectType);
    }

    tutorState.lastIntent = intent;
    tutorState.lastAnswer = answer;
    tutorState.lastUserMessage = String(message || '').trim();
    tutorState.turnCount = (tutorState.turnCount || 0) + 1;
    lastIntent = intent;
    lastTutorResponse = answer;
    setTutorStorageValue('acStudyLastTutorResponse', answer);
    return answer;
}

function buildSmartTutorAnswer(topic, intent, subjectType, message) {
    const known = getKnownTopicAnswer(topic, intent, subjectType);
    if (known) return known;
    if (intent === 'flashcards') return buildSubjectFlashcards(topic, subjectType);
    if (subjectType === 'numeric') return buildNumericAnswer(topic, intent);
    if (subjectType === 'formula') return buildFormulaAnswer(topic, intent);
    if (subjectType === 'theory') return buildTheoryAnswer(topic, intent);
    return buildGeneralAcademicAnswer(topic, intent);
}

function buildSubjectFlashcards(topic, subjectType) {
    if (subjectType === 'numeric') {
        return `Flashcards de ${topic}:\n\nTarjeta 1\nPregunta: Qué debo hacer primero?\nRespuesta: Identificar la operacion y ordenar los numeros.\n\nTarjeta 2\nPregunta: Cómo reviso el resultado?\nRespuesta: Compruebo si tiene sentido y repito el calculo si hay duda.\n\nTarjeta 3\nPregunta: Cómo practico mejor?\nRespuesta: Resuelvo ejercicios cortos y luego aumento la dificultad.`;
    }

    if (subjectType === 'formula') {
        return `Flashcards de ${topic}:\n\nTarjeta 1\nPregunta: Qué debo identificar antes de usar una formula?\nRespuesta: Los datos, las unidades y la magnitud que se busca.\n\nTarjeta 2\nPregunta: Qué formula comun puedo recordar?\nRespuesta: v = d / t para velocidad, F = m * a para fuerza o Q = m * c * DeltaT para calor.\n\nTarjeta 3\nPregunta: Cómo evito errores?\nRespuesta: Revisando unidades y reemplazando datos paso a paso.`;
    }

    return `Flashcards de ${topic}:\n\nTarjeta 1\nPregunta: Qué es ${topic}?\nRespuesta: Es el concepto central que debes explicar con tus palabras.\n\nTarjeta 2\nPregunta: Qué debo recordar?\nRespuesta: Su definicion, caracteristicas y ejemplos principales.\n\nTarjeta 3\nPregunta: Cómo lo estudio?\nRespuesta: Leo el resumen, subrayo ideas clave y respondo preguntas de practica.`;
}

function buildNumericAnswer(topic, intent) {
    if (intent === 'solve') {
        return `Para resolver ${topic}, escribe la operacion exacta con sus numeros y la trabajamos paso a paso. Mientras tanto, practica asi:\n\n1. Identifica la operacion.\n2. Ordena los numeros.\n3. Resuelve con cuidado.\n4. Comprueba si el resultado tiene sentido.`;
    }

    if (intent === 'practice' || intent === 'quiz' || intent === 'general') {
        if (topic === 'multiplicaciones') {
            return "Practiquemos multiplicaciones:\n\n1. 12 x 4 = ____\n2. 25 x 3 = ____\n3. 18 x 5 = ____\n4. 36 x 2 = ____\n5. 14 x 6 = ____\n\nConsejo: multiplica primero las unidades y luego las decenas.";
        }
        if (topic === 'divisiones') {
            return "Practiquemos divisiones:\n\n1. 24 / 3 = ____\n2. 45 / 5 = ____\n3. 81 / 9 = ____\n4. 64 / 8 = ____\n5. 100 / 4 = ____";
        }
        if (topic === 'sumas') {
            return "Practiquemos sumas:\n\n1. 245 + 136 = ____\n2. 89 + 74 = ____\n3. 320 + 458 = ____\n4. 999 + 101 = ____\n5. 56 + 278 = ____";
        }
        if (topic === 'restas') {
            return "Practiquemos restas:\n\n1. 500 - 275 = ____\n2. 84 - 39 = ____\n3. 1000 - 456 = ____\n4. 73 - 28 = ____\n5. 640 - 125 = ____";
        }
        if (topic === 'fracciones') {
            return "Practiquemos fracciones:\n\n1. 1/2 + 1/4 = ____\n2. 3/4 - 1/4 = ____\n3. 2/3 + 1/3 = ____\n4. 1/5 + 2/5 = ____\n5. 4/6 simplificado = ____";
        }
        return "Practiquemos operaciones:\n\n1. 15 + 28 = ____\n2. 64 - 19 = ____\n3. 8 x 7 = ____\n4. 72 / 9 = ____\n5. 3/5 + 1/5 = ____";
    }

    if (intent === 'explain' || intent === 'summary') {
        return `${topic} se aprende mejor practicando paso a paso. Primero identifica que operacion debes hacer, luego ordena los numeros, resuelve con cuidado y finalmente revisa si el resultado tiene sentido.`;
    }

    return `Para trabajar ${topic}, lo ideal es practicar con operaciones numericas y revisar el procedimiento paso a paso.`;
}

function buildFormulaAnswer(topic, intent) {
    if (intent === 'formulas') {
        return `Fórmulas utiles para ${topic}:\n\n1. Calor sensible: Q = m * c * DeltaT\n2. Densidad: d = m / V\n3. Velocidad: v = d / t\n4. Fuerza: F = m * a\n5. Energía cinetica: Ec = 1/2 * m * v^2\n\nRecuerda revisar las unidades antes de reemplazar datos.`;
    }

    if (intent === 'practice' || intent === 'quiz') {
        return `Ejercicios de ${topic}:\n\n1. Calcula el calor necesario para calentar 2 kg de agua de 20 C a 40 C.\n2. Halla la densidad de un objeto de 500 g y volumen 250 cm3.\n3. Calcula la velocidad si un cuerpo recorre 100 m en 20 s.\n4. Halla la fuerza de un objeto de 4 kg con aceleracion de 3 m/s2.\n5. Explica que datos necesitas antes de usar una formula.`;
    }

    return `Resumen de ${topic}:\n\nConcepto: ${topic} estudia fenomenos que se pueden explicar con magnitudes, leyes y formulas.\n\nPuntos clave:\n- Identifica las magnitudes del problema.\n- Usa la formula correcta.\n- Reemplaza los datos con unidades.\n- Calcula y revisa el resultado.\n\nFórmulas comunes:\n- Calor: Q = m * c * DeltaT\n- Densidad: d = m / V\n- Velocidad: v = d / t\n- Fuerza: F = m * a\n\nEjemplo: si conoces distancia y tiempo, puedes calcular velocidad con v = d / t.`;
}

function buildTheoryAnswer(topic, intent) {
    if (intent === 'practice' || intent === 'quiz') {
        return `Preguntas para practicar ${topic}:\n\n1. Qué es ${topic}?\n2. Cuáles son sus caracteristicas principales?\n3. Por qué es importante?\n4. Escribe un ejemplo relacionado.\n5. Explica ${topic} con tus propias palabras.`;
    }

    if (intent === 'examples') {
        return `Ejemplos sobre ${topic}:\n\n1. Un ejemplo relacionado con la vida diaria.\n2. Un ejemplo que podria aparecer en clase.\n3. Un ejemplo tipo pregunta de examen.\n\nLuego puedes escribir uno propio y te ayudo a mejorarlo.`;
    }

    return `Resumen de ${topic}:\n\nConcepto: ${topic} es un tema que se estudia para comprender sus ideas principales, causas, caracteristicas y ejemplos.\n\nPuntos clave:\n- Definicion del tema.\n- Caracteristicas principales.\n- Ejemplos importantes.\n- Importancia en la materia.\n- Posibles preguntas de examen.\n\nPara estudiarlo mejor, lee el concepto, subraya ideas clave y explicalo con tus propias palabras.`;
}

function buildGeneralAcademicAnswer(topic, intent) {
    if (intent === 'practice') {
        return `Practiquemos ${topic}:\n\n1. Explica que significa ${topic}.\n2. Escribe un ejemplo.\n3. Haz una pregunta sobre el tema.\n4. Responde con tus propias palabras.\n5. Resume el tema en 2 lineas.`;
    }

    if (intent === 'summary') {
        return `Resumen de ${topic}:\n\nPara estudiar este tema, identifica el concepto principal, sus caracteristicas, ejemplos y posibles aplicaciones. Luego escribe una explicacion corta con tus propias palabras.`;
    }

    return `Puedo ayudarte con ${topic}. Dime si quieres una explicacion, resumen, formulas, ejemplos, ejercicios o preguntas para practicar.`;
}

function getKnownTopicAnswer(topic, intent, subjectType) {
    if (topic === 'física') {
        if (intent === 'practice' || intent === 'quiz') {
            return "Ejercicios de física:\n\n1. Calcula la velocidad si un objeto recorre 80 m en 10 s.\n2. Calcula la fuerza si una masa de 5 kg acelera a 2 m/s2.\n3. Explica la diferencia entre calor y temperatura.\n4. Da un ejemplo de energía en la vida diaria.\n5. Escribe una situacion donde actue una fuerza.";
        }
        if (intent === 'formulas') {
            return "Fórmulas de física:\n\n1. Velocidad: v = d / t\n2. Fuerza: F = m * a\n3. Calor: Q = m * c * DeltaT\n4. Densidad: d = m / V\n5. Energía cinetica: Ec = 1/2 * m * v^2";
        }
        return "Resumen de física:\n\nLa física estudia la materia, la energía, el movimiento, las fuerzas, el calor, la luz y otros fenomenos naturales.\n\nConceptos importantes:\n- Movimiento\n- Fuerza\n- Energía\n- Calor y temperatura\n- Electricidad\n\nFórmulas comunes:\n- Velocidad: v = d / t\n- Fuerza: F = m * a\n- Calor: Q = m * c * DeltaT\n\nEjemplo: cuando un objeto cae, se puede estudiar su movimiento y la fuerza de gravedad.";
    }

    if (topic === 'multiplicaciones') {
        if (intent === 'practice' || intent === 'quiz' || intent === 'general') {
            return "Ejercicios de multiplicaciones:\n\n1. 8 x 7 = ____\n2. 12 x 6 = ____\n3. 15 x 4 = ____\n4. 23 x 3 = ____\n5. 31 x 5 = ____\n\nSi quieres, luego puedo darte las respuestas.";
        }
        return "La multiplicacion es una suma repetida. Por ejemplo, 4 x 3 significa 4 + 4 + 4 = 12. Sirve para calcular grupos iguales de forma mas rapida.";
    }

    return '';
}

function buildAlternativeTutorAnswer(topic, intent, subjectType) {
    if (subjectType === 'numeric') {
        return `Vamos con otra practica de ${topic}:\n\n1. 9 x 3 = ____\n2. 16 + 27 = ____\n3. 45 - 18 = ____\n4. 36 / 6 = ____\n5. 2/4 + 1/4 = ____\n\nSi quieres, tambien puedo darte respuestas paso a paso.`;
    }

    if (subjectType === 'formula') {
        return `Veamos ${topic} de otra forma:\n\n1. Concepto: entiende que fenomeno estudia.\n2. Fórmula: identifica que ecuacion se usa.\n3. Datos: reemplaza valores con unidades.\n4. Resultado: calcula y revisa.\n\nEjemplo general: primero anotas datos, luego formula y al final reemplazas.`;
    }

    return `Lo vemos de otra manera: para estudiar ${topic}, separa el tema en concepto, caracteristicas, ejemplos y una pregunta de practica. Asi no solo memorizas, sino que entiendes mejor.`;
}

async function sendTutorMessage(userMessage, displayMessage = userMessage) {
    const cleanMessage = String(userMessage || '').trim();
    const visibleMessage = String(displayMessage || cleanMessage).trim();

    if (!cleanMessage) {
        notify('Escribe una pregunta o pega un texto.', 'error');
        return;
    }

    if (tutorRequestInProgress) return;
    tutorRequestInProgress = true;
    setTutorSendingState(true);

    const input = document.getElementById('ai-topic');
    appendTutorMessage('user', visibleMessage);
    addTutorHistory('user', visibleMessage);
    if (input) input.value = '';

    const thinking = showTutorThinking();

    try {
        const result = await requestTutorAI(cleanMessage);
        if (thinking) thinking.remove();

        appendTutorMessage('bot', result.answer, 'Tutor');
        addTutorHistory('assistant', result.answer);
    } catch (error) {
        if (thinking) thinking.remove();
        const answer = getTutorAIErrorAnswer(error, cleanMessage);
        console.error("[TUTOR IA UNEXPECTED ERROR]", error);
        appendTutorMessage('bot', answer, 'Tutor');
        addTutorHistory('assistant', answer);
    } finally {
        tutorRequestInProgress = false;
        setTutorSendingState(false);
        if (input) input.focus();
    }
}

async function generateTutorAnswer() {
    const input = document.getElementById('ai-topic');
    const topic = getAIInput();
    if (!topic) {
        notify('Escribe una pregunta o pega un texto.', 'error');
        return;
    }

    await sendTutorMessage(topic);
}

function buildAIResponse(type, topic) {
    if (type === 'questions' || type === 'quiz' || type === 'open' || type === 'truefalse') {
        return getTutorResponse(`hazme preguntas sobre ${topic || tutorState.topic}`);
    }
    if (type === 'flashcards') {
        return getTutorResponse(`flashcards sobre ${topic || tutorState.topic}`);
    }
    if (type === 'simple' || type === 'tutor') {
        return getTutorResponse(topic || tutorState.topic);
    }
    return getTutorResponse(`resumen de ${topic || tutorState.topic}`);
}

async function generateSummary() {
    const topic = getAIInput() || tutorState.lastTopic || tutorState.topic || '';
    if (!topic) {
        notify('Primero dime que tema quieres repasar.', 'error');
        return;
    }
    await sendTutorMessage(`Hazme un resumen de ${topic}`, `Resumen de ${topic}`);
}

async function generateQuestions() {
    const topic = getAIInput() || tutorState.lastTopic || tutorState.topic || '';
    if (!topic) {
        notify('Primero dime que tema quieres practicar.', 'error');
        return;
    }
    await sendTutorMessage(`Hazme preguntas sobre ${topic}`, `Preguntas sobre ${topic}`);
}

async function generateFlashcards() {
    const topic = getAIInput() || tutorState.lastTopic || tutorState.topic || '';
    if (!topic) {
        notify('Primero dime que tema quieres usar para flashcards.', 'error');
        return;
    }
    await sendTutorMessage(`Crea flashcards sobre ${topic}`, `Flashcards de ${topic}`);
}

async function generateSimpleExplanation() {
    const topic = getAIInput() || tutorState.lastTopic || tutorState.topic || '';
    if (!topic) {
        notify('Ingresa un tema para explicar.', 'error');
        return;
    }
    await sendTutorMessage(`Explicame ${topic}`, `Explicame ${topic}`);
}

async function generatePracticeCards() {
    const topic = getAIInput() || tutorState.lastTopic || tutorState.topic || '';
    if (!topic) {
        notify('Primero dime que tema quieres practicar.', 'error');
        return;
    }
    await sendTutorMessage(`Genera preguntas de practica sobre ${topic}`, `Practicar ${topic}`);
}

// ============================================
// UTILIDADES
// ============================================

// Prevenir envio de formularios con Enter en ciertos contextos
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && e.target.closest('.form-group textarea')) {
        // Permitir saltos de linea en textareas
        return;
    }
});

document.addEventListener('keydown', (event) => {
    if (event.target?.id === 'ai-topic' && event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        generateTutorAnswer();
    }
});

// Inicializar la aplicación cuando se carga la página
// Dashboard limpio sin emojis para evitar caracteres rotos por codificacion.
function renderDashboard(workspace) {
    const section = document.getElementById('dashboard');
    if (!section) return;

    const firstName = currentUser?.name ? currentUser.name.split(' ')[0] : 'Estudiante';
    const taskCounts = {
        pending: workspace.tasks.filter(task => getTaskVisualStatus(task) === 'pending').length,
        upcoming: workspace.tasks.filter(task => getTaskVisualStatus(task) === 'upcoming').length,
        completed: workspace.tasks.filter(task => getTaskVisualStatus(task) === 'completed').length,
        overdue: workspace.tasks.filter(task => getTaskVisualStatus(task) === 'overdue').length
    };
    const pending = taskCounts.pending + taskCounts.upcoming + taskCounts.overdue;
    const completed = taskCounts.completed;
    const nextEvent = getNextEvent(workspace);
    const average = getAverageGrade(workspace);
    const level = getLevel(workspace.xp);
    const isEmpty = !workspace.subjects.length && !workspace.tasks.length && !workspace.events.length && !workspace.grades.length && !workspace.resources.length;
    const taskProgress = workspace.tasks.length ? Math.round((completed / workspace.tasks.length) * 100) : 0;
    const gradeProgress = average ? average * 10 : 0;
    const xpProgress = Math.min(100, ((workspace.xp || 0) % 250) / 2.5);
    const xpCurrent = (workspace.xp || 0) % 1000;
    const today = new Date();
    const todayISO = today.toISOString().slice(0, 10);
    const readableDate = today.toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' });
    const tasksToday = workspace.tasks.filter(task => task.status !== 'completed' && normalizeDate(task.due) === todayISO).slice(0, 3);
    const upcomingTasks = workspace.tasks.filter(task => task.status !== 'completed').slice(0, 3);
    const upcomingEvents = workspace.events.slice(0, 3);
    const dayItems = [
        ...tasksToday.map(task => ({ title: task.title, meta: `${task.subject || 'General'} - vence hoy`, type: 'Tarea' })),
        ...upcomingEvents.map(event => ({ title: event.title, meta: `${event.day || event.date || 'Sin fecha'} - ${event.type || 'Evento'}`, type: 'Evento' })),
        ...(!tasksToday.length && !upcomingEvents.length ? upcomingTasks.map(task => ({ title: task.title, meta: `${task.subject || 'General'} - ${task.due || 'Sin fecha'}`, type: 'Pendiente' })) : [])
    ].slice(0, 4);
    const steps = [
        { label: 'Crea una materia', done: workspace.subjects.length > 0, action: "navigateTo('subjects')", hint: 'Define tus clases y organiza tu espacio.' },
        { label: 'Agrega una tarea', done: workspace.tasks.length > 0, action: "navigateTo('tasks')", hint: 'Anota pendientes, deberes y entregas.' },
        { label: 'Agenda un evento', done: workspace.events.length > 0, action: "navigateTo('calendar')", hint: 'Planifica pruebas, exposiciones y entregas.' },
        { label: 'Sube un apunte', done: workspace.resources.length > 0, action: "navigateTo('backpack')", hint: 'Guarda tus PDFs y recursos importantes.' },
        { label: 'Pregunta a Tutor', done: workspace.resources.some(resource => resource.usedAI), action: "navigateTo('ai-assistant')", hint: 'Practica con resúmenes, preguntas y flashcards.' }
    ];

    section.innerHTML = `
        <div class="dashboard-hero dashboard-student-hero">
            <div class="dashboard-hero-copy">
                <span class="dashboard-eyebrow">Panel académico</span>
                <h1>Hola, ${escapeHTML(firstName)} <span aria-hidden="true">&#128075;</span></h1>
                <p>${isEmpty ? 'Empieza configurando tu espacio académico.' : 'Listo para seguir aprendiendo hoy.'}</p>
                <div class="dashboard-hero-meta">
                    <span>${escapeHTML(readableDate)}</span>
                    <span>Un avance pequeño también cuenta.</span>
                </div>
                <div class="quick-actions-bar dashboard-hero-actions">
                    <button type="button" onclick="navigateTo('subjects')">+ Nueva materia</button>
                    <button type="button" onclick="navigateTo('tasks')">+ Nueva tarea</button>
                    <button type="button" onclick="navigateTo('calendar')">+ Nuevo evento</button>
                    <button type="button" onclick="navigateTo('backpack')">+ Subir apunte</button>
                </div>
            </div>
            <div class="dashboard-hero-widget">
                ${appIconHTML('bot', 'hero-widget-icon stat-icon stat-icon-assistant dashboard-icon')}
                <div>
                    <strong>Tutor IA</strong>
                    <p>Pregunta, resume apuntes o prepara un examen.</p>
                </div>
                <button class="btn-primary btn-small" type="button" onclick="navigateTo('ai-assistant')">Abrir Tutor</button>
            </div>
        </div>

        <div class="dashboard-grid">
            ${dashboardCard('subjects', 'Materias activas', workspace.subjects.length, workspace.subjects.length ? 'Materias creadas por ti' : 'Crea tu primera materia', workspace.subjects.length ? 100 : 0)}
            ${dashboardCard('tasks', 'Tareas pendientes', pending, workspace.tasks.length ? `${taskCounts.upcoming} próximas - ${taskCounts.overdue} vencidas - ${completed} completadas` : 'Agrega tu primer pendiente', taskProgress)}
            ${dashboardCard('calendar', 'Próximo evento', nextEvent ? nextEvent.title : 'Sin eventos', nextEvent ? `${nextEvent.day || nextEvent.date || 'Sin fecha'} - ${nextEvent.type || 'Evento'}` : 'Agenda tu primer examen', nextEvent ? 70 : 0)}
            ${dashboardCard('grades', 'Promedio actual', average ? average.toFixed(2) : '--', workspace.grades.length ? `${workspace.grades.length} calificaciones registradas` : 'Registra tus calificaciones', gradeProgress)}
        </div>

        <div class="dashboard-layout dashboard-clean-layout">
            <div class="card dashboard-panel-card dashboard-progress-card">
                <div class="panel-title">
                    ${appIconHTML('chart', 'panel-icon panel-icon-chart dashboard-icon')}
                    <div>
                        <h3>Mi progreso</h3>
                        <p>Nivel ${level} - ${xpCurrent}/1000 XP</p>
                    </div>
                </div>
                <div class="dashboard-progress-body">
                    <div class="dashboard-xp-ring" style="--xp:${xpProgress}%">
                        <span>${Math.round(xpProgress)}%</span>
                        <small>avance</small>
                    </div>
                    <div class="dashboard-progress-details">
                        <strong>${workspace.xp || 0} XP acumulado</strong>
                        <span>${1000 - xpCurrent} XP para completar el ciclo actual.</span>
                        <div class="progress-bar"><div class="progress-fill" style="width:${xpProgress}%"></div></div>
                        <div class="dashboard-achievements">
                            <span>${workspace.subjects.length ? 'Materia creada' : 'Primera materia pendiente'}</span>
                            <span>${completed ? 'Tarea completada' : 'Completa tu primera tarea'}</span>
                            <span>${workspace.resources.length ? 'Apunte subido' : 'Sube un apunte'}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card dashboard-panel-card dashboard-day-card">
                    <div class="panel-title">
                        ${appIconHTML('clock', 'panel-icon panel-icon-day dashboard-icon')}
                        <div>
                            <h3>Mi día</h3>
                            <p>Tareas, eventos y recordatorios importantes.</p>
                        </div>
                    </div>
                    ${dayItems.length ? `
                        <ul class="dashboard-day-list">
                            ${dayItems.map(item => `
                                <li>
                                    <span>${escapeHTML(item.type)}</span>
                                    <div>
                                        <strong>${escapeHTML(item.title)}</strong>
                                        <small>${escapeHTML(item.meta)}</small>
                                    </div>
                                </li>
                            `).join('')}
                        </ul>
                    ` : `
                        <div class="dashboard-empty-note">
                            <strong>No tienes pendientes hoy.</strong>
                            <span>Buen momento para adelantar una materia o preguntarle algo a Tutor.</span>
                        </div>
                    `}
            </div>

            <div class="card starter-card dashboard-panel-card">
                    <div class="panel-title">
                        ${appIconHTML('list', 'panel-icon panel-icon-steps dashboard-icon')}
                        <div>
                            <h3>${isEmpty ? 'Empieza configurando tu espacio académico' : 'Centro del estudiante'}</h3>
                            <p>${isEmpty ? 'Sigue estos pasos para construir tu plataforma desde cero.' : 'Completa estos pasos para mantener tu espacio al día.'}</p>
                        </div>
                    </div>
                    <ol class="starter-list dashboard-steps">
                        ${steps.slice(0, 4).map((step, index) => `
                            <li class="${step.done ? 'done' : ''}">
                                <span class="step-number">${step.done ? 'OK' : index + 1}</span>
                                <div>
                                    <strong>${escapeHTML(step.label)}</strong>
                                    <small>${escapeHTML(step.hint)}</small>
                                </div>
                                <button type="button" onclick="${step.action}">${step.done ? 'Listo' : 'Abrir'}</button>
                            </li>
                        `).join('')}
                    </ol>
            </div>

            <div class="card weekly-progress-card dashboard-panel-card">
                    <div class="panel-title">
                        ${appIconHTML('chart', 'panel-icon panel-icon-chart dashboard-icon')}
                        <div>
                            <h3>Progreso semanal</h3>
                            <p>Vista simulada de tu avance durante la semana.</p>
                        </div>
                    </div>
                    <div class="weekly-chart" aria-label="Progreso semanal simulado">
                        ${[15, 20, 25, 30, 35, 40, Math.min(95, 20 + completed * 12)].map(value => `<span class="week-day" style="height:${value}%"></span>`).join('')}
                    </div>
                    <p class="chart-caption">${completed ? `Has completado ${completed} tarea(s).` : 'Tu gráfico crecerá cuando completes actividades.'}</p>
            </div>
        </div>
    `;
}

function dashboardCard(icon, label, value, subtext, progress) {
    return `
        <div class="stat-card dashboard-stat-card">
            <div class="stat-header">
                ${appIconHTML(getDashboardIconName(icon), `stat-icon stat-icon-${escapeHTML(icon)} dashboard-icon`)}
                <span class="stat-label">${escapeHTML(label)}</span>
            </div>
            <div class="stat-value">${escapeHTML(value)}</div>
            <div class="stat-subtext">${escapeHTML(subtext)}</div>
            <div class="progress-bar"><div class="progress-fill" style="width:${Math.max(0, Math.min(100, progress))}%"></div></div>
        </div>
    `;
}

function emptyStateHTML(message, buttonText, action) {
    return `
        <div class="empty-state">
            <div class="empty-icon" aria-hidden="true"></div>
            <h3>${escapeHTML(message)}</h3>
            <button class="btn-primary btn-small" onclick="${action}">${escapeHTML(buttonText)}</button>
        </div>
    `;
}

function normalizeSubjectIcon(icon) {
    return subjectBookOptions.some(option => option.value === icon) ? icon : 'book-blue';
}

function isKnownSubjectIcon(icon) {
    return subjectBookOptions.some(option => option.value === icon);
}

function addSubjectUI() {
    openSubjectForm();
}

function openSubjectForm(subjectId = null) {
    const workspace = loadWorkspace();
    const subject = workspace.subjects.find(item => item.id === subjectId);

    openQuickForm({
        title: subject ? 'Editar materia' : 'Crear materia',
        submitLabel: subject ? 'Actualizar materia' : 'Guardar materia',
        fields: [
            { name: 'name', label: 'Nombre de la materia', value: subject?.name || '', placeholder: 'Ej: Matemática' },
            { name: 'icon', label: 'Icono de la materia', type: 'choice-grid', options: subjectBookOptions, value: normalizeSubjectIcon(subject?.icon) },
            { name: 'customIcon', label: 'Icono personalizado opcional', value: subject?.customIcon || '', required: false, placeholder: 'Ej: MAT, BIO, AI' },
            { name: 'color', label: 'Color identificador', type: 'choice-grid', options: subjectColorOptions, value: subject?.color || 'Azul' },
            { name: 'description', label: 'Descripción corta', type: 'textarea', rows: 3, value: subject?.description || '', required: false, placeholder: 'Ej: Álgebra, geometría y resolución de problemas.' },
            { name: 'goal', label: 'Objetivo de la materia', type: 'textarea', rows: 3, value: subject?.goal || '', required: false, placeholder: 'Ej: Subir mi promedio y entregar tareas a tiempo.' }
        ],
        onSubmit: values => {
            const fresh = loadWorkspace();
            if (subjectId) {
                const item = fresh.subjects.find(entry => entry.id === subjectId);
                if (item) {
                    const oldName = item.name;
                    item.name = values.name.trim();
                    item.icon = normalizeSubjectIcon(values.icon);
                    item.customIcon = values.customIcon.trim();
                    item.color = values.color || 'Azul';
                    item.description = values.description.trim();
                    item.goal = values.goal.trim();
                    fresh.tasks.forEach(task => {
                        if (task.subject === oldName) task.subject = item.name;
                    });
                    fresh.grades.forEach(grade => {
                        if (grade.subject === oldName) grade.subject = item.name;
                    });
                    fresh.resources.forEach(resource => {
                        if (resource.subject === oldName) resource.subject = item.name;
                    });
                    addRecent(fresh, `Editaste la materia ${item.name}.`);
                }
            } else {
                fresh.subjects.push({
                    id: createId(),
                    name: values.name.trim(),
                    icon: normalizeSubjectIcon(values.icon),
                    customIcon: values.customIcon.trim(),
                    color: values.color || 'Azul',
                    description: values.description.trim(),
                    goal: values.goal.trim(),
                    createdAt: new Date().toISOString()
                });
                addXP(fresh, 30);
                addRecent(fresh, `Creaste la materia ${values.name.trim()}.`);
            }
            saveWorkspace(fresh);
            refreshWorkspaceUI();
            notify(subjectId ? 'Materia actualizada.' : 'Materia creada correctamente.', 'success');
        }
    });
}

function getSubjectMetrics(workspace, subject) {
    const tasks = workspace.tasks.filter(task => task.subjectId === subject.id || task.subject === subject.name);
    const pendingTasks = tasks.filter(task => task.status !== 'completed');
    const completedTasks = tasks.filter(task => task.status === 'completed');
    const grades = workspace.grades.filter(grade => grade.subject === subject.name);
    const resources = workspace.resources.filter(resource => resource.subject === subject.name);
    const subjectKey = normalizeTutorText(subject.name);
    const events = workspace.events.filter(event => normalizeTutorText(`${event.title || ''} ${event.subject || ''}`).includes(subjectKey));
    const progress = tasks.length ? Math.round((completedTasks.length / tasks.length) * 100) : 0;
    const average = getSubjectAverage(workspace, subject.name);
    const nextEvent = events[0] || workspace.events.find(event => normalizeTutorText(event.title || '').includes(subjectKey)) || null;
    const recent = (workspace.recent || []).find(item => normalizeTutorText(item.text).includes(subjectKey));

    return {
        tasks,
        pendingTasks,
        completedTasks,
        grades,
        resources,
        events,
        progress,
        average,
        nextEvent,
        recentText: recent ? recent.text : (subject.createdAt ? 'Materia creada por el estudiante.' : 'Sin actividad registrada.')
    };
}

function getSubjectIconMarkup(subject) {
    const storedIcon = String(subject.icon || '').trim();
    const iconValue = isKnownSubjectIcon(storedIcon) ? storedIcon : 'book-blue';
    const iconName = getSubjectVisualIconName(iconValue);
    return `<span class="subject-icon subject-symbol subject-icon-${escapeHTML(normalizeSubjectIcon(iconValue))}" aria-hidden="true">${appIconSvg(iconName)}</span>`;
}

function ensureSubjectsToolbar(grid) {
    const section = document.getElementById('subjects');
    if (!section || section.querySelector('.subjects-toolbar')) return;
    grid.insertAdjacentHTML('beforebegin', `
        <div class="subjects-toolbar">
            <label class="subjects-search">
                <span>Buscar</span>
                <input type="search" id="subject-search" placeholder="Buscar materia..." value="${escapeHTML(subjectFilterText)}">
            </label>
            <label class="subjects-sort">
                <span>Ordenar por</span>
                <select id="subject-sort">
                    <option value="name" ${subjectSortMode === 'name' ? 'selected' : ''}>Nombre</option>
                    <option value="progress" ${subjectSortMode === 'progress' ? 'selected' : ''}>Progreso</option>
                    <option value="average" ${subjectSortMode === 'average' ? 'selected' : ''}>Mejor promedio</option>
                    <option value="tasks" ${subjectSortMode === 'tasks' ? 'selected' : ''}>Más tareas</option>
                </select>
            </label>
        </div>
    `);
}

function bindSubjectsToolbar() {
    const search = document.getElementById('subject-search');
    const sort = document.getElementById('subject-sort');
    if (search && !search.dataset.bound) {
        search.dataset.bound = 'true';
        search.addEventListener('input', event => {
            subjectFilterText = event.target.value;
            renderSubjects(loadWorkspace());
        });
    }
    if (sort && !sort.dataset.bound) {
        sort.dataset.bound = 'true';
        sort.addEventListener('change', event => {
            subjectSortMode = event.target.value;
            renderSubjects(loadWorkspace());
        });
    }
}

function sortSubjectsForView(subjects, workspace) {
    return [...subjects].sort((a, b) => {
        const metricsA = getSubjectMetrics(workspace, a);
        const metricsB = getSubjectMetrics(workspace, b);
        if (subjectSortMode === 'progress') return metricsB.progress - metricsA.progress;
        if (subjectSortMode === 'average') return metricsB.average - metricsA.average;
        if (subjectSortMode === 'tasks') return metricsB.tasks.length - metricsA.tasks.length;
        return a.name.localeCompare(b.name);
    });
}

function renderSubjects(workspace) {
    const grid = document.querySelector('.subjects-grid');
    if (!grid) return;
    ensureSubjectsToolbar(grid);
    const filteredSubjects = sortSubjectsForView(workspace.subjects.filter(subject => normalizeTutorText(subject.name).includes(normalizeTutorText(subjectFilterText))), workspace);

    grid.innerHTML = workspace.subjects.length ? (filteredSubjects.length ? filteredSubjects.map(subject => {
        const metrics = getSubjectMetrics(workspace, subject);
        const color = subjectColorMap[subject.color] || subjectColorMap.Morado;
        return `
            <div class="subject-card subject-custom ac-colored-card subject-space-card" style="--subject-color:${color}">
                <div class="subject-orbit" aria-hidden="true"></div>
                <div class="subject-header">
                    <div class="subject-title">
                        ${getSubjectIconMarkup(subject)}
                        <div>
                            <h3>${escapeHTML(subject.name)}</h3>
                            <p>${escapeHTML(subject.description || 'Espacio académico personalizado')}</p>
                        </div>
                    </div>
                    <span class="subject-chip">${escapeHTML(subject.color || 'Morado')}</span>
                </div>
                <div class="subject-progress-block">
                    <div><span>Progreso</span><strong>${metrics.progress}%</strong></div>
                    <div class="progress-bar"><div class="progress-fill" style="width:${metrics.progress}%; background:linear-gradient(90deg, ${color}, #49ccf9)"></div></div>
                </div>
                <div class="subject-metric-grid">
                    <div><span>Pendientes</span><strong>${metrics.pendingTasks.length}</strong></div>
                    <div><span>Completadas</span><strong>${metrics.completedTasks.length}</strong></div>
                    <div><span>Promedio</span><strong>${metrics.average ? metrics.average.toFixed(2) : '--'}</strong></div>
                    <div><span>Apuntes</span><strong>${metrics.resources.length}</strong></div>
                </div>
                <div class="subject-card-footer">
                    <p><strong>Próxima entrega:</strong> ${metrics.nextEvent ? escapeHTML(`${metrics.nextEvent.title} - ${metrics.nextEvent.date || metrics.nextEvent.day || 'Sin fecha'}`) : 'Sin entregas programadas'}</p>
                    <p><strong>Ultima actividad:</strong> ${escapeHTML(metrics.recentText)}</p>
                </div>
                <div class="card-actions">
                    <button class="btn-primary btn-small" data-subject-open="${escapeHTML(subject.id)}">Abrir materia</button>
                    <button class="btn-secondary btn-small" data-subject-edit="${escapeHTML(subject.id)}">Editar</button>
                    <button class="btn-danger btn-small" data-subject-delete="${escapeHTML(subject.id)}">Eliminar</button>
                </div>
            </div>
        `;
    }).join('') : emptyStateHTML('No se encontraron materias con esa búsqueda.', 'Limpiar búsqueda', "clearSubjectSearch()")) : emptyStateHTML('No tienes materias todavía. Organiza tu aprendizaje creando tu primera materia.', '+ Crear materia', 'addSubjectUI()');

    bindSubjectsToolbar();
    grid.querySelectorAll('[data-subject-open]').forEach(button => button.addEventListener('click', () => openSubjectDetails(button.dataset.subjectOpen)));
    grid.querySelectorAll('[data-subject-edit]').forEach(button => button.addEventListener('click', () => openSubjectForm(button.dataset.subjectEdit)));
    grid.querySelectorAll('[data-subject-delete]').forEach(button => button.addEventListener('click', () => deleteSubject(button.dataset.subjectDelete)));
}

function clearSubjectSearch() {
    subjectFilterText = '';
    const search = document.getElementById('subject-search');
    if (search) search.value = '';
    renderSubjects(loadWorkspace());
}

function openSubjectDetails(subjectId) {
    const workspace = loadWorkspace();
    const subject = workspace.subjects.find(item => item.id === subjectId);
    if (!subject) return;
    const metrics = getSubjectMetrics(workspace, subject);
    const color = getAcademicColorValue(subject.color);
    const modal = document.createElement('div');
    modal.className = 'quick-modal subject-detail-modal';
    modal.innerHTML = `
        <div class="quick-modal-card subject-detail-card" style="${getAcademicCardStyle(color)}" role="dialog" aria-modal="true" aria-label="Detalle de ${escapeHTML(subject.name)}">
            ${neonLinesHTML()}
            <button class="quick-modal-close" type="button" aria-label="Cerrar">x</button>
            <div class="subject-detail-hero">
                ${getSubjectIconMarkup(subject)}
                <div>
                    <span class="subject-chip">${escapeHTML(subject.color || 'Morado')}</span>
                    <h3>${escapeHTML(subject.name)}</h3>
                    <p>${escapeHTML(subject.goal || subject.description || 'Espacio de estudio de la materia.')}</p>
                </div>
            </div>
            <div class="subject-detail-stats">
                <div><span>Progreso</span><strong>${metrics.progress}%</strong></div>
                <div><span>Pendientes</span><strong>${metrics.pendingTasks.length}</strong></div>
                <div><span>Completadas</span><strong>${metrics.completedTasks.length}</strong></div>
                <div><span>Promedio</span><strong>${metrics.average ? metrics.average.toFixed(2) : '--'}</strong></div>
            </div>
            <div class="subject-detail-columns">
                <section>
                    <h4>Tareas</h4>
                    ${metrics.tasks.length ? metrics.tasks.slice(0, 5).map(task => `<p><strong>${escapeHTML(task.title)}</strong><span>${escapeHTML(getTaskStatusLabel(task.status))} - ${escapeHTML(task.due || 'Sin fecha')}</span></p>`).join('') : '<p class="muted-panel">Sin tareas relacionadas.</p>'}
                </section>
                <section>
                    <h4>Calificaciónes</h4>
                    ${metrics.grades.length ? metrics.grades.slice(0, 5).map(grade => `<p><strong>${escapeHTML(grade.activity || 'Actividad')}</strong><span>${escapeHTML(String(grade.value || '--'))}</span></p>`).join('') : '<p class="muted-panel">Sin calificaciones registradas.</p>'}
                </section>
                <section>
                    <h4>Mochila</h4>
                    ${metrics.resources.length ? metrics.resources.slice(0, 5).map(resource => `<p><strong>${escapeHTML(resource.title)}</strong><span>${escapeHTML(resource.fileName || 'PDF simulado')}</span></p>`).join('') : '<p class="muted-panel">Sin apuntes de esta materia.</p>'}
                </section>
                <section>
                    <h4>Actividad</h4>
                    <p><strong>Ultimo movimiento</strong><span>${escapeHTML(metrics.recentText)}</span></p>
                    <p><strong>Próximo evento</strong><span>${metrics.nextEvent ? escapeHTML(metrics.nextEvent.title) : 'Sin eventos programados'}</span></p>
                </section>
            </div>
        </div>
    `;
    modal.addEventListener('click', event => {
        if (event.target === modal || event.target.classList.contains('quick-modal-close')) modal.remove();
    });
    document.body.appendChild(modal);
}

function renderBackpack(workspace) {
    const section = document.getElementById('backpack');
    const container = document.querySelector('.backpack-container');
    if (!section || !container) return;

    const header = section.querySelector('.section-header');
    if (header && !header.querySelector('[data-action="add-resource"]')) {
        header.insertAdjacentHTML('beforeend', '<button class="btn-primary btn-small" data-action="add-resource" onclick="addResourceUI()">+ Subir PDF simulado</button>');
    }

    container.innerHTML = workspace.resources.length ? workspace.resources.map(resource => {
        const description = resource.description || resource.content || 'Sin descripción';
        const shortDescription = description.length > 130 ? `${description.slice(0, 130)}...` : description;
        return `
            <div class="resource-card">
                <div class="resource-top">
                    ${appIconHTML('file', 'resource-icon resource-pdf-icon pdf-icon material-icon')}
                    <div class="resource-info">
                        <h4>${escapeHTML(resource.title)}</h4>
                        <p class="resource-type">${escapeHTML(resource.subject)} - ${escapeHTML(resource.fileName || 'PDF simulado')}</p>
                    </div>
                </div>
                <p class="resource-date">${escapeHTML(shortDescription)}</p>
                <div class="resource-actions resource-actions-grid">
                    <button class="btn-secondary btn-small" data-resource-view="${escapeHTML(resource.id)}">Ver</button>
                    <button class="btn-secondary btn-small" data-resource-ai="${escapeHTML(resource.id)}">Preguntar a la IA</button>
                    <button class="btn-secondary btn-small" data-resource-practice="${escapeHTML(resource.id)}">Practicar con PDF</button>
                    <button class="btn-secondary btn-small" data-resource-edit="${escapeHTML(resource.id)}">Editar</button>
                    <button class="btn-danger btn-small" data-resource-delete="${escapeHTML(resource.id)}">Eliminar</button>
                </div>
            </div>
        `;
    }).join('') : emptyStateHTML('No has subido apuntes todavía.', 'Subir primer PDF', 'addResourceUI()');

    container.querySelectorAll('[data-resource-view]').forEach(button => button.addEventListener('click', () => viewResource(button.dataset.resourceView)));
    container.querySelectorAll('[data-resource-ai]').forEach(button => button.addEventListener('click', () => askAIAboutResource(button.dataset.resourceAi)));
    container.querySelectorAll('[data-resource-practice]').forEach(button => button.addEventListener('click', () => practiceWithResource(button.dataset.resourcePractice)));
    container.querySelectorAll('[data-resource-edit]').forEach(button => button.addEventListener('click', () => openResourceForm(button.dataset.resourceEdit)));
    container.querySelectorAll('[data-resource-delete]').forEach(button => button.addEventListener('click', () => deleteResource(button.dataset.resourceDelete)));
}

function renderProgress(workspace) {
    const container = document.querySelector('.progress-container');
    if (!container) return;

    const xp = workspace.xp || 0;
    const level = getLevel(xp);
    const xpPerLevel = 250;
    const xpCurrent = xp % xpPerLevel;
    const xpToNext = xpPerLevel - xpCurrent;
    const xpProgress = Math.min(100, (xpCurrent / xpPerLevel) * 100);
    const completedTasks = workspace.tasks.filter(task => task.status === 'completed').length;
    const attendancePositive = workspace.attendance.filter(item => isAttendancePositive(item.status)).length;
    const average = getAverageGrade(workspace);
    const achievements = [
        { name: 'Primera materia', detail: 'Crea tu primera clase', icon: 'subject', unlocked: workspace.subjects.length > 0 },
        { name: 'Primera tarea', detail: 'Agrega un pendiente', icon: 'task', unlocked: workspace.tasks.length > 0 },
        { name: 'Tarea completada', detail: 'Marca una tarea como lista', icon: 'done', unlocked: completedTasks > 0 },
        { name: 'Primer apunte', detail: 'Sube un PDF o recurso', icon: 'note', unlocked: workspace.resources.length > 0 },
        { name: 'Uso de Tutor', detail: 'Pregunta con un apunte', icon: 'ai', unlocked: workspace.resources.some(resource => resource.usedAI) },
        { name: 'Primera racha', detail: 'Registra tu primer día activo', icon: 'streak', unlocked: (workspace.streak || 0) > 0 },
        { name: '7 días de racha', detail: 'Mantente constante', icon: 'streak', unlocked: (workspace.streak || 0) >= 7 },
        { name: 'Nivel 5 alcanzado', detail: 'Acumula suficiente XP', icon: 'level', unlocked: level >= 5 },
        { name: 'Estudiante constante', detail: 'Registra asistencia', icon: 'constant', unlocked: attendancePositive >= 5 },
        { name: 'Buen promedio', detail: 'Alcanza 8.00 o más', icon: 'average', unlocked: average >= 8 },
        { name: 'Primer PDF', detail: 'Guarda tu primer recurso', icon: 'pdf', unlocked: workspace.resources.length > 0 }
    ];
    const unlocked = achievements.filter(item => item.unlocked).length;
    const pathLevels = [1, 2, 3, 4, 5];

    container.innerHTML = `
        <div class="progress-hero premium-border">
            <div class="progress-hero-copy">
                <span class="progress-eyebrow">Camino académico</span>
                <h2>Nivel ${level}</h2>
                <p>${xp ? 'Estás cerca del siguiente nivel.' : 'Completa actividades para desbloquear logros.'}</p>
                <div class="progress-xp-meta">
                    <span>${xp} XP acumulado</span>
                    <span>${xpToNext} XP para nivel ${level + 1}</span>
                </div>
                <div class="xp-bar progress-xp-bar" aria-label="Progreso de XP">
                    <div class="xp-fill" style="width:${xpProgress}%"></div>
                </div>
                <small>${xpCurrent}/${xpPerLevel} XP en este nivel</small>
            </div>
            <div class="progress-level-orb" style="--xp:${xpProgress}%">
                <strong>${level}</strong>
                <span>Nivel actual</span>
            </div>
        </div>

        <div class="progress-stat-grid">
            ${progressStatCard('streak', 'Racha actual', `${workspace.streak || 0}`, 'días activos')}
            ${progressStatCard('trophy', 'Logros desbloqueados', `${unlocked}/${achievements.length}`, 'insignias premium')}
            ${progressStatCard('status', 'Estado', xp ? 'En progreso' : 'Inicial', xp ? 'sigue avanzando' : 'empieza desde cero')}
            ${progressStatCard('activity', 'Actividad académica', workspace.subjects.length + workspace.tasks.length + workspace.resources.length, 'acciones registradas')}
            ${progressStatCard('tasks', 'Tareas completadas', completedTasks, 'retos terminados')}
        </div>

        <section class="progress-path premium-border">
            <div class="progress-section-title">
                <h3>Camino del estudiante</h3>
                <p>Avanza por niveles mientras usas AC Edunity.</p>
            </div>
            <div class="student-path">
                ${pathLevels.map(pathLevel => `
                    <div class="path-step ${level >= pathLevel ? 'active' : ''} ${level === pathLevel ? 'current' : ''}">
                        <span>${pathLevel}</span>
                        <small>Nivel ${pathLevel}</small>
                    </div>
                `).join('')}
            </div>
        </section>

        ${xp ? '' : `
            <div class="progress-empty-callout premium-border">
                <strong>Completa actividades para desbloquear logros.</strong>
                <span>Crea materias, termina tareas, sube apuntes, usa Tutor y registra asistencia.</span>
            </div>
        `}

        <section class="achievements-section progress-achievements premium-border">
            <div class="progress-section-title">
                <h3>Logros desbloqueados</h3>
                <p>Insignias que reflejan tu avance real dentro de la plataforma.</p>
            </div>
            <div class="achievements-grid premium-achievements-grid">
                ${achievements.map(item => `
                    <div class="achievement premium-achievement progress-achievement-card ${item.unlocked ? 'unlocked' : 'locked'}">
                        ${achievementIconHTML(item.icon, item.unlocked)}
                        <p>${escapeHTML(item.name)}</p>
                        <small>${item.unlocked ? escapeHTML(item.detail) : 'Bloqueado'}</small>
                    </div>
                `).join('')}
            </div>
        </section>
    `;
}

function progressStatCard(type, label, value, detail) {
    return `
        <div class="progress-stat premium-progress-stat stat-${escapeHTML(type)} premium-border">
            <span class="progress-stat-icon" aria-hidden="true"></span>
            <div>
                <span class="stat-label">${escapeHTML(label)}</span>
                <span class="stat-value">${escapeHTML(value)}</span>
                <small>${escapeHTML(detail)}</small>
            </div>
        </div>
    `;
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        if (!file || !file.name) {
            resolve('');
            return;
        }

        const reader = new FileReader();
        reader.onload = () => resolve(reader.result || '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function openResourceForm(resourceId = null) {
    const workspace = loadWorkspace();
    const resource = workspace.resources.find(item => item.id === resourceId);
    openQuickForm({
        title: resource ? 'Editar recurso' : 'Subir PDF',
        submitLabel: resource ? 'Actualizar recurso' : 'Guardar recurso',
        fields: [
            { name: 'title', label: 'Título del recurso', value: resource?.title || '', placeholder: 'Ej: Guía de estudio' },
            { name: 'subject', label: 'Materia', type: 'select', options: getSubjectOptions(workspace), value: resource?.subject || '' },
            { name: 'file', label: 'Archivo PDF', type: 'file', accept: '.pdf,application/pdf', required: !resource },
            { name: 'description', label: 'Descripción corta', type: 'textarea', value: resource?.description || resource?.content || '', placeholder: 'Describe de qué trata el PDF' },
            { name: 'tag', label: 'Etiqueta', type: 'select', options: ['Apunte', 'Guía', 'Informe', 'Proyecto', 'Tarea'], value: resource?.tag || 'Apunte' },
            { name: 'useWithTutor', label: 'Tutor', type: 'checkbox', checked: resource?.useWithTutor !== false, help: 'Usar con Tutor' }
        ],
        onSubmit: async values => {
            const fresh = loadWorkspace();
            const subject = findSubjectByName(fresh, values.subject);
            const uploadedFile = values.file && values.file.name ? values.file : null;
            const fileName = uploadedFile?.name || resource?.fileName || `${values.title.trim()}.pdf`;
            let fileDataUrl = resource?.fileDataUrl || '';

            try {
                // Futuro: reemplazar este DataURL local por subida a Google Drive o Supabase Storage.
                if (uploadedFile) fileDataUrl = await readFileAsDataUrl(uploadedFile);
            } catch (error) {
                notify('No se pudo leer el PDF. Intenta subirlo otra vez.', 'error');
                return;
            }

            const payload = {
                title: values.title.trim(),
                subject: values.subject,
                fileName,
                fileDataUrl,
                fileMime: uploadedFile?.type || resource?.fileMime || 'application/pdf',
                description: values.description.trim(),
                content: values.description.trim(),
                type: 'PDF',
                tag: values.tag || 'Apunte',
                useWithTutor: values.useWithTutor === 'yes',
                uploadedAt: resource?.uploadedAt || new Date().toISOString()
            };

            try {
                const user = await getCurrentSupabaseUser();
                const resourceData = {
                    user_id: user.id,
                    subject_id: subject?.id || null,
                    title: payload.title,
                    file_name: payload.fileName,
                    file_url: payload.fileDataUrl || payload.fileUrl || null,
                    description: payload.description
                };
                console.log("[RESOURCES] insertando recurso", resourceData);

                if (resourceId) {
                    const { error } = await getSupabaseClient()
                        .from('resources')
                        .update(resourceData)
                        .eq('id', resourceId)
                        .eq('user_id', user.id);

                    if (error) {
                        logSupabaseError('resources update', error);
                        throw error;
                    }
                    pushRecentMessage(`Editaste el recurso ${payload.title}.`);
                } else {
                    const { error } = await getSupabaseClient()
                        .from('resources')
                        .insert(resourceData);

                    if (error) {
                        logSupabaseError('resources insert', error);
                        throw error;
                    }
                    await updateProfileProgress(20, { bumpStreak: true });
                    pushRecentMessage(`Subiste el PDF ${payload.title}.`);
                }
            } catch (error) {
                notify(error.message || 'No se pudo guardar el recurso en Supabase.', 'error');
                return;
            }

            await syncWorkspaceFromSupabase();
            refreshWorkspaceUI();
            notify(resourceId ? 'Recurso actualizado.' : 'PDF guardado correctamente.', 'success');
        }
    });
}

function getResourceSubject(workspace, resource) {
    return workspace.subjects.find(subject => subject.name === resource.subject) || null;
}

function getResourceColor(workspace, resource) {
    const subject = getResourceSubject(workspace, resource);
    return subjectColorMap[subject?.color] || subjectColorMap[resource.color] || '#49ccf9';
}

function formatResourceDate(dateValue) {
    if (!dateValue) return 'Sin fecha';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return 'Sin fecha';
    return date.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getRelativeResourceDate(dateValue) {
    if (!dateValue) return 'Recien agregado';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return 'Recien agregado';
    const diffDays = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
    if (diffDays === 0) return 'Hoy';
    if (diffDays === 1) return 'Hace 1 día';
    return `Hace ${diffDays} días`;
}

function getResourceStatus(resource) {
    if (resource.usedAI) return { label: 'Usado con Tutor', className: 'used' };
    const uploaded = new Date(resource.uploadedAt || 0).getTime();
    if (uploaded && Date.now() - uploaded < 3 * 86400000) return { label: 'Nuevo', className: 'new' };
    return { label: 'Pendiente de repasar', className: 'pending' };
}

function ensureBackpackToolbar(section, workspace) {
    if (!section || section.querySelector('.backpack-toolbar')) return;
    const header = section.querySelector('.section-header');
    if (!header) return;

    const subjectOptions = ['<option value="all">Todas las materias</option>']
        .concat(workspace.subjects.map(subject => `<option value="${escapeHTML(subject.name)}">${escapeHTML(subject.name)}</option>`))
        .join('');

    header.insertAdjacentHTML('afterend', `
        <div class="backpack-toolbar">
            <label class="backpack-search">
                <span>Buscar recurso</span>
                <input type="search" id="backpack-search" placeholder="Buscar PDF, apunte o proyecto..." value="${escapeHTML(backpackFilterText)}">
            </label>
            <label>
                <span>Materia</span>
                <select id="backpack-subject-filter">${subjectOptions}</select>
            </label>
            <label>
                <span>Tipo</span>
                <select id="backpack-type-filter">
                    <option value="all">PDF / Apunte / Guía / Proyecto</option>
                    <option value="PDF">PDF</option>
                    <option value="Apunte">Apunte</option>
                    <option value="Guia">Guía</option>
                    <option value="Informe">Informe</option>
                    <option value="Proyecto">Proyecto</option>
                    <option value="Tarea">Tarea</option>
                </select>
            </label>
            <label>
                <span>Ordenar</span>
                <select id="backpack-sort">
                    <option value="recent">Más reciente</option>
                    <option value="oldest">Más antiguo</option>
                    <option value="subject">Materia</option>
                    <option value="title">Título</option>
                </select>
            </label>
            <button class="btn-primary btn-small" type="button" onclick="addResourceUI()">+ Subir PDF</button>
        </div>
    `);
}

function bindBackpackToolbar() {
    const search = document.getElementById('backpack-search');
    const subject = document.getElementById('backpack-subject-filter');
    const type = document.getElementById('backpack-type-filter');
    const sort = document.getElementById('backpack-sort');

    if (subject) subject.value = backpackSubjectFilter;
    if (type) type.value = backpackTypeFilter;
    if (sort) sort.value = backpackSortMode;

    if (search && !search.dataset.bound) {
        search.dataset.bound = 'true';
        search.addEventListener('input', event => {
            backpackFilterText = event.target.value;
            renderBackpack(loadWorkspace());
        });
    }
    if (subject && !subject.dataset.bound) {
        subject.dataset.bound = 'true';
        subject.addEventListener('change', event => {
            backpackSubjectFilter = event.target.value;
            renderBackpack(loadWorkspace());
        });
    }
    if (type && !type.dataset.bound) {
        type.dataset.bound = 'true';
        type.addEventListener('change', event => {
            backpackTypeFilter = event.target.value;
            renderBackpack(loadWorkspace());
        });
    }
    if (sort && !sort.dataset.bound) {
        sort.dataset.bound = 'true';
        sort.addEventListener('change', event => {
            backpackSortMode = event.target.value;
            renderBackpack(loadWorkspace());
        });
    }
}

function getBackpackResourcesForView(workspace) {
    const query = normalizeTutorText(backpackFilterText);
    return [...workspace.resources]
        .filter(resource => {
            const haystack = normalizeTutorText(`${resource.title || ''} ${resource.subject || ''} ${resource.fileName || ''} ${resource.description || ''} ${resource.tag || ''}`);
            const type = resource.tag || resource.type || 'PDF';
            const matchesSearch = !query || haystack.includes(query);
            const matchesSubject = backpackSubjectFilter === 'all' || resource.subject === backpackSubjectFilter;
            const matchesType = backpackTypeFilter === 'all' || resource.type === backpackTypeFilter || type === backpackTypeFilter;
            return matchesSearch && matchesSubject && matchesType;
        })
        .sort((a, b) => {
            if (backpackSortMode === 'oldest') return new Date(a.uploadedAt || 0) - new Date(b.uploadedAt || 0);
            if (backpackSortMode === 'subject') return String(a.subject || '').localeCompare(String(b.subject || ''));
            if (backpackSortMode === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
            return new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0);
        });
}

function renderBackpack(workspace) {
    const section = document.getElementById('backpack');
    const container = document.querySelector('.backpack-container');
    if (!section || !container) return;

    const header = section.querySelector('.section-header');
    if (header) {
        header.innerHTML = `
            <div>
                <h1>Mochila Digital</h1>
                <p class="subtitle">Biblioteca digital conectada con tus materias y Tutor.</p>
            </div>
        `;
    }
    section.querySelector('.backpack-toolbar')?.remove();
    ensureBackpackToolbar(section, workspace);
    bindBackpackToolbar();

    const resources = getBackpackResourcesForView(workspace);
    container.innerHTML = workspace.resources.length ? (resources.length ? resources.map(resource => {
        const description = resource.description || resource.content || 'Sin descripción';
        const shortDescription = description.length > 120 ? `${description.slice(0, 120)}...` : description;
        const color = getAcademicColorValue(getResourceColor(workspace, resource));
        const status = getResourceStatus(resource);
        const uploadedAt = resource.uploadedAt || resource.createdAt || new Date().toISOString();
        return `
            <article class="resource-card library-resource-card" style="${getAcademicCardStyle(color)}">
                ${neonLinesHTML()}
                <div class="resource-top">
                    ${appIconHTML('file', 'resource-icon resource-pdf-icon pdf-icon material-icon')}
                    <div class="resource-info">
                        <h4>${escapeHTML(resource.title)}</h4>
                        <p class="resource-type">${escapeHTML(resource.subject || 'General')} - ${escapeHTML(resource.fileName || 'PDF')}</p>
                    </div>
                </div>
                <div class="resource-meta-row">
                    <span class="resource-subject-chip">${escapeHTML(resource.subject || 'General')}</span>
                    <span class="resource-status ${escapeHTML(status.className)}">${escapeHTML(status.label)}</span>
                </div>
                <p class="resource-description">${escapeHTML(shortDescription)}</p>
                <div class="resource-data">
                    <span>${escapeHTML(resource.tag || resource.type || 'PDF')}</span>
                    <span>Subido el: ${escapeHTML(formatResourceDate(uploadedAt))}</span>
                    <span>${escapeHTML(getRelativeResourceDate(uploadedAt))}</span>
                </div>
                <div class="resource-actions resource-actions-grid">
                    <button class="btn-secondary btn-small" data-resource-view="${escapeHTML(resource.id)}">Ver</button>
                    <button class="btn-secondary btn-small" data-resource-ai="${escapeHTML(resource.id)}">Preguntar a Tutor</button>
                    <button class="btn-secondary btn-small" data-resource-edit="${escapeHTML(resource.id)}">Editar</button>
                    <button class="btn-danger btn-small" data-resource-delete="${escapeHTML(resource.id)}">Eliminar</button>
                </div>
            </article>
        `;
    }).join('') : emptyStateHTML('No encontramos recursos con esos filtros.', 'Limpiar búsqueda', 'resetBackpackFilters()')) : emptyStateHTML('No tienes apuntes todavía 🎒', 'Subir primer PDF', 'addResourceUI()');

    container.querySelectorAll('[data-resource-view]').forEach(button => button.addEventListener('click', () => viewResource(button.dataset.resourceView)));
    container.querySelectorAll('[data-resource-ai]').forEach(button => button.addEventListener('click', () => askAIAboutResource(button.dataset.resourceAi)));
    container.querySelectorAll('[data-resource-edit]').forEach(button => button.addEventListener('click', () => openResourceForm(button.dataset.resourceEdit)));
    container.querySelectorAll('[data-resource-delete]').forEach(button => button.addEventListener('click', () => deleteResource(button.dataset.resourceDelete)));
}

function resetBackpackFilters() {
    backpackFilterText = '';
    backpackSubjectFilter = 'all';
    backpackTypeFilter = 'all';
    backpackSortMode = 'recent';
    renderBackpack(loadWorkspace());
}

function viewResource(resourceId) {
    const resource = loadWorkspace().resources.find(item => item.id === resourceId);
    if (!resource) return;

    if (resource.fileDataUrl) {
        openPdfResource(resource, 'Abriste un PDF desde Mochila Digital.');
        return;
    }

    showAIResult(`Vista del recurso: ${resource.title}`, `Materia: ${resource.subject || 'General'}\nArchivo: ${resource.fileName || 'PDF'}\nTipo: ${resource.tag || resource.type || 'PDF'}\n\nDescripción:\n${resource.description || resource.content || 'Sin descripción'}\n\nCuando conectes Google Drive o Supabase Storage, esta vista podra abrir el archivo real desde la nube.`);
}

function createPdfObjectUrl(dataUrl, fallbackMime = 'application/pdf') {
    const [header, data] = String(dataUrl || '').split(',');
    if (!header || !data) throw new Error('Invalid PDF data URL');

    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : fallbackMime;
    const binary = atob(data);
    const bytes = [];

    for (let index = 0; index < binary.length; index += 1024) {
        const slice = binary.slice(index, index + 1024);
        const numbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i += 1) {
            numbers[i] = slice.charCodeAt(i);
        }
        bytes.push(new Uint8Array(numbers));
    }

    return URL.createObjectURL(new Blob(bytes, { type: mime || fallbackMime }));
}

function openPdfResource(resource, recentText = 'Abriste un PDF desde Mochila Digital.') {
    if (!resource.fileDataUrl) {
        notify('Este recurso no tiene el archivo PDF guardado. Editalo y vuelve a subir el PDF.', 'error');
        return false;
    }

    let pdfUrl = '';
    try {
        pdfUrl = createPdfObjectUrl(resource.fileDataUrl, resource.fileMime || 'application/pdf');
    } catch (error) {
        notify('No se pudo preparar el PDF. Vuelve a subir el archivo.', 'error');
        return false;
    }

    const tab = window.open('', '_blank');
    if (tab) {
        tab.document.title = resource.fileName || resource.title || 'PDF';
        tab.document.body.innerHTML = '<p style="font-family: Arial, sans-serif; padding: 24px;">Abriendo PDF...</p>';
        tab.location.href = pdfUrl;
        markResourceAIUsed(resource.id, recentText);
        notify('PDF abierto en una nueva pestana.', 'success');
        return true;
    }

    const link = document.createElement('a');
    link.href = pdfUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.click();
    markResourceAIUsed(resource.id, recentText);
    notify('PDF abierto. Si no aparece, permite ventanas emergentes para esta página.', 'info');
    return true;
}

function askAIAboutResource(resourceId) {
    const resource = loadWorkspace().resources.find(item => item.id === resourceId);
    if (!resource) return;

    const updated = markResourceAIUsed(resourceId, `Preguntaste a Tutor sobre ${resource.title}.`) || resource;
    // Futuro: enviar metadata y contenido extraido del recurso a una IA real.
    setAIContextFromResource(updated);
    navigateTo('ai-assistant');
    appendTutorMessage('bot', `Vamos a estudiar tu recurso de ${updated.subject || 'General'}: ${updated.title}.\n\nTrabajaré con el título, la materia y la descripción guardada. Puedes pedirme un resumen, una explicacion sencilla, preguntas abiertas, verdadero/falso, flashcards o un cuestionario.`, 'Tutor');
    notify('Recurso abierto en Tutor.', 'success');
}

function practiceWithResource(resourceId) {
    const resource = loadWorkspace().resources.find(item => item.id === resourceId);
    if (!resource) return;

    const updated = markResourceAIUsed(resourceId, `Iniciaste práctica con ${resource.title}.`) || resource;
    setAIContextFromResource(updated);
    navigateTo('ai-assistant');
    appendTutorMessage('bot', `Vamos a practicar con tu recurso de ${updated.subject || 'General'}: ${updated.title}.\n\nElige que quieres generar:\n1. Resumen\n2. Preguntas abiertas\n3. Verdadero/falso\n4. Flashcards\n5. Cuestionario\n\nTambien puedes escribir tu propia duda sobre este material.`, 'Tutor');
    notify('Recurso listo para practicar con Tutor.', 'success');
}

function getDisplayStreak(workspace) {
    return currentUser?.email ? Math.max(1, Number(workspace.streak || 0)) : 0;
}

function getCurrentUserProfile() {
    const users = getUsers();
    const stored = currentUser?.email ? users[currentUser.email] || {} : {};
    return {
        name: currentUser?.name || stored.name || 'Estudiante AC',
        role: stored.role || currentUser?.role || 'Estudiante',
        career: stored.career || currentUser?.career || '',
        bio: stored.bio || currentUser?.bio || '',
        interests: stored.interests || currentUser?.interests || '',
        avatarStyle: stored.avatarStyle || currentUser?.avatarStyle || 'initials',
        avatarText: stored.avatarText || currentUser?.avatarText || '',
        createdAt: stored.createdAt || currentUser?.createdAt || '',
        goals: Array.isArray(stored.goals) ? stored.goals : []
    };
}

function saveCurrentUserProfile(profileUpdates) {
    if (!currentUser?.email) return;
    const users = getUsers();
    const previous = users[currentUser.email] || {};
    users[currentUser.email] = { ...previous, ...profileUpdates };
    saveUsers(users);
    currentUser = getPublicUser(currentUser.email, users[currentUser.email]);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
}

function getProfileInitials(name) {
    return String(name || 'AC')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0].toUpperCase())
        .join('') || 'AC';
}

function getProfileAvatarContent(profile) {
    const avatarValue = String(profile.avatarUrl || profile.avatarText || '').trim();
    const isImageUrl = /^(https?:\/\/|data:image\/)/i.test(avatarValue);

    if ((profile.avatarStyle === 'photo' || profile.avatarStyle === 'custom') && avatarValue && isImageUrl) {
        return `<img src="${escapeHTML(avatarValue)}" alt="Foto de perfil" loading="lazy">`;
    }
    if (profile.avatarStyle === 'custom' && avatarValue) return escapeHTML(avatarValue.slice(0, 4));
    if (profile.avatarStyle === 'rocket') return '🚀';
    if (profile.avatarStyle === 'book') return '📚';
    if (profile.avatarStyle === 'code') return '💻';
    if (profile.avatarStyle === 'star') return '⭐';
    return escapeHTML(getProfileInitials(profile.name));
}

function getProfileAchievements(workspace) {
    const completedTasks = workspace.tasks.filter(task => task.status === 'completed').length;
    const level = getLevel(workspace.xp);
    return [
        { name: 'Primera materia', icon: '📚', unlocked: workspace.subjects.length > 0 },
        { name: 'Primera racha', icon: '🔥', unlocked: getDisplayStreak(workspace) > 0 },
        { name: 'Uso de Tutor', icon: '🤖', unlocked: workspace.resources.some(resource => resource.usedAI) },
        { name: 'Primer PDF', icon: '📂', unlocked: workspace.resources.length > 0 },
        { name: 'Buen promedio', icon: '⭐', unlocked: getAverageGrade(workspace) >= 8 },
        { name: 'Tarea completada', icon: '✅', unlocked: completedTasks > 0 },
        { name: 'Nivel 5', icon: '🏆', unlocked: level >= 5 }
    ];
}

function openProfileForm() {
    const profile = getCurrentUserProfile();
    openQuickForm({
        title: 'Editar perfil',
        submitLabel: 'Guardar perfil',
        fields: [
            { name: 'name', label: 'Nombre', value: profile.name, placeholder: 'Tu nombre' },
            { name: 'career', label: 'Carrera o area de estudio', value: profile.career, placeholder: 'Ej: Informatica' },
            { name: 'bio', label: 'Descripción personal', type: 'textarea', rows: 3, value: profile.bio, placeholder: 'Ej: Construyendo mi camino de aprendizaje.' },
            { name: 'interests', label: 'Intereses', value: profile.interests, placeholder: 'Ej: IA educativa, programación, robótica' },
            { name: 'avatarStyle', label: 'Avatar', type: 'select', options: [
                { value: 'initials', label: 'Iniciales' },
                { value: 'rocket', label: 'Cohete' },
                { value: 'book', label: 'Libros' },
                { value: 'code', label: 'Programación' },
                { value: 'star', label: 'Estrella' },
                { value: 'photo', label: 'URL de foto' },
                { value: 'custom', label: 'Texto o emoji propio' }
            ], value: profile.avatarStyle },
            { name: 'avatarText', label: 'Foto o avatar personalizado', value: profile.avatarText, required: false, placeholder: 'Ej: AC, 🚀 o https://...' }
        ],
        onSubmit: values => {
            saveCurrentUserProfile({
                name: values.name.trim(),
                career: values.career.trim(),
                bio: values.bio.trim(),
                interests: values.interests.trim(),
                avatarStyle: values.avatarStyle || 'initials',
                avatarText: values.avatarText.trim()
            });
            refreshWorkspaceUI();
            notify('Perfil actualizado.', 'success');
        }
    });
}

function openAvatarForm() {
    openProfileForm();
}

function openGoalForm() {
    openQuickForm({
        title: 'Agregar meta',
        submitLabel: 'Guardar meta',
        fields: [
            { name: 'goal', label: 'Nueva meta personal', placeholder: 'Ej: Estudiar 30 minutos diarios' }
        ],
        onSubmit: values => {
            const profile = getCurrentUserProfile();
            const text = values.goal.trim();
            if (!text) return;
            saveCurrentUserProfile({
                goals: [{ id: createId(), text, done: false }, ...profile.goals].slice(0, 6)
            });
            refreshWorkspaceUI();
            notify('Meta agregada.', 'success');
        }
    });
}

function toggleProfileGoal(goalId) {
    const profile = getCurrentUserProfile();
    saveCurrentUserProfile({
        goals: profile.goals.map(goal => goal.id === goalId ? { ...goal, done: !goal.done } : goal)
    });
    renderProfile(loadWorkspace());
}

function renderProfile(workspace) {
    const profileLayout = document.querySelector('#profile .profile-layout');
    if (!profileLayout) return;

    const profile = getCurrentUserProfile();
    const name = profile.name || 'Estudiante AC';
    const level = getLevel(workspace.xp);
    const average = getAverageGrade(workspace);
    const streak = getDisplayStreak(workspace);
    const completedTasks = workspace.tasks.filter(task => task.status === 'completed').length;
    const xp = workspace.xp || 0;
    const goals = profile.goals.length ? profile.goals : [
        { id: 'default-weekly', text: 'Completar tareas semanales', done: completedTasks > 0 },
        { id: 'default-average', text: 'Mejorar promedio', done: average >= 8 },
        { id: 'default-streak', text: 'Mantener racha de estudio', done: streak > 1 }
    ];
    const recentItems = (workspace.recent || []).slice(0, 5);
    const interests = normalizeInterests(profile.interests).slice(0, 4);

    profileLayout.innerHTML = `
        <section class="profile-hero premium-profile-card">
            <div class="profile-avatar-zone">
                <div class="profile-avatar profile-avatar-premium">${getProfileAvatarContent(profile)}</div>
                <button class="btn-secondary btn-small" type="button" onclick="openAvatarForm()">Cambiar avatar</button>
            </div>
            <div class="profile-details profile-details-premium">
                <span class="profile-role">${escapeHTML(profile.role || 'Estudiante')}</span>
                <h2 id="profile-name">${escapeHTML(name)}</h2>
                <p class="profile-career">${escapeHTML(profile.career || 'Personaliza tu carrera o area de estudio')}</p>
                <p>${escapeHTML(profile.bio || 'Personaliza tu perfil para empezar.')}</p>
                <div class="profile-tags">
                    ${interests.map(tag => `<span>${escapeHTML(tag)}</span>`).join('')}
                </div>
                <button class="btn-primary btn-small" type="button" onclick="openProfileForm()">Editar perfil</button>
            </div>
            <div class="profile-academic-box" aria-label="Resumen académico">
                <h3 class="profile-academic-title">Resumen académico</h3>
                <div class="profile-academic-list">
                    <div class="profile-academic-row">
                        ${appIconHTML('trend', 'profile-academic-icon')}
                        <span class="profile-academic-label">Nivel actual</span>
                        <strong class="profile-academic-value">${escapeHTML(level)}</strong>
                    </div>
                    <div class="profile-academic-row">
                        ${appIconHTML('chart', 'profile-academic-icon')}
                        <span class="profile-academic-label">XP acumulado</span>
                        <strong class="profile-academic-value">${escapeHTML(xp)}</strong>
                    </div>
                    <div class="profile-academic-row">
                        ${appIconHTML('calendar', 'profile-academic-icon')}
                        <span class="profile-academic-label">Racha</span>
                        <strong class="profile-academic-value">${escapeHTML(streak)} ${streak === 1 ? 'día' : 'días'}</strong>
                    </div>
                </div>
            </div>
        </section>

        <section class="profile-goals-card premium-profile-card">
            <div class="profile-section-header">
                <div>
                    <span class="profile-section-kicker">Mis metas</span>
                    <h3>Objetivos personales</h3>
                </div>
                <button class="btn-secondary btn-small" type="button" onclick="openGoalForm()">+ Meta</button>
            </div>
            <div class="profile-goals-list">
                ${goals.map(goal => `
                    <button class="profile-goal ${goal.done ? 'done' : ''}" type="button" onclick="${String(goal.id).startsWith('default-') ? '' : `toggleProfileGoal('${escapeHTML(goal.id)}')`}">
                        <span>${goal.done ? 'OK' : '+'}</span>
                        <strong>${escapeHTML(goal.text)}</strong>
                    </button>
                `).join('')}
            </div>
        </section>

        <section class="profile-activity-card premium-profile-card">
            <span class="profile-section-kicker">Actividad reciente</span>
            <h3>Historial del estudiante</h3>
            ${recentItems.length ? `
                <ul class="profile-activity-list">
                    ${recentItems.map(item => `<li><span>${escapeHTML(item.time)}</span><strong>${escapeHTML(item.text)}</strong></li>`).join('')}
                </ul>
            ` : `
                <div class="profile-empty-note">
                    <strong>Tu actividad aparecerá aquí cuando empieces.</strong>
                    <span>Crea materias, completa tareas, usa Tutor o sube PDFs.</span>
                </div>
            `}
        </section>
    `;
}

function refreshWorkspaceUI() {
    const workspace = loadWorkspace();
    renderDashboard(workspace);
    renderSubjects(workspace);
    renderTasks(workspace);
    renderCalendarSection(workspace);
    renderGrades(workspace);
    renderAttendance(workspace);
    renderProgress(workspace);
    renderBackpack(workspace);
    renderProfile(workspace);
    updateGradeSubjectOptions(workspace);
}

function initStudyPet() {
    const pet = document.getElementById('study-pet');
    if (!pet || pet.dataset.ready === 'true') return;

    pet.dataset.ready = 'true';
    let dragging = false;
    let moved = false;
    let offsetX = 0;
    let offsetY = 0;
    let startX = 0;
    let startY = 0;
    let eyeFrame = 0;
    let lastPointerEvent = null;
    const canTrackEyes = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const updateEyeDirection = event => {
        if (!document.body.classList.contains('landing-active')) return;
        lastPointerEvent = event;
        if (eyeFrame) return;

        eyeFrame = window.requestAnimationFrame(() => {
            eyeFrame = 0;
            const robot = pet.querySelector('.pet-robot');
            if (!robot || !lastPointerEvent) return;

            const rect = robot.getBoundingClientRect();
            const centerX = rect.left + rect.width * 0.5;
            const centerY = rect.top + rect.height * 0.34;
            const deltaX = lastPointerEvent.clientX - centerX;
            const deltaY = lastPointerEvent.clientY - centerY;
            const distance = Math.max(Math.hypot(deltaX, deltaY), 1);
            const maxMove = window.innerWidth < 720 ? 3 : 4;

            pet.style.setProperty('--pet-eye-x', `${(deltaX / distance) * maxMove}px`);
            pet.style.setProperty('--pet-eye-y', `${(deltaY / distance) * maxMove}px`);
        });
    };

    const resetEyeDirection = () => {
        lastPointerEvent = null;
        pet.style.setProperty('--pet-eye-x', '0px');
        pet.style.setProperty('--pet-eye-y', '0px');
    };

    if (canTrackEyes) {
        document.addEventListener('pointermove', updateEyeDirection, { passive: true });
        document.addEventListener('pointerleave', resetEyeDirection, { passive: true });
    }

    pet.addEventListener('pointerdown', event => {
        if (event.button !== undefined && event.button !== 0) return;
        dragging = true;
        moved = false;
        pet.classList.add('dragging');
        pet.setPointerCapture(event.pointerId);

        const rect = pet.getBoundingClientRect();
        startX = event.clientX;
        startY = event.clientY;
        offsetX = event.clientX - rect.left;
        offsetY = event.clientY - rect.top;
    });

    pet.addEventListener('pointermove', event => {
        if (!dragging) return;
        const distance = Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY);
        if (distance > 6) moved = true;

        const width = pet.offsetWidth;
        const height = pet.offsetHeight;
        const left = clamp(event.clientX - offsetX, 8, window.innerWidth - width - 8);
        const top = clamp(event.clientY - offsetY, 8, window.innerHeight - height - 8);

        pet.style.left = `${left}px`;
        pet.style.top = `${top}px`;
        pet.style.right = 'auto';
        pet.style.bottom = 'auto';
    });

    const stopDrag = event => {
        if (!dragging) return;
        dragging = false;
        pet.classList.remove('dragging');
        if (pet.hasPointerCapture(event.pointerId)) pet.releasePointerCapture(event.pointerId);
    };

    pet.addEventListener('pointerup', stopDrag);
    pet.addEventListener('pointercancel', stopDrag);

    pet.addEventListener('click', () => {
        if (moved) return;
        showRegister();
    });

    pet.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            showRegister();
        }
    });
}

// ============================================
// SUPABASE AUTH + DATOS REALES
// ============================================

const SUPABASE_URL = 'https://pskbdeqaajprfhrjortm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_M3ABI_7yU49LkGO3Op-CLA_qsCDP7Lz';
const RESET_REDIRECT_URL = 'https://chitoadrian.github.io/AC-Edunity-/';

let supabaseClient = null;
let workspaceState = null;
let profileState = null;
let authListenerReady = false;
let loginInProgress = false;
let logoutInProgress = false;
const APP_INSIDE_SESSION_KEY = 'ac_inside_student_app';
const APP_CURRENT_VIEW_SESSION_KEY = 'ac_current_student_view';
const LEGACY_APP_INSIDE_SESSION_KEY = 'ac_inside_app';
const LEGACY_APP_CURRENT_VIEW_SESSION_KEY = 'ac_current_view';
const VALID_APP_VIEWS = new Set([
    'dashboard',
    'subjects',
    'tasks',
    'calendar',
    'grades',
    'attendance',
    'ai-assistant',
    'progress',
    'backpack',
    'profile',
    'settings'
]);

function normalizeAppView(view) {
    if (view === 'tutor') return 'ai-assistant';
    return VALID_APP_VIEWS.has(view) ? view : 'dashboard';
}

function rememberAppView(view) {
    const normalizedView = normalizeAppView(view);
    sessionStorage.setItem(APP_INSIDE_SESSION_KEY, 'true');
    sessionStorage.setItem(APP_CURRENT_VIEW_SESSION_KEY, normalizedView);
}

function clearAppViewSession() {
    sessionStorage.removeItem(APP_INSIDE_SESSION_KEY);
    sessionStorage.removeItem(APP_CURRENT_VIEW_SESSION_KEY);
    sessionStorage.removeItem(LEGACY_APP_INSIDE_SESSION_KEY);
    sessionStorage.removeItem(LEGACY_APP_CURRENT_VIEW_SESSION_KEY);
}

function shouldRestoreAppFromSession() {
    return sessionStorage.getItem(APP_INSIDE_SESSION_KEY) === 'true'
        || sessionStorage.getItem(LEGACY_APP_INSIDE_SESSION_KEY) === 'true';
}

function getStoredAppView() {
    return normalizeAppView(
        sessionStorage.getItem(APP_CURRENT_VIEW_SESSION_KEY)
        || sessionStorage.getItem(LEGACY_APP_CURRENT_VIEW_SESSION_KEY)
        || 'dashboard'
    );
}

function logSupabaseError(context, error) {
    if (!error) return;
    console.error("[SUPABASE ERROR]", error);
    console.error("ERROR SUPABASE:", error);
    console.error("Error exacto:", error);
    console.error(`[Supabase][${context}]`, {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        status: error.status,
        full: error
    });
}

function getSupabaseClient() {
    if (supabaseClient) return supabaseClient;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        throw new Error('Supabase no pudo cargarse en el navegador.');
    }

    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    });

    console.log('[Supabase] Cliente iniciado');
    console.log('[Supabase] Cliente iniciado', {
        url: SUPABASE_URL,
        authReady: true
    });

    return supabaseClient;
}

function closePasswordResetModal() {
    document.getElementById('password-reset-modal')?.remove();
}

function closePasswordUpdateModal() {
    document.getElementById('password-update-modal')?.remove();
}

function openPasswordResetModal(prefillEmail = '') {
    const existingModal = document.querySelector('.quick-modal');
    if (existingModal) existingModal.remove();

    const loginEmail = document.getElementById('login-email')?.value?.trim() || '';
    const emailValue = prefillEmail || loginEmail;
    const modal = document.createElement('div');
    modal.id = 'password-reset-modal';
    modal.className = 'quick-modal password-modal';
    modal.innerHTML = `
        <div class="quick-modal-card password-modal-card" role="dialog" aria-modal="true" aria-label="Restablecer contraseña">
            <button class="quick-modal-close" type="button" aria-label="Cerrar">x</button>
            <h3>Restablecer contraseña</h3>
            <p class="password-modal-text">Ingresa tu correo y te enviaremos un enlace para cambiar tu contraseña.</p>
            <form class="quick-modal-form password-reset-form">
                <label>
                    <span>Correo electrónico</span>
                    <input type="email" name="email" placeholder="tu@email.com" value="${escapeHTML(emailValue)}" required>
                </label>
                <div class="quick-modal-actions password-modal-actions">
                    <button class="btn-secondary btn-small" type="button" data-cancel>Cancelar</button>
                    <button class="btn-primary btn-small" type="submit">Enviar enlace</button>
                </div>
            </form>
        </div>
    `;

    modal.addEventListener('click', event => {
        if (event.target === modal || event.target.classList.contains('quick-modal-close') || event.target.matches('[data-cancel]')) {
            closePasswordResetModal();
        }
    });

    modal.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const email = new FormData(event.currentTarget).get('email');
        handlePasswordReset(email);
    });

    document.body.appendChild(modal);
    modal.querySelector('input')?.focus();
}

function openPasswordUpdateModal() {
    const existingModal = document.querySelector('.quick-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'password-update-modal';
    modal.className = 'quick-modal password-modal';
    modal.innerHTML = `
        <div class="quick-modal-card password-modal-card" role="dialog" aria-modal="true" aria-label="Crear nueva contraseña">
            <button class="quick-modal-close" type="button" aria-label="Cerrar">x</button>
            <h3>Crear nueva contraseña</h3>
            <p class="password-modal-text">Escribe tu nueva contraseña para volver a entrar a AC Edunity.</p>
            <form class="quick-modal-form password-update-form">
                <label>
                    <span>Nueva contraseña</span>
                    <input type="password" name="newPassword" placeholder="Minimo 6 caracteres" required>
                </label>
                <label>
                    <span>Confirmar contraseña</span>
                    <input type="password" name="confirmPassword" placeholder="Repite la contraseña" required>
                </label>
                <div class="quick-modal-actions password-modal-actions">
                    <button class="btn-secondary btn-small" type="button" data-cancel>Cancelar</button>
                    <button class="btn-primary btn-small" type="submit">Actualizar contraseña</button>
                </div>
            </form>
        </div>
    `;

    modal.addEventListener('click', event => {
        if (event.target === modal || event.target.classList.contains('quick-modal-close') || event.target.matches('[data-cancel]')) {
            closePasswordUpdateModal();
        }
    });

    modal.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        handleUpdatePassword(formData.get('newPassword'), formData.get('confirmPassword'));
    });

    document.body.appendChild(modal);
    modal.querySelector('input')?.focus();
}

async function handlePasswordReset(email) {
    const cleanEmail = String(email || '').trim();
    if (!cleanEmail) {
        showToast("Ingresa tu correo.", "error");
        return;
    }

    try {
        const sb = getSupabaseClient();
        console.log("[PASSWORD RESET] Enviando correo a:", cleanEmail);

        const { error } = await sb.auth.resetPasswordForEmail(cleanEmail, {
            redirectTo: RESET_REDIRECT_URL
        });

        if (error) {
            console.error("[PASSWORD RESET ERROR]", error);
            logSupabaseError('auth resetPasswordForEmail', error);
            showToast("No se pudo enviar el correo. Revisa el email.", "error");
            return;
        }

        showToast("Te enviamos un enlace para restablecer tu contraseña. Revisa tu correo o spam.", "success");
        closePasswordResetModal();
    } catch (error) {
        console.error("[PASSWORD RESET ERROR]", error);
        showToast("No se pudo enviar el correo. Revisa el email.", "error");
    }
}

async function handleUpdatePassword(newPassword, confirmPassword) {
    if (!newPassword || String(newPassword).length < 6) {
        showToast("La contraseña debe tener mínimo 6 caracteres.", "error");
        return;
    }

    if (newPassword !== confirmPassword) {
        showToast("Las contraseñas no coinciden.", "error");
        return;
    }

    try {
        const sb = getSupabaseClient();
        console.log("[PASSWORD UPDATE] Actualizando contraseña");

        const { error } = await sb.auth.updateUser({
            password: newPassword
        });

        if (error) {
            console.error("[PASSWORD UPDATE ERROR]", error);
            logSupabaseError('auth updateUser password', error);
            showToast("No se pudo actualizar la contraseña.", "error");
            return;
        }

        showToast("Contraseña actualizada correctamente. Ya puedes iniciar sesión.", "success");
        closePasswordUpdateModal();
        await sb.auth.signOut();
        currentUser = null;
        profileState = null;
        workspaceState = mergeWorkspaceState();
        clearAppViewSession();
        showLanding();
        window.history.replaceState({}, document.title, window.location.pathname);
    } catch (error) {
        console.error("[PASSWORD UPDATE ERROR]", error);
        showToast("No se pudo actualizar la contraseña.", "error");
    }
}

function isPasswordRecoveryUrl() {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    return hash.includes('type=recovery') || search.includes('type=recovery');
}

function getWorkspaceExtrasKey() {
    return `acEdunityExtras:${currentUser?.id || currentUser?.email || 'guest'}`;
}

function getWorkspaceClone(data) {
    if (typeof structuredClone === 'function') return structuredClone(data);
    return JSON.parse(JSON.stringify(data));
}

function getEmptyWorkspace() {
    return {
        subjects: [],
        tasks: [],
        events: [],
        grades: [],
        attendance: [],
        resources: [],
        xp: 0,
        streak: 0,
        recent: [],
        taskMeta: {}
    };
}

function loadWorkspaceExtras() {
    try {
        const raw = localStorage.getItem(getWorkspaceExtrasKey());
        if (!raw) return {
            events: [],
            grades: [],
            attendance: [],
            resources: [],
            recent: [],
            taskMeta: {},
            profileExtras: {},
            tutorHistory: []
        };
        const parsed = JSON.parse(raw);
        return {
            events: Array.isArray(parsed.events) ? parsed.events : [],
            grades: Array.isArray(parsed.grades) ? parsed.grades : [],
            attendance: Array.isArray(parsed.attendance) ? parsed.attendance : [],
            resources: Array.isArray(parsed.resources) ? parsed.resources : [],
            recent: Array.isArray(parsed.recent) ? parsed.recent : [],
            taskMeta: parsed.taskMeta && typeof parsed.taskMeta === 'object' ? parsed.taskMeta : {},
            profileExtras: parsed.profileExtras && typeof parsed.profileExtras === 'object' ? parsed.profileExtras : {},
            tutorHistory: Array.isArray(parsed.tutorHistory) ? parsed.tutorHistory : []
        };
    } catch (error) {
        localStorage.removeItem(getWorkspaceExtrasKey());
        return {
            events: [],
            grades: [],
            attendance: [],
            resources: [],
            recent: [],
            taskMeta: {},
            profileExtras: {},
            tutorHistory: []
        };
    }
}

function saveWorkspaceExtras(extras) {
    localStorage.setItem(getWorkspaceExtrasKey(), JSON.stringify(extras));
}

function extractTaskMeta(tasks = []) {
    return tasks.reduce((acc, task) => {
        acc[task.id] = {
            emailReminder: !!task.emailReminder,
            email: task.email || ''
        };
        return acc;
    }, {});
}

function getOptionValue(option) {
    if (typeof option === 'string') return option;
    if (option && typeof option === 'object') {
        return option.value ?? option.name ?? option.color ?? option.label ?? '';
    }
    return option == null ? '' : String(option);
}

function getOptionLabel(option) {
    if (typeof option === 'string') return option;
    if (option && typeof option === 'object') {
        return option.label ?? option.name ?? option.value ?? option.color ?? '';
    }
    return option == null ? '' : String(option);
}

function normalizeSubjectColor(color) {
    if (!color) return 'Morado';
    const rawColor = getOptionValue(color);
    const normalizedColor = String(rawColor || '').trim().toLowerCase();
    const match = subjectColorOptions.find(option => {
        const optionValue = String(getOptionValue(option)).trim().toLowerCase();
        const optionLabel = String(getOptionLabel(option)).trim().toLowerCase();
        return optionValue === normalizedColor || optionLabel === normalizedColor;
    });
    return getOptionValue(match) || rawColor || 'Morado';
}

function getAcademicColorValue(color) {
    const rawColor = getOptionValue(color);
    if (typeof rawColor === 'string' && /^#[0-9a-f]{3,8}$/i.test(rawColor.trim())) {
        return rawColor.trim();
    }
    const normalizedColor = normalizeSubjectColor(color);
    return subjectColorMap[normalizedColor] || subjectColorMap[rawColor] || '#38bdf8';
}

function getAcademicCardStyle(color) {
    const safeColor = getAcademicColorValue(color);
    return `--subject-color:${safeColor};--resource-color:${safeColor};--subject-color-soft:color-mix(in srgb, ${safeColor} 22%, transparent);--subject-color-glow:color-mix(in srgb, ${safeColor} 56%, transparent);`;
}

function neonLinesHTML() {
    return `
        <div class="neon-border-lines" aria-hidden="true">
            <span class="neon-line neon-top"></span>
            <span class="neon-line neon-right"></span>
            <span class="neon-line neon-bottom"></span>
            <span class="neon-line neon-left"></span>
        </div>
    `;
}

function normalizeTaskPriority(priority) {
    const value = String(priority || 'media').toLowerCase();
    if (['alta', 'high'].includes(value)) return 'alta';
    if (['baja', 'low'].includes(value)) return 'baja';
    if (['normal'].includes(value)) return 'normal';
    return 'media';
}

function normalizeTaskStatus(status) {
    return String(status || 'pending').toLowerCase() === 'completed' ? 'completed' : 'pending';
}

function mergeWorkspaceState(remoteState = {}) {
    const extras = loadWorkspaceExtras();
    const taskMeta = extras.taskMeta || {};
    const tasks = (remoteState.tasks || []).map(task => ({
        ...task,
        emailReminder: !!taskMeta[task.id]?.emailReminder,
        email: taskMeta[task.id]?.email || currentUser?.email || ''
    }));

    workspaceState = {
        ...getEmptyWorkspace(),
        ...extras,
        ...remoteState,
        subjects: remoteState.subjects || [],
        tasks,
        xp: Number(remoteState.xp || 0),
        streak: Number(remoteState.streak || 0),
        taskMeta
    };

    return workspaceState;
}

function loadWorkspace() {
    if (!workspaceState) {
        workspaceState = mergeWorkspaceState();
    }
    return getWorkspaceClone(workspaceState);
}

function saveWorkspace(workspace) {
    const current = workspaceState || getEmptyWorkspace();
    const merged = {
        ...current,
        ...workspace,
        subjects: Array.isArray(workspace.subjects) ? workspace.subjects : current.subjects,
        tasks: Array.isArray(workspace.tasks) ? workspace.tasks : current.tasks
    };

    const extras = loadWorkspaceExtras();
    const nextExtras = {
        ...extras,
        events: merged.events || [],
        grades: merged.grades || [],
        attendance: merged.attendance || [],
        resources: merged.resources || [],
        recent: merged.recent || [],
        taskMeta: extractTaskMeta(merged.tasks || []),
        profileExtras: extras.profileExtras || {},
        tutorHistory: extras.tutorHistory || []
    };

    saveWorkspaceExtras(nextExtras);
    workspaceState = mergeWorkspaceState({
        subjects: merged.subjects || [],
        tasks: (merged.tasks || []).map(task => ({
            ...task,
            emailReminder: !!nextExtras.taskMeta[task.id]?.emailReminder,
            email: nextExtras.taskMeta[task.id]?.email || task.email || ''
        })),
        xp: profileState?.xp || 0,
        streak: profileState?.streak || 0
    });
}

function getPublicUserFromAuth(user, profile = null) {
    const fullName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Estudiante';
    return {
        id: user.id,
        email: user.email,
        name: fullName,
        role: profile?.role || 'Estudiante',
        createdAt: profile?.created_at || user.created_at || ''
    };
}

function normalizeInterests(value = '') {
    if (Array.isArray(value)) {
        return value
            .filter(Boolean)
            .map(item => String(item).trim())
            .filter(Boolean);
    }

    if (typeof value === 'string') {
        return value
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
    }

    return [];
}

function profileInterestsToString(value = '') {
    if (Array.isArray(value) || typeof value === 'string') return normalizeInterests(value).join(', ');
    if (value && typeof value === 'object') return normalizeInterests(Object.values(value)).join(', ');
    return String(value || '');
}

async function ensureProfileRow(user, fallbackName = '') {
    const sb = getSupabaseClient();
    const { data: existing, error: selectError } = await sb
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    if (selectError) {
        logSupabaseError('profiles select own', selectError);
        throw selectError;
    }

    if (existing) {
        console.log('[Supabase] Perfil ya existente para usuario actual', {
            userId: user.id,
            profile: existing
        });
        if ((!existing.full_name || !existing.role) && (fallbackName || user.email)) {
            const patch = {
                full_name: existing.full_name || fallbackName || user.email.split('@')[0],
                role: existing.role || 'Estudiante'
            };
            const { data: updated, error: updateError } = await sb
                .from('profiles')
                .update(patch)
                .eq('id', user.id)
                .select()
                .single();

            if (updateError) {
                logSupabaseError('profiles update own', updateError);
                throw updateError;
            }
            console.log('[Supabase] Perfil actualizado', updated);
            return updated;
        }
        return existing;
    }

    const payload = {
        id: user.id,
        full_name: fallbackName || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Estudiante',
        role: 'Estudiante',
        xp: 0,
        streak: 0,
        level: 1,
        study_area: '',
        bio: '',
        interests: [],
        avatar_type: 'initials',
        avatar_url: ''
    };

    const { data: created, error: insertError } = await sb
        .from('profiles')
        .insert(payload)
        .select()
        .single();

    if (insertError) {
        logSupabaseError('profiles insert own', insertError);
        throw insertError;
    }
    console.log('[Supabase] Perfil creado en profiles', created);
    return created;
}

async function syncWorkspaceFromSupabase() {
    if (!currentUser?.id) {
        profileState = null;
        workspaceState = mergeWorkspaceState();
        return workspaceState;
    }

    const sb = getSupabaseClient();
    const [profileRes, subjectsRes, tasksRes, eventsRes, attendanceRes, resourcesRes, gradesRes] = await Promise.all([
        sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle(),
        sb.from('subjects').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: true }),
        sb.from('tasks').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }),
        sb.from('events').select('*').eq('user_id', currentUser.id).order('event_date', { ascending: true }),
        sb.from('attendance').select('*').eq('user_id', currentUser.id).order('date', { ascending: false }),
        sb.from('resources').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }),
        sb.from('grades').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false })
    ]);

    if (profileRes.error) {
        logSupabaseError('profiles sync select', profileRes.error);
        throw profileRes.error;
    }
    if (subjectsRes.error) {
        logSupabaseError('subjects sync select', subjectsRes.error);
        throw subjectsRes.error;
    }
    if (tasksRes.error) {
        logSupabaseError('tasks sync select', tasksRes.error);
        throw tasksRes.error;
    }
    if (eventsRes.error) {
        logSupabaseError('events sync select', eventsRes.error);
        throw eventsRes.error;
    }
    if (attendanceRes.error) {
        logSupabaseError('attendance sync select', attendanceRes.error);
        throw attendanceRes.error;
    }
    if (resourcesRes.error) {
        logSupabaseError('resources sync select', resourcesRes.error);
        throw resourcesRes.error;
    }
    if (gradesRes.error) {
        logSupabaseError('grades sync select', gradesRes.error);
        throw gradesRes.error;
    }

    profileState = profileRes.data || {
        id: currentUser.id,
        full_name: currentUser.name,
        role: currentUser.role || 'Estudiante',
        xp: 0,
        streak: 0,
        level: 1,
        study_area: '',
        bio: '',
        interests: [],
        avatar_type: 'initials',
        avatar_url: '',
        created_at: currentUser.createdAt || ''
    };

    currentUser = {
        ...currentUser,
        name: profileState.full_name || currentUser.name,
        role: profileState.role || 'Estudiante',
        createdAt: profileState.created_at || currentUser.createdAt || ''
    };
    localStorage.setItem('currentUser', JSON.stringify(currentUser));

    const subjects = (subjectsRes.data || []).map(subject => ({
        id: subject.id,
        name: subject.name,
        icon: subject.icon || '',
        color: normalizeSubjectColor(subject.color),
        createdAt: subject.created_at || ''
    }));

    const subjectMap = new Map(subjects.map(subject => [subject.id, subject.name]));
    const tasks = (tasksRes.data || []).map(task => ({
        id: task.id,
        subjectId: task.subject_id || '',
        subject: subjectMap.get(task.subject_id) || '',
        title: task.title,
        description: task.description || '',
        due: task.due_date || '',
        priority: normalizeTaskPriority(task.priority),
        status: normalizeTaskStatus(task.status),
        createdAt: task.created_at || ''
    }));

    const events = (eventsRes.data || []).map(event => ({
        id: event.id,
        subjectId: event.subject_id || '',
        subject: subjectMap.get(event.subject_id) || '',
        title: event.title || '',
        type: event.type || 'evento',
        date: event.event_date || '',
        day: event.event_date || '',
        time: String(event.event_time || '').slice(0, 5),
        description: event.description || '',
        createdAt: event.created_at || ''
    }));

    const attendance = (attendanceRes.data || []).map(record => ({
        id: record.id,
        subjectId: record.subject_id || '',
        subject: subjectMap.get(record.subject_id) || 'General',
        date: record.date || '',
        status: record.status || 'Asisti',
        createdAt: record.created_at || ''
    }));

    const resources = (resourcesRes.data || []).map(resource => ({
        id: resource.id,
        subjectId: resource.subject_id || '',
        subject: subjectMap.get(resource.subject_id) || 'General',
        title: resource.title || '',
        fileName: resource.file_name || 'PDF',
        fileDataUrl: resource.file_url || '',
        fileUrl: resource.file_url || '',
        fileMime: 'application/pdf',
        description: resource.description || '',
        content: resource.description || '',
        type: 'PDF',
        tag: resource.tag || 'Apunte',
        uploadedAt: resource.created_at || new Date().toISOString(),
        usedAI: Boolean(resource.used_ai || resource.usedAI)
    }));

    const gradeRows = gradesRes.data || [];
    const gradeIds = gradeRows.map(grade => grade.id).filter(Boolean);
    let gradeItemsRows = [];
    if (gradeIds.length) {
        const gradeItemsRes = await sb
            .from('grade_items')
            .select('*')
            .in('grade_id', gradeIds)
            .order('item_date', { ascending: true });

        if (gradeItemsRes.error) {
            logSupabaseError('grade_items sync select', gradeItemsRes.error);
            throw gradeItemsRes.error;
        }
        gradeItemsRows = gradeItemsRes.data || [];
    }

    const gradeItemsByGrade = gradeItemsRows.reduce((acc, item) => {
        if (!acc[item.grade_id]) acc[item.grade_id] = [];
        acc[item.grade_id].push({
            id: item.id,
            activity: item.activity || '',
            date: item.item_date || '',
            value: Number(item.value || 0)
        });
        return acc;
    }, {});

    const grades = gradeRows.map(grade => {
        const items = gradeItemsByGrade[grade.id] || [];
        return {
            id: grade.id,
            subjectId: grade.subject_id || '',
            subject: subjectMap.get(grade.subject_id) || 'General',
            period: grade.period || 'p1',
            category: grade.category || 'partial1',
            evaluation: grade.evaluation || 'Calificación',
            value: Number(grade.final_value || 0),
            finalValue: Number(grade.final_value || 0),
            date: getFirstGradeItemDate(items),
            observation: grade.observation || '',
            items,
            createdAt: grade.created_at || ''
        };
    });

    return mergeWorkspaceState({
        subjects,
        tasks,
        events,
        attendance,
        resources,
        grades,
        xp: Number(profileState.xp || 0),
        streak: Number(profileState.streak || 0)
    });
}

async function bootstrapAuthenticatedApp(user, fallbackName = '') {
    loadInterfaceSoundPreferenceFromUser(user);
    const profile = await ensureProfileRow(user, fallbackName);
    currentUser = getPublicUserFromAuth(user, profile);
    console.log('[Supabase] Usuario actual autenticado', currentUser);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    await syncWorkspaceFromSupabase();
    updateDashboardGreeting();
}

async function updateProfileProgress(deltaXp, { bumpStreak = false } = {}) {
    if (!currentUser?.id || !profileState) return;

    const nextXp = Math.max(0, Number(profileState.xp || 0) + Number(deltaXp || 0));
    const nextStreak = bumpStreak ? Math.max(1, Number(profileState.streak || 0)) : Number(profileState.streak || 0);
    const nextLevel = getLevel(nextXp);

    profileState = {
        ...profileState,
        xp: nextXp,
        streak: nextStreak,
        level: nextLevel
    };

    if (workspaceState) {
        workspaceState.xp = nextXp;
        workspaceState.streak = nextStreak;
    }

    const { error } = await getSupabaseClient()
        .from('profiles')
        .update({ xp: nextXp, streak: nextStreak, level: nextLevel })
        .eq('id', currentUser.id);

    if (error) throw error;
}

function pushRecentMessage(text) {
    const extras = loadWorkspaceExtras();
    extras.recent = [
        { text, time: 'Ahora' },
        ...(extras.recent || [])
    ].slice(0, 6);
    saveWorkspaceExtras(extras);

    if (workspaceState) {
        workspaceState.recent = extras.recent;
    }
}

function getCurrentUserProfile() {
    const extras = loadWorkspaceExtras().profileExtras || {};
    const safeName = currentUser?.name || profileState?.full_name || 'Estudiante';
    const supabaseInterests = profileInterestsToString(profileState?.interests);
    const fallbackAvatarStyle = extras.avatarStyle || 'initials';
    const avatarType = profileState?.avatar_type || fallbackAvatarStyle;
    const avatarUrl = profileState?.avatar_url || '';
    return {
        name: safeName,
        role: profileState?.role || 'Estudiante',
        career: profileState?.study_area || extras.career || '',
        bio: profileState?.bio || extras.bio || '',
        interests: supabaseInterests || extras.interests || '',
        avatarStyle: avatarType,
        avatarText: avatarUrl || extras.avatarText || '',
        avatarUrl,
        createdAt: profileState?.created_at || currentUser?.createdAt || '',
        goals: Array.isArray(extras.goals) ? extras.goals : []
    };
}

async function uploadProfileAvatar(file) {
    if (!currentUser?.id) throw new Error('No hay usuario activo.');
    if (!(file instanceof File) || file.size === 0) return '';
    if (!file.type || !file.type.startsWith('image/')) {
        throw new Error('Selecciona un archivo de imagen válido.');
    }
    if (file.size > 2 * 1024 * 1024) {
        throw new Error('La imagen debe pesar maximo 2MB.');
    }

    const sb = getSupabaseClient();
    const extension = (file.name.split('.').pop() || file.type.split('/').pop() || 'png')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 8) || 'png';
    const filePath = `${currentUser.id}/avatar-${Date.now()}.${extension}`;

    console.log('[PROFILE AVATAR] subiendo avatar', { path: filePath, size: file.size, type: file.type });
    const { error: uploadError } = await sb.storage
        .from('profile-avatars')
        .upload(filePath, file, {
            cacheControl: '3600',
            upsert: true,
            contentType: file.type
        });

    if (uploadError) {
        logSupabaseError('profile avatar upload', uploadError);
        throw uploadError;
    }

    const { data } = sb.storage.from('profile-avatars').getPublicUrl(filePath);
    return data?.publicUrl || '';
}

async function saveCurrentUserProfile(profileUpdates = {}) {
    if (!currentUser?.id) return;

    const extras = loadWorkspaceExtras();
    const currentProfile = getCurrentUserProfile();
    const avatarFile = profileUpdates.avatarFile instanceof File && profileUpdates.avatarFile.size > 0
        ? profileUpdates.avatarFile
        : null;

    extras.profileExtras = {
        ...(extras.profileExtras || {}),
        career: profileUpdates.career ?? extras.profileExtras?.career ?? currentProfile.career ?? '',
        bio: profileUpdates.bio ?? extras.profileExtras?.bio ?? currentProfile.bio ?? '',
        interests: profileUpdates.interests ?? extras.profileExtras?.interests ?? currentProfile.interests ?? '',
        avatarStyle: profileUpdates.avatarStyle ?? extras.profileExtras?.avatarStyle ?? currentProfile.avatarStyle ?? 'initials',
        avatarText: profileUpdates.avatarText ?? extras.profileExtras?.avatarText ?? currentProfile.avatarText ?? '',
        goals: profileUpdates.goals ?? extras.profileExtras?.goals ?? []
    };
    saveWorkspaceExtras(extras);

    if (profileUpdates.name !== undefined) {
        currentUser.name = profileUpdates.name;
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        if (profileState) profileState.full_name = profileUpdates.name;
    }
    if (profileUpdates.role !== undefined && profileState) {
        profileState.role = profileUpdates.role;
    }

    const shouldPersistRemote = ['name', 'role', 'career', 'bio', 'interests', 'avatarStyle', 'avatarText'].some(key => key in profileUpdates) || !!avatarFile;
    if (!shouldPersistRemote) return;

    const sb = getSupabaseClient();
    const { data: userData, error: userError } = await sb.auth.getUser();
    if (userError) {
        logSupabaseError('profiles getUser', userError);
        throw userError;
    }
    const user = userData?.user;
    if (!user?.id) throw new Error('No hay sesión activa para guardar el perfil.');

    let avatarUrl = profileUpdates.avatarText ?? currentProfile.avatarUrl ?? currentProfile.avatarText ?? '';
    let avatarType = profileUpdates.avatarStyle ?? currentProfile.avatarStyle ?? 'initials';

    if (avatarFile) {
        avatarUrl = await uploadProfileAvatar(avatarFile);
        avatarType = 'custom';
        extras.profileExtras.avatarStyle = 'custom';
        extras.profileExtras.avatarText = avatarUrl;
        saveWorkspaceExtras(extras);
    }

    const payload = {
        id: user.id,
        full_name: profileUpdates.name ?? currentProfile.name ?? currentUser.name ?? user.email?.split('@')[0] ?? 'Estudiante',
        role: profileUpdates.role ?? currentProfile.role ?? 'Estudiante',
        study_area: profileUpdates.career ?? currentProfile.career ?? '',
        bio: profileUpdates.bio ?? currentProfile.bio ?? '',
        interests: normalizeInterests(profileUpdates.interests ?? currentProfile.interests),
        avatar_type: avatarUrl ? 'custom' : avatarType || 'initials',
        avatar_url: avatarUrl || null,
        updated_at: new Date().toISOString()
    };

    console.log('[PROFILE] guardando perfil en Supabase', { id: payload.id, avatar_type: payload.avatar_type });
    const { data, error } = await sb
        .from('profiles')
        .upsert(payload, { onConflict: 'id' })
        .select()
        .single();

    if (error) {
        console.error('Error guardando perfil:', error);
        logSupabaseError('profiles upsert own', error);
        throw error;
    }

    const { data: savedProfile, error: reloadError } = await sb
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

    if (reloadError) {
        console.error('Error guardando perfil:', reloadError);
        logSupabaseError('profiles reload own', reloadError);
        throw reloadError;
    }

    profileState = savedProfile || data;
    currentUser = getPublicUserFromAuth(user, profileState);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    console.log('[PROFILE] perfil guardado correctamente', { id: profileState.id });
}

async function removeCustomProfileAvatar() {
    if (!currentUser?.id) return;

    const confirmed = window.confirm('¿Seguro que quieres borrar tu foto de perfil?');
    if (!confirmed) return;

    try {
        const sb = getSupabaseClient();
        const { data: userData, error: userError } = await sb.auth.getUser();
        if (userError) {
            logSupabaseError('profiles getUser remove avatar', userError);
            throw userError;
        }

        const user = userData?.user;
        if (!user?.id) throw new Error('No hay sesión activa para borrar el avatar.');

        console.log('[PROFILE AVATAR] borrando avatar personalizado', { id: user.id });
        const { data, error } = await sb
            .from('profiles')
            .update({
                avatar_url: null,
                avatar_type: 'initials',
                updated_at: new Date().toISOString()
            })
            .eq('id', user.id)
            .select()
            .single();

        if (error) {
            console.error('Error guardando perfil:', error);
            logSupabaseError('profiles remove avatar', error);
            throw error;
        }

        profileState = data;
        const extras = loadWorkspaceExtras();
        extras.profileExtras = {
            ...(extras.profileExtras || {}),
            avatarStyle: 'initials',
            avatarText: ''
        };
        saveWorkspaceExtras(extras);

        currentUser = getPublicUserFromAuth(user, profileState);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));

        const fileInput = document.querySelector('.quick-modal-form input[name="avatarFile"]');
        if (fileInput) fileInput.value = '';
        const removeButton = document.querySelector('.remove-avatar-btn');
        if (removeButton) removeButton.disabled = true;

        refreshWorkspaceUI();
        notify('Avatar eliminado. Volviste a usar tus iniciales.', 'success');
    } catch (error) {
        console.error('[PROFILE AVATAR REMOVE ERROR]', error);
        notify('No se pudo borrar el avatar. Intenta otra vez.', 'error');
    }
}

function hasCustomProfileAvatar(profile = getCurrentUserProfile()) {
    const avatarValue = String(profile?.avatarUrl || profile?.avatarText || profileState?.avatar_url || '').trim();
    return Boolean(
        avatarValue ||
        profileState?.avatar_type === 'custom' ||
        profile?.avatarStyle === 'custom'
    );
}

function setupProfileAvatarUploadControls(canRemoveAvatar) {
    const avatarInput = document.querySelector('.quick-modal-form input[name="avatarFile"]');
    const avatarLabel = avatarInput?.closest('label');
    if (!avatarInput || !avatarLabel) return;

    let row = avatarLabel.querySelector('.avatar-upload-row');
    if (!row) {
        row = document.createElement('div');
        row.className = 'avatar-upload-row';
        avatarInput.parentNode.insertBefore(row, avatarInput);
        row.appendChild(avatarInput);
    }

    let removeButton = row.querySelector('.remove-avatar-btn');
    if (!removeButton) {
        removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'remove-avatar-btn';
        removeButton.textContent = 'Borrar avatar';
        removeButton.addEventListener('click', removeCustomProfileAvatar);
        row.appendChild(removeButton);
    }

    removeButton.disabled = !canRemoveAvatar;
}

function openProfileForm() {
    const profile = getCurrentUserProfile();
    const hasCustomAvatar = hasCustomProfileAvatar(profile);
    openQuickForm({
        title: 'Editar perfil',
        submitLabel: 'Guardar perfil',
        fields: [
            { name: 'name', label: 'Nombre', value: profile.name, placeholder: 'Tu nombre' },
            { name: 'career', label: 'Carrera o area de estudio', value: profile.career, placeholder: 'Ej: Informatica' },
            { name: 'bio', label: 'Descripción personal', type: 'textarea', rows: 3, value: profile.bio, placeholder: 'Ej: Construyendo mi camino de aprendizaje.' },
            { name: 'interests', label: 'Intereses', value: profile.interests, placeholder: 'Ej: IA educativa, programación, robótica' },
            { name: 'avatarFile', label: 'Subir foto o imagen personalizada', type: 'file', accept: 'image/*', required: false }
        ],
        onSubmit: async values => {
            try {
                await saveCurrentUserProfile({
                    name: values.name.trim(),
                    career: values.career.trim(),
                    bio: values.bio.trim(),
                    interests: values.interests.trim(),
                    avatarFile: values.avatarFile
                });
                refreshWorkspaceUI();
                notify('Perfil actualizado.', 'success');
            } catch (error) {
                console.error('[PROFILE ERROR]', error);
                notify('No se pudo guardar el perfil. Revisa los datos e intenta otra vez.', 'error');
            }
        }
    });

    setupProfileAvatarUploadControls(hasCustomAvatar);
}

function showLanding(options = {}) {
    if (!options.preserveAppView) {
        clearAppViewSession();
    }
    clearAuthMessages();
    ['login-email', 'login-password', 'register-name', 'register-email', 'register-password'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
    });
    showPage('landing-page');
    resetLandingReveal();
    finishBooting();
    console.log("[APP] Mostrando landing");
}

function showDashboard(sectionId = 'dashboard') {
    const appPage = document.getElementById('app-page');
    if (!appPage) {
        console.error('[LOGIN] No se encontro #app-page para mostrar el dashboard');
        return;
    }

    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });

    appPage.classList.add('active');
    document.documentElement.classList.remove('landing-mode', 'is-landing');
    document.documentElement.classList.add('is-dashboard');
    document.body.classList.remove('landing-mode', 'is-landing');
    document.body.classList.add('is-dashboard');
    document.body.classList.remove('landing-active');
    document.body.classList.add('student-active');
    const targetSection = normalizeAppView(sectionId);
    rememberAppView(targetSection);
    currentSection = targetSection;

    applySidebarCollapsedState();

    try {
        updateDashboardGreeting();
        refreshWorkspaceUI();
        navigateTo(targetSection);
    } catch (error) {
        console.error('[LOGIN] Error renderizando dashboard:', error);
        const dashboardSection = document.getElementById('dashboard');
        if (dashboardSection) {
            document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
            dashboardSection.classList.add('active');
            rememberAppView('dashboard');
            currentSection = 'dashboard';
        }
    }

    window.scrollTo(0, 0);
    finishBooting();
}

function showApp() {
    showDashboard('dashboard');
}

async function handleRegister(event) {
    event.preventDefault();
    clearAuthMessages();

    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value.trim();

    if (!name || !email || !password) {
        setAuthMessage('register', 'Completa nombre, correo y contraseña para crear tu cuenta.', 'error');
        return;
    }

    try {
        const sb = getSupabaseClient();
        const { data, error } = await sb.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: name }
            }
        });

        if (error) {
            logSupabaseError('auth signUp', error);
            throw error;
        }
        if (!data.user) throw new Error('No se pudo crear el usuario en Auth.');

        if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
            setAuthMessage('register', 'Este correo ya está registrado. Inicia sesión o usa otro correo.', 'error', {
                label: 'Iniciar sesión con este correo',
                onClick: () => showLoginWithEmail(email)
            });
            return;
        }

        console.log('[Supabase] Resultado signUp', {
            userId: data.user.id,
            email: data.user.email,
            hasSession: !!data.session
        });

        const extras = {
            events: [],
            grades: [],
            attendance: [],
            resources: [],
            recent: [],
            taskMeta: {},
            profileExtras: {
                career: '',
                bio: '',
                interests: '',
                avatarStyle: 'initials',
                avatarText: '',
                goals: []
            },
            tutorHistory: []
        };
        currentUser = { id: data.user.id, email: data.user.email, name };
        saveWorkspaceExtras(extras);

        document.getElementById('register-name').value = '';
        document.getElementById('register-email').value = '';
        document.getElementById('register-password').value = '';

        if (!data.session) {
            setAuthMessage('register', 'Cuenta creada. Ahora inicia sesión.', 'success', {
                label: 'Iniciar sesión con este correo',
                onClick: () => showLoginWithEmail(email)
            });
            return;
        }

        await bootstrapAuthenticatedApp(data.user, name);

        notify('Cuenta creada correctamente. Tu espacio académico empieza vacío.', 'success');
        playInterfaceSound();
        showApp();
    } catch (error) {
        const message = translateSupabaseError(error.message);
        const action = isAlreadyRegisteredError(error.message) ? {
            label: 'Iniciar sesión con este correo',
            onClick: () => showLoginWithEmail(email)
        } : null;
        setAuthMessage('register', message, 'error', action);
    }
}

async function handleLogin(event) {
    if (event?.preventDefault) event.preventDefault();
    if (loginInProgress) return;

    loginInProgress = true;
    const loginForm = document.getElementById('login-form');
    const loginButton = loginForm ? loginForm.querySelector('button[type="submit"]') : null;
    const originalButtonText = loginButton ? loginButton.textContent : '';
    if (loginButton) {
        loginButton.disabled = true;
        loginButton.textContent = 'Entrando...';
    }
    clearAuthMessages();
    console.log("[LOGIN] Botón presionado");

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value.trim();

    if (!email || !password) {
        setAuthMessage('login', 'Escribe tu correo y contraseña para iniciar sesión.', 'error');
        loginInProgress = false;
        if (loginButton) {
            loginButton.disabled = false;
            loginButton.textContent = originalButtonText;
        }
        return;
    }

    try {
        const sb = getSupabaseClient();
        console.log("[LOGIN] Intentando entrar con:", email);
        console.log("[Supabase] Intentando login", email);
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        console.log("[LOGIN] Resultado Supabase:", data);
        if (error) {
            console.error("[LOGIN] Error Supabase:", error);
            console.error("[Supabase] Error login", error);
            logSupabaseError('auth signInWithPassword', error);
            throw error;
        }
        const authUser = data.user || data.session?.user;
        if (!data.session && !authUser) throw new Error('No se encontro la cuenta.');
        console.log("[LOGIN] Supabase OK");
        console.log("[Supabase] Login correcto", data);

        currentUser = getPublicUserFromAuth(authUser);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        console.log("[LOGIN] currentUser:", currentUser);
        console.log("[LOGIN] Login correcto, entrando al dashboard");
        console.log("[LOGIN] Mostrando dashboard");
        showDashboard();

        try {
            await bootstrapAuthenticatedApp(authUser);
            showDashboard();
        } catch (bootstrapError) {
            console.error("[LOGIN] Error cargando perfil o datos:", bootstrapError);
            logSupabaseError('login bootstrap data', bootstrapError);
            profileState = {
                id: authUser.id,
                full_name: currentUser.name,
                role: 'Estudiante',
                xp: 0,
                streak: 0,
                level: 1,
                created_at: authUser.created_at || ''
            };
            workspaceState = mergeWorkspaceState({
                subjects: [],
                tasks: [],
                xp: 0,
                streak: 0
            });
            notify('Sesión iniciada. No se pudieron cargar algunos datos de Supabase.', 'info');
            showDashboard();
        }

        document.getElementById('login-email').value = '';
        document.getElementById('login-password').value = '';

        console.log("[LOGIN] Entrando al dashboard");
        notify('Sesión iniciada correctamente.', 'success');
        playInterfaceSound();
        showApp();
    } catch (error) {
        console.error("[LOGIN] Error Supabase:", error);
        console.error("[Supabase] Error login", error);
        logSupabaseError('login flow', error);
        setAuthMessage('login', translateSupabaseError(error.message), 'error');
    } finally {
        loginInProgress = false;
        if (loginButton) {
            loginButton.disabled = false;
            loginButton.textContent = originalButtonText;
        }
    }
}

async function handleLogout(event) {
    if (event?.preventDefault) event.preventDefault();
    if (logoutInProgress) return;
    logoutInProgress = true;
    console.log("[LOGOUT] Botón presionado");

    try {
        const sb = getSupabaseClient();
        const { error } = await sb.auth.signOut();
        if (error) {
            console.error("[LOGOUT ERROR]", error);
            if (typeof showToast === 'function') {
                showToast("No se pudo cerrar sesión. Intenta otra vez.");
            } else {
                notify("No se pudo cerrar sesión. Intenta otra vez.", "error");
            }
            return;
        }

        currentUser = null;
        profileState = null;
        workspaceState = mergeWorkspaceState();
        localStorage.removeItem("currentUser");
        localStorage.removeItem("acEdunityUser");
        clearAppViewSession();

        console.log("[LOGOUT] Sesión cerrada");
        console.log("[APP] Mostrando landing");
        playInterfaceSound();
        showLanding();
        notify("Sesión cerrada.", "info");
    } catch (error) {
        console.error("[LOGOUT ERROR]", error);
        if (typeof showToast === 'function') {
            showToast("No se pudo cerrar sesión. Intenta otra vez.");
        } else {
            notify("No se pudo cerrar sesión. Intenta otra vez.", "error");
        }
    } finally {
        logoutInProgress = false;
    }
}

async function toggleTask(checkbox) {
    const card = checkbox.closest('[data-id]');
    const taskId = card?.dataset.id;
    if (!taskId) return;

    try {
        const workspace = loadWorkspace();
        const task = workspace.tasks.find(item => item.id === taskId);
        if (!task) return;

        const nextStatus = checkbox.checked ? 'completed' : 'pending';
        const justCompleted = task.status !== 'completed' && nextStatus === 'completed';

        const { error } = await getSupabaseClient()
            .from('tasks')
            .update({ status: nextStatus })
            .eq('id', taskId)
            .eq('user_id', currentUser.id);

        if (error) throw error;

        if (justCompleted) {
            pushRecentMessage(`Completaste la tarea ${task.title}.`);
            await updateProfileProgress(25, { bumpStreak: true });
        }

        await syncWorkspaceFromSupabase();
        refreshWorkspaceUI();
    } catch (error) {
        checkbox.checked = !checkbox.checked;
        notify(error.message || 'No se pudo actualizar la tarea.', 'error');
    }
}

function openSubjectForm(subjectId = null) {
    const workspace = loadWorkspace();
    const subject = workspace.subjects.find(item => item.id === subjectId);

    openQuickForm({
        title: subject ? 'Editar materia' : 'Crear materia',
        submitLabel: subject ? 'Actualizar materia' : 'Guardar materia',
        fields: [
            { name: 'name', label: 'Nombre de la materia', value: subject?.name || '', placeholder: 'Ej: Matemática' },
            { name: 'icon', label: 'Icono de la materia', type: 'choice-grid', options: subjectBookOptions, value: normalizeSubjectIcon(subject?.icon) },
            {
                name: 'customIcon',
                label: 'Icono personalizado opcional',
                value: subject?.customIcon || (!isKnownSubjectIcon(String(subject?.icon || '')) ? subject?.icon || '' : ''),
                required: false,
                placeholder: 'Ej: MAT, BIO, IA'
            },
            { name: 'color', label: 'Color identificador', type: 'choice-grid', options: subjectColorOptions, value: normalizeSubjectColor(subject?.color || 'Azul') },
            { name: 'description', label: 'Descripción corta', type: 'textarea', rows: 3, value: subject?.description || '', required: false, placeholder: 'Ej: Álgebra, geometría y resolución de problemas.' },
            { name: 'goal', label: 'Objetivo de la materia', type: 'textarea', rows: 3, value: subject?.goal || '', required: false, placeholder: 'Ej: Subir mi promedio y entregar tareas a tiempo.' }
        ],
        onSubmit: async values => {
            const name = values.name.trim();
            if (!name) {
                notify('Escribe el nombre de la materia.', 'error');
                return;
            }

            try {
                const sb = getSupabaseClient();
                const customIcon = String(values.customIcon || '').trim().slice(0, 4);
                const payload = {
                    user_id: currentUser.id,
                    name,
                    icon: customIcon || normalizeSubjectIcon(values.icon),
                    color: normalizeSubjectColor(values.color || 'Azul')
                };

                if (subjectId) {
                    const { data, error } = await sb
                        .from('subjects')
                        .update(payload)
                        .eq('id', subjectId)
                        .eq('user_id', currentUser.id);

                    if (error) {
                        logSupabaseError('subjects update', error);
                        throw error;
                    }
                    console.log('[Supabase] Materia actualizada', {
                        userId: currentUser.id,
                        subjectId,
                        payload,
                        result: data
                    });
                    pushRecentMessage(`Editaste la materia ${name}.`);
                } else {
                    const { data, error } = await sb
                        .from('subjects')
                        .insert(payload);

                    if (error) {
                        logSupabaseError('subjects insert', error);
                        throw error;
                    }
                    console.log('[Supabase] Materia insertada', {
                        userId: currentUser.id,
                        subject: payload,
                        result: data
                    });
                    pushRecentMessage(`Creaste la materia ${name}.`);
                    await updateProfileProgress(30, { bumpStreak: true });
                }

                await syncWorkspaceFromSupabase();
                refreshWorkspaceUI();
                notify(subjectId ? 'Materia actualizada.' : 'Materia creada correctamente.', 'success');
            } catch (error) {
                notify(error.message || 'No se pudo guardar la materia.', 'error');
            }
        }
    });
}

async function deleteSubject(subjectId) {
    const workspace = loadWorkspace();
    const subject = workspace.subjects.find(item => item.id === subjectId);
    if (!subject) return;

    try {
        const sb = getSupabaseClient();
        const subjectTasks = workspace.tasks.filter(task => task.subjectId === subjectId);

        if (subjectTasks.length) {
            const { error: taskError } = await sb
                .from('tasks')
                .delete()
                .eq('user_id', currentUser.id)
                .eq('subject_id', subjectId);

            if (taskError) {
                logSupabaseError('tasks delete by subject', taskError);
                throw taskError;
            }
        }

        const { error } = await sb
            .from('subjects')
            .delete()
            .eq('id', subjectId)
            .eq('user_id', currentUser.id);

        if (error) {
            logSupabaseError('subjects delete', error);
            throw error;
        }

        const extras = loadWorkspaceExtras();
        subjectTasks.forEach(task => delete extras.taskMeta?.[task.id]);
        saveWorkspaceExtras(extras);

        pushRecentMessage(`Eliminaste la materia ${subject.name}.`);
        await syncWorkspaceFromSupabase();
        refreshWorkspaceUI();
        notify('Materia eliminada junto con sus tareas.', 'info');
    } catch (error) {
        notify(error.message || 'No se pudo eliminar la materia.', 'error');
    }
}

function renderSubjects(workspace) {
    const grid = document.querySelector('.subjects-grid');
    if (!grid) return;
    ensureSubjectsToolbar(grid);
    const filteredSubjects = sortSubjectsForView(
        workspace.subjects.filter(subject => normalizeTutorText(subject.name).includes(normalizeTutorText(subjectFilterText))),
        workspace
    );

    grid.innerHTML = workspace.subjects.length ? (filteredSubjects.length ? filteredSubjects.map(subject => {
        const metrics = getSubjectMetrics(workspace, subject);
        const color = getAcademicColorValue(subject.color);

        return `
            <div class="subject-card subject-custom ac-colored-card subject-space-card" style="${getAcademicCardStyle(color)}">
                ${neonLinesHTML()}
                <div class="subject-orbit" aria-hidden="true"></div>
                <div class="subject-header">
                    <div class="subject-title">
                        ${getSubjectIconMarkup(subject)}
                        <div>
                            <h3>${escapeHTML(subject.name)}</h3>
                            <p>${escapeHTML(subject.description || 'Espacio académico personalizado')}</p>
                        </div>
                    </div>
                    <span class="subject-chip">${escapeHTML(subject.color || 'Morado')}</span>
                </div>
                <div class="subject-progress-block">
                    <div><span>Progreso</span><strong>${metrics.progress}%</strong></div>
                    <div class="progress-bar"><div class="progress-fill" style="width:${metrics.progress}%; background:linear-gradient(90deg, ${color}, #49ccf9)"></div></div>
                </div>
                <div class="subject-metric-grid">
                    <div><span>Pendientes</span><strong>${metrics.pendingTasks.length}</strong></div>
                    <div><span>Completadas</span><strong>${metrics.completedTasks.length}</strong></div>
                    <div><span>Promedio</span><strong>${metrics.average ? metrics.average.toFixed(2) : '--'}</strong></div>
                    <div><span>Apuntes</span><strong>${metrics.resources.length}</strong></div>
                </div>
                <div class="subject-card-footer">
                    <p><strong>Próxima entrega:</strong> ${metrics.nextEvent ? escapeHTML(`${metrics.nextEvent.title} - ${metrics.nextEvent.date || metrics.nextEvent.day || 'Sin fecha'}`) : 'Sin entregas programadas'}</p>
                    <p><strong>Ultima actividad:</strong> ${escapeHTML(metrics.recentText)}</p>
                </div>
                <div class="card-actions">
                    <button class="btn-primary btn-small" data-subject-open="${escapeHTML(subject.id)}">Abrir materia</button>
                    <button class="btn-secondary btn-small" data-subject-edit="${escapeHTML(subject.id)}">Editar</button>
                    <button class="btn-danger btn-small" data-subject-delete="${escapeHTML(subject.id)}">Eliminar</button>
                </div>
            </div>
        `;
    }).join('') : emptyStateHTML('No se encontraron materias con esa búsqueda.', 'Limpiar búsqueda', "clearSubjectSearch()")) : emptyStateHTML('No tienes materias todavía. Organiza tu aprendizaje creando tu primera materia.', '+ Crear materia', 'addSubjectUI()');

    bindSubjectsToolbar();
    grid.querySelectorAll('[data-subject-open]').forEach(button => button.addEventListener('click', () => openSubjectDetails(button.dataset.subjectOpen)));
    grid.querySelectorAll('[data-subject-edit]').forEach(button => button.addEventListener('click', () => openSubjectForm(button.dataset.subjectEdit)));
    grid.querySelectorAll('[data-subject-delete]').forEach(button => button.addEventListener('click', () => deleteSubject(button.dataset.subjectDelete)));
}

function openTaskForm(taskId = null) {
    const workspace = loadWorkspace();
    const task = workspace.tasks.find(item => item.id === taskId);

    openQuickForm({
        title: task ? 'Editar tarea' : 'Crear tarea',
        submitLabel: task ? 'Actualizar tarea' : 'Guardar tarea',
        fields: [
            { name: 'title', label: 'Título', value: task?.title || '', placeholder: 'Ej: Taller de funciones' },
            { name: 'subject', label: 'Materia', type: 'select', options: getSubjectOptions(workspace), value: task?.subject || '' },
            { name: 'description', label: 'Descripción', type: 'textarea', value: task?.description || '', placeholder: 'Detalles de la tarea' },
            { name: 'due', label: 'Fecha límite', type: 'date', value: normalizeDate(task?.due) },
            { name: 'priority', label: 'Prioridad', type: 'select', options: taskPriorityOptions, value: task?.priority || 'media' },
            { name: 'emailReminder', label: 'Recordarme por Gmail', type: 'checkbox', checked: !!task?.emailReminder, required: false, help: 'Mostrar alerta visual cuando esté próxima a vencer' },
            { name: 'email', label: 'Correo para notificación', type: 'email', value: task?.email || currentUser?.email || '', required: false, placeholder: 'usuario@gmail.com' }
        ],
        onSubmit: async values => {
            const title = values.title.trim();
            const subjectName = values.subject || '';
            const subject = workspace.subjects.find(item => item.name === subjectName);
            let savedTaskId = taskId;

            if (!title || !subject) {
                notify('Selecciona una materia válida y escribe el título.', 'error');
                return;
            }

            try {
                const sb = getSupabaseClient();
                const payload = {
                    user_id: currentUser.id,
                    subject_id: subject.id,
                    title,
                    description: values.description.trim(),
                    due_date: values.due || null,
                    priority: normalizeTaskPriority(values.priority),
                    status: task?.status === 'completed' ? 'completed' : 'pending'
                };

                if (taskId) {
                    const { data, error } = await sb
                        .from('tasks')
                        .update(payload)
                        .eq('id', taskId)
                        .eq('user_id', currentUser.id);

                    if (error) {
                        logSupabaseError('tasks update', error);
                        throw error;
                    }
                    console.log('[Supabase] Tarea actualizada', {
                        userId: currentUser.id,
                        taskId,
                        payload,
                        result: data
                    });
                    pushRecentMessage(`Editaste la tarea ${title}.`);
                } else {
                    const { data, error } = await sb
                        .from('tasks')
                        .insert(payload)
                        .select('id')
                        .single();

                    if (error) {
                        logSupabaseError('tasks insert', error);
                        throw error;
                    }
                    savedTaskId = data.id;
                    console.log('[Supabase] Tarea insertada', {
                        userId: currentUser.id,
                        task: payload,
                        inserted: data
                    });
                    pushRecentMessage(`Agregaste la tarea ${title}.`);
                    await updateProfileProgress(15, { bumpStreak: true });
                }

                const extras = loadWorkspaceExtras();
                extras.taskMeta = extras.taskMeta || {};
                if (savedTaskId) {
                    extras.taskMeta[savedTaskId] = {
                        emailReminder: values.emailReminder === 'yes',
                        email: values.email.trim()
                    };
                }
                saveWorkspaceExtras(extras);

                await syncWorkspaceFromSupabase();
                refreshWorkspaceUI();
                notify(taskId ? 'Tarea actualizada.' : 'Tarea creada correctamente.', 'success');
            } catch (error) {
                notify(error.message || 'No se pudo guardar la tarea.', 'error');
            }
        }
    });
}

async function deleteTask(taskId) {
    const workspace = loadWorkspace();
    const task = workspace.tasks.find(item => item.id === taskId);
    if (!task) return;

    try {
        const { error } = await getSupabaseClient()
            .from('tasks')
            .delete()
            .eq('id', taskId)
            .eq('user_id', currentUser.id);

        if (error) {
            logSupabaseError('tasks delete', error);
            throw error;
        }

        const extras = loadWorkspaceExtras();
        delete extras.taskMeta?.[taskId];
        saveWorkspaceExtras(extras);

        pushRecentMessage(`Eliminaste la tarea ${task.title}.`);
        await syncWorkspaceFromSupabase();
        refreshWorkspaceUI();
        notify('Tarea eliminada.', 'info');
    } catch (error) {
        notify(error.message || 'No se pudo eliminar la tarea.', 'error');
    }
}

async function completeTask(taskId) {
    const workspace = loadWorkspace();
    const task = workspace.tasks.find(item => item.id === taskId);
    if (!task) return;
    if (task.status === 'completed') return;

    try {
        const { error } = await getSupabaseClient()
            .from('tasks')
            .update({ status: 'completed' })
            .eq('id', taskId)
            .eq('user_id', currentUser.id);

        if (error) {
            logSupabaseError('tasks complete', error);
            throw error;
        }

        pushRecentMessage(`Completaste la tarea ${task.title}.`);
        await updateProfileProgress(25, { bumpStreak: true });
        await syncWorkspaceFromSupabase();
        refreshWorkspaceUI();
        notify('Tarea marcada como completada.', 'success');
    } catch (error) {
        notify(error.message || 'No se pudo completar la tarea.', 'error');
    }
}

function refreshWorkspaceUI() {
    const workspace = loadWorkspace();
    renderDashboard(workspace);
    renderSubjects(workspace);
    renderTasks(workspace);
    renderCalendarSection(workspace);
    renderGrades(workspace);
    renderAttendance(workspace);
    renderProgress(workspace);
    renderBackpack(workspace);
    renderProfile(workspace);
    updateGradeSubjectOptions(workspace);
}

async function initializeApp() {
    document.documentElement.classList.add('is-landing', 'landing-mode');
    document.documentElement.classList.remove('is-dashboard');
    document.body.classList.add('is-landing', 'landing-mode', 'landing-active');
    document.body.classList.remove('is-dashboard', 'student-active');

    bindAuthForms();
    initInterfaceSound();
    bindInterfaceSoundEvents();
    updateInterfaceSoundControls();

    if (isDarkTheme) {
        document.body.classList.remove('light-theme');
        updateThemeIcon('theme');
    } else {
        document.body.classList.add('light-theme');
        updateThemeIcon('theme');
    }

    window.addEventListener('resize', handleWindowResize);
    generateCalendar();
    initStudyPet();
    initLandingReveal();
    initLandingWheelControl();

    const shouldRestoreStudentApp = shouldRestoreAppFromSession();
    console.log(shouldRestoreStudentApp ? "[APP] Restauración de panel pendiente" : "[APP] Landing inicial");
    currentUser = null;
    profileState = null;
    workspaceState = mergeWorkspaceState();
    localStorage.removeItem('currentUser');
    localStorage.removeItem('acEdunityUser');

    try {
        const sb = getSupabaseClient();
        console.log('[Supabase] initializeApp usando cliente real');

        if (!authListenerReady) {
            sb.auth.onAuthStateChange(async (authEvent, session) => {
                if (authEvent === 'PASSWORD_RECOVERY') {
                    console.log('[PASSWORD UPDATE] Modo recuperación detectado');
                    currentUser = null;
                    profileState = null;
                    workspaceState = mergeWorkspaceState();
                    showLanding();
                    window.setTimeout(openPasswordUpdateModal, 100);
                    return;
                }

                if (authEvent === 'SIGNED_OUT') {
                    currentUser = null;
                    profileState = null;
                    workspaceState = mergeWorkspaceState();
                    localStorage.removeItem('currentUser');
                    localStorage.removeItem('acEdunityUser');
                    clearAppViewSession();
                    showLanding();
                    return;
                }
            });
            authListenerReady = true;
        }

        const { data: sessionData, error } = await sb.auth.getSession();
        if (error) throw error;
        if (isPasswordRecoveryUrl()) {
            console.log('[PASSWORD UPDATE] Link de recuperación detectado en URL');
            window.setTimeout(openPasswordUpdateModal, 250);
            clearAppViewSession();
            showLanding();
            return;
        }

        if (sessionData?.session?.user && shouldRestoreAppFromSession()) {
            const authUser = sessionData.session.user;
            const restoredView = getStoredAppView();
            console.log("[APP] Restaurando menu estudiantil en:", restoredView);
            currentUser = getPublicUserFromAuth(authUser);
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            await bootstrapAuthenticatedApp(authUser);
            showDashboard(restoredView);
            return;
        }

        currentUser = null;
        profileState = null;
        workspaceState = mergeWorkspaceState();
        localStorage.removeItem('currentUser');
        localStorage.removeItem('acEdunityUser');
        clearAppViewSession();
        showLanding();
    } catch (error) {
        currentUser = null;
        profileState = null;
        workspaceState = mergeWorkspaceState();
        showLanding();
        notify(error.message || 'No se pudo iniciar Supabase.', 'error');
    }
}

// Forzamos que los handlers globales apunten a las funciones finales con Supabase.
window.handleRegister = handleRegister;
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.openPasswordResetModal = openPasswordResetModal;
window.closePasswordResetModal = closePasswordResetModal;
window.handlePasswordReset = handlePasswordReset;
window.handleUpdatePassword = handleUpdatePassword;
window.toggleInterfaceSounds = toggleInterfaceSounds;
window.openSubjectForm = openSubjectForm;
window.openTaskForm = openTaskForm;
window.toggleTask = toggleTask;
window.showDashboard = showDashboard;
window.showApp = showApp;
window.showLanding = showLanding;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
