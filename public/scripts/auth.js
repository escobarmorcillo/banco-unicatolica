// Inicio de sesión, sesión persistente, cierre de sesión y permisos visibles por rol.
// La seguridad real está en el servidor y en Supabase; aquí solo se adapta la interfaz.
(function setupAuth() {
  const NOTICE_KEY = 'novabank-aviso';
  const ROLE_LABELS = { administrador: 'Administrador', cajero: 'Cajero', cliente: 'Cliente' };
  const SESSION_MESSAGES = {
    SESION_EXPIRADA: 'Tu sesión expiró. Inicia sesión de nuevo.',
    SESION_INVALIDA: 'Tu sesión ya no es válida. Inicia sesión de nuevo.',
    SIN_SESION: 'Tu sesión terminó. Inicia sesión de nuevo.',
  };

  let supabaseClient = null;
  let currentUser = null;
  let leaving = false;

  const elements = {
    loading: document.getElementById('loading-screen'),
    login: document.getElementById('login-screen'),
    app: document.getElementById('app-shell'),
    form: document.getElementById('login-form'),
    notice: document.getElementById('login-notice'),
    submit: document.getElementById('login-submit-btn'),
  };

  function readNotice() {
    try {
      const notice = sessionStorage.getItem(NOTICE_KEY);
      sessionStorage.removeItem(NOTICE_KEY);
      return notice;
    } catch (error) {
      return null;
    }
  }

  function saveNotice(message) {
    try { sessionStorage.setItem(NOTICE_KEY, message); } catch (error) { /* sin almacenamiento */ }
  }

  function showLogin(notice) {
    elements.loading.hidden = true;
    elements.app.hidden = true;
    elements.login.hidden = false;
    elements.notice.textContent = notice || '';
    elements.notice.hidden = !notice;
    elements.form.elements.namedItem('email').focus();
  }

  // Sale de la sesión y recarga la página para no dejar datos del usuario anterior en pantalla.
  async function leave(notice) {
    if (leaving) return;
    leaving = true;
    if (notice) saveNotice(notice);
    try {
      if (supabaseClient) await supabaseClient.auth.signOut({ scope: 'local' });
    } finally {
      window.location.reload();
    }
  }

  // Muestra solo los menús y pestañas del rol y abre la primera opción disponible.
  function applyRole(user) {
    document.querySelectorAll('[data-roles]').forEach((element) => {
      element.hidden = !element.dataset.roles.split(' ').includes(user.rol);
    });
    document.getElementById('session-user-name').textContent = user.nombre_completo;
    document.getElementById('session-user-role').textContent = ROLE_LABELS[user.rol] || user.rol;

    const groups = new Set([...document.querySelectorAll('.subnav-btn')].map((button) => button.dataset.group));
    groups.forEach((group) => {
      const first = document.querySelector(`.subnav-btn[data-group="${group}"]:not([hidden])`);
      if (first) first.click();
    });
    const firstView = document.querySelector('.nav-item:not([hidden])');
    if (firstView) firstView.click();
  }

  async function enterApp() {
    currentUser = await fetchJson('/api/me');
    applyRole(currentUser);
    elements.loading.hidden = true;
    elements.login.hidden = true;
    elements.app.hidden = false;

    if (currentUser.rol === 'cliente') {
      startClientPortal();
    } else {
      startStaffApp();
      if (currentUser.rol === 'administrador') startUsersModule();
    }
  }

  function setFieldError(name, message) {
    const input = elements.form.elements.namedItem(name);
    const error = document.getElementById(input.getAttribute('aria-describedby'));
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    error.textContent = message ? `⚠ ${message}` : '';
    error.hidden = !message;
  }

  async function handleLogin(event) {
    event.preventDefault();
    const email = elements.form.elements.namedItem('email').value.trim();
    const password = elements.form.elements.namedItem('password').value;
    setFieldError('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? '' : 'Escribe un correo válido.');
    setFieldError('password', password ? '' : 'Escribe tu contraseña.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) return;

    elements.submit.disabled = true;
    elements.submit.textContent = 'Ingresando…';
    elements.notice.hidden = true;
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) {
        const invalid = error.code === 'invalid_credentials' || /invalid login/i.test(error.message);
        showMessage(invalid ? 'Correo o contraseña incorrectos.' : 'No fue posible iniciar sesión. Inténtalo de nuevo.', 'error');
        return;
      }
      elements.form.reset();
      await enterApp();
    } catch (error) {
      if (!error.sessionError) showMessage(error.message, 'error');
    } finally {
      elements.submit.disabled = false;
      elements.submit.textContent = 'Ingresar';
    }
  }

  window.NovaAuth = {
    get user() {
      return currentUser;
    },
    // Devuelve el token vigente; Supabase lo renueva automáticamente si está por vencer.
    async getToken() {
      if (!supabaseClient) return null;
      const { data } = await supabaseClient.auth.getSession();
      return data.session ? data.session.access_token : null;
    },
    handleUnauthorized(data = {}) {
      const message = data.code === 'SIN_ACCESO' ? data.error : (SESSION_MESSAGES[data.code] || SESSION_MESSAGES.SIN_SESION);
      leave(message);
    },
  };

  async function boot() {
    elements.form.addEventListener('submit', handleLogin);
    document.getElementById('logout-btn').addEventListener('click', () => leave('Cerraste sesión correctamente.'));
    const notice = readNotice();

    let config;
    try {
      const response = await fetch('/api/config');
      config = await response.json();
      if (!response.ok) throw new Error(config.error);
    } catch (error) {
      showLogin('El inicio de sesión no está disponible en este momento. Contacta al administrador.');
      elements.submit.disabled = true;
      return;
    }

    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    supabaseClient.auth.onAuthStateChange((event) => {
      // Si la sesión se cierra en otra pestaña o no se pudo renovar.
      if (event === 'SIGNED_OUT' && currentUser) leave(SESSION_MESSAGES.SIN_SESION);
    });

    const { data } = await supabaseClient.auth.getSession();
    if (!data.session) {
      showLogin(notice);
      return;
    }
    try {
      await enterApp();
    } catch (error) {
      if (!error.sessionError) showLogin(error.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
