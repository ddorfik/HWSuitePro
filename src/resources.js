import { db, addDays, todayISO } from './db.js';
import { ABSENCE_STATUS, ABSENCE_TYPES } from './hr.js';

export const RESOURCE_TYPES = {
  fahrzeug: 'Fahrzeug',
  werkzeug: 'Werkzeug',
  maschine: 'Maschine',
  sonstiges: 'Sonstiges',
};

export function listResources({ activeOnly = false } = {}) {
  return db.prepare(
    `SELECT r.*, (SELECT COUNT(*) FROM resource_bookings b WHERE b.resource_id = r.id) AS booking_count
     FROM resources r ${activeOnly ? 'WHERE r.active = 1' : ''}
     ORDER BY r.active DESC, r.type, r.name`
  ).all().map((row) => ({ ...row, type_label: RESOURCE_TYPES[row.type] || row.type }));
}

export function createResource(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Bitte einen Namen angeben');
  const id = Number(db.prepare(
    `INSERT INTO resources (name, type, identifier, capacity, color, active, notes)
     VALUES (?,?,?,?,?,?,?)`
  ).run(
    name.slice(0, 200),
    RESOURCE_TYPES[input.type] ? input.type : 'fahrzeug',
    String(input.identifier || '').slice(0, 200),
    Math.max(1, Number(input.capacity) || 1),
    String(input.color || '#0f766e').slice(0, 20),
    input.active === 0 || input.active === '0' ? 0 : 1,
    String(input.notes || '').slice(0, 2000),
  ).lastInsertRowid);
  return db.prepare('SELECT * FROM resources WHERE id = ?').get(id);
}

export function updateResource(id, input = {}) {
  const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(id);
  if (!row) throw new Error('Ressource nicht gefunden');
  const fields = [];
  const values = [];
  const set = (column, value) => { fields.push(`${column} = ?`); values.push(value); };
  if ('name' in input) set('name', String(input.name || row.name).slice(0, 200));
  if ('type' in input) set('type', RESOURCE_TYPES[input.type] ? input.type : row.type);
  if ('identifier' in input) set('identifier', String(input.identifier || '').slice(0, 200));
  if ('capacity' in input) set('capacity', Math.max(1, Number(input.capacity) || 1));
  if ('color' in input) set('color', String(input.color || row.color).slice(0, 20));
  if ('active' in input) set('active', input.active === 0 || input.active === '0' || input.active === false ? 0 : 1);
  if ('notes' in input) set('notes', String(input.notes || '').slice(0, 2000));
  if (fields.length) db.prepare(`UPDATE resources SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  return db.prepare('SELECT * FROM resources WHERE id = ?').get(id);
}

export function deleteResource(id) {
  const used = db.prepare('SELECT COUNT(*) AS n FROM resource_bookings WHERE resource_id = ?').get(id).n;
  if (used > 0) {
    db.prepare('UPDATE resources SET active = 0 WHERE id = ?').run(id);
    return { ok: true, deactivated: true };
  }
  db.prepare('DELETE FROM resources WHERE id = ?').run(id);
  return { ok: true };
}

export function overlappingBookings(resourceId, startAt, endAt, excludeId = null) {
  return db.prepare(
    `SELECT b.*, o.number AS order_number, o.title AS order_title, e.name AS employee_name
     FROM resource_bookings b
     LEFT JOIN orders o ON o.id = b.order_id
     LEFT JOIN employees e ON e.id = b.employee_id
     WHERE b.resource_id = ? AND b.status != 'storniert'
       AND datetime(b.start_at) < datetime(?) AND datetime(b.end_at) > datetime(?)
       ${excludeId ? 'AND b.id != ?' : ''}
     ORDER BY b.start_at`
  ).all(...(excludeId ? [resourceId, endAt, startAt, excludeId] : [resourceId, endAt, startAt]));
}

export function createBooking(input = {}) {
  const resourceId = Number(input.resource_id);
  if (!resourceId) throw new Error('Bitte eine Ressource auswählen');
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
  if (!resource) throw new Error('Ressource nicht gefunden');
  const startAt = String(input.start_at || '');
  const endAt = String(input.end_at || '');
  if (!startAt || !endAt) throw new Error('Bitte Start und Ende angeben');
  if (new Date(endAt) <= new Date(startAt)) throw new Error('Das Ende muss nach dem Start liegen');
  const conflicts = overlappingBookings(resourceId, startAt, endAt);
  if (conflicts.length >= Number(resource.capacity || 1)) {
    const first = conflicts[0];
    throw new Error(`${resource.name} ist in diesem Zeitraum bereits eingeplant${first?.order_number ? ` (${first.order_number})` : ''}`);
  }
  const id = Number(db.prepare(
    `INSERT INTO resource_bookings (resource_id, order_id, employee_id, start_at, end_at, note, status)
     VALUES (?,?,?,?,?,?,?)`
  ).run(
    resourceId,
    input.order_id ? Number(input.order_id) : null,
    input.employee_id ? Number(input.employee_id) : null,
    startAt, endAt,
    String(input.note || '').slice(0, 1000),
    ['geplant', 'bestaetigt', 'storniert'].includes(input.status) ? input.status : 'geplant',
  ).lastInsertRowid);
  return db.prepare('SELECT * FROM resource_bookings WHERE id = ?').get(id);
}

export function updateBooking(id, input = {}) {
  const row = db.prepare('SELECT * FROM resource_bookings WHERE id = ?').get(id);
  if (!row) throw new Error('Buchung nicht gefunden');
  const resourceId = input.resource_id ? Number(input.resource_id) : row.resource_id;
  const startAt = input.start_at ? String(input.start_at) : row.start_at;
  const endAt = input.end_at ? String(input.end_at) : row.end_at;
  if (new Date(endAt) <= new Date(startAt)) throw new Error('Das Ende muss nach dem Start liegen');
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
  const conflicts = overlappingBookings(resourceId, startAt, endAt, id);
  if (conflicts.length >= Number(resource?.capacity || 1)) {
    throw new Error(`${resource?.name || 'Ressource'} ist in diesem Zeitraum bereits eingeplant`);
  }
  db.prepare(
    `UPDATE resource_bookings SET resource_id = ?, order_id = ?, employee_id = ?, start_at = ?,
       end_at = ?, note = ?, status = ? WHERE id = ?`
  ).run(
    resourceId,
    input.order_id === undefined ? row.order_id : (input.order_id ? Number(input.order_id) : null),
    input.employee_id === undefined ? row.employee_id : (input.employee_id ? Number(input.employee_id) : null),
    startAt, endAt,
    input.note === undefined ? row.note : String(input.note || '').slice(0, 1000),
    ['geplant', 'bestaetigt', 'storniert'].includes(input.status) ? input.status : row.status,
    id,
  );
  return db.prepare('SELECT * FROM resource_bookings WHERE id = ?').get(id);
}

export function deleteBooking(id) {
  db.prepare('DELETE FROM resource_bookings WHERE id = ?').run(id);
  return { ok: true };
}

export function planningBoard({ from = '', to = '' } = {}) {
  const start = String(from || addDays(todayISO(), -7)).slice(0, 10);
  const end = String(to || addDays(todayISO(), 28)).slice(0, 10);
  const employees = db.prepare(
    'SELECT id, name, role, color, weekly_hours, active FROM employees WHERE active = 1 ORDER BY name'
  ).all();
  const absences = db.prepare(
    `SELECT a.*, e.name AS employee_name, e.color AS employee_color FROM absences a
     JOIN employees e ON e.id = a.employee_id
     WHERE a.status IN ('beantragt', 'genehmigt') AND a.start_date <= ? AND a.end_date >= ?
     ORDER BY a.status DESC, a.start_date`
  ).all(end, start).map((row) => ({
    ...row,
    type_label: ABSENCE_TYPES[row.type] || row.type,
    status_label: ABSENCE_STATUS[row.status] || row.status,
  }));
  const appointments = db.prepare(
    `SELECT a.*, e.name AS employee_name, e.color AS employee_color,
       o.number AS order_number, o.title AS order_title, c.company, c.first_name, c.last_name,
       p.label AS property_label
     FROM appointments a
     LEFT JOIN employees e ON e.id = a.employee_id
     LEFT JOIN orders o ON o.id = a.order_id
     LEFT JOIN customers c ON c.id = COALESCE(o.customer_id, a.customer_id)
     LEFT JOIN properties p ON p.id = o.property_id
     WHERE date(a.start_at) BETWEEN date(?) AND date(?)
     ORDER BY a.start_at`
  ).all(start, end);
  const bookings = db.prepare(
    `SELECT b.*, r.name AS resource_name, r.type AS resource_type, r.color AS resource_color,
       o.number AS order_number, o.title AS order_title, e.name AS employee_name
     FROM resource_bookings b
     JOIN resources r ON r.id = b.resource_id
     LEFT JOIN orders o ON o.id = b.order_id
     LEFT JOIN employees e ON e.id = b.employee_id
     WHERE date(b.start_at) <= date(?) AND date(b.end_at) >= date(?)
     ORDER BY b.start_at`
  ).all(end, start);
  return {
    from: start,
    to: end,
    employees,
    absences,
    appointments,
    bookings,
    resources: listResources({ activeOnly: true }),
  };
}
