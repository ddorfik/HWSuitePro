/* HandwerkPro – Frontend (Vanilla JS, keine Abhängigkeiten) */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const view = $('#view');

const state = {
  page: 'dashboard',
  search: '',
  settings: {},
  meta: {},
  user: null,
  employees: [],
  customers: [],
  properties: [],
  articles: [],
  weekStart: null,
  ordersFilter: 'offen',
  invoicesFilter: 'offen',
  customersFilter: 'alle',
  warehouseFilter: 'alle',
  contractsFilter: 'aktiv',
  reportsFilter: 'alle',
  time: null,
  todayMinutes: 0,
  weekMinutes: 0,
  currentOrderId: null,
  currentReportId: null,
  voice: null,
  loading: false,
};

const can = (permission) => {
  const user = state.user;
  if (!user) return false;
  if (user.role === 'chef') return true;
  const permissions = user.permissions ?? [];
  return permissions.includes('*') || permissions.includes(permission);
};
const canAny = (...permissions) => permissions.some((permission) => can(permission));
const isTechnician = () => can('orders.view.own') && !can('orders.view.all');

const REPORT_STATUS_LABELS = {
  entwurf: 'Entwurf', eingereicht: 'Eingereicht', freigegeben: 'Freigegeben', abgerechnet: 'Abgerechnet',
};
const REPORT_TYPE_LABELS = {
  montage: 'Montage', wartung: 'Wartung', stoerung: 'Störung', aufmass: 'Aufmaß', sonstiges: 'Sonstiges',
};

const moneyFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const numFmt = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value) => moneyFmt.format(Number(value) || 0);
const num2 = (value) => numFmt.format(Number(value) || 0);

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const STATUS_LABELS = {
  neu: 'Neu', geplant: 'Geplant', in_arbeit: 'In Arbeit', erledigt: 'Erledigt',
  abgerechnet: 'Abgerechnet', storniert: 'Storniert', angenommen: 'Angenommen',
  offen: 'Offen', teilweise: 'Teilweise bezahlt', bezahlt: 'Bezahlt', gemahnt: 'Gemahnt',
};
const PRIORITY_LABELS = { normal: 'Normal', hoch: 'Hoch', dringend: 'Dringend' };

const APPOINTMENT_KINDS = {
  baustelle: { label: 'Baustelle / Auftrag', color: '#0f4c5c', icon: 'box' },
  kundenbesuch: { label: 'Kundenbesuch / Beratung', color: '#1d4ed8', icon: 'user' },
  meeting: { label: 'Meeting / Besprechung', color: '#6d28d9', icon: 'users' },
  personal: { label: 'Personal / HR', color: '#be123c', icon: 'users' },
  notdienst: { label: 'Notdienst', color: '#b91c1c', icon: 'alert' },
  fortbildung: { label: 'Fortbildung / Schulung', color: '#b45309', icon: 'file' },
  lieferant: { label: 'Lieferant / Werkstatt', color: '#0f766e', icon: 'box' },
  sonstiges: { label: 'Sonstiges', color: '#64748b', icon: 'calendar' },
};
const kindInfo = (kind) => APPOINTMENT_KINDS[kind] || APPOINTMENT_KINDS.baustelle;
const kindLabel = (kind) => kindInfo(kind).label;
const kindChip = (kind) => {
  const info = kindInfo(kind);
  return `<span class="kind-chip" style="--kc:${info.color}"><span class="kind-dot"></span>${esc(info.label)}</span>`;
};

const statusBadge = (status) =>
  `<span class="badge ${esc(status)}"><span class="dot"></span>${esc(STATUS_LABELS[status] || status)}</span>`;

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5"/><path d="M4 21h16"/>',
  euro: '<path d="M18 7a7 7 0 1 0 0 10"/><path d="M4 10h10M4 14h9"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-.6 4"/><path d="M20 4v7h-7"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  box: '<path d="m12 3 8 4.3v9.4L12 21l-8-4.3V7.3Z"/><path d="M4 7.3 12 12l8-4.7M12 12v9"/>',
  receipt: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  arrow: '<path d="m9 6 6 6-6 6"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  camera: '<path d="M4 8h3l2-2h6l2 2h3v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><circle cx="12" cy="14" r="3.4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  play: '<path d="m7 4 13 8-13 8Z"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5"/><path d="M16 5a3 3 0 0 1 0 6M17 15c2.3.4 4 2 4 5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="m21 15-4.5-4.5L6 21"/>',
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
};

const icon = (name, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;

const fmtDate = (value) => {
  if (!value) return '–';
  const raw = String(value);
  const date = new Date(raw.length > 10 ? raw : `${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const fmtDateShort = (value) => {
  const date = new Date(String(value).length > 10 ? value : `${value}T12:00:00`);
  return date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
};
const fmtTime = (value) => new Date(value).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (value) => value ? `${fmtDate(value)} · ${fmtTime(value)}` : '–';
const formatDuration = (minutes) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} Min.`;
  return `${hours} Std. ${String(rest).padStart(2, '0')} Min.`;
};
const clockHM = (date) => new Date(date).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const toDateInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const todayISO = () => toDateInput(new Date());
const addDaysISO = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toDateInput(d);
};

const customerName = (row) => {
  if (!row) return '';
  if (row.company) return row.company;
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unbekannt';
};
const customerFull = (row) => {
  const name = customerName(row);
  const contact = [row.first_name, row.last_name].filter(Boolean).join(' ');
  return row.company && contact ? `${name} · ${contact}` : name;
};

const relativeTime = (value) => {
  const date = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  if (diff < 172800) return 'gestern';
  return `vor ${Math.floor(diff / 86400)} Tagen`;
};

/* ------------------------------------------------------------------ API */
const api = {
  async request(method, path, body) {
    const options = { method, headers: {} };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetch(path, options);
    if (!response.ok) {
      let message = `Fehler ${response.status}`;
      try {
        const data = await response.json();
        if (data?.error) message = data.error;
      } catch { /* ignore */ }
      const error = new Error(message);
      error.status = response.status;
      if (response.status === 401 && !path.startsWith('/api/auth/login')) showLogin();
      throw error;
    }
    if (response.status === 204) return null;
    return response.json();
  },
  get: (path) => api.request('GET', path),
  post: (path, body) => api.request('POST', path, body),
  put: (path, body) => api.request('PUT', path, body),
  del: (path) => api.request('DELETE', path),
};

/* ------------------------------------------------------------------ UI-Helfer */
function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check')}<div>${esc(message)}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    el.style.transition = 'all .2s';
    setTimeout(() => el.remove(), 220);
  }, type === 'error' ? 6000 : 3800);
}

function openModal({ title, subtitle = '', body, footer = '', size = '' }) {
  $('#modal-root').innerHTML = `
    <div class="modal-overlay" data-overlay>
      <div class="modal ${size}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div>
            <h2>${esc(title)}</h2>
            ${subtitle ? `<div class="m-sub">${esc(subtitle)}</div>` : ''}
          </div>
          <button class="icon-btn m-close" type="button" data-action="close-modal" aria-label="Schließen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>
    </div>`;
  document.body.style.overflow = 'hidden';
  const overlay = $('[data-overlay]');
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeModal();
  });
}

function closeModal() {
  $('#modal-root').innerHTML = '';
  document.body.style.overflow = '';
}

function formModal({ title, subtitle, fields, values = {}, submitLabel = 'Speichern', onSubmit, size = '' }) {
  const html = fields.map((field, index) => {
    let out = '';
    if (field.section && (index === 0 || fields[index - 1]?.section !== field.section)) {
      out += `<div class="section-title">${esc(field.section)}</div>`;
    }
    const value = values[field.name] ?? field.default ?? '';
    const full = field.full ? ' full' : '';
    const req = field.required ? 'required' : '';
    const hint = field.hint ? `<span class="hint">${esc(field.hint)}</span>` : '';
    let control = '';
    if (field.type === 'select') {
      const options = field.options || [];
      control = `<select name="${field.name}" ${req}>
        ${field.placeholder ? `<option value="">${esc(field.placeholder)}</option>` : ''}
        ${options.map((option) => {
          const opt = typeof option === 'string' ? { value: option, label: option } : option;
          const selected = String(opt.value) === String(value) ? 'selected' : '';
          return `<option value="${esc(opt.value)}" ${opt.customer ? `data-customer="${opt.customer}"` : ''} ${selected}>${esc(opt.label)}</option>`;
        }).join('')}
      </select>`;
    } else if (field.type === 'textarea') {
      control = `<textarea name="${field.name}" rows="${field.rows || 3}" ${req} placeholder="${esc(field.placeholder || '')}">${esc(value)}</textarea>`;
      if (field.dictate) {
        control += `<div class="field-tools">
          <button class="btn sm" type="button" data-dictate="${field.name}">${icon('mic')} Diktieren</button>
          <span class="hint" data-dictate-status="${field.name}"></span>
        </div>`;
      }
    } else if (field.type === 'checkbox') {
      control = `<label class="check"><input type="checkbox" name="${field.name}" ${value ? 'checked' : ''} /> ${esc(field.checkLabel || 'Ja')}</label>`;
    } else {
      control = `<input type="${field.type || 'text'}" name="${field.name}" value="${esc(value)}" ${req}
        ${field.step ? `step="${field.step}"` : ''} ${field.min != null ? `min="${field.min}"` : ''}
        placeholder="${esc(field.placeholder || '')}" />`;
    }
    return `<div class="field${full}"><label>${esc(field.label)}${field.required ? ' *' : ''}</label>${control}${hint}</div>`;
  }).join('');

  openModal({
    title,
    subtitle,
    size: size || 'wide',
    body: `<form id="modal-form" class="form-grid" novalidate>${html}</form>`,
    footer: `
      <button class="btn" type="button" data-action="close-modal">Abbrechen</button>
      <button class="btn primary" type="submit" form="modal-form">${esc(submitLabel)}</button>`,
  });

  const form = $('#modal-form');
  $$('[data-dictate]', form).forEach((button) => {
    button.addEventListener('click', () => {
      const target = form.elements[button.dataset.dictate];
      const status = $(`[data-dictate-status="${button.dataset.dictate}"]`, form);
      if (!target) return;
      if (target.value.trim()) target.value = `${target.value.trimEnd()} `;
      listenInline(target, status);
    });
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = {};
    fields.forEach((field) => {
      const input = form.elements[field.name];
      if (!input) return;
      if (field.type === 'checkbox') data[field.name] = input.checked ? 1 : 0;
      else if (field.type === 'number') data[field.name] = input.value === '' ? 0 : Number(input.value);
      else data[field.name] = input.value;
    });
    const button = form.closest('.modal').querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Speichern…';
    try {
      await onSubmit(data);
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
      button.textContent = submitLabel;
    }
  });
}

/* ------------------------------------------------------------------ Navigation */
const PAGES = {
  dashboard: { title: 'Übersicht', sub: 'Alles im Blick', primary: { label: 'Neuer Auftrag', action: 'new-order', permission: 'orders.manage' }, render: renderDashboard },
  my: { title: 'Mein Tag', sub: 'Zeiten, Aufträge und Berichte', primary: { label: 'Bericht schreiben', action: 'new-report', permission: 'reports.own' }, render: renderMyDay },
  time: { title: 'Zeiterfassung', sub: 'Ein- und Ausstempeln, Zeiten nachtragen', primary: { label: 'Zeit nachtragen', action: 'new-time', permissions: ['time.own', 'time.manage'] }, render: renderTime },
  reports: { title: 'Berichte', sub: 'Montageberichte, Material und Fotos', primary: { label: 'Neuer Bericht', action: 'new-report', permission: 'reports.own' }, render: renderReports },
  orders: { title: 'Aufträge & Angebote', sub: 'Aufträge planen, bearbeiten und abrechnen', primary: { label: 'Neuer Auftrag', action: 'new-order', permission: 'orders.manage' }, render: renderOrders },
  planning: { title: 'Einsatzplanung / Kalender', sub: 'Wochenplan für Monteure, Büro und Chef', primary: { label: 'Termin anlegen', action: 'new-appointment', permission: 'planning.manage' }, render: renderPlanning },
  customers: { title: 'Kunden & Objekte', sub: 'Stammdaten und Historie', primary: { label: 'Neuer Kunde', action: 'new-customer', permission: 'customers.manage' }, render: renderCustomers },
  invoices: { title: 'Rechnungen', sub: 'Rechnungen, Zahlungen und Mahnwesen', primary: { label: 'CSV-Export', action: 'export-invoices', permission: 'exports.run' }, render: renderInvoices },
  contracts: { title: 'Wartungsverträge', sub: 'Wiederkehrende Aufträge automatisch erzeugen', primary: { label: 'Neuer Vertrag', action: 'new-contract', permission: 'contracts.manage' }, render: renderContracts },
  warehouse: { title: 'Material & Lager', sub: 'Bestände, Mindestbestände und Buchungen', primary: { label: 'Neuer Artikel', action: 'new-article', permission: 'warehouse.manage' }, render: renderWarehouse },
  team: { title: 'Personal & Team', sub: 'Mitarbeiter, Zeiten und Auslastung', primary: { label: 'Mitarbeiter anlegen', action: 'new-employee', permission: 'employees.manage' }, render: renderTeam },
  users: { title: 'Benutzer & Rechte', sub: 'Konten, Rollen und Zugriffsrechte', primary: { label: 'Benutzer anlegen', action: 'new-user', permission: 'users.manage' }, render: renderUsers },
  settings: { title: 'Einstellungen', sub: 'Firma, Rechnungen, Automatik und Gewerk', primary: { label: 'Speichern', action: 'save-settings', permission: 'settings.manage' }, render: renderSettings },
};

const PAGE_GUARDS = {
  my: () => canAny('dashboard.view', 'orders.view.own', 'planning.view'),
  time: () => canAny('time.own', 'time.view.all'),
  reports: () => canAny('reports.own', 'reports.view.all'),
  orders: () => canAny('orders.view.all', 'orders.view.own'),
  planning: () => can('planning.view'),
  customers: () => can('customers.view'),
  invoices: () => can('invoices.view'),
  contracts: () => can('contracts.view'),
  warehouse: () => can('warehouse.view'),
  team: () => can('employees.view'),
  users: () => can('users.manage'),
  settings: () => can('settings.manage'),
  dashboard: () => can('dashboard.view'),
};

let primaryAction = null;

async function navigate() {
  closeModal();
  const raw = location.hash.replace(/^#\/?/, '');
  let page = raw.split('?')[0] || 'dashboard';
  if (!PAGES[page]) page = 'dashboard';
  if (PAGE_GUARDS[page] && !PAGE_GUARDS[page]()) {
    page = can('dashboard.view') ? 'dashboard' : 'my';
    history.replaceState(null, '', `#/${page}`);
  }
  const def = PAGES[page] || PAGES.dashboard;
  state.page = page;
  state.search = '';
  const searchInput = $('#global-search');
  if (searchInput) searchInput.value = '';
  $('#page-title').textContent = def.title;
  $('#page-sub').textContent = def.sub;
  $$('#nav a').forEach((link) => link.classList.toggle('active', link.dataset.route === state.page));
  $$('#bottom-nav [data-page]').forEach((link) => link.classList.toggle('active', link.dataset.page === state.page));
  const allowedPrimary = def.primary
    && (!def.primary.permission || can(def.primary.permission))
    && (!def.primary.permissions || canAny(...def.primary.permissions));
  primaryAction = allowedPrimary ? def.primary : null;
  const primary = $('#primary-action');
  if (primaryAction) {
    primary.hidden = false;
    $('#primary-label').textContent = primaryAction.label;
  } else {
    primary.hidden = true;
  }
  $('#sidebar').classList.remove('open');
  view.innerHTML = '<div class="loading-card"><span class="spinner"></span> Wird geladen…</div>';
  try {
    await def.render();
    updateBadges();
  } catch (error) {
    view.innerHTML = `
      <div class="card"><div class="card-body pad">
        <div class="empty">${icon('alert')}<div><b>Daten konnten nicht geladen werden</b></div>
        <div class="small" style="margin-top:6px">${esc(error.message)}</div></div>
      </div></div>`;
  }
}

async function refresh() {
  const def = PAGES[state.page] || PAGES.dashboard;
  await def.render();
  updateBadges();
}

async function updateBadges() {
  try {
    const dashboard = await api.get('/api/dashboard');
    const setBadge = (id, value) => {
      const el = $(id);
      if (!el) return;
      el.hidden = !value;
      el.textContent = value;
    };
    setBadge('#badge-orders', dashboard.kpis?.openOrders);
    setBadge('#badge-invoices', dashboard.kpis?.openInvoiceCount);
    setBadge('#badge-stock', (dashboard.lowStock ?? []).length);
    const info = $('#automation-info');
    if (info) {
      info.textContent = dashboard.kpis?.todayJobs > 0
        ? `${dashboard.kpis.todayJobs} ${dashboard.kpis.todayJobs === 1 ? 'Termin' : 'Termine'} heute`
        : 'Aufträge & Rechnungen werden automatisch erzeugt.';
    }
    const automatikOn = ['auto_create_orders', 'auto_invoice', 'auto_dunning']
      .some((key) => state.settings[key] === '1');
    const statusLabel = $('.sidebar-foot b');
    if (statusLabel) {
      statusLabel.innerHTML = `<span class="automation-dot"${automatikOn ? '' : ' style="background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.18)"'}></span>${automatikOn ? 'Automatik aktiv' : 'Automatik pausiert'}`;
    }
  } catch { /* stumm */ }
}

/* ------------------------------------------------------------------ Dashboard */
async function renderDashboard() {
  const data = await api.get('/api/dashboard');
  if (data.personal) return renderTechnicianDashboard(data);
  if (data.hr) return renderHrDashboard(data);
  const k = data.kpis;
  const maxRevenue = Math.max(...data.revenueByMonth.map((m) => m.value), 1);

  const kpi = (label, value, foot, page, ico, tone = '') => `
    <div class="kpi link ${tone}" data-action="goto" data-page="${page}">
      <div class="ico">${icon(ico)}</div>
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      <div class="foot">${foot}</div>
    </div>`;

  view.innerHTML = `
    <div class="kpi-grid">
      ${kpi('Offene Aufträge', k.openOrders, `${k.inProgress} in Arbeit · ${k.todayJobs} Termine heute`, 'orders', 'receipt')}
      ${kpi('Umsatz diesen Monat', money(k.revenueMonth), `${k.invoiceCount} Rechnungen gesamt`, 'invoices', 'euro', 'green')}
      ${kpi('Offene Rechnungen', money(k.openInvoiceSum), `${k.openInvoiceCount} ${k.openInvoiceCount === 1 ? 'Rechnung' : 'Rechnungen'} · ${money(k.overdueSum)} überfällig`, 'invoices', 'file', 'amber')}
      ${kpi('Lager-Warnungen', data.lowStock.length, data.lowStock.length ? 'Artikel unter Mindestbestand' : 'Alle Bestände in Ordnung', 'warehouse', 'box', data.lowStock.length ? 'red' : 'green')}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head">
          <div><h2>Umsatzentwicklung</h2><div class="sub">Rechnungsbeträge der letzten 6 Monate</div></div>
          <div class="right"><span class="badge bezahlt">${money(k.revenueMonth)} aktuell</span></div>
        </div>
        <div class="card-body">
          <div class="chart">
            ${data.revenueByMonth.map((month, index) => `
              <div class="bar-wrap" title="${esc(month.label)}: ${money(month.value)}">
                <div class="bar-value">${month.value ? money(month.value) : '–'}</div>
                <div class="bar ${index === data.revenueByMonth.length - 1 ? 'current' : ''}" style="height:${Math.max(2, (month.value / maxRevenue) * 100)}%"></div>
                <div class="bar-label">${esc(month.label)}</div>
              </div>`).join('')}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h2>Termine</h2><div class="sub">Heute und in den nächsten 7 Tagen</div></div>
          <div class="right"><a class="btn sm" href="#/planning">Planung ${icon('arrow')}</a></div>
        </div>
        <div class="card-body">
          <div class="timeline">
            ${data.appointments.length ? data.appointments.map((a) => `
              <div class="timeline-item" ${a.order_id ? `data-action="open-order" data-id="${a.order_id}" style="cursor:pointer"` : ''}>
                <div class="time-chip">${esc(fmtDateShort(a.start_at).split(',')[0])}<small>${fmtTime(a.start_at)}</small></div>
                <div class="t-main">
                  <div class="t-title">${esc(a.order_title || a.title)}</div>
                  <div class="t-sub">${esc(customerName(a))} · ${esc(a.employee_name || 'nicht zugewiesen')}</div>
                </div>
              </div>`).join('') : `<div class="empty">${icon('calendar')}<div>Keine Termine geplant</div></div>`}
          </div>
        </div>
      </div>
    </div>

    <div class="grid-2 equal">
      <div class="card">
        <div class="card-head">
          <div><h2>Überfällige Rechnungen</h2><div class="sub">Zahlungserinnerung nicht vergessen</div></div>
          <div class="right"><a class="btn sm" href="#/invoices">Alle ${icon('arrow')}</a></div>
        </div>
        <div class="card-body">
          ${data.overdueInvoices.length ? data.overdueInvoices.map((invoice) => `
            <div class="list-row">
              <div class="lr-main">
                <div class="lr-title">${esc(invoice.number)} · ${esc(customerName(invoice))}</div>
                <div class="lr-sub">fällig ${fmtDate(invoice.due_date)} · ${Math.max(0, Number(invoice.days_overdue) || 0)} Tage überfällig</div>
              </div>
              <div class="lr-value">${money(Number(invoice.total) - Number(invoice.paid_total))}</div>
              <button class="btn sm" data-action="dunning-invoice" data-id="${invoice.id}">Mahnung</button>
            </div>`).join('') : `<div class="empty">${icon('check')}<div>Keine überfälligen Rechnungen</div></div>`}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2>Letzte Aktivitäten</h2><div class="sub">Automatik und manuelle Vorgänge</div></div></div>
        <div class="card-body">
          <div class="feed">
            ${data.activity.map((item) => `
              <div class="feed-item typ-${esc(item.type)}">
                <span class="feed-dot"></span>
                <div>
                  <div>${esc(item.message)}</div>
                  <div class="feed-time">${relativeTime(item.at)}</div>
                </div>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div><h2>Material nachbestellen</h2><div class="sub">Bestand auf oder unter Mindestbestand</div></div>
        <div class="right"><a class="btn sm" href="#/warehouse">Zum Lager ${icon('arrow')}</a></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Artikel</th><th>Kategorie</th><th class="right">Bestand</th><th class="right">Mindestbestand</th><th class="right">VK-Preis</th><th class="right">Fehlmenge</th></tr></thead>
          <tbody>
            ${data.lowStock.length ? data.lowStock.map((article) => `
              <tr class="click" data-action="goto" data-page="warehouse">
                <td><div class="cell-main">${esc(article.name)}</div><div class="cell-sub">${esc(article.number)}</div></td>
                <td>${esc(article.category)}</td>
                <td class="right"><span class="badge overdue">${num2(article.stock)} ${esc(article.unit)}</span></td>
                <td class="right muted">${num2(article.min_stock)} ${esc(article.unit)}</td>
                <td class="right num">${money(article.sale_price)}</td>
                <td class="right strong">${num2(Math.max(0, article.min_stock - article.stock))} ${esc(article.unit)}</td>
              </tr>`).join('') : `<tr><td colspan="6"><div class="empty">${icon('check')}<div>Alle Bestände sind ausreichend</div></div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ Techniker-App / Personal */
function mapsLink(order) {
  const street = order.property_street || order.customer_street || '';
  const city = order.customer_city || '';
  const address = [street, city].filter(Boolean).join(', ');
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '';
}

function clockCard(data) {
  const running = data.time;
  return `
    <div class="clock-card ${running ? 'running' : ''}">
      <div class="clock-head">
        <div>
          <div class="clock-label">${running ? 'Arbeitszeit läuft' : 'Nicht eingestempelt'}</div>
          <div class="clock-live" data-live-clock>${clockHM(new Date())}</div>
        </div>
        <div class="clock-stats">
          <div><span>Heute</span><b>${formatDuration(data.todayMinutes)}</b></div>
          <div><span>7 Tage</span><b>${formatDuration(data.weekMinutes)}</b></div>
        </div>
      </div>
      ${running ? `<div class="clock-info">${icon('receipt')} ${esc(running.order_number ? `${running.order_number} · ${running.order_title || ''}` : 'Ohne Auftrag')}
        <span class="clock-since">seit ${fmtTime(running.start_at)}</span></div>` : ''}
      <div class="clock-actions">
        <button class="btn ${running ? 'danger' : 'primary'} big" type="button" data-action="toggle-time" ${running ? '' : `data-id="${state.currentOrderId || ''}"`}>
          ${icon(running ? 'stop' : 'play')} ${running ? 'Ausstempeln' : 'Einstempeln'}
        </button>
        ${can('reports.own') ? `<button class="btn big" type="button" data-action="new-report">${icon('file')} Bericht</button>` : ''}
        <button class="btn big ghost" type="button" data-action="start-voice">${icon('mic')} Sprache</button>
      </div>
    </div>`;
}

function renderTechnicianDashboard(data) {
  const k = data.kpis || {};
  const today = data.today;
  const jobs = data.orders ?? [];
  const appointments = (data.appointments ?? []).filter((a) => toDateInput(a.start_at) === today);

  view.innerHTML = `
    ${clockCard(data)}

    <div class="kpi-grid tight">
      <div class="kpi link" data-action="goto" data-page="orders">
        <div class="ico">${icon('receipt')}</div><div class="label">Meine offenen Aufträge</div>
        <div class="value">${k.openOrders ?? 0}</div><div class="foot">${k.inProgress ?? 0} in Arbeit · ${k.todayJobs ?? 0} Termine heute</div>
      </div>
      <div class="kpi link" data-action="goto" data-page="reports">
        <div class="ico">${icon('file')}</div><div class="label">Meine Berichte</div>
        <div class="value">${k.myReports ?? 0}</div><div class="foot">${k.reportsOpen ?? 0} offen / eingereicht</div>
      </div>
      <div class="kpi link" data-action="goto" data-page="time">
        <div class="ico">${icon('clock')}</div><div class="label">Wochenstunden</div>
        <div class="value">${(Math.round((data.weekMinutes / 60) * 10) / 10).toLocaleString('de-DE')}</div>
        <div class="foot">${formatDuration(data.todayMinutes)} heute</div>
      </div>
    </div>

    <div class="section-head">
      <div><h2>Meine Aufträge</h2><div class="sub">Heute und als Nächstes</div></div>
      <a class="btn sm" href="#/orders">Alle Aufträge ${icon('arrow')}</a>
    </div>

    <div class="job-grid">
      ${jobs.length ? jobs.map((order) => `
        <div class="job-card ${order.scheduled_date === today ? 'today' : ''}">
          <div class="job-top">
            ${statusBadge(order.status)}
            <span class="job-num">${esc(order.number)}</span>
            ${order.scheduled_date === today ? '<span class="badge today-tag">Heute</span>' : ''}
          </div>
          <h3>${esc(order.title)}</h3>
          <div class="job-meta">
            <span>${icon('user')} ${esc(customerName(order))}</span>
            <span>${icon('pin')} ${esc(order.property_label || order.customer_street || order.customer_city || 'Ohne Objekt')}</span>
            ${order.scheduled_date ? `<span>${icon('calendar')} ${fmtDate(order.scheduled_date)}</span>` : ''}
          </div>
          <div class="job-tags">
            <span class="mini-tag">${order.report_count || 0} Berichte</span>
            <span class="mini-tag">${order.photo_count || 0} Fotos</span>
          </div>
          <div class="job-actions">
            <button class="btn primary sm" type="button" data-action="open-order" data-id="${order.id}">${icon('arrow')} Öffnen</button>
            ${can('reports.own') ? `<button class="btn sm" type="button" data-action="new-report" data-id="${order.id}">${icon('file')} Bericht</button>` : ''}
            ${can('photos.own') ? `<button class="btn sm" type="button" data-action="upload-photo" data-id="${order.id}" data-kind="vorher">${icon('camera')}</button>` : ''}
            ${mapsLink(order) ? `<a class="btn sm ghost" href="${mapsLink(order)}" target="_blank" rel="noopener">${icon('pin')} Route</a>` : ''}
          </div>
        </div>`).join('') : `
        <div class="card"><div class="card-body pad"><div class="empty">${icon('check')}<div><b>Keine offenen Aufträge</b><div class="small">Alles erledigt – oder es sind noch keine Aufträge zugewiesen.</div></div></div></div></div>`}
    </div>

    <div class="grid-2 equal" style="margin-top:18px">
      <div class="card">
        <div class="card-head">
          <div><h2>Termine heute</h2><div class="sub">${fmtDate(today)}</div></div>
          <a class="btn sm" href="#/planning">Woche ${icon('arrow')}</a>
        </div>
        <div class="card-body">
          <div class="timeline">
            ${appointments.length ? appointments.map((a) => `
              <div class="timeline-item" ${a.order_id ? `data-action="open-order" data-id="${a.order_id}" style="cursor:pointer"` : ''}>
                <div class="time-chip">${fmtTime(a.start_at)}<small>${fmtTime(a.end_at)}</small></div>
                <div class="t-main">
                  <div class="t-title">${esc(a.order_title || a.title)}</div>
                  <div class="t-sub">${esc(customerName(a))}${a.customer_street ? ` · ${esc(a.customer_street)}` : ''}${a.confirmed_at ? ' · <span class="ok-text">✓ bestätigt</span>' : a.declined_at ? ' · <span class="no-text">✕ abgelehnt</span>' : ''}</div>
                </div>
              </div>`).join('') : `<div class="empty">${icon('calendar')}<div>Keine Termine für heute</div></div>`}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h2>Meine letzten Berichte</h2><div class="sub">Zuletzt erstellt</div></div>
          <a class="btn sm" href="#/reports">Alle ${icon('arrow')}</a>
        </div>
        <div class="card-body">
          ${(data.reports ?? []).length ? data.reports.map((report) => `
            <button class="list-row" type="button" data-action="open-report" data-id="${report.id}">
              <span class="list-ico">${icon('file')}</span>
              <span class="list-main"><b>${esc(report.order_number)} · ${esc(report.order_title)}</b>
                <small>${fmtDate(report.created_at)} · ${REPORT_STATUS_LABELS[report.status] || report.status}</small></span>
              ${icon('arrow')}
            </button>`).join('') : `<div class="empty">${icon('file')}<div>Noch keine Berichte</div></div>`}
        </div>
      </div>
    </div>`;
  bindLiveClock();
}

function renderHrDashboard(data) {
  const k = data.kpis || {};
  view.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><div class="ico">${icon('users')}</div><div class="label">Aktive Mitarbeiter</div><div class="value">${k.employees ?? 0}</div><div class="foot">Personalstamm</div></div>
      <div class="kpi link" data-action="goto" data-page="team"><div class="ico">${icon('clock')}</div><div class="label">Stunden diese Woche</div><div class="value">${String(k.weekHours ?? 0).replace('.', ',')}</div><div class="foot">${k.todayEntries ?? 0} Einträge heute</div></div>
      <div class="kpi link" data-action="goto" data-page="reports"><div class="ico">${icon('file')}</div><div class="label">Offene Berichte</div><div class="value">${k.reportsOpen ?? 0}</div><div class="foot">Entwurf oder eingereicht</div></div>
    </div>
    <div class="grid-2 equal">
      <div class="card">
        <div class="card-head"><div><h2>Team heute</h2><div class="sub">Anwesenheit und Stunden</div></div><a class="btn sm" href="#/team">Verwalten ${icon('arrow')}</a></div>
        <div class="card-body">
          ${(data.employees ?? []).map((employee) => `
            <div class="list-row">
              <span class="avatar" style="background:${esc(employee.color || '#0f766e')}">${esc((employee.name || '?').split(' ').map((p) => p[0]).slice(0, 2).join(''))}</span>
              <span class="list-main"><b>${esc(employee.name)}</b><small>${esc(employee.role || '')} · ${formatDuration(employee.today_minutes)} heute</small></span>
              <span class="badge ${employee.running ? 'in_arbeit' : 'neutral'}">${employee.running ? 'eingestempelt' : 'nicht aktiv'}</span>
            </div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Letzte Berichte</h2><div class="sub">Eingereichte Montageberichte</div></div><a class="btn sm" href="#/reports">Alle ${icon('arrow')}</a></div>
        <div class="card-body">
          ${(data.reports ?? []).length ? data.reports.map((report) => `
            <button class="list-row" type="button" data-action="open-report" data-id="${report.id}">
              <span class="list-ico">${icon('file')}</span>
              <span class="list-main"><b>${esc(report.order_number)} · ${esc(report.order_title)}</b>
                <small>${esc(report.employee_name || report.user_name || '')} · ${fmtDate(report.created_at)} · ${REPORT_STATUS_LABELS[report.status] || report.status}</small></span>
              ${icon('arrow')}
            </button>`).join('') : `<div class="empty">${icon('file')}<div>Noch keine Berichte</div></div>`}
        </div>
      </div>
    </div>`;
}

async function renderMyDay() {
  const data = await api.get('/api/dashboard');
  if (data.personal) {
    renderTechnicianDashboard(data);
    return;
  }
  renderOfficeDay(await api.get('/api/my-day'));
}

function dayAppointmentRow(a) {
  const customer = customerName(a);
  const place = a.property_label || a.location
    || (a.customer_street ? `${a.customer_street}${a.customer_city ? `, ${a.customer_city}` : ''}` : '');
  const action = a.order_id
    ? `data-action="open-order" data-id="${a.order_id}"`
    : `data-action="open-appointment" data-id="${a.id}"`;
  return `<div class="day-row" ${action}>
    <div class="dr-time">${fmtTime(a.start_at)}<small>${fmtTime(a.end_at)}</small></div>
    <div class="dr-main">
      <div class="dr-title">${esc(a.title)}</div>
      <div class="dr-sub">
        ${kindChip(a.kind)}
        ${customer ? `<span>${esc(customer)}</span>` : ''}
        ${place ? `<span>· ${esc(place)}</span>` : ''}
        ${a.order_number ? `<span>· ${esc(a.order_number)}</span>` : ''}
      </div>
    </div>
    ${a.confirmed_at ? '<span class="badge erledigt">bestätigt</span>' : a.declined_at ? '<span class="badge storniert">abgelehnt</span>' : ''}
  </div>`;
}

/** Tagesansicht für Büro, Vorgesetzte, HR und Chef: eigene Termine + Kennzahlen. */
function renderOfficeDay(day) {
  const manage = can('planning.manage');
  const today = new Date(`${day.today}T12:00:00`);
  const headline = today.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const k = day.kpis || {};
  const upcoming = day.upcoming || [];
  const grouped = new Map();
  upcoming.forEach((a) => {
    const key = toDateInput(a.start_at);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(a);
  });

  const kpi = (label, value, foot, page, ico, tone = '') => `
    <div class="kpi link ${tone}" data-action="goto" data-page="${page}">
      <div class="ico">${icon(ico)}</div>
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      <div class="foot">${foot}</div>
    </div>`;

  view.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Guten Tag, ${esc((state.user?.name || '').split(' ')[0] || '')}</h2>
        <div class="sub">${headline}${day.employee ? ` · ${esc(day.employee.name)}` : ''}</div>
      </div>
      ${manage ? `<button class="btn sm" type="button" data-action="new-appointment">${icon('plus')} Termin anlegen</button>` : ''}
    </div>

    <div class="kpi-grid tight">
      ${kpi('Meine Termine heute', day.appointments.length,
        day.appointments.length ? `nächster um ${fmtTime(day.appointments[0].start_at)}` : 'noch nichts geplant',
        'planning', 'calendar')}
      ${k.openOrders ? kpi('Offene Aufträge', k.openOrders, 'neu, geplant oder in Arbeit', 'orders', 'receipt') : ''}
      ${k.reportsToApprove ? kpi('Berichte zur Freigabe', k.reportsToApprove, 'warten auf Prüfung', 'reports', 'file', 'amber') : ''}
      ${k.overdueInvoices ? kpi('Überfällige Rechnungen', k.overdueInvoices, 'Zahlungsziel überschritten', 'invoices', 'euro', 'red') : ''}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head">
          <div><h2>Meine Termine heute</h2><div class="sub">${day.appointments.length} ${day.appointments.length === 1 ? 'Eintrag' : 'Einträge'}</div></div>
        </div>
        <div class="card-body">
          ${day.appointments.length ? `<div class="day-list">${day.appointments.map(dayAppointmentRow).join('')}</div>`
            : `<div class="empty">${icon('calendar')}<div>Keine Termine für heute</div>
              ${manage ? '<div class="small" style="margin-top:8px"><button class="btn sm" data-action="new-appointment">Termin anlegen</button></div>' : ''}</div>`}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h2>Die nächsten Tage</h2><div class="sub">Eigene Termine der nächsten zwei Wochen</div></div>
          <a class="btn sm" href="#/planning">Kalender ${icon('arrow')}</a>
        </div>
        <div class="card-body">
          ${upcoming.length ? [...grouped.entries()].map(([key, rows]) => `
            <div class="upcoming-day">
              <div class="upcoming-date">${fmtDate(key)}</div>
              ${rows.map(dayAppointmentRow).join('')}
            </div>`).join('') : '<div class="small muted">Keine weiteren Termine geplant.</div>'}
        </div>
      </div>
    </div>

    ${day.teamToday?.length ? `<div class="card">
      <div class="card-head"><div><h2>Team heute</h2><div class="sub">Wer ist im Einsatz</div></div></div>
      <div class="card-body">
        <div class="team-day">
          ${day.teamToday.map((employee) => `<div class="team-day-item">
            <span class="legend-dot" style="background:${esc(employee.color || '#0f4c5c')}"></span>
            <span class="strong">${esc(employee.name)}</span>
            <span class="muted small">${employee.appointments ? `${employee.appointments} ${employee.appointments === 1 ? 'Termin' : 'Termine'}` : 'frei'}</span>
          </div>`).join('')}
        </div>
      </div>
    </div>` : ''}
  `;
}

let liveClockTimer = null;
function bindLiveClock() {
  if (liveClockTimer) clearInterval(liveClockTimer);
  const update = () => {
    $$('[data-live-clock]').forEach((el) => { el.textContent = clockHM(new Date()); });
  };
  update();
  liveClockTimer = setInterval(update, 1000);
}

/* ------------------------------------------------------------------ Aufträge */
async function renderOrders() {
  const orders = await api.get('/api/orders');
  const filter = state.ordersFilter;
  const term = state.search.toLowerCase();

  const matches = (order) => {
    if (term) {
      const haystack = `${order.number} ${order.title} ${customerName(order)} ${order.property_label || ''}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    if (filter === 'alle') return true;
    if (filter === 'offen') return ['neu', 'geplant', 'in_arbeit'].includes(order.status);
    if (filter === 'angebot') return order.doc_type === 'angebot';
    return order.status === filter;
  };
  const visible = orders.filter(matches);
  const count = (value) => {
    if (value === 'alle') return orders.length;
    if (value === 'offen') return orders.filter((o) => ['neu', 'geplant', 'in_arbeit'].includes(o.status)).length;
    if (value === 'angebot') return orders.filter((o) => o.doc_type === 'angebot').length;
    return orders.filter((o) => o.status === value).length;
  };
  const chips = [
    ['alle', 'Alle'], ['offen', 'Offen'], ['neu', 'Neu'], ['geplant', 'Geplant'],
    ['in_arbeit', 'In Arbeit'], ['erledigt', 'Erledigt'], ['abgerechnet', 'Abgerechnet'],
    ['angebot', 'Angebote'], ['storniert', 'Storniert'],
  ];

  view.innerHTML = `
    <div class="toolbar">
      <div class="chips">
        ${chips.map(([value, label]) => `
          <button class="chip ${filter === value ? 'active' : ''}" data-action="filter-orders" data-filter="${value}">
            ${label} <span class="count">${count(value)}</span>
          </button>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Nummer</th><th>Kunde / Objekt</th><th>Auftrag</th><th>Termin</th><th>Monteur</th><th>Status</th>${can('invoices.view') ? '<th class="right">Netto</th>' : ''}<th></th></tr>
          </thead>
          <tbody>
            ${visible.length ? visible.map((order) => `
              <tr class="click" data-action="open-order" data-id="${order.id}">
                <td class="nowrap">
                  <div class="cell-main">${esc(order.number)}</div>
                  <div class="cell-sub">${order.doc_type === 'angebot' ? 'Angebot' : 'Auftrag'}</div>
                </td>
                <td>
                  <div class="cell-main truncate">${esc(customerName(order))}</div>
                  <div class="cell-sub truncate">${esc(order.property_label || 'Ohne Objekt')}</div>
                </td>
                <td><div class="truncate">${esc(order.title)}</div><div class="cell-sub">${order.item_count} ${order.item_count === 1 ? 'Position' : 'Positionen'}${order.invoice_number ? ` · ${esc(order.invoice_number)}` : ''}</div></td>
                <td class="nowrap">${order.scheduled_date ? fmtDate(order.scheduled_date) : '<span class="muted">–</span>'}</td>
                <td class="nowrap">${esc(order.employee_name || '–')}</td>
                <td>${statusBadge(order.status)}</td>
                ${can('invoices.view') ? `<td class="right num">${money(order.net)}</td>` : ''}
                <td class="right muted">${icon('arrow')}</td>
              </tr>`).join('') : `
              <tr><td colspan="${can('invoices.view') ? 8 : 7}"><div class="empty">${icon('receipt')}<div>Keine Aufträge für diesen Filter</div>
                <div class="small" style="margin-top:8px"><button class="btn sm" data-action="new-order">Ersten Auftrag anlegen</button></div></div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function openOrder(orderId) {
  const data = await api.get(`/api/orders/${orderId}`);
  const {
    order, customer, property, employee, items = [], invoice,
    totals = { subtotal: 0, tax: 0, total: 0 }, appointments = [], reports = [], photos = [], time = [],
  } = data;
  state.currentOrderId = order.id;
  const canMoney = can('invoices.view');
  const canManage = can('orders.manage');
  const canProgress = can('orders.progress');
  const canReport = can('reports.own');
  const canPhoto = can('photos.own');
  const canSeeTime = canAny('time.own', 'time.view.all');
  const locked = order.status === 'abgerechnet' || order.status === 'storniert';
  const isQuote = order.doc_type === 'angebot';
  const statusOptions = isQuote
    ? ['neu', 'angenommen', 'storniert']
    : ['neu', 'geplant', 'in_arbeit', 'erledigt', 'storniert'];
  const editableItems = canManage && !locked;

  const beforePhotos = photos.filter((photo) => photo.kind === 'vorher');
  const afterPhotos = photos.filter((photo) => photo.kind === 'nachher');
  const photoCard = (photo) => `
    <figure class="photo-tile">
      <img src="${photo.url}" alt="${esc(photo.caption || photo.kind)}" loading="lazy" data-action="show-photo" data-src="${photo.url}" />
      <figcaption>${esc(photo.caption || (photo.kind === 'vorher' ? 'Vorher' : photo.kind === 'nachher' ? 'Nachher' : 'Foto'))}</figcaption>
      ${canPhoto && (can('photos.manage') || photo.employee_id === state.user?.employee_id)
        ? `<button class="photo-del" type="button" data-action="delete-photo" data-id="${photo.id}" data-order="${order.id}" title="Foto löschen">${icon('trash')}</button>`
        : ''}
    </figure>`;
  const addPhotoTile = canPhoto ? `
    <button class="photo-add" type="button" data-action="upload-photo" data-id="${order.id}" data-kind="sonstiges">
      ${icon('camera')}<span>Fotos hinzufügen</span><small>einzeln oder mehrere</small>
    </button>` : '';
  const comparePairs = Math.min(beforePhotos.length, afterPhotos.length);
  const compareHtml = comparePairs
    ? beforePhotos.slice(0, comparePairs).map((before, index) => {
      const after = afterPhotos[index];
      return `
        <div class="compare" data-compare style="--pos:50%">
          <img src="${before.url}" alt="Vorher" />
          <div class="cmp-after"><img src="${after.url}" alt="Nachher" /></div>
          <input type="range" min="0" max="100" value="50" class="cmp-range" aria-label="Vorher-Nachher-Vergleich" />
          <span class="cmp-tag left">Vorher</span><span class="cmp-tag right">Nachher</span>
        </div>`;
    }).join('')
    : '';

  const body = `
    <div class="detail-head">
      <div class="dh-main">
        <span class="badge ${order.doc_type === 'angebot' ? 'angebot' : 'neutral'}">${order.doc_type === 'angebot' ? 'Angebot' : 'Auftrag'}</span>
        <span class="badge ${esc(order.priority === 'normal' ? 'neutral' : 'overdue')}" style="margin-left:6px">${esc(PRIORITY_LABELS[order.priority] || order.priority)}</span>
        <h3>${esc(order.title)}</h3>
        <div class="muted small">${esc(order.number)} · angelegt am ${fmtDate(order.created_at)}</div>
      </div>
      <div>${statusBadge(order.status)}</div>
    </div>

    ${(canReport || canPhoto || can('time.own')) ? `
      <div class="tech-actions">
        ${canReport ? `<button class="tech-btn" type="button" data-action="new-report" data-id="${order.id}">${icon('file')}<span>Bericht</span></button>` : ''}
        ${canPhoto ? `<button class="tech-btn" type="button" data-action="upload-photo" data-id="${order.id}" data-kind="vorher">${icon('camera')}<span>Fotos vorher</span></button>` : ''}
        ${canPhoto ? `<button class="tech-btn" type="button" data-action="upload-photo" data-id="${order.id}" data-kind="nachher">${icon('camera')}<span>Fotos nachher</span></button>` : ''}
        ${canPhoto ? `<button class="tech-btn" type="button" data-action="upload-photo" data-id="${order.id}" data-kind="sonstiges">${icon('image')}<span>Weitere Fotos</span></button>` : ''}
        ${can('time.own') ? `<button class="tech-btn" type="button" data-action="toggle-time" data-id="${order.id}">${icon('clock')}<span id="tech-time-label">${state.time ? 'Ausstempeln' : 'Einstempeln'}</span></button>` : ''}
        ${canReport ? `<button class="tech-btn" type="button" data-action="start-voice">${icon('mic')}<span>Sprache</span></button>` : ''}
      </div>` : ''}

    <div class="meta-grid">
      <div class="meta-item"><div class="k">Kunde</div><div class="v">${esc(customerName(customer))}<small>${esc(customer?.number || '')}</small></div></div>
      <div class="meta-item"><div class="k">Objekt</div><div class="v">${esc(property?.label || '–')}<small>${esc(property ? `${property.street || ''}, ${property.zip || ''} ${property.city || ''}` : '')}</small></div></div>
      <div class="meta-item"><div class="k">Monteur</div><div class="v">${esc(employee?.name || 'nicht zugewiesen')}<small>${esc(employee?.role || '')}</small></div></div>
      <div class="meta-item"><div class="k">Termin</div><div class="v">${order.scheduled_date ? fmtDate(order.scheduled_date) : '–'}<small>${esc(order.priority === 'dringend' ? 'Dringend' : '')}</small></div></div>
    </div>

    ${phoneLinks(customer) ? `<div class="contact-row">${phoneLinks(customer)}</div>` : ''}

    ${order.description ? `<hr class="hr"><div class="small" style="line-height:1.6">${esc(order.description)}</div>` : ''}

    <div class="subcard">
      <h4>Positionen</h4>
      <div class="table-wrap">
        <table class="items-table">
          <thead><tr><th>Pos.</th><th>Beschreibung</th><th class="right">Menge</th><th>Einheit</th>${canMoney ? '<th class="right">Einzelpreis</th><th class="right">Gesamt</th>' : ''}<th></th></tr></thead>
          <tbody>
            ${items.length ? items.map((item, index) => `
              <tr data-item="${item.id}">
                <td class="muted">${index + 1}</td>
                <td>${editableItems
                  ? `<input data-field="description" value="${esc(item.description)}" />`
                  : esc(item.description)}</td>
                <td class="right">${editableItems
                  ? `<input class="qty" data-field="quantity" type="number" step="0.01" min="0" value="${item.quantity}" />`
                  : num2(item.quantity)}</td>
                <td>${editableItems
                  ? `<input class="unit" data-field="unit" value="${esc(item.unit)}" />`
                  : esc(item.unit)}</td>
                ${canMoney ? `
                  <td class="right">${editableItems
                    ? `<input class="price" data-field="unit_price" type="number" step="0.01" min="0" value="${item.unit_price}" />`
                    : money(item.unit_price)}</td>
                  <td class="right item-total">${money(item.quantity * item.unit_price)}</td>` : ''}
                <td class="right">${editableItems ? `<button class="icon-btn" data-action="delete-order-item" data-id="${item.id}" data-order="${order.id}" title="Position löschen">${icon('trash')}</button>` : ''}</td>
              </tr>`).join('') : `<tr><td colspan="${canMoney ? 7 : 5}" class="muted">Noch keine Positionen erfasst.</td></tr>`}
          </tbody>
        </table>
      </div>

      ${editableItems ? `
      <div class="inline-form">
        <div class="row">
          <div>
            <label>Artikel / Leistung</label>
            <select id="add-article">
              <option value="">Freie Position…</option>
              ${state.articles.length ? [...new Set(state.articles.map((a) => a.category))].map((category) => `
                <optgroup label="${esc(category)}">
                  ${state.articles.filter((a) => a.category === category).map((a) => `
                    <option value="${a.id}" data-name="${esc(a.name)}" data-price="${a.sale_price}" data-unit="${esc(a.unit)}">
                      ${esc(a.name)}${a.stock != null ? ` (${num2(a.stock)} ${esc(a.unit)})` : ''}
                    </option>`).join('')}
                </optgroup>`).join('') : ''}
            </select>
          </div>
          <div><label>Menge</label><input id="add-qty" type="number" step="0.01" min="0" value="1" /></div>
          <div><label>Einheit</label><input id="add-unit" value="Stk" /></div>
          ${canMoney ? `<div><label>Einzelpreis</label><input id="add-price" type="number" step="0.01" min="0" value="0" /></div>` : ''}
          <div><button class="btn primary sm" type="button" data-action="add-order-item" data-id="${order.id}">Hinzufügen</button></div>
        </div>
        <div style="margin-top:8px">
          <label>Beschreibung</label>
          <input id="add-desc" placeholder="Optional – wird beim Artikel automatisch gefüllt" />
        </div>
      </div>` : ''}

      ${canMoney ? `
      <div class="totals" id="order-totals">
        <table>
          <tr><td>Zwischensumme netto</td><td>${money(totals.subtotal)}</td></tr>
          <tr><td>zzgl. ${num2(order.tax_rate)} % USt.</td><td>${money(totals.tax)}</td></tr>
          <tr class="grand"><td>Gesamtbetrag</td><td>${money(totals.total)}</td></tr>
        </table>
      </div>` : ''}
    </div>

    ${order.internal_note ? `<div class="subcard"><h4>Interne Notiz</h4><div class="small">${esc(order.internal_note)}</div></div>` : ''}

    ${reports.length ? `
      <div class="subcard">
        <h4>Berichte</h4>
        <div class="list-stack">
          ${reports.map((report) => `
            <button class="list-row" type="button" data-action="open-report" data-id="${report.id}">
              <span class="list-ico">${icon('file')}</span>
              <span class="list-main"><b>${REPORT_STATUS_LABELS[report.status] || report.status}</b>
                <small>${fmtDate(report.created_at)} · ${esc(report.employee_name || report.user_name || '')} · ${report.material_count} Material · ${report.photo_count} Fotos</small></span>
              ${icon('arrow')}
            </button>`).join('')}
        </div>
      </div>` : ''}

    ${(photos.length || canPhoto) ? `
      <div class="subcard">
        <h4>Baustellenfotos <span class="muted small">(${photos.length})</span></h4>
        ${photos.length ? `
          ${compareHtml ? `<div class="compare-wrap">${compareHtml}</div>` : ''}
          <div class="photo-grid" style="${compareHtml ? 'margin-top:10px' : ''}">
            ${photos.map(photoCard).join('')}
            ${addPhotoTile}
          </div>
        ` : `
          <div class="small muted">Noch keine Fotos – Kamera öffnen und Vorher-/Nachher-Bilder archivieren.</div>
          <div class="photo-grid" style="margin-top:10px">${addPhotoTile}</div>
        `}
      </div>` : ''}

    ${time.length ? `
      <div class="subcard">
        <h4>Zeiten zu diesem Auftrag</h4>
        ${time.map((entry) => `<div class="small" style="padding:3px 0">${icon('clock')} ${fmtDate(entry.start_at)} · ${fmtTime(entry.start_at)}${entry.end_at ? `–${fmtTime(entry.end_at)}` : ' – läuft'} · ${formatDuration(entry.minutes)} · ${esc(entry.user_name || entry.employee_name || '')}</div>`).join('')}
      </div>` : ''}

    ${appointments.length ? `
      <div class="subcard">
        <h4>Termine</h4>
        ${appointments.map((a) => `<div class="small appt-row" data-action="open-appointment" data-id="${a.id}" title="Termin öffnen">
          ${icon('calendar')} ${fmtDate(a.start_at)}, ${fmtTime(a.start_at)}–${fmtTime(a.end_at)} Uhr · ${esc(a.title)}
          ${a.confirmed_at ? '<span class="badge erledigt" style="margin-left:6px">bestätigt</span>'
            : a.declined_at ? '<span class="badge storniert" style="margin-left:6px">abgelehnt</span>' : ''}
          <span class="muted" style="margin-left:4px">${icon('arrow')}</span>
        </div>`).join('')}
      </div>` : ''}

    ${invoice && canMoney ? `
      <div class="subcard">
        <h4>Rechnung</h4>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <b>${esc(invoice.number)}</b>
          ${statusBadge(invoice.status)}
          <span class="small muted">${money(invoice.total)} · fällig ${fmtDate(invoice.due_date)}</span>
          <button class="btn sm" type="button" data-action="open-invoice" data-id="${invoice.id}" style="margin-left:auto">Rechnung öffnen ${icon('arrow')}</button>
        </div>
      </div>` : ''}

    ${(canProgress && !locked) ? `
      <div class="subcard" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <h4 style="margin:0 0 3px">Status</h4>
          <div class="small muted">${isQuote ? 'Nach Zusage kannst du das Angebot in einen Auftrag umwandeln.' : 'Beim Setzen auf „Erledigt“ wird automatisch eine Rechnung erstellt.'}</div>
        </div>
        <select id="order-status" style="max-width:190px;margin-left:auto">
          ${statusOptions.map((status) => `<option value="${status}" ${order.status === status ? 'selected' : ''}>${STATUS_LABELS[status]}</option>`).join('')}
        </select>
      </div>` : ''}
  `;

  const footer = `
    <div class="left">
      ${can('orders.view.all') ? `<button class="btn sm" type="button" data-action="order-pdf" data-id="${order.id}">${icon('file')} PDF</button>` : ''}
      ${canManage && !locked ? `<button class="btn sm" type="button" data-action="edit-order" data-id="${order.id}">${icon('edit')} Bearbeiten</button>` : ''}
      ${canManage && !locked && !invoice ? `<button class="btn sm danger" type="button" data-action="delete-order" data-id="${order.id}">${icon('trash')} Löschen</button>` : ''}
    </div>
    ${invoice || !can('invoices.manage') ? '' : (isQuote
      ? `<button class="btn primary" type="button" data-action="convert-order" data-id="${order.id}">${icon('arrow')} In Auftrag umwandeln</button>`
      : (!locked ? `<button class="btn primary" type="button" data-action="invoice-order" data-id="${order.id}">${icon('euro')} Rechnung erstellen</button>` : ''))}
    <button class="btn" type="button" data-action="close-modal">Schließen</button>`;

  openModal({
    title: order.number,
    subtitle: customerFull(customer),
    size: 'xwide',
    body,
    footer,
  });

  const modal = $('#modal-root .modal');
  bindCompareSliders(modal);

  if (editableItems) {
    const articleSelect = $('#add-article', modal);
    if (articleSelect) {
      articleSelect.addEventListener('change', () => {
        const option = articleSelect.selectedOptions[0];
        if (!option?.value) return;
        $('#add-desc', modal).value = option.dataset.name || '';
        const price = $('#add-price', modal);
        if (price) price.value = option.dataset.price || 0;
        $('#add-unit', modal).value = option.dataset.unit || 'Stk';
      });
    }

    $$('tr[data-item] input', modal).forEach((input) => {
      input.addEventListener('change', async () => {
        const row = input.closest('tr');
        const itemId = row.dataset.item;
        const payload = {};
        $$('input', row).forEach((field) => {
          payload[field.dataset.field] = field.dataset.field === 'description' || field.dataset.field === 'unit'
            ? field.value
            : Number(field.value);
        });
        try {
          await api.put(`/api/orders/${order.id}/items/${itemId}`, payload);
          const quantity = Number(row.querySelector('[data-field="quantity"]')?.value);
          const price = Number(row.querySelector('[data-field="unit_price"]')?.value);
          const total = row.querySelector('.item-total');
          if (total) total.textContent = money(quantity * price);
          if (canMoney) recalcOrderTotals(modal, Number(order.tax_rate));
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    });
  }

  if (canProgress && !locked) {
    const statusSelect = $('#order-status', modal);
    statusSelect?.addEventListener('change', async () => {
      const status = statusSelect.value;
      if (status === 'storniert' && !confirm('Auftrag wirklich stornieren?')) {
        statusSelect.value = order.status;
        return;
      }
      statusSelect.disabled = true;
      try {
        const result = await api.post(`/api/orders/${order.id}/status`, { status });
        if (result.autoInvoice) {
          toast(`Rechnung ${result.autoInvoice.number} automatisch erstellt (${money(result.autoInvoice.total)}).`);
        } else {
          toast(`Status geändert: ${STATUS_LABELS[status]}`);
        }
        await refresh();
        await openOrder(order.id);
        refreshBadgesOnly();
      } catch (error) {
        toast(error.message, 'error');
        statusSelect.disabled = false;
      }
    });
  }
}

function phoneLinks(customer) {
  if (!customer) return '';
  const parts = [];
  if (customer.phone) parts.push(`<a class="btn sm" href="tel:${esc(customer.phone.replace(/[^+\d]/g, ''))}">${icon('phone')} ${esc(customer.phone)}</a>`);
  if (customer.mobile) parts.push(`<a class="btn sm" href="tel:${esc(customer.mobile.replace(/[^+\d]/g, ''))}">${icon('phone')} ${esc(customer.mobile)}</a>`);
  if (customer.email) parts.push(`<a class="btn sm" href="mailto:${esc(customer.email)}">${icon('mail')} E-Mail</a>`);
  return parts.join('');
}

function bindCompareSliders(root = document) {
  $$('[data-compare]', root).forEach((box) => {
    const range = $('.cmp-range', box);
    if (!range) return;
    const update = () => box.style.setProperty('--pos', `${range.value}%`);
    range.addEventListener('input', update);
    update();
  });
}

function recalcOrderTotals(modal, taxRate) {
  let net = 0;
  $$('tr[data-item]', modal).forEach((row) => {
    const qty = Number(row.querySelector('[data-field="quantity"]')?.value) || 0;
    const price = Number(row.querySelector('[data-field="unit_price"]')?.value) || 0;
    net += qty * price;
  });
  const tax = net * (taxRate / 100);
  const totals = $('#order-totals', modal);
  if (!totals) return;
  totals.innerHTML = `<table>
    <tr><td>Zwischensumme netto</td><td>${money(net)}</td></tr>
    <tr><td>zzgl. ${num2(taxRate)} % USt.</td><td>${money(tax)}</td></tr>
    <tr class="grand"><td>Gesamtbetrag</td><td>${money(net + tax)}</td></tr>
  </table>`;
}

function orderForm(order = null) {
  formModal({
    title: order ? `Auftrag ${order.number} bearbeiten` : 'Neuer Auftrag',
    subtitle: order ? 'Änderungen werden sofort gespeichert.' : 'Auftrag anlegen – Positionen können anschließend ergänzt werden.',
    fields: [
      { name: 'doc_type', label: 'Art', type: 'select', options: [{ value: 'auftrag', label: 'Auftrag' }, { value: 'angebot', label: 'Angebot' }], default: 'auftrag' },
      { name: 'priority', label: 'Priorität', type: 'select', options: [{ value: 'normal', label: 'Normal' }, { value: 'hoch', label: 'Hoch' }, { value: 'dringend', label: 'Dringend' }], default: 'normal' },
      { name: 'customer_id', label: 'Kunde', type: 'select', required: true, placeholder: 'Kunde auswählen…', options: state.customers.map((c) => ({ value: c.id, label: `${customerName(c)} (${c.number})` })) },
      { name: 'property_id', label: 'Objekt', type: 'select', placeholder: 'Ohne Objekt', options: state.properties.map((p) => ({ value: p.id, label: `${p.label} · ${customerName({ company: p.customer_name })}`, customer: p.customer_id })) },
      { name: 'title', label: 'Titel', full: true, required: true, placeholder: 'z. B. Gastherme warten' },
      { name: 'employee_id', label: 'Monteur', type: 'select', placeholder: 'Nicht zugewiesen', options: state.employees.filter((e) => e.active).map((e) => ({ value: e.id, label: e.name })) },
      { name: 'scheduled_date', label: 'Termin', type: 'date' },
      { name: 'labor_hours', label: 'Arbeitsstunden', type: 'number', step: '0.25', min: 0, default: 0 },
      { name: 'labor_rate', label: 'Stundensatz (€)', type: 'number', step: '0.01', min: 0, default: Number(state.settings.default_labor_rate) || 68 },
      { name: 'tax_rate', label: 'Umsatzsteuer (%)', type: 'number', step: '0.1', min: 0, default: Number(state.settings.default_tax_rate) || 19 },
      { name: 'description', label: 'Beschreibung', type: 'textarea', full: true, rows: 3, placeholder: 'Was ist zu tun? Besonderheiten, Zugang, Material…' },
      { name: 'internal_note', label: 'Interne Notiz', type: 'textarea', full: true, rows: 2 },
    ],
    values: order ? {
      doc_type: order.doc_type, priority: order.priority, customer_id: order.customer_id,
      property_id: order.property_id ?? '', title: order.title, employee_id: order.employee_id ?? '',
      scheduled_date: order.scheduled_date ?? '', labor_hours: order.labor_hours,
      labor_rate: order.labor_rate, tax_rate: order.tax_rate, description: order.description,
      internal_note: order.internal_note,
    } : {},
    submitLabel: order ? 'Speichern' : 'Auftrag anlegen',
    onSubmit: async (data) => {
      if (order) {
        await api.put(`/api/orders/${order.id}`, data);
        toast('Auftrag gespeichert.');
        closeModal();
        await refresh();
        openOrder(order.id);
      } else {
        const created = await api.post('/api/orders', data);
        toast(`Auftrag ${created.order.number} angelegt.`);
        closeModal();
        await refresh();
        openOrder(created.order.id);
      }
      refreshBadgesOnly();
    },
  });

  // Objekt-Auswahl an Kunde koppeln
  const form = $('#modal-form');
  const customerSelect = form.elements.customer_id;
  const propertySelect = form.elements.property_id;
  const filterProperties = () => {
    const customerId = customerSelect.value;
    [...propertySelect.options].forEach((option) => {
      option.hidden = Boolean(option.dataset.customer && customerId && option.dataset.customer !== customerId);
    });
    if (propertySelect.selectedOptions[0]?.hidden) propertySelect.value = '';
  };
  customerSelect.addEventListener('change', filterProperties);
  filterProperties();
}

async function openOrderInvoiceDialog(orderId) {
  const order = await api.get(`/api/orders/${orderId}`);
  const settings = state.settings;
  formModal({
    title: 'Rechnung erstellen',
    subtitle: `${order.order.number} · ${order.order.title}`,
    size: '',
    fields: [
      { name: 'date', label: 'Rechnungsdatum', type: 'date', required: true, default: todayISO() },
      { name: 'dueDays', label: 'Zahlungsziel (Tage)', type: 'number', min: 0, default: Number(settings.payment_days) || 14 },
      { name: 'notes', label: 'Hinweis auf der Rechnung', type: 'textarea', full: true, rows: 2, placeholder: 'Optionaler Text' },
    ],
    submitLabel: 'Rechnung erstellen',
    onSubmit: async (data) => {
      const result = await api.post(`/api/orders/${orderId}/invoice`, data);
      toast(`Rechnung ${result.invoice.number} über ${money(result.invoice.total)} erstellt.`);
      closeModal();
      await refresh();
      await openInvoice(result.invoice.id);
      refreshBadgesOnly();
    },
  });
}

async function openInvoice(invoiceId) {
  const data = await api.get(`/api/invoices/${invoiceId}`);
  const { invoice, customer, property, order, items, payments } = data;
  const open = Math.max(0, Number(invoice.total) - Number(invoice.paid_total));
  const canDun = ['offen', 'teilweise', 'gemahnt'].includes(invoice.status) && open > 0.01;

  const body = `
    <div class="detail-head">
      <div class="dh-main">
        <span class="badge ${esc(invoice.status)}">${esc(STATUS_LABELS[invoice.status] || invoice.status)}</span>
        ${invoice.dunning_level ? `<span class="badge overdue" style="margin-left:6px">${invoice.dunning_level}. Mahnung</span>` : ''}
        <h3>${esc(property?.label || customerName(customer))}</h3>
        <div class="muted small">Rechnung ${esc(invoice.number)} vom ${fmtDate(invoice.date)}</div>
      </div>
      <div style="text-align:right">
        <div class="muted xsmall">Offener Betrag</div>
        <div style="font-size:24px;font-weight:700;color:${open > 0 ? 'var(--danger)' : 'var(--ok)'}">${money(open)}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-item"><div class="k">Rechnungsdatum</div><div class="v">${fmtDate(invoice.date)}</div></div>
      <div class="meta-item"><div class="k">Leistungsdatum</div><div class="v">${fmtDate(invoice.service_date || invoice.date)}</div></div>
      <div class="meta-item"><div class="k">Fällig am</div><div class="v">${fmtDate(invoice.due_date)}</div></div>
      <div class="meta-item"><div class="k">Auftrag</div><div class="v">${esc(order?.number || '–')}<small>${esc(order?.title || '')}</small></div></div>
    </div>

    <div class="subcard">
      <h4>Positionen</h4>
      <div class="table-wrap">
        <table class="items-table">
          <thead><tr><th>Pos.</th><th>Beschreibung</th><th class="right">Menge</th><th>Einheit</th><th class="right">Einzelpreis</th><th class="right">Gesamt</th></tr></thead>
          <tbody>
            ${items.map((item, index) => `
              <tr>
                <td class="muted">${index + 1}</td>
                <td>${esc(item.description)}</td>
                <td class="right">${num2(item.quantity)}</td>
                <td>${esc(item.unit)}</td>
                <td class="right">${money(item.unit_price)}</td>
                <td class="right item-total">${money(item.quantity * item.unit_price)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="totals">
        <table>
          <tr><td>Zwischensumme netto</td><td>${money(invoice.subtotal)}</td></tr>
          <tr><td>zzgl. ${num2(invoice.tax_rate)} % USt.</td><td>${money(invoice.tax_total)}</td></tr>
          <tr class="grand"><td>Gesamtbetrag</td><td>${money(invoice.total)}</td></tr>
          ${Number(invoice.paid_total) > 0 ? `<tr><td>Zahlungen</td><td>- ${money(invoice.paid_total)}</td></tr>
          <tr><td><b>Offen</b></td><td><b>${money(open)}</b></td></tr>` : ''}
        </table>
      </div>
    </div>

    ${payments.length ? `
      <div class="subcard">
        <h4>Zahlungseingänge</h4>
        ${payments.map((p) => `<div class="list-row">
          <div class="lr-main"><div class="lr-title">${fmtDate(p.date)} · ${esc(p.method)}</div><div class="lr-sub">${esc(p.note || '')}</div></div>
          <div class="lr-value">${money(p.amount)}</div>
        </div>`).join('')}
      </div>` : ''}

    ${invoice.notes ? `<div class="subcard"><h4>Hinweis</h4><div class="small">${esc(invoice.notes)}</div></div>` : ''}
  `;

  const footer = `
    <div class="left">
      <button class="btn sm" type="button" data-action="invoice-pdf" data-id="${invoice.id}">${icon('file')} PDF</button>
      ${invoice.dunning_level ? `<button class="btn sm" type="button" data-action="invoice-pdf" data-id="${invoice.id}" data-mahnung="1">${icon('download')} Mahnung</button>` : ''}
      ${canDun ? `<button class="btn sm" type="button" data-action="dunning-invoice" data-id="${invoice.id}">${icon('send')} Mahnen</button>` : ''}
      ${invoice.status === 'storniert' ? '' : `<button class="btn sm danger" type="button" data-action="storno-invoice" data-id="${invoice.id}">Storno</button>`}
    </div>
    ${invoice.status === 'storniert' || open <= 0.01 ? '' : `<button class="btn primary" type="button" data-action="payment-invoice" data-id="${invoice.id}">${icon('euro')} Zahlung erfassen</button>`}
    <button class="btn" type="button" data-action="close-modal">Schließen</button>`;

  openModal({
    title: `Rechnung ${invoice.number}`,
    subtitle: customerFull(customer),
    size: 'wide',
    body,
    footer,
  });
}

async function openPaymentDialog(invoiceId) {
  const data = await api.get(`/api/invoices/${invoiceId}`);
  const open = Math.max(0, Number(data.invoice.total) - Number(data.invoice.paid_total));
  formModal({
    title: 'Zahlung erfassen',
    subtitle: `Rechnung ${data.invoice.number} · offen ${money(open)}`,
    size: '',
    fields: [
      { name: 'amount', label: 'Betrag (€)', type: 'number', step: '0.01', min: 0.01, required: true, default: open.toFixed(2) },
      { name: 'date', label: 'Zahlungsdatum', type: 'date', required: true, default: todayISO() },
      { name: 'method', label: 'Zahlungsart', type: 'select', options: ['Überweisung', 'Barzahlung', 'EC-Karte', 'Lastschrift'], default: 'Überweisung' },
      { name: 'note', label: 'Notiz', full: true, placeholder: 'z. B. Kontoauszug 12.11.' },
    ],
    submitLabel: 'Zahlung buchen',
    onSubmit: async (values) => {
      const result = await api.post(`/api/invoices/${invoiceId}/payments`, values);
      toast(`Zahlung gebucht. Status: ${STATUS_LABELS[result.invoice.status] || result.invoice.status}.`);
      closeModal();
      await openInvoice(invoiceId);
      if (state.page === 'invoices') refresh();
      refreshBadgesOnly();
    },
  });
}

async function dunning(invoiceId) {
  if (!confirm('Mahnung für diese Rechnung erzeugen?')) return;
  try {
    const result = await api.post(`/api/invoices/${invoiceId}/dunning`);
    toast(`${result.dunning.level}. Mahnung erzeugt.`);
    window.open(`/api/invoices/${invoiceId}/pdf?mahnung=1`, '_blank');
    closeModal();
    refresh();
    refreshBadgesOnly();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function stornoInvoice(invoiceId) {
  if (!confirm('Rechnung stornieren? Der Auftrag bleibt abgerechnet.')) return;
  try {
    const invoice = await api.put(`/api/invoices/${invoiceId}`, { status: 'storniert' });
    toast(`Rechnung ${invoice.number} storniert.`);
    closeModal();
    refresh();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------------------------------------------ Rechnungen */
async function renderInvoices() {
  const invoices = await api.get('/api/invoices');
  const filter = state.invoicesFilter;
  const term = state.search.toLowerCase();
  const visible = invoices.filter((invoice) => {
    if (term) {
      const haystack = `${invoice.number} ${customerName(invoice)} ${invoice.order_number || ''}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    if (filter === 'alle') return true;
    if (filter === 'offen') return ['offen', 'teilweise', 'gemahnt'].includes(invoice.status);
    if (filter === 'ueberfaellig') return invoice.overdue && invoice.status !== 'bezahlt' && invoice.status !== 'storniert';
    return invoice.status === filter;
  });

  const count = (value) => {
    if (value === 'alle') return invoices.length;
    if (value === 'offen') return invoices.filter((i) => ['offen', 'teilweise', 'gemahnt'].includes(i.status)).length;
    if (value === 'ueberfaellig') return invoices.filter((i) => i.overdue && !['bezahlt', 'storniert'].includes(i.status)).length;
    return invoices.filter((i) => i.status === value).length;
  };
  const chips = [
    ['alle', 'Alle'], ['offen', 'Offen'], ['ueberfaellig', 'Überfällig'],
    ['gemahnt', 'Gemahnt'], ['bezahlt', 'Bezahlt'], ['storniert', 'Storniert'],
  ];

  const openSum = invoices.filter((i) => ['offen', 'teilweise', 'gemahnt'].includes(i.status))
    .reduce((sum, i) => sum + Number(i.total) - Number(i.paid_total), 0);

  view.innerHTML = `
    <div class="toolbar">
      <div class="chips">
        ${chips.map(([value, label]) => `
          <button class="chip ${filter === value ? 'active' : ''}" data-action="filter-invoices" data-filter="${value}">
            ${label} <span class="count">${count(value)}</span>
          </button>`).join('')}
      </div>
      <div class="spacer"></div>
      <span class="muted small">Offen gesamt: <b style="color:var(--ink)">${money(openSum)}</b></span>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Rechnung</th><th>Kunde</th><th>Datum</th><th>Fällig</th><th>Status</th><th class="right">Betrag</th><th class="right">Offen</th><th class="right">Aktionen</th></tr>
          </thead>
          <tbody>
            ${visible.length ? visible.map((invoice) => {
              const open = Math.max(0, Number(invoice.total) - Number(invoice.paid_total));
              return `
              <tr class="click" data-action="open-invoice" data-id="${invoice.id}">
                <td class="nowrap"><div class="cell-main">${esc(invoice.number)}</div><div class="cell-sub">${esc(invoice.order_number || '')}</div></td>
                <td><div class="cell-main truncate">${esc(customerName(invoice))}</div><div class="cell-sub">${esc(invoice.customer_number)}</div></td>
                <td class="nowrap">${fmtDate(invoice.date)}</td>
                <td class="nowrap">${fmtDate(invoice.due_date)}${invoice.overdue && open > 0.01 ? `<div class="cell-sub" style="color:var(--danger)">${invoice.days_overdue} Tage</div>` : ''}</td>
                <td>${statusBadge(invoice.status)}${invoice.dunning_level ? `<div class="cell-sub">${invoice.dunning_level}. Mahnung</div>` : ''}</td>
                <td class="right num">${money(invoice.total)}</td>
                <td class="right num ${open > 0.01 ? 'strong' : 'muted'}">${money(open)}</td>
                <td class="right nowrap">
                  <button class="icon-btn" title="PDF öffnen" data-action="invoice-pdf" data-id="${invoice.id}">${icon('file')}</button>
                  ${open > 0.01 && invoice.status !== 'storniert' ? `<button class="icon-btn" title="Zahlung erfassen" data-action="payment-invoice" data-id="${invoice.id}">${icon('euro')}</button>` : ''}
                  ${['offen', 'teilweise', 'gemahnt'].includes(invoice.status) && open > 0.01 ? `<button class="icon-btn" title="Mahnung" data-action="dunning-invoice" data-id="${invoice.id}">${icon('send')}</button>` : ''}
                </td>
              </tr>`;
            }).join('') : `<tr><td colspan="8"><div class="empty">${icon('receipt')}<div>Keine Rechnungen gefunden</div></div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ Kunden */
async function renderCustomers() {
  const customers = await api.get('/api/customers');
  const filter = state.customersFilter;
  const term = state.search.toLowerCase();
  const visible = customers.filter((customer) => {
    if (filter !== 'alle' && customer.type !== filter) return false;
    if (!term) return true;
    return `${customerName(customer)} ${customer.number} ${customer.city} ${customer.email}`.toLowerCase().includes(term);
  });

  view.innerHTML = `
    <div class="toolbar">
      <div class="chips">
        ${[['alle', 'Alle'], ['Firma', 'Firmenkunden'], ['Privat', 'Privatkunden']].map(([value, label]) => `
          <button class="chip ${filter === value ? 'active' : ''}" data-action="filter-customers" data-filter="${value}">
            ${label} <span class="count">${value === 'alle' ? customers.length : customers.filter((c) => c.type === value).length}</span>
          </button>`).join('')}
      </div>
      <div class="spacer"></div>
      <span class="muted small">${visible.length} von ${customers.length} Kunden</span>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Kunde</th><th>Kontakt</th><th>Ort</th><th class="right">Objekte</th><th class="right">Aufträge</th>${can('invoices.view') ? '<th class="right">Offene Beträge</th>' : ''}<th></th></tr></thead>
          <tbody>
            ${visible.length ? visible.map((customer) => `
              <tr class="click" data-action="open-customer" data-id="${customer.id}">
                <td>
                  <div class="cell-main">${esc(customerName(customer))}</div>
                  <div class="cell-sub">${esc(customer.number)} · ${esc(customer.type)}${customer.company ? ` · ${esc([customer.first_name, customer.last_name].filter(Boolean).join(' '))}` : ''}</div>
                </td>
                <td>
                  <div class="small">${esc(customer.phone || '–')}</div>
                  <div class="cell-sub">${esc(customer.email || '')}</div>
                </td>
                <td>${esc(customer.zip)} ${esc(customer.city)}</td>
                <td class="right num">${customer.property_count}</td>
                <td class="right num">${customer.order_count}</td>
                ${can('invoices.view') ? `<td class="right num ${Number(customer.open_amount) > 0 ? 'strong' : 'muted'}">${money(customer.open_amount)}</td>` : ''}
                <td class="right muted">${icon('arrow')}</td>
              </tr>`).join('') : `<tr><td colspan="${can('invoices.view') ? 7 : 6}"><div class="empty">${icon('user')}<div>Keine Kunden gefunden</div>
                ${can('customers.manage') ? `<div class="small" style="margin-top:8px"><button class="btn sm" data-action="new-customer">Kunde anlegen</button></div>` : ''}</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function openCustomer(customerId) {
  const data = await api.get(`/api/customers/${customerId}`);
  const { customer, properties, orders, invoices } = data;
  const notes = data.notes ?? [];
  const showMoney = can('invoices.view');
  const manage = can('customers.manage');
  const openSum = invoices.filter((i) => ['offen', 'teilweise', 'gemahnt'].includes(i.status))
    .reduce((sum, i) => sum + Number(i.total) - Number(i.paid_total), 0);

  const body = `
    <div class="detail-head">
      <div class="dh-main">
        <span class="badge neutral">${esc(customer.type)}</span>
        <div class="muted small" style="margin-top:8px">${esc(customer.number)}${customer.company && customer.last_name ? ` · Ansprechpartner: ${esc([customer.first_name, customer.last_name].filter(Boolean).join(' '))}` : ''}</div>
      </div>
      ${showMoney ? `<div style="text-align:right">
        <div class="muted xsmall">Offene Beträge</div>
        <div style="font-size:20px;font-weight:700;color:${openSum > 0 ? 'var(--warn)' : 'var(--ink)'}">${money(openSum)}</div>
      </div>` : ''}
    </div>

    <div class="meta-grid">
      <div class="meta-item"><div class="k">Telefon</div><div class="v">${esc(customer.phone || '–')}<small>${esc(customer.mobile || '')}</small></div></div>
      <div class="meta-item"><div class="k">E-Mail</div><div class="v" style="font-size:11.5px;word-break:break-word">${esc(customer.email || '–')}</div></div>
      <div class="meta-item"><div class="k">Adresse</div><div class="v" style="font-size:11.5px">${esc(customer.street || '')}<small>${esc(customer.zip)} ${esc(customer.city)}</small></div></div>
      <div class="meta-item"><div class="k">Historie</div><div class="v">${orders.length} ${orders.length === 1 ? 'Auftrag' : 'Aufträge'}<small>${showMoney ? `${invoices.length} Rechnungen` : 'eigene Aufträge'}</small></div></div>
    </div>

    ${customer.notes ? `<div class="subcard"><h4>Hinweis</h4><div class="small">${esc(customer.notes)}</div></div>` : ''}

    <div class="subcard">
      <h4 style="display:flex;align-items:center">Notizen <span class="muted small" style="margin-left:8px;font-weight:500">${notes.length}</span></h4>
      ${manage ? `<form id="customer-note-form" class="note-form">
        <textarea id="customer-note-text" name="text" rows="2" maxlength="4000"
          placeholder="Kurz notieren, was wichtig ist – z. B. „Schlüssel liegt beim Nachbarn“"></textarea>
        <div class="field-tools">
          <button class="btn sm" type="button" data-note-dictate>${icon('mic')} Diktieren</button>
          <span class="hint" data-note-dictate-status></span>
          <button class="btn sm primary" type="submit" style="margin-left:auto">${icon('plus')} Notiz speichern</button>
        </div>
      </form>` : ''}
      ${notes.length ? `<div class="note-list">
        ${notes.map((note) => `<div class="note-item">
          <div class="note-meta">
            <span class="strong">${esc(note.user_name)}</span>
            <span>· ${fmtDateTime(note.created_at)}</span>
            ${manage ? `<button class="icon-btn note-del" type="button" data-action="delete-customer-note" data-id="${note.id}" data-customer="${customer.id}" aria-label="Notiz löschen">${icon('trash')}</button>` : ''}
          </div>
          <div class="note-text">${esc(note.text)}</div>
        </div>`).join('')}
      </div>` : `<div class="small muted" style="margin-top:10px">Noch keine Notizen.</div>`}
    </div>

    <div class="subcard">
      <h4 style="display:flex;align-items:center">Objekte ${manage ? `<button class="btn sm" style="margin-left:auto" data-action="new-property" data-customer="${customer.id}">+ Objekt</button>` : ''}</h4>
      ${properties.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Objekt</th><th>Adresse</th><th>Typ</th><th>Heizung</th></tr></thead>
        <tbody>${properties.map((p) => `<tr>
          <td class="strong">${esc(p.label)}</td>
          <td>${esc(p.street)}, ${esc(p.zip)} ${esc(p.city)}</td>
          <td>${esc(p.type)}</td>
          <td class="small">${esc(p.heating_type || '–')}</td>
        </tr>`).join('')}</tbody></table></div>` : '<div class="small muted">Noch keine Objekte hinterlegt.</div>'}
    </div>

    <div class="subcard">
      <h4 style="display:flex;align-items:center">Aufträge ${can('orders.manage') ? `<button class="btn sm" style="margin-left:auto" data-action="new-order-customer" data-customer="${customer.id}">+ Auftrag</button>` : ''}</h4>
      ${orders.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Nummer</th><th>Titel</th><th>Status</th>${showMoney ? '<th class="right">Netto</th>' : ''}</tr></thead>
        <tbody>${orders.slice(0, 6).map((o) => `<tr class="click" data-action="open-order" data-id="${o.id}">
          <td class="nowrap">${esc(o.number)}</td>
          <td class="truncate">${esc(o.title)}</td>
          <td>${statusBadge(o.status)}</td>
          ${showMoney ? `<td class="right num">${money(o.net)}</td>` : ''}
        </tr>`).join('')}</tbody></table></div>` : '<div class="small muted">Noch keine Aufträge.</div>'}
    </div>

    ${showMoney ? `<div class="subcard">
      <h4>Rechnungen</h4>
      ${invoices.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Nummer</th><th>Datum</th><th>Status</th><th class="right">Betrag</th><th class="right">Offen</th></tr></thead>
        <tbody>${invoices.slice(0, 6).map((i) => `<tr class="click" data-action="open-invoice" data-id="${i.id}">
          <td class="nowrap">${esc(i.number)}</td>
          <td>${fmtDate(i.date)}</td>
          <td>${statusBadge(i.status)}</td>
          <td class="right num">${money(i.total)}</td>
          <td class="right num">${money(Number(i.total) - Number(i.paid_total))}</td>
        </tr>`).join('')}</tbody></table></div>` : '<div class="small muted">Noch keine Rechnungen.</div>'}
    </div>` : ''}

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
      ${customer.phone ? `<a class="btn sm" href="tel:${esc(customer.phone.replace(/[^+\d]/g, ''))}">${icon('phone')} Anrufen</a>` : ''}
      ${customer.email ? `<a class="btn sm" href="mailto:${esc(customer.email)}">${icon('mail')} E-Mail</a>` : ''}
    </div>
  `;

  openModal({
    title: customerName(customer),
    subtitle: `${customer.number} · ${customer.type}`,
    size: 'wide',
    body,
    footer: `
      <div class="left">
        ${manage ? `<button class="btn sm" data-action="edit-customer" data-id="${customer.id}">${icon('edit')} Bearbeiten</button>
        <button class="btn sm danger" data-action="delete-customer" data-id="${customer.id}">${icon('trash')} Löschen</button>` : ''}
      </div>
      <button class="btn" data-action="close-modal">Schließen</button>`,
  });

  const noteForm = $('#customer-note-form');
  noteForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = noteForm.elements.text.value.trim();
    if (!text) {
      toast('Bitte eine Notiz eingeben.', 'error');
      noteForm.elements.text.focus();
      return;
    }
    try {
      await api.post(`/api/customers/${customer.id}/notes`, { text });
      toast('Notiz gespeichert.');
      await openCustomer(customer.id);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  $('[data-note-dictate]')?.addEventListener('click', () => {
    listenInline($('#customer-note-text'), $('[data-note-dictate-status]'), 'Notiz');
  });
}

function customerForm(customer = null) {
  formModal({
    title: customer ? 'Kunde bearbeiten' : 'Neuer Kunde',
    subtitle: customer ? customer.number : 'Stammdaten für Angebote und Rechnungen',
    fields: [
      { name: 'type', label: 'Kundentyp', type: 'select', options: ['Firma', 'Privat'], default: 'Firma' },
      { name: 'salutation', label: 'Anrede', type: 'select', options: [{ value: 'Firma', label: 'Firma / Damen und Herren' }, { value: 'Herr', label: 'Herr' }, { value: 'Frau', label: 'Frau' }], default: 'Firma' },
      { name: 'company', label: 'Firma', placeholder: 'Firmenname', full: true },
      { name: 'first_name', label: 'Vorname' },
      { name: 'last_name', label: 'Nachname' },
      { name: 'street', label: 'Straße & Hausnummer', full: true },
      { name: 'zip', label: 'PLZ' },
      { name: 'city', label: 'Ort' },
      { name: 'phone', label: 'Telefon' },
      { name: 'mobile', label: 'Mobil' },
      { name: 'email', label: 'E-Mail', type: 'email', full: true },
      { name: 'notes', label: 'Notizen', type: 'textarea', full: true, rows: 3 },
    ],
    values: customer ?? {},
    submitLabel: customer ? 'Speichern' : 'Kunde anlegen',
    onSubmit: async (data) => {
      if (!data.company && !data.last_name) throw new Error('Bitte Firma oder Nachnamen angeben.');
      if (customer) {
        await api.put(`/api/customers/${customer.id}`, data);
        toast('Kunde gespeichert.');
        closeModal();
        await loadBase();
        openCustomer(customer.id);
      } else {
        const created = await api.post('/api/customers', data);
        toast(`Kunde ${customerName(created)} angelegt.`);
        closeModal();
        await loadBase();
        await refresh();
        openCustomer(created.id);
      }
    },
  });
}

function propertyForm(property = null, customerId = null) {
  formModal({
    title: property ? 'Objekt bearbeiten' : 'Neues Objekt',
    fields: [
      { name: 'customer_id', label: 'Kunde', type: 'select', required: true, placeholder: 'Kunde auswählen…', options: state.customers.map((c) => ({ value: c.id, label: customerName(c) })), default: customerId ?? '' },
      { name: 'label', label: 'Bezeichnung', required: true, placeholder: 'z. B. MFH Königsallee 42' },
      { name: 'type', label: 'Objekttyp', type: 'select', options: ['Einfamilienhaus', 'Mehrfamilienhaus', 'Wohnung', 'Gewerbe', 'Industrie'], default: 'Einfamilienhaus' },
      { name: 'street', label: 'Straße & Hausnummer' },
      { name: 'zip', label: 'PLZ' },
      { name: 'city', label: 'Ort' },
      { name: 'heating_type', label: 'Heizungsart', placeholder: 'z. B. Gas-Brennwert' },
      { name: 'meter_number', label: 'Zählernummer' },
      { name: 'gas_connection', label: 'Gasanschluss', type: 'checkbox', checkLabel: 'vorhanden', default: 1 },
      { name: 'water_connection', label: 'Wasseranschluss', type: 'checkbox', checkLabel: 'vorhanden', default: 1 },
      { name: 'notes', label: 'Zugang / Besonderheiten', type: 'textarea', full: true, rows: 3 },
    ],
    values: property ?? {},
    submitLabel: 'Speichern',
    onSubmit: async (data) => {
      if (property) {
        await api.put(`/api/properties/${property.id}`, data);
        toast('Objekt gespeichert.');
        closeModal();
        openCustomer(Number(data.customer_id));
      } else {
        await api.post('/api/properties', data);
        toast('Objekt angelegt.');
        closeModal();
        await loadBase();
        openCustomer(Number(data.customer_id));
      }
    },
  });
}

/* ------------------------------------------------------------------ Lager */
async function renderWarehouse() {
  const articles = await api.get('/api/articles');
  const showCosts = can('invoices.view');
  const canBook = can('warehouse.manage');
  const filter = state.warehouseFilter;
  const term = state.search.toLowerCase();
  const visible = articles.filter((article) => {
    if (filter === 'niedrig' && !article.low) return false;
    if (!['alle', 'niedrig'].includes(filter) && article.category !== filter) return false;
    if (!term) return true;
    return `${article.name} ${article.number} ${article.supplier || ''}`.toLowerCase().includes(term);
  });
  const stockValue = articles.reduce((sum, a) => sum + Number(a.stock) * Number(a.purchase_price), 0);
  const lowCount = articles.filter((a) => a.low).length;
  const categories = [...new Set(articles.map((a) => a.category))];

  view.innerHTML = `
    <div class="toolbar">
      <div class="chips">
        <button class="chip ${filter === 'alle' ? 'active' : ''}" data-action="filter-warehouse" data-filter="alle">Alle <span class="count">${articles.length}</span></button>
        ${categories.map((category) => `<button class="chip ${filter === category ? 'active' : ''}" data-action="filter-warehouse" data-filter="${esc(category)}">${esc(category)} <span class="count">${articles.filter((a) => a.category === category).length}</span></button>`).join('')}
        <button class="chip ${filter === 'niedrig' ? 'active' : ''}" data-action="filter-warehouse" data-filter="niedrig">Nachbestellen <span class="count">${lowCount}</span></button>
      </div>
      <div class="spacer"></div>
      ${showCosts ? `<span class="muted small">Lagerwert: <b style="color:var(--ink)">${money(stockValue)}</b></span>` : ''}
    </div>

    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Artikel</th><th>Kategorie</th><th class="right">Bestand</th><th class="right">Mindestbestand</th>${showCosts ? '<th class="right">EK</th>' : ''}<th class="right">VK</th>${showCosts ? '<th class="right">Lagerwert</th>' : ''}${canBook ? '<th class="right">Buchen</th>' : ''}</tr></thead>
          <tbody>
            ${visible.length ? visible.map((article) => `
              <tr>
                <td><div class="cell-main">${esc(article.name)}</div><div class="cell-sub">${esc(article.number)} · ${esc(article.supplier || '')}</div></td>
                <td><span class="badge neutral">${esc(article.category)}</span></td>
                <td class="right"><span class="badge ${article.low ? 'overdue' : 'bezahlt'}">${num2(article.stock)} ${esc(article.unit)}</span></td>
                <td class="right muted">${num2(article.min_stock)} ${esc(article.unit)}</td>
                ${showCosts ? `<td class="right num muted">${money(article.purchase_price)}</td>` : ''}
                <td class="right num">${money(article.sale_price)}</td>
                ${showCosts ? `<td class="right num">${money(article.stock_value)}</td>` : ''}
                ${canBook ? `<td class="right nowrap">
                  <button class="icon-btn" title="Wareneingang" data-action="stock-move" data-id="${article.id}" data-direction="1">${icon('plus')}</button>
                  <button class="icon-btn" title="Entnahme" data-action="stock-move" data-id="${article.id}" data-direction="-1">${icon('box')}</button>
                  <button class="icon-btn" title="Bearbeiten" data-action="edit-article" data-id="${article.id}">${icon('edit')}</button>
                </td>` : ''}
              </tr>`).join('') : `<tr><td colspan="${5 + (showCosts ? 2 : 0) + (canBook ? 1 : 0)}"><div class="empty">${icon('box')}<div>Keine Artikel gefunden</div></div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}

function articleForm(article = null) {
  const fields = [
    { name: 'number', label: 'Artikelnummer', placeholder: 'z. B. GA-1007' },
    { name: 'name', label: 'Bezeichnung', required: true },
    { name: 'category', label: 'Kategorie', default: 'Allgemein', hint: 'Frei wählbar, z. B. Elektro, Dach, Gas, Wasser, Zubehör' },
    { name: 'unit', label: 'Einheit', type: 'select', options: ['Stk', 'm', 'kg', 'l', 'Pausch', 'Std'], default: 'Stk' },
    { name: 'purchase_price', label: 'Einkaufspreis (€)', type: 'number', step: '0.01', min: 0, default: 0 },
    { name: 'sale_price', label: 'Verkaufspreis (€)', type: 'number', step: '0.01', min: 0, default: 0 },
    { name: 'min_stock', label: 'Mindestbestand', type: 'number', step: '0.01', min: 0, default: 0 },
    { name: 'supplier', label: 'Lieferant' },
    { name: 'active', label: 'Status', type: 'checkbox', checkLabel: 'Artikel aktiv', default: 1 },
  ];
  if (!article) fields.splice(6, 0, { name: 'stock', label: 'Anfangsbestand', type: 'number', step: '0.01', min: 0, default: 0 });

  formModal({
    title: article ? 'Artikel bearbeiten' : 'Neuer Artikel',
    subtitle: article ? article.number : 'Material für Aufträge und Lager',
    fields,
    values: article ?? {},
    submitLabel: 'Speichern',
    onSubmit: async (data) => {
      if (article) await api.put(`/api/articles/${article.id}`, data);
      else await api.post('/api/articles', data);
      toast(article ? 'Artikel gespeichert.' : 'Artikel angelegt.');
      closeModal();
      await loadBase();
      refresh();
    },
  });
}

function stockMoveForm(article, direction) {
  formModal({
    title: direction > 0 ? 'Wareneingang buchen' : 'Entnahme buchen',
    subtitle: `${article.name} · Bestand ${num2(article.stock)} ${article.unit}`,
    size: '',
    fields: [
      { name: 'quantity', label: `Menge (${article.unit})`, type: 'number', step: '0.01', min: 0.01, required: true, default: 1 },
      { name: 'reason', label: 'Grund', type: 'select', options: direction > 0 ? ['Lieferung', 'Rückgabe', 'Korrektur'] : ['Verbrauch Auftrag', 'Ausschuss', 'Korrektur'], default: direction > 0 ? 'Lieferung' : 'Verbrauch Auftrag' },
    ],
    submitLabel: 'Buchen',
    onSubmit: async (data) => {
      await api.post(`/api/articles/${article.id}/stock`, {
        quantity: direction * Number(data.quantity),
        reason: data.reason,
      });
      toast('Lagerbuchung gespeichert.');
      closeModal();
      refresh();
    },
  });
}

/* ------------------------------------------------------------------ Verträge */
async function renderContracts() {
  const contracts = await api.get('/api/contracts');
  const filter = state.contractsFilter;
  const term = state.search.toLowerCase();
  const visible = contracts.filter((contract) => {
    if (filter === 'aktiv' && !contract.active) return false;
    if (filter === 'inaktiv' && contract.active) return false;
    if (filter === 'faellig' && (Number(contract.days_until_due) > 30 || !contract.active)) return false;
    if (!term) return true;
    return `${contract.title} ${customerName(contract)} ${contract.property_label || ''}`.toLowerCase().includes(term);
  });

  view.innerHTML = `
    <div class="toolbar">
      <div class="chips">
        ${[['alle', 'Alle'], ['aktiv', 'Aktiv'], ['faellig', 'Fällig (30 Tage)'], ['inaktiv', 'Inaktiv']].map(([value, label]) => `
          <button class="chip ${filter === value ? 'active' : ''}" data-action="filter-contracts" data-filter="${value}">${label}</button>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Vertrag</th><th>Kunde / Objekt</th><th>Intervall</th><th>Nächste Fälligkeit</th><th class="right">Pauschale</th><th>Status</th><th class="right">Aktionen</th></tr></thead>
          <tbody>
            ${visible.length ? visible.map((contract) => {
              const days = Number(contract.days_until_due);
              return `<tr>
                <td><div class="cell-main">${esc(contract.title)}</div><div class="cell-sub">${esc(contract.notes || '')}</div></td>
                <td><div class="truncate">${esc(customerName(contract))}</div><div class="cell-sub">${esc(contract.property_label || '–')}</div></td>
                <td>alle ${contract.interval_months} Monate</td>
                <td><div>${fmtDate(contract.next_due)}</div><div class="cell-sub" style="color:${days <= 7 ? 'var(--danger)' : days <= 30 ? 'var(--warn)' : 'var(--muted)'}">${days < 0 ? `${Math.abs(days)} Tage überfällig` : `in ${days} Tagen`}</div></td>
                <td class="right num">${money(contract.price)}</td>
                <td>${contract.active ? '<span class="badge bezahlt">Aktiv</span>' : '<span class="badge storniert">Inaktiv</span>'}</td>
                <td class="right nowrap">
                  <button class="btn sm" data-action="contract-order" data-id="${contract.id}">Auftrag</button>
                  <button class="icon-btn" title="Bearbeiten" data-action="edit-contract" data-id="${contract.id}">${icon('edit')}</button>
                  <button class="icon-btn" title="Löschen" data-action="delete-contract" data-id="${contract.id}">${icon('trash')}</button>
                </td>
              </tr>`;
            }).join('') : `<tr><td colspan="7"><div class="empty">${icon('refresh')}<div>Keine Wartungsverträge gefunden</div></div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}

function contractForm(contract = null) {
  const tasksText = (contract?.tasks ? JSON.parse(contract.tasks) : [])
    .map((task) => [task.description, task.quantity, task.unit, task.unit_price].join(' | '))
    .join('\n');

  formModal({
    title: contract ? 'Vertrag bearbeiten' : 'Neuer Wartungsvertrag',
    subtitle: 'Fällige Verträge erzeugen automatisch Aufträge.',
    fields: [
      { name: 'title', label: 'Bezeichnung', required: true, full: true, placeholder: 'z. B. Jährliche Gasthermen-Wartung' },
      { name: 'customer_id', label: 'Kunde', type: 'select', required: true, placeholder: 'Kunde auswählen…', options: state.customers.map((c) => ({ value: c.id, label: customerName(c) })) },
      { name: 'property_id', label: 'Objekt', type: 'select', placeholder: 'Ohne Objekt', options: state.properties.map((p) => ({ value: p.id, label: p.label, customer: p.customer_id })) },
      { name: 'interval_months', label: 'Intervall (Monate)', type: 'number', min: 1, default: 12 },
      { name: 'next_due', label: 'Nächste Fälligkeit', type: 'date', required: true, default: todayISO() },
      { name: 'price', label: 'Pauschale (€)', type: 'number', step: '0.01', min: 0, default: 0 },
      { name: 'active', label: 'Status', type: 'checkbox', checkLabel: 'Vertrag aktiv', default: 1 },
      { name: 'tasks', label: 'Leistungen', type: 'textarea', full: true, rows: 4, default: tasksText, hint: 'Eine Leistung pro Zeile: Beschreibung | Menge | Einheit | Einzelpreis' },
      { name: 'notes', label: 'Hinweise / Zugang', type: 'textarea', full: true, rows: 2 },
    ],
    values: contract ? { ...contract } : {},
    submitLabel: 'Speichern',
    onSubmit: async (data) => {
      const tasks = String(data.tasks || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const [description, quantity, unit, price] = line.split('|').map((part) => part.trim());
        return {
          kind: 'arbeit',
          description: description || data.title,
          quantity: Number(quantity) || 1,
          unit: unit || 'Pausch',
          unit_price: Number(String(price || '').replace(',', '.')) || Number(data.price) || 0,
        };
      });
      if (!tasks.length) {
        tasks.push({ kind: 'arbeit', description: data.title, quantity: 1, unit: 'Pausch', unit_price: Number(data.price) || 0 });
      }
      const payload = { ...data, tasks };
      if (contract) await api.put(`/api/contracts/${contract.id}`, payload);
      else await api.post('/api/contracts', payload);
      toast(contract ? 'Vertrag gespeichert.' : 'Wartungsvertrag angelegt.');
      closeModal();
      refresh();
      refreshBadgesOnly();
    },
  });

  const form = $('#modal-form');
  const customerSelect = form.elements.customer_id;
  const propertySelect = form.elements.property_id;
  const filterProperties = () => {
    const customerId = customerSelect.value;
    [...propertySelect.options].forEach((option) => {
      option.hidden = Boolean(option.dataset.customer && customerId && option.dataset.customer !== customerId);
    });
    if (propertySelect.selectedOptions[0]?.hidden) propertySelect.value = '';
  };
  customerSelect.addEventListener('change', filterProperties);
  filterProperties();
}

/* ------------------------------------------------------------------ Planung */
function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function renderPlanning() {
  if (!state.weekStart) state.weekStart = startOfWeek();
  const start = new Date(state.weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const from = toDateInput(start);
  const to = toDateInput(end);
  const appointments = await api.get(`/api/appointments?from=${from}&to=${to}`);
  const term = state.search.toLowerCase();
  const visible = term
    ? appointments.filter((a) => `${a.title} ${a.order_number || ''} ${customerName(a)} ${a.employee_name || ''} ${kindLabel(a.kind)}`.toLowerCase().includes(term))
    : appointments;
  const kindFilter = state.planningKind || 'alle';
  const kindsPresent = [...new Set(visible.map((a) => a.kind || 'baustelle'))];
  const shown = kindFilter === 'alle' ? visible : visible.filter((a) => (a.kind || 'baustelle') === kindFilter);

  const days = [...Array(7)].map((_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    return date;
  });
  const hours = [...Array(13)].map((_, index) => index + 7);
  const todayKey = todayISO();

  view.innerHTML = `
    <div class="toolbar">
      <div class="chips">
        <button class="chip ${kindFilter === 'alle' ? 'active' : ''}" data-action="filter-appointments" data-kind="alle">
          Alle <span class="count">${visible.length}</span>
        </button>
        ${kindsPresent.map((kind) => `
          <button class="chip ${kindFilter === kind ? 'active' : ''}" data-action="filter-appointments" data-kind="${kind}">
            <span class="kind-dot" style="background:${kindInfo(kind).color}"></span>${esc(kindInfo(kind).label.split(' / ')[0])}
            <span class="count">${visible.filter((a) => (a.kind || 'baustelle') === kind).length}</span>
          </button>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-head">
        <div>
          <h2>${start.toLocaleDateString('de-DE', { day: '2-digit', month: 'long' })} – ${end.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}</h2>
          <div class="sub">${shown.length} ${shown.length === 1 ? 'Termin' : 'Termine'} in dieser Woche</div>
        </div>
        <div class="right">
          <button class="btn sm" data-action="week-prev">‹</button>
          <button class="btn sm" data-action="week-today">Heute</button>
          <button class="btn sm" data-action="week-next">›</button>
        </div>
      </div>
      <div class="calendar">
        <div class="cal-grid">
          <div class="cal-head"></div>
          ${days.map((date) => {
            const key = toDateInput(date);
            return `<div class="cal-head-cell ${key === todayKey ? 'today' : ''}">
              <div class="dow">${date.toLocaleDateString('de-DE', { weekday: 'short' })}</div>
              <div class="day">${date.getDate()}</div>
            </div>`;
          }).join('')}
          <div class="cal-times">
            ${hours.map((hour) => `<div class="cal-hour">${String(hour).padStart(2, '0')}:00</div>`).join('')}
          </div>
          ${days.map((date) => {
            const key = toDateInput(date);
            const dayEvents = shown.filter((a) => toDateInput(a.start_at) === key);
            return `<div class="cal-day ${key === todayKey ? 'today' : ''}" data-date="${key}">
              ${hours.map(() => '<div class="slot"></div>').join('')}
              ${dayEvents.map((event) => {
                const startDate = new Date(event.start_at);
                const endDate = new Date(event.end_at);
                const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
                const endMinutes = endDate.getHours() * 60 + endDate.getMinutes();
                const top = ((startMinutes - 7 * 60) / 60) * 52;
                const height = Math.max(26, ((endMinutes - startMinutes) / 60) * 52);
                const color = event.employee_color || '#0f4c5c';
                const info = kindInfo(event.kind);
                return `<div class="event" style="top:${top}px;height:${height}px;border-left-color:${color};background:${color}18;color:${color}"
                  data-action="open-appointment" data-id="${event.id}" data-order="${event.order_id || ''}" title="${esc(event.title)} · ${esc(info.label)}">
                  <div class="e-time"><span class="e-kdot" style="background:${info.color}"></span>${fmtTime(event.start_at)}–${fmtTime(event.end_at)}</div>
                  <div class="e-title">${esc(event.order_title || event.title)}</div>
                  <div class="e-sub">${esc(customerName(event))}</div>
                  <div class="e-sub">${esc(event.employee_name || '')}</div>
                  ${event.confirmed_at ? '<span class="e-flag ok" title="Vom Kunden bestätigt">✓</span>' : event.declined_at ? '<span class="e-flag no" title="Vom Kunden abgelehnt">✕</span>' : ''}
                </div>`;
              }).join('')}
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="cal-legend">
        ${state.employees.filter((e) => e.active).map((employee) => `
          <span class="legend-item"><span class="legend-dot" style="background:${esc(employee.color)}"></span>${esc(employee.name)}</span>`).join('')}
        <span class="legend-item" style="margin-left:auto"><span class="legend-dot" style="background:#0f4c5c"></span>Termin</span>
      </div>
    </div>`;

  $$('.cal-day', view).forEach((day) => {
    day.addEventListener('click', (event) => {
      if (!can('planning.manage')) return;
      if (event.target.closest('.event')) return;
      const rect = day.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const totalMinutes = Math.max(0, Math.floor(((y / 52) * 60) / 30) * 30);
      const hour = 7 + Math.floor(totalMinutes / 60);
      const minute = totalMinutes % 60;
      if (hour >= 20) return;
      const pad = (n) => String(n).padStart(2, '0');
      appointmentForm(null, {
        date: day.dataset.date,
        time: `${pad(hour)}:${pad(minute)}`,
        endTime: `${pad(Math.min(20, hour + 1))}:${pad(minute)}`,
      });
    });
  });
}

function appointmentForm(appointment = null, preset = {}) {
  const date = preset.date || todayISO();
  const kindOptions = Object.entries(APPOINTMENT_KINDS).map(([value, info]) => ({ value, label: info.label }));
  const customerOptions = (state.customers || []).map((customer) => ({ value: customer.id, label: customerFull(customer) }));
  const openForm = (orderOptions) => formModal({
    title: appointment ? 'Termin bearbeiten' : 'Neuer Termin',
    subtitle: appointment ? `${fmtDate(appointment.start_at)} · ${fmtTime(appointment.start_at)}` : 'Termin für einen Auftrag oder frei planen',
    fields: [
      { name: 'kind', label: 'Terminart', type: 'select', options: kindOptions, default: 'baustelle' },
      { name: 'employee_id', label: 'Mitarbeiter', type: 'select', placeholder: 'Nicht zugewiesen', options: state.employees.filter((e) => e.active).map((e) => ({ value: e.id, label: e.name })) },
      { name: 'title', label: 'Titel', required: true, full: true, default: preset.title || '', placeholder: 'z. B. Kundenbesuch Angebot, Meeting Büro, Baustelle' },
      { name: 'order_id', label: 'Auftrag', type: 'select', placeholder: 'Ohne Auftrag', options: orderOptions },
      { name: 'customer_id', label: 'Kunde', type: 'select', placeholder: 'Ohne Kunde', options: customerOptions },
      { name: 'location', label: 'Ort', placeholder: 'z. B. Büro, Werkstatt, beim Kunden' },
      { name: 'date', label: 'Datum', type: 'date', required: true, default: date },
      { name: 'start_time', label: 'Beginn', type: 'text', default: preset.time || '08:00', placeholder: '08:00' },
      { name: 'end_time', label: 'Ende', type: 'text', default: preset.endTime || '10:00', placeholder: '10:00' },
      { name: 'notes', label: 'Notiz', type: 'textarea', full: true, rows: 2 },
    ],
    values: appointment ? {
      kind: appointment.kind || 'baustelle',
      title: appointment.title,
      order_id: appointment.order_id ?? '',
      customer_id: appointment.customer_id ?? '',
      employee_id: appointment.employee_id ?? '',
      location: appointment.location || '',
      date: toDateInput(appointment.start_at),
      start_time: fmtTime(appointment.start_at),
      end_time: fmtTime(appointment.end_at),
      notes: appointment.notes,
    } : { kind: preset.kind || 'baustelle' },
    submitLabel: 'Speichern',
    onSubmit: async (data) => {
      const start_at = new Date(`${data.date}T${data.start_time || '08:00'}`).toISOString();
      const end_at = new Date(`${data.date}T${data.end_time || '10:00'}`).toISOString();
      const payload = {
        kind: data.kind,
        title: data.title,
        order_id: data.order_id || null,
        customer_id: data.customer_id || null,
        employee_id: data.employee_id || null,
        location: data.location,
        start_at,
        end_at,
        notes: data.notes,
      };
      if (appointment) await api.put(`/api/appointments/${appointment.id}`, payload);
      else await api.post('/api/appointments', payload);
      toast('Termin gespeichert.');
      closeModal();
      refresh();
    },
  });

  api.get('/api/orders').then((orders) => {
    const orderOptions = orders
      .filter((order) => order.doc_type === 'auftrag' && order.status !== 'storniert' && !order.invoice_number)
      .map((order) => ({ value: order.id, label: `${order.number} · ${order.title}` }));
    state.orderOptions = orderOptions;
    openForm(orderOptions);
  }).catch(() => openForm(state.orderOptions || []));
}

async function openAppointment(appointmentId, orderId) {
  if (orderId) {
    openOrder(Number(orderId));
    return;
  }
  const appointments = await api.get(`/api/appointments?from=${addDaysISO(todayISO(), -60)}&to=${addDaysISO(todayISO(), 120)}`);
  const appointment = appointments.find((a) => a.id === Number(appointmentId));
  if (!appointment) return;
  state.currentAppointment = appointment;
  openModal({
    title: appointment.title,
    subtitle: `${fmtDate(appointment.start_at)} · ${fmtTime(appointment.start_at)}–${fmtTime(appointment.end_at)} Uhr`,
    body: `
      <dl class="kv">
        <dt>Monteur</dt><dd>${esc(appointment.employee_name || 'nicht zugewiesen')}</dd>
        <dt>Kunde</dt><dd>${esc(customerName(appointment) || '–')}</dd>
        <dt>Auftrag</dt><dd>${esc(appointment.order_number || '–')}</dd>
        <dt>Notiz</dt><dd>${esc(appointment.notes || '–')}</dd>
      </dl>
      ${appointmentConfirmSection(appointment)}`,
    footer: `
      <div class="left">
        ${can('planning.manage') ? `<button class="btn sm" data-action="edit-appointment" data-id="${appointment.id}">${icon('edit')} Bearbeiten</button>
        <button class="btn sm danger" data-action="delete-appointment" data-id="${appointment.id}">${icon('trash')} Löschen</button>` : ''}
      </div>
      <button class="btn" data-action="close-modal">Schließen</button>`,
  });
}

const appointmentLink = (appointment) =>
  appointment?.confirm_token ? `${location.origin}/termin/${appointment.confirm_token}` : '';

function confirmStatusBadge(appointment) {
  if (appointment.confirmed_at) return '<span class="badge erledigt">bestätigt</span>';
  if (appointment.declined_at) return '<span class="badge storniert">abgelehnt</span>';
  return '<span class="badge neu">offen</span>';
}

function appointmentConfirmSection(appointment) {
  const link = appointmentLink(appointment);
  const manage = can('planning.manage');
  let statusText = 'Der Kunde hat den Termin noch nicht bestätigt.';
  if (appointment.confirmed_at) {
    statusText = `Vom Kunden bestätigt am ${fmtDateTime(appointment.confirmed_at)}.`;
  } else if (appointment.declined_at) {
    statusText = `Vom Kunden abgelehnt am ${fmtDateTime(appointment.declined_at)}${appointment.customer_reply ? `: „${esc(appointment.customer_reply)}“` : '.'}`;
  }

  if (!link) {
    return `<div class="subcard">
      <h4 style="display:flex;align-items:center">Terminbestätigung ${confirmStatusBadge(appointment)}</h4>
      <div class="small muted">Noch kein Bestätigungslink erzeugt.</div>
      ${manage ? `<div style="margin-top:10px">
        <button class="btn sm" data-action="appointment-link" data-id="${appointment.id}">${icon('send')} Bestätigungslink erzeugen</button>
      </div>` : `<div class="small muted" style="margin-top:6px">Links können Büro, Vorgesetzte und Chef erzeugen.</div>`}
    </div>`;
  }

  return `<div class="subcard">
    <h4 style="display:flex;align-items:center">Terminbestätigung ${confirmStatusBadge(appointment)}</h4>
    <div class="link-box">
      <input id="confirm-link" type="text" readonly value="${esc(link)}" aria-label="Bestätigungslink" />
      <button class="btn sm" data-action="appointment-copy" data-id="${appointment.id}">${icon('file')} Kopieren</button>
    </div>
    <div class="small muted" style="margin-top:8px">${statusText}</div>
    ${manage ? `<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="btn sm" data-action="appointment-mail" data-id="${appointment.id}">${icon('mail')} Per E-Mail senden</button>
      <button class="btn sm" data-action="appointment-reset" data-id="${appointment.id}">${icon('refresh')} Zurücksetzen</button>
    </div>` : ''}
  </div>`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* Fallback unten */ }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  return ok;
}

/* ------------------------------------------------------------------ Zeiterfassung */
async function renderTime() {
  const manager = can('time.view.all');
  const from = state.timeFrom || addDaysISO(todayISO(), -13);
  state.timeFrom = from;
  const entries = await api.get(`/api/time?from=${from}&to=${todayISO()}`);
  const total = entries.reduce((sum, entry) => sum + (entry.minutes || 0), 0);

  const employeeOptions = state.employees.map((employee) => ({ value: employee.id, label: employee.name }));
  view.innerHTML = `
    ${clockCard({ time: state.time, todayMinutes: state.todayMinutes, weekMinutes: state.weekMinutes })}
    <div class="section-head">
      <div><h2>${manager ? 'Alle Zeiten' : 'Meine Zeiten'}</h2><div class="sub">Letzte 14 Tage · ${formatDuration(total)} gesamt</div></div>
      <button class="btn sm" type="button" data-action="new-time">${icon('plus')} Zeit nachtragen</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Tag</th>${manager ? '<th>Mitarbeiter</th>' : ''}<th>Auftrag</th><th>Von</th><th>Bis</th><th class="right">Dauer</th><th>Notiz</th><th></th></tr></thead>
          <tbody>
            ${entries.length ? entries.map((entry) => `
              <tr>
                <td class="nowrap">${fmtDate(entry.start_at)}</td>
                ${manager ? `<td>${esc(entry.employee_name || entry.user_name || '–')}</td>` : ''}
                <td>${entry.order_id ? `<button class="link-btn" type="button" data-action="open-order" data-id="${entry.order_id}">${esc(entry.order_number || `#${entry.order_id}`)}</button>` : '<span class="muted">–</span>'}</td>
                <td class="nowrap">${fmtTime(entry.start_at)}</td>
                <td class="nowrap">${entry.end_at ? fmtTime(entry.end_at) : '<span class="badge in_arbeit">läuft</span>'}</td>
                <td class="right strong">${formatDuration(entry.minutes)}</td>
                <td class="small muted">${esc(entry.note || '')}</td>
                <td class="right"><button class="icon-btn" type="button" data-action="delete-time" data-id="${entry.id}" title="Eintrag löschen">${icon('trash')}</button></td>
              </tr>`).join('') : `<tr><td colspan="${manager ? 8 : 7}"><div class="empty">${icon('clock')}<div>Noch keine Zeiten im Zeitraum</div></div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
  bindLiveClock();
  state.employeeOptions = employeeOptions;
}

function timeForm() {
  const manager = can('time.manage');
  formModal({
    title: 'Zeit nachtragen',
    subtitle: 'Arbeitszeit manuell erfassen.',
    fields: [
      ...(manager ? [{ name: 'employee_id', label: 'Mitarbeiter', type: 'select', options: state.employees.map((e) => ({ value: e.id, label: e.name })), placeholder: 'Bitte wählen', required: true }] : []),
      { name: 'date', label: 'Datum', type: 'date', required: true, default: todayISO() },
      { name: 'start', label: 'Von', type: 'time', required: true, default: '08:00' },
      { name: 'end', label: 'Bis', type: 'time', required: true, default: '16:00' },
      { name: 'order_id', label: 'Auftrag (optional)', type: 'select', options: (state.orderOptions || []), placeholder: 'Ohne Auftrag' },
      { name: 'type', label: 'Art', type: 'select', options: [
        { value: 'arbeit', label: 'Arbeit' }, { value: 'fahrt', label: 'Fahrt' },
        { value: 'urlaub', label: 'Urlaub' }, { value: 'krank', label: 'Krank' }, { value: 'schule', label: 'Schule' },
      ], default: 'arbeit' },
      { name: 'note', label: 'Notiz', full: true },
    ],
    submitLabel: 'Speichern',
    onSubmit: async (values) => {
      const start = new Date(`${values.date}T${values.start}`);
      const end = new Date(`${values.date}T${values.end}`);
      if (end <= start) throw new Error('Das Ende muss nach dem Start liegen');
      await api.post('/api/time', {
        employee_id: manager ? values.employee_id : undefined,
        order_id: values.order_id || null,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        type: values.type,
        note: values.note,
      });
      closeModal();
      toast('Zeit gespeichert.');
      await refreshSelfTime();
      await refresh();
    },
  });
}

async function toggleTime(orderId = null) {
  try {
    if (state.time) {
      const entry = await api.post('/api/time/stop', {});
      state.time = null;
      toast(`Ausgestempelt – ${formatDuration(entry.minutes)} erfasst.`);
      speak('Ausgestempelt.');
    } else {
      const entry = await api.post('/api/time/start', { order_id: orderId || null });
      state.time = entry;
      toast(`Eingestempelt${entry.order_number ? ` auf ${entry.order_number}` : ''}.`);
      speak('Eingestempelt.');
    }
    await refreshSelfTime();
    if (state.page === 'time' || state.page === 'my') {
      await refresh();
    } else if (state.currentOrderId) {
      await openOrder(state.currentOrderId);
    }
    updateBadges();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function refreshSelfTime() {
  try {
    const data = await api.get('/api/auth/me');
    state.time = data.time;
    state.todayMinutes = data.todayMinutes;
    state.weekMinutes = data.weekMinutes;
  } catch { /* stumm */ }
}

/* ------------------------------------------------------------------ Berichte */
async function renderReports() {
  const manager = can('reports.view.all');
  const filter = state.reportsFilter;
  const reports = await api.get('/api/reports');
  const visible = reports.filter((report) => filter === 'alle' || report.status === filter);
  const chips = [
    ['alle', 'Alle'], ['entwurf', 'Entwürfe'], ['eingereicht', 'Eingereicht'],
    ['freigegeben', 'Freigegeben'], ['abgerechnet', 'Abgerechnet'],
  ];

  view.innerHTML = `
    <div class="toolbar">
      <div class="chips">
        ${chips.map(([value, label]) => `
          <button class="chip ${filter === value ? 'active' : ''}" type="button" data-action="filter-reports" data-filter="${value}">
            ${label} <span class="count">${value === 'alle' ? reports.length : reports.filter((r) => r.status === value).length}</span>
          </button>`).join('')}
      </div>
    </div>
    <div class="report-grid">
      ${visible.length ? visible.map((report) => `
        <button class="report-card" type="button" data-action="open-report" data-id="${report.id}">
          <div class="report-top">
            <span class="badge ${esc(report.status)}">${REPORT_STATUS_LABELS[report.status] || report.status}</span>
            <span class="muted small">${fmtDate(report.created_at)}</span>
          </div>
          <h3>${esc(report.order_title)}</h3>
          <div class="small muted">${esc(report.order_number)} · ${esc(customerName(report))}</div>
          <p>${esc((report.content || '').slice(0, 130))}${(report.content || '').length > 130 ? '…' : ''}</p>
          <div class="report-foot">
            <span>${icon('user')} ${esc(report.employee_name || report.user_name || '–')}</span>
            <span>${icon('box')} ${report.material_count}</span>
            <span>${icon('camera')} ${report.photo_count}</span>
            <span>${icon('clock')} ${num2(report.hours)} Std.</span>
          </div>
        </button>`).join('') : `<div class="card"><div class="card-body pad"><div class="empty">${icon('file')}<div><b>Keine Berichte</b><div class="small">${manager ? 'Sobald Monteure Berichte einreichen, erscheinen sie hier.' : 'Erstelle deinen ersten Montagebericht.'}</div></div>
          ${can('reports.own') ? `<div style="margin-top:10px"><button class="btn primary" data-action="new-report">Bericht erstellen</button></div>` : ''}</div></div></div>`}
    </div>`;
}

async function newReportModal(orderId = null, { dictate = false } = {}) {
  if (!can('reports.own')) return toast('Keine Berechtigung zum Erstellen von Berichten.', 'error');
  if (!(state.orderOptions || []).length) {
    try {
      const list = await api.get('/api/orders');
      state.orderOptions = list
        .filter((order) => order.doc_type === 'auftrag' && order.status !== 'storniert')
        .map((order) => ({ value: order.id, label: `${order.number} · ${order.title}` }));
    } catch { /* stumm */ }
  }
  const orders = state.orderOptions || [];
  formModal({
    title: 'Neuer Bericht',
    subtitle: 'Bericht diktieren, schreiben oder Material erfassen.',
    size: 'xwide',
    fields: [
      { name: 'order_id', label: 'Auftrag', type: 'select', options: orders, required: true, default: orderId || state.currentOrderId || '' },
      { name: 'type', label: 'Berichtstyp', type: 'select', options: Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => ({ value, label })), default: 'montage' },
      { name: 'weather', label: 'Wetter', placeholder: 'z. B. trocken, 12 °C' },
      { name: 'hours', label: 'Arbeitsstunden', type: 'number', step: '0.25', min: 0, default: 0 },
      {
        name: 'content', label: 'Bericht', type: 'textarea', rows: 7, full: true, required: true, dictate: true,
        placeholder: 'Was wurde gemacht? Material, Auffälligkeiten, Kunde eingewiesen …',
        hint: 'Tippe auf „Diktieren“ und sprich den Bericht – Text erscheint automatisch.',
      },
      { name: 'auto_parse', label: 'Material automatisch aus dem Text erkennen', type: 'checkbox', full: true, default: true, checkLabel: 'Materialvorschläge automatisch übernehmen' },
    ],
    submitLabel: 'Bericht speichern',
    onSubmit: async (values) => {
      const result = await api.post('/api/reports', {
        ...values,
        order_id: Number(values.order_id),
        hours: Number(values.hours) || 0,
      });
      closeModal();
      toast('Bericht gespeichert.');
      await refreshSelfTime();
      await refresh();
      await openReport(result.report.id);
    },
  });

  if (dictate) {
    setTimeout(() => {
      const textarea = $('#modal-form textarea[name="content"]');
      if (!textarea) return;
      listenInline(textarea, $('[data-dictate-status="content"]'));
    }, 320);
  }
}

function reportEditorBody(data) {
  const { report, materials, photos } = data;
  const canEdit = report.status !== 'abgerechnet'
    && (can('reports.manage') || report.user_id === state.user?.id
      || (state.user?.employee_id != null && report.employee_id === state.user.employee_id));
  const beforePhotos = photos.filter((photo) => photo.kind === 'vorher');
  const afterPhotos = photos.filter((photo) => photo.kind === 'nachher');
  const comparePairs = Math.min(beforePhotos.length, afterPhotos.length);
  return `
    <div class="detail-head">
      <div class="dh-main">
        <span class="badge ${esc(report.status)}">${REPORT_STATUS_LABELS[report.status] || report.status}</span>
        <h3>${esc(report.order_title)}</h3>
        <div class="muted small">${esc(report.order_number)} · ${fmtDateTime(report.created_at)} · ${esc(report.employee_name || report.user_name || '')}</div>
      </div>
      <div class="small muted">${esc(customerName(report))}${report.property_label ? ` · ${esc(report.property_label)}` : ''}</div>
    </div>

    <div class="tech-actions">
      <button class="tech-btn" type="button" data-action="report-dictate" data-id="${report.id}">${icon('mic')}<span>Diktieren</span></button>
      <button class="tech-btn" type="button" data-action="report-parse" data-id="${report.id}">${icon('box')}<span>Material erkennen</span></button>
      <button class="tech-btn" type="button" data-action="upload-photo" data-id="${report.order_id}" data-report="${report.id}" data-kind="vorher">${icon('camera')}<span>Vorher</span></button>
      <button class="tech-btn" type="button" data-action="upload-photo" data-id="${report.order_id}" data-report="${report.id}" data-kind="nachher">${icon('camera')}<span>Nachher</span></button>
    </div>

    <form id="report-form" class="form-grid">
      <div class="field"><label>Typ</label><select name="type" ${canEdit ? '' : 'disabled'}>
        ${Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => `<option value="${value}" ${report.type === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select></div>
      <div class="field"><label>Wetter</label><input name="weather" value="${esc(report.weather || '')}" ${canEdit ? '' : 'disabled'} /></div>
      <div class="field"><label>Stunden</label><input name="hours" type="number" step="0.25" min="0" value="${report.hours}" ${canEdit ? '' : 'disabled'} /></div>
      <div class="field"><label>Status</label><select name="status" ${canEdit ? '' : 'disabled'}>
        ${Object.entries(REPORT_STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${report.status === value ? 'selected' : ''} ${value === 'freigegeben' && !can('reports.approve') ? 'disabled' : ''}>${label}</option>`).join('')}
      </select></div>
      <div class="field full"><label>Bericht</label>
        <textarea id="report-content" name="content" rows="7" ${canEdit ? '' : 'disabled'} placeholder="Bericht eingeben oder über das Mikrofon diktieren …">${esc(report.content || '')}</textarea>
        <span class="hint" id="report-dictation-status"></span>
      </div>
    </form>

    <div class="subcard">
      <h4>Verwendetes Material <span class="muted small">(${materials.length})</span></h4>
      ${materials.length ? `
        <div class="material-list">
          ${materials.map((material) => `
            <div class="material-row">
              <span>${icon('box')}</span>
              <span class="mat-main"><b>${esc(material.description)}</b><small>${material.source === 'sprache' ? 'per Sprache erkannt' : 'manuell'}</small></span>
              <span class="mat-qty">${num2(material.quantity)} ${esc(material.unit)}</span>
              ${canEdit ? `<button class="icon-btn" type="button" data-action="delete-report-material" data-id="${material.id}" data-report="${report.id}" title="Material entfernen">${icon('trash')}</button>` : ''}
            </div>`).join('')}
        </div>` : '<div class="small muted">Noch kein Material erfasst – nutze „Material erkennen“ oder füge es manuell hinzu.</div>'}
      ${canEdit ? `
        <div class="material-add">
          <select id="material-article">
            <option value="">Freies Material…</option>
            ${(state.articles || []).map((article) => `<option value="${article.id}" data-name="${esc(article.name)}" data-unit="${esc(article.unit)}">${esc(article.name)} (${esc(article.unit)})</option>`).join('')}
          </select>
          <input id="material-desc" placeholder="Bezeichnung" />
          <input id="material-qty" type="number" step="0.01" min="0" value="1" />
          <input id="material-unit" value="Stk" />
          <button class="btn sm primary" type="button" data-action="add-report-material" data-id="${report.id}">Hinzufügen</button>
        </div>
        <div class="row-actions">
          <button class="btn sm" type="button" data-action="report-parse" data-id="${report.id}">${icon('mic')} Material aus Bericht übernehmen</button>
        </div>` : ''}
    </div>

    <div class="subcard">
      <h4>Fotos <span class="muted small">(${photos.length})</span></h4>
      ${photos.length ? `
        ${comparePairs ? `<div class="compare-wrap">${beforePhotos.slice(0, comparePairs).map((before, index) => `
          <div class="compare" data-compare style="--pos:50%">
            <img src="${before.url}" alt="Vorher" />
            <div class="cmp-after"><img src="${afterPhotos[index].url}" alt="Nachher" /></div>
            <input type="range" min="0" max="100" value="50" class="cmp-range" />
            <span class="cmp-tag left">Vorher</span><span class="cmp-tag right">Nachher</span>
          </div>`).join('')}</div>` : ''}
        <div class="photo-grid">
          ${photos.map((photo) => `
            <figure class="photo-tile">
              <img src="${photo.url}" alt="${esc(photo.caption || photo.kind)}" loading="lazy" data-action="show-photo" data-src="${photo.url}" />
              <figcaption>${esc(photo.caption || (photo.kind === 'vorher' ? 'Vorher' : photo.kind === 'nachher' ? 'Nachher' : 'Foto'))}</figcaption>
              ${can('photos.manage') || photo.employee_id === state.user?.employee_id
                ? `<button class="photo-del" type="button" data-action="delete-photo" data-id="${photo.id}" data-order="${report.order_id}" data-report="${report.id}" title="Foto löschen">${icon('trash')}</button>`
                : ''}
            </figure>`).join('')}
        </div>` : '<div class="small muted">Noch keine Fotos – gleich mehrere Bilder zur Dokumentation hinzufügen.</div>'}
      <div class="photo-grid" style="margin-top:10px">
        <button class="photo-add" type="button" data-action="upload-photo" data-id="${report.order_id}" data-report="${report.id}" data-kind="vorher">
          ${icon('camera')}<span>Vorher-Fotos</span><small>einzeln oder mehrere</small>
        </button>
        <button class="photo-add" type="button" data-action="upload-photo" data-id="${report.order_id}" data-report="${report.id}" data-kind="nachher">
          ${icon('camera')}<span>Nachher-Fotos</span><small>einzeln oder mehrere</small>
        </button>
      </div>
    </div>
  `;
}

function reportEditorFooter(data) {
  const { report } = data;
  const canEdit = report.status !== 'abgerechnet'
    && (can('reports.manage') || report.user_id === state.user?.id
      || (state.user?.employee_id != null && report.employee_id === state.user.employee_id));
  return `
    <div class="left">
      ${can('reports.approve') && report.status !== 'freigegeben' && report.status !== 'abgerechnet'
        ? `<button class="btn sm" type="button" data-action="approve-report" data-id="${report.id}">${icon('check')} Freigeben</button>` : ''}
      ${can('reports.manage') && !report.applied_at
        ? `<button class="btn sm primary" type="button" data-action="apply-report" data-id="${report.id}">${icon('send')} Material in Auftrag übernehmen</button>` : ''}
      ${can('reports.manage') || (canEdit && !report.applied_at)
        ? `<button class="btn sm danger" type="button" data-action="delete-report" data-id="${report.id}">${icon('trash')}</button>` : ''}
    </div>
    ${canEdit ? `<button class="btn primary" type="button" data-action="save-report" data-id="${report.id}">${icon('check')} Speichern</button>` : ''}
    <button class="btn" type="button" data-action="close-modal">Schließen</button>`;
}

async function openReport(reportId, { keepModal = false } = {}) {
  const data = await api.get(`/api/reports/${reportId}`);
  state.currentReportId = reportId;
  const report = data.report;
  state.currentOrderId = report.order_id;
  if (!keepModal) {
    openModal({
      title: 'Montagebericht',
      subtitle: `${report.order_number} · ${customerName(report)}`,
      size: 'xwide',
      body: reportEditorBody(data),
      footer: reportEditorFooter(data),
    });
    bindCompareSliders($('#modal-root'));
    bindReportEditor(data);
  }
  return data;
}

function bindReportEditor(data) {
  const modal = $('#modal-root .modal');
  if (!modal) return;
  const articleSelect = $('#material-article', modal);
  articleSelect?.addEventListener('change', () => {
    const option = articleSelect.selectedOptions[0];
    if (!option?.value) return;
    $('#material-desc', modal).value = option.dataset.name || '';
    $('#material-unit', modal).value = option.dataset.unit || 'Stk';
  });
}

async function saveReport(reportId) {
  const form = $('#report-form');
  if (!form) return;
  const values = {
    type: form.elements.type.value,
    weather: form.elements.weather.value,
    hours: Number(form.elements.hours.value) || 0,
    status: form.elements.status.value,
    content: form.elements.content.value,
  };
  try {
    await api.put(`/api/reports/${reportId}`, values);
    toast('Bericht gespeichert.');
    await openReport(reportId);
    if (state.page === 'reports') refresh();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function runReportParse(reportId) {
  const content = $('#report-content')?.value || '';
  try {
    const result = await api.post(`/api/reports/${reportId}/parse`, { text: content });
    if (!result.materials.length) {
      toast('Kein Material im Text erkannt. Beispiel: „3 Meter Kupferrohr und 2 Dichtungen“.', 'info');
      return;
    }
    await api.post(`/api/reports/${reportId}/materials`, { materials: result.materials });
    toast(`${result.materials.length} Materialposition(en) übernommen.`);
    await openReport(reportId);
    speak(`${result.materials.length} Materialpositionen übernommen.`);
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function addReportMaterial(reportId) {
  const modal = $('#modal-root .modal');
  const description = $('#material-desc', modal)?.value.trim();
  const articleId = $('#material-article', modal)?.value;
  const quantity = Number($('#material-qty', modal)?.value) || 0;
  const unit = $('#material-unit', modal)?.value || 'Stk';
  if (!description) return toast('Bitte eine Materialbezeichnung angeben.', 'error');
  if (!quantity) return toast('Bitte eine Menge angeben.', 'error');
  try {
    await api.post(`/api/reports/${reportId}/materials`, {
      materials: [{ article_id: articleId || null, description, quantity, unit, source: 'manuell' }],
    });
    toast('Material hinzugefügt.');
    await openReport(reportId);
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------------------------------------------ Team & Personal */
async function renderTeam() {
  const employees = await api.get('/api/employees');
  state.employees = employees;
  let stats = [];
  if (can('time.view.all')) {
    const from = addDaysISO(todayISO(), -6);
    const time = await api.get(`/api/time?from=${from}&to=${todayISO()}`);
    stats = employees.map((employee) => {
      const entries = time.filter((entry) => entry.employee_id === employee.id);
      return {
        employee,
        week: entries.reduce((sum, entry) => sum + (entry.minutes || 0), 0),
        today: entries.filter((entry) => toDateInput(entry.start_at) === todayISO())
          .reduce((sum, entry) => sum + (entry.minutes || 0), 0),
        running: entries.some((entry) => !entry.end_at),
      };
    });
  }
  const pending = can('reports.view.all') ? await api.get('/api/reports?status=eingereicht') : [];

  view.innerHTML = `
    <div class="kpi-grid tight">
      <div class="kpi"><div class="ico">${icon('users')}</div><div class="label">Mitarbeiter</div><div class="value">${employees.length}</div><div class="foot">${employees.filter((e) => e.active).length} aktiv</div></div>
      ${can('time.view.all') ? `<div class="kpi"><div class="ico">${icon('clock')}</div><div class="label">Stunden diese Woche</div><div class="value">${(Math.round(stats.reduce((s, r) => s + r.week, 0) / 6) / 10).toLocaleString('de-DE')}</div><div class="foot">Team gesamt</div></div>` : ''}
      ${can('reports.view.all') ? `<div class="kpi link" data-action="goto" data-page="reports"><div class="ico">${icon('file')}</div><div class="label">Offene Berichte</div><div class="value">${pending.length}</div><div class="foot">warten auf Freigabe</div></div>` : ''}
    </div>

    <div class="section-head">
      <div><h2>Team</h2><div class="sub">Anwesenheit und Kontaktdaten</div></div>
      ${can('employees.manage') ? `<button class="btn sm" type="button" data-action="new-employee">${icon('plus')} Mitarbeiter</button>` : ''}
    </div>

    <div class="team-grid">
      ${stats.length ? stats.map(({ employee, week, today, running }) => `
        <div class="team-card">
          <span class="avatar large" style="background:${esc(employee.color || '#0f766e')}">${esc((employee.name || '?').split(' ').map((p) => p[0]).slice(0, 2).join(''))}</span>
          <div class="team-main">
            <h3>${esc(employee.name)}</h3>
            <div class="small muted">${esc(employee.role || '')}${employee.phone ? ` · ${esc(employee.phone)}` : ''}</div>
            <div class="team-stats">
              <span class="badge ${running ? 'in_arbeit' : 'neutral'}">${running ? 'eingestempelt' : 'nicht aktiv'}</span>
              <span>Heute ${formatDuration(today)}</span>
              <span>Woche ${formatDuration(week)}</span>
            </div>
          </div>
          <div class="team-actions">
            ${employee.phone ? `<a class="icon-btn" href="tel:${esc(employee.phone.replace(/[^+\d]/g, ''))}" title="Anrufen">${icon('phone')}</a>` : ''}
            ${can('employees.manage') ? `<button class="icon-btn" type="button" data-action="edit-employee" data-id="${employee.id}" title="Bearbeiten">${icon('edit')}</button>` : ''}
            ${can('users.manage') ? `<button class="icon-btn" type="button" data-action="new-user" data-employee="${employee.id}" title="Benutzerkonto anlegen">${icon('user')}</button>` : ''}
          </div>
        </div>`).join('') : employees.map((employee) => `
        <div class="team-card">
          <span class="avatar large" style="background:${esc(employee.color || '#0f766e')}">${esc((employee.name || '?').split(' ').map((p) => p[0]).slice(0, 2).join(''))}</span>
          <div class="team-main">
            <h3>${esc(employee.name)}</h3>
            <div class="small muted">${esc(employee.role || '')}${employee.phone ? ` · ${esc(employee.phone)}` : ''}</div>
          </div>
          <div class="team-actions">
            ${can('employees.manage') ? `<button class="icon-btn" type="button" data-action="edit-employee" data-id="${employee.id}" title="Bearbeiten">${icon('edit')}</button>` : ''}
          </div>
        </div>`).join('')}
    </div>

    ${pending.length ? `
      <div class="card" style="margin-top:18px">
        <div class="card-head"><div><h2>Berichte zur Freigabe</h2><div class="sub">Eingereicht von Monteuren</div></div></div>
        <div class="card-body">
          ${pending.map((report) => `
            <button class="list-row" type="button" data-action="open-report" data-id="${report.id}">
              <span class="list-ico">${icon('file')}</span>
              <span class="list-main"><b>${esc(report.order_number)} · ${esc(report.order_title)}</b>
                <small>${esc(report.employee_name || report.user_name || '')} · ${fmtDate(report.created_at)}</small></span>
              ${icon('arrow')}
            </button>`).join('')}
        </div>
      </div>` : ''}`;
}

function employeeEditForm(employeeId = null) {
  const employee = state.employees.find((e) => e.id === Number(employeeId));
  formModal({
    title: employee ? `${employee.name} bearbeiten` : 'Mitarbeiter anlegen',
    fields: [
      { name: 'name', label: 'Name', required: true, default: employee?.name || '' },
      { name: 'role', label: 'Funktion', default: employee?.role || 'Monteur' },
      { name: 'phone', label: 'Telefon', default: employee?.phone || '' },
      { name: 'rate', label: 'Stundensatz (€)', type: 'number', step: '0.01', min: 0, default: employee?.rate ?? '' },
      { name: 'color', label: 'Farbe', type: 'color', default: employee?.color || '#0f766e' },
      { name: 'active', label: 'Aktiv', type: 'checkbox', default: employee ? employee.active : 1, checkLabel: 'Mitarbeiter ist aktiv' },
    ],
    submitLabel: employee ? 'Speichern' : 'Anlegen',
    onSubmit: async (values) => {
      if (employee) await api.put(`/api/employees/${employee.id}`, values);
      else await api.post('/api/employees', values);
      closeModal();
      toast('Mitarbeiter gespeichert.');
      await loadBase();
      await refresh();
    },
  });
}

/* ------------------------------------------------------------------ Benutzer & Rechte */
async function renderUsers() {
  const users = await api.get('/api/users');
  state.usersCache = users;
  const roles = state.meta.roles || [];
  view.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h2>Benutzerkonten</h2><div class="sub">Rollen und Zugriffsrechte</div></div>
        <button class="btn sm primary" type="button" data-action="new-user">${icon('plus')} Benutzer</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Benutzer</th><th>Rolle</th><th>Mitarbeiter</th><th>Letzter Login</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${users.map((user) => `
              <tr>
                <td><div class="cell-main">${esc(user.name)}</div><div class="cell-sub">@${esc(user.username)}</div></td>
                <td><span class="role-badge" style="--role:${esc(roles.find((r) => r.key === user.role)?.color || '#475569')}">${esc(user.role_label)}</span></td>
                <td>${esc(user.employee_name || '–')}</td>
                <td class="nowrap small muted">${user.last_login ? fmtDateTime(user.last_login) : 'noch nie'}</td>
                <td>${user.active ? '<span class="badge bezahlt">aktiv</span>' : '<span class="badge storniert">inaktiv</span>'}</td>
                <td class="right nowrap">
                  <button class="icon-btn" type="button" data-action="edit-user" data-id="${user.id}" title="Bearbeiten">${icon('edit')}</button>
                  <button class="icon-btn" type="button" data-action="delete-user" data-id="${user.id}" title="Löschen">${icon('trash')}</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="card-head"><div><h2>Rollen & Rechte</h2><div class="sub">Was jede Rolle sehen und tun darf</div></div></div>
      <div class="card-body role-grid">
        ${roles.map((role) => `
          <div class="role-card" style="--role:${esc(role.color)}">
            <h3>${esc(role.label)}</h3>
            <p>${esc(role.description)}</p>
            <div class="small muted">${role.permissions.includes('*') ? 'Alle Rechte' : `${role.permissions.length} Einzelrechte`}</div>
          </div>`).join('')}
      </div>
    </div>`;
}

function userForm(userId = null, presetEmployee = null) {
  const user = userId ? state.usersCache?.find((u) => u.id === Number(userId)) : null;
  const roles = state.meta.roles || [];
  formModal({
    title: user ? `Benutzer ${user.username} bearbeiten` : 'Benutzerkonto anlegen',
    subtitle: user ? 'Rolle, Mitarbeiter-Verknüpfung und Passwort ändern.' : 'Neues Konto mit Rolle und Startpasswort.',
    fields: [
      { name: 'username', label: 'Benutzername', required: true, default: user?.username || '' },
      { name: 'name', label: 'Anzeigename', required: true, default: user?.name || '' },
      { name: 'role', label: 'Rolle', type: 'select', options: roles.map((role) => ({ value: role.key, label: role.label })), required: true, default: user?.role || 'monteur' },
      { name: 'employee_id', label: 'Mitarbeiter verknüpfen', type: 'select', placeholder: 'Kein Mitarbeiter', options: state.employees.map((e) => ({ value: e.id, label: e.name })), default: user?.employee_id || presetEmployee || '' },
      { name: 'password', label: user ? 'Neues Passwort (optional)' : 'Passwort', type: 'password', required: !user, hint: 'Mindestens 8 Zeichen' },
      ...(user ? [{ name: 'active', label: 'Konto aktiv', type: 'checkbox', default: user.active, checkLabel: 'Anmeldung erlauben' }] : []),
    ],
    submitLabel: user ? 'Speichern' : 'Anlegen',
    onSubmit: async (values) => {
      const payload = { ...values, employee_id: values.employee_id || null };
      if (user) {
        if (!payload.password) delete payload.password;
        await api.put(`/api/users/${user.id}`, payload);
      } else {
        await api.post('/api/users', payload);
      }
      closeModal();
      toast('Benutzer gespeichert.');
      await renderUsers();
    },
  });
}

/* ------------------------------------------------------------------ Sprache */
function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'de-DE';
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  } catch { /* stumm */ }
}

function listenInline(textarea, statusEl, label = 'Bericht') {
  const recognition = startVoiceRecognition('report');
  if (!recognition) {
    if (statusEl) statusEl.textContent = 'Spracherkennung nicht verfügbar – bitte Text eingeben.';
    return;
  }
  if (statusEl) statusEl.textContent = `Ich höre … ${label} sprechen.`;
  let finalText = '';
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript;
      else interim += transcript;
    }
    if (statusEl) statusEl.textContent = finalText || interim || 'Ich höre …';
  };
  recognition.onerror = () => {
    if (statusEl) statusEl.textContent = 'Mikrofon nicht verfügbar. Bitte Text eingeben oder HTTPS verwenden.';
  };
  recognition.onend = () => {
    const text = finalText.trim();
    if (!text) {
      if (statusEl) statusEl.textContent = 'Nichts erkannt – bitte erneut versuchen.';
      return;
    }
    textarea.value = `${textarea.value ? `${textarea.value} ` : ''}${text}`;
    textarea.dispatchEvent(new Event('change'));
    if (statusEl) statusEl.textContent = 'Diktat übernommen – nicht vergessen zu speichern.';
    speak('Diktat übernommen.');
  };
  try { recognition.start(); } catch {
    if (statusEl) statusEl.textContent = 'Aufnahme läuft bereits.';
  }
}

function openVoiceModal(mode = 'command') {
  const supported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  openModal({
    title: 'Sprachsteuerung',
    subtitle: mode === 'report' ? 'Bericht diktieren' : 'Auftrag öffnen, stempeln, Bericht oder Material',
    size: 'wide',
    body: `
      <div class="voice-panel">
        <button class="voice-orb" type="button" data-action="voice-listen" data-mode="${mode}" id="voice-orb">
          ${icon('mic')}
          <span>${supported ? 'Tippen und sprechen' : 'Spracheingabe nicht verfügbar'}</span>
        </button>
        <div class="voice-status" id="voice-status">${supported ? 'Mikrofon antippen und Befehl sprechen.' : 'Bitte den Befehl als Text eingeben.'}</div>
        <div class="voice-examples">
          <button type="button" class="chip" data-action="voice-example" data-text="Öffne Auftrag AU-2026-0001">„Öffne Auftrag AU-2026-0001“</button>
          <button type="button" class="chip" data-action="voice-example" data-text="Bericht für Müller">„Bericht für Müller“</button>
          <button type="button" class="chip" data-action="voice-example" data-text="Einstempeln">„Einstempeln“</button>
          <button type="button" class="chip" data-action="voice-example" data-text="Ausstempeln">„Ausstempeln“</button>
          <button type="button" class="chip" data-action="voice-example" data-text="Foto nachher">„Foto nachher“</button>
        </div>
        <form id="voice-fallback" class="voice-fallback">
          <input name="text" placeholder="Befehl als Text eingeben …" autocomplete="off" />
          <button class="btn primary" type="submit">${icon('send')} Ausführen</button>
        </form>
        <div class="small muted">Mikrofonzugriff im Mobilbrowser benötigt HTTPS oder localhost. Ohne Mikrofon funktioniert die Texteingabe.</div>
      </div>`,
  });
  $('#voice-fallback')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = event.target.elements.text.value.trim();
    if (text) handleVoiceText(text);
  });
  if (mode === 'report') {
    const status = $('#voice-status');
    if (status) status.textContent = 'Nimm den Bericht auf. Nach dem Stopp wird der Text eingefügt.';
  }
  // Direkt Aufnahme starten, wenn möglich
  if (supported) listenOnce(mode);
}

function startVoiceRecognition(mode = 'command') {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    toast('Spracherkennung wird von diesem Browser nicht unterstützt. Bitte Text eingeben.', 'error');
    return null;
  }
  const recognition = new Recognition();
  recognition.lang = 'de-DE';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  return recognition;
}

function listenOnce(mode = 'command') {
  const recognition = startVoiceRecognition(mode);
  if (!recognition) return;
  const status = $('#voice-status');
  const orb = $('#voice-orb');
  let finalText = '';
  state.voice = recognition;
  if (orb) orb.classList.add('listening');
  if (status) status.textContent = 'Ich höre …';
  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript;
      else interim += transcript;
    }
    if (status) status.textContent = finalText || interim || 'Ich höre …';
  };
  recognition.onerror = (event) => {
    if (status) status.textContent = event.error === 'not-allowed'
      ? 'Mikrofonzugriff wurde verweigert. Bitte in den Browser-Einstellungen erlauben.'
      : 'Spracherkennung nicht möglich. Bitte Text eingeben.';
    if (orb) orb.classList.remove('listening');
  };
  recognition.onend = () => {
    if (orb) orb.classList.remove('listening');
    state.voice = null;
    const text = finalText.trim();
    if (text) {
      if (status) status.textContent = `Erkannt: „${text}“`;
      handleVoiceText(text, mode);
    } else if (status) {
      status.textContent = 'Nichts erkannt – bitte erneut versuchen oder Text eingeben.';
    }
  };
  try {
    recognition.start();
  } catch {
    if (status) status.textContent = 'Aufnahme läuft bereits.';
  }
}

function cleanSpokenQuery(text) {
  return String(text || '')
    .replace(/\b(hey|hallo|handwerk pro|handwerkpro)\b/gi, ' ')
    .replace(/\b(öffne|oeffne|zeige|gehe zu|auftrag|auftrags|kunde|kundin|kunden|von|bei|für|fuer|den|die|das|der|bitte)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function findOrderFromSpeech(text) {
  const number = String(text).match(/\b(?:au|an)[\s-]?\d{2,4}[\s-]?\d{2,6}\b/i);
  const query = number ? number[0].replace(/\s/g, '') : cleanSpokenQuery(text);
  const results = await api.get(`/api/voice/search?q=${encodeURIComponent(query)}`);
  return results;
}

async function handleVoiceText(rawText, mode = 'command') {
  const text = String(rawText || '').trim();
  if (!text) return;
  const lower = text.toLowerCase();

  if (mode === 'report') {
    const content = $('#report-content');
    if (content) {
      content.value = `${content.value ? `${content.value}\n` : ''}${text}`;
      content.dispatchEvent(new Event('change'));
    }
    closeModal();
    speak('Bericht übernommen.');
    return;
  }

  try {
    if (/(ausstempeln|aus stempeln|stopp|pause|feierabend)/.test(lower)) {
      if (!state.time) {
        speak('Es läuft keine Zeiterfassung.');
        toast('Es läuft keine Zeiterfassung.', 'info');
        return;
      }
      const entry = await api.post('/api/time/stop', {});
      state.time = null;
      await refreshSelfTime();
      speak(`Ausgestempelt. ${Math.round(entry.minutes)} Minuten erfasst.`);
      toast(`Ausgestempelt – ${formatDuration(entry.minutes)} erfasst.`);
      closeModal();
      if (state.page === 'my' || state.page === 'time') refresh();
      return;
    }

    if (/(einstempeln|ein stempeln|stempel ein|arbeitszeit start|los geht)/.test(lower)) {
      let orderId = state.currentOrderId;
      if (!orderId) {
        const matches = await findOrderFromSpeech(text);
        orderId = matches.length === 1 ? matches[0].id : null;
      }
      const entry = await api.post('/api/time/start', { order_id: orderId || null });
      state.time = entry;
      await refreshSelfTime();
      speak(`Eingestempelt${entry.order_number ? ` auf Auftrag ${entry.order_number}` : ''}.`);
      toast(`Eingestempelt${entry.order_number ? ` auf ${entry.order_number}` : ''}.`);
      closeModal();
      if (state.page === 'my' || state.page === 'time') refresh();
      return;
    }

    if (/(foto|bild|photo)/.test(lower)) {
      const kind = /nachher|danach|fertig/.test(lower) ? 'nachher' : /vorher|davor/.test(lower) ? 'vorher' : 'sonstiges';
      let orderId = state.currentOrderId;
      if (!orderId) {
        const matches = await findOrderFromSpeech(text);
        orderId = matches.length === 1 ? matches[0].id : null;
      }
      if (!orderId) {
        speak('Bitte zuerst einen Auftrag öffnen.');
        toast('Bitte zuerst einen Auftrag öffnen.', 'error');
        return;
      }
      closeModal();
      uploadPhoto(orderId, kind);
      speak(`Foto ${kind} – Kamera wird geöffnet.`);
      return;
    }

    if (/bericht/.test(lower)) {
      let orderId = state.currentOrderId;
      if (!orderId) {
        const matches = await findOrderFromSpeech(text);
        if (matches.length === 1) orderId = matches[0].id;
        else if (matches.length > 1) {
          renderVoiceResults(matches, 'Für welchen Auftrag soll der Bericht sein?', (order) => {
            closeModal();
            newReportModal(order.id, { dictate: true });
          });
          speak('Mehrere Aufträge gefunden. Bitte auswählen.');
          return;
        }
      }
      closeModal();
      newReportModal(orderId || null, { dictate: true });
      speak(orderId
        ? 'Bericht geöffnet. Du kannst jetzt diktieren.'
        : 'Bericht geöffnet. Bitte Auftrag auswählen, dann diktieren.');
      return;
    }

    if (/material/.test(lower)) {
      const reportContent = $('#report-content');
      if (reportContent && state.currentReportId) {
        const materialText = text.replace(/.*material\s*/i, '');
        const result = await api.post(`/api/reports/${state.currentReportId}/parse`, { text: materialText });
        if (result.materials.length) {
          await api.post(`/api/reports/${state.currentReportId}/materials`, { materials: result.materials });
          speak(`${result.materials.length} Materialpositionen erfasst.`);
          await openReport(state.currentReportId);
          return;
        }
      }
      speak('Bitte zuerst einen Bericht öffnen.');
      toast('Bitte zuerst einen Bericht öffnen.', 'error');
      return;
    }

    const matches = await findOrderFromSpeech(text);
    if (!matches.length) {
      speak('Kein Auftrag gefunden.');
      toast('Kein Auftrag gefunden. Bitte Nummer, Kunde oder Straße nennen.', 'error');
      return;
    }
    if (matches.length === 1) {
      closeModal();
      speak(`Auftrag ${matches[0].number} geöffnet.`);
      openOrder(matches[0].id);
      return;
    }
    renderVoiceResults(matches, 'Welchen Auftrag meinst du?', (order) => {
      closeModal();
      openOrder(order.id);
    });
    speak(`${matches.length} Aufträge gefunden. Bitte auswählen.`);
  } catch (error) {
    toast(error.message, 'error');
    speak('Das hat leider nicht funktioniert.');
  }
}

function renderVoiceResults(matches, title, onPick) {
  const body = `
    <div class="small muted" style="margin-bottom:10px">${esc(title)}</div>
    <div class="list-stack">
      ${matches.map((order) => `
        <button class="list-row" type="button" data-voice-pick="${order.id}">
          <span class="list-ico">${icon('receipt')}</span>
          <span class="list-main"><b>${esc(order.number)} · ${esc(order.title)}</b>
            <small>${esc(customerName(order))} · ${esc(order.property_street || order.customer_street || '')} · ${STATUS_LABELS[order.status] || order.status}</small></span>
          ${icon('arrow')}
        </button>`).join('')}
    </div>`;
  openModal({ title: 'Auftrag auswählen', body, size: 'wide' });
  $$('[data-voice-pick]').forEach((button) => {
    button.addEventListener('click', () => {
      const order = matches.find((row) => row.id === Number(button.dataset.voicePick));
      if (order) onPick(order);
    });
  });
}

/* ------------------------------------------------------------------ Fotos */
function compressImage(file, maxSize = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      image.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
    reader.readAsDataURL(file);
  });
}

function photoPicker(orderId, kind = 'sonstiges', reportId = null) {
  if (!orderId) return toast('Bitte zuerst einen Auftrag öffnen.', 'error');
  const label = kind === 'vorher' ? 'Vorher-Fotos' : kind === 'nachher' ? 'Nachher-Fotos' : 'Baustellenfotos';
  openModal({
    title: 'Fotos hinzufügen',
    subtitle: `${label} – alle Bilder werden am Auftrag archiviert.`,
    size: 'wide',
    body: `
      <div class="photo-source">
        <button class="tech-btn" type="button" data-photo-source="camera">
          ${icon('camera')}<span>Kamera öffnen</span><small>ein Foto aufnehmen</small>
        </button>
        <button class="tech-btn" type="button" data-photo-source="library">
          ${icon('image')}<span>Mehrere Fotos</span><small>aus Galerie oder Dateien wählen</small>
        </button>
      </div>
      <div class="small muted" style="margin-top:10px">
        Mehrfachauswahl: halte in der Galerie mehrere Bilder gedrückt. Du kannst jederzeit weitere Fotos ergänzen.
      </div>`,
    footer: '<button class="btn" type="button" data-action="close-modal">Abbrechen</button>',
  });
  $$('[data-photo-source]').forEach((button) => {
    button.addEventListener('click', () => {
      const multiple = button.dataset.photoSource === 'library';
      closeModal();
      uploadPhoto(orderId, kind, reportId, { multiple });
    });
  });
}

function uploadPhoto(orderId, kind = 'sonstiges', reportId = null, { multiple = false } = {}) {
  if (!orderId) return toast('Bitte zuerst einen Auftrag öffnen.', 'error');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (multiple) input.multiple = true;
  else input.capture = 'environment';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const files = [...(input.files || [])];
    input.remove();
    if (!files.length) return;
    const baseCaption = kind === 'vorher'
      ? 'Zustand vor der Arbeit'
      : kind === 'nachher' ? 'Ergebnis nach der Arbeit' : 'Baustellenfoto';
    const prepared = [];
    if (files.length > 1) toast(`${files.length} Fotos werden vorbereitet …`, 'info');
    for (let index = 0; index < files.length; index += 1) {
      try {
        const dataUrl = await compressImage(files[index]);
        prepared.push({
          order_id: Number(orderId),
          report_id: reportId || null,
          kind,
          caption: files.length > 1 ? `${baseCaption} ${index + 1}` : baseCaption,
          dataUrl,
        });
      } catch (error) {
        toast(`Foto ${index + 1} konnte nicht gelesen werden: ${error.message}`, 'error');
      }
    }
    if (!prepared.length) return;
    try {
      let saved = 0;
      for (let start = 0; start < prepared.length; start += 4) {
        const batch = prepared.slice(start, start + 4);
        const result = await api.post('/api/photos', { photos: batch });
        saved += Array.isArray(result)
          ? result.length
          : (Array.isArray(result?.photos) ? result.photos.length : 1);
        if (prepared.length > 4 && saved < prepared.length) {
          toast(`${saved}/${prepared.length} Fotos gespeichert …`, 'info');
        }
      }
      toast(saved === 1 ? 'Foto gespeichert.' : `${saved} Fotos gespeichert.`);
      speak(saved === 1 ? 'Foto gespeichert.' : `${saved} Fotos gespeichert.`);
      if (reportId) await openReport(reportId);
      else if (state.currentOrderId === Number(orderId)) await openOrder(orderId);
      else if (state.page === 'my' || state.page === 'orders') refresh();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  input.click();
}

/* ------------------------------------------------------------------ Einstellungen */
async function renderSettings() {
  const { settings } = await api.get('/api/settings');

  const input = (name, label, opts = {}) => `
    <div class="field ${opts.full ? 'full' : ''}">
      <label>${label}</label>
      <input name="${name}" type="${opts.type || 'text'}" value="${esc(settings[name])}" ${opts.step ? `step="${opts.step}"` : ''} />
    </div>`;

  view.innerHTML = `
    <form id="settings-form">
      <div class="settings-grid">
        <div class="card form-card">
          <h2>Marke & Gewerk</h2>
          <div class="fc-sub">Name und Ausrichtung der Plattform – passend für jedes Handwerk.</div>
          <div class="form-grid">
            ${input('app_name', 'App-Name', { full: true })}
            ${input('trade', 'Gewerk / Branche', { full: true })}
            <div class="field full"><label>Untertitel / Leistungen</label><input name="trade_tagline" value="${esc(settings.trade_tagline || '')}" placeholder="z. B. Elektroinstallation · Smart Home · Gebäudetechnik" /></div>
          </div>
        </div>

        <div class="card form-card">
          <h2>Firmendaten</h2>
          <div class="fc-sub">Erscheinen auf jeder Rechnung und jedem Angebot.</div>
          <div class="form-grid">
            ${input('company_name', 'Firma', { full: true })}
            ${input('company_owner', 'Inhaber / Geschäftsführer', { full: true })}
            ${input('company_street', 'Straße')}
            ${input('company_zip', 'PLZ')}
            ${input('company_city', 'Ort')}
            ${input('company_phone', 'Telefon')}
            ${input('company_mobile', 'Mobil')}
            ${input('company_email', 'E-Mail')}
            ${input('company_web', 'Website')}
            <div class="field"><label>Logo / Marke</label><input value="${esc(settings.app_name)}" disabled /></div>
          </div>
        </div>

        <div class="card form-card">
          <h2>Steuern & Bank</h2>
          <div class="fc-sub">Pflichtangaben nach § 14 UStG.</div>
          <div class="form-grid">
            ${input('tax_number', 'Steuernummer')}
            ${input('vat_id', 'USt-IdNr.')}
            ${input('register_court', 'Registergericht')}
            ${input('register_number', 'Handelsregister-Nr.')}
            <div class="field full"><label>Bank</label><input name="bank_name" value="${esc(settings.bank_name)}" /></div>
            <div class="field full"><label>IBAN</label><input name="iban" value="${esc(settings.iban)}" /></div>
            ${input('bic', 'BIC')}
            ${input('default_tax_rate', 'Standard-USt. (%)', { type: 'number', step: '0.1' })}
          </div>
        </div>

        <div class="card form-card">
          <h2>Rechnungen</h2>
          <div class="fc-sub">Nummernkreise und Zahlungsbedingungen.</div>
          <div class="form-grid">
            ${input('invoice_prefix', 'Rechnungs-Präfix')}
            ${input('order_prefix', 'Auftrags-Präfix')}
            ${input('quote_prefix', 'Angebots-Präfix')}
            ${input('customer_prefix', 'Kunden-Präfix')}
            ${input('payment_days', 'Zahlungsziel (Tage)', { type: 'number', step: '1' })}
            ${input('default_labor_rate', 'Stundensatz (€)', { type: 'number', step: '0.01' })}
            <div class="field full"><label>Einleitungstext Rechnung</label><textarea name="invoice_intro" rows="2">${esc(settings.invoice_intro)}</textarea></div>
            <div class="field full"><label>Fußtext / Zahlungsbedingungen</label><textarea name="invoice_footer" rows="2">${esc(settings.invoice_footer)}</textarea></div>
          </div>
        </div>

        <div class="card form-card">
          <h2>Automatik</h2>
          <div class="fc-sub">Das System arbeitet im Hintergrund – alle 5 Minuten und beim Start.</div>
          <div class="toggle-row">
            <div class="tr-main"><div class="tr-title">Aufträge aus Wartungsverträgen</div><div class="tr-sub">Fällige Verträge werden automatisch zu Aufträgen.</div></div>
            <label class="switch"><input type="checkbox" name="auto_create_orders" ${settings.auto_create_orders === '1' ? 'checked' : ''} /><span></span></label>
          </div>
          <div class="toggle-row">
            <div class="tr-main"><div class="tr-title">Rechnungen automatisch erstellen</div><div class="tr-sub">Sobald ein Auftrag erledigt ist, wird die Rechnung inkl. PDF erzeugt.</div></div>
            <label class="switch"><input type="checkbox" name="auto_invoice" ${settings.auto_invoice === '1' ? 'checked' : ''} /><span></span></label>
          </div>
          <div class="toggle-row">
            <div class="tr-main"><div class="tr-title">Mahnwesen automatisch</div><div class="tr-sub">Überfällige Rechnungen erhalten automatisch eine Zahlungserinnerung.</div></div>
            <label class="switch"><input type="checkbox" name="auto_dunning" ${settings.auto_dunning === '1' ? 'checked' : ''} /><span></span></label>
          </div>
          <div class="form-grid" style="margin-top:10px">
            ${input('dunning_days', 'Mahnung nach (Tagen)', { type: 'number', step: '1' })}
            ${input('dunning_fee', 'Mahngebühr (€)', { type: 'number', step: '0.01' })}
          </div>
          <div class="hr"></div>
          <div class="export-links">
            <a class="btn sm" href="/api/export/rechnungen.csv">${icon('download')} Rechnungen</a>
            <a class="btn sm" href="/api/export/auftraege.csv">${icon('download')} Aufträge</a>
            <a class="btn sm" href="/api/export/kunden.csv">${icon('download')} Kunden</a>
            <a class="btn sm" href="/api/export/lager.csv">${icon('download')} Lager</a>
          </div>
        </div>

        <div class="card form-card full">
          <h2>Team & Monteure</h2>
          <div class="fc-sub">Wer ist im Einsatz? Stundensätze werden bei neuen Aufträgen vorbelegt.</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Rolle</th><th>Telefon</th><th class="right">Stundensatz</th><th>Status</th><th class="right"></th></tr></thead>
              <tbody>
                ${state.employees.map((employee) => `
                  <tr>
                    <td><span class="legend-dot" style="display:inline-block;background:${esc(employee.color)};margin-right:8px"></span><b>${esc(employee.name)}</b></td>
                    <td>${esc(employee.role)}</td>
                    <td>${esc(employee.phone || '–')}</td>
                    <td class="right num">${money(employee.rate)}</td>
                    <td>${employee.active ? '<span class="badge bezahlt">Aktiv</span>' : '<span class="badge storniert">Inaktiv</span>'}</td>
                    <td class="right"><button type="button" class="icon-btn" data-action="edit-employee" data-id="${employee.id}">${icon('edit')}</button></td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div style="margin-top:12px"><button type="button" class="btn sm" data-action="new-employee">${icon('plus')} Monteur hinzufügen</button></div>
        </div>

        <div class="card form-card full">
          <h2>Sicherung & Daten</h2>
          <div class="fc-sub">Alle Daten liegen lokal in <code>data/gaswasser.db</code> (SQLite). Für ein Backup den kompletten <code>data</code>-Ordner kopieren.</div>
          <div class="export-links">
            <a class="btn sm" href="/api/export/kunden.csv">${icon('download')} Kunden exportieren</a>
            <a class="btn sm" href="/api/export/auftraege.csv">${icon('download')} Aufträge exportieren</a>
            <a class="btn sm" href="/api/export/rechnungen.csv">${icon('download')} Rechnungen exportieren</a>
            <a class="btn sm" href="/api/export/lager.csv">${icon('download')} Lager exportieren</a>
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;margin-top:16px">
        <button class="btn primary" type="submit">${icon('check')} Einstellungen speichern</button>
      </div>
    </form>`;

  const form = $('#settings-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {};
    $$('input, textarea, select', form).forEach((input) => {
      if (!input.name) return;
      if (input.type === 'checkbox') payload[input.name] = input.checked ? '1' : '0';
      else payload[input.name] = input.value;
    });
    try {
      const result = await api.put('/api/settings', payload);
      state.settings = result.settings;
      applyBranding();
      toast('Einstellungen gespeichert.');
      updateBadges();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

function employeeForm(employee = null) {
  formModal({
    title: employee ? 'Monteur bearbeiten' : 'Monteur hinzufügen',
    size: '',
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'role', label: 'Rolle', type: 'select', options: ['Meister', 'Geselle', 'Anlagenmechaniker SHK', 'Elektriker', 'Dachdecker', 'Techniker', 'Monteur', 'Auszubildende'], default: 'Monteur' },
      { name: 'phone', label: 'Telefon' },
      { name: 'rate', label: 'Stundensatz (€)', type: 'number', step: '0.01', min: 0, default: 0 },
      { name: 'color', label: 'Farbe im Kalender', type: 'text', default: '#0f766e', hint: 'Hex-Farbe, z. B. #2563eb' },
      { name: 'active', label: 'Status', type: 'checkbox', checkLabel: 'aktiv', default: 1 },
    ],
    values: employee ?? {},
    submitLabel: 'Speichern',
    onSubmit: async (data) => {
      if (employee) await api.put(`/api/employees/${employee.id}`, data);
      else await api.post('/api/employees', data);
      toast('Gespeichert.');
      closeModal();
      await loadBase();
      renderSettings();
    },
  });
}

/* ------------------------------------------------------------------ Aktionen */
const ACTIONS = {
  'toggle-nav': () => $('#sidebar').classList.toggle('open'),
  'close-modal': () => closeModal(),
  goto: (id, element) => { location.hash = `#/${element.dataset.page}`; },
  'run-automation': async () => {
    try {
      const result = await api.post('/api/automation/run');
      toast(result.summary, result.orders.length + result.invoices.length + result.dunnings.length ? 'success' : 'info');
      if (state.page === 'dashboard') {
        refresh();
      } else {
        refreshBadgesOnly();
      }
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'new-order': () => orderForm(),
  'new-appointment': () => appointmentForm(),
  'new-customer': () => customerForm(),
  'new-contract': () => contractForm(),
  'new-article': () => articleForm(),
  'new-employee': () => employeeForm(),
  'save-settings': () => $('#settings-form')?.requestSubmit(),
  'export-invoices': () => { window.location.href = '/api/export/rechnungen.csv'; },
  'filter-orders': (id, el) => { state.ordersFilter = el.dataset.filter; renderOrders(); },
  'filter-invoices': (id, el) => { state.invoicesFilter = el.dataset.filter; renderInvoices(); },
  'filter-customers': (id, el) => { state.customersFilter = el.dataset.filter; renderCustomers(); },
  'filter-appointments': (id, el) => { state.planningKind = el.dataset.kind; renderPlanning(); },
  'filter-warehouse': (id, el) => { state.warehouseFilter = el.dataset.filter; renderWarehouse(); },
  'filter-contracts': (id, el) => { state.contractsFilter = el.dataset.filter; renderContracts(); },
  'open-order': (id) => openOrder(id),
  'open-invoice': (id) => openInvoice(id),
  'open-customer': (id) => openCustomer(id),
  'edit-order': (id, el) => {
    api.get(`/api/orders/${id}`).then((data) => {
      closeModal();
      orderForm(data.order);
    });
  },
  'order-pdf': (id) => window.open(`/api/orders/${id}/pdf`, '_blank'),
  'invoice-pdf': (id, el) => window.open(`/api/invoices/${id}/pdf${el.dataset.mahnung === '1' ? '?mahnung=1' : ''}`, '_blank'),
  'invoice-order': (id) => openOrderInvoiceDialog(id),
  'convert-order': async (id) => {
    if (!confirm('Angebot in einen Auftrag umwandeln?')) return;
    try {
      const result = await api.post(`/api/orders/${id}/convert`);
      toast(`Auftrag ${result.number} aus Angebot erstellt.`);
      closeModal();
      await refresh();
      openOrder(result.orderId);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'delete-order': async (id) => {
    if (!confirm('Auftrag wirklich löschen? Positionen werden ebenfalls entfernt.')) return;
    try {
      await api.del(`/api/orders/${id}`);
      toast('Auftrag gelöscht.');
      closeModal();
      refresh();
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'add-order-item': async (id) => {
    const modal = $('#modal-root .modal');
    const articleId = $('#add-article', modal)?.value;
    const description = $('#add-desc', modal)?.value;
    const quantity = Number($('#add-qty', modal)?.value) || 0;
    const unit = $('#add-unit', modal)?.value;
    const unitPrice = Number($('#add-price', modal)?.value) || 0;
    if (!quantity) return toast('Bitte eine Menge angeben.', 'error');
    if (!description && !articleId) return toast('Bitte Artikel oder Beschreibung angeben.', 'error');
    try {
      await api.post(`/api/orders/${id}/items`, {
        article_id: articleId || null,
        description,
        quantity,
        unit,
        unit_price: unitPrice,
        kind: articleId ? 'material' : 'pauschal',
      });
      await openOrder(id);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'delete-order-item': async (id, el) => {
    const orderId = el.dataset.order;
    try {
      await api.del(`/api/orders/${orderId}/items/${id}`);
      await openOrder(orderId);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'payment-invoice': (id) => openPaymentDialog(id),
  'dunning-invoice': (id) => dunning(id),
  'storno-invoice': (id) => stornoInvoice(id),
  'edit-customer': (id) => {
    api.get(`/api/customers/${id}`).then((data) => {
      closeModal();
      customerForm(data.customer);
    });
  },
  'delete-customer': async (id) => {
    if (!confirm('Kunden wirklich löschen?')) return;
    try {
      await api.del(`/api/customers/${id}`);
      toast('Kunde gelöscht.');
      closeModal();
      await loadBase();
      refresh();
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'new-property': (id, el) => propertyForm(null, Number(el.dataset.customer)),
  'new-order-customer': (id, el) => {
    closeModal();
    orderForm();
    const form = $('#modal-form');
    if (form) {
      form.elements.customer_id.value = el.dataset.customer;
      form.elements.customer_id.dispatchEvent(new Event('change'));
    }
  },
  'edit-article': (id) => {
    api.get('/api/articles').then((articles) => {
      const article = articles.find((a) => a.id === Number(id));
      if (article) articleForm(article);
    });
  },
  'stock-move': (id, el) => {
    api.get('/api/articles').then((articles) => {
      const article = articles.find((a) => a.id === Number(id));
      if (article) stockMoveForm(article, Number(el.dataset.direction));
    });
  },
  'edit-contract': (id) => {
    api.get('/api/contracts').then((contracts) => {
      const contract = contracts.find((c) => c.id === Number(id));
      if (contract) contractForm(contract);
    });
  },
  'delete-contract': async (id) => {
    if (!confirm('Wartungsvertrag löschen?')) return;
    try {
      await api.del(`/api/contracts/${id}`);
      toast('Vertrag gelöscht.');
      refresh();
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'contract-order': async (id) => {
    if (!confirm('Auftrag aus diesem Vertrag jetzt erzeugen?')) return;
    try {
      const result = await api.post(`/api/contracts/${id}/order`);
      toast(`Auftrag ${result.number} erzeugt.`);
      refresh();
      refreshBadgesOnly();
      openOrder(result.orderId);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'edit-employee': (id) => {
    const employee = state.employees.find((e) => e.id === Number(id));
    if (employee) employeeForm(employee);
  },
  'open-appointment': (id, el) => openAppointment(id, el.dataset.order),
  'edit-appointment': async (id) => {
    const appointments = await api.get(`/api/appointments?from=${addDaysISO(todayISO(), -90)}&to=${addDaysISO(todayISO(), 180)}`);
    const appointment = appointments.find((a) => a.id === Number(id));
    if (appointment) {
      closeModal();
      appointmentForm(appointment);
    }
  },
  'delete-appointment': async (id) => {
    if (!confirm('Termin löschen?')) return;
    try {
      await api.del(`/api/appointments/${id}`);
      toast('Termin gelöscht.');
      closeModal();
      refresh();
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'appointment-link': async (id) => {
    try {
      const result = await api.post(`/api/appointments/${id}/confirm-link`);
      const copied = await copyText(`${location.origin}${result.path}`);
      toast(copied ? 'Bestätigungslink erzeugt und kopiert.' : 'Bestätigungslink erzeugt.');
      await openAppointment(id);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'appointment-copy': async () => {
    const link = appointmentLink(state.currentAppointment);
    if (!link) return;
    const copied = await copyText(link);
    toast(copied ? 'Link kopiert.' : 'Bitte den Link manuell markieren und kopieren.', copied ? 'success' : 'info');
  },
  'appointment-mail': async () => {
    const appointment = state.currentAppointment;
    const link = appointmentLink(appointment);
    if (!link) return;
    let email = '';
    if (appointment?.customer_id) {
      try {
        email = (await api.get(`/api/customers/${appointment.customer_id}`)).customer.email || '';
      } catch { email = ''; }
    }
    const subject = `Termin am ${fmtDate(appointment.start_at)} um ${fmtTime(appointment.start_at)} Uhr`;
    const lines = [
      'Guten Tag,',
      '',
      'bitte bestätigen Sie kurz unseren Termin:',
      `${fmtDate(appointment.start_at)}, ${fmtTime(appointment.start_at)}–${fmtTime(appointment.end_at)} Uhr`,
    ];
    if (appointment.title) lines.push(`Leistung: ${appointment.title}`);
    lines.push('', 'Zum Bestätigen einfach diesen Link öffnen:', link, '', 'Vielen Dank!');
    if (state.settings?.company_name) lines.push(state.settings.company_name);
    location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
  },
  'appointment-reset': async (id) => {
    if (!confirm('Bestätigung bzw. Ablehnung zurücksetzen? Der Link bleibt gültig.')) return;
    try {
      await api.post(`/api/appointments/${id}/confirm-reset`);
      toast('Bestätigung zurückgesetzt.');
      await openAppointment(id);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'delete-customer-note': async (id, el) => {
    const customerId = Number(el.dataset.customer);
    if (!confirm('Notiz löschen?')) return;
    try {
      await api.del(`/api/customers/${customerId}/notes/${id}`);
      toast('Notiz gelöscht.');
      await openCustomer(customerId);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'week-prev': () => {
    state.weekStart.setDate(state.weekStart.getDate() - 7);
    renderPlanning();
  },
  'week-next': () => {
    state.weekStart.setDate(state.weekStart.getDate() + 7);
    renderPlanning();
  },
  'week-today': () => {
    state.weekStart = startOfWeek();
    renderPlanning();
  },
  'filter-reports': (id, el) => { state.reportsFilter = el.dataset.filter; renderReports(); },
  'toggle-time': (id) => toggleTime(id || null),
  'new-time': () => timeForm(),
  'delete-time': async (id) => {
    if (!confirm('Zeiteintrag wirklich löschen?')) return;
    try {
      await api.del(`/api/time/${id}`);
      toast('Zeiteintrag gelöscht.');
      await refreshSelfTime();
      await refresh();
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'new-report': (id, el) => newReportModal(id || el?.dataset?.id || null),
  'open-report': (id) => openReport(id),
  'save-report': (id) => saveReport(id),
  'report-dictate': (id) => {
    if (!state.currentReportId) state.currentReportId = id;
    const textarea = $('#report-content');
    const status = $('#report-dictation-status');
    if (textarea) listenInline(textarea, status);
    else openVoiceModal('report');
  },
  'report-parse': (id) => runReportParse(id),
  'add-report-material': (id) => addReportMaterial(id),
  'delete-report-material': async (id, el) => {
    try {
      await api.del(`/api/reports/${el.dataset.report}/materials/${id}`);
      toast('Material entfernt.');
      await openReport(Number(el.dataset.report));
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'approve-report': async (id) => {
    try {
      await api.post(`/api/reports/${id}/approve`);
      toast('Bericht freigegeben.');
      speak('Bericht freigegeben.');
      await openReport(id);
      if (state.page === 'reports' || state.page === 'team') refresh();
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'apply-report': async (id) => {
    if (!confirm('Material aus dem Bericht in den Auftrag übernehmen und aus dem Lager buchen?')) return;
    try {
      await api.post(`/api/reports/${id}/apply`);
      toast('Material wurde in den Auftrag übernommen.');
      await openReport(id);
      if (state.page === 'reports') refresh();
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'delete-report': async (id) => {
    if (!confirm('Bericht und zugehörige Fotos wirklich löschen?')) return;
    try {
      await api.del(`/api/reports/${id}`);
      toast('Bericht gelöscht.');
      closeModal();
      await refresh();
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'upload-photo': (id, el) => photoPicker(id, el.dataset.kind || 'sonstiges', el.dataset.report ? Number(el.dataset.report) : null),
  'delete-photo': async (id, el) => {
    if (!confirm('Foto löschen?')) return;
    try {
      await api.del(`/api/photos/${id}`);
      toast('Foto gelöscht.');
      if (el.dataset.report) await openReport(Number(el.dataset.report));
      else if (el.dataset.order) await openOrder(Number(el.dataset.order));
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'show-photo': (id, el) => {
    openModal({
      title: 'Baustellenfoto',
      size: 'xwide',
      body: `<div class="photo-lightbox"><img src="${esc(el.dataset.src)}" alt="Baustellenfoto" /></div>`,
      footer: '<button class="btn" type="button" data-action="close-modal">Schließen</button>',
    });
  },
  'start-voice': () => {
    const textarea = $('#report-content');
    if (textarea) {
      listenInline(textarea, $('#report-dictation-status'));
      return;
    }
    openVoiceModal('command');
  },
  'voice-listen': (id, el) => listenOnce(el?.dataset.mode || 'command'),
  'voice-example': (id, el) => handleVoiceText(el.dataset.text),
  'new-user': (id, el) => {
    if (!state.usersCache) api.get('/api/users').then((users) => { state.usersCache = users; userForm(null, el?.dataset.employee || null); });
    else userForm(null, el?.dataset.employee || null);
  },
  'edit-user': (id) => {
    if (state.usersCache) userForm(id);
    else api.get('/api/users').then((users) => { state.usersCache = users; userForm(id); });
  },
  'delete-user': async (id) => {
    if (!confirm('Benutzerkonto wirklich löschen?')) return;
    try {
      await api.del(`/api/users/${id}`);
      toast('Benutzer gelöscht.');
      state.usersCache = null;
      await renderUsers();
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'delete-employee': async (id) => {
    if (!confirm('Mitarbeiter löschen bzw. deaktivieren?')) return;
    try {
      const result = await api.del(`/api/employees/${id}`);
      toast(result.deactivated ? 'Mitarbeiter deaktiviert (wird noch verwendet).' : 'Mitarbeiter gelöscht.');
      await loadBase();
      await refresh();
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'change-password': () => {
    formModal({
      title: 'Passwort ändern',
      fields: [
        { name: 'currentPassword', label: 'Aktuelles Passwort', type: 'password', required: true },
        { name: 'newPassword', label: 'Neues Passwort', type: 'password', required: true, hint: 'Mindestens 8 Zeichen' },
        { name: 'confirm', label: 'Neues Passwort wiederholen', type: 'password', required: true },
      ],
      submitLabel: 'Passwort ändern',
      onSubmit: async (values) => {
        if (values.newPassword.length < 8) throw new Error('Das neue Passwort muss mindestens 8 Zeichen haben');
        if (values.newPassword !== values.confirm) throw new Error('Die Passwörter stimmen nicht überein');
        await api.post('/api/auth/password', values);
        closeModal();
        toast('Passwort geändert.');
      },
    });
  },
  logout: async () => {
    try { await api.post('/api/auth/logout'); } catch { /* stumm */ }
    state.user = null;
    state.time = null;
    showLogin();
  },
};

document.addEventListener('click', (event) => {
  const element = event.target.closest('[data-action]');
  if (!element) return;
  if (element.tagName === 'A' && element.getAttribute('href')?.startsWith('#')) return;
  const action = ACTIONS[element.dataset.action];
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  const id = element.dataset.id ? Number(element.dataset.id) : null;
  action(id, element, event);
});

$('#primary-action').addEventListener('click', () => {
  if (!primaryAction) return;
  const action = ACTIONS[primaryAction.action];
  if (action) action(null, $('#primary-action'));
});

let searchTimer = null;
$('#global-search')?.addEventListener('input', (event) => {
  state.search = event.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (['orders', 'invoices', 'customers', 'warehouse', 'contracts', 'planning'].includes(state.page)) {
      PAGES[state.page].render();
    }
  }, 220);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});

window.addEventListener('hashchange', navigate);

/* ------------------------------------------------------------------ Init & Anmeldung */
async function loadBase() {
  const safe = (promise, fallback) => promise.catch(() => fallback);
  const [settingsResponse, employees, customers, properties, articles] = await Promise.all([
    api.get('/api/settings'),
    can('employees.view') ? safe(api.get('/api/employees'), []) : [],
    can('customers.view') ? safe(api.get('/api/customers'), []) : [],
    can('customers.view') ? safe(api.get('/api/properties'), []) : [],
    can('warehouse.view') ? safe(api.get('/api/articles'), []) : [],
  ]);
  state.settings = settingsResponse.settings;
  state.employees = employees;
  state.customers = customers;
  state.properties = properties;
  state.articles = articles;
}

async function refreshBadgesOnly() {
  updateBadges();
}

function applyBranding() {
  const name = state.settings.app_name || state.meta.app_name || 'HandwerkPro';
  const trade = state.settings.trade || state.meta.trade || 'Handwerkersoftware';
  const tagline = state.settings.trade_tagline || state.meta.trade_tagline || '';
  document.title = `${name} – ${trade}`;
  const brandName = $('#brand-name');
  const brandSub = $('#brand-sub');
  if (brandName) brandName.textContent = name;
  if (brandSub) brandSub.textContent = tagline || trade;
  const loginApp = $('#login-app');
  const loginTrade = $('#login-trade');
  if (loginApp) loginApp.textContent = name;
  if (loginTrade) loginTrade.textContent = tagline || `Handwerkersoftware für ${trade}`;
}

function applyNavigation() {
  $$('#nav a[data-route]').forEach((link) => {
    const permission = link.dataset.perm;
    const any = link.dataset.any ? link.dataset.any.split(',') : null;
    const allowed = (!permission || can(permission)) && (!any || canAny(...any));
    link.hidden = !allowed;
  });
  // Gruppenüberschriften ausblenden, wenn alle folgenden Links versteckt sind
  $$('#nav .nav-label').forEach((label) => {
    let node = label.nextElementSibling;
    let visible = false;
    while (node && !node.classList.contains('nav-label')) {
      if (node.matches('a') && !node.hidden) { visible = true; break; }
      node = node.nextElementSibling;
    }
    label.hidden = !visible;
  });
  const automationBox = $('#automation-box');
  if (automationBox) automationBox.hidden = !can('automation.run');
  const automationButton = $('#automation-button');
  if (automationButton) automationButton.hidden = !can('automation.run');
  const search = $('.search');
  if (search) search.hidden = !canAny('orders.view.all', 'orders.view.own');
  const fab = $('#voice-fab');
  if (fab) fab.hidden = !canAny('orders.view.all', 'orders.view.own', 'reports.own');
}

function renderUserChip() {
  const user = state.user;
  const chip = $('#user-chip');
  if (!chip || !user) return;
  const initials = (user.name || user.username || '?').split(' ').map((part) => part[0]).slice(0, 2).join('');
  chip.innerHTML = `
    <div class="user-chip-main">
      <span class="avatar" style="background:${esc(user.employee_color || '#0f766e')}">${esc(initials)}</span>
      <div><b>${esc(user.name)}</b><small>${esc(user.role_label || user.role)}</small></div>
    </div>
    <button type="button" class="link-btn" data-action="change-password">Passwort ändern</button>`;
}

function buildBottomNav() {
  const nav = $('#bottom-nav');
  if (!nav) return;
  const all = {
    my: { page: 'my', label: 'Mein Tag', ico: 'clock', show: canAny('dashboard.view', 'orders.view.own', 'planning.view') },
    dashboard: { page: 'dashboard', label: 'Übersicht', ico: 'dashboard', show: can('dashboard.view') },
    orders: { page: 'orders', label: 'Aufträge', ico: 'receipt', show: canAny('orders.view.all', 'orders.view.own') },
    reports: { page: 'reports', label: 'Berichte', ico: 'file', show: canAny('reports.own', 'reports.view.all') },
    time: { page: 'time', label: 'Zeiten', ico: 'clock', show: canAny('time.own', 'time.view.all') },
    team: { page: 'team', label: 'Team', ico: 'users', show: can('employees.view') },
    invoices: { page: 'invoices', label: 'Rechnungen', ico: 'euro', show: can('invoices.view') },
    planning: { page: 'planning', label: 'Kalender', ico: 'calendar', show: can('planning.view') },
  };
  const order = isTechnician()
    ? ['my', 'orders', 'reports', 'time', 'dashboard']
    : can('invoices.view')
      ? ['my', 'dashboard', 'orders', 'planning', 'invoices', 'reports', 'team']
      : ['my', 'dashboard', 'team', 'reports', 'time', 'orders'];
  const visible = order.map((key) => all[key]).filter((option) => option && option.show).slice(0, 4);
  nav.innerHTML = `
    ${visible.map((option) => `
      <a href="#/${option.page}" data-page="${option.page}">
        ${icon(option.ico)}<span>${option.label}</span>
      </a>`).join('')}
    <button type="button" class="bottom-voice" data-action="start-voice">
      ${icon('mic')}<span>Sprache</span>
    </button>`;
}

function showLogin() {
  applyBranding();
  const shell = $('#app-shell');
  const login = $('#login-screen');
  if (shell) shell.hidden = true;
  if (login) login.hidden = false;
  const fab = $('#voice-fab');
  if (fab) fab.hidden = true;
  document.body.classList.add('logged-out');
  closeModal();
  const demo = state.meta.demo_users || ['chef', 'buero', 'vorgesetzt', 'monteur', 'azubi', 'hr'];
  const passwords = { chef: 'chef123', buero: 'buero123', vorgesetzt: 'vorgesetzt123', monteur: 'monteur123', azubi: 'azubi123', hr: 'hr123' };
  const demoBox = $('#login-demo');
  if (demoBox) {
    demoBox.innerHTML = `
      <div class="small muted">Demo-Zugänge – zum Ausfüllen antippen:</div>
      <div class="demo-chips">
        ${demo.map((username) => `<button type="button" class="chip" data-demo-user="${esc(username)}">${esc(username)} <span class="muted">/ ${esc(passwords[username] || '')}</span></button>`).join('')}
      </div>`;
    $$('[data-demo-user]', demoBox).forEach((button) => {
      button.addEventListener('click', () => {
        const form = $('#login-form');
        form.elements.username.value = button.dataset.demoUser;
        form.elements.password.value = passwords[button.dataset.demoUser] || '';
        form.elements.password.focus();
      });
    });
  }
  const secure = $('#login-secure');
  if (secure) {
    const secureContext = state.meta.secure || location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
    secure.textContent = secureContext
      ? 'Sprachsteuerung verfügbar'
      : 'Hinweis: Spracheingabe im Mobilbrowser benötigt HTTPS';
  }
}

function showApp() {
  const shell = $('#app-shell');
  const login = $('#login-screen');
  if (login) login.hidden = true;
  if (shell) shell.hidden = false;
  document.body.classList.remove('logged-out');
  applyBranding();
  applyNavigation();
  renderUserChip();
  buildBottomNav();
}

function defaultPage() {
  if (isTechnician()) return 'my';
  return 'dashboard';
}

async function enterApp(data) {
  state.user = data.user;
  state.settings = data.settings || state.settings;
  state.time = data.time ?? null;
  state.todayMinutes = data.todayMinutes ?? 0;
  state.weekMinutes = data.weekMinutes ?? 0;
  showApp();
  try {
    await loadBase();
  } catch (error) {
    toast(`Daten konnten nicht geladen werden: ${error.message}`, 'error');
  }
  if (!location.hash || location.hash === '#' || location.hash === '#/') {
    location.hash = `#/${defaultPage()}`;
  }
  await navigate();
  api.get('/api/orders').then((orders) => {
    state.orderOptions = orders
      .filter((order) => order.doc_type === 'auftrag' && order.status !== 'storniert')
      .map((order) => ({ value: order.id, label: `${order.number} · ${order.title}` }));
  }).catch(() => {});
  await refreshSelfTime();
  updateBadges();
}

async function init() {
  try {
    state.meta = await api.get('/api/auth/meta');
  } catch { state.meta = {}; }
  applyBranding();
  const form = $('#login-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = $('#login-error');
    const button = form.querySelector('button[type="submit"]');
    errorBox.hidden = true;
    button.disabled = true;
    button.textContent = 'Anmeldung läuft …';
    try {
      const result = await api.post('/api/auth/login', {
        username: form.elements.username.value.trim(),
        password: form.elements.password.value,
      });
      await enterApp(result);
      form.reset();
    } catch (error) {
      errorBox.hidden = false;
      errorBox.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Anmelden';
    }
  });

  try {
    const me = await api.get('/api/auth/me');
    await enterApp(me);
  } catch (error) {
    if (error.status !== 401) console.error('App-Start fehlgeschlagen', error);
    showLogin();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

init();
