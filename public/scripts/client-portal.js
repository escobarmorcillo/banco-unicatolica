// Vista del cliente: sus datos, sus cuentas y los movimientos de cada cuenta.
// El servidor solo entrega información del cliente que inició sesión.
const CUSTOMER_DETAIL_FIELDS = [
  ['Nombre', (c) => `${c.nombres} ${c.apellidos}`],
  ['Documento', (c) => `${c.tipo_documento} ${c.documento}`],
  ['Correo', (c) => c.correo],
  ['Teléfono', (c) => c.telefono],
  ['Dirección', (c) => c.direccion],
];

function renderMyCustomer(customer) {
  document.getElementById('my-customer-details').innerHTML = CUSTOMER_DETAIL_FIELDS.map(([label, read]) => `
    <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(read(customer))}</dd></div>
  `).join('');
}

function renderMyAccounts(accounts) {
  const tableBody = document.getElementById('my-accounts-table-body');
  if (!accounts.length) {
    tableBody.innerHTML = '<tr><td colspan="5">Aún no tienes cuentas registradas.</td></tr>';
    return;
  }
  tableBody.innerHTML = accounts.map((account) => `
    <tr>
      <td>${escapeHtml(account.numero_cuenta)}</td>
      <td>${escapeHtml(account.tipo_cuenta)}</td>
      <td>${formatCurrency(account.saldo)}</td>
      <td><span class="badge ${account.estado === 'activo' ? 'active' : 'inactive'}">${escapeHtml(account.estado)}</span></td>
      <td><button type="button" class="action-link" data-my-account="${escapeHtml(account.numero_cuenta)}">Ver movimientos</button></td>
    </tr>
  `).join('');
}

async function showMyMovements(accountNumber) {
  try {
    const { account, movements } = await fetchJson(`/api/me/transactions?accountNumber=${encodeURIComponent(accountNumber)}`);
    document.getElementById('my-movements-account').textContent = account.numero_cuenta;
    document.getElementById('my-movements-balance').textContent = formatCurrency(account.saldo);
    document.getElementById('my-movements-table-body').innerHTML = movements.length
      ? movements.map((movement) => `
        <tr>
          <td>${new Date(movement.fecha_hora).toLocaleString('es-CO')}</td>
          <td>${escapeHtml(movement.tipo_transaccion === 'deposito' ? 'Depósito' : 'Retiro')}</td>
          <td>${escapeHtml(movement.descripcion || '—')}</td>
          <td>${formatCurrency(movement.monto)}</td>
          <td>${formatCurrency(movement.saldo_resultante)}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5">Esta cuenta aún no tiene movimientos.</td></tr>';
    const panel = document.getElementById('my-movements-panel');
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (!error.sessionError) showMessage(error.message, 'error');
  }
}

// La llama auth.js cuando inicia sesión un cliente.
async function startClientPortal() {
  document.getElementById('my-accounts-table-body').addEventListener('click', (event) => {
    const button = event.target.closest('[data-my-account]');
    if (button) showMyMovements(button.dataset.myAccount);
  });
  try {
    const [customer, accounts] = await Promise.all([fetchJson('/api/me/customer'), fetchJson('/api/me/accounts')]);
    renderMyCustomer(customer);
    renderMyAccounts(accounts);
  } catch (error) {
    if (!error.sessionError) showMessage(error.message, 'error');
  }
}
