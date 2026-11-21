import { randomBytes } from 'node:crypto';
import {
  db, getSettings, nextNumber, todayISO, logActivity,
} from './db.js';
import { notifyManagers, createNotification } from './collab.js';

/* CRM: Anfragen/Leads mit Pipeline und öffentlichem Anfrageformular.
 * Kundenportal: tokenisierter Lesezugriff auf Termine, Aufträge und Rechnungen.
 */

const str = (value) => (value == null ? '' : String(value).trim());
const SOURCE_LABELS = {
  website: 'Website',
  aroundhome: 'Aroundhome',
  taptaphome: 'TapTapHome',
  telefon: 'Telefon',
  empfehlung: 'Empfehlung',
  sonstiges: 'Sonstiges',
};
export const LEAD_SOURCES = SOURCE_LABELS;

export function leadStages() {
  return db.prepare('SELECT * FROM lead_stages ORDER BY sort, id').all();
}

export function createLeadStage(input = {}) {
  const name = str(input.name);
  if (!name) throw new Error('Bitte einen Namen für die Stufe angeben');
  const sort = Number(input.sort) || (Number(db.prepare('SELECT MAX(sort) AS s FROM lead_stages').get().s) + 10);
  const id = Number(db.prepare('INSERT INTO lead_stages (name, sort, closed) VALUES (?,?,?)')
    .run(name.slice(0, 80), sort, input.closed ? 1 : 0).lastInsertRowid);
  return db.prepare('SELECT * FROM lead_stages WHERE id = ?').get(id);
}

export function updateLeadStage(id, input = {}) {
  const stage = db.prepare('SELECT * FROM lead_stages WHERE id = ?').get(Number(id));
  if (!stage) throw new Error('Stufe nicht gefunden');
  db.prepare('UPDATE lead_stages SET name = ?, sort = ?, closed = ? WHERE id = ?').run(
    str(input.name ?? stage.name).slice(0, 80) || stage.name,
    input.sort !== undefined ? Number(input.sort) : stage.sort,
    input.closed !== undefined ? (input.closed ? 1 : 0) : stage.closed,
    stage.id,
  );
  return db.prepare('SELECT * FROM lead_stages WHERE id = ?').get(stage.id);
}

export function deleteLeadStage(id) {
  const stage = db.prepare('SELECT * FROM lead_stages WHERE id = ?').get(Number(id));
  if (!stage) throw new Error('Stufe nicht gefunden');
  const fallback = db.prepare('SELECT id FROM lead_stages WHERE id != ? ORDER BY sort, id LIMIT 1').get(stage.id);
  db.prepare('UPDATE leads SET stage_id = ? WHERE stage_id = ?').run(fallback?.id ?? null, stage.id);
  db.prepare('DELETE FROM lead_stages WHERE id = ?').run(stage.id);
  return { ok: true };
}

function leadRows(where = '', values = []) {
  return db.prepare(
    `SELECT l.*, s.name AS stage_name, s.closed AS stage_closed,
       c.company AS customer_company, c.last_name AS customer_last_name
     FROM leads l
     LEFT JOIN lead_stages s ON s.id = l.stage_id
     LEFT JOIN customers c ON c.id = l.customer_id
     ${where}
     ORDER BY l.id DESC`
  ).all(...values).map((row) => ({
    ...row,
    source_label: SOURCE_LABELS[row.source] || row.source,
  }));
}

export function listLeads({ stageId = null, q = '', limit = 200 } = {}) {
  const clauses = [];
  const values = [];
  if (stageId) { clauses.push('l.stage_id = ?'); values.push(Number(stageId)); }
  if (str(q)) {
    clauses.push('(l.name LIKE ? OR l.company LIKE ? OR l.email LIKE ? OR l.phone LIKE ? OR l.message LIKE ?)');
    const term = `%${str(q)}%`;
    values.push(term, term, term, term, term);
  }
  return leadRows(clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values).slice(0, limit);
}

export function getLead(id) {
  return leadRows('WHERE l.id = ?', [Number(id)])[0] ?? null;
}

function defaultStageId() {
  return db.prepare('SELECT id FROM lead_stages WHERE closed = 0 ORDER BY sort, id LIMIT 1').get()?.id ?? null;
}

export function createLead(input = {}, { notify = true } = {}) {
  const name = str(input.name);
  if (!name) throw new Error('Bitte einen Namen angeben');
  const email = str(input.email);
  const phone = str(input.phone);
  if (!email && !phone) throw new Error('Bitte E-Mail oder Telefon angeben');
  const source = SOURCE_LABELS[input.source] ? input.source : 'website';
  const stageId = Number(input.stage_id) || defaultStageId();
  const id = Number(db.prepare(
    `INSERT INTO leads (name, company, email, phone, message, source, stage_id, value, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    name.slice(0, 160), str(input.company).slice(0, 160), email.slice(0, 160), phone.slice(0, 60),
    str(input.message).slice(0, 4000), source, stageId, Number(input.value) || 0,
    str(input.notes).slice(0, 2000),
  ).lastInsertRowid);
  if (notify) {
    notifyManagers({
      kind: 'lead',
      title: 'Neue Anfrage',
      body: `${name}${input.company ? ` · ${str(input.company)}` : ''} (${SOURCE_LABELS[source]})`,
      link: '#/leads',
    });
  }
  logActivity('anfrage', `Neue Anfrage von ${name} (${SOURCE_LABELS[source]}).`);
  return getLead(id);
}

export function updateLead(id, input = {}) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(id));
  if (!lead) throw new Error('Anfrage nicht gefunden');
  const stageId = input.stage_id !== undefined
    ? (input.stage_id ? Number(input.stage_id) : null)
    : lead.stage_id;
  db.prepare(
    `UPDATE leads SET name = ?, company = ?, email = ?, phone = ?, message = ?, stage_id = ?,
       value = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(
    str(input.name ?? lead.name).slice(0, 160) || lead.name,
    str(input.company ?? lead.company).slice(0, 160),
    str(input.email ?? lead.email).slice(0, 160),
    str(input.phone ?? lead.phone).slice(0, 60),
    str(input.message ?? lead.message).slice(0, 4000),
    stageId,
    input.value !== undefined ? Number(input.value) || 0 : lead.value,
    str(input.notes ?? lead.notes).slice(0, 2000),
    lead.id,
  );
  return getLead(lead.id);
}

export function deleteLead(id) {
  db.prepare('DELETE FROM leads WHERE id = ?').run(Number(id));
  return { ok: true };
}

export function convertLead(id, user) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(id));
  if (!lead) throw new Error('Anfrage nicht gefunden');
  if (lead.customer_id) return { customer_id: lead.customer_id, created: false };
  const settings = getSettings();
  const number = nextNumber('customer', settings.customer_prefix);
  const parts = str(lead.name).split(/\s+/);
  const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '';
  const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
  const customerId = Number(db.prepare(
    `INSERT INTO customers (number, type, company, first_name, last_name, email, phone, notes)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    number, lead.company ? 'firma' : 'privat', str(lead.company), firstName, lastName,
    str(lead.email), str(lead.phone), `Aus Anfrage #${lead.id} (${SOURCE_LABELS[lead.source] || lead.source})`,
  ).lastInsertRowid);
  const won = db.prepare('SELECT id FROM lead_stages WHERE closed = 1 ORDER BY sort LIMIT 1').get();
  db.prepare('UPDATE leads SET customer_id = ?, stage_id = COALESCE(?, stage_id), updated_at = datetime(\'now\') WHERE id = ?')
    .run(customerId, won?.id ?? null, lead.id);
  logActivity('kunde', `Anfrage von ${lead.name} in Kunde ${number} umgewandelt.`);
  return { customer_id: customerId, customer_number: number, created: true, lead: getLead(lead.id) };
}

export function publicLeadIntake(token, input = {}) {
  const expected = str(getSettings().lead_token);
  if (!expected || token !== expected) {
    const error = new Error('Anfrageformular ist nicht freigeschaltet');
    error.status = 404;
    throw error;
  }
  // Öffentliche Eingaben auf die sichtbaren Formularfelder begrenzen.
  return createLead({
    name: input.name,
    company: input.company,
    email: input.email,
    phone: input.phone,
    message: input.message,
    source: 'website',
  });
}

/* --------------------------------------------------------------- Kundenportal */
export function ensurePortalToken(customerId) {
  const customer = db.prepare('SELECT id, portal_token FROM customers WHERE id = ?').get(Number(customerId));
  if (!customer) throw new Error('Kunde nicht gefunden');
  let token = customer.portal_token;
  if (!token) {
    token = randomBytes(24).toString('hex');
    db.prepare('UPDATE customers SET portal_token = ? WHERE id = ?').run(token, customer.id);
  }
  return token;
}

export function revokePortalToken(customerId) {
  db.prepare('UPDATE customers SET portal_token = NULL WHERE id = ?').run(Number(customerId));
  return { ok: true };
}

function portalCustomer(token) {
  return db.prepare(
    `SELECT id, number, company, first_name, last_name, email, phone, street, zip, city
     FROM customers WHERE portal_token = ? AND portal_token IS NOT NULL`
  ).get(str(token));
}

export function portalData(token) {
  const customer = portalCustomer(token);
  if (!customer) return null;
  const today = todayISO();
  const appointments = db.prepare(
    `SELECT id, title, start_at, end_at, kind, location, confirmed_at, declined_at, customer_reply
     FROM appointments
     WHERE customer_id = ? AND date(start_at) >= date(?)
     ORDER BY start_at LIMIT 20`
  ).all(customer.id, today);
  const orders = db.prepare(
    `SELECT id, number, title, status, scheduled_date, created_at
     FROM orders
     WHERE customer_id = ? AND doc_type = 'auftrag' AND status != 'storniert'
     ORDER BY id DESC LIMIT 30`
  ).all(customer.id);
  const invoices = db.prepare(
    `SELECT id, number, date, due_date, status, total, paid_total
     FROM invoices
     WHERE customer_id = ? AND status != 'storniert'
     ORDER BY id DESC LIMIT 30`
  ).all(customer.id).map((row) => ({
    ...row,
    open_amount: Math.round((Number(row.total) - Number(row.paid_total)) * 100) / 100,
  }));
  const documents = db.prepare(
    `SELECT d.id, d.title, d.category, d.created_at FROM documents d
     WHERE d.deleted_at IS NULL AND (
       d.customer_id = ? OR d.order_id IN (SELECT id FROM orders WHERE customer_id = ?)
     )
     ORDER BY d.id DESC LIMIT 20`
  ).all(customer.id, customer.id);
  return {
    customer: {
      id: customer.id,
      name: customer.company || `${customer.first_name} ${customer.last_name}`.trim(),
      number: customer.number,
      email: customer.email,
      phone: customer.phone,
      address: [customer.street, `${customer.zip || ''} ${customer.city || ''}`.trim()].filter(Boolean).join(', '),
    },
    appointments,
    orders,
    invoices,
    documents,
    can_pay_online: false,
  };
}

export function portalPdfInvoice(token, invoiceId) {
  const customer = portalCustomer(token);
  if (!customer) return null;
  const invoice = db.prepare(
    "SELECT * FROM invoices WHERE id = ? AND customer_id = ? AND status != 'storniert'"
  ).get(Number(invoiceId), customer.id);
  return invoice ?? null;
}

export function portalMessage(token, input = {}) {
  const customer = portalCustomer(token);
  if (!customer) return null;
  const text = str(input.body);
  if (!text) throw new Error('Bitte eine Nachricht eingeben');
  db.prepare('INSERT INTO customer_notes (customer_id, user_id, text) VALUES (?, NULL, ?)')
    .run(customer.id, `Kundenportal: ${text.slice(0, 4000)}`);
  notifyManagers({
    kind: 'portal',
    title: 'Nachricht aus dem Kundenportal',
    body: `${customer.company || `${customer.first_name} ${customer.last_name}`}: ${text.slice(0, 160)}`,
    link: '#/customers',
  });
  return { ok: true };
}

export function notifyAppointmentConfirmed(appointment) {
  if (!appointment?.customer_id) return;
  const users = db.prepare("SELECT id FROM users WHERE active = 1 AND role IN ('chef','vorgesetzt','buero')").all();
  for (const user of users) {
    createNotification(user.id, {
      kind: 'termin',
      title: appointment.declined_at ? 'Termin abgelehnt' : 'Termin bestätigt',
      body: `${appointment.title} · ${String(appointment.start_at).slice(0, 16).replace('T', ' ')}`,
      link: '#/planning',
    });
  }
}

