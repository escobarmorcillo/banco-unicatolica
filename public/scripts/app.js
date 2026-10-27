const state = {
  customers: [],
  accounts: [],
  transactions: [],
};

const messageBox = document.getElementById('message-box');
const restrictedCustomerInputs = new WeakSet();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function showMessage(message, type = 'success') {
  if (!messageBox) return;
  messageBox.textContent = message;
  messageBox.className = `message-box ${type}`;
  clearTimeout(showMessage.timeoutId);
  showMessage.timeoutId = setTimeout(() => {
    messageBox.className = 'message-box hidden';
  }, 3500);
}

function formatCurrency(value) {
  const cents = Number(value || 0);
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function renderCustomerTable(rows = []) {
  const tableBody = document.getElementById('customer-table-body');
  if (!tableBody) return;

  if (!rows.length) {
    tableBody.innerHTML = '<tr><td colspan="6">No se encontraron resultados.</td></tr>';
    return;
  }

  tableBody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.documento)}</td>
      <td>${escapeHtml(row.nombres)}</td>
      <td>${escapeHtml(row.apellidos)}</td>
      <td>${escapeHtml(row.telefono)}</td>
      <td><span class="badge ${row.estado === 'activo' ? 'active' : 'inactive'}">${escapeHtml(row.estado)}</span></td>
      <td>
        <div class="row-actions">
          <button type="button" class="action-link" data-customer-edit="${escapeHtml(row.id)}">Actualizar</button>
          <button type="button" class="action-link" data-customer-inactivate="${escapeHtml(row.id)}">Inactivar</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderAccountTable(rows = []) {
  const tableBody = document.getElementById('account-table-body');
  if (!tableBody) return;

  if (!rows.length) {
    tableBody.innerHTML = '<tr><td colspan="6">No se encontraron resultados.</td></tr>';
    return;
  }

  tableBody.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.numero_cuenta)}</td>
      <td>${escapeHtml(row.tipo_cuenta)}</td>
      <td>${escapeHtml(row.cliente || `${row.nombres} ${row.apellidos}`)}</td>
      <td>${formatCurrency(row.saldo)}</td>
      <td><span class="badge ${row.estado === 'activo' ? 'active' : 'inactive'}">${row.estado}</span></td>
      <td>
        <div class="row-actions">
          <button type="button" class="action-link" data-account-edit="${escapeHtml(row.id)}">Actualizar</button>
          <button type="button" class="action-link" data-account-inactivate="${escapeHtml(row.id)}">Inactivar</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderTransactionTable(rows = []) {
  const tableBody = document.getElementById('transaction-table-body');
  if (!tableBody) return;

  if (!rows.length) {
    tableBody.innerHTML = '<tr><td colspan="4">No se encontraron transacciones.</td></tr>';
    return;
  }

  tableBody.innerHTML = rows.map((row) => `
    <tr>
      <td>${new Date(row.fecha_hora).toLocaleString('es-CO')}</td>
      <td>${escapeHtml(row.tipo_transaccion)}</td>
      <td>${formatCurrency(row.monto)}</td>
      <td>${formatCurrency(row.saldo_resultante)}</td>
    </tr>
  `).join('');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = { error: 'Respuesta inválida del servidor.' };
  }

  if (!response.ok) {
    throw new Error(data.error || 'Error en la operación');
  }

  return data;
}

async function loadCustomers(searchTerm = '') {
  try {
    const result = await fetchJson(`/api/customers${searchTerm ? `?document=${encodeURIComponent(searchTerm)}` : ''}`);
    state.customers = result;
    renderCustomerTable(result);
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function loadAccounts(searchTerm = '') {
  try {
    const params = new URLSearchParams();
    if (searchTerm) params.set('search', searchTerm);
    const result = await fetchJson(`/api/accounts?${params.toString()}`);
    state.accounts = result;
    renderAccountTable(result);
    loadCustomerSelects();
    loadAccountSelects();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function loadTransactions(accountNumber = '') {
  try {
    const params = new URLSearchParams();
    if (accountNumber) params.set('accountNumber', accountNumber);
    const result = await fetchJson(`/api/transactions?${params.toString()}`);
    state.transactions = result;
    renderTransactionTable(result);
    const account = state.accounts.find((item) => item.numero_cuenta === accountNumber);
    document.getElementById('history-current-balance').textContent = accountNumber && account
      ? formatCurrency(account.saldo)
      : '—';
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function loadCustomerSelects() {
  const options = document.getElementById('customer-options');
  if (!options) return;
  try {
    const customers = await fetchJson('/api/customers');
    state.customers = customers;
    options.innerHTML = customers
      .filter((customer) => customer.estado === 'activo')
      .map((customer) => `<option value="${escapeHtml(customer.documento)}">${escapeHtml(`${customer.nombres} ${customer.apellidos}`)}</option>`)
      .join('');
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function loadAccountSelects() {
  const options = document.getElementById('account-options');
  if (!options) return;
  try {
    const accounts = await fetchJson('/api/accounts');
    state.accounts = accounts;
    options.innerHTML = accounts
      .filter((account) => account.estado === 'activo')
      .map((account) => `<option value="${escapeHtml(account.numero_cuenta)}">${escapeHtml(account.tipo_cuenta)}</option>`)
      .join('');
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function findCustomerByDocument(documento) {
  const customers = await fetchJson(`/api/customers?document=${encodeURIComponent(documento)}`);
  return customers.find((customer) => customer.documento === documento);
}

async function findAccountByNumber(numero) {
  const accounts = await fetchJson(`/api/accounts?number=${encodeURIComponent(numero)}`);
  return accounts.find((account) => account.numero_cuenta === numero);
}

async function lookupAccountForCreate() {
  const documento = document.getElementById('account-customer-search').value.trim();
  const idInput = document.getElementById('account-customer-id');
  const selected = document.getElementById('account-customer-selected');
  idInput.value = '';
  selected.textContent = '';
  if (!documento) {
    showMessage('Ingrese el documento del cliente.', 'error');
    return;
  }

  try {
    const customer = await findCustomerByDocument(documento);
    if (!customer || customer.estado !== 'activo') {
      showMessage('No se encontró un cliente activo con ese documento.', 'error');
      return;
    }
    idInput.value = customer.id;
    selected.textContent = `${customer.nombres} ${customer.apellidos}`;
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

function updateTransactionPreview(type) {
  const isWithdrawal = type === 'withdraw';
  const form = document.getElementById(isWithdrawal ? 'transaction-withdraw-form' : 'transaction-form');
  const accountId = form.querySelector('[name="account_id"]').value;
  const amount = Number(form.querySelector('[name="amount"]').value || 0);
  const account = state.accounts.find((item) => String(item.id) === String(accountId));
  const current = account ? Number(account.saldo) : null;
  const result = current === null || !Number.isFinite(amount) || amount <= 0
    ? null
    : current + Math.round((isWithdrawal ? -1 : 1) * amount * 100);

  document.getElementById(`${type}-current-balance`).textContent = current === null ? '—' : formatCurrency(current);
  document.getElementById(`${type}-final-balance`).textContent = result === null ? '—' : formatCurrency(result);
}

async function lookupTransactionAccount(type) {
  const isWithdrawal = type === 'withdraw';
  const search = document.getElementById(isWithdrawal ? 'transaction-account-search-withdraw' : 'transaction-account-search');
  const hidden = document.getElementById(isWithdrawal ? 'transaction-account-id-withdraw' : 'transaction-account-id');
  const number = search.value.trim();
  hidden.value = '';
  if (!number) {
    updateTransactionPreview(type);
    showMessage('Ingrese el número de cuenta.', 'error');
    return;
  }

  try {
    let account = state.accounts.find((item) => item.numero_cuenta === number);
    if (!account) account = await findAccountByNumber(number);
    if (!account || account.estado !== 'activo') {
      updateTransactionPreview(type);
      showMessage('No se encontró una cuenta activa con ese número.', 'error');
      return;
    }
    state.accounts = [...state.accounts.filter((item) => String(item.id) !== String(account.id)), account];
    hidden.value = account.id;
    updateTransactionPreview(type);
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function lookupCustomerForUpdate() {
  const documento = document.getElementById('customer-update-client').value.trim();
  if (!documento) {
    showMessage('Ingrese el documento del cliente.', 'error');
    return;
  }
  try {
    const customer = await findCustomerByDocument(documento);
    if (!customer) {
      showMessage('No existe un cliente con ese documento.', 'error');
      return;
    }
    const form = document.getElementById('customer-update-form');
    form.dataset.customerId = customer.id;
    document.getElementById('customer-update-documento').value = customer.documento;
    document.getElementById('customer-update-telefono').value = customer.telefono;
    document.getElementById('customer-update-nombres').value = customer.nombres;
    document.getElementById('customer-update-apellidos').value = customer.apellidos;
    document.getElementById('customer-update-correo').value = customer.correo;
    document.getElementById('customer-update-direccion').value = customer.direccion;
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function lookupCustomerForInactivation() {
  const documento = document.getElementById('customer-inactive-doc').value.trim();
  if (!documento) {
    showMessage('Ingrese el documento del cliente.', 'error');
    return;
  }
  try {
    const customer = await findCustomerByDocument(documento);
    if (!customer) {
      showMessage('No existe un cliente con ese documento.', 'error');
      return;
    }
    const accounts = await fetchJson(`/api/accounts?customerId=${encodeURIComponent(customer.id)}`);
    document.getElementById('customer-inactive-form').dataset.customerId = customer.id;
    document.getElementById('customer-inactive-documento').value = customer.documento;
    document.getElementById('customer-inactive-nombres').value = `${customer.nombres} ${customer.apellidos}`;
    document.getElementById('customer-inactive-accounts').value = accounts.filter((account) => account.estado === 'activo').length;
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function lookupAccountForUpdate() {
  const number = document.getElementById('account-update-number').value.trim();
  if (!number) {
    showMessage('Ingrese el número de cuenta.', 'error');
    return;
  }
  try {
    const account = await findAccountByNumber(number);
    if (!account) {
      showMessage('No existe una cuenta con ese número.', 'error');
      return;
    }
    const form = document.getElementById('account-update-form');
    form.dataset.accountId = account.id;
    document.getElementById('account-update-cuenta').value = account.numero_cuenta;
    document.getElementById('account-update-saldo').value = formatCurrency(account.saldo);
    document.getElementById('account-update-estado').value = account.estado;
    document.getElementById('account-update-tipo').value = account.tipo_cuenta;
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function lookupAccountForInactivation() {
  const number = document.getElementById('account-inactive-number').value.trim();
  if (!number) {
    showMessage('Ingrese el número de cuenta.', 'error');
    return;
  }
  try {
    const account = await findAccountByNumber(number);
    if (!account) {
      showMessage('No existe una cuenta con ese número.', 'error');
      return;
    }
    const form = document.getElementById('account-inactive-form');
    form.dataset.accountId = account.id;
    document.getElementById('account-inactive-num').value = account.numero_cuenta;
    document.getElementById('account-inactive-cliente').value = account.cliente;
    document.getElementById('account-inactive-saldo').value = formatCurrency(account.saldo);
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

function setupNavigation() {
  const navButtons = document.querySelectorAll('.nav-item');
  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.view;
      navButtons.forEach((btn) => btn.classList.toggle('active', btn === button));
      document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === target));
    });
  });

  const subnavButtons = document.querySelectorAll('.subnav-btn');
  subnavButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const group = button.dataset.group;
      const target = button.dataset.submodule;
      const groupButtons = document.querySelectorAll(`.subnav-btn[data-group="${group}"]`);
      groupButtons.forEach((btn) => btn.classList.toggle('active', btn === button));
      document.querySelectorAll(`.tab-panel[data-group="${group}"]`).forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.submodulePanel === target);
      });
      const description = document.querySelector(`[data-page-description="${group}"]`);
      const activePanel = document.querySelector(`.tab-panel[data-group="${group}"][data-submodule-panel="${target}"]`);
      if (description && activePanel) description.textContent = activePanel.dataset.description;
    });
  });
}

async function handleCustomerSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!validateCustomerForm(form)) return;
  const data = Object.fromEntries(new FormData(form).entries());

  const isEditMode = form.dataset.mode === 'edit';
  const id = form.dataset.customerId;

  try {
    const result = isEditMode && id
      ? await fetchJson(`/api/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) })
      : await fetchJson('/api/customers', { method: 'POST', body: JSON.stringify(data) });

    showMessage(result.message || (isEditMode ? 'Cliente actualizado' : 'Cliente registrado'), 'success');
    resetCustomerForm();
    loadCustomers();
    loadCustomerSelects();
  } catch (error) {
    if (/documento ya existe|documento ya está registrado/i.test(error.message)) {
      const documentInput = form.elements.namedItem('documento');
      setCustomerFieldError(documentInput, 'Este documento ya está registrado. Verifica el número e inténtalo nuevamente.');
      documentInput.focus();
    }
    showMessage(error.message, 'error');
  }
}

function setCustomerFieldError(input, message = '') {
  const error = document.getElementById(input.getAttribute('aria-describedby'));
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  if (error) {
    error.textContent = message ? `⚠ ${message}` : '';
    error.hidden = !message;
  }
}

function validateCustomerForm(form) {
  const fields = [
    { name: 'documento', message: 'Ingresa un documento de máximo 10 números.', validate: (value) => /^\d{1,10}$/.test(value) },
    { name: 'nombres', message: 'Escribe los nombres usando solo letras y espacios.', validate: (value) => /^[\p{L}]+(?: +[\p{L}]+)*$/u.test(value) },
    { name: 'apellidos', message: 'Escribe los apellidos usando solo letras y espacios.', validate: (value) => /^[\p{L}]+(?: +[\p{L}]+)*$/u.test(value) },
    { name: 'fecha_nacimiento', message: 'El cliente debe tener mínimo 15 años. Verifica la fecha de nacimiento.', validate: isAtLeastFifteen },
    { name: 'telefono', message: 'Completa los 10 números del teléfono.', validate: (value) => /^\d{10}$/.test(value) },
    { name: 'correo', message: 'Escribe un correo válido, por ejemplo nombre@dominio.com.', validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) },
    { name: 'direccion', message: 'Completa la dirección del cliente.', validate: (value) => value.length >= 2 },
  ];

  return validateCustomerFields(form, fields);
}

function validateCustomerUpdateForm(form) {
  return validateCustomerFields(form, [
    { name: 'documento', message: 'Ingresa un documento de máximo 10 números.', validate: (value) => /^\d{1,10}$/.test(value) },
    { name: 'telefono', message: 'Completa los 10 números del teléfono.', validate: (value) => /^\d{10}$/.test(value) },
    { name: 'nombres', message: 'Escribe los nombres usando solo letras y espacios.', validate: (value) => /^[\p{L}]+(?: +[\p{L}]+)*$/u.test(value) },
    { name: 'apellidos', message: 'Escribe los apellidos usando solo letras y espacios.', validate: (value) => /^[\p{L}]+(?: +[\p{L}]+)*$/u.test(value) },
    { name: 'correo', message: 'Escribe un correo válido, por ejemplo nombre@dominio.com.', validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) },
    { name: 'direccion', message: 'Completa la dirección del cliente.', validate: (value) => value.length >= 2 },
  ]);
}

function validateCustomerFields(form, fields) {
  let firstInvalid = null;
  fields.forEach(({ name, message, validate }) => {
    const input = form.elements.namedItem(name);
    if (!input) return;
    const value = input.value.trim();
    const valid = validate(value);
    setCustomerFieldError(input, valid ? '' : message);
    if (!valid && !firstInvalid) firstInvalid = input;
  });

  if (firstInvalid) {
    showMessage('Revisa el campo señalado y corrige la información.', 'error');
    firstInvalid.focus();
    return false;
  }
  return true;
}

function isAtLeastFifteen(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (birthDate.getUTCFullYear() !== year || birthDate.getUTCMonth() !== month - 1 || birthDate.getUTCDate() !== day) return false;
  const today = new Date();
  const cutoff = new Date(Date.UTC(today.getUTCFullYear() - 15, today.getUTCMonth(), today.getUTCDate()));
  return birthDate <= cutoff;
}

function setupCustomerFieldValidation(form) {
  form.querySelectorAll('[data-customer-digits], [data-customer-letters]').forEach(setupRestrictedCustomerInput);

  form.querySelectorAll('[aria-describedby]').forEach((input) => {
    input.addEventListener('input', () => setCustomerFieldError(input));
    input.addEventListener('change', () => setCustomerFieldError(input));
  });

  const birthDateInput = form.elements.namedItem('fecha_nacimiento');
  if (!birthDateInput) return;
  const today = new Date();
  birthDateInput.max = `${today.getUTCFullYear() - 15}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
}

function setupRestrictedCustomerInput(input) {
  if (restrictedCustomerInputs.has(input)) return;
  restrictedCustomerInputs.add(input);

  const isDigits = input.hasAttribute('data-customer-digits');
  const limit = input.maxLength > 0 ? input.maxLength : null;
  const rule = isDigits
    ? { pattern: /^\d*$/, limit, description: 'números' }
    : { pattern: /^[\p{L} ]*$/u, description: 'letras y espacios' };

  input.addEventListener('beforeinput', (event) => {
    if (!event.inputType.startsWith('insert')) return;
    const inserted = event.data !== null
      ? event.data
      : event.dataTransfer ? event.dataTransfer.getData('text') : '';
    if (!inserted) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const candidate = input.value.slice(0, start) + inserted + input.value.slice(end);
    if (!rule.pattern.test(candidate)) {
      event.preventDefault();
      showMessage(`¡Atención! Escribe únicamente ${rule.description}.`, 'error');
    } else if (rule.limit && candidate.length > rule.limit) {
      event.preventDefault();
      showMessage(`¡Atención! El máximo es de ${rule.limit} números.`, 'error');
    }
  });

  input.addEventListener('input', () => {
    let sanitized = input.value;
    if (isDigits) {
      sanitized = sanitized.replace(/\D/g, '');
      if (rule.limit) sanitized = sanitized.slice(0, rule.limit);
    }
    else sanitized = Array.from(sanitized).filter((character) => /[\p{L} ]/u.test(character)).join('');
    if (sanitized !== input.value) {
      input.value = sanitized;
      showMessage(`¡Atención! Escribe únicamente ${rule.description}${rule.limit ? ` (máximo ${rule.limit})` : ''}.`, 'error');
    }
    setCustomerFieldError(input);
  });
}

function clearCustomerFieldErrors(form) {
  form.querySelectorAll('[aria-describedby]').forEach((input) => setCustomerFieldError(input));
}

function setupMoneyInput(input) {
  input.addEventListener('beforeinput', (event) => {
    if (!event.inputType.startsWith('insert') || event.data === null) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const candidate = input.value.slice(0, start) + event.data + input.value.slice(end);
    if (!/^\d*(?:[.,]\d{0,2})?$/.test(candidate)) {
      event.preventDefault();
      showMessage('¡Atención! Escribe un monto usando números y máximo dos decimales.', 'error');
    }
  });

  input.addEventListener('input', () => {
    const original = input.value;
    const cleaned = original.replace(/[^\d.,]/g, '').replace(/,/g, '.');
    const separator = cleaned.indexOf('.');
    const normalized = separator === -1
      ? cleaned
      : `${cleaned.slice(0, separator)}.${cleaned.slice(separator + 1).replace(/\./g, '').slice(0, 2)}`;
    if (normalized !== original) {
      input.value = normalized;
      showMessage('¡Atención! Escribe un monto usando números y máximo dos decimales.', 'error');
    }
    setCustomerFieldError(input);
  });
}

function isValidMoney(value, allowZero = false) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return false;
  const amount = Number(value);
  return Number.isFinite(amount) && (allowZero ? amount >= 0 : amount > 0)
    && Number.isSafeInteger(Math.round(amount * 100));
}

function resetCustomerForm() {
  const form = document.getElementById('customer-form');
  if (!form) return;
  form.reset();
  form.querySelectorAll('[aria-invalid]').forEach((input) => setCustomerFieldError(input));
  delete form.dataset.customerId;
  form.dataset.mode = 'create';
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.textContent = 'Guardar cliente';
}

async function handleAccountSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const customerSearch = document.getElementById('account-customer-search');
  const accountNumber = form.elements.namedItem('numero_cuenta');
  const openingBalance = form.elements.namedItem('saldo_inicial');
  if (!document.getElementById('account-customer-id').value) {
    showMessage('Busca y selecciona un cliente titular antes de crear la cuenta.', 'error');
    customerSearch.focus();
    return;
  }
  if (!/^\d+$/.test(accountNumber.value.trim())) {
    setCustomerFieldError(accountNumber, 'El número de cuenta solo permite números.');
    accountNumber.focus();
    showMessage('¡Atención! Escribe únicamente números en el número de cuenta.', 'error');
    return;
  }
  setCustomerFieldError(accountNumber);
  if (!isValidMoney(openingBalance.value.trim().replace(',', '.'), true)) {
    setCustomerFieldError(openingBalance, 'Ingresa un saldo válido con máximo dos decimales; no puede ser negativo.');
    openingBalance.focus();
    showMessage('Revisa el saldo inicial antes de crear la cuenta.', 'error');
    return;
  }
  setCustomerFieldError(openingBalance);
  const data = Object.fromEntries(new FormData(form).entries());
  data.saldo_inicial = openingBalance.value.trim().replace(',', '.');
  const isEditMode = form.dataset.mode === 'edit';
  const id = form.dataset.accountId;

  try {
    const result = isEditMode && id
      ? await fetchJson(`/api/accounts/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ tipo_cuenta: data.tipo_cuenta, estado: data.estado || 'activo' }),
        })
      : await fetchJson('/api/accounts', { method: 'POST', body: JSON.stringify(data) });

    showMessage(result.message || (isEditMode ? 'Cuenta actualizada' : 'Cuenta creada'), 'success');
    resetAccountForm();
    loadAccounts();
    loadAccountSelects();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

function resetAccountForm() {
  const form = document.getElementById('account-form');
  if (!form) return;
  form.reset();
  delete form.dataset.accountId;
  form.dataset.mode = 'create';
  document.getElementById('account-customer-selected').textContent = '';
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) submitButton.textContent = 'Crear cuenta';
}

async function handleTransactionSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const amountInput = form.elements.namedItem('amount');
  const accountSearch = form.querySelector('[id^="transaction-account-search"]');
  const accountId = form.querySelector('[name="account_id"]');
  if (!accountId.value) {
    showMessage('Busca y selecciona una cuenta activa antes de continuar.', 'error');
    accountSearch.focus();
    return;
  }
  const amount = amountInput.value.trim().replace(',', '.');
  if (!isValidMoney(amount)) {
    setCustomerFieldError(amountInput, 'Ingresa un monto mayor que cero con máximo dos decimales.');
    amountInput.focus();
    showMessage('Revisa el monto. Debe ser mayor que cero y tener máximo dos decimales.', 'error');
    return;
  }
  setCustomerFieldError(amountInput);
  const data = Object.fromEntries(new FormData(form).entries());
  data.amount = amount;
  const type = event.submitter && event.submitter.dataset.transaction;

  try {
    const result = await fetchJson(type === 'withdraw' ? '/api/transactions/withdraw' : '/api/transactions/deposit', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    showMessage(result.message || 'Operación registrada', 'success');
    form.reset();
    updateTransactionPreview(type === 'withdraw' ? 'withdraw' : 'deposit');
    loadAccounts();
    loadTransactions();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function saveCustomerUpdate() {
  const form = document.getElementById('customer-update-form');
  if (!form.dataset.customerId) {
    showMessage('Primero busca el cliente que deseas actualizar.', 'error');
    return;
  }
  if (!validateCustomerUpdateForm(form)) return;
  const data = {
    documento: document.getElementById('customer-update-documento').value.trim(),
    telefono: document.getElementById('customer-update-telefono').value.trim(),
    nombres: document.getElementById('customer-update-nombres').value.trim(),
    apellidos: document.getElementById('customer-update-apellidos').value.trim(),
    correo: document.getElementById('customer-update-correo').value.trim(),
    direccion: document.getElementById('customer-update-direccion').value.trim(),
  };
  try {
    const result = await fetchJson(`/api/customers/${form.dataset.customerId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    showMessage(result.message, 'success');
    delete form.dataset.customerId;
    form.reset();
    clearCustomerFieldErrors(form);
    loadCustomers();
    loadCustomerSelects();
  } catch (error) {
    if (/documento ya existe|documento ya está registrado/i.test(error.message)) {
      const documentInput = document.getElementById('customer-update-documento');
      setCustomerFieldError(documentInput, 'Este documento ya está registrado. Verifica el número e inténtalo nuevamente.');
      documentInput.focus();
    }
    showMessage(error.message, 'error');
  }
}

async function confirmCustomerInactivation() {
  const form = document.getElementById('customer-inactive-form');
  if (!form.dataset.customerId) {
    showMessage('Primero busca el cliente que deseas inactivar.', 'error');
    return;
  }
  try {
    const result = await fetchJson(`/api/customers/${form.dataset.customerId}/inactivate`, { method: 'POST' });
    showMessage(result.message, 'success');
    delete form.dataset.customerId;
    form.reset();
    loadCustomers();
    loadCustomerSelects();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function saveAccountUpdate() {
  const form = document.getElementById('account-update-form');
  if (!form.dataset.accountId) {
    showMessage('Primero busca la cuenta que deseas actualizar.', 'error');
    return;
  }
  try {
    const result = await fetchJson(`/api/accounts/${form.dataset.accountId}`, {
      method: 'PUT',
      body: JSON.stringify({
        tipo_cuenta: document.getElementById('account-update-tipo').value,
        estado: document.getElementById('account-update-estado').value,
      }),
    });
    showMessage(result.message, 'success');
    delete form.dataset.accountId;
    form.reset();
    loadAccounts();
    loadAccountSelects();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function confirmAccountInactivation() {
  const form = document.getElementById('account-inactive-form');
  if (!form.dataset.accountId) {
    showMessage('Primero busca la cuenta que deseas inactivar.', 'error');
    return;
  }
  try {
    const result = await fetchJson(`/api/accounts/${form.dataset.accountId}/inactivate`, { method: 'POST' });
    showMessage(result.message, 'success');
    delete form.dataset.accountId;
    form.reset();
    loadAccounts();
    loadAccountSelects();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

document.addEventListener('click', async (event) => {
  const customerEdit = event.target.closest('[data-customer-edit]');
  if (customerEdit) {
    const customer = state.customers.find((c) => String(c.id) === customerEdit.dataset.customerEdit);
    if (!customer) return;
    const form = document.getElementById('customer-form');
    form.dataset.mode = 'edit';
    form.dataset.customerId = customer.id;
    form.querySelector('[name="tipo_documento"]').value = customer.tipo_documento;
    form.querySelector('[name="documento"]').value = customer.documento;
    form.querySelector('[name="nombres"]').value = customer.nombres;
    form.querySelector('[name="apellidos"]').value = customer.apellidos;
    form.querySelector('[name="fecha_nacimiento"]').value = customer.fecha_nacimiento;
    form.querySelector('[name="telefono"]').value = customer.telefono;
    form.querySelector('[name="correo"]').value = customer.correo;
    form.querySelector('[name="direccion"]').value = customer.direccion;
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.textContent = 'Guardar cambios';
    return;
  }

  const inactivateCustomer = event.target.closest('[data-customer-inactivate]');
  if (inactivateCustomer) {
    const id = Number(inactivateCustomer.dataset.customerInactivate);
    try {
      const result = await fetchJson(`/api/customers/${id}/inactivate`, { method: 'POST' });
      showMessage(result.message, 'success');
      loadCustomers();
      loadCustomerSelects();
    } catch (error) {
      showMessage(error.message, 'error');
    }
    return;
  }

  const accountEdit = event.target.closest('[data-account-edit]');
  if (accountEdit) {
    const account = state.accounts.find((a) => String(a.id) === accountEdit.dataset.accountEdit);
    if (!account) return;
    const form = document.getElementById('account-form');
    form.dataset.mode = 'edit';
    form.dataset.accountId = account.id;
    form.querySelector('[name="cliente_id"]').value = account.cliente_id;
    document.getElementById('account-customer-search').value = account.documento || '';
    document.getElementById('account-customer-selected').textContent = account.cliente || '';
    form.querySelector('[name="tipo_cuenta"]').value = account.tipo_cuenta;
    form.querySelector('[name="numero_cuenta"]').value = account.numero_cuenta;
    form.querySelector('[name="saldo_inicial"]').value = account.saldo / 100;
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.textContent = 'Actualizar cuenta';
    return;
  }

  const accountInactivate = event.target.closest('[data-account-inactivate]');
  if (accountInactivate) {
    const id = Number(accountInactivate.dataset.accountInactivate);
    try {
      const result = await fetchJson(`/api/accounts/${id}/inactivate`, { method: 'POST' });
      showMessage(result.message, 'success');
      loadAccounts();
      loadAccountSelects();
    } catch (error) {
      showMessage(error.message, 'error');
    }
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  const customerForm = document.getElementById('customer-form');
  const accountForm = document.getElementById('account-form');
  const transactionForm = document.getElementById('transaction-form');
  const transactionWithdrawForm = document.getElementById('transaction-withdraw-form');

  customerForm.dataset.mode = 'create';
  accountForm.dataset.mode = 'create';

  setupCustomerFieldValidation(customerForm);
  const customerUpdateForm = document.getElementById('customer-update-form');
  setupCustomerFieldValidation(customerUpdateForm);
  document.querySelectorAll('[data-customer-digits], [data-customer-letters]').forEach(setupRestrictedCustomerInput);
  document.querySelectorAll('[data-money]').forEach(setupMoneyInput);
  customerForm.addEventListener('submit', handleCustomerSubmit);
  accountForm.addEventListener('submit', handleAccountSubmit);
  transactionForm.addEventListener('submit', handleTransactionSubmit);
  transactionWithdrawForm.addEventListener('submit', handleTransactionSubmit);

  document.getElementById('customer-search-btn').addEventListener('click', () => {
    const value = document.getElementById('customer-search-input').value.trim();
    loadCustomers(value);
  });

  document.getElementById('account-search-btn').addEventListener('click', () => {
    const value = document.getElementById('account-search-input').value.trim();
    loadAccounts(value);
  });

  document.getElementById('transaction-search-btn').addEventListener('click', () => {
    const value = document.getElementById('transaction-search-input').value.trim();
    const account = state.accounts.find((item) => item.numero_cuenta === value);
    document.getElementById('history-current-balance').textContent = account ? formatCurrency(account.saldo) : '—';
    loadTransactions(value);
  });

  document.getElementById('account-customer-search-btn').addEventListener('click', lookupAccountForCreate);
  document.getElementById('account-customer-search').addEventListener('input', () => {
    document.getElementById('account-customer-id').value = '';
    document.getElementById('account-customer-selected').textContent = '';
  });
  document.querySelectorAll('[data-account-lookup]').forEach((button) => {
    button.addEventListener('click', () => lookupTransactionAccount(button.dataset.accountLookup));
  });
  document.getElementById('transaction-account-search').addEventListener('input', () => {
    document.getElementById('transaction-account-id').value = '';
    updateTransactionPreview('deposit');
  });
  document.getElementById('transaction-account-search-withdraw').addEventListener('input', () => {
    document.getElementById('transaction-account-id-withdraw').value = '';
    updateTransactionPreview('withdraw');
  });
  document.getElementById('customer-load-update-btn').addEventListener('click', lookupCustomerForUpdate);
  document.getElementById('customer-update-save-btn').addEventListener('click', saveCustomerUpdate);
  document.getElementById('customer-update-cancel-btn').addEventListener('click', () => {
    const form = customerUpdateForm;
    delete form.dataset.customerId;
    form.reset();
    clearCustomerFieldErrors(form);
  });
  document.getElementById('customer-inactive-search-btn').addEventListener('click', lookupCustomerForInactivation);
  document.getElementById('customer-inactive-confirm-btn').addEventListener('click', confirmCustomerInactivation);
  document.getElementById('account-load-update-btn').addEventListener('click', lookupAccountForUpdate);
  document.getElementById('account-update-save-btn').addEventListener('click', saveAccountUpdate);
  document.getElementById('account-update-cancel-btn').addEventListener('click', () => {
    const form = document.getElementById('account-update-form');
    delete form.dataset.accountId;
    form.reset();
  });
  document.getElementById('account-inactive-search-btn').addEventListener('click', lookupAccountForInactivation);
  document.getElementById('account-inactive-confirm-btn').addEventListener('click', confirmAccountInactivation);
  document.getElementById('transaction-form').querySelector('[name="amount"]').addEventListener('input', () => updateTransactionPreview('deposit'));
  document.getElementById('transaction-withdraw-form').querySelector('[name="amount"]').addEventListener('input', () => updateTransactionPreview('withdraw'));

  document.getElementById('customer-cancel-btn').addEventListener('click', () => {
    resetCustomerForm();
  });

  document.getElementById('account-cancel-btn').addEventListener('click', () => {
    resetAccountForm();
  });

  document.getElementById('transaction-deposit-cancel-btn').addEventListener('click', () => {
    document.getElementById('transaction-form').reset();
    updateTransactionPreview('deposit');
  });
  document.getElementById('transaction-withdraw-cancel-btn').addEventListener('click', () => {
    document.getElementById('transaction-withdraw-form').reset();
    updateTransactionPreview('withdraw');
  });

  ['customer-update-client', 'customer-inactive-doc', 'account-update-number', 'account-inactive-number', 'account-customer-search'].forEach((id) => {
    document.getElementById(id).addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        document.getElementById({
          'customer-update-client': 'customer-load-update-btn',
          'customer-inactive-doc': 'customer-inactive-search-btn',
          'account-update-number': 'account-load-update-btn',
          'account-inactive-number': 'account-inactive-search-btn',
          'account-customer-search': 'account-customer-search-btn',
        }[id]).click();
      }
    });
  });

  loadCustomers();
  loadAccounts();
  loadTransactions();
  loadCustomerSelects();
  loadAccountSelects();
});
