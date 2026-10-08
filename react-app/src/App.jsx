import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import './edunity.css'
import './auth-ui.css'

const featureCards = [
  {
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="6" height="6" rx="1.5" />
        <rect x="14" y="4" width="6" height="6" rx="1.5" />
        <rect x="4" y="14" width="6" height="6" rx="1.5" />
        <rect x="14" y="14" width="6" height="6" rx="1.5" />
      </svg>
    ),
    title: 'Organización',
    description: 'Materias, tareas y calendario con una experiencia clara para estudiar sin desorden.',
    list: ['Materias personalizadas', 'Agenda y pendientes'],
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5.5A3.5 3.5 0 0 1 8.5 2H20v17H8.5A3.5 3.5 0 0 0 5 22V5.5Z" />
        <path d="M5 5.5A3.5 3.5 0 0 1 8.5 9H20" />
        <path d="M9 5h6" />
        <path d="M9 13h7" />
      </svg>
    ),
    title: 'Aprendizaje',
    description: 'Tutor IA, flashcards y práctica guiada para comprender y repasar mejor.',
    list: ['Explicaciones simples', 'Flashcards y práctica'],
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 19h16" />
        <path d="M7 16V9" />
        <path d="M12 16V5" />
        <path d="M17 16v-4" />
        <path d="m15 8 2-2 3 3" />
      </svg>
    ),
    title: 'Seguimiento',
    description: 'Notas, promedio, XP, logros y progreso visual para medir tu avance académico.',
    list: ['Promedio y nivel', 'Logros desbloqueables'],
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" />
        <path d="M4 10h16" />
        <path d="M8 14h8" />
      </svg>
    ),
    title: 'Mochila',
    description: 'Apuntes y recursos por materia conectados con Tutor para estudiar mejor.',
    list: ['Biblioteca digital', 'Recursos por materia'],
  },
]

const useBenefits = [
  {
    title: 'Menos desorden',
    description: 'Reúne materias, tareas, notas y apuntes en un solo espacio.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7a3 3 0 0 1 3-3h3l2 2h5a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7Z" />
        <path d="M8 11h8M8 15h5" />
      </svg>
    ),
  },
  {
    title: 'Avisos de Edunity',
    description: 'Avisos a tiempo de tareas, evaluaciones, eventos y proyectos.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
        <path d="M10 21h4M12 2V1" />
      </svg>
    ),
  },
  {
    title: 'Aprendizaje guiado',
    description: 'Convierte apuntes en resúmenes, preguntas y flashcards.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5" width="16" height="14" rx="3" />
        <path d="M9 2v3M15 2v3M9 11h.01M15 11h.01M9 15h6" />
      </svg>
    ),
  },
  {
    title: 'Progreso visible',
    description: 'Sigue tu avance con XP, logros y métricas académicas claras.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 19h16M7 16v-4M12 16V8M17 16V5" />
        <path d="m14 7 3-3 3 3" />
      </svg>
    ),
  },
]

const stats = [
  { label: 'Resumen', value: '44%' },
  { label: 'Tareas', value: '12' },
  { label: 'XP', value: '+90' },
]

const SUPABASE_URL = 'https://pskbdeqaajprfhrjortm.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_M3ABI_7yU49LkGO3Op-CLA_qsCDP7Lz'
const SIGNUP_EMAIL_REDIRECT_URL = 'https://edunity.me/?email-confirmed=1'

let supabaseClient = null

function getSupabaseClient() {
  if (typeof window === 'undefined') return null

  if (!supabaseClient) {
    try {
      supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    } catch (error) {
      console.error('Supabase init failed:', error)
      return null
    }
  }

  return supabaseClient
}

function translateSupabaseError(message = '') {
  const text = String(message || '').toLowerCase()

  if (text.includes('user already registered') || text.includes('already registered') || text.includes('already exists') || text.includes('email exists')) {
    return 'Este correo ya está registrado. Inicia sesión o usa otro correo.'
  }

  if (text.includes('rate limit') || text.includes('too many requests') || text.includes('over_email_send_rate_limit') || text.includes('email rate limit') || text.includes('for security purposes')) {
    return 'Se alcanzó el límite de intentos. Espera unos minutos e intenta otra vez.'
  }

  if (text.includes('invalid login credentials') || text.includes('invalid credentials') || text.includes('invalid email or password')) {
    return 'Correo o contraseña incorrectos.'
  }

  if (text.includes('email not confirmed') || text.includes('not confirmed')) {
    return 'Debes confirmar tu correo antes de iniciar sesión.'
  }

  if (text.includes('password should be at least') || text.includes('weak password')) {
    return 'La contraseña debe tener al menos 6 caracteres.'
  }

  if (text.includes('invalid email')) {
    return 'Escribe un correo válido.'
  }

  if (text.includes('failed to fetch') || text.includes('network') || text.includes('fetch')) {
    return 'No se pudo conectar con Supabase. Revisa tu conexión e intenta otra vez.'
  }

  return 'No se pudo completar la acción. Revisa los datos e intenta otra vez.'
}

function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark'
    return window.localStorage.getItem('theme') === 'light' ? 'light' : 'dark'
  })
  const [currentPage, setCurrentPage] = useState('landing')
  const [loginValues, setLoginValues] = useState({ email: '', password: '', remember: false })
  const [registerValues, setRegisterValues] = useState({ name: '', email: '', password: '', confirmPassword: '' })
  const [authMessage, setAuthMessage] = useState({ text: '', type: 'error' })
  const [passwordVisibility, setPasswordVisibility] = useState({ login: false, registerPassword: false, registerConfirmation: false })
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false)
  const [isSubmittingRegister, setIsSubmittingRegister] = useState(false)

  useEffect(() => {
    const isLanding = currentPage === 'landing'
    const isAuth = currentPage === 'login' || currentPage === 'register'

    document.body.classList.toggle('light-theme', theme === 'light')
    document.body.classList.toggle('landing-mode', isLanding)
    document.body.classList.toggle('is-landing', isLanding)
    document.body.classList.toggle('landing-active', isLanding)
    document.body.classList.toggle('auth-mode', isAuth)
    window.localStorage.setItem('theme', theme)
  }, [theme, currentPage])

  useEffect(() => {
    const revealItems = document.querySelectorAll(
      '#landing-page .reveal, #landing-page .reveal-left, #landing-page .reveal-right, #landing-page .reveal-scale'
    )

    if (!revealItems.length) return undefined

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      revealItems.forEach((item) => item.classList.add('active'))
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.14) {
            entry.target.classList.add('active')
            return
          }

          if (!entry.isIntersecting) {
            entry.target.classList.remove('active')
          }
        })
      },
      {
        threshold: [0, 0.14],
        rootMargin: '0px',
      }
    )

    revealItems.forEach((item) => observer.observe(item))

    return () => {
      observer.disconnect()
    }
  }, [currentPage])

  const scrollToSection = (id) => {
    const element = document.getElementById(id)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const handleLink = (event, id) => {
    event.preventDefault()
    scrollToSection(id)
  }

  const goToPage = (page) => {
    setAuthMessage({ text: '', type: 'error' })
    setCurrentPage(page)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  const showLanding = () => {
    goToPage('landing')
  }

  const showLogin = () => {
    goToPage('login')
  }

  const showRegister = () => {
    goToPage('register')
  }

  const resetAuthForms = () => {
    setLoginValues({ email: '', password: '', remember: false })
    setRegisterValues({ name: '', email: '', password: '', confirmPassword: '' })
    setPasswordVisibility({ login: false, registerPassword: false, registerConfirmation: false })
  }

  const updateLoginInput = (field, value) => {
    setLoginValues((current) => ({ ...current, [field]: value }))
  }

  const updateRegisterInput = (field, value) => {
    setRegisterValues((current) => ({ ...current, [field]: value }))
  }

  const togglePasswordVisibility = (field) => {
    setPasswordVisibility((current) => ({
      ...current,
      [field]: !current[field],
    }))
  }

  const handleLoginSubmit = async (event) => {
    event.preventDefault()
    if (isSubmittingLogin) return

    const email = loginValues.email.trim()
    const password = loginValues.password.trim()

    if (!email || !password) {
      setAuthMessage({ text: 'Escribe tu correo y contraseña para iniciar sesión.', type: 'error' })
      return
    }

    const client = getSupabaseClient()
    if (!client) {
      setAuthMessage({ text: 'No se pudo iniciar la autenticación. Intenta otra vez.', type: 'error' })
      return
    }

    setIsSubmittingLogin(true)
    setAuthMessage({ text: '', type: 'error' })

    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password })

      if (error) {
        throw error
      }

      if (!data.session) {
        throw new Error('No se encontró una sesión válida.')
      }

      showLanding()
      resetAuthForms()
      setAuthMessage({ text: 'Sesión iniciada correctamente.', type: 'success' })
    } catch (error) {
      setAuthMessage({
        text: translateSupabaseError(error?.message),
        type: 'error',
      })
    } finally {
      setIsSubmittingLogin(false)
    }
  }

  const handleRegisterSubmit = async (event) => {
    event.preventDefault()
    if (isSubmittingRegister) return

    const name = registerValues.name.trim()
    const email = registerValues.email.trim()
    const password = registerValues.password
    const confirmPassword = registerValues.confirmPassword

    if (!name) {
      setAuthMessage({ text: 'Ingresa tu nombre completo.', type: 'error' })
      return
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthMessage({ text: 'Escribe un correo válido.', type: 'error' })
      return
    }

    if (!password.trim()) {
      setAuthMessage({ text: 'Ingresa una contraseña.', type: 'error' })
      return
    }

    if (password.length < 6) {
      setAuthMessage({ text: 'La contraseña debe tener al menos 6 caracteres.', type: 'error' })
      return
    }

    if (!confirmPassword.trim()) {
      setAuthMessage({ text: 'Confirma tu contraseña.', type: 'error' })
      return
    }

    if (password !== confirmPassword) {
      setAuthMessage({ text: 'Las contraseñas no coinciden.', type: 'error' })
      return
    }

    const client = getSupabaseClient()
    if (!client) {
      setAuthMessage({ text: 'No se pudo iniciar la autenticación. Intenta otra vez.', type: 'error' })
      return
    }

    setIsSubmittingRegister(true)
    setAuthMessage({ text: '', type: 'error' })

    try {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name },
          emailRedirectTo: SIGNUP_EMAIL_REDIRECT_URL,
        },
      })

      if (error) {
        throw error
      }

      if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) {
        setAuthMessage({ text: 'Este correo ya está registrado. Inicia sesión o usa otro correo.', type: 'error' })
        return
      }

      resetAuthForms()
      goToPage('login')
      setAuthMessage({
        text: 'Cuenta creada. Revisa tu correo y confirma tu cuenta antes de iniciar sesión.',
        type: 'success',
      })
    } catch (error) {
      setAuthMessage({
        text: translateSupabaseError(error?.message),
        type: 'error',
      })
    } finally {
      setIsSubmittingRegister(false)
    }
  }

  return (
    <>
      {currentPage === 'landing' && (
        <div id="landing-page" className="page active">
        <nav className="landing-nav reveal">
          <div className="nav-logo">
            <img src="/assets/ac-edunity-logo.png" alt="Logo AC Edunity" className="brand-logo" />
            <span>AC Edunity</span>
          </div>

          <div className="landing-links">
            <a href="#landing-page" onClick={(event) => handleLink(event, 'landing-page')}>Inicio</a>
            <a href="#features" onClick={(event) => handleLink(event, 'features')}>Funciones</a>
            <a href="#ai-preview" onClick={(event) => handleLink(event, 'ai-preview')}>Tutor IA</a>
            <a href="#benefits-use" onClick={(event) => handleLink(event, 'benefits-use')}>Beneficios</a>
            <a href="#tutorial-ac-edunity" onClick={(event) => handleLink(event, 'tutorial-ac-edunity')}>Tutorial</a>
          </div>

          <div className="nav-actions">
            <button type="button" className="btn-secondary" onClick={showLogin}>
              Inicia sesión
            </button>
            <button type="button" className="btn-primary" onClick={showRegister}>
              Registrarse
            </button>
            <button
              type="button"
              className="theme-toggle"
              aria-label="Cambiar tema"
              title="Cambiar tema"
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            >
              <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
            </button>
          </div>
        </nav>

        <div className="study-pet" id="study-pet" role="button" tabIndex={0} aria-label="Regístrate e inicia tu estudio">
          <div className="pet-bubble">
            <strong>Regístrate</strong> e inicia tu estudio
          </div>
          <div className="pet-robot" aria-hidden="true">
            <span className="robot-antenna"></span>
            <span className="robot-head">
              <span className="robot-visor">
                <span className="robot-happy-eye robot-happy-eye-left"></span>
                <span className="robot-happy-eye robot-happy-eye-right"></span>
                <span className="robot-happy-smile"></span>
              </span>
            </span>
            <span className="robot-body">
              <span className="robot-core"></span>
              <span className="robot-chest-mark">AC</span>
              <span className="robot-arm robot-arm-left"><span className="robot-hand"></span></span>
              <span className="robot-arm robot-arm-right"><span className="robot-hand"></span></span>
              <span className="robot-leg robot-leg-left"></span>
              <span className="robot-leg robot-leg-right"></span>
            </span>
            <span className="robot-shadow"></span>
          </div>
        </div>

        <section className="hero">
          <div className="hero-content">
            <div className="hero-left reveal-left">
              <span className="hero-badge">Gestión Educativa Inteligente Personalizada</span>
              <h1>
                Organiza tu aprendizaje. Avanza con <span>inteligencia.</span>
              </h1>
              <p>
                Planifica tus estudios, aprende con Tutor IA y convierte cada objetivo académico en progreso visible.
              </p>
              <div className="hero-actions">
                <button type="button" className="btn-large" onClick={showRegister}>
                  Comenzar gratis
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </div>
              <div className="hero-proof reveal delay-2" aria-label="Resumen de herramientas principales">
                <span>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 7h16v12H4zM8 4h8v3M8 11h8M8 15h5" />
                  </svg>
                  <small>
                    <strong>Todo</strong> tu espacio académico
                  </small>
                </span>
                <span>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="4" y="5" width="16" height="14" rx="3" />
                    <path d="M9 2v3M15 2v3M9 11h.01M15 11h.01M9 15h6" />
                  </svg>
                  <small>
                    <strong>Tutor</strong> para estudiar mejor
                  </small>
                </span>
                <span>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 19h16M7 16v-4M12 16V8M17 16V5M14 7l3-3 3 3" />
                  </svg>
                  <small>
                    <strong>XP</strong> y progreso visual
                  </small>
                </span>
              </div>
            </div>

            <div className="hero-right hero-visual reveal-right delay-1">
              <div className="dashboard-mockup hero-dashboard">
                <div className="mockup-top">
                  <span className="panel-status" aria-hidden="true"></span>
                  <strong>Panel AC Edunity</strong>
                  <small>Vista general</small>
                </div>

                <div className="mockup-grid">
                  <div className="mockup-card wide progress-card">
                    <div className="mockup-card-heading">
                      <small>Progreso semanal</small>
                      <span>Esta semana</span>
                    </div>
                    <div className="mockup-bars" aria-label="Progreso de lunes a domingo">
                      <span><i style={{ '--bar': '42%' }} /><small>Lun</small></span>
                      <span><i style={{ '--bar': '65%' }} /><small>Mar</small></span>
                      <span><i style={{ '--bar': '54%' }} /><small>Mié</small></span>
                      <span><i style={{ '--bar': '82%' }} /><small>Jue</small></span>
                      <span><i style={{ '--bar': '70%' }} /><small>Vie</small></span>
                      <span><i style={{ '--bar': '48%' }} /><small>Sáb</small></span>
                      <span><i style={{ '--bar': '76%' }} /><small>Dom</small></span>
                    </div>
                  </div>

                  <div className="mockup-card metric-card">
                    <span className="metric-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d="M6 4h12v16H6zM9 9h6M9 13h4" />
                      </svg>
                    </span>
                    <small>Tareas</small>
                    <b>Prioriza</b>
                  </div>

                  <div className="mockup-card metric-card xp-card">
                    <span className="metric-icon xp-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d="m12 3 2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8L12 3Z" />
                      </svg>
                    </span>
                    <small>XP</small>
                    <b>Avanza</b>
                  </div>

                  <div className="mockup-card wide tutor-card">
                    <span className="metric-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <rect x="5" y="7" width="14" height="11" rx="4" />
                        <path d="M12 7V4" />
                        <circle cx="9" cy="12" r="1" />
                        <circle cx="15" cy="12" r="1" />
                        <path d="M9.5 15h5" />
                      </svg>
                    </span>
                    <div>
                      <small>Tutor</small>
                      <p>Listo para resumir tus apuntes</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="hero-mini-grid" aria-label="Widgets principales de AC Edunity">
                <div className="hero-mini-card card-1">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 4.5h8a3 3 0 0 1 3 3v12H8a3 3 0 0 0-3 3v-18Z" />
                    <path d="M16 7.5h3a2 2 0 0 1 2 2v10h-5" />
                    <path d="M8 8h5" />
                    <path d="M8 12h4" />
                  </svg>
                  <h3 className="mini-title">Materias</h3>
                </div>
                <div className="hero-mini-card card-2">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="5" y="7" width="14" height="11" rx="4" />
                    <path d="M12 7V4" />
                    <circle cx="9" cy="12" r="1" />
                    <circle cx="15" cy="12" r="1" />
                    <path d="M9.5 15h5" />
                  </svg>
                  <h3 className="mini-title">Tutor</h3>
                </div>
                <div className="hero-mini-card card-3">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="4" y="5" width="16" height="15" rx="3" />
                    <path d="M8 3v4" />
                    <path d="M16 3v4" />
                    <path d="M4 10h16" />
                    <path d="M8 14h3" />
                    <path d="M13 14h3" />
                    <path d="M8 17h2" />
                  </svg>
                  <h3 className="mini-title">Calendario</h3>
                </div>
                <div className="hero-mini-card card-4">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 19h16" />
                    <path d="M7 16v-5" />
                    <path d="M12 16V7" />
                    <path d="M17 16v-8" />
                    <path d="m15 6 2-2 3 3" />
                  </svg>
                  <h3 className="mini-title">Progreso</h3>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="benefits reveal" id="features">
          <div className="benefits-heading-container">
            <span className="section-eyebrow">Funciones</span>
            <h2>Todo tu estudio organizado en un solo lugar</h2>
          </div>

          <div className="benefits-grid">
            {featureCards.map((item, index) => (
              <div key={item.title} className={`benefit-card reveal-scale delay-${index + 1}`}>
                <div className="benefit-icon" aria-hidden="true">
                  {item.icon}
                </div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <ul className="feature-list">
                  {item.list.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="about-project ai-showcase" id="ai-preview">
          <div className="about-container ai-showcase-container">
            <div className="about-text ai-copy reveal-left">
              <span className="section-eyebrow">Tutor IA</span>
              <h2>
                Tu asistente académico <span>siempre listo</span>
              </h2>
              <p className="about-description">Organiza tu estudio, resuelve dudas y comprende cada tema con apoyo inteligente.</p>
              <div className="about-features ai-feature-stack">
                <article className="about-feature reveal delay-1">
                  <span className="feature-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M5 5h14v14H5z" /><path d="M8 9h8M8 13h6M8 17h4" /></svg>
                  </span>
                  <span className="ai-feature-copy">
                    <strong>Resume apuntes</strong>
                    <small>Obtén resúmenes claros al instante.</small>
                  </span>
                </article>
                <article className="about-feature reveal delay-2">
                  <span className="feature-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M6 4h12v16H6z" /><path d="m9 9 1.5 1.5L13 8M9 14h6" /></svg>
                  </span>
                  <span className="ai-feature-copy">
                    <strong>Crea preguntas</strong>
                    <small>Genera preguntas para practicar.</small>
                  </span>
                </article>
                <article className="about-feature reveal delay-3">
                  <span className="feature-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><rect x="4" y="6" width="14" height="12" rx="2" /><path d="M8 10h6M8 14h4M18 9h2v9H8" /></svg>
                  </span>
                  <span className="ai-feature-copy">
                    <strong>Flashcards y repasos</strong>
                    <small>Crea tarjetas y repasa más fácil.</small>
                  </span>
                </article>
                <article className="about-feature reveal delay-2">
                  <span className="feature-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M9 18h6M10 22h4" /><path d="M8 14a5 5 0 1 1 8 0c-1 1-2 2-2 4h-4c0-2-1-3-2-4Z" /></svg>
                  </span>
                  <span className="ai-feature-copy">
                    <strong>Explica temas</strong>
                    <small>Entiende paso a paso cualquier tema.</small>
                  </span>
                </article>
              </div>
              <div className="ai-trust-bar reveal delay-3" aria-label="Características de confianza">
                <span>Disponible 24/7</span>
                <span>Privado</span>
                <span>Adaptado a tus materias</span>
              </div>
            </div>

            <div className="about-visual ai-panel reveal-right delay-1">
              <div className="ai-chat-shell">
                <div className="ai-orbit-card ai-card-one">
                  <span className="ai-orbit-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M6 4h12v16H6zM9 9h6M9 13h4" /></svg>
                  </span>
                  <p>
                    <strong>Preparar examen</strong>
                    <small>Preguntas por tema</small>
                  </p>
                  <svg className="ai-card-arrow" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </div>

                <div className="ai-window">
                  <div className="ai-window-top">
                    <span className="ai-status-dot" aria-hidden="true"></span>
                    <strong>Tutor AC Edunity</strong>
                    <small>En línea</small>
                  </div>
                  <div className="ai-chat-body" data-landing-tutor-demo>
                    <div className="ai-message user-message">
                      <span>Necesito repasar funciones cuadráticas.</span>
                      <span className="ai-typing-cursor" aria-hidden="true"></span>
                    </div>
                    <div className="ai-message tutor-message">
                      <strong>Tutor</strong>
                      <p>
                        <span>Te explico el concepto, te doy un ejemplo y luego practicamos con preguntas.</span>
                        <span className="ai-typing-cursor" aria-hidden="true"></span>
                      </p>
                    </div>
                    <div className="ai-tool-row" data-tutor-demo-tools aria-label="Acciones rápidas">
                      <span>Resumen</span>
                      <span>Preguntas</span>
                      <span>Flashcards</span>
                    </div>
                  </div>
                  <div className="ai-chat-input" aria-hidden="true">
                    <span>Escribe tu pregunta…</span>
                    <button type="button" tabIndex={-1} aria-label="Enviar pregunta">
                      <svg viewBox="0 0 24 24"><path d="m4 4 17 8-17 8 4-8-4-8ZM8 12h13" /></svg>
                    </button>
                  </div>
                </div>

                <div className="ai-orbit-card ai-card-two">
                  <span className="ai-orbit-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M5 5h14v14H5zM8 9h8M8 13h5" /></svg>
                  </span>
                  <p>
                    <strong>Repasar rápido</strong>
                    <small>Resumen y claves</small>
                  </p>
                  <svg className="ai-card-arrow" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="use-benefits" id="benefits-use">
          <div className="use-benefits-container">
            <span className="section-eyebrow reveal">Beneficios</span>
            <h2 className="reveal delay-1">Beneficios de usar AC Edunity</h2>
            <p className="use-benefits-intro reveal delay-2">
              Un entorno claro para organizar mejor, mantener el enfoque y avanzar con apoyo inteligente.
            </p>

            <div className="use-benefits-grid">
              {useBenefits.map((benefit, index) => (
                <div key={benefit.title} className={`use-benefit-card reveal-scale delay-${index + 1}`}>
                  <div className="use-benefit-icon">
                    {benefit.icon}
                  </div>
                  <h3>{benefit.title}</h3>
                  <p>{benefit.description}</p>
                </div>
              ))}
            </div>

            <div className="benefits-path reveal delay-3" aria-label="Proceso de estudio en AC Edunity">
              <span><b>01</b><em>Crea tus materias</em></span>
              <span><b>02</b><em>Agenda tus pendientes</em></span>
              <span><b>03</b><em>Sube apuntes</em></span>
              <span><b>04</b><em>Pregunta a la IA</em></span>
              <span><b>05</b><em>Mide tu progreso</em></span>
            </div>
          </div>
        </section>

        <section className="landing-tutorial" id="tutorial-ac-edunity" aria-labelledby="landing-tutorial-title">
          <div className="landing-tutorial-container">
            <header className="landing-tutorial-header reveal-left">
              <span className="section-eyebrow">GUÍA RÁPIDA</span>
              <h2 id="landing-tutorial-title">¿Primera vez en AC Edunity?</h2>
              <p className="landing-tutorial-description">
                Mira este tutorial y aprende paso a paso cómo crear tu cuenta, confirmar tu correo y utilizar las principales herramientas de AC Edunity.
              </p>
              <p className="landing-tutorial-note">Todo lo que necesitas para comenzar, explicado de forma sencilla.</p>
            </header>

            <div className="landing-tutorial-card reveal-right delay-1">
              <div className="landing-tutorial-video-frame">
                <video className="landing-tutorial-video" controls playsInline preload="metadata" aria-label="Tutorial de introducción a AC Edunity">
                  <source src="/assets/videos/tutorial-ac-edunity.mp4" type="video/mp4" />
                  Tu navegador no puede reproducir este video. Puedes actualizarlo para ver el tutorial de AC Edunity.
                </video>
              </div>
            </div>
          </div>
        </section>

        <footer className="landing-footer reveal">
          <p>&copy; 2026 AC Edunity. Proyecto de Grado - Gestión Educativa Inteligente Personalizada</p>
        </footer>
        </div>
      )}

      {currentPage === 'login' && (
        <div id="login-page" className="page active">
        <div className="auth-container">
          <div className="auth-bg-scene" aria-hidden="true">
            <span className="auth-star star-a"></span>
            <span className="auth-star star-b"></span>
            <span className="auth-star star-c"></span>
            <span className="auth-star star-d"></span>
            <span className="auth-star star-e"></span>
            <span className="auth-star star-f"></span>
          </div>

          <div className="auth-layout">
            <div className="auth-visual auth-study-visual">
              <div className="auth-visual-inner">
                <div className="login-intro-brand">
                  <img src="/assets/ac-edunity-logo.png" alt="Logo AC Edunity" className="login-intro-logo" width="1254" height="1254" decoding="async" />
                  <span><strong>AC</strong> Edunity</span>
                </div>
                <div className="login-intro-copy">
                  <h1><span className="login-title-line"><em>Aprende</em> mejor,</span><span className="login-title-line">cada día.</span></h1>
                  <p>Organiza tu espacio académico,<br />gestiona tus tareas y estudia<br />con ayuda inteligente.</p>
                </div>
              </div>
            </div>

            <div className="auth-card">
              <button type="button" className="auth-back-home" aria-label="Volver a la página principal" onClick={showLanding}>
                <span aria-hidden="true">←</span>
                <span>Volver al inicio</span>
              </button>

              <div className="auth-brand">
                <img src="/assets/ac-edunity-logo.png" alt="Logo AC Edunity" className="auth-brand-logo" width="1254" height="1254" decoding="async" />
              </div>

              <h2>Inicia sesión</h2>
              <p className="auth-subtitle">Bienvenido de vuelta a <strong>AC Edunity</strong></p>

              <form id="login-form" onSubmit={handleLoginSubmit} noValidate>
                <div className="form-group">
                  <label htmlFor="login-email">Correo electrónico</label>
                  <div className="auth-input-shell">
                    <span className="auth-input-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path></svg>
                    </span>
                    <input
                      type="email"
                      id="login-email"
                      placeholder="tu@correo.com"
                      required
                      value={loginValues.email}
                      onChange={(event) => updateLoginInput('email', event.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="login-password">Contraseña</label>
                  <div className="auth-input-shell auth-password-shell">
                    <span className="auth-input-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path><path d="M12 14v3"></path></svg>
                    </span>
                    <input
                      type={passwordVisibility.login ? 'text' : 'password'}
                      id="login-password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      required
                      value={loginValues.password}
                      onChange={(event) => updateLoginInput('password', event.target.value)}
                    />
                    <button type="button" className="password-toggle" data-password-toggle aria-label="Mostrar contraseña" aria-pressed={passwordVisibility.login ? 'true' : 'false'} onClick={() => togglePasswordVisibility('login')}>
                      <svg className="password-toggle-eye-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>
                      <svg className="password-toggle-eye-closed" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"></path><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.1 2.9"></path><path d="M6.1 6.1C3.5 8 2 12 2 12s3.5 6 10 6c1.6 0 3-.4 4.2-1"></path><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path></svg>
                    </button>
                  </div>
                </div>

                <div className="auth-form-options">
                  <label className="remember-option">
                    <input type="checkbox" checked={loginValues.remember} onChange={(event) => updateLoginInput('remember', event.target.checked)} />
                    <span>Recordarme</span>
                  </label>
                  <button type="button" className="forgot-password-link" onClick={() => setAuthMessage({ text: 'La recuperación de contraseña se habilitará al completar el flujo completo de autenticación.', type: 'info' })}>¿Olvidaste tu contraseña?</button>
                </div>

                {authMessage.text && currentPage === 'login' && (
                  <div className={`auth-message ${authMessage.type}`}>{authMessage.text}</div>
                )}

                <button type="submit" className="btn-primary btn-block" disabled={isSubmittingLogin}>
                  <span>{isSubmittingLogin ? 'Entrando...' : 'Iniciar sesión'}</span>
                  <span className="auth-submit-arrow" aria-hidden="true">→</span>
                </button>
              </form>

              <p className="auth-link"><span>¿No tienes cuenta?</span> <button type="button" className="auth-inline-link" onClick={showRegister}>Regístrate aquí</button></p>
              <button type="button" className="btn-secondary btn-block auth-back-button" onClick={showLanding}>← Volver</button>
            </div>
          </div>
        </div>
        </div>
      )}

      {currentPage === 'register' && (
        <div id="register-page" className="page active">
        <div className="auth-container">
          <div className="auth-bg-scene" aria-hidden="true">
            <span className="auth-star star-a"></span>
            <span className="auth-star star-b"></span>
            <span className="auth-star star-c"></span>
            <span className="auth-star star-d"></span>
            <span className="auth-star star-e"></span>
            <span className="auth-star star-f"></span>
          </div>

          <div className="auth-layout">
            <div className="auth-visual auth-study-visual">
              <div className="auth-visual-inner">
                <div className="register-intro-brand">
                  <img src="/assets/ac-edunity-logo.png" alt="Logo AC Edunity" className="register-intro-logo" width="1254" height="1254" decoding="async" />
                  <span><strong>AC</strong> Edunity</span>
                </div>
                <div className="register-intro-copy">
                  <h1><span className="register-title-line"><em>Aprende</em> mejor,</span><span className="register-title-line">cada día.</span></h1>
                  <p>Organiza tu espacio académico,<br />gestiona tus tareas y estudia<br />con ayuda inteligente.</p>
                </div>
              </div>
            </div>

            <div className="auth-card">
              <button type="button" className="btn-secondary btn-block register-back-button" onClick={showLanding}>← Volver</button>

              <div className="auth-brand">
                <img src="/assets/ac-edunity-logo.png" alt="Logo AC Edunity" className="auth-brand-logo" width="1254" height="1254" decoding="async" />
              </div>

              <h2>Crear cuenta</h2>

              <form id="register-form" onSubmit={handleRegisterSubmit} noValidate>
                <div className="form-group">
                  <label htmlFor="register-name">Nombre completo</label>
                  <div className="register-input-shell">
                    <span className="register-input-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"></circle><path d="M5 21a7 7 0 0 1 14 0"></path></svg>
                    </span>
                    <input type="text" id="register-name" name="full_name" placeholder="Adrian Lopez" autoComplete="name" required value={registerValues.name} onChange={(event) => updateRegisterInput('name', event.target.value)} />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="register-email">Correo electrónico</label>
                  <div className="register-input-shell">
                    <span className="register-input-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path></svg>
                    </span>
                    <input type="email" id="register-email" name="email" placeholder="tu@correo.com" autoComplete="email" required value={registerValues.email} onChange={(event) => updateRegisterInput('email', event.target.value)} />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="register-password">Contraseña</label>
                  <div className="register-input-shell">
                    <span className="register-input-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path><path d="M12 14v3"></path></svg>
                    </span>
                    <input type={passwordVisibility.registerPassword ? 'text' : 'password'} id="register-password" name="password" placeholder="••••••••" minLength="6" autoComplete="new-password" required value={registerValues.password} onChange={(event) => updateRegisterInput('password', event.target.value)} />
                    <button type="button" className="password-toggle" data-password-toggle aria-label="Mostrar contraseña" aria-pressed={passwordVisibility.registerPassword ? 'true' : 'false'} onClick={() => togglePasswordVisibility('registerPassword')}>
                      <svg className="password-toggle-eye-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>
                      <svg className="password-toggle-eye-closed" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"></path><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.1 2.9"></path><path d="M6.1 6.1C3.5 8 2 12 2 12s3.5 6 10 6c1.6 0 3-.4 4.2-1"></path><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path></svg>
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="register-password-confirmation">Confirmar contraseña</label>
                  <div className="register-input-shell">
                    <span className="register-input-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path><path d="m9 15 2 2 4-4"></path></svg>
                    </span>
                    <input type={passwordVisibility.registerConfirmation ? 'text' : 'password'} id="register-password-confirmation" name="password_confirmation" className="register-password-confirmation" placeholder="••••••••" minLength="6" aria-label="Confirmar contraseña" autoComplete="new-password" required value={registerValues.confirmPassword} onChange={(event) => updateRegisterInput('confirmPassword', event.target.value)} />
                    <button type="button" className="password-toggle" data-password-toggle aria-label="Mostrar contraseña" aria-pressed={passwordVisibility.registerConfirmation ? 'true' : 'false'} onClick={() => togglePasswordVisibility('registerConfirmation')}>
                      <svg className="password-toggle-eye-open" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>
                      <svg className="password-toggle-eye-closed" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"></path><path d="M10.6 6.2A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.1 2.9"></path><path d="M6.1 6.1C3.5 8 2 12 2 12s3.5 6 10 6c1.6 0 3-.4 4.2-1"></path><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path></svg>
                    </button>
                  </div>
                </div>

                {authMessage.text && currentPage === 'register' && (
                  <div className={`auth-message ${authMessage.type}`}>{authMessage.text}</div>
                )}

                <button type="submit" className="btn-primary btn-block" disabled={isSubmittingRegister}>
                  <span>{isSubmittingRegister ? 'Creando cuenta...' : 'Crear cuenta'}</span>
                  <span className="register-submit-arrow" aria-hidden="true">→</span>
                </button>
              </form>

              <p className="auth-link"><span>¿Ya tienes cuenta?</span> <button type="button" className="auth-inline-link" onClick={showLogin}>Inicia sesión aquí</button></p>
            </div>
          </div>
        </div>
        </div>
      )}
    </>
  )
}

export default App