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
  materialSources: [],
  materialImports: [],
  lookupResults: [],
  weekStart: null,
  ordersFilter: 'offen',
  invoicesFilter: 'offen',
  customersFilter: 'alle',
  documentsFilter: 'alle',
  financeTab: 'bank',
  warehouseFilter: 'alle',
  contractsFilter: 'aktiv',
  reportsFilter: 'alle',
  time: null,
  todayMinutes: 0,
  weekMinutes: 0,
  currentOrderId: null,
  currentReportId: null,
  voice: null,
  dictation: null,
  geo: null,
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
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
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
      let data = null;
      try {
        data = await response.json();
        if (data?.error) message = data.error;
      } catch { /* ignore */ }
      const error = new Error(message);
      error.status = response.status;
      if (data?.code) error.code = data.code;
      // Tritt auf, wenn der Browser die neue App lädt, der Server aber noch mit
      // altem Code läuft (z. B. nach einem Update ohne Neustart).
      if (response.status === 404 && message === 'API-Endpunkt nicht gefunden') {
        error.message = 'Server läuft mit einer älteren Version. Bitte den Server neu starten (npm start) und die Seite neu laden.';
        error.code = 'server_outdated';
      }
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

function openModal({ title, subtitle = '', body, footer = '', size = '', dismissible = true }) {
  $('#modal-root').innerHTML = `
    <div class="modal-overlay" data-overlay data-dismissible="${dismissible ? 'true' : 'false'}">
      <div class="modal ${size}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div>
            <h2>${esc(title)}</h2>
            ${subtitle ? `<div class="m-sub">${esc(subtitle)}</div>` : ''}
          </div>
          ${dismissible ? `<button class="icon-btn m-close" type="button" data-action="close-modal" aria-label="Schließen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>` : ''}
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>
    </div>`;
  document.body.style.overflow = 'hidden';
  document.body.classList.add('modal-open');
  const overlay = $('[data-overlay]');
  if (dismissible) {
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) closeModal();
    });
  }
}

function closeModal() {
  if (state.dictation) {
    state.dictation.stop();
    state.dictation = null;
  }
  $('#modal-root').innerHTML = '';
  document.body.style.overflow = '';
  document.body.classList.remove('modal-open');
}

function formModal({ title, subtitle, fields, values = {}, submitLabel = 'Speichern', onSubmit, size = '', dismissible = true }) {
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
    dismissible,
    body: `<form id="modal-form" class="form-grid" novalidate>${html}</form>`,
    footer: `
      ${dismissible ? '<button class="btn" type="button" data-action="close-modal">Abbrechen</button>' : ''}
      <button class="btn primary" type="submit" form="modal-form">${esc(submitLabel)}</button>`,
  });

  const form = $('#modal-form');
  $$('[data-dictate]', form).forEach((button) => {
    button.addEventListener('click', () => {
      const target = form.elements[button.dataset.dictate];
      const status = $(`[data-dictate-status="${button.dataset.dictate}"]`, form);
      if (!target) return;
      const active = state.dictation && state.dictation.textarea === target;
      if (!active && target.value.trim()) target.value = `${target.value.trimEnd()} `;
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
  invoices: { title: 'Rechnungen', sub: 'Rechnungen, Zahlungen, Mahnwesen und E-Rechnung', primary: { label: 'CSV-Export', action: 'export-invoices', permission: 'exports.run' }, render: renderInvoices },
  finance: { title: 'Finanzen', sub: 'DATEV, Bankabgleich und SEPA-Überweisungen', primary: { label: 'Bank importieren', action: 'import-bank', permission: 'finance.manage' }, render: renderFinance },
  documents: { title: 'Dokumente', sub: 'GoBD-Ablage, Versionen und Akten', primary: { label: 'Dokument ablegen', action: 'upload-document', permission: 'documents.manage' }, render: renderDocuments },
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
  finance: () => can('finance.view'),
  documents: () => can('documents.view'),
  contracts: () => can('contracts.view'),
  warehouse: () => can('warehouse.view'),
  team: () => can('employees.view'),
  users: () => can('users.manage'),
  settings: () => can('settings.manage'),
  dashboard: () => can('dashboard.view'),
};

let primaryAction = null;

async function navigate() {
  if (state.user?.must_change_password) {
    openPasswordChange({ mandatory: true });
    return;
  }
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
  if (data.personal) {
    await ensureGeoState();
    return renderTechnicianDashboard(data);
  }
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
      ${can('time.own') ? `<div class="clock-geo">
        <span class="geo-dot ${state.geo?.enabled ? (state.geo.last_error ? 'error' : 'on') : ''}" data-geo-dot></span>
        <span class="small" data-geo-status-text>${esc(geoStatusText())}</span>
      </div>` : ''}
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
    ${can('time.own') ? geoCard() : ''}

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
            ${order.property_id && can('orders.progress') ? `<button class="btn sm ghost" type="button" data-action="order-location" data-id="${order.id}" title="GPS-Standort für die automatische Zeiterfassung speichern">${icon('pin')} Standort</button>` : ''}
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
    await ensureGeoState();
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
  const site = await api.get(`/api/orders/${orderId}/site`).catch(() => null);
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
        ${canProgress && property ? `<button class="tech-btn" type="button" data-action="order-location" data-id="${order.id}">${icon('pin')}<span>Standort</span></button>` : ''}
        ${canReport ? `<button class="tech-btn" type="button" data-action="start-voice">${icon('mic')}<span>Sprache</span></button>` : ''}
      </div>` : ''}

    <div class="meta-grid">
      <div class="meta-item"><div class="k">Kunde</div><div class="v">${esc(customerName(customer))}<small>${esc(customer?.number || '')}</small></div></div>
      <div class="meta-item"><div class="k">Objekt</div><div class="v">${esc(property?.label || '–')}<small>${esc(property ? `${property.street || ''}, ${property.zip || ''} ${property.city || ''}` : '')}${property?.latitude ? ' · GPS-Standort gespeichert' : ''}</small></div></div>
      <div class="meta-item"><div class="k">Monteur</div><div class="v">${esc(employee?.name || 'nicht zugewiesen')}<small>${esc(employee?.role || '')}</small></div></div>
      <div class="meta-item"><div class="k">Termin</div><div class="v">${order.scheduled_date ? fmtDate(order.scheduled_date) : '–'}<small>${esc(order.priority === 'dringend' ? 'Dringend' : '')}</small></div></div>
    </div>

    ${phoneLinks(customer) ? `<div class="contact-row">${phoneLinks(customer)}</div>` : ''}

    <div class="subcard">
      <div class="section-head compact">
        <div><h4>Projektakte</h4><div class="small muted">Aufmaß, Checklisten, Bautagebuch, Unterschrift und Dokumente</div></div>
        <div class="small muted">${site ? `${site.measurements.length} Aufmaß · ${site.checklists.length} Listen · ${site.signatures.length} Unterschriften · ${site.diary.length} Tagebuch` : ''}</div>
      </div>
      <div class="tech-actions">
        ${canMoney ? `<button class="tech-btn" type="button" data-action="order-calculation" data-id="${order.id}">${icon('euro')}<span>Kalkulation</span></button>` : ''}
        <button class="tech-btn" type="button" data-action="order-measurements" data-id="${order.id}">${icon('edit')}<span>Aufmaß</span>${site?.measurements.length ? `<em>${site.measurements.length}</em>` : ''}</button>
        <button class="tech-btn" type="button" data-action="order-checklists" data-id="${order.id}">${icon('check')}<span>Checklisten</span>${site?.checklists.length ? `<em>${site.checklist_percent}%</em>` : ''}</button>
        <button class="tech-btn" type="button" data-action="order-diary" data-id="${order.id}">${icon('file')}<span>Bautagebuch</span>${site?.diary.length ? `<em>${site.diary.length}</em>` : ''}</button>
        ${canProgress ? `<button class="tech-btn" type="button" data-action="order-signature" data-id="${order.id}">${icon('edit')}<span>Unterschrift</span></button>` : ''}
        ${can('documents.view') ? `<button class="tech-btn" type="button" data-action="order-documents" data-id="${order.id}">${icon('file')}<span>Dokumente</span></button>` : ''}
        ${canMoney ? `<button class="tech-btn" type="button" data-action="order-gaeb" data-id="${order.id}">${icon('download')}<span>GAEB / OCI</span></button>` : ''}
        ${can('assistant.use') ? `<button class="tech-btn" type="button" data-action="assistant" data-kind="angebot" data-id="${order.id}">${icon('mic')}<span>Textassistent</span></button>` : ''}
      </div>
    </div>

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

    <div class="einvoice-bar">
      <span class="badge ${invoice.einvoice_status === 'versendet' ? 'bezahlt' : 'neutral'}">E-Rechnung: ${esc(invoice.einvoice_status || 'entwurf')}</span>
      <span class="small muted">Leitweg-ID / Buyer Reference: <b>${esc(invoice.buyer_reference || customer.leitweg_id || '–')}</b></span>
      ${can('invoices.manage') ? `<button class="btn sm ghost" type="button" data-action="edit-einvoice" data-id="${invoice.id}">${icon('edit')} Referenz</button>` : ''}
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
      <button class="btn sm" type="button" data-action="invoice-einvoice" data-id="${invoice.id}" data-format="xrechnung">${icon('download')} XRechnung</button>
      <button class="btn sm" type="button" data-action="invoice-einvoice" data-id="${invoice.id}" data-format="zugferd">${icon('download')} ZUGFeRD</button>
      ${invoice.dunning_level ? `<button class="btn sm" type="button" data-action="invoice-pdf" data-id="${invoice.id}" data-mahnung="1">${icon('download')} Mahnung</button>` : ''}
      ${canDun ? `<button class="btn sm" type="button" data-action="dunning-invoice" data-id="${invoice.id}">${icon('send')} Mahnen</button>` : ''}
      ${invoice.status === 'storniert' ? '' : `<button class="btn sm danger" type="button" data-action="storno-invoice" data-id="${invoice.id}">Storno</button>`}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
      ${can('assistant.use') ? `<button class="btn" type="button" data-action="assistant" data-kind="mahnung" data-invoice="${invoice.id}">${icon('mic')} Textassistent</button>` : ''}
      ${invoice.status === 'storniert' || open <= 0.01 ? '' : `<button class="btn primary" type="button" data-action="payment-invoice" data-id="${invoice.id}">${icon('euro')} Zahlung erfassen</button>`}
      <button class="btn" type="button" data-action="close-modal">Schließen</button>
    </div>`;

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
      { name: 'latitude', label: 'Breitengrad (GPS)', type: 'number', step: '0.0000001', min: -90, max: 90, hint: 'Optional. Am einfachsten vor Ort über „Standort“ im Auftrag aufnehmen.' },
      { name: 'longitude', label: 'Längengrad (GPS)', type: 'number', step: '0.0000001', min: -180, max: 180, hint: 'Optional – wird für die GPS-Zeiterfassung benötigt.' },
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
  const [articles, materialData] = await Promise.all([
    api.get('/api/articles'),
    // Quellen bei jedem Öffnen frisch laden – so wirkt eine Änderung in den
    // Einstellungen sofort, ohne die Seite neu laden zu müssen.
    api.get('/api/materials/sources').catch(() => null),
  ]);
  if (Array.isArray(materialData?.sources)) state.materialSources = materialData.sources;
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
  const canEnrich = canBook && materialLookupEnabled();
  const canDealer = materialDealerEnabled();
  const importSources = materialImportSources();

  view.innerHTML = `
    <div class="toolbar">
      <div class="chips">
        <button class="chip ${filter === 'alle' ? 'active' : ''}" data-action="filter-warehouse" data-filter="alle">Alle <span class="count">${articles.length}</span></button>
        ${categories.map((category) => `<button class="chip ${filter === category ? 'active' : ''}" data-action="filter-warehouse" data-filter="${esc(category)}">${esc(category)} <span class="count">${articles.filter((a) => a.category === category).length}</span></button>`).join('')}
        <button class="chip ${filter === 'niedrig' ? 'active' : ''}" data-action="filter-warehouse" data-filter="niedrig">Nachbestellen <span class="count">${lowCount}</span></button>
      </div>
      <div class="spacer"></div>
      ${canBook && importSources.length ? `<button class="btn sm" type="button" data-action="open-import">${icon('download')} Katalog importieren</button>` : ''}
      ${canBook ? `<button class="btn sm ghost" type="button" data-action="scan-article">${icon('search')} Scannen</button>` : ''}
      ${canBook ? `<button class="btn sm ghost" type="button" data-action="open-inventory">${icon('box')} Inventur</button>` : ''}
      ${canBook ? `<button class="btn sm ghost" type="button" data-action="open-lookup">${icon('search')} Material suchen</button>` : ''}
      <button class="btn sm ghost" type="button" data-action="open-import-history">${icon('clock')} Importe</button>
      ${showCosts ? `<span class="muted small">Lagerwert: <b style="color:var(--ink)">${money(stockValue)}</b></span>` : ''}
    </div>

    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Artikel</th><th>Kategorie</th><th class="right">Bestand</th><th class="right">Mindestbestand</th>${showCosts ? '<th class="right">EK</th>' : ''}<th class="right">VK</th>${showCosts ? '<th class="right">Lagerwert</th>' : ''}${canBook ? '<th class="right">Buchen</th>' : ''}</tr></thead>
          <tbody>
            ${visible.length ? visible.map((article) => `
              <tr>
                <td><div class="cell-main">${esc(article.name)}</div><div class="cell-sub">${esc(article.number)} · ${esc(article.supplier || '')}${article.gtin ? ` · GTIN ${esc(article.gtin)}` : ''}${article.manufacturer ? ` · ${esc(article.manufacturer)}` : ''}</div></td>
                <td><span class="badge neutral">${esc(article.category)}</span></td>
                <td class="right"><span class="badge ${article.low ? 'overdue' : 'bezahlt'}">${num2(article.stock)} ${esc(article.unit)}</span></td>
                <td class="right muted">${num2(article.min_stock)} ${esc(article.unit)}</td>
                ${showCosts ? `<td class="right num muted">${money(article.purchase_price)}</td>` : ''}
                <td class="right num">${money(article.sale_price)}</td>
                ${showCosts ? `<td class="right num">${money(article.stock_value)}</td>` : ''}
                ${canBook ? `<td class="right nowrap">
                  <button class="icon-btn" title="Wareneingang" data-action="stock-move" data-id="${article.id}" data-direction="1">${icon('plus')}</button>
                  <button class="icon-btn" title="Entnahme" data-action="stock-move" data-id="${article.id}" data-direction="-1">${icon('box')}</button>
                  ${canEnrich ? `<button class="icon-btn" title="Daten aus Quellen anreichern" data-action="enrich-article" data-id="${article.id}">${icon('refresh')}</button>` : ''}
                  ${canDealer ? `<button class="icon-btn" title="Im Händlershop öffnen" data-action="open-dealer" data-id="${article.id}">${icon('arrow')}</button>` : ''}
                  <button class="icon-btn" title="Bearbeiten" data-action="edit-article" data-id="${article.id}">${icon('edit')}</button>
                </td>` : ''}
              </tr>`).join('') : `<tr><td colspan="${5 + (showCosts ? 2 : 0) + (canBook ? 1 : 0)}"><div class="empty">${icon('box')}<div>Keine Artikel gefunden</div></div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    ${state.materialImports.length ? `<div class="card" style="margin-top:14px">
      <div class="card-head">
        <div><h2>Letzte Katalogimporte</h2><div class="small muted">Neu angelegte und aktualisierte Artikel der letzten Importe.</div></div>
        <button class="btn sm ghost" type="button" data-action="open-import-history">Alle anzeigen</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Datum</th><th>Quelle</th><th>Lieferant</th><th class="right">Neu</th><th class="right">Aktualisiert</th><th class="right">Fehler</th></tr></thead>
          <tbody>${state.materialImports.map((row) => `<tr>
            <td class="nowrap">${esc(fmtDateTime(row.created_at))}</td>
            <td>${esc(row.source)}</td>
            <td>${esc(row.supplier || '–')}</td>
            <td class="right">${row.created}</td>
            <td class="right">${row.updated}</td>
            <td class="right">${row.errors ? `<span class="badge overdue">${row.errors}</span>` : '0'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>` : ''}`;
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

/* ------------------------------------------------------------------ Materialquellen */
const materialImportSources = () => (state.materialSources || [])
  .filter((source) => source.kind === 'import' && source.enabled);
const materialLookupEnabled = () => (state.materialSources || [])
  .some((source) => ['icecat', 'upcitemdb', 'etim', 'dealer'].includes(source.id) && source.enabled);
const materialDealerEnabled = () => (state.materialSources || [])
  .some((source) => source.id === 'ids' && source.enabled);

/** Quellenstand nach dem Speichern von Einstellungen neu einlesen. */
async function refreshMaterialSources() {
  try {
    const data = await api.get('/api/materials/sources');
    if (Array.isArray(data?.sources)) state.materialSources = data.sources;
  } catch { /* Rechte/Netzwerk: alten Stand behalten */ }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve({ name: file.name, base64: result.slice(result.indexOf(',') + 1) });
    };
    reader.onerror = () => reject(new Error(`Datei ${file.name} konnte nicht gelesen werden.`));
    reader.readAsDataURL(file);
  });
}

async function openImportModal(preselect = '') {
  // Immer den gespeicherten Serverstand holen: Ein Schalter in den Einstellungen
  // wirkt damit sofort, auch wenn die Seite noch den alten Stand im Speicher hat.
  await refreshMaterialSources();
  const sources = materialImportSources();
  if (!sources.length) {
    openModal({
      title: 'Keine Importquelle eingeschaltet',
      subtitle: 'Datanorm, BMEcat und CSV müssen zuerst in den Einstellungen aktiviert werden.',
      body: `<div class="small" style="line-height:1.7">
        Unter <b>Einstellungen → Material &amp; Datenquellen</b> (ganz unten) die gewünschte
        Importquelle einschalten und <b>Einstellungen speichern</b>. Danach steht sie hier
        sofort zur Auswahl.
      </div>`,
      footer: `
        <button class="btn" type="button" data-action="close-modal">Schließen</button>
        <button class="btn primary" type="button" data-action="material-settings">Zu den Einstellungen</button>`,
    });
    return;
  }
  const selected = sources.find((source) => source.id === preselect) || sources[0];
  const settings = state.settings || {};
  openModal({
    title: 'Katalog importieren',
    subtitle: 'Datanorm, BMEcat oder CSV – vorhandene Artikel werden aktualisiert, neue angelegt.',
    size: 'wide',
    body: `
      <form id="import-form">
        <div class="form-grid">
          <div class="field">
            <label>Quelle</label>
            <select id="import-source">
              ${sources.map((source) => `<option value="${source.id}" ${source.id === selected.id ? 'selected' : ''}>${esc(source.label)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Lieferant</label>
            <input id="import-supplier" value="${esc(settings[`mat_${selected.id}_supplier`] || '')}" placeholder="z. B. Richter+Frenzel" />
            <span class="hint">Leer lassen, um den Lieferanten aus der Datei zu verwenden.</span>
          </div>
          <div class="field full">
            <label>Datei(en)</label>
            <input id="import-files" type="file" multiple accept="${esc(selected.accept || '')}" />
            <span class="hint">Bis zu 10 Dateien, je max. 64 MB (bitte entpackt). Datanorm: .001/.WRG/DATPREIS, BMEcat: XML, CSV: .csv/.txt.</span>
          </div>
          <div class="field">
            <label>Aufschlag auf EK (%)</label>
            <input id="import-markup" type="number" step="0.1" min="0" value="${esc(settings.mat_markup_default || 30)}" />
          </div>
        </div>
        <div class="check-group" style="margin-top:12px">
          <label class="check"><input type="checkbox" id="import-update-prices" ${settings.mat_import_update_prices === '1' ? 'checked' : ''} /> Einkaufspreise aktualisieren</label>
          <label class="check"><input type="checkbox" id="import-keep-sale" ${settings.mat_import_keep_sale_price === '1' ? 'checked' : ''} /> Verkaufspreise behalten</label>
          <label class="check"><input type="checkbox" id="import-update-stock" ${settings.mat_import_update_stock === '1' ? 'checked' : ''} /> Bestände übernehmen</label>
        </div>
        <div id="import-status" class="small muted" style="margin-top:12px">Bereit.</div>
      </form>`,
    footer: `
      <button class="btn" type="button" data-action="close-modal">Abbrechen</button>
      <button class="btn primary" type="button" data-action="run-import">${icon('download')} Import starten</button>`,
  });
}

async function runImport() {
  const button = $('[data-action="run-import"]');
  const status = $('#import-status');
  const input = $('#import-files');
  const files = [...(input?.files || [])];
  if (!files.length) {
    toast('Bitte mindestens eine Datei auswählen.', 'error');
    return;
  }
  if (files.length > 10) {
    toast('Bitte höchstens 10 Dateien auf einmal importieren.', 'error');
    return;
  }
  if (button) button.disabled = true;
  try {
    if (status) status.textContent = 'Dateien werden gelesen …';
    const payloadFiles = await Promise.all(files.map(readFileAsBase64));
    if (status) status.textContent = 'Import läuft … das kann bei großen Katalogen etwas dauern.';
    const result = await api.post('/api/materials/import', {
      source: $('#import-source')?.value || '',
      supplier: $('#import-supplier')?.value.trim() || '',
      files: payloadFiles,
      options: {
        markup: Number($('#import-markup')?.value || 0),
        updatePrices: $('#import-update-prices')?.checked,
        keepSalePrice: $('#import-keep-sale')?.checked,
        updateStock: $('#import-update-stock')?.checked,
      },
    });
    if (status) {
      status.innerHTML = `<b>${esc(result.summary)}</b>
        ${result.details?.length ? `<div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Zeile</th><th>Artikel</th><th>Fehler</th></tr></thead><tbody>
          ${result.details.map((entry) => `<tr><td>${esc(entry.line ?? '–')}</td><td>${esc(entry.number || '–')}</td><td>${esc(entry.message)}</td></tr>`).join('')}
        </tbody></table></div>` : ''}`;
    }
    toast(result.summary, result.errors ? 'info' : 'success');
    await loadBase();
    refresh();
  } catch (error) {
    if (status) status.textContent = error.message;
    toast(error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function openImportHistory() {
  openModal({
    title: 'Import-Historie',
    subtitle: 'Die letzten Katalogimporte mit Ergebnis und Fehlern.',
    size: 'xwide',
    body: '<div id="import-history"><div class="empty">Lade …</div></div>',
    footer: '<button class="btn" type="button" data-action="close-modal">Schließen</button>',
  });
  try {
    const rows = await api.get('/api/materials/imports?limit=50');
    const target = $('#import-history');
    if (!target) return;
    target.innerHTML = rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Datum</th><th>Quelle</th><th>Lieferant</th><th>Datei</th><th class="right">Neu</th><th class="right">Aktualisiert</th><th class="right">Fehler</th><th>Von</th></tr></thead>
      <tbody>${rows.map((row) => `<tr>
        <td class="nowrap">${esc(fmtDateTime(row.created_at))}</td>
        <td>${esc(row.source)}</td>
        <td>${esc(row.supplier || '–')}</td>
        <td class="small">${esc(row.filename || '–')}</td>
        <td class="right">${row.created}</td>
        <td class="right">${row.updated}</td>
        <td class="right">${row.errors ? `<span class="badge overdue">${row.errors}</span>` : '0'}</td>
        <td>${esc(row.user_name || '–')}</td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty">Noch keine Importe.</div>';
  } catch (error) {
    toast(error.message, 'error');
  }
}

function openLookupModal() {
  openModal({
    title: 'Material suchen',
    subtitle: 'GTIN/EAN, Artikelnummer oder Suchbegriff – abhängig von den eingeschalteten Quellen.',
    size: 'wide',
    body: `
      <form id="lookup-form">
        <div class="form-grid">
          <div class="field"><label>GTIN / EAN</label><input id="lookup-gtin" placeholder="z. B. 4012345678901" /></div>
          <div class="field"><label>Artikelnummer</label><input id="lookup-article" placeholder="Hersteller- oder Händlerartikelnummer" /></div>
          <div class="field"><label>Hersteller / Marke</label><input id="lookup-manufacturer" placeholder="z. B. Viega" /></div>
          <div class="field full"><label>Suchbegriff (ETIM)</label><input id="lookup-query" placeholder="z. B. Pressfitting" /></div>
        </div>
      </form>
      <div id="lookup-results" style="margin-top:14px"></div>`,
    footer: `
      <button class="btn" type="button" data-action="close-modal">Schließen</button>
      <button class="btn primary" type="button" data-action="run-lookup">${icon('search')} Suchen</button>`,
  });
}

async function runLookup() {
  const button = $('[data-action="run-lookup"]');
  const target = $('#lookup-results');
  if (button) button.disabled = true;
  if (target) target.innerHTML = '<div class="small muted">Suche läuft …</div>';
  try {
    const result = await api.post('/api/materials/lookup', {
      gtin: $('#lookup-gtin')?.value.trim() || '',
      articleNumber: $('#lookup-article')?.value.trim() || '',
      manufacturer: $('#lookup-manufacturer')?.value.trim() || '',
      query: $('#lookup-query')?.value.trim() || '',
    });
    state.lookupResults = result.results || [];
    if (!target) return;
    target.innerHTML = `
      ${result.gtin?.gtin ? `<div class="small" style="margin-bottom:8px">GTIN ${esc(result.gtin.gtin)}: <b>${result.gtin.valid ? 'Prüfziffer gültig' : 'Prüfziffer ungültig'}</b>${result.gtin.gs1Url ? ` · <a href="${esc(result.gtin.gs1Url)}" target="_blank" rel="noopener noreferrer">bei GS1 prüfen</a>` : ''}</div>` : ''}
      ${(result.warnings || []).length ? `<div class="small" style="color:#b45309;margin-bottom:8px">${result.warnings.map(esc).join('<br />')}</div>` : ''}
      ${state.lookupResults.length ? state.lookupResults.map((entry, index) => `
        <div class="lookup-result">
          <div class="lr-main">
            <div class="lr-title">${esc(entry.name || entry.sourceId || 'Treffer')} <span class="badge neutral">${esc(entry.source)}</span></div>
            <div class="small muted">${[entry.manufacturer, entry.sourceId, entry.gtin, entry.category].filter(Boolean).map(esc).join(' · ')}</div>
            ${entry.attributes?.length ? `<div class="small muted">${entry.attributes.slice(0, 6).map((attribute) => esc(`${attribute.label}: ${attribute.value}`)).join(' · ')}</div>` : ''}
          </div>
          <div class="lr-side">
            ${entry.purchasePrice ? `<div class="num">${money(entry.purchasePrice)}</div>` : ''}
            <button class="btn sm" type="button" data-action="adopt-lookup" data-index="${index}">${icon('plus')} Als Artikel</button>
          </div>
        </div>`).join('') : '<div class="empty">Keine Treffer. Bitte Zugangsdaten und Suchbegriff prüfen.</div>'}`;
  } catch (error) {
    if (target) target.innerHTML = `<div class="small" style="color:#b91c1c">${esc(error.message)}</div>`;
    toast(error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function adoptLookup(index) {
  const entry = state.lookupResults[index];
  if (!entry) return;
  const purchase = Number(entry.purchasePrice) || 0;
  const markup = Number(state.settings.mat_markup_default) || 30;
  try {
    await api.post('/api/articles', {
      number: entry.sourceId || '',
      name: entry.name || entry.sourceId || 'Artikel aus Datenquelle',
      category: entry.category || 'Material',
      unit: entry.unit || 'Stk',
      purchase_price: purchase,
      sale_price: Math.round(purchase * (1 + markup / 100) * 100) / 100,
      stock: 0,
      min_stock: 0,
      supplier: entry.manufacturer || '',
      gtin: entry.gtin || '',
      manufacturer: entry.manufacturer || '',
      manufacturer_number: entry.manufacturerNumber || '',
      etim_class: entry.etimClass || '',
      datasheet_url: entry.datasheetUrl || '',
      image_url: entry.imageUrl || '',
      source: entry.source || '',
      source_id: entry.sourceId || '',
    });
    toast('Artikel angelegt.');
    closeModal();
    await loadBase();
    refresh();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function enrichArticle(id) {
  const button = $(`[data-action="enrich-article"][data-id="${id}"]`);
  if (button) button.disabled = true;
  try {
    const result = await api.post(`/api/materials/articles/${id}/enrich`, {});
    if (result.applied?.length) {
      toast(`Artikel angereichert: ${result.applied.join(', ')}.`);
      await loadBase();
      refresh();
    } else {
      toast(result.warnings?.length ? result.warnings.join(' ') : 'Keine neuen Daten gefunden.', 'info');
    }
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function openDealerLink(id) {
  try {
    const result = await api.get(`/api/materials/deep-link/${id}`);
    if (!result.url) throw new Error('Kein Shop-Link hinterlegt.');
    window.open(result.url, '_blank', 'noopener,noreferrer');
  } catch (error) {
    toast(error.message, 'error');
  }
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
function startOfMonth(date = new Date()) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function renderPlanning() {
  if (!state.weekStart) state.weekStart = startOfWeek();
  if (!state.monthStart) state.monthStart = startOfMonth(new Date());
  const mode = state.calendarMode || 'week';

  // Zeitraum je Ansicht
  let start;
  let end;
  if (mode === 'month') {
    start = startOfWeek(state.monthStart);
    end = new Date(start);
    end.setDate(end.getDate() + 41);
  } else {
    start = new Date(state.weekStart);
    end = new Date(start);
    end.setDate(end.getDate() + 6);
  }
  const board = mode === 'board'
    ? await api.get(`/api/planning/board?from=${toDateInput(start)}&to=${toDateInput(end)}`)
    : null;
  const appointments = board
    ? board.appointments
    : await api.get(`/api/appointments?from=${toDateInput(start)}&to=${toDateInput(end)}`);
  // Urlaub und Abwesenheiten auch in Wochen-/Monatsansicht anzeigen.
  let absenceRows = board ? board.absences : [];
  if (!board && can('employees.view')) {
    try {
      const data = await api.get(`/api/absences?from=${toDateInput(start)}&to=${toDateInput(end)}`);
      absenceRows = (data.absences || []).filter((row) => row.status !== 'abgelehnt');
    } catch { absenceRows = []; }
  }
  const absencesForDay = (key) => absenceRows.filter((row) => row.start_date <= key && row.end_date >= key);
  const absenceLabel = (row) => `${row.type_label || (row.type === 'urlaub' ? 'Urlaub' : 'Abwesend')}${row.status === 'beantragt' ? ' (beantragt)' : ''}`;
  const absenceDayLabel = (row) => {
    const short = String(row.employee_name || '').trim().split(/\s+/)[0];
    return short ? `${short} · ${absenceLabel(row)}` : absenceLabel(row);
  };
  const absenceTitle = (row) => `${row.type_label || 'Abwesend'} · ${row.employee_name || ''} · ${row.status_label || row.status}`.replace(/\s+/g, ' ').trim();
  const term = state.search.toLowerCase();
  const visible = term
    ? appointments.filter((a) => `${a.title} ${a.order_number || ''} ${customerName(a)} ${a.employee_name || ''} ${kindLabel(a.kind)}`.toLowerCase().includes(term))
    : appointments;
  const kindFilter = state.planningKind || 'alle';
  const kindsPresent = [...new Set(visible.map((a) => a.kind || 'baustelle'))];
  const shown = kindFilter === 'alle' ? visible : visible.filter((a) => (a.kind || 'baustelle') === kindFilter);
  const todayKey = todayISO();

  const days = [...Array(7)].map((_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    return date;
  });
  const hours = [...Array(13)].map((_, index) => index + 7);
  const rangeLabel = mode === 'month'
    ? state.monthStart.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
    : `${start.toLocaleDateString('de-DE', { day: '2-digit', month: 'long' })} – ${end.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}`;
  const countLabel = mode === 'month' ? 'in diesem Monat' : 'in dieser Woche';

  const eventMarkup = (event) => {
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
  };

  const weekHtml = `
    <div class="calendar">
      <div class="cal-grid">
        <div class="cal-head"></div>
        ${days.map((date) => {
          const key = toDateInput(date);
          const dayAbsences = absencesForDay(key);
          return `<div class="cal-head-cell ${key === todayKey ? 'today' : ''}">
            <div class="dow">${date.toLocaleDateString('de-DE', { weekday: 'short' })}</div>
            <div class="day">${date.getDate()}</div>
            ${dayAbsences.map((row) => `<div class="cal-absence ${row.status === 'beantragt' ? 'pending' : ''}" title="${esc(absenceTitle(row))}">${esc(absenceDayLabel(row))}</div>`).join('')}
          </div>`;
        }).join('')}
        <div class="cal-times">
          ${hours.map((hour) => `<div class="cal-hour">${String(hour).padStart(2, '0')}:00</div>`).join('')}
        </div>
        ${days.map((date) => {
          const key = toDateInput(date);
          const dayEvents = shown.filter((a) => toDateInput(a.start_at) === key);
          return `<div class="cal-day ${key === todayKey ? 'today' : ''} ${absencesForDay(key).length ? 'has-absence' : ''}" data-date="${key}">
            ${hours.map(() => '<div class="slot"></div>').join('')}
            ${dayEvents.map(eventMarkup).join('')}
          </div>`;
        }).join('')}
      </div>
    </div>`;

  const monthDays = [...Array(42)].map((_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    return date;
  });

  const monthHtml = `
    <div class="month-grid">
      ${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((label) => `<div class="month-head">${label}</div>`).join('')}
      ${monthDays.map((date) => {
        const key = toDateInput(date);
        const events = shown.filter((a) => toDateInput(a.start_at) === key);
        const dayAbsences = absencesForDay(key);
        const otherMonth = date.getMonth() !== state.monthStart.getMonth();
        return `<div class="month-day ${otherMonth ? 'other' : ''} ${key === todayKey ? 'today' : ''}" data-date="${key}">
          <div class="md-num">${date.getDate()}</div>
          <div class="md-events">
            ${dayAbsences.map((row) => `<div class="md-absence ${row.status === 'beantragt' ? 'pending' : ''}" title="${esc(absenceTitle(row))}">
              <span class="md-dot" style="background:${row.status === 'beantragt' ? '#d97706' : '#be123c'}"></span>
              <span class="md-title">${esc(absenceDayLabel(row))}</span>
            </div>`).join('')}
            ${events.slice(0, 3).map((event) => {
              const info = kindInfo(event.kind);
              return `<div class="md-event" data-action="open-appointment" data-id="${event.id}" data-order="${event.order_id || ''}" title="${esc(event.title)} · ${esc(info.label)}">
                <span class="md-dot" style="background:${info.color}"></span>
                <span class="md-time">${fmtTime(event.start_at)}</span>
                <span class="md-title">${esc(event.title)}</span>
                ${event.confirmed_at ? '<span class="md-flag ok">✓</span>' : event.declined_at ? '<span class="md-flag no">✕</span>' : ''}
              </div>`;
            }).join('')}
            ${events.length > 3 ? `<div class="md-more">+${events.length - 3} weitere</div>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;

  const boardHtml = board ? `
    <div class="toolbar" style="padding:12px 14px 0">
      <div class="small muted">${board.employees.length} Mitarbeiter · ${board.resources.length} Ressourcen · Plantafel mit Kapazitätsprüfung</div>
      <div class="spacer"></div>
      ${can('planning.manage') ? `<button class="btn sm" type="button" data-action="new-resource">${icon('plus')} Ressource</button>` : ''}
      <button class="btn sm ghost" type="button" data-action="resource-list">${icon('box')} Verwalten</button>
    </div>
    <div class="board-scroll">
      <table class="plantafel">
        <thead>
          <tr>
            <th class="pt-name">Team / Ressource</th>
            ${days.map((date) => {
              const key = toDateInput(date);
              return `<th class="${key === todayKey ? 'today' : ''}">
                <span>${date.toLocaleDateString('de-DE', { weekday: 'short' })}</span>
                <b>${date.getDate()}.${date.getMonth() + 1}.</b>
              </th>`;
            }).join('')}
          </tr>
        </thead>
        <tbody>
          ${board.employees.map((employee) => `
            <tr>
              <th class="pt-name">
                <span class="legend-dot" style="background:${esc(employee.color || '#0f766e')}"></span>
                <span><b>${esc(employee.name)}</b><small>${esc(employee.role || '')} · ${Number(employee.weekly_hours || 40)} Std.</small></span>
              </th>
              ${days.map((date) => {
                const key = toDateInput(date);
                const absences = board.absences.filter((row) => row.employee_id === employee.id
                  && row.start_date <= key && row.end_date >= key);
                const events = board.appointments.filter((row) => row.employee_id === employee.id
                  && toDateInput(row.start_at) === key);
                return `<td class="pt-cell ${key === todayKey ? 'today' : ''}">
                  ${absences.map((row) => `<span class="pt-chip absence ${row.status === 'beantragt' ? 'pending' : ''}" title="${esc(absenceTitle(row))}">${esc(absenceLabel(row))}</span>`).join('')}
                  ${events.map((row) => `<button class="pt-chip appt" type="button" data-action="open-appointment" data-id="${row.id}" title="${esc(row.title)}">
                    <span>${fmtTime(row.start_at)}</span>${esc(row.order_title || row.title)}
                  </button>`).join('')}
                  ${can('planning.manage') && !events.length ? `<button class="pt-add" type="button" data-action="new-appointment" data-date="${key}" title="Termin anlegen">+</button>` : ''}
                </td>`;
              }).join('')}
            </tr>`).join('')}
          ${board.resources.map((resource) => `
            <tr class="resource-row">
              <th class="pt-name">
                <span class="resource-dot" style="background:${esc(resource.color || '#0f766e')}">${icon(resource.type === 'werkzeug' ? 'edit' : resource.type === 'maschine' ? 'refresh' : 'box')}</span>
                <span><b>${esc(resource.name)}</b><small>${esc(resource.type_label)}${resource.identifier ? ` · ${esc(resource.identifier)}` : ''}</small></span>
              </th>
              ${days.map((date) => {
                const key = toDateInput(date);
                const bookings = board.bookings.filter((row) => row.resource_id === resource.id
                  && toDateInput(row.start_at) === key);
                return `<td class="pt-cell ${key === todayKey ? 'today' : ''}">
                  ${bookings.map((row) => `<button class="pt-chip resource" type="button" data-action="edit-booking" data-id="${row.id}" title="${esc(row.order_number || '')} ${esc(row.note || '')}">
                    <span>${fmtTime(row.start_at)}</span>${esc(row.order_number || row.note || 'Belegung')}
                  </button>`).join('')}
                  ${can('planning.manage') ? `<button class="pt-add" type="button" data-action="new-booking" data-resource="${resource.id}" data-date="${key}" title="Ressource einplanen">+</button>` : ''}
                </td>`;
              }).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '';

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
      <div class="view-switch">
        <button class="chip ${mode === 'week' ? 'active' : ''}" data-action="calendar-mode" data-mode="week">Woche</button>
        <button class="chip ${mode === 'month' ? 'active' : ''}" data-action="calendar-mode" data-mode="month">Monat</button>
        <button class="chip ${mode === 'board' ? 'active' : ''}" data-action="calendar-mode" data-mode="board">Plantafel</button>
      </div>
    </div>
    <div class="card">
      <div class="card-head">
        <div>
          <h2>${rangeLabel}</h2>
          <div class="sub">${shown.length} ${shown.length === 1 ? 'Termin' : 'Termine'} ${countLabel}</div>
        </div>
        <div class="right">
          <button class="btn sm" data-action="calendar-prev">‹</button>
          <button class="btn sm" data-action="calendar-today">Heute</button>
          <button class="btn sm" data-action="calendar-next">›</button>
        </div>
      </div>
      ${mode === 'board' ? boardHtml : mode === 'month' ? monthHtml : weekHtml}
      <div class="cal-legend">
        ${state.employees.filter((e) => e.active).map((employee) => `
          <span class="legend-item"><span class="legend-dot" style="background:${esc(employee.color)}"></span>${esc(employee.name)}</span>`).join('')}
        <span class="legend-item" style="margin-left:auto"><span class="legend-dot" style="background:#0f4c5c"></span>Termin</span>
      </div>
    </div>`;

  const openAt = (date, hour = 8, minute = 0) => {
    if (!can('planning.manage')) return;
    const pad = (n) => String(n).padStart(2, '0');
    appointmentForm(null, {
      date,
      time: `${pad(hour)}:${pad(minute)}`,
      endTime: `${pad(Math.min(20, hour + 1))}:${pad(minute)}`,
    });
  };

  // Klick in freie Fläche: Termin anlegen
  $$('.cal-day', view).forEach((day) => {
    day.addEventListener('click', (event) => {
      if (event.target.closest('.event')) return;
      const rect = day.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const totalMinutes = Math.max(0, Math.floor(((y / 52) * 60) / 30) * 30);
      const hour = 7 + Math.floor(totalMinutes / 60);
      const minute = totalMinutes % 60;
      if (hour >= 20) return;
      openAt(day.dataset.date, hour, minute);
    });
  });
  $$('.month-day', view).forEach((day) => {
    day.addEventListener('click', (event) => {
      if (event.target.closest('.md-event')) return;
      openAt(day.dataset.date, 8, 0);
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
    ${appointment.mail_sent_at ? `<div class="small muted">Per E-Mail gesendet: ${fmtDateTime(appointment.mail_sent_at)}</div>` : ''}
    ${manage ? `<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <button class="btn sm" data-action="appointment-mail" data-id="${appointment.id}">${icon('mail')} Per E-Mail senden</button>
      <button class="btn sm" data-action="appointment-reset" data-id="${appointment.id}">${icon('refresh')} Zurücksetzen</button>
    </div>` : ''}
  </div>`;
}

async function openMailTo(appointment) {
  const link = appointmentLink(appointment);
  if (!link) return;
  let email = '';
  const customerId = appointment.customer_id;
  if (customerId) {
    try {
      email = (await api.get(`/api/customers/${customerId}`)).customer.email || '';
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
  await ensureGeoState();
  const entries = await api.get(`/api/time?from=${from}&to=${todayISO()}`);
  const total = entries.reduce((sum, entry) => sum + (entry.minutes || 0), 0);

  const employeeOptions = state.employees.map((employee) => ({ value: employee.id, label: employee.name }));
  view.innerHTML = `
    ${clockCard({ time: state.time, todayMinutes: state.todayMinutes, weekMinutes: state.weekMinutes })}
    ${can('time.own') ? geoCard() : ''}
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
                <td class="small muted">${entry.source === 'gps' ? '<span class="mini-tag">GPS</span> ' : ''}${esc(entry.note || '')}</td>
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

/* ------------------------------------------------------------------ GPS-Zeiterfassung */
const GEO_ZONE_STORAGE = () => `handwerkpro_geo_zones_${state.user?.id || 'anon'}`;

function distanceBetween(lat1, lng1, lat2, lng2) {
  const rad = (value) => Number(value) * Math.PI / 180;
  const dLat = rad(lat2) - rad(lat1);
  const dLng = rad(lng2) - rad(lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function loadStoredZones() {
  try {
    const raw = JSON.parse(localStorage.getItem(GEO_ZONE_STORAGE()) || 'null');
    if (!raw || !raw.updatedAt) return null;
    // Nach längerer Pause keine alten Übergänge auslösen.
    if (Date.now() - Number(raw.updatedAt) > 6 * 60 * 60 * 1000) return null;
    return {
      initialized: true,
      homeInside: Boolean(raw.homeInside),
      orderInside: raw.orderInside && typeof raw.orderInside === 'object' ? raw.orderInside : {},
      activeOrderId: raw.activeOrderId ?? null,
    };
  } catch { return null; }
}

function saveStoredZones(zones) {
  try {
    localStorage.setItem(GEO_ZONE_STORAGE(), JSON.stringify({ ...zones, updatedAt: Date.now() }));
  } catch { /* Speicher nicht verfügbar */ }
}

async function ensureGeoState(force = false) {
  if (!can('time.own')) return null;
  if (state.geo?.loaded && !force) {
    if (state.geo.enabled) startGeoTracking();
    return state.geo;
  }
  try {
    const data = await api.get('/api/geo/status');
    state.geo = {
      ...(state.geo || {}),
      ...data,
      loaded: true,
      supported: 'geolocation' in navigator,
      secure: window.isSecureContext,
    };
    if (data.time !== undefined) state.time = data.time;
    const stored = state.geo.zones || loadStoredZones();
    if (stored) state.geo.zones = stored;
    if (state.geo.enabled) startGeoTracking();
    else stopGeoTracking();
  } catch (error) {
    state.geo = {
      ...(state.geo || {}), loaded: true, enabled: false,
      supported: 'geolocation' in navigator,
      secure: window.isSecureContext,
      last_error: error.message,
    };
  }
  return state.geo;
}

function startGeoTracking() {
  const geo = state.geo;
  if (!geo?.enabled || !geo.supported || !geo.secure) {
    stopGeoTracking();
    return;
  }
  if (geo.watchId != null) return;
  try {
    geo.watchId = navigator.geolocation.watchPosition(onGeoPosition, onGeoError, {
      enableHighAccuracy: true,
      maximumAge: 15000,
      timeout: 30000,
    });
  } catch {
    geo.last_error = 'Standortbestimmung konnte nicht gestartet werden.';
    geo.watchId = null;
    updateGeoIndicators();
    return;
  }
  if (geo.refreshTimer) clearInterval(geo.refreshTimer);
  geo.refreshTimer = setInterval(refreshGeoTargets, 5 * 60 * 1000);
  updateGeoIndicators();
}

function stopGeoTracking() {
  const geo = state.geo;
  if (!geo) return;
  if (geo.watchId != null && 'geolocation' in navigator) {
    try { navigator.geolocation.clearWatch(geo.watchId); } catch { /* stumm */ }
  }
  geo.watchId = null;
  if (geo.refreshTimer) clearInterval(geo.refreshTimer);
  geo.refreshTimer = null;
  updateGeoIndicators();
}

async function refreshGeoTargets() {
  if (!state.geo?.enabled) return;
  try {
    const data = await api.get('/api/geo/status');
    state.geo = { ...state.geo, ...data, loaded: true };
    if (data.time !== undefined) state.time = data.time;
    if (data.enabled) startGeoTracking();
    else stopGeoTracking();
    updateGeoIndicators();
  } catch { /* Verbindung unterbrochen – beim nächsten Versuch erneut */ }
}

function onGeoPosition(position) {
  const geo = state.geo;
  if (!geo?.enabled) return;
  geo.last_position = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Math.round(position.coords.accuracy || 0),
    at: Date.now(),
  };
  geo.last_error = '';
  evaluateGeofences();
}

function onGeoError(error) {
  const geo = state.geo;
  if (!geo) return;
  geo.last_error = error.code === 1
    ? 'Standortfreigabe verweigert – bitte im Browser erlauben.'
    : error.code === 3
      ? 'GPS-Signal zu schwach – bitte kurz warten.'
      : 'Standort konnte nicht ermittelt werden.';
  geo.quality = 'bad';
  updateGeoIndicators();
}

function geoStatusText() {
  const geo = state.geo;
  if (!geo) return 'GPS-Status wird geladen …';
  if (!geo.supported) return 'Dieser Browser unterstützt kein GPS.';
  if (!geo.secure) return 'GPS benötigt HTTPS oder localhost.';
  if (!geo.enabled) return 'GPS-Zeiterfassung ist ausgeschaltet.';
  if (geo.absence_today) return `GPS pausiert · genehmigte Abwesenheit (${geo.absence_today.type_label || geo.absence_today.type}).`;
  if (geo.last_error) return geo.last_error;
  if (!geo.last_position) return 'GPS aktiv – warte auf Standort …';
  if (geo.quality === 'bad') {
    return `GPS-Signal ungenau (±${Math.round(geo.last_position.accuracy || 0)} m) – warte …`;
  }
  const parts = [`GPS aktiv · ±${Math.round(geo.last_position.accuracy || 0)} m`];
  if (geo.inside_order) parts.push(`an ${geo.inside_order.number}`);
  else if (geo.inside_home) parts.push('zu Hause');
  return parts.join(' · ');
}

function updateGeoIndicators() {
  const text = geoStatusText();
  $$('[data-geo-status-text]').forEach((element) => { element.textContent = text; });
  const on = Boolean(state.geo?.enabled);
  const error = Boolean(state.geo?.last_error);
  $$('[data-geo-dot]').forEach((element) => {
    element.classList.toggle('on', on && !error);
    element.classList.toggle('error', on && error);
  });
}

function evaluateGeofences() {
  const geo = state.geo;
  if (!geo?.enabled || !geo.last_position) return;
  if (geo.absence_today) {
    geo.inside_order = null;
    updateGeoIndicators();
    return;
  }
  const position = geo.last_position;
  const accuracy = Number(position.accuracy) || 0;
  const radius = Number(geo.radius_m) || 150;
  if (accuracy > Math.max(250, radius * 1.5)) {
    geo.quality = 'bad';
    updateGeoIndicators();
    return;
  }
  geo.quality = 'ok';
  const exitRadius = radius + Math.max(50, radius * 0.35);
  const zones = geo.zones || { initialized: false, homeInside: false, orderInside: {}, activeOrderId: null };
  if (!zones.orderInside) zones.orderInside = {};
  const firstRun = !zones.initialized;

  let nearest = null;
  const seen = new Set();
  (geo.targets || []).forEach((target) => {
    if (target.latitude == null || target.longitude == null) return;
    const key = String(target.order_id);
    seen.add(key);
    const distance = distanceBetween(
      position.latitude, position.longitude,
      Number(target.latitude), Number(target.longitude),
    );
    const wasInside = zones.orderInside[key] === true;
    const inside = wasInside ? distance <= exitRadius : distance <= radius;
    zones.orderInside[key] = inside;
    target.distance_m = Math.round(distance);
    if (inside && (!nearest || distance < nearest.distance_m)) {
      nearest = { ...target, distance_m: distance };
    }
  });
  Object.keys(zones.orderInside).forEach((key) => { if (!seen.has(key)) delete zones.orderInside[key]; });

  let homeInside = false;
  if (geo.home) {
    const distance = distanceBetween(
      position.latitude, position.longitude,
      Number(geo.home.latitude), Number(geo.home.longitude),
    );
    const wasInside = zones.homeInside === true;
    homeInside = wasInside ? distance <= exitRadius : distance <= radius;
  }

  // Erste Auswertung nach dem Start: nur Ist-Zustand merken, keine Zeit schalten.
  if (firstRun) {
    zones.initialized = true;
    zones.homeInside = homeInside;
    zones.activeOrderId = nearest ? nearest.order_id : null;
    geo.zones = zones;
    geo.inside_order = nearest ? { order_id: nearest.order_id, number: nearest.number } : null;
    geo.inside_home = !nearest && homeInside;
    saveStoredZones(zones);
    updateGeoIndicators();
    return;
  }

  // Baustelle hat Vorrang vor Zuhause (z. B. wenn beide nah beieinander liegen).
  if (nearest) {
    geo.inside_order = { order_id: nearest.order_id, number: nearest.number };
    geo.inside_home = false;
    if (zones.activeOrderId !== nearest.order_id) {
      zones.activeOrderId = nearest.order_id;
      sendGeoEvent('order_enter', nearest.order_id);
    }
  } else {
    geo.inside_order = null;
    if (zones.activeOrderId != null && !zones.orderInside[String(zones.activeOrderId)]) {
      const previous = zones.activeOrderId;
      zones.activeOrderId = null;
      sendGeoEvent('order_exit', previous);
    }
    geo.inside_home = homeInside;
    if (homeInside !== Boolean(zones.homeInside)) {
      sendGeoEvent(homeInside ? 'home_enter' : 'home_exit');
    }
  }

  zones.homeInside = homeInside;
  geo.zones = zones;
  saveStoredZones(zones);
  updateGeoIndicators();
}

async function sendGeoEvent(kind, orderId = null) {
  const geo = state.geo;
  if (!geo?.last_position) return;
  if (geo.sending) {
    geo.queue = geo.queue || [];
    geo.queue.push({ kind, orderId });
    return;
  }
  geo.sending = true;
  try {
    const position = geo.last_position;
    const result = await api.post('/api/geo/event', {
      kind,
      order_id: orderId || null,
      latitude: position.latitude,
      longitude: position.longitude,
      accuracy: position.accuracy,
    });
    if (result.time !== undefined) state.time = result.time;
    if (result.message && !result.duplicate) {
      toast(result.message, result.started ? 'success' : 'info');
      if (!state.dictation) speak(result.message.replace(/^GPS:\s*/, ''));
      geo.last_event = { kind, at: Date.now(), message: result.message };
    }
    await refreshSelfTime();
    if (state.page === 'my' || state.page === 'time') await refresh();
    else updateGeoIndicators();
  } catch (error) {
    geo.last_error = error.message;
    if (error.status === 400) toast(error.message, 'error');
    updateGeoIndicators();
  } finally {
    geo.sending = false;
    const next = (geo.queue || []).shift();
    if (next) sendGeoEvent(next.kind, next.orderId);
  }
}

function geoPositionOnce() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Dieser Browser unterstützt kein GPS.'));
      return;
    }
    if (!window.isSecureContext) {
      reject(new Error('GPS benötigt HTTPS oder localhost.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: Math.round(position.coords.accuracy || 0),
      }),
      (error) => reject(new Error(error.code === 1
        ? 'Standortfreigabe wurde verweigert. Bitte im Browser erlauben.'
        : error.code === 3
          ? 'GPS-Signal zu schwach. Bitte draußen erneut versuchen.'
          : 'Standort konnte nicht ermittelt werden.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

function geoCard() {
  const geo = state.geo || {};
  const enabled = Boolean(geo.enabled);
  const home = geo.home;
  const targets = geo.targets || [];
  const events = geo.events || [];
  const supported = geo.supported !== false && 'geolocation' in navigator;
  const secure = geo.secure !== false && window.isSecureContext;
  const disabled = !supported || !secure;
  return `
    <div class="card geo-card" data-geo-card>
      <div class="card-head">
        <div>
          <h2>${icon('pin')} GPS-Zeiterfassung</h2>
          <div class="sub">Automatisch starten und stoppen an Baustelle und Zuhause</div>
        </div>
        <label class="switch" title="GPS-Zeiterfassung ein- oder ausschalten">
          <input type="checkbox" data-action="toggle-geo" aria-label="GPS-Zeiterfassung ein- oder ausschalten" ${enabled ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
          <span class="switch-track"><span class="switch-thumb"></span></span>
        </label>
      </div>
      <div class="card-body">
        <div class="geo-status-line">
          <span class="geo-dot ${enabled ? (geo.last_error ? 'error' : 'on') : ''}" data-geo-dot></span>
          <span class="small" data-geo-status-text>${esc(geoStatusText())}</span>
          <span class="spacer"></span>
          <button class="btn sm ghost" type="button" data-action="geo-settings">${icon('edit')} Radius</button>
        </div>
        ${geo.absence_today ? `<div class="geo-note">${icon('calendar')} Genehmigte Abwesenheit (${esc(geo.absence_today.type_label || geo.absence_today.type)}): Die automatische Zeiterfassung ist pausiert.</div>` : ''}
        ${!supported ? `<div class="geo-note">${icon('alert')} Dieser Browser unterstützt keine Standortbestimmung.</div>` : ''}
        ${supported && !secure ? `<div class="geo-note">${icon('alert')} GPS funktioniert nur über HTTPS oder auf <b>localhost</b>. Im WLAN per <code>http://192.168.x.x</code> blockieren die meisten Handys den Standortzugriff.</div>` : ''}
        <div class="geo-grid">
          <div class="geo-place">
            <div class="geo-place-head">${icon('home')} Zuhause</div>
            <div class="small">${home ? esc(home.address || 'Standort gespeichert') : 'Noch kein Standort gespeichert.'}</div>
            <button class="btn sm" type="button" data-action="set-home-location" ${disabled ? 'disabled' : ''}>
              ${icon('pin')} ${home ? 'Neu einmessen' : 'Standort einmessen'}
            </button>
          </div>
          <div class="geo-place">
            <div class="geo-place-head">${icon('box')} Baustellen</div>
            <div class="small">${targets.length} ${targets.length === 1 ? 'Auftrag' : 'Aufträge'} mit Standort${geo.missing_locations ? ` · ${geo.missing_locations} ohne Standort` : ''}</div>
            <div class="small muted">Standort im Auftrag über „Standort“ aufnehmen, während du vor Ort bist.</div>
          </div>
        </div>
        <div class="geo-privacy small muted">
          ${icon('alert')} Die App prüft den Standort nur, solange sie geöffnet ist – nicht im Hintergrund oder bei gesperrtem Bildschirm.
          Es wird kein dauerhafter Standortverlauf gespeichert, nur der automatische Start/Stopp.
        </div>
        ${events.length ? `
          <details class="geo-events">
            <summary>Letzte GPS-Ereignisse</summary>
            <div class="geo-event-list">
              ${events.map((event) => `
                <div class="geo-event">
                  <span class="muted">${fmtDateTime(event.created_at)}</span>
                  <span>${esc(event.kind_label || event.kind)}</span>
                  <span class="muted">${esc(event.order_number || '')}</span>
                </div>`).join('')}
            </div>
          </details>` : ''}
      </div>
    </div>`;
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

async function newReportModal(orderId = null, { dictate = false, initialContent = '' } = {}) {
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
        default: initialContent,
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
  const year = new Date().getFullYear();
  const accounts = can('hr.manage')
    ? await api.get(`/api/hr/accounts?year=${year}`).catch(() => null)
    : null;
  const myAccount = !accounts && can('time.own')
    ? await api.get(`/api/hr/my-account?year=${year}`).catch(() => null)
    : null;
  const absenceData = await api.get(`/api/absences?year=${year}`).catch(() => ({ absences: [] }));
  const absences = absenceData.absences || [];
  const openAbsences = absences.filter((row) => row.status === 'beantragt');

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

    <div class="card" style="margin-top:18px">
      <div class="card-head">
        <div><h2>Urlaub & Arbeitszeit ${year}</h2><div class="sub">Resturlaub, Überstunden und offene Anträge</div></div>
        ${can('time.own') ? `<button class="btn sm" type="button" data-action="request-absence">${icon('plus')} Urlaub beantragen</button>` : ''}
      </div>
      <div class="card-body">
        ${accounts ? `
          <div class="table-wrap"><table>
            <thead><tr><th>Mitarbeiter</th><th class="right">Anspruch</th><th class="right">Genehmigt</th><th class="right">Offen</th><th class="right">Rest</th><th class="right">Überstunden</th><th class="right"></th></tr></thead>
            <tbody>${accounts.employees.map((employee) => `
              <tr>
                <td><b>${esc(employee.name)}</b><div class="cell-sub">${esc(employee.role || '')} · ${Number(employee.weekly_hours || 40)} Std./Woche</div></td>
                <td class="right num">${num2(employee.vacation.entitled)}</td>
                <td class="right num">${num2(employee.vacation.approved)}</td>
                <td class="right num">${num2(employee.vacation.pending)}</td>
                <td class="right num"><b>${num2(employee.vacation.remaining)}</b></td>
                <td class="right"><span class="badge ${employee.overtime_hours >= 0 ? 'bezahlt' : 'overdue'}">${employee.overtime_hours >= 0 ? '+' : ''}${num2(employee.overtime_hours)} Std.</span></td>
                <td class="right nowrap">
                  <button class="icon-btn" type="button" data-action="hr-account" data-id="${employee.id}" title="Arbeitszeitkonto">${icon('clock')}</button>
                  <button class="icon-btn" type="button" data-action="request-absence" data-id="${employee.id}" title="Urlaub eintragen">${icon('plus')}</button>
                  <button class="icon-btn" type="button" data-action="time-adjustment" data-id="${employee.id}" title="Korrektur buchen">${icon('edit')}</button>
                  <button class="icon-btn" type="button" data-action="vacation-entitlement" data-id="${employee.id}" title="Urlaubsanspruch">${icon('check')}</button>
                </td>
              </tr>`).join('')}</tbody>
          </table></div>`
        : myAccount ? `
          <div class="kpi-grid tight">
            <div class="kpi"><div class="label">Resturlaub</div><div class="value">${num2(myAccount.vacation.remaining)}</div><div class="foot">von ${num2(myAccount.vacation.entitled)} Tagen</div></div>
            <div class="kpi"><div class="label">Offene Anträge</div><div class="value">${num2(myAccount.vacation.pending)}</div><div class="foot">Tage beantragt</div></div>
            <div class="kpi"><div class="label">Arbeitszeitkonto</div><div class="value">${myAccount.overtime.balance_hours >= 0 ? '+' : ''}${num2(myAccount.overtime.balance_hours)}</div><div class="foot">Stunden</div></div>
          </div>`
        : '<div class="small muted">Keine Konten sichtbar.</div>'}
        ${openAbsences.length ? `
          <div class="hr"></div>
          <div class="section-head compact"><div><h3>Offene Anträge</h3></div></div>
          <div class="list-stack">${openAbsences.map((row) => `
            <div class="list-row static">
              <span class="list-ico">${icon('calendar')}</span>
              <span class="list-main"><b>${esc(row.employee_name)} · ${esc(row.type_label)}</b>
                <small>${fmtDate(row.start_date)} – ${fmtDate(row.end_date)} · ${num2(row.days)} Tage${row.note ? ` · ${esc(row.note)}` : ''}</small></span>
              <span class="lr-actions">
                ${can('hr.manage') ? `
                  <button class="btn sm" type="button" data-action="decide-absence" data-id="${row.id}" data-status="genehmigt">Genehmigen</button>
                  <button class="btn sm danger" type="button" data-action="decide-absence" data-id="${row.id}" data-status="abgelehnt">Ablehnen</button>` : `<span class="badge ${esc(row.status)}">${esc(row.status_label)}</span>`}
              </span>
            </div>`).join('')}</div>` : ''}
        ${absences.length ? `
          <div class="hr"></div>
          <div class="section-head compact"><div><h3>Abwesenheiten ${year}</h3></div></div>
          <div class="list-stack">${absences.slice(0, 12).map((row) => `
            <div class="list-row static">
              <span class="list-ico">${icon('calendar')}</span>
              <span class="list-main"><b>${esc(row.employee_name)} · ${esc(row.type_label)}</b>
                <small>${fmtDate(row.start_date)} – ${fmtDate(row.end_date)} · ${num2(row.days)} Tage</small></span>
              <span class="badge ${row.status === 'genehmigt' ? 'bezahlt' : row.status === 'abgelehnt' ? 'storniert' : 'offen'}">${esc(row.status_label)}</span>
            </div>`).join('')}</div>` : ''}
      </div>
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
      { name: 'weekly_hours', label: 'Wochenstunden', type: 'number', step: '0.5', min: 0, default: employee?.weekly_hours ?? 40 },
      { name: 'vacation_days', label: 'Urlaubsanspruch (Tage/Jahr)', type: 'number', step: '0.5', min: 0, default: employee?.vacation_days ?? 30 },
      { name: 'entry_date', label: 'Eintrittsdatum', type: 'date', default: employee?.entry_date || '' },
      { name: 'exit_date', label: 'Austrittsdatum', type: 'date', default: employee?.exit_date || '' },
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
  if (!textarea) return;
  // Erneutes Tippen auf das Mikrofon beendet das laufende Diktat.
  if (state.dictation && state.dictation.textarea === textarea) {
    state.dictation.stop();
    return;
  }
  if (state.dictation) state.dictation.stop();

  const recognition = startVoiceRecognition('report', { continuous: true });
  if (!recognition) {
    if (statusEl) statusEl.textContent = 'Spracherkennung nicht verfügbar – bitte Text eingeben.';
    return;
  }
  // Eigene Sprachausgabe stoppen, damit sie nicht ins Diktat gerät.
  try { window.speechSynthesis?.cancel(); } catch { /* stumm */ }

  const appendSpoken = (value) => {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const current = textarea.value;
    const separator = !current ? '' : (/\s$/.test(current) ? '' : ' ');
    textarea.value = `${current}${separator}${clean}`;
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const scope = textarea.closest('.modal') || document;
  const buttons = [...scope.querySelectorAll('[data-dictate], [data-action="report-dictate"]')];
  buttons.forEach((button) => button.classList.add('listening'));

  let sessionFinal = '';
  let committedInSession = 0;
  let recognized = false;
  let stopped = false;
  let restartTimer = null;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    state.dictation = null;
    buttons.forEach((button) => button.classList.remove('listening'));
    if (statusEl) {
      statusEl.textContent = recognized
        ? `Diktat beendet – ${label} übernommen. Nicht vergessen zu speichern.`
        : 'Diktat beendet. Es wurde nichts erkannt.';
    }
  };

  const session = {
    textarea,
    stop() {
      stopped = true;
      clearTimeout(restartTimer);
      try { recognition.stop(); } catch { /* war bereits beendet */ }
    },
  };
  state.dictation = session;

  if (statusEl) statusEl.textContent = `Ich höre … ${label} sprechen. Tippe erneut auf das Mikrofon, um zu beenden.`;
  recognition.onstart = () => {
    // Bei einem automatischen Neustart beginnt der Browser mit leeren Results.
    sessionFinal = '';
    committedInSession = 0;
  };
  recognition.onresult = (event) => {
    let interim = '';
    let complete = '';
    for (let i = 0; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) complete += `${transcript} `;
      else interim += transcript;
    }
    sessionFinal = complete;
    // Nur neu erkannte, endgültige Teile anhängen. Der vorhandene Bericht
    // bleibt immer erhalten – auch wenn zwischendurch ein Gespräch läuft.
    const pending = sessionFinal.slice(committedInSession).trim();
    if (pending) {
      appendSpoken(pending);
      committedInSession = sessionFinal.length;
      recognized = true;
    }
    if (statusEl) {
      statusEl.textContent = interim
        ? `Ich höre … ${interim}`
        : 'Diktat läuft … tippe erneut auf das Mikrofon, um zu beenden.';
    }
  };
  recognition.onerror = (event) => {
    if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
      stopped = true;
      clearTimeout(restartTimer);
      state.dictation = null;
      buttons.forEach((button) => button.classList.remove('listening'));
      if (statusEl) {
        statusEl.textContent = event.error === 'not-allowed'
          ? 'Mikrofonzugriff wurde verweigert. Bitte in den Browser-Einstellungen erlauben.'
          : 'Mikrofon nicht verfügbar. Bitte Text eingeben oder HTTPS verwenden.';
      }
      return;
    }
    if (statusEl && event.error !== 'no-speech' && event.error !== 'aborted') {
      statusEl.textContent = 'Spracherkennung unterbrochen – ich höre weiter zu …';
    }
  };
  recognition.onend = () => {
    if (stopped) {
      finish();
      return;
    }
    if (!textarea.isConnected) {
      state.dictation = null;
      buttons.forEach((button) => button.classList.remove('listening'));
      return;
    }
    // Browser beenden Diktate nach Sprechpausen selbst. Automatisch weiterhören,
    // damit ein Gespräch zwischendurch den Bericht nicht abschneidet.
    restartTimer = setTimeout(() => {
      if (stopped || !textarea.isConnected) return;
      try {
        recognition.start();
      } catch {
        restartTimer = setTimeout(() => {
          if (stopped || !textarea.isConnected) return;
          try { recognition.start(); } catch { finish(); }
        }, 700);
      }
    }, 250);
  };
  try {
    recognition.start();
  } catch {
    state.dictation = null;
    buttons.forEach((button) => button.classList.remove('listening'));
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

function startVoiceRecognition(mode = 'command', { continuous = false } = {}) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    toast('Spracherkennung wird von diesem Browser nicht unterstützt. Bitte Text eingeben.', 'error');
    return null;
  }
  const recognition = new Recognition();
  recognition.lang = 'de-DE';
  recognition.interimResults = true;
  recognition.continuous = continuous;
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
    const content = $('#report-content') || $('#modal-form textarea[name="content"]');
    if (content) {
      const current = content.value.replace(/\s+$/, '');
      content.value = `${current ? `${current} ` : ''}${text}`;
      content.dispatchEvent(new Event('change', { bubbles: true }));
      speak('Bericht übernommen.');
      return;
    }
    closeModal();
    newReportModal(null, { dictate: true, initialContent: text });
    speak('Bericht übernommen. Du kannst weiter diktieren.');
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
function materialSourceField(field, settings) {
  const value = settings[field.key] ?? '';
  const hint = field.hint ? `<span class="hint">${esc(field.hint)}</span>` : '';
  const full = field.full ? ' full' : '';
  if (field.type === 'checkbox') {
    return `<div class="field${full}">
      <label class="check"><input type="checkbox" name="${field.key}" ${value === '1' ? 'checked' : ''} /> ${esc(field.checkLabel || field.label)}</label>
      ${hint}
    </div>`;
  }
  let control;
  if (field.type === 'select') {
    control = `<select name="${field.key}">
      ${(field.options || []).map((option) => `<option value="${esc(option.value)}" ${String(option.value) === String(value) ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}
    </select>`;
  } else {
    const type = field.type === 'password' ? 'password' : 'text';
    control = `<input type="${type}" name="${field.key}" value="${esc(value)}"
      placeholder="${esc(field.placeholder || '')}" ${type === 'password' ? 'autocomplete="new-password"' : ''} />`;
  }
  return `<div class="field${full}"><label>${esc(field.label)}</label>${control}${hint}</div>`;
}

function materialSettingsCard(settings, sources) {
  const toggle = (name, title, sub) => `
    <div class="toggle-row">
      <div class="tr-main"><div class="tr-title">${title}</div><div class="tr-sub">${sub}</div></div>
      <label class="switch"><input type="checkbox" name="${name}" ${settings[name] === '1' ? 'checked' : ''} /><span></span></label>
    </div>`;
  const kindLabel = (kind) => (kind === 'import' ? 'Datei-Import' : kind === 'lookup' ? 'Abfrage' : 'Händler-API');
  const cards = (sources || []).map((source) => {
    const enabled = settings[source.enabledKey] === '1';
    const fields = source.fields || [];
    const basic = fields.filter((field) => !field.advanced);
    const advanced = fields.filter((field) => field.advanced);
    return `<div class="source-card ${enabled ? 'on' : ''}">
      <div class="source-head">
        <div class="source-main">
          <div class="source-title">
            <b>${esc(source.label)}</b>
            <span class="badge neutral">${kindLabel(source.kind)}</span>
            ${source.configured ? '' : '<span class="badge overdue">Zugang fehlt</span>'}
          </div>
          <div class="small muted">${esc(source.description)}</div>
        </div>
        <label class="switch"><input type="checkbox" name="${source.enabledKey}" ${enabled ? 'checked' : ''} data-source-toggle /><span></span></label>
      </div>
      ${basic.length ? `<div class="form-grid source-fields">${basic.map((field) => materialSourceField(field, settings)).join('')}</div>` : ''}
      ${advanced.length ? `<details class="source-advanced"><summary>Erweitert & Feldzuordnung</summary><div class="form-grid">${advanced.map((field) => materialSourceField(field, settings)).join('')}</div></details>` : ''}
      <div class="source-actions">
        ${source.test ? `<button type="button" class="btn sm" data-action="test-source" data-id="${source.id}">${icon('refresh')} Verbindung testen</button>` : ''}
        ${source.kind === 'import' ? `<button type="button" class="btn sm" data-action="open-import" data-source="${source.id}">${icon('download')} Import starten</button>` : ''}
        ${source.docs ? `<a class="btn sm ghost" href="${esc(source.docs)}" target="_blank" rel="noopener noreferrer">Doku</a>` : ''}
        <span class="small muted" data-source-test-result="${source.id}"></span>
      </div>
    </div>`;
  }).join('');

  return `<div class="card form-card full" id="material-sources-card">
    <h2>Material & Datenquellen</h2>
    <div class="fc-sub">Alle Quellen sind optional. Schalte nur ein, was der Betrieb wirklich nutzt – ausgeschaltete Quellen werden weder abgefragt noch importiert. Zugangsdaten bleiben lokal und werden nur an berechtigte Rollen ausgeliefert.</div>
    <div class="form-grid">
      <div class="field">
        <label>Aufschlag auf Einkaufspreis (%)</label>
        <input type="number" step="0.1" min="0" name="mat_markup_default" value="${esc(settings.mat_markup_default)}" />
        <span class="hint">Wird beim Import verwendet, wenn kein Verkaufspreis in der Datei steht.</span>
      </div>
    </div>
    ${toggle('mat_import_update_prices', 'Einkaufspreise aktualisieren', 'Neue Preise aus Importen übernehmen. Aus = vorhandene EK-Preise bleiben.')}
    ${toggle('mat_import_keep_sale_price', 'Verkaufspreise behalten', 'Bereits gepflegte VK-Preise nicht überschreiben.')}
    ${toggle('mat_import_update_stock', 'Bestände aus Importen übernehmen', 'Nur einschalten, wenn die Datei verlässliche Lagerbestände enthält.')}
    ${toggle('mat_allow_http', 'HTTP für lokale Tests erlauben', 'Standardmäßig sind nur HTTPS-Adressen erlaubt. Nur für Testserver im eigenen Netz aktivieren.')}
    <div class="hr"></div>
    <div class="source-list">${cards || '<div class="empty">Keine Datenquellen verfügbar.</div>'}</div>
    <div class="small muted" style="margin-top:10px">Einstellungen zuerst speichern – Verbindungstest und Import nutzen die gespeicherten Werte. Lizenz- und Vertragsbedingungen der jeweiligen Quelle beachten (z. B. Icecat, ETIM, Händler-API).</div>
  </div>`;
}

async function renderSettings() {
  const { settings, security = {} } = await api.get('/api/settings');
  const materialData = can('settings.manage')
    ? await api.get('/api/materials/sources').catch(() => ({ sources: [] }))
    : { sources: [] };
  const webhookData = can('settings.manage')
    ? await api.get('/api/webhooks').catch(() => ({ webhooks: [] }))
    : { webhooks: [] };
  const checklistData = await api.get('/api/checklist-templates').catch(() => []);
  const demoAccounts = security.demo_accounts || [];
  const insecureNetwork = security.https === false
    && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

  const input = (name, label, opts = {}) => `
    <div class="field ${opts.full ? 'full' : ''}">
      <label>${label}</label>
      <input name="${name}" type="${opts.type || 'text'}" value="${esc(settings[name])}"
        ${opts.step ? `step="${opts.step}"` : ''} ${opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : ''} />
      ${opts.hint ? `<span class="hint">${esc(opts.hint)}</span>` : ''}
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

        <div class="card form-card">
          <h2>E-Mail-Versand</h2>
          <div class="fc-sub">Für Terminbestätigungen und Rückmeldungen. Die Zugangsdaten bleiben lokal in der Datenbank.</div>
          <div class="form-grid">
            ${input('smtp_host', 'SMTP-Server', { full: true, placeholder: 'z. B. smtp.ionos.de' })}
            ${input('smtp_port', 'Port', { type: 'number', step: '1', hint: '587 mit STARTTLS, 465 mit SSL/TLS' })}
            <div class="field">
              <label>Verschlüsselung</label>
              <label class="check"><input type="checkbox" name="smtp_secure" ${settings.smtp_secure === '1' ? 'checked' : ''} /> SSL/TLS direkt (Port 465)</label>
              <span class="hint">Ohne Häkchen wird STARTTLS genutzt, wenn der Server es anbietet.</span>
            </div>
            ${input('smtp_user', 'Benutzername')}
            <div class="field">
              <label>Passwort</label>
              <input type="password" name="smtp_password" value="${esc(settings.smtp_password)}" autocomplete="new-password" />
              <span class="hint">Leer bzw. unverändert lassen, um das gespeicherte Passwort zu behalten.</span>
            </div>
            ${input('smtp_from', 'Absenderadresse', { placeholder: 'z. B. info@firma.de' })}
            ${input('smtp_from_name', 'Absendername', { placeholder: 'z. B. Möller Gas & Wasser GmbH' })}
            ${input('public_url', 'Öffentliche Adresse der App', { full: true, placeholder: 'https://app.firma.de', hint: 'Basis für Links in E-Mails. Leer lassen, um die aktuelle Adresse zu verwenden.' })}
          </div>
          <div class="toggle-row">
            <div class="tr-main">
              <div class="tr-title">Rückmeldungen per E-Mail</div>
              <div class="tr-sub">Das Büro erhält eine Nachricht, wenn ein Kunde bestätigt oder absagt.</div>
            </div>
            <label class="switch"><input type="checkbox" name="mail_notify_replies" ${settings.mail_notify_replies === '1' ? 'checked' : ''} /><span></span></label>
          </div>
          <div class="hr"></div>
          <div class="mail-test">
            <input id="mail-test-to" type="email" value="${esc(settings.company_email)}" placeholder="Empfängeradresse" />
            <button class="btn sm" type="button" data-action="mail-test">${icon('send')} Testmail</button>
          </div>
          <div class="small muted" style="margin-top:6px">Einstellungen zuerst speichern – der Test nutzt die gespeicherten Werte.</div>
        </div>

        <div class="card form-card">
          <h2>Sicherheit</h2>
          <div class="fc-sub">Zugänge und Daten schützen.</div>
          <div class="toggle-row">
            <div class="tr-main">
              <div class="tr-title">Demo-Zugänge anzeigen</div>
              <div class="tr-sub">Blendet die Testkonten auf der Anmeldeseite aus. Die Passwörter der Demo-Konten bleiben davon unberührt und müssen zusätzlich geändert werden.</div>
            </div>
            <label class="switch"><input type="checkbox" name="demo_mode" ${settings.demo_mode === '1' ? 'checked' : ''} /><span></span></label>
          </div>
          <div class="hr"></div>
          ${insecureNetwork ? `<div class="small" style="color:#b45309;margin-bottom:8px"><b>Unverschlüsselte Verbindung:</b> Diese Seite läuft über HTTP. Passwörter und Kundendaten sind im Netzwerk lesbar – bitte HTTPS einrichten.</div>` : ''}
          ${demoAccounts.length ? `<div class="small" style="color:#b91c1c;margin-bottom:8px"><b>Startpasswörter aktiv:</b> ${demoAccounts.map((name) => esc(name)).join(', ')}. Bitte unter „Benutzer &amp; Rechte“ ändern.</div>` : ''}
          ${security.must_change ? `<div class="small muted" style="margin-bottom:8px">${security.must_change} Konto/Konten müssen sich beim nächsten Login ein neues Passwort setzen.</div>` : ''}
          <div class="small muted" style="line-height:1.6">
            <b>Vor dem Produktivbetrieb:</b><br />
            · Alle Startpasswörter unter „Benutzer &amp; Rechte“ ändern.<br />
            · App nur über HTTPS betreiben (sonst sind Passwörter im Netz lesbar).<br />
            · Regelmäßig <code>data/</code> sichern – dort liegen Datenbank und Fotos.
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

        <div class="card form-card">
          <h2>E-Rechnung</h2>
          <div class="fc-sub">XRechnung 3.0 (UBL) und ZUGFeRD 2.x (CII) – inkl. eingebettetem XML im PDF.</div>
          <div class="form-grid">
            <div class="field"><label>Standardformat</label><select name="einvoice_format">
              <option value="xrechnung" ${settings.einvoice_format === 'xrechnung' ? 'selected' : ''}>XRechnung (XML)</option>
              <option value="zugferd" ${settings.einvoice_format === 'zugferd' ? 'selected' : ''}>ZUGFeRD (PDF + XML)</option>
            </select></div>
            <div class="field"><label>Zahlungsart</label><select name="einvoice_payment_means">
              <option value="58" ${settings.einvoice_payment_means === '58' ? 'selected' : ''}>58 – SEPA-Überweisung</option>
              <option value="30" ${settings.einvoice_payment_means === '30' ? 'selected' : ''}>30 – Überweisung</option>
            </select></div>
            ${input('einvoice_seller_contact', 'Ansprechpartner (BT-41)')}
            ${input('einvoice_seller_phone', 'Telefon (BT-42)')}
            ${input('einvoice_seller_email', 'E-Mail (BT-43)', { full: true })}
            <div class="field full"><label>Hinweis / Fußtext</label><textarea name="einvoice_note" rows="2">${esc(settings.einvoice_note || '')}</textarea></div>
          </div>
          <label class="check" style="margin-top:10px"><input type="checkbox" name="small_business" ${settings.small_business === '1' ? 'checked' : ''} /> Kleinunternehmer nach § 19 UStG (steuerbefreite Rechnungen)</label>
          <div class="small muted" style="margin-top:6px">Eine formale Validierung mit dem KoSIT-Prüftool wird empfohlen. Leitweg-IDs werden je Kunde gepflegt.</div>
        </div>

        <div class="card form-card">
          <h2>Kalkulation</h2>
          <div class="fc-sub">Vorgabewerte für Angebots- und Nachkalkulation.</div>
          <div class="form-grid">
            ${input('default_calc_wage_rate', 'Kalkulatorischer Lohn (€/Std.)', { type: 'number', step: '0.01' })}
            ${input('default_calc_overhead_pct', 'Gemeinkosten (%)', { type: 'number', step: '0.1' })}
            ${input('default_calc_profit_pct', 'Gewinnaufschlag (%)', { type: 'number', step: '0.1' })}
            ${input('default_calc_discount_pct', 'Rabatt (%)', { type: 'number', step: '0.1' })}
          </div>
        </div>

        <div class="card form-card">
          <h2>Personal</h2>
          <div class="fc-sub">Standardwerte für neue Mitarbeiter und Arbeitszeitkonten.</div>
          <div class="form-grid">
            ${input('hr_weekly_hours', 'Wochenstunden', { type: 'number', step: '0.5' })}
            ${input('hr_vacation_days', 'Urlaubsanspruch (Tage)', { type: 'number', step: '0.5' })}
          </div>
          <div class="hr"></div>
          <div class="section-head compact"><div><h3>Checklistenvorlagen</h3><div class="small muted">${checklistData.length} Vorlagen</div></div>
            <button class="btn sm" type="button" data-action="new-checklist-template">${icon('plus')} Vorlage</button></div>
          <div class="list-stack">
            ${checklistData.map((template) => `<div class="list-row static">
              <span class="list-ico">${icon('check')}</span>
              <span class="list-main"><b>${esc(template.name)}</b><small>${esc(template.trade || 'Allgemein')} · ${template.items.length} Punkte</small></span>
              <button class="icon-btn" type="button" data-action="edit-checklist-template" data-id="${template.id}" title="Bearbeiten">${icon('edit')}</button>
            </div>`).join('') || '<div class="small muted">Noch keine Vorlagen.</div>'}
          </div>
        </div>

        <div class="card form-card">
          <h2>Finanzen & DATEV</h2>
          <div class="fc-sub">Kontenrahmen für den DATEV-Buchungsstapel und Gläubiger-ID für SEPA.</div>
          <div class="form-grid">
            ${input('datev_consultant', 'DATEV Beraternummer')}
            ${input('datev_client', 'DATEV Mandantennummer')}
            ${input('datev_account_revenue', 'Erlöskonto')}
            ${input('datev_account_receivable', 'Debitorenkonto')}
            ${input('datev_account_bank', 'Bankkonto')}
            ${input('sepa_creditor_id', 'SEPA-Gläubiger-ID', { hint: 'Nur für Lastschriften nötig – Überweisungen funktionieren ohne.' })}
          </div>
          <div class="small muted" style="margin-top:6px">Die Kontenzuordnung bitte mit dem Steuerberater abstimmen. Export unter „Finanzen“.</div>
        </div>

        <div class="card form-card">
          <h2>Webhooks & Schnittstellen</h2>
          <div class="fc-sub">Ereignisse als signiertes JSON an andere Systeme senden (HTTPS).</div>
          <div class="list-stack">
            ${(webhookData.webhooks || []).map((hook) => `<div class="list-row static">
              <span class="list-ico">${icon('send')}</span>
              <span class="list-main"><b>${esc(hook.url)}</b><small>${esc((hook.events || []).join(', ') || '*')} · ${hook.active ? 'aktiv' : 'inaktiv'}${hook.last_status ? ` · letzter Status ${hook.last_status}` : ''}</small></span>
              <span class="lr-actions">
                <button class="btn sm" type="button" data-action="test-webhook" data-id="${hook.id}">Test</button>
                <button class="icon-btn" type="button" data-action="delete-webhook" data-id="${hook.id}" title="Löschen">${icon('trash')}</button>
              </span>
            </div>`).join('') || '<div class="small muted">Noch keine Webhooks eingerichtet.</div>'}
          </div>
          <div style="margin-top:10px"><button class="btn sm" type="button" data-action="new-webhook">${icon('plus')} Webhook anlegen</button></div>
          <div class="hr"></div>
          <div class="small muted">Öffentliche API-Dokumentation: <a href="/api/openapi.json" target="_blank" rel="noopener">/api/openapi.json</a> (OpenAPI 3.0, Anmeldung erforderlich).</div>
        </div>

        ${materialSettingsCard(settings, materialData.sources)}
      </div>

      <div style="display:flex;justify-content:flex-end;margin-top:16px">
        <button class="btn primary" type="submit">${icon('check')} Einstellungen speichern</button>
      </div>
    </form>`;

  const form = $('#settings-form');
  $$('[data-source-toggle]', form).forEach((toggle) => {
    toggle.addEventListener('change', () => {
      toggle.closest('.source-card')?.classList.toggle('on', toggle.checked);
    });
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {};
    $$('input, textarea, select', form).forEach((input) => {
      if (!input.name || input.name === 'undefined') return;
      if (input.type === 'checkbox') payload[input.name] = input.checked ? '1' : '0';
      else payload[input.name] = input.value;
    });
    try {
      const result = await api.put('/api/settings', payload);
      state.settings = result.settings;
      await refreshMaterialSources();
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
      { name: 'home_street', label: 'Hausanschrift (Straße & Nr.)', full: true },
      { name: 'home_zip', label: 'PLZ (Zuhause)' },
      { name: 'home_city', label: 'Ort (Zuhause)' },
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
function openPasswordChange({ mandatory = false } = {}) {
  formModal({
    title: mandatory ? 'Neues Passwort festlegen' : 'Passwort ändern',
    subtitle: mandatory
      ? 'Dieses Konto verwendet noch ein Startpasswort. Bitte vergib jetzt ein eigenes Passwort.'
      : '',
    dismissible: !mandatory,
    fields: [
      { name: 'currentPassword', label: 'Aktuelles Passwort', type: 'password', required: true },
      { name: 'newPassword', label: 'Neues Passwort', type: 'password', required: true, hint: 'Mindestens 8 Zeichen' },
      { name: 'confirm', label: 'Neues Passwort wiederholen', type: 'password', required: true },
    ],
    submitLabel: mandatory ? 'Passwort speichern' : 'Passwort ändern',
    onSubmit: async (values) => {
      if (values.newPassword.length < 8) throw new Error('Das neue Passwort muss mindestens 8 Zeichen haben');
      if (values.newPassword !== values.confirm) throw new Error('Die Passwörter stimmen nicht überein');
      await api.post('/api/auth/password', values);
      if (mandatory) {
        toast('Passwort gespeichert.');
        location.reload();
        return;
      }
      closeModal();
      toast('Passwort geändert. Andere Geräte müssen sich neu anmelden.');
    },
  });
}

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
  'new-appointment': (id, el) => appointmentForm(null, el?.dataset?.date ? { date: el.dataset.date } : {}),
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
  'open-import': (id, el) => openImportModal(el?.dataset.source || ''),
  'material-settings': () => { closeModal(); location.hash = '#/settings'; },
  'run-import': () => runImport(),
  'open-import-history': () => openImportHistory(),
  'open-lookup': () => openLookupModal(),
  'run-lookup': () => runLookup(),
  'adopt-lookup': (id, el) => adoptLookup(Number(el.dataset.index)),
  'enrich-article': (id) => enrichArticle(Number(id)),
  'open-dealer': (id) => openDealerLink(Number(id)),
  'test-source': async (id, el) => {
    const target = $(`[data-source-test-result="${el.dataset.id}"]`);
    el.disabled = true;
    if (target) target.textContent = 'Teste …';
    try {
      const result = await api.post(`/api/materials/sources/${el.dataset.id}/test`, {});
      if (target) target.textContent = result.message || 'Verbindung erfolgreich.';
      toast(result.message || 'Verbindung erfolgreich.');
    } catch (error) {
      if (target) target.textContent = error.message;
      toast(error.message, 'error');
    } finally {
      el.disabled = false;
    }
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
    if (!appointment) return;
    try {
      const result = await api.post(`/api/appointments/${appointment.id}/confirm-mail`);
      toast(`Terminbestätigung an ${result.to} gesendet.`);
      await openAppointment(appointment.id);
      return;
    } catch (error) {
      if (error.code !== 'mail_not_configured') {
        toast(error.message, 'error');
        return;
      }
      // Kein SMTP eingerichtet: lokales Mailprogramm als Ausweg
      toast('Kein E-Mail-Versand eingerichtet – öffne das Mailprogramm.', 'info');
    }
    await openMailTo(appointment);
  },
  'mail-test': async () => {
    const input = $('#mail-test-to');
    const button = $('[data-action="mail-test"]');
    if (button) button.disabled = true;
    try {
      const result = await api.post('/api/mail/test', { to: input?.value.trim() || '' });
      toast(`Testmail an ${result.to} gesendet.`);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      if (button) button.disabled = false;
    }
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
  'calendar-mode': (id, el) => {
    state.calendarMode = ['month', 'board'].includes(el.dataset.mode) ? el.dataset.mode : 'week';
    if (state.calendarMode === 'month') {
      state.monthStart = startOfMonth(state.weekStart || new Date());
    }
    renderPlanning();
  },
  'calendar-prev': () => {
    if ((state.calendarMode || 'week') === 'month') {
      state.monthStart.setMonth(state.monthStart.getMonth() - 1);
    } else {
      state.weekStart.setDate(state.weekStart.getDate() - 7);
    }
    renderPlanning();
  },
  'calendar-next': () => {
    if ((state.calendarMode || 'week') === 'month') {
      state.monthStart.setMonth(state.monthStart.getMonth() + 1);
    } else {
      state.weekStart.setDate(state.weekStart.getDate() + 7);
    }
    renderPlanning();
  },
  'calendar-today': () => {
    state.weekStart = startOfWeek();
    state.monthStart = startOfMonth();
    renderPlanning();
  },
  'filter-reports': (id, el) => { state.reportsFilter = el.dataset.filter; renderReports(); },
  'toggle-time': (id) => toggleTime(id || null),
  'toggle-geo': async (id, element) => {
    const enabled = Boolean(element?.checked);
    if (enabled && !window.confirm(
      'GPS-Zeiterfassung aktivieren?\n\n'
      + 'Die App prüft deinen Standort, solange sie geöffnet ist, und startet/stoppt die Arbeitszeit automatisch an gespeicherten Standorten (Zuhause und Baustellen).\n\n'
      + 'Dabei wird bei jedem automatischen Start/Stopp die Position gespeichert. Ein dauerhafter Standortverlauf wird nicht angelegt. Du kannst die Funktion jederzeit wieder ausschalten.'
    )) {
      if (element) element.checked = false;
      return;
    }
    try {
      const status = await api.put('/api/geo/settings', {
        enabled,
        radius_m: state.geo?.radius_m || 150,
      });
      state.geo = {
        ...(state.geo || {}),
        ...status,
        loaded: true,
        supported: 'geolocation' in navigator,
        secure: window.isSecureContext,
      };
      if (status.time !== undefined) state.time = status.time;
      if (status.enabled) startGeoTracking();
      else stopGeoTracking();
      toast(status.enabled ? 'GPS-Zeiterfassung aktiviert.' : 'GPS-Zeiterfassung ausgeschaltet.');
      if (state.page === 'my' || state.page === 'time') await refresh();
      else updateGeoIndicators();
    } catch (error) {
      if (element) element.checked = !enabled;
      toast(error.message, 'error');
    }
  },
  'geo-settings': () => {
    formModal({
      title: 'GPS-Zeiterfassung einstellen',
      subtitle: 'Radius um Zuhause und Baustelle.',
      fields: [
        {
          name: 'radius_m', label: 'Radius in Metern', type: 'number', min: 75, max: 500, step: 25,
          default: state.geo?.radius_m || 150,
          hint: '75–500 m. Größer ist toleranter, kleiner genauer.',
        },
      ],
      submitLabel: 'Speichern',
      onSubmit: async (values) => {
        const status = await api.put('/api/geo/settings', {
          enabled: Boolean(state.geo?.enabled),
          radius_m: Number(values.radius_m),
        });
        state.geo = { ...(state.geo || {}), ...status, loaded: true };
        if (status.time !== undefined) state.time = status.time;
        closeModal();
        toast('Radius gespeichert.');
        if (state.page === 'my' || state.page === 'time') await refresh();
      },
    });
  },
  'set-home-location': async () => {
    try {
      toast('Standort wird ermittelt …', 'info');
      const position = await geoPositionOnce();
      const status = await api.put('/api/geo/home', position);
      state.geo = {
        ...(state.geo || {}),
        ...status,
        loaded: true,
        supported: 'geolocation' in navigator,
        secure: window.isSecureContext,
      };
      if (status.time !== undefined) state.time = status.time;
      toast(`Zuhause-Standort gespeichert (±${position.accuracy} m).`);
      if (state.page === 'my' || state.page === 'time') await refresh();
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'order-location': async (id, element) => {
    const orderId = id || Number(element?.dataset.id);
    if (!orderId) return;
    try {
      toast('Standort wird ermittelt …', 'info');
      const position = await geoPositionOnce();
      await api.put(`/api/orders/${orderId}/location`, position);
      toast(`Standort gespeichert (±${position.accuracy} m). Die GPS-Zeiterfassung erkennt den Auftrag jetzt.`);
      state.geo = null;
      await ensureGeoState(true);
      const modalOpen = Boolean($('#modal-root .modal'));
      if (modalOpen && state.currentOrderId === orderId) await openOrder(orderId);
      else if (!modalOpen && (state.page === 'my' || state.page === 'orders')) await refresh();
    } catch (error) {
      toast(error.message, 'error');
    }
  },
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
  'change-password': () => openPasswordChange(),

  /* ---------------------------------------------------------------- DMS */
  'filter-documents': (id, el) => { state.documentsFilter = el.dataset.filter; renderDocuments(); },
  'upload-document': () => uploadDocumentModal(),
  'upload-order-document': (id) => uploadDocumentModal({ order_id: id, category: 'auftrag' }),
  'open-document': (id) => openDocumentModal(id),
  'document-versions': (id) => newDocumentVersionModal(id),
  'delete-document': async (id) => {
    if (!confirm('Dokument aus der aktiven Ablage entfernen? Die Datei bleibt revisionssicher archiviert.')) return;
    try {
      await api.del(`/api/documents/${id}`);
      closeModal();
      toast('Dokument entfernt.');
      await renderDocuments();
    } catch (error) {
      toast(error.message, 'error');
    }
  },

  /* ---------------------------------------------------------------- Finanzen */
  'finance-tab': (id, el) => { state.financeTab = el.dataset.tab; renderFinance(); },
  'import-bank': () => bankImportModal(),
  'run-bank-import': async () => {
    try {
      const result = await api.post('/api/finance/bank/auto-match');
      toast(`${result.matched} Zahlungen automatisch zugeordnet.`);
      await renderFinance();
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'match-transaction': (id) => matchTransactionModal(id),
  'run-sepa': () => sepaModal(),
  'sepa-file': () => { window.location.href = '/api/finance/sepa/file'; },
  'datev-export': () => {
    const from = $('#datev-from')?.value || '';
    const to = $('#datev-to')?.value || '';
    window.location.href = `/api/finance/datev?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  },

  /* ---------------------------------------------------------------- Plantafel */
  'new-resource': () => resourceFormModal(),
  'resource-list': () => resourceListModal(),
  'new-booking': (id, el) => newBookingModal(el.dataset),
  'edit-booking': (id) => editBookingModal(id),
  'edit-resource': async (id) => {
    try {
      const resources = await api.get('/api/resources');
      resourceFormModal(resources.find((row) => row.id === Number(id)) || null);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'delete-resource': async (id) => {
    if (!confirm('Ressource löschen? Bereits geplante Buchungen bleiben erhalten.')) return;
    try {
      const result = await api.del(`/api/resources/${id}`);
      toast(result.deactivated ? 'Ressource deaktiviert (noch eingeplant).' : 'Ressource gelöscht.');
      if ($('#modal-root')?.innerHTML) await resourceListModal();
      else await renderPlanning();
    } catch (error) {
      toast(error.message, 'error');
    }
  },

  /* ---------------------------------------------------------------- Personal */
  'request-absence': (id) => requestAbsenceModal(id),
  'decide-absence': async (id, el) => {
    try {
      await api.post(`/api/absences/${id}/decide`, { status: el.dataset.status });
      toast(el.dataset.status === 'genehmigt' ? 'Antrag genehmigt.' : 'Antrag abgelehnt.');
      await renderTeam();
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'hr-account': (id) => hrAccountModal(id),
  'time-adjustment': (id) => timeAdjustmentModal(id),
  'vacation-entitlement': (id) => vacationEntitlementModal(id),

  /* ---------------------------------------------------------------- Kalkulation */
  'order-calculation': (id) => orderCalculationModal(id),
  'save-calculation': async (id) => {
    try {
      const payload = calculationPayload(id);
      if (!payload) return;
      await api.put(`/api/orders/${id}/calculation`, payload);
      toast('Kalkulation gespeichert.');
      await orderCalculationModal(id);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'apply-calculation': async (id) => {
    if (!confirm('Kalkulierte Verkaufspreise in die Auftragspositionen schreiben?')) return;
    try {
      const payload = calculationPayload(id);
      if (!payload) return;
      const result = await api.post(`/api/orders/${id}/calculation/apply`, payload);
      toast(`Preise übernommen – Marge ${num2(result.planned.margin_pct)} %.`);
      closeModal();
      await openOrder(id);
    } catch (error) {
      toast(error.message, 'error');
    }
  },

  /* ---------------------------------------------------------------- Aufmaß */
  'order-measurements': (id) => orderMeasurementsModal(id),
  'save-measurement': async (id) => {
    const form = $('#measurement-form');
    if (!form) return;
    const data = {};
    [...form.elements].forEach((input) => {
      if (!input.name) return;
      data[input.name] = input.type === 'number' ? Number(input.value || 0) : input.value;
    });
    try {
      await api.post(`/api/orders/${id}/measurements`, data);
      toast('Aufmaßposition gespeichert.');
      await orderMeasurementsModal(id);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'delete-measurement': async (id, el) => {
    try {
      await api.del(`/api/orders/${id}/measurements/${el.dataset.measurement}`);
      toast('Position gelöscht.');
      await orderMeasurementsModal(id);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'apply-measurements': async (id) => {
    if (!confirm('Alle Aufmaßpositionen als Auftragspositionen übernehmen?')) return;
    try {
      const result = await api.post(`/api/orders/${id}/measurements/apply`, {});
      toast(`${result.positions} Positionen übernommen.`);
      closeModal();
      await openOrder(id);
    } catch (error) {
      toast(error.message, 'error');
    }
  },

  /* ---------------------------------------------------------------- Checklisten */
  'order-checklists': (id) => orderChecklistsModal(id),
  'add-checklist': async (id) => {
    const templateId = $('#checklist-template')?.value;
    if (!templateId) return;
    try {
      await api.post(`/api/orders/${id}/checklists`, { template_id: Number(templateId) });
      toast('Checkliste angelegt.');
      await orderChecklistsModal(id);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'toggle-checklist-entry': async (id, el) => {
    try {
      await api.put(`/api/checklists/${el.dataset.checklist}/entries/${el.dataset.entry}`, { checked: el.checked ? 1 : 0 });
    } catch (error) {
      toast(error.message, 'error');
      el.checked = !el.checked;
    }
  },
  'delete-checklist': async (id, el) => {
    if (!confirm('Checkliste mit allen Punkten löschen?')) return;
    try {
      await api.del(`/api/checklists/${id}`);
      toast('Checkliste gelöscht.');
      await orderChecklistsModal(Number(el.dataset.order));
    } catch (error) {
      toast(error.message, 'error');
    }
  },

  /* ---------------------------------------------------------------- Bautagebuch */
  'order-diary': (id) => orderDiaryModal(id),
  'save-diary': async (id) => {
    const form = $('#diary-form');
    if (!form) return;
    const data = {};
    [...form.elements].forEach((input) => { if (input.name) data[input.name] = input.value; });
    try {
      await api.post(`/api/orders/${id}/diary`, data);
      toast('Eintrag gespeichert.');
      await orderDiaryModal(id);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'delete-diary': async (id, el) => {
    try {
      await api.del(`/api/orders/${id}/diary/${el.dataset.entry}`);
      toast('Eintrag gelöscht.');
      await orderDiaryModal(id);
    } catch (error) {
      toast(error.message, 'error');
    }
  },

  /* ---------------------------------------------------------------- Unterschrift */
  'order-signature': (id) => orderSignatureModal(id),
  'clear-signature': () => signaturePadState?.clear(),
  'save-signature': async (id) => {
    const form = $('#signature-form');
    if (!form || !signaturePadState) return;
    const customerName = form.elements.customer_name.value.trim();
    if (!customerName) return toast('Bitte den Namen des Unterzeichners angeben.', 'error');
    if (!signaturePadState.hasInk()) return toast('Bitte zuerst unterschreiben.', 'error');
    try {
      await api.post(`/api/orders/${id}/signatures`, {
        customer_name: customerName,
        note: form.elements.note.value.trim(),
        dataUrl: signaturePadState.canvas.toDataURL('image/png'),
      });
      toast('Unterschrift gespeichert.');
      closeModal();
      await openOrder(id);
    } catch (error) {
      toast(error.message, 'error');
    }
  },

  /* ---------------------------------------------------------------- Projektakte & GAEB */
  'order-documents': async (id) => {
    try {
      const data = await api.get(`/api/orders/${id}`);
      await orderDocumentsModal(id, data.order.number);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'order-gaeb': (id) => orderGaebModal(id),
  'download-gaeb': (id) => { window.location.href = `/api/orders/${id}/gaeb`; },
  assistant: (id, el) => assistantModal({
    kind: el.dataset.kind || 'angebot',
    orderId: el.dataset.invoice ? null : id,
    invoiceId: el.dataset.invoice ? Number(el.dataset.invoice) : null,
    customerId: el.dataset.customer ? Number(el.dataset.customer) : null,
  }),
  'run-assistant': () => runAssistant(),
  'copy-assistant': async () => {
    const field = $('#assistant-result');
    if (!field?.value) return toast('Noch kein Entwurf vorhanden.', 'error');
    try {
      await navigator.clipboard.writeText(field.value);
      toast('Entwurf kopiert.');
    } catch {
      field.select();
      document.execCommand('copy');
      toast('Entwurf kopiert.');
    }
  },

  /* ---------------------------------------------------------------- Inventur & Scan */
  'open-inventory': (id) => inventorySessionModal(id),
  'new-inventory': () => newInventoryModal(),
  'save-inventory-count': async (id) => {
    const form = $('#count-form');
    if (!form) return;
    try {
      await api.post(`/api/inventory/${id}/count`, {
        article_id: Number(form.elements.article_id.value),
        counted: Number(form.elements.counted.value),
        note: form.elements.note.value,
      });
      toast('Zählung gespeichert.');
      await inventorySessionModal(id);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'close-inventory': async (id) => {
    if (!confirm('Inventur abschließen? Abweichungen werden in den Bestand gebucht.')) return;
    try {
      await api.post(`/api/inventory/${id}/close`);
      toast('Inventur abgeschlossen.');
      closeModal();
      await renderWarehouse();
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'scan-article': () => scanArticleModal(),

  /* ---------------------------------------------------------------- Vorlagen & Webhooks */
  'new-checklist-template': () => checklistTemplateModal(),
  'edit-checklist-template': async (id) => {
    try {
      const templates = await api.get('/api/checklist-templates');
      checklistTemplateModal(templates.find((row) => row.id === Number(id)) || null);
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'new-webhook': () => webhookModal(),
  'test-webhook': async (id) => {
    try {
      const delivery = await api.post(`/api/webhooks/${id}/test`);
      toast(delivery?.error ? `Test fehlgeschlagen: ${delivery.error}` : `Test zugestellt (HTTP ${delivery?.status ?? '?'}).`,
        delivery?.error ? 'error' : 'success');
      await renderSettings();
    } catch (error) {
      toast(error.message, 'error');
    }
  },
  'delete-webhook': async (id) => {
    if (!confirm('Webhook löschen?')) return;
    try {
      await api.del(`/api/webhooks/${id}`);
      toast('Webhook gelöscht.');
      await renderSettings();
    } catch (error) {
      toast(error.message, 'error');
    }
  },

  /* ---------------------------------------------------------------- E-Rechnung */
  'invoice-einvoice': (id, el) => {
    const format = el.dataset.format === 'zugferd' ? 'zugferd' : 'xrechnung';
    const pdf = format === 'zugferd' ? '&pdf=1' : '';
    window.open(`/api/invoices/${id}/einvoice?format=${format}${pdf}`, '_blank', 'noopener');
  },
  'edit-einvoice': async (id) => {
    try {
      const data = await api.get(`/api/invoices/${id}`);
      einvoiceReferenceModal(id, data.invoice.buyer_reference || data.customer?.leitweg_id || '');
    } catch (error) {
      toast(error.message, 'error');
    }
  },

  logout: async () => {
    try { await api.post('/api/auth/logout'); } catch { /* stumm */ }
    stopGeoTracking();
    state.geo = null;
    state.user = null;
    state.time = null;
    showLogin();
  },
};

document.addEventListener('click', (event) => {
  const element = event.target.closest('[data-action]');
  if (!element) return;
  // Checkboxen und Dateifelder reagieren auf change, nicht auf click.
  if (element.tagName === 'INPUT') return;
  if (element.tagName === 'A' && element.getAttribute('href')?.startsWith('#')) return;
  const action = ACTIONS[element.dataset.action];
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  const id = element.dataset.id ? Number(element.dataset.id) : null;
  action(id, element, event);
});

document.addEventListener('change', (event) => {
  const element = event.target.closest('input[data-action]');
  if (!element) return;
  const action = ACTIONS[element.dataset.action];
  if (!action) return;
  event.stopPropagation();
  action(element.dataset.id ? Number(element.dataset.id) : null, element, event);
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
    if (['orders', 'invoices', 'customers', 'warehouse', 'contracts', 'planning', 'documents'].includes(state.page)) {
      PAGES[state.page].render();
    }
  }, 220);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const overlay = $('.modal-overlay');
  if (overlay && overlay.dataset.dismissible === 'false') return;
  closeModal();
});

window.addEventListener('hashchange', navigate);

/* ============================================================================
 * HERO-Parität im Frontend: DMS, Finanzen, Plantafel, Personal, Kalkulation,
 * Aufmaß, Checklisten, Bautagebuch, Unterschrift, Inventur und Schnittstellen.
 * ========================================================================== */

const DOCUMENT_CATEGORIES_UI = {
  rechnung: 'Rechnung', angebot: 'Angebot', auftrag: 'Auftrag', aufmass: 'Aufmaß',
  foto: 'Foto', protokoll: 'Protokoll', vertrag: 'Vertrag', lieferschein: 'Lieferschein',
  eingangsrechnung: 'Eingangsrechnung', steuer: 'Steuer / Buchhaltung', sonstiges: 'Sonstiges',
};

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
  reader.readAsDataURL(file);
});

const readTextFile = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
  reader.readAsText(file, 'utf-8');
});

const documentSize = (bytes) => {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
};

const categoryOptions = (selected = 'sonstiges') => Object.entries(DOCUMENT_CATEGORIES_UI)
  .map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`)
  .join('');

/* ------------------------------------------------------------------ DMS */

async function renderDocuments() {
  const documents = await api.get('/api/documents');
  const filter = state.documentsFilter || 'alle';
  const term = state.search.toLowerCase();
  const visible = documents.filter((doc) => {
    if (filter !== 'alle' && doc.category !== filter) return false;
    if (!term) return true;
    return `${doc.title} ${doc.original_name || ''} ${doc.note || ''} ${doc.company || ''} ${doc.last_name || ''} ${doc.order_number || ''} ${doc.invoice_number || ''}`
      .toLowerCase().includes(term);
  });
  const used = Object.keys(DOCUMENT_CATEGORIES_UI).filter((key) => documents.some((doc) => doc.category === key));

  view.innerHTML = `
    <div class="toolbar">
      <div class="chips">
        <button class="chip ${filter === 'alle' ? 'active' : ''}" data-action="filter-documents" data-filter="alle">Alle <b>${documents.length}</b></button>
        ${used.map((key) => `<button class="chip ${filter === key ? 'active' : ''}" data-action="filter-documents" data-filter="${key}">${esc(DOCUMENT_CATEGORIES_UI[key])}</button>`).join('')}
      </div>
    </div>
    ${visible.length ? `
      <div class="card">
        <div class="card-head"><div><h2>Ablage</h2><div class="sub">Revisionssichere Ablage – Versionen und Änderungen werden protokolliert</div></div></div>
        <div class="list-stack padded">
          ${visible.map((doc) => `
            <div class="list-row static">
              <span class="list-ico">${icon('file')}</span>
              <span class="list-main">
                <b>${esc(doc.title)}</b>
                <small>${esc(DOCUMENT_CATEGORIES_UI[doc.category] || doc.category)} · ${documentSize(doc.size)} · ${fmtDate(doc.created_at)}${doc.version > 1 ? ` · Version ${doc.version}` : ''}</small>
                <small class="muted">${doc.order_number ? `Auftrag ${esc(doc.order_number)}` : ''}${doc.invoice_number ? ` · Rechnung ${esc(doc.invoice_number)}` : ''}${doc.company || doc.last_name ? ` · ${esc(doc.company || customerName(doc))}` : ''}</small>
              </span>
              <span class="lr-actions">
                <button class="btn sm" type="button" data-action="open-document" data-id="${doc.id}">Details</button>
                <a class="icon-btn" href="/api/documents/${doc.id}/file" target="_blank" rel="noopener" title="Herunterladen">${icon('download')}</a>
              </span>
            </div>`).join('')}
        </div>
      </div>`
    : `<div class="empty-state"><div class="empty-ico">${icon('file')}</div><h3>Noch keine Dokumente</h3><p>Rechnungen werden automatisch archiviert. Weitere Belege können jederzeit abgelegt werden.</p></div>`}`;
}

function uploadDocumentModal(relation = {}) {
  openModal({
    title: 'Dokument ablegen',
    subtitle: 'PDF, Bild, Office-Datei oder XML – maximal 25 MB',
    body: `
      <form id="document-form" class="form-grid">
        ${relation.order_id ? `<input type="hidden" name="order_id" value="${relation.order_id}" />` : ''}
        ${relation.customer_id ? `<input type="hidden" name="customer_id" value="${relation.customer_id}" />` : ''}
        ${relation.invoice_id ? `<input type="hidden" name="invoice_id" value="${relation.invoice_id}" />` : ''}
        <div class="field full"><label>Datei *</label><input type="file" name="file" required
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.xml,.csv,.txt,.eml,.docx,.xlsx,.odt,.ods,.zip" /></div>
        <div class="field"><label>Bezeichnung</label><input name="title" placeholder="z. B. Wartungsprotokoll" /></div>
        <div class="field"><label>Kategorie</label><select name="category">${categoryOptions(relation.category || 'sonstiges')}</select></div>
        <div class="field full"><label>Notiz</label><textarea name="note" rows="2" placeholder="Optionaler Hinweis zur Ablage"></textarea></div>
      </form>`,
    footer: `
      <button class="btn" type="button" data-action="close-modal">Abbrechen</button>
      <button class="btn primary" type="submit" form="document-form">Ablegen</button>`,
  });
  $('#document-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const file = form.elements.file.files[0];
    if (!file) return toast('Bitte eine Datei auswählen', 'error');
    const button = $('button[type="submit"][form="document-form"]');
    button.disabled = true;
    button.textContent = 'Lädt hoch…';
    try {
      const dataUrl = await fileToDataUrl(file);
      await api.post('/api/documents', {
        dataUrl,
        filename: file.name,
        title: form.elements.title.value.trim() || file.name,
        category: form.elements.category.value,
        note: form.elements.note.value.trim(),
        order_id: relation.order_id || null,
        customer_id: relation.customer_id || null,
        invoice_id: relation.invoice_id || null,
      });
      closeModal();
      toast('Dokument archiviert.');
      if (relation.order_id) await openOrder(Number(relation.order_id));
      else await renderDocuments();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
      button.textContent = 'Ablegen';
    }
  });
}

async function openDocumentModal(id) {
  const data = await api.get(`/api/documents/${id}`);
  const { document: doc, versions = [], events = [] } = data;
  openModal({
    title: doc.title,
    subtitle: `${DOCUMENT_CATEGORIES_UI[doc.category] || doc.category} · ${documentSize(doc.size)} · ${fmtDateTime(doc.created_at)}`,
    size: 'wide',
    body: `
      <div class="meta-grid">
        <div class="meta-item"><div class="k">Datei</div><div class="v">${esc(doc.original_name || doc.filename)}<small>${esc(doc.mime || '')}</small></div></div>
        <div class="meta-item"><div class="k">Version</div><div class="v">${doc.version}</div></div>
        <div class="meta-item"><div class="k">Prüfsumme</div><div class="v small mono">${esc(String(doc.sha256 || '').slice(0, 16))}…</div></div>
        <div class="meta-item"><div class="k">Ablage</div><div class="v">${fmtDate(doc.created_at)}<small>${esc(doc.user_name || '')}</small></div></div>
      </div>
      ${doc.note ? `<p class="small muted">${esc(doc.note)}</p>` : ''}
      <div class="section-head compact"><div><h4>Versionen</h4></div>
        ${can('documents.manage') && !doc.deleted_at ? `<button class="btn sm" type="button" data-action="document-versions" data-id="${doc.id}">${icon('plus')} Neue Version</button>` : ''}</div>
      <div class="list-stack">
        ${versions.map((row) => `
          <div class="list-row static">
            <span class="list-ico">${icon('file')}</span>
            <span class="list-main"><b>Version ${row.version}</b><small>${fmtDateTime(row.created_at)} · ${documentSize(row.size)} · ${esc(row.user_name || '')}</small></span>
            <a class="icon-btn" href="/api/documents/${row.id}/file" target="_blank" rel="noopener" title="Herunterladen">${icon('download')}</a>
          </div>`).join('')}
      </div>
      <div class="hr"></div>
      <div class="section-head compact"><div><h4>Verlauf</h4><div class="small muted">GoBD-Protokoll</div></div></div>
      <div class="list-stack">
        ${events.map((row) => `<div class="list-row static">
          <span class="list-ico">${icon('clock')}</span>
          <span class="list-main"><b>${esc(row.action)}</b><small>${fmtDateTime(row.created_at)} · ${esc(row.user_name || 'System')}${row.detail ? ` · ${esc(row.detail)}` : ''}</small></span>
        </div>`).join('')}
      </div>`,
    footer: `
      ${can('documents.manage') && !doc.deleted_at ? `<button class="btn sm danger" type="button" data-action="delete-document" data-id="${doc.id}">Löschen</button>` : ''}
      <div class="spacer"></div>
      <button class="btn" type="button" data-action="close-modal">Schließen</button>`,
  });
}

function newDocumentVersionModal(id) {
  openModal({
    title: 'Neue Version ablegen',
    subtitle: 'Die bisherigen Versionen bleiben unverändert erhalten.',
    body: `
      <form id="version-form" class="form-grid">
        <div class="field full"><label>Datei *</label><input type="file" name="file" required /></div>
        <div class="field full"><label>Notiz</label><input name="note" placeholder="Was hat sich geändert?" /></div>
      </form>`,
    footer: `
      <button class="btn" type="button" data-action="close-modal">Abbrechen</button>
      <button class="btn primary" type="submit" form="version-form">Hochladen</button>`,
  });
  $('#version-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const file = form.elements.file.files[0];
    if (!file) return toast('Bitte eine Datei auswählen', 'error');
    try {
      await api.post(`/api/documents/${id}/versions`, {
        dataUrl: await fileToDataUrl(file),
        filename: file.name,
        note: form.elements.note.value.trim(),
      });
      closeModal();
      toast('Neue Version archiviert.');
      await openDocumentModal(id);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

/* ------------------------------------------------------------------ Finanzen */

const FINANCE_TABS = {
  bank: 'Bankabgleich',
  sepa: 'SEPA-Überweisungen',
  datev: 'DATEV-Export',
};

async function renderFinance() {
  const tab = state.financeTab || 'bank';
  const [overview, bank] = await Promise.all([
    api.get('/api/finance/overview'),
    api.get('/api/finance/bank').catch(() => []),
  ]);
  const year = new Date().getFullYear();
  const from = `${year}-01-01`;
  const to = todayISO();

  view.innerHTML = `
    <div class="kpi-grid tight">
      <div class="kpi"><div class="ico">${icon('receipt')}</div><div class="label">Offene Rechnungen</div><div class="value">${money(overview.open_invoices.amount)}</div><div class="foot">${overview.open_invoices.count} Rechnungen</div></div>
      <div class="kpi"><div class="ico">${icon('euro')}</div><div class="label">Unzugeordnete Eingänge</div><div class="value">${money(overview.bank.unmatched_amount)}</div><div class="foot">${overview.bank.unmatched} Buchungen</div></div>
      <div class="kpi"><div class="ico">${icon('check')}</div><div class="label">Verbucht</div><div class="value">${overview.bank.booked}</div><div class="foot">über Bankabgleich</div></div>
    </div>

    <div class="view-switch" style="margin:14px 0">
      ${Object.entries(FINANCE_TABS).map(([key, label]) => `<button class="chip ${tab === key ? 'active' : ''}" data-action="finance-tab" data-tab="${key}">${esc(label)}</button>`).join('')}
    </div>

    ${tab === 'bank' ? `
      <div class="card">
        <div class="card-head">
          <div><h2>Bankumsätze</h2><div class="sub">CSV oder CAMT.053 importieren, Zahlungen zuordnen und verbuchen</div></div>
          ${can('finance.manage') ? `
            <div class="nowrap">
              <button class="btn sm" type="button" data-action="import-bank">${icon('download')} Importieren</button>
              <button class="btn sm ghost" type="button" data-action="run-bank-import">${icon('refresh')} Abgleich</button>
            </div>` : ''}
        </div>
        <div class="list-stack padded">
          ${bank.length ? bank.map((row) => `
            <div class="list-row static">
              <span class="list-ico">${icon(row.amount >= 0 ? 'download' : 'send')}</span>
              <span class="list-main">
                <b>${esc(row.counterparty || row.purpose || 'Bankbuchung')}</b>
                <small>${fmtDate(row.date)} · ${esc(row.purpose || '')}</small>
                <small class="muted">${row.invoice_number ? `Rechnung ${esc(row.invoice_number)}` : 'Nicht zugeordnet'}${row.reference ? ` · ${esc(row.reference)}` : ''}</small>
              </span>
              <span class="nowrap" style="text-align:right">
                <b class="num" style="color:${row.amount >= 0 ? 'var(--ok)' : 'var(--danger)'}">${money(row.amount)}</b>
                <div><span class="badge ${row.status === 'verbucht' ? 'bezahlt' : row.status === 'zugeordnet' ? 'offen' : 'neutral'}">${esc(row.status)}</span></div>
              </span>
              <span class="lr-actions">
                ${can('finance.manage') && row.status !== 'verbucht' && row.amount > 0 ? `<button class="btn sm" type="button" data-action="match-transaction" data-id="${row.id}">Zuordnen</button>` : ''}
              </span>
            </div>`).join('')
          : '<div class="small muted">Noch keine Bankumsätze importiert.</div>'}
        </div>
      </div>` : ''}

    ${tab === 'sepa' ? `
      <div class="card">
        <div class="card-head"><div><h2>SEPA-Überweisungen</h2><div class="sub">Offene Rechnungen mit gültiger IBAN als pain.001 exportieren</div></div>
          <button class="btn sm" type="button" data-action="run-sepa">${icon('download')} XML erzeugen</button></div>
        <div class="card-body">
          <div class="small muted">Bankverbindungen werden beim Kunden gepflegt. Die eigene IBAN steht unter Einstellungen → Firma.</div>
        </div>
      </div>` : ''}

    ${tab === 'datev' ? `
      <div class="card">
        <div class="card-head"><div><h2>DATEV-Buchungsstapel</h2><div class="sub">EXTF-Format 700 für den Steuerberater</div></div>
          <button class="btn sm" type="button" data-action="datev-export">${icon('download')} Exportieren</button></div>
        <div class="card-body">
          <div class="form-grid">
            <div class="field"><label>Von</label><input type="date" id="datev-from" value="${from}" /></div>
            <div class="field"><label>Bis</label><input type="date" id="datev-to" value="${to}" /></div>
          </div>
          <div class="small muted" style="margin-top:8px">Kontenrahmen unter Einstellungen → Finanzen & DATEV. Die Zuordnung bitte mit dem Steuerberater abstimmen.</div>
        </div>
      </div>` : ''}`;
}

function bankImportModal() {
  openModal({
    title: 'Bankumsätze importieren',
    subtitle: 'CSV-Export der Bank oder CAMT.053-XML',
    body: `
      <form id="bank-form" class="form-grid">
        <div class="field full"><label>Datei *</label><input type="file" name="file" required accept=".csv,.xml,.txt" /></div>
        <div class="small muted full">Erwartet Spalten wie Buchungstag, Betrag, Verwendungszweck, Auftraggeber und IBAN. Duplikate werden automatisch übersprungen.</div>
      </form>`,
    footer: `
      <button class="btn" type="button" data-action="close-modal">Abbrechen</button>
      <button class="btn primary" type="submit" form="bank-form">Importieren</button>`,
  });
  $('#bank-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = event.target.elements.file.files[0];
    if (!file) return toast('Bitte eine Datei auswählen', 'error');
    const button = $('button[form="bank-form"]');
    button.disabled = true;
    button.textContent = 'Importiert…';
    try {
      const content = await readTextFile(file);
      const result = await api.post('/api/finance/bank/import', { content, filename: file.name });
      closeModal();
      toast(`${result.imported} Buchungen importiert, ${result.skipped} Duplikate übersprungen.`);
      await renderFinance();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
      button.textContent = 'Importieren';
    }
  });
}

async function matchTransactionModal(transactionId) {
  const [tx, invoices] = await Promise.all([
    api.get('/api/finance/bank').then((rows) => rows.find((row) => row.id === Number(transactionId))),
    api.get('/api/invoices?status=offen'),
  ]);
  if (!tx) return toast('Buchung nicht gefunden', 'error');
  formModal({
    title: 'Zahlung zuordnen',
    subtitle: `${fmtDate(tx.date)} · ${money(tx.amount)} · ${tx.counterparty || tx.purpose || ''}`,
    fields: [
      { name: 'invoice_id', label: 'Rechnung', type: 'select', required: true,
        placeholder: 'Rechnung wählen',
        options: invoices.map((invoice) => ({
          value: invoice.id,
          label: `${invoice.number} · ${invoice.company || `${invoice.first_name} ${invoice.last_name}`.trim()} · offen ${money(Number(invoice.total) - Number(invoice.paid_total))}`,
        })),
        default: tx.invoice_id || '' },
      { name: 'note', label: 'Notiz', default: 'Bankabgleich' },
    ],
    submitLabel: 'Zahlung verbuchen',
    onSubmit: async (data) => {
      await api.post(`/api/finance/bank/${transactionId}/book`, data);
      closeModal();
      toast('Zahlung verbucht.');
      await renderFinance();
    },
  });
}

async function sepaModal() {
  const preview = await api.get('/api/finance/sepa');
  const rows = preview.rows || [];
  openModal({
    title: 'SEPA-Überweisung',
    subtitle: `${preview.payable.length} Rechnungen mit gültiger IBAN · ${money(preview.payable.reduce((sum, row) => sum + row.open_amount, 0))}`,
    size: 'wide',
    body: `
      <div class="small muted">Auftraggeber-IBAN: <b>${esc(preview.debtor_iban || 'nicht hinterlegt')}</b></div>
      <div class="list-stack" style="margin-top:10px">
        ${rows.length ? rows.map((row) => `
          <div class="list-row static">
            <span class="list-ico">${icon(row.iban_valid ? 'check' : 'alert')}</span>
            <span class="list-main"><b>${esc(row.number)} · ${esc(row.name)}</b>
              <small>${esc(row.iban || 'keine IBAN')}${row.iban_valid ? '' : ' · IBAN ungültig'}</small></span>
            <span class="num">${money(row.open_amount)}</span>
          </div>`).join('') : '<div class="small muted">Keine offenen Rechnungen.</div>'}
      </div>
      ${preview.invalid.length ? `<div class="notice warn" style="margin-top:12px">${preview.invalid.length} Rechnungen werden wegen fehlender oder ungültiger IBAN nicht übernommen.</div>` : ''}`,
    footer: `
      <button class="btn" type="button" data-action="close-modal">Schließen</button>
      <button class="btn primary" type="button" data-action="sepa-file" ${preview.payable.length ? '' : 'disabled'}>${icon('download')} XML herunterladen</button>`,
  });
}

/* ------------------------------------------------------------------ Plantafel & Ressourcen */

const toLocalInput = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const bookingWindow = (dataset = {}) => {
  if (dataset.start) return { start: dataset.start, end: dataset.end };
  const day = dataset.date || todayISO();
  return { start: `${day}T08:00`, end: `${day}T16:00` };
};

async function newBookingModal(dataset = {}) {
  const [resources, orders] = await Promise.all([
    api.get('/api/resources'),
    canAny('orders.view.all', 'orders.view.own') ? api.get('/api/orders?status=offen').catch(() => []) : [],
  ]);
  const window = bookingWindow(dataset);
  formModal({
    title: 'Ressource einplanen',
    subtitle: 'Überschneidungen werden serverseitig geprüft',
    fields: [
      { name: 'resource_id', label: 'Ressource', type: 'select', required: true,
        options: resources.filter((row) => row.active).map((row) => ({ value: row.id, label: `${row.name} (${row.type_label})` })),
        default: dataset.resource || '' },
      { name: 'order_id', label: 'Auftrag', type: 'select', placeholder: 'Ohne Auftrag',
        options: orders.map((order) => ({ value: order.id, label: `${order.number} · ${order.title}` })) },
      { name: 'start_at', label: 'Beginn', type: 'datetime-local', required: true, default: window.start },
      { name: 'end_at', label: 'Ende', type: 'datetime-local', required: true, default: window.end },
      { name: 'note', label: 'Notiz', full: true },
    ],
    onSubmit: async (data) => {
      await api.post('/api/resource-bookings', data);
      closeModal();
      toast('Ressource eingeplant.');
      await renderPlanning();
    },
  });
}

async function editBookingModal(id) {
  const [bookings, resources, orders] = await Promise.all([
    api.get('/api/resource-bookings'),
    api.get('/api/resources'),
    canAny('orders.view.all', 'orders.view.own') ? api.get('/api/orders?status=offen').catch(() => []) : [],
  ]);
  const booking = bookings.find((row) => row.id === Number(id));
  if (!booking) return toast('Buchung nicht gefunden', 'error');
  formModal({
    title: 'Buchung bearbeiten',
    subtitle: booking.resource_name,
    fields: [
      { name: 'resource_id', label: 'Ressource', type: 'select', required: true,
        options: resources.filter((row) => row.active).map((row) => ({ value: row.id, label: `${row.name} (${row.type_label})` })),
        default: booking.resource_id },
      { name: 'order_id', label: 'Auftrag', type: 'select', placeholder: 'Ohne Auftrag',
        options: orders.map((order) => ({ value: order.id, label: `${order.number} · ${order.title}` })),
        default: booking.order_id || '' },
      { name: 'start_at', label: 'Beginn', type: 'datetime-local', required: true, default: booking.start_at.slice(0, 16) },
      { name: 'end_at', label: 'Ende', type: 'datetime-local', required: true, default: booking.end_at.slice(0, 16) },
      { name: 'note', label: 'Notiz', full: true, default: booking.note || '' },
    ],
    onSubmit: async (data) => {
      await api.put(`/api/resource-bookings/${id}`, data);
      closeModal();
      toast('Buchung gespeichert.');
      await renderPlanning();
    },
  });
}

function resourceFormModal(resource = null) {
  formModal({
    title: resource ? 'Ressource bearbeiten' : 'Neue Ressource',
    subtitle: 'Fahrzeuge, Werkzeuge, Maschinen und Sonstiges',
    fields: [
      { name: 'name', label: 'Bezeichnung', required: true, default: resource?.name || '' },
      { name: 'type', label: 'Art', type: 'select', default: resource?.type || 'fahrzeug',
        options: [
          { value: 'fahrzeug', label: 'Fahrzeug' }, { value: 'werkzeug', label: 'Werkzeug' },
          { value: 'maschine', label: 'Maschine' }, { value: 'sonstiges', label: 'Sonstiges' },
        ] },
      { name: 'identifier', label: 'Kennzeichen / Nummer', default: resource?.identifier || '' },
      { name: 'capacity', label: 'Parallele Einsätze', type: 'number', step: '1', min: 1, default: resource?.capacity ?? 1 },
      { name: 'color', label: 'Farbe', type: 'color', default: resource?.color || '#0f766e' },
      { name: 'notes', label: 'Notiz', type: 'textarea', full: true, rows: 2, default: resource?.notes || '' },
    ],
    onSubmit: async (data) => {
      if (resource) await api.put(`/api/resources/${resource.id}`, data);
      else await api.post('/api/resources', data);
      closeModal();
      toast('Ressource gespeichert.');
      await renderPlanning();
    },
  });
}

async function resourceListModal() {
  const resources = await api.get('/api/resources');
  openModal({
    title: 'Ressourcen verwalten',
    subtitle: `${resources.length} Einträge`,
    body: `
      <div class="list-stack">
        ${resources.length ? resources.map((row) => `
          <div class="list-row static">
            <span class="resource-dot" style="background:${esc(row.color || '#0f766e')}">${icon('box')}</span>
            <span class="list-main"><b>${esc(row.name)}</b>
              <small>${esc(row.type_label)}${row.identifier ? ` · ${esc(row.identifier)}` : ''} · ${row.booking_count} Buchungen${row.active ? '' : ' · inaktiv'}</small></span>
            <span class="lr-actions">
              ${canAny('planning.manage', 'resources.manage') ? `
                <button class="icon-btn" type="button" data-action="edit-resource" data-id="${row.id}" title="Bearbeiten">${icon('edit')}</button>
                <button class="icon-btn" type="button" data-action="delete-resource" data-id="${row.id}" title="Löschen">${icon('trash')}</button>` : ''}
            </span>
          </div>`).join('') : '<div class="small muted">Noch keine Ressourcen angelegt.</div>'}
      </div>`,
    footer: `
      ${canAny('planning.manage', 'resources.manage') ? `<button class="btn" type="button" data-action="new-resource">${icon('plus')} Neue Ressource</button>` : ''}
      <div class="spacer"></div>
      <button class="btn" type="button" data-action="close-modal">Schließen</button>`,
  });
}

/* ------------------------------------------------------------------ Personal */

async function requestAbsenceModal(employeeId = null) {
  const employees = state.employees.length ? state.employees : await api.get('/api/employees').catch(() => []);
  const own = state.user?.employee_id;
  formModal({
    title: 'Abwesenheit beantragen',
    subtitle: can('hr.manage') ? 'Anträge werden direkt gespeichert und können genehmigt werden.' : 'Der Antrag geht zur Genehmigung an die Personalverwaltung.',
    fields: [
      ...(can('hr.manage') ? [{ name: 'employee_id', label: 'Mitarbeiter', type: 'select', required: true,
        options: employees.filter((row) => row.active !== 0).map((row) => ({ value: row.id, label: row.name })),
        default: employeeId || '' }] : []),
      { name: 'type', label: 'Art', type: 'select', default: 'urlaub',
        options: [
          { value: 'urlaub', label: 'Urlaub' }, { value: 'krank', label: 'Krankheit' },
          { value: 'schule', label: 'Schule / Ausbildung' }, { value: 'fortbildung', label: 'Fortbildung' },
          { value: 'unbezahlt', label: 'Unbezahlt' }, { value: 'elternzeit', label: 'Elternzeit' },
          { value: 'sonstiges', label: 'Sonstiges' },
        ] },
      { name: 'start_date', label: 'Von', type: 'date', required: true, default: todayISO() },
      { name: 'end_date', label: 'Bis', type: 'date', required: true, default: todayISO() },
      { name: 'note', label: 'Notiz', type: 'textarea', rows: 2, full: true },
    ],
    onSubmit: async (data) => {
      const body = { ...data };
      if (!can('hr.manage')) body.employee_id = own;
      await api.post('/api/absences', body);
      closeModal();
      toast('Abwesenheit gespeichert.');
      await renderTeam();
    },
  });
  if (!can('hr.manage') && !own) toast('Dein Benutzerkonto ist keinem Mitarbeiter zugeordnet.', 'error');
}

async function hrAccountModal(employeeId) {
  const year = new Date().getFullYear();
  const data = await api.get(`/api/hr/accounts?employee_id=${employeeId}&year=${year}`);
  const { vacation, overtime } = data;
  openModal({
    title: `${vacation.employee_name} – Konten ${year}`,
    subtitle: 'Urlaub und Arbeitszeit inklusive Wochenvergleich',
    size: 'wide',
    body: `
      <div class="kpi-grid tight">
        <div class="kpi"><div class="label">Urlaubsanspruch</div><div class="value">${num2(vacation.entitled)}</div><div class="foot">Tage</div></div>
        <div class="kpi"><div class="label">Genehmigt</div><div class="value">${num2(vacation.approved)}</div><div class="foot">Tage</div></div>
        <div class="kpi"><div class="label">Resturlaub</div><div class="value">${num2(vacation.remaining)}</div><div class="foot">${num2(vacation.pending)} Tage beantragt</div></div>
        <div class="kpi"><div class="label">Arbeitszeitkonto</div><div class="value">${overtime.balance_hours >= 0 ? '+' : ''}${num2(overtime.balance_hours)}</div><div class="foot">Stunden · ${num2(overtime.weekly_hours)} Std./Woche</div></div>
      </div>
      <div class="hr"></div>
      <div class="section-head compact"><div><h4>Wochenvergleich</h4><div class="small muted">${fmtDate(overtime.from)} – ${fmtDate(overtime.to)}</div></div></div>
      <div class="list-stack">
        ${overtime.weeks.slice(-8).reverse().map((week) => `
          <div class="list-row static">
            <span class="list-ico">${icon('clock')}</span>
            <span class="list-main"><b>Woche ab ${fmtDate(week.week_start)}</b>
              <small>${num2(week.hours)} Std. erfasst · Soll ${num2(week.target / 60)} Std.${week.adjustment ? ` · Korrektur ${week.adjustment} Min.` : ''}</small></span>
            <span class="badge ${week.diff >= 0 ? 'bezahlt' : 'overdue'}">${week.diff >= 0 ? '+' : ''}${num2(week.diff_hours)} Std.</span>
          </div>`).join('') || '<div class="small muted">Keine Zeiten im Zeitraum.</div>'}
      </div>`,
    footer: `
      ${can('hr.manage') ? `
        <button class="btn sm" type="button" data-action="vacation-entitlement" data-id="${employeeId}">Anspruch</button>
        <button class="btn sm" type="button" data-action="time-adjustment" data-id="${employeeId}">Korrektur</button>` : ''}
      <div class="spacer"></div>
      <button class="btn" type="button" data-action="close-modal">Schließen</button>`,
  });
}

async function timeAdjustmentModal(employeeId) {
  formModal({
    title: 'Arbeitszeit korrigieren',
    subtitle: 'Positiv = Gutschrift, negativ = Abzug',
    fields: [
      { name: 'date', label: 'Datum', type: 'date', required: true, default: todayISO() },
      { name: 'minutes', label: 'Minuten', type: 'number', step: '1', required: true, default: 0,
        hint: 'Beispiel: 60 = eine Stunde Gutschrift, -30 = halbe Stunde Abzug' },
      { name: 'note', label: 'Grund', full: true, required: true, placeholder: 'z. B. Nachtrag Stempeleintrag' },
    ],
    onSubmit: async (data) => {
      await api.post('/api/time-adjustments', { ...data, employee_id: employeeId });
      closeModal();
      toast('Korrektur gebucht.');
      await hrAccountModal(employeeId);
    },
  });
}

function vacationEntitlementModal(employeeId) {
  formModal({
    title: 'Urlaubsanspruch setzen',
    subtitle: 'Gilt für das laufende Jahr',
    fields: [
      { name: 'year', label: 'Jahr', type: 'number', required: true, default: new Date().getFullYear() },
      { name: 'days', label: 'Tage', type: 'number', step: '0.5', required: true, default: 30 },
      { name: 'note', label: 'Notiz', full: true },
    ],
    onSubmit: async (data) => {
      await api.put('/api/vacation-entitlements', { ...data, employee_id: employeeId });
      closeModal();
      toast('Urlaubsanspruch gespeichert.');
      await renderTeam();
    },
  });
}

/* ------------------------------------------------------------------ Auftrag: Kalkulation, Aufmaß, Checklisten, Tagebuch, Unterschrift */

async function orderCalculationModal(orderId) {
  const data = await api.get(`/api/orders/${orderId}/calculation`);
  const { order, items, config, planned, actual } = data;
  const editable = can('calculation.manage');
  openModal({
    title: `Kalkulation ${order.number}`,
    subtitle: `${order.title} · ${items.length} Positionen`,
    size: 'wide',
    body: `
      <div class="kpi-grid tight">
        <div class="kpi"><div class="label">Kosten geplant</div><div class="value">${money(planned.cost_total)}</div><div class="foot">Lohn, Material, Gerät</div></div>
        <div class="kpi"><div class="label">Angebotswert netto</div><div class="value">${money(planned.revenue)}</div><div class="foot">Marge ${num2(planned.margin_pct)} %</div></div>
        <div class="kpi"><div class="label">Ist-Kosten</div><div class="value">${money(actual.cost_total)}</div><div class="foot">${num2(actual.hours)} Std. erfasst</div></div>
        <div class="kpi"><div class="label">Nachkalkulation</div><div class="value" style="color:${actual.margin_pct >= 0 ? 'var(--ok)' : 'var(--danger)'}">${num2(actual.margin_pct)} %</div><div class="foot">${money(actual.margin_amount)} Marge</div></div>
      </div>
      <form id="calc-form">
        <div class="form-grid" style="margin-top:12px">
          <div class="field"><label>Lohn (€/Std.)</label><input name="wage_rate" type="number" step="0.01" value="${config.wage_rate}" ${editable ? '' : 'disabled'} /></div>
          <div class="field"><label>Gemeinkosten (%)</label><input name="overhead_pct" type="number" step="0.1" value="${config.overhead_pct}" ${editable ? '' : 'disabled'} /></div>
          <div class="field"><label>Gewinn (%)</label><input name="profit_pct" type="number" step="0.1" value="${config.profit_pct}" ${editable ? '' : 'disabled'} /></div>
          <div class="field"><label>Rabatt (%)</label><input name="discount_pct" type="number" step="0.1" value="${config.discount_pct}" ${editable ? '' : 'disabled'} /></div>
        </div>
        <div class="table-wrap" style="margin-top:12px">
          <table class="compact-table">
            <thead><tr><th>Position</th><th class="right">Menge</th><th class="right">VK netto</th><th class="right">Lohn</th><th class="right">Material</th><th class="right">Gerät</th><th class="right">Sonstig</th><th class="right">Marge</th></tr></thead>
            <tbody>
              ${items.map((item) => `
                <tr>
                  <td><b>${esc(item.description)}</b><div class="cell-sub">${esc(item.kind === 'arbeit' ? 'Lohn' : 'Material')}</div></td>
                  <td class="right num">${num2(item.quantity)} ${esc(item.unit || '')}</td>
                  <td class="right num">${money(item.net)}</td>
                  ${['wage', 'material', 'equipment', 'other'].map((key) => `
                    <td class="right"><input class="calc-input" name="cost_${key}_${item.id}" type="number" step="0.01"
                      value="${item.costs[key]}" ${editable ? '' : 'disabled'} /></td>`).join('')}
                  <td class="right num" style="color:${item.margin_pct >= 0 ? 'var(--ok)' : 'var(--danger)'}">${num2(item.margin_pct)} %</td>
                </tr>`).join('') || '<tr><td colspan="8" class="muted">Keine Positionen erfasst.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="small muted" style="margin-top:8px">Zielpreis netto bei aktuellen Aufschlägen: <b>${money(planned.target_net)}</b>. „In Positionen übernehmen“ schreibt die kalkulierten Verkaufspreise fest.</div>
      </form>`,
    footer: `
      <button class="btn" type="button" data-action="close-modal">Schließen</button>
      ${editable ? `
        <button class="btn" type="button" data-action="save-calculation" data-id="${orderId}">Speichern</button>
        <button class="btn primary" type="button" data-action="apply-calculation" data-id="${orderId}">In Positionen übernehmen</button>` : ''}`,
  });
}

function calculationPayload(orderId) {
  const form = $('#calc-form');
  if (!form) return null;
  const items = $$('.calc-input', form).map((input) => {
    const match = /^cost_(wage|material|equipment|other)_(\d+)$/.exec(input.name);
    return match ? { id: Number(match[2]), key: match[1], value: input.value } : null;
  }).filter(Boolean);
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.id)) grouped.set(item.id, { id: item.id });
    grouped.get(item.id)[`cost_${item.key}`] = item.value;
  }
  return {
    wage_rate: form.elements.wage_rate.value,
    overhead_pct: form.elements.overhead_pct.value,
    profit_pct: form.elements.profit_pct.value,
    discount_pct: form.elements.discount_pct.value,
    items: [...grouped.values()],
  };
}

async function orderMeasurementsModal(orderId) {
  const data = await api.get(`/api/orders/${orderId}/measurements`);
  const rows = data.measurements || [];
  openModal({
    title: 'Aufmaß',
    subtitle: `${rows.length} Positionen · ${num2(rows.reduce((sum, row) => sum + Number(row.quantity), 0))} Gesamtmenge`,
    size: 'wide',
    body: `
      <div class="list-stack">
        ${rows.length ? rows.map((row) => `
          <div class="list-row static">
            <span class="list-ico">${icon('edit')}</span>
            <span class="list-main"><b>${esc(row.description)}</b>
              <small>${esc(row.room || 'ohne Raum')} · ${num2(row.quantity)} ${esc(row.unit)}${Number(row.length) ? ` · ${num2(row.length)} × ${num2(row.width)}${Number(row.height) ? ` × ${num2(row.height)}` : ''}` : ''}</small></span>
            <span class="lr-actions">
              <button class="icon-btn" type="button" data-action="delete-measurement" data-id="${orderId}" data-measurement="${row.id}" title="Löschen">${icon('trash')}</button>
            </span>
          </div>`).join('') : '<div class="small muted">Noch keine Aufmaßpositionen.</div>'}
      </div>
      ${can('orders.progress') ? `
        <div class="hr"></div>
        <div class="section-head compact"><div><h4>Position aufnehmen</h4></div></div>
        <form id="measurement-form" class="form-grid">
          <div class="field"><label>Raum / Bereich</label><input name="room" placeholder="z. B. Bad EG" /></div>
          <div class="field"><label>Berechnung</label><select name="category">
            ${Object.entries(data.categories || {}).map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join('')}
          </select></div>
          <div class="field full"><label>Bezeichnung *</label><input name="description" required placeholder="z. B. Fliesenarbeiten" /></div>
          <div class="field"><label>Länge (m)</label><input name="length" type="number" step="0.01" value="0" /></div>
          <div class="field"><label>Breite (m)</label><input name="width" type="number" step="0.01" value="0" /></div>
          <div class="field"><label>Höhe (m)</label><input name="height" type="number" step="0.01" value="0" /></div>
          <div class="field"><label>Anzahl</label><input name="count" type="number" step="1" value="1" /></div>
          <div class="field"><label>Faktor</label><input name="factor" type="number" step="0.01" value="1" /></div>
          <div class="field"><label>Einheit</label><input name="unit" placeholder="m²" /></div>
          <div class="field"><label>Menge (frei)</label><input name="quantity" type="number" step="0.0001" value="0" /></div>
        </form>` : ''}`,
    footer: `
      <button class="btn" type="button" data-action="close-modal">Schließen</button>
      ${can('orders.manage') && rows.length ? `<button class="btn" type="button" data-action="apply-measurements" data-id="${orderId}">Ins LV übernehmen</button>` : ''}
      ${can('orders.progress') ? `<button class="btn primary" type="button" data-action="save-measurement" data-id="${orderId}">Position speichern</button>` : ''}`,
  });
}

async function orderChecklistsModal(orderId) {
  const data = await api.get(`/api/orders/${orderId}/checklists`);
  const checklists = data.checklists || [];
  const templates = data.templates || [];
  openModal({
    title: 'Checklisten',
    subtitle: `${checklists.length} Listen`,
    size: 'wide',
    body: `
      ${checklists.length ? checklists.map((list) => `
        <div class="subcard" style="margin-bottom:12px">
          <div class="section-head compact">
            <div><h4>${esc(list.name)}</h4><div class="small muted">${list.done} von ${list.total} erledigt · ${list.percent} %</div></div>
            ${can('orders.manage') ? `<button class="icon-btn" type="button" data-action="delete-checklist" data-id="${list.id}" data-order="${orderId}" title="Löschen">${icon('trash')}</button>` : ''}
          </div>
          <div class="progress"><span style="width:${list.percent}%"></span></div>
          <div class="list-stack" style="margin-top:10px">
            ${list.items.map((entry) => `
              <label class="check-row">
                <input type="checkbox" data-action="toggle-checklist-entry" data-checklist="${list.id}" data-entry="${entry.id}" ${entry.checked ? 'checked' : ''} ${can('orders.progress') ? '' : 'disabled'} />
                <span>${esc(entry.label)}${entry.note ? `<small class="muted">${esc(entry.note)}</small>` : ''}</span>
              </label>`).join('')}
          </div>
        </div>`).join('') : '<div class="small muted">Noch keine Checkliste.</div>'}
      ${can('orders.progress') && templates.length ? `
        <div class="hr"></div>
        <div class="section-head compact"><div><h4>Checkliste aus Vorlage</h4></div></div>
        <div class="form-grid">
          <div class="field full"><label>Vorlage</label><select id="checklist-template">
            ${templates.map((template) => `<option value="${template.id}">${esc(template.name)} (${template.items.length} Punkte)</option>`).join('')}
          </select></div>
        </div>` : ''}`,
    footer: `
      <button class="btn" type="button" data-action="close-modal">Schließen</button>
      ${can('orders.progress') && templates.length ? `<button class="btn primary" type="button" data-action="add-checklist" data-id="${orderId}">Checkliste anlegen</button>` : ''}`,
  });
}

async function orderDiaryModal(orderId) {
  const entries = await api.get(`/api/orders/${orderId}/diary`);
  openModal({
    title: 'Bautagebuch',
    subtitle: `${entries.length} Einträge`,
    size: 'wide',
    body: `
      <div class="list-stack">
        ${entries.length ? entries.map((entry) => `
          <div class="list-row static">
            <span class="list-ico">${icon('calendar')}</span>
            <span class="list-main"><b>${fmtDate(entry.date)}${entry.weather ? ` · ${esc(entry.weather)}` : ''}</b>
              <small>${esc(entry.work_done)}</small>
              ${entry.personnel ? `<small class="muted">Personal: ${esc(entry.personnel)}</small>` : ''}
              ${entry.material ? `<small class="muted">Material: ${esc(entry.material)}</small>` : ''}
              ${entry.incidents ? `<small class="muted">Besonderheiten: ${esc(entry.incidents)}</small>` : ''}
            </span>
            ${can('orders.progress') ? `<button class="icon-btn" type="button" data-action="delete-diary" data-id="${orderId}" data-entry="${entry.id}" title="Löschen">${icon('trash')}</button>` : ''}
          </div>`).join('') : '<div class="small muted">Noch keine Einträge.</div>'}
      </div>
      ${can('orders.progress') ? `
        <div class="hr"></div>
        <div class="section-head compact"><div><h4>Neuer Eintrag</h4></div></div>
        <form id="diary-form" class="form-grid">
          <div class="field"><label>Datum</label><input name="date" type="date" value="${todayISO()}" /></div>
          <div class="field"><label>Wetter</label><input name="weather" placeholder="trocken, 12 °C" /></div>
          <div class="field"><label>Temperatur</label><input name="temperature" placeholder="12 °C" /></div>
          <div class="field"><label>Personal</label><input name="personnel" placeholder="2 Monteure" /></div>
          <div class="field full"><label>Arbeiten *</label><textarea name="work_done" rows="3" required></textarea></div>
          <div class="field full"><label>Material</label><textarea name="material" rows="2"></textarea></div>
          <div class="field full"><label>Besonderheiten</label><textarea name="incidents" rows="2"></textarea></div>
        </form>` : ''}`,
    footer: `
      <button class="btn" type="button" data-action="close-modal">Schließen</button>
      ${can('orders.progress') ? `<button class="btn primary" type="button" data-action="save-diary" data-id="${orderId}">Eintrag speichern</button>` : ''}`,
  });
}

async function orderSignatureModal(orderId) {
  const signatures = await api.get(`/api/orders/${orderId}/signatures`);
  openModal({
    title: 'Unterschrift',
    subtitle: 'Digitale Abnahme direkt auf dem Gerät',
    size: 'wide',
    body: `
      ${signatures.length ? `
        <div class="section-head compact"><div><h4>Vorhandene Unterschriften</h4></div></div>
        <div class="list-stack">
          ${signatures.map((row) => `<div class="list-row static">
            <span class="list-ico">${icon('check')}</span>
            <span class="list-main"><b>${esc(row.customer_name)}</b><small>${fmtDateTime(row.signed_at)} · ${esc(row.user_name || '')}</small></span>
            <a class="icon-btn" href="/api/signatures/${row.id}/file" target="_blank" rel="noopener" title="Ansehen">${icon('image')}</a>
          </div>`).join('')}
        </div>
        <div class="hr"></div>` : ''}
      <form id="signature-form" class="form-grid">
        <div class="field full"><label>Name des Unterzeichners *</label><input name="customer_name" required /></div>
        <div class="field full"><label>Notiz</label><input name="note" placeholder="z. B. Abnahme ohne Mängel" /></div>
        <div class="field full">
          <label>Unterschrift</label>
          <canvas id="signature-pad" class="signature-pad" width="900" height="320"></canvas>
          <div class="field-tools"><button class="btn sm ghost" type="button" data-action="clear-signature">Leeren</button></div>
        </div>
      </form>`,
    footer: `
      <button class="btn" type="button" data-action="close-modal">Schließen</button>
      <button class="btn primary" type="button" data-action="save-signature" data-id="${orderId}">Unterschrift speichern</button>`,
  });
  initSignaturePad();
}

let signaturePadState = null;
function initSignaturePad() {
  const canvas = $('#signature-pad');
  if (!canvas) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = canvas.clientWidth || 600;
  canvas.width = width * ratio;
  canvas.height = 320 * ratio;
  canvas.style.height = '220px';
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let drawing = false;
  let hasInk = false;
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / ratio / rect.width;
    const scaleY = canvas.height / ratio / rect.height;
    return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
  };
  canvas.addEventListener('pointerdown', (event) => {
    drawing = true;
    hasInk = true;
    canvas.setPointerCapture(event.pointerId);
    const pos = point(event);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const pos = point(event);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointerleave', stop);
  signaturePadState = { canvas, hasInk: () => hasInk, clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); hasInk = false; } };
}

async function orderDocumentsModal(orderId, orderNumber = '') {
  const documents = await api.get(`/api/documents?order_id=${orderId}`);
  openModal({
    title: `Dokumente${orderNumber ? ` zu ${orderNumber}` : ''}`,
    subtitle: 'Alles zur Projektakte',
    body: `
      <div class="list-stack">
        ${documents.length ? documents.map((doc) => `
          <div class="list-row static">
            <span class="list-ico">${icon('file')}</span>
            <span class="list-main"><b>${esc(doc.title)}</b><small>${esc(DOCUMENT_CATEGORIES_UI[doc.category] || doc.category)} · ${documentSize(doc.size)} · ${fmtDate(doc.created_at)}</small></span>
            <a class="icon-btn" href="/api/documents/${doc.id}/file" target="_blank" rel="noopener" title="Herunterladen">${icon('download')}</a>
          </div>`).join('') : '<div class="small muted">Noch keine Dokumente zu diesem Auftrag.</div>'}
      </div>`,
    footer: `
      ${can('documents.manage') ? `<button class="btn" type="button" data-action="upload-order-document" data-id="${orderId}">${icon('plus')} Dokument ablegen</button>` : ''}
      <div class="spacer"></div>
      <button class="btn" type="button" data-action="close-modal">Schließen</button>`,
  });
}

function orderGaebModal(orderId) {
  openModal({
    title: 'GAEB & OCI',
    subtitle: 'Leistungsverzeichnis austauschen und Lieferantenbestellungen übernehmen',
    body: `
      <div class="section-head compact"><div><h4>GAEB X83 (DA83)</h4><div class="small muted">Export für Ausschreibungen, Import von Positionen</div></div></div>
      <div class="nowrap" style="margin-bottom:10px">
        <button class="btn sm" type="button" data-action="download-gaeb" data-id="${orderId}">${icon('download')} Exportieren</button>
        <label class="btn sm ghost" style="display:inline-flex;cursor:pointer">
          ${icon('plus')} Importieren
          <input type="file" id="gaeb-file" accept=".x83,.xml,.txt" hidden />
        </label>
      </div>
      <div class="hr"></div>
      <div class="section-head compact"><div><h4>OCI-Bestellung</h4><div class="small muted">BMEcat-/OCI-XML des Lieferanten übernehmen</div></div></div>
      <label class="btn sm ghost" style="display:inline-flex;cursor:pointer">
        ${icon('download')} OCI importieren
        <input type="file" id="oci-file" accept=".xml" hidden />
      </label>`,
    footer: `<button class="btn" type="button" data-action="close-modal">Schließen</button>`,
  });
  $('#gaeb-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const content = await readTextFile(file);
      const result = await api.post(`/api/orders/${orderId}/gaeb/import`, { content });
      toast(`${result.count} GAEB-Positionen importiert.`);
      closeModal();
      await openOrder(orderId);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  $('#oci-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const content = await readTextFile(file);
      const result = await api.post(`/api/orders/${orderId}/oci/import`, { content });
      toast(`${result.count} OCI-Positionen importiert.`);
      closeModal();
      await openOrder(orderId);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

/* ------------------------------------------------------------------ Textassistent */

const ASSISTANT_KINDS = {
  angebot: 'Angebotstext',
  mahnung: 'Zahlungserinnerung',
  zusammenfassung: 'Auftragszusammenfassung',
  checkliste: 'Checkliste',
  email: 'E-Mail',
};

function assistantModal({ kind = 'angebot', orderId = null, invoiceId = null, customerId = null } = {}) {
  openModal({
    title: 'Textassistent',
    subtitle: 'Erzeugt Entwürfe ausschließlich aus den vorhandenen Daten – ohne externe Dienste',
    size: 'wide',
    body: `
      <div class="form-grid">
        <div class="field"><label>Textart</label><select id="assistant-kind">
          ${Object.entries(ASSISTANT_KINDS).map(([value, label]) => `<option value="${value}" ${value === kind ? 'selected' : ''}>${label}</option>`).join('')}
        </select></div>
        <div class="field"><label>&nbsp;</label>
          <button class="btn primary" type="button" data-action="run-assistant"
            data-order="${orderId || ''}" data-invoice="${invoiceId || ''}" data-customer="${customerId || ''}">Entwurf erzeugen</button>
        </div>
        <div class="field full"><label>Zusatzhinweise</label><textarea id="assistant-extra" rows="2" placeholder="Optional: Ton, Termin oder besondere Hinweise"></textarea></div>
        <div class="field full"><label>Ergebnis</label><textarea id="assistant-result" rows="12" placeholder="Noch kein Entwurf erzeugt."></textarea></div>
      </div>`,
    footer: `
      <button class="btn" type="button" data-action="copy-assistant">Kopieren</button>
      <div class="spacer"></div>
      <button class="btn" type="button" data-action="close-modal">Schließen</button>`,
  });
}

async function runAssistant() {
  const kind = $('#assistant-kind')?.value || 'angebot';
  const extra = $('#assistant-extra')?.value || '';
  const button = $('[data-action="run-assistant"]');
  const result = $('#assistant-result');
  if (!button || !result) return;
  button.disabled = true;
  try {
    const draft = await api.post('/api/assistant/draft', {
      kind,
      extra,
      order_id: button.dataset.order || null,
      invoice_id: button.dataset.invoice || null,
      customer_id: button.dataset.customer || null,
    });
    result.value = draft.text;
    toast('Entwurf erzeugt.');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

/* ------------------------------------------------------------------ Inventur & Scan */

async function inventoryModal() {
  const sessions = await api.get('/api/inventory');
  openModal({
    title: 'Inventur',
    subtitle: `${sessions.length} Sitzungen`,
    body: `
      <div class="list-stack">
        ${sessions.length ? sessions.map((session) => `
          <div class="list-row static">
            <span class="list-ico">${icon('box')}</span>
            <span class="list-main"><b>${esc(session.name)}</b>
              <small>${session.counted} von ${session.articles} Artikeln gezählt · ${fmtDate(session.created_at)} · ${esc(session.status)}</small></span>
            <span class="lr-actions">
              <button class="btn sm" type="button" data-action="open-inventory" data-id="${session.id}">Öffnen</button>
            </span>
          </div>`).join('') : '<div class="small muted">Noch keine Inventur angelegt.</div>'}
      </div>`,
    footer: `
      ${can('warehouse.manage') ? `<button class="btn primary" type="button" data-action="new-inventory">${icon('plus')} Neue Inventur</button>` : ''}
      <div class="spacer"></div>
      <button class="btn" type="button" data-action="close-modal">Schließen</button>`,
  });
}

function newInventoryModal() {
  formModal({
    title: 'Neue Inventur',
    subtitle: 'Zählungen werden erst beim Abschluss in den Bestand übernommen',
    fields: [
      { name: 'name', label: 'Bezeichnung', required: true, default: `Inventur ${fmtDate(todayISO())}` },
      { name: 'note', label: 'Notiz', type: 'textarea', rows: 2, full: true },
    ],
    onSubmit: async (data) => {
      const session = await api.post('/api/inventory', data);
      closeModal();
      toast('Inventur angelegt.');
      await inventorySessionModal(session.id);
    },
  });
}

async function inventorySessionModal(id) {
  const data = await api.get(`/api/inventory/${id}`);
  const { session, counts, articles, stats } = data;
  const open = session.status === 'offen';
  openModal({
    title: session.name,
    subtitle: `${stats.counted} von ${stats.total} gezählt · ${stats.differences} Abweichungen`,
    size: 'wide',
    body: `
      <div class="kpi-grid tight">
        <div class="kpi"><div class="label">Gezählt</div><div class="value">${stats.counted}</div><div class="foot">von ${stats.total}</div></div>
        <div class="kpi"><div class="label">Abweichungen</div><div class="value">${stats.differences}</div><div class="foot">Positionen</div></div>
        <div class="kpi"><div class="label">Status</div><div class="value" style="font-size:20px">${esc(session.status)}</div><div class="foot">${session.closed_at ? fmtDate(session.closed_at) : 'laufend'}</div></div>
      </div>
      ${open && can('warehouse.manage') ? `
        <div class="hr"></div>
        <form id="count-form" class="form-grid">
          <div class="field full"><label>Artikel</label><select name="article_id" required>
            ${articles.map((article) => `<option value="${article.id}">${esc(article.number)} · ${esc(article.name)} (Bestand ${num2(article.stock)} ${esc(article.unit || '')})</option>`).join('')}
          </select></div>
          <div class="field"><label>Gezählte Menge</label><input name="counted" type="number" step="0.001" min="0" required value="0" /></div>
          <div class="field"><label>Notiz</label><input name="note" /></div>
        </form>` : ''}
      <div class="hr"></div>
      <div class="list-stack">
        ${counts.length ? counts.map((row) => `
          <div class="list-row static">
            <span class="list-ico">${icon('box')}</span>
            <span class="list-main"><b>${esc(row.name)}</b><small>${esc(row.number)} · Soll ${num2(row.system_qty)} ${esc(row.unit || '')} · Ist ${num2(row.counted_qty)} ${esc(row.unit || '')}</small></span>
            <span class="badge ${Math.abs(row.diff) < 0.0001 ? 'bezahlt' : 'overdue'}">${row.diff >= 0 ? '+' : ''}${num2(row.diff)}</span>
          </div>`).join('') : '<div class="small muted">Noch keine Zählung erfasst.</div>'}
      </div>`,
    footer: `
      <button class="btn" type="button" data-action="close-modal">Schließen</button>
      ${open && can('warehouse.manage') ? `
        <button class="btn" type="button" data-action="save-inventory-count" data-id="${id}">Zählung speichern</button>
        <button class="btn primary" type="button" data-action="close-inventory" data-id="${id}">Abschließen</button>` : ''}`,
  });
}

function scanArticleModal() {
  openModal({
    title: 'Artikel scannen',
    subtitle: 'Barcode, GTIN oder Artikelnummer',
    body: `
      <form id="scan-form" class="form-grid">
        <div class="field full"><label>Code</label>
          <div style="display:flex;gap:8px">
            <input name="code" autofocus autocomplete="off" placeholder="Code eingeben oder scannen" style="flex:1" />
            <button class="btn primary" type="submit">Suchen</button>
          </div>
        </div>
      </form>
      <div id="scan-result"></div>`,
    footer: `<button class="btn" type="button" data-action="close-modal">Schließen</button>`,
  });
  $('#scan-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = event.target.elements.code.value.trim();
    if (!code) return;
    try {
      const { article } = await api.get(`/api/articles/lookup?code=${encodeURIComponent(code)}`);
      const target = $('#scan-result');
      if (!article) {
        target.innerHTML = `<div class="notice warn" style="margin-top:12px">Kein Artikel zu „${esc(code)}“ gefunden.</div>`;
        return;
      }
      target.innerHTML = `
        <div class="subcard" style="margin-top:12px">
          <div class="section-head compact"><div><h4>${esc(article.name)}</h4><div class="small muted">${esc(article.number)} · ${esc(article.category || '')} · ${esc(article.location || 'kein Lagerort')}</div></div>
            <span class="badge ${Number(article.stock) <= Number(article.min_stock) ? 'overdue' : 'bezahlt'}">${num2(article.stock)} ${esc(article.unit || '')}</span></div>
          ${can('warehouse.manage') ? `
            <form id="scan-stock-form" class="form-grid" style="margin-top:10px">
              <div class="field"><label>Menge</label><input name="quantity" type="number" step="0.001" required placeholder="z. B. 5 oder -2" /></div>
              <div class="field"><label>Grund</label><input name="reason" placeholder="Wareneingang / Entnahme" /></div>
              <div class="field full"><button class="btn primary" type="submit">Bestand buchen</button></div>
            </form>` : ''}
        </div>`;
      const stockForm = $('#scan-stock-form');
      if (stockForm) {
        stockForm.addEventListener('submit', async (submitEvent) => {
          submitEvent.preventDefault();
          try {
            await api.post(`/api/articles/${article.id}/stock`, {
              quantity: Number(stockForm.elements.quantity.value),
              reason: stockForm.elements.reason.value,
            });
            toast('Bestand gebucht.');
            closeModal();
            await renderWarehouse();
          } catch (error) {
            toast(error.message, 'error');
          }
        });
      }
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

/* ------------------------------------------------------------------ Vorlagen & Webhooks */

function checklistTemplateModal(template = null) {
  formModal({
    title: template ? 'Vorlage bearbeiten' : 'Neue Checklistenvorlage',
    subtitle: 'Ein Punkt pro Zeile',
    fields: [
      { name: 'name', label: 'Name', required: true, default: template?.name || '' },
      { name: 'trade', label: 'Gewerk / Bereich', default: template?.trade || 'Allgemein' },
      { name: 'items', label: 'Punkte', type: 'textarea', rows: 10, full: true, required: true, default: (template?.items || []).join('\n') },
    ],
    onSubmit: async (data) => {
      if (template) await api.put(`/api/checklist-templates/${template.id}`, data);
      else await api.post('/api/checklist-templates', data);
      closeModal();
      toast('Vorlage gespeichert.');
      await renderSettings();
    },
  });
}

function webhookModal() {
  formModal({
    title: 'Webhook anlegen',
    subtitle: 'HTTPS-Ziel, signiert mit HMAC-SHA256',
    fields: [
      { name: 'url', label: 'Ziel-URL', required: true, placeholder: 'https://example.com/hooks/handwerkpro' },
      { name: 'events', label: 'Ereignisse (Komma-getrennt)', full: true, default: '*',
        hint: 'Verfügbar: order.created, order.status, invoice.created, invoice.paid, customer.created, document.uploaded, report.approved oder *' },
      { name: 'secret', label: 'Geheimnis', hint: 'Leer lassen für automatisch erzeugtes Geheimnis (wird nur einmal angezeigt).' },
    ],
    onSubmit: async (data) => {
      const created = await api.post('/api/webhooks', { ...data, events: data.events.split(',').map((event) => event.trim()).filter(Boolean) });
      closeModal();
      await renderSettings();
      if (created.secret && created.secret !== '********') {
        openModal({
          title: 'Webhook angelegt',
          subtitle: 'Geheimnis jetzt notieren – es wird nur einmal angezeigt.',
          body: `<div class="field"><label>Signatur-Geheimnis</label><input readonly value="${esc(created.secret)}" onclick="this.select()" /></div>`,
          footer: `<button class="btn primary" type="button" data-action="close-modal">Verstanden</button>`,
        });
      } else {
        toast('Webhook gespeichert.');
      }
    },
  });
}

function einvoiceReferenceModal(invoiceId, buyerReference = '') {
  formModal({
    title: 'E-Rechnung: Referenz',
    subtitle: 'Leitweg-ID bzw. Buyer Reference für XRechnung und ZUGFeRD',
    fields: [
      { name: 'buyer_reference', label: 'Leitweg-ID / Buyer Reference', full: true, default: buyerReference,
        hint: 'Bei öffentlichen Auftraggebern die Leitweg-ID, sonst z. B. die Auftragsnummer des Kunden.' },
      { name: 'einvoice_format', label: 'Format', type: 'select', default: 'xrechnung',
        options: [{ value: 'xrechnung', label: 'XRechnung 3.0 (UBL)' }, { value: 'zugferd', label: 'ZUGFeRD 2.x (CII)' }] },
    ],
    onSubmit: async (data) => {
      await api.put(`/api/invoices/${invoiceId}`, data);
      closeModal();
      toast('E-Rechnungsdaten gespeichert.');
      await openInvoice(invoiceId);
    },
  });
}

/* ------------------------------------------------------------------ Init & Anmeldung */
async function loadBase() {
  const safe = (promise, fallback) => promise.catch(() => fallback);
  const [settingsResponse, employees, customers, properties, articles, materialData, materialImports] = await Promise.all([
    api.get('/api/settings'),
    can('employees.view') ? safe(api.get('/api/employees'), []) : [],
    can('customers.view') ? safe(api.get('/api/customers'), []) : [],
    can('customers.view') ? safe(api.get('/api/properties'), []) : [],
    can('warehouse.view') ? safe(api.get('/api/articles'), []) : [],
    can('warehouse.view') ? safe(api.get('/api/materials/sources'), { sources: [] }) : { sources: [] },
    can('warehouse.view') ? safe(api.get('/api/materials/imports?limit=8'), []) : [],
  ]);
  state.settings = settingsResponse.settings;
  state.employees = employees;
  state.customers = customers;
  state.properties = properties;
  state.articles = articles;
  state.materialSources = materialData?.sources ?? [];
  state.materialImports = Array.isArray(materialImports) ? materialImports : [];
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
  stopGeoTracking();
  state.geo = null;
  const shell = $('#app-shell');
  const login = $('#login-screen');
  if (shell) shell.hidden = true;
  if (login) login.hidden = false;
  const fab = $('#voice-fab');
  if (fab) fab.hidden = true;
  document.body.classList.add('logged-out');
  closeModal();
  const demo = state.meta.demo_users || [];
  const passwords = state.meta.demo_passwords || {};
  const demoBox = $('#login-demo');
  if (demoBox) {
    demoBox.hidden = demo.length === 0;
    demoBox.innerHTML = demo.length === 0 ? '' : `
      <div class="small muted">Demo-Zugänge – zum Ausfüllen antippen. Vor dem Produktivbetrieb Passwörter ändern:</div>
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
  if (data.user.must_change_password) {
    openPasswordChange({ mandatory: true });
    return;
  }
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
  if (can('time.own')) await ensureGeoState(true);
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
    if (error.status !== 401) console.error('App-Start fehlgeschlagen', error?.stack || error);
    showLogin();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

init();
