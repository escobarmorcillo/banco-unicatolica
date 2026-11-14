// Gestión de usuarios (solo administrador): crear, consultar, inactivar y activar.
const ROLE_NAMES = { administrador: 'Administrador', cajero: 'Cajero', cliente: 'Cliente' };
let usersModuleStarted = false;

function renderUserTable(rows = []) {
  const tableBody = document.getElementById('user-table-body');
  if (!rows.length) {
    tableBody.innerHTML = '<tr><td colspan="6">No hay usuarios registrados.</td></tr>';
    return;
  }
  const currentId = window.NovaAuth.user && window.NovaAuth.user.id;
  tableBody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.email)}</td>
      <td>${escapeHtml(row.nombre_completo)}</td>
      <td>${escapeHtml(ROLE_NAMES[row.rol] || row.rol)}</td>
      <td>${escapeHtml(row.documento_cliente || '—')}</td>
      <td><span class="badge ${row.activo ? 'active' : 'inactive'}">${row.activo ? 'activo' : 'inactivo'}</span></td>
      <td>
        ${row.id === currentId
          ? '<span class="muted-text">Tu usuario</span>'
          : `<button type="button" class="action-link" data-user-toggle="${escapeHtml(row.id)}" data-user-active="${row.activo}">${row.activo ? 'Inactivar' : 'Activar'}</button>`}
      </td>
    </tr>
  `).join('');
}

async function loadUsers() {
  try {
    renderUserTable(await fetchJson('/api/users'));
  } catch (error) {
    if (!error.sessionError) showMessage(error.message, 'error');
  }
}

function updateUserFormForRole() {
  const isCustomer = document.getElementById('user-role-select').value === 'cliente';
  document.getElementById('user-customer-field').hidden = !isCustomer;
  document.getElementById('user-name-field').hidden = isCustomer;
}

async function handleUserSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  if (data.rol === 'cliente') delete data.nombre_completo;
  else delete data.documento_cliente;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email || '')) {
    showMessage('Escribe un correo electrónico válido.', 'error');
    return;
  }
  if ((data.password || '').length < 8) {
    showMessage('La contraseña inicial debe tener al menos 8 caracteres.', 'error');
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const result = await fetchJson('/api/users', { method: 'POST', body: JSON.stringify(data) });
    showMessage(result.message, 'success');
    form.reset();
    updateUserFormForRole();
    loadUsers();
  } catch (error) {
    if (!error.sessionError) showMessage(error.message, 'error');
  } finally {
    submitButton.disabled = false;
  }
}

async function handleUserToggle(event) {
  const button = event.target.closest('[data-user-toggle]');
  if (!button) return;
  const action = button.dataset.userActive === 'true' ? 'inactivate' : 'activate';
  button.disabled = true;
  try {
    const result = await fetchJson(`/api/users/${encodeURIComponent(button.dataset.userToggle)}/${action}`, { method: 'POST' });
    showMessage(result.message, 'success');
    loadUsers();
  } catch (error) {
    button.disabled = false;
    if (!error.sessionError) showMessage(error.message, 'error');
  }
}

// La llama auth.js cuando inicia sesión un administrador.
function startUsersModule() {
  if (!usersModuleStarted) {
    usersModuleStarted = true;
    const form = document.getElementById('user-form');
    form.addEventListener('submit', handleUserSubmit);
    form.addEventListener('reset', () => setTimeout(updateUserFormForRole));
    document.getElementById('user-role-select').addEventListener('change', updateUserFormForRole);
    document.getElementById('user-table-body').addEventListener('click', handleUserToggle);
    updateUserFormForRole();
  }
  loadUsers();
}
