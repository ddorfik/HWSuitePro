import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedDemoData, seedUsersIfEmpty, seedOperationsIfEmpty, ensureOfficeStaff } from './seed.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const DATA_DIR = process.env.GASWASSER_DATA || join(ROOT, 'data');
export const DB_FILE = process.env.GASWASSER_DB || join(DATA_DIR, 'gaswasser.db');

mkdirSync(DATA_DIR, { recursive: true });
// Datenbank, Fotos und PDFs enthalten Kundendaten – nur für den Betreiber lesbar.
try { chmodSync(DATA_DIR, 0o700); } catch { /* Windows */ }

export const db = new DatabaseSync(DB_FILE);
try { chmodSync(DB_FILE, 0o600); } catch { /* Windows */ }

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  scope TEXT NOT NULL,
  year  INTEGER NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, year)
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  number     TEXT UNIQUE,
  type       TEXT NOT NULL DEFAULT 'Firma',
  salutation TEXT DEFAULT 'Firma',
  company    TEXT,
  first_name TEXT,
  last_name  TEXT,
  street     TEXT,
  zip        TEXT,
  city       TEXT,
  email      TEXT,
  phone      TEXT,
  mobile     TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS properties (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id      INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label            TEXT NOT NULL,
  street           TEXT,
  zip              TEXT,
  city             TEXT,
  type             TEXT DEFAULT 'Einfamilienhaus',
  gas_connection   INTEGER NOT NULL DEFAULT 1,
  water_connection INTEGER NOT NULL DEFAULT 1,
  heating_type     TEXT,
  meter_number     TEXT,
  notes            TEXT
);

CREATE TABLE IF NOT EXISTS employees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  role        TEXT DEFAULT 'Monteur',
  phone       TEXT,
  rate        REAL NOT NULL DEFAULT 0,
  color       TEXT DEFAULT '#0f766e',
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS articles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  number         TEXT UNIQUE,
  name           TEXT NOT NULL,
  category       TEXT DEFAULT 'Wasser',
  unit           TEXT DEFAULT 'Stk',
  purchase_price REAL NOT NULL DEFAULT 0,
  sale_price     REAL NOT NULL DEFAULT 0,
  stock          REAL NOT NULL DEFAULT 0,
  min_stock      REAL NOT NULL DEFAULT 0,
  supplier       TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  gtin               TEXT,
  manufacturer       TEXT,
  manufacturer_number TEXT,
  etim_class         TEXT,
  datasheet_url      TEXT,
  image_url          TEXT,
  source             TEXT,
  source_id          TEXT,
  price_unit         TEXT,
  last_sync_at       TEXT
);

CREATE TABLE IF NOT EXISTS contracts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id     INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  property_id     INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  interval_months INTEGER NOT NULL DEFAULT 12,
  next_due        TEXT NOT NULL,
  price           REAL NOT NULL DEFAULT 0,
  tasks           TEXT DEFAULT '[]',
  active          INTEGER NOT NULL DEFAULT 1,
  last_order_id   INTEGER,
  notes           TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  number         TEXT UNIQUE,
  doc_type       TEXT NOT NULL DEFAULT 'auftrag',
  customer_id    INTEGER NOT NULL REFERENCES customers(id),
  property_id    INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'neu',
  priority       TEXT NOT NULL DEFAULT 'normal',
  employee_id    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  scheduled_date TEXT,
  labor_hours    REAL NOT NULL DEFAULT 0,
  labor_rate     REAL NOT NULL DEFAULT 0,
  tax_rate       REAL NOT NULL DEFAULT 19,
  internal_note  TEXT,
  contract_id    INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at   TEXT,
  invoiced_at    TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'material',
  article_id  INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity    REAL NOT NULL DEFAULT 1,
  unit        TEXT DEFAULT 'Stk',
  unit_price  REAL NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS appointments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  start_at    TEXT NOT NULL,
  end_at      TEXT NOT NULL,
  notes       TEXT,
  status      TEXT NOT NULL DEFAULT 'geplant'
);

CREATE TABLE IF NOT EXISTS invoices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  number         TEXT UNIQUE,
  order_id       INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  customer_id    INTEGER NOT NULL REFERENCES customers(id),
  property_id    INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  date           TEXT NOT NULL,
  due_date       TEXT NOT NULL,
  service_date   TEXT,
  status         TEXT NOT NULL DEFAULT 'offen',
  tax_rate       REAL NOT NULL DEFAULT 19,
  subtotal       REAL NOT NULL DEFAULT 0,
  tax_total      REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL DEFAULT 0,
  paid_total     REAL NOT NULL DEFAULT 0,
  dunning_level  INTEGER NOT NULL DEFAULT 0,
  dunning_date   TEXT,
  notes          TEXT,
  pdf_path       TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'material',
  article_id  INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity    REAL NOT NULL DEFAULT 1,
  unit        TEXT DEFAULT 'Stk',
  unit_price  REAL NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  amount     REAL NOT NULL,
  method     TEXT DEFAULT 'Überweisung',
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS catalog_imports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,
  supplier    TEXT,
  filename    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  user_id     INTEGER,
  total       INTEGER NOT NULL DEFAULT 0,
  created     INTEGER NOT NULL DEFAULT 0,
  updated     INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0,
  errors      INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'ok',
  details     TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  quantity   REAL NOT NULL,
  reason     TEXT NOT NULL,
  ref_type   TEXT,
  ref_id     INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL DEFAULT (datetime('now')),
  type    TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'monteur',
  employee_id   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  ip         TEXT
);

CREATE TABLE IF NOT EXISTS time_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  order_id    INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  start_at    TEXT NOT NULL,
  end_at      TEXT,
  type        TEXT NOT NULL DEFAULT 'arbeit',
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- GPS-Zeiterfassung: nur die Übergänge (Betreten/Verlassen) werden protokolliert,
-- kein dauerhafter Standortverlauf.
CREATE TABLE IF NOT EXISTS geo_time_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
  employee_id   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL,
  order_id      INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  latitude      REAL NOT NULL,
  longitude     REAL NOT NULL,
  accuracy      REAL,
  distance_m    REAL,
  radius_m      REAL,
  time_entry_id INTEGER REFERENCES time_entries(id) ON DELETE SET NULL,
  message       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type        TEXT NOT NULL DEFAULT 'montage',
  content     TEXT NOT NULL DEFAULT '',
  weather     TEXT,
  hours       REAL NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'entwurf',
  applied_at  TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS report_materials (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id   INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  article_id  INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity    REAL NOT NULL DEFAULT 1,
  unit        TEXT DEFAULT 'Stk',
  source      TEXT DEFAULT 'manuell',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  report_id   INTEGER REFERENCES reports(id) ON DELETE SET NULL,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL DEFAULT 'sonstiges',
  filename    TEXT NOT NULL,
  caption     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- DMS / GoBD-Ablage: Dateien liegen unter data/ablage, Metadaten hier.
CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  order_id      INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  invoice_id    INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  report_id     INTEGER REFERENCES reports(id) ON DELETE SET NULL,
  category      TEXT NOT NULL DEFAULT 'sonstiges',
  title         TEXT NOT NULL,
  filename      TEXT NOT NULL,
  original_name TEXT,
  mime          TEXT,
  size          INTEGER NOT NULL DEFAULT 0,
  sha256        TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  parent_id     INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  note          TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);

CREATE TABLE IF NOT EXISTS document_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  detail      TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Plantafel: Personal, Fahrzeuge, Werkzeuge und Maschinen.
CREATE TABLE IF NOT EXISTS resources (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'fahrzeug',
  identifier TEXT,
  capacity   REAL NOT NULL DEFAULT 1,
  color      TEXT DEFAULT '#0f766e',
  active     INTEGER NOT NULL DEFAULT 1,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resource_bookings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  start_at    TEXT NOT NULL,
  end_at      TEXT NOT NULL,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'geplant',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Personal: Urlaub, Abwesenheiten, Arbeitszeitkonten.
CREATE TABLE IF NOT EXISTS absences (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'urlaub',
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  days         REAL NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'beantragt',
  note         TEXT,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_adjustments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  minutes     INTEGER NOT NULL DEFAULT 0,
  type        TEXT NOT NULL DEFAULT 'korrektur',
  note        TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vacation_entitlements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL,
  days        REAL NOT NULL DEFAULT 30,
  note        TEXT,
  UNIQUE (employee_id, year)
);

-- Finanzen: Bankabgleich und SEPA.
CREATE TABLE IF NOT EXISTS bank_transactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL,
  amount       REAL NOT NULL,
  purpose      TEXT,
  counterparty TEXT,
  iban         TEXT,
  reference    TEXT,
  invoice_id   INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'offen',
  batch        TEXT,
  imported_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  imported_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Aufmaß, Unterschrift, Checklisten und Bautagebuch.
CREATE TABLE IF NOT EXISTS measurements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  room        TEXT,
  category    TEXT NOT NULL DEFAULT 'allgemein',
  description TEXT NOT NULL,
  length      REAL NOT NULL DEFAULT 0,
  width       REAL NOT NULL DEFAULT 0,
  height      REAL NOT NULL DEFAULT 0,
  count       REAL NOT NULL DEFAULT 1,
  factor      REAL NOT NULL DEFAULT 1,
  unit        TEXT NOT NULL DEFAULT 'm²',
  quantity    REAL NOT NULL DEFAULT 0,
  note        TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS signatures (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  report_id     INTEGER REFERENCES reports(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  image_path    TEXT NOT NULL,
  sha256        TEXT,
  note          TEXT,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ip            TEXT,
  signed_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checklist_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  trade      TEXT,
  items      TEXT NOT NULL DEFAULT '[]',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_checklists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES checklist_templates(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checklist_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_id INTEGER NOT NULL REFERENCES order_checklists(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  checked      INTEGER NOT NULL DEFAULT 0,
  note         TEXT,
  sort         INTEGER NOT NULL DEFAULT 0,
  checked_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  checked_at   TEXT
);

CREATE TABLE IF NOT EXISTS site_diary (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  weather     TEXT,
  temperature TEXT,
  personnel   TEXT,
  work_done   TEXT NOT NULL DEFAULT '',
  material    TEXT,
  incidents   TEXT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lager: Inventur und Scan.
CREATE TABLE IF NOT EXISTS inventory_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'offen',
  note       TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at  TEXT
);

CREATE TABLE IF NOT EXISTS inventory_counts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   INTEGER NOT NULL REFERENCES inventory_sessions(id) ON DELETE CASCADE,
  article_id   INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  system_qty   REAL NOT NULL DEFAULT 0,
  counted_qty  REAL NOT NULL DEFAULT 0,
  diff         REAL NOT NULL DEFAULT 0,
  note         TEXT,
  counted_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  counted_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, article_id)
);

-- Schnittstellen: Webhooks.
CREATE TABLE IF NOT EXISTS webhooks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  url        TEXT NOT NULL,
  events     TEXT NOT NULL DEFAULT '[]',
  secret     TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_status INTEGER,
  last_at    TEXT
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event      TEXT NOT NULL,
  status     INTEGER,
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_notes_customer ON customer_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_documents_customer ON documents(customer_id);
CREATE INDEX IF NOT EXISTS idx_documents_order ON documents(order_id);
CREATE INDEX IF NOT EXISTS idx_documents_invoice ON documents(invoice_id);
CREATE INDEX IF NOT EXISTS idx_document_events_doc ON document_events(document_id);
CREATE INDEX IF NOT EXISTS idx_resource_bookings_start ON resource_bookings(start_at);
CREATE INDEX IF NOT EXISTS idx_absences_employee ON absences(employee_id);
CREATE INDEX IF NOT EXISTS idx_absences_dates ON absences(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_invoice ON bank_transactions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_measurements_order ON measurements(order_id);
CREATE INDEX IF NOT EXISTS idx_signatures_order ON signatures(order_id);
CREATE INDEX IF NOT EXISTS idx_checklists_order ON order_checklists(order_id);
CREATE INDEX IF NOT EXISTS idx_diary_order ON site_diary(order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_counts_session ON inventory_counts(session_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_at);
CREATE INDEX IF NOT EXISTS idx_properties_customer ON properties(customer_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_time_employee ON time_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_order ON time_entries(order_id);
CREATE INDEX IF NOT EXISTS idx_geo_events_user ON geo_time_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_geo_events_order ON geo_time_events(order_id);
CREATE INDEX IF NOT EXISTS idx_reports_order ON reports(order_id);
CREATE INDEX IF NOT EXISTS idx_reports_employee ON reports(employee_id);
CREATE INDEX IF NOT EXISTS idx_photos_order ON photos(order_id);
CREATE INDEX IF NOT EXISTS idx_catalog_imports_created ON catalog_imports(created_at);
`;

db.exec(SCHEMA);

// Sanfte Migration für bestehende Datenbanken
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('invoices', 'service_date', 'TEXT');
// Terminbestätigung per Link: Kunde bestätigt oder lehnt einen Termin ab.
ensureColumn('appointments', 'confirm_token', 'TEXT');
ensureColumn('appointments', 'confirmed_at', 'TEXT');
ensureColumn('appointments', 'declined_at', 'TEXT');
ensureColumn('appointments', 'customer_reply', 'TEXT');
// Terminart, Ort und optionaler Kunde (für Kundenbesuche/Meetings ohne Auftrag)
ensureColumn('appointments', 'kind', "TEXT NOT NULL DEFAULT 'baustelle'");
ensureColumn('appointments', 'customer_id', 'INTEGER');
ensureColumn('appointments', 'location', 'TEXT');
ensureColumn('appointments', 'mail_sent_at', 'TEXT');
ensureColumn('users', 'must_change_password', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('articles', 'gtin', 'TEXT');
ensureColumn('articles', 'manufacturer', 'TEXT');
ensureColumn('articles', 'manufacturer_number', 'TEXT');
ensureColumn('articles', 'etim_class', 'TEXT');
ensureColumn('articles', 'datasheet_url', 'TEXT');
ensureColumn('articles', 'image_url', 'TEXT');
ensureColumn('articles', 'source', 'TEXT');
ensureColumn('articles', 'source_id', 'TEXT');
ensureColumn('articles', 'price_unit', 'TEXT');
ensureColumn('articles', 'last_sync_at', 'TEXT');
// E-Rechnung, DMS und Stammdaten
ensureColumn('customers', 'leitweg_id', 'TEXT');
ensureColumn('customers', 'iban', 'TEXT');
ensureColumn('customers', 'bic', 'TEXT');
ensureColumn('customers', 'sepa_mandate', 'TEXT');
ensureColumn('customers', 'sepa_mandate_date', 'TEXT');
ensureColumn('customers', 'payment_terms_days', 'INTEGER');
ensureColumn('invoices', 'buyer_reference', 'TEXT');
ensureColumn('invoices', 'einvoice_format', 'TEXT');
ensureColumn('invoices', 'einvoice_status', "TEXT NOT NULL DEFAULT 'entwurf'");
ensureColumn('invoices', 'einvoice_at', 'TEXT');
// Kalkulation und Nachkalkulation
ensureColumn('orders', 'calc_wage_rate', 'REAL');
ensureColumn('orders', 'calc_overhead_pct', 'REAL');
ensureColumn('orders', 'calc_profit_pct', 'REAL');
ensureColumn('orders', 'calc_discount_pct', 'REAL');
ensureColumn('orders', 'calc_mode', "TEXT NOT NULL DEFAULT 'summe'");
ensureColumn('order_items', 'cost_wage', 'REAL');
ensureColumn('order_items', 'cost_material', 'REAL');
ensureColumn('order_items', 'cost_equipment', 'REAL');
ensureColumn('order_items', 'cost_other', 'REAL');
ensureColumn('order_items', 'calc_note', 'TEXT');
// Personal
ensureColumn('employees', 'weekly_hours', 'REAL');
ensureColumn('employees', 'vacation_days', 'REAL');
ensureColumn('employees', 'entry_date', 'TEXT');
ensureColumn('employees', 'exit_date', 'TEXT');
ensureColumn('time_adjustments', 'created_by', 'INTEGER');
// GPS-Zeiterfassung: Einwilligung/Einstellung je Benutzer, Standorte je Mitarbeiter/Objekt.
ensureColumn('users', 'geo_time_enabled', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'geo_radius_m', 'INTEGER NOT NULL DEFAULT 150');
ensureColumn('users', 'geo_consent_at', 'TEXT');
ensureColumn('employees', 'home_street', 'TEXT');
ensureColumn('employees', 'home_zip', 'TEXT');
ensureColumn('employees', 'home_city', 'TEXT');
ensureColumn('employees', 'home_lat', 'REAL');
ensureColumn('employees', 'home_lng', 'REAL');
ensureColumn('employees', 'home_geo_at', 'TEXT');
ensureColumn('properties', 'latitude', 'REAL');
ensureColumn('properties', 'longitude', 'REAL');
ensureColumn('properties', 'geo_at', 'TEXT');
ensureColumn('time_entries', 'source', "TEXT NOT NULL DEFAULT 'manuell'");
// Standort-Ereignisse werden nur für die Nachvollziehbarkeit der Zeiten benötigt.
db.exec("DELETE FROM geo_time_events WHERE created_at < datetime('now', '-180 days');");
// Lager
ensureColumn('articles', 'barcode', 'TEXT');
ensureColumn('articles', 'location', 'TEXT');
// Index erst nach der Migration: bestehende Datenbanken haben die Spalte noch nicht.
db.exec('CREATE INDEX IF NOT EXISTS idx_articles_gtin ON articles(gtin);');
db.exec('CREATE INDEX IF NOT EXISTS idx_articles_barcode ON articles(barcode);');
db.exec('CREATE INDEX IF NOT EXISTS idx_customers_leitweg ON customers(leitweg_id);');

// Sitzungen aus der Zeit vor der Token-Hashing-Umstellung sind ungültig.
db.exec("DELETE FROM sessions WHERE length(id) != 64;");
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_token
  ON appointments(confirm_token) WHERE confirm_token IS NOT NULL;`);

export const DEFAULT_SETTINGS = {
  app_name: 'HandwerkPro',
  trade: 'Gas & Wasser',
  trade_tagline: 'Gas- und Wasserinstallation · Heizungstechnik',
  company_name: 'Möller Gas & Wasser GmbH',
  company_owner: 'Stefan Möller',
  company_street: 'Industriestraße 14',
  company_zip: '40210',
  company_city: 'Düsseldorf',
  company_phone: '0211 555 12 30',
  company_mobile: '0172 555 12 30',
  company_email: 'info@moeller-gaswasser.de',
  company_web: 'www.moeller-gaswasser.de',
  smtp_host: '',
  smtp_port: '587',
  smtp_secure: '0',
  smtp_user: '',
  smtp_password: '',
  smtp_from: '',
  smtp_from_name: '',
  public_url: '',
  demo_mode: '1',
  mail_notify_replies: '1',
  tax_number: '106/5812/3456',
  vat_id: 'DE123456789',
  register_court: 'Amtsgericht Düsseldorf',
  register_number: 'HRB 12345',
  bank_name: 'Commerzbank Düsseldorf',
  iban: 'DE89 3704 0044 0532 0130 00',
  bic: 'COBADEFFXXX',
  default_tax_rate: '19',
  default_labor_rate: '68',
  payment_days: '14',
  invoice_prefix: 'RE',
  order_prefix: 'AU',
  quote_prefix: 'AN',
  customer_prefix: 'KD',
  invoice_intro: 'für die von uns ausgeführten Arbeiten berechnen wir Ihnen wie nachstehend aufgeführt:',
  invoice_footer: 'Zahlbar ohne Abzug innerhalb von {days} Tagen bis zum {due}. Es gelten unsere Allgemeinen Geschäftsbedingungen.',
  auto_create_orders: '1',
  auto_invoice: '1',
  auto_dunning: '1',
  dunning_days: '30',
  dunning_fee: '5',
  small_business: '0',

  // Material & Datenquellen – alles optional, standardmäßig aus.
  mat_markup_default: '30',
  mat_import_update_prices: '1',
  mat_import_keep_sale_price: '1',
  mat_import_update_stock: '0',
  mat_allow_http: '0',
  mat_datanorm_enabled: '0',
  mat_datanorm_supplier: '',
  mat_bmecat_enabled: '0',
  mat_bmecat_supplier: '',
  mat_csv_enabled: '0',
  mat_csv_supplier: '',
  mat_csv_delimiter: ';',
  mat_icecat_enabled: '0',
  mat_icecat_shopname: 'openicecat-live',
  mat_icecat_api_token: '',
  mat_icecat_content_token: '',
  mat_icecat_lang: 'DE',
  mat_etim_enabled: '0',
  mat_etim_client_id: '',
  mat_etim_client_secret: '',
  mat_etim_language: 'de-DE',
  mat_upcitemdb_enabled: '0',
  mat_upcitemdb_key: '',
  mat_upcitemdb_trial: '1',
  mat_gs1_enabled: '1',
  mat_dealer_enabled: '0',
  mat_dealer_name: '',
  mat_dealer_base_url: '',
  mat_dealer_auth_type: 'none',
  mat_dealer_auth_user: '',
  mat_dealer_auth_secret: '',
  mat_dealer_auth_header: 'X-API-Key',
  mat_dealer_search_path: '/api/articles?q={query}',
  mat_dealer_article_path: '/api/articles/{article}',
  mat_dealer_results_path: '',
  mat_dealer_map_number: 'number',
  mat_dealer_map_name: 'name',
  mat_dealer_map_price: 'purchase_price',
  mat_dealer_map_currency: 'currency',
  mat_dealer_map_unit: 'unit',
  mat_dealer_map_manufacturer: 'manufacturer',
  mat_dealer_map_gtin: 'gtin',
  mat_dealer_map_stock: 'stock',
  mat_dealer_map_datasheet: 'datasheet_url',
  mat_dealer_map_image: 'image_url',
  mat_ids_enabled: '0',
  mat_ids_shop_url: '',
  mat_ids_supplier: '',
  mat_ids_search_path: '/search?q={article}',

  // E-Rechnung (XRechnung/ZUGFeRD)
  einvoice_format: 'xrechnung',
  einvoice_seller_contact: 'Stefan Möller',
  einvoice_seller_phone: '',
  einvoice_seller_email: '',
  einvoice_payment_means: '58',
  einvoice_note: 'Es gelten unsere Allgemeinen Geschäftsbedingungen.',
  // Kalkulation
  default_calc_wage_rate: '42',
  default_calc_overhead_pct: '8',
  default_calc_profit_pct: '12',
  default_calc_discount_pct: '0',
  // Personal
  hr_weekly_hours: '40',
  hr_vacation_days: '30',
  // Finanzen
  sepa_creditor_id: '',
  datev_consultant: '12345',
  datev_client: '1',
  datev_account_revenue: '8400',
  datev_account_receivable: '10000',
  datev_account_bank: '1200',
};

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function setSettings(patch) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    stmt.run(key, value == null ? '' : String(value));
  }
  return getSettings();
}

export function nextNumber(scope, prefix) {
  const year = new Date().getFullYear();
  const row = db.prepare('SELECT value FROM counters WHERE scope = ? AND year = ?').get(scope, year);
  const value = (row?.value ?? 0) + 1;
  db.prepare(
    `INSERT INTO counters (scope, year, value) VALUES (?, ?, ?)
     ON CONFLICT(scope, year) DO UPDATE SET value = excluded.value`
  ).run(scope, year, value);
  return `${prefix}-${year}-${String(value).padStart(4, '0')}`;
}

export function logActivity(type, message) {
  db.prepare('INSERT INTO activity (type, message) VALUES (?, ?)').run(type, message);
}

export const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addMonths(isoDate, months) {
  const date = new Date(`${isoDate}T12:00:00`);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + Number(months));
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

export function invoiceTotals(items, taxRate) {
  let subtotal = 0;
  for (const item of items) {
    subtotal += round2(Number(item.quantity) * Number(item.unit_price));
  }
  subtotal = round2(subtotal);
  const tax = round2((subtotal * Number(taxRate)) / 100);
  return { subtotal, tax, total: round2(subtotal + tax) };
}

if (db.prepare('SELECT COUNT(*) AS n FROM customers').get().n === 0) {
  seedDemoData();
}

seedUsersIfEmpty();
seedOperationsIfEmpty();
// Büro und HR als Mitarbeiter anlegen, damit sie ebenfalls Termine haben können.
ensureOfficeStaff();
