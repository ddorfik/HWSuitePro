import { db, getSettings, addDays, round2, todayISO } from './db.js';

export const ABSENCE_TYPES = {
  urlaub: 'Urlaub',
  krank: 'Krankheit',
  schule: 'Schule / Ausbildung',
  fortbildung: 'Fortbildung',
  unbezahlt: 'Unbezahlt',
  elternzeit: 'Elternzeit',
  sonstiges: 'Sonstiges',
};

export const ABSENCE_STATUS = {
  beantragt: 'Beantragt',
  genehmigt: 'Genehmigt',
  abgelehnt: 'Abgelehnt',
};

const isoDate = (value) => String(value || '').slice(0, 10);
const atNoon = (iso) => new Date(`${isoDate(iso)}T12:00:00`);

export function workdays(start, end) {
  const from = atNoon(start);
  const to = atNoon(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return 0;
  let count = 0;
  const cursor = new Date(from);
  let guard = 0;
  while (cursor <= to && guard < 2000) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return count;
}

export function listAbsences({ employeeId = null, year = null, status = '', from = '', to = '' } = {}) {
  const clauses = [];
  const values = [];
  if (employeeId) { clauses.push('a.employee_id = ?'); values.push(Number(employeeId)); }
  if (year) {
    clauses.push("a.start_date <= ? AND a.end_date >= ?");
    values.push(`${Number(year)}-12-31`, `${Number(year)}-01-01`);
  }
  if (status) { clauses.push('a.status = ?'); values.push(String(status)); }
  if (from) { clauses.push('a.end_date >= ?'); values.push(isoDate(from)); }
  if (to) { clauses.push('a.start_date <= ?'); values.push(isoDate(to)); }
  return db.prepare(
    `SELECT a.*, e.name AS employee_name, e.color AS employee_color,
       u.name AS requested_by_name, d.name AS decided_by_name
     FROM absences a
     JOIN employees e ON e.id = a.employee_id
     LEFT JOIN users u ON u.id = a.requested_by
     LEFT JOIN users d ON d.id = a.decided_by
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY a.start_date DESC, a.id DESC`
  ).all(...values).map((row) => ({
    ...row,
    type_label: ABSENCE_TYPES[row.type] || row.type,
    status_label: ABSENCE_STATUS[row.status] || row.status,
  }));
}

export function createAbsence(input = {}, userId = null) {
  const employeeId = Number(input.employee_id);
  if (!employeeId) throw new Error('Bitte einen Mitarbeiter auswählen');
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!employee) throw new Error('Mitarbeiter nicht gefunden');
  const start = isoDate(input.start_date);
  const end = isoDate(input.end_date) || start;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error('Bitte gültige Von-/Bis-Daten angeben');
  }
  if (end < start) throw new Error('Das Ende darf nicht vor dem Beginn liegen');
  if (workdays(start, end) > 366) throw new Error('Der Zeitraum ist zu lang');
  const type = ABSENCE_TYPES[input.type] ? input.type : 'urlaub';
  const status = ['genehmigt', 'abgelehnt'].includes(input.status) && userId ? input.status : 'beantragt';
  const days = Number(input.days) > 0 ? Number(input.days) : workdays(start, end);
  const id = Number(db.prepare(
    `INSERT INTO absences (employee_id, type, start_date, end_date, days, status, note, requested_by,
       decided_by, decided_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    employeeId, type, start, end, days, status,
    String(input.note || '').slice(0, 2000), userId,
    status === 'beantragt' ? null : userId,
    status === 'beantragt' ? null : new Date().toISOString(),
  ).lastInsertRowid);
  return db.prepare('SELECT * FROM absences WHERE id = ?').get(id);
}

export function decideAbsence(id, status, userId) {
  if (!['genehmigt', 'abgelehnt'].includes(status)) throw new Error('Ungültiger Status');
  const row = db.prepare('SELECT * FROM absences WHERE id = ?').get(id);
  if (!row) throw new Error('Antrag nicht gefunden');
  db.prepare("UPDATE absences SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?")
    .run(status, userId ?? null, id);
  return db.prepare('SELECT * FROM absences WHERE id = ?').get(id);
}

export function deleteAbsence(id) {
  db.prepare('DELETE FROM absences WHERE id = ?').run(id);
  return { ok: true };
}

export function vacationAccount(employeeId, year = new Date().getFullYear()) {
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!employee) return null;
  const settings = getSettings();
  const entitlement = db.prepare(
    'SELECT * FROM vacation_entitlements WHERE employee_id = ? AND year = ?'
  ).get(employeeId, Number(year));
  const entitled = round2(Number(
    entitlement?.days ?? employee.vacation_days ?? settings.hr_vacation_days ?? 30
  ));
  const rows = db.prepare(
    "SELECT * FROM absences WHERE employee_id = ? AND type = 'urlaub' AND start_date <= ? AND end_date >= ?"
  ).all(employeeId, `${Number(year)}-12-31`, `${Number(year)}-01-01`);
  const approved = round2(rows.filter((row) => row.status === 'genehmigt').reduce((sum, row) => sum + Number(row.days), 0));
  const pending = round2(rows.filter((row) => row.status === 'beantragt').reduce((sum, row) => sum + Number(row.days), 0));
  return {
    employee_id: Number(employeeId),
    employee_name: employee.name,
    year: Number(year),
    entitled,
    approved,
    pending,
    remaining: round2(entitled - approved),
    available: round2(entitled - approved - pending),
    source: entitlement ? 'individuell' : 'Standard',
    note: entitlement?.note || '',
  };
}

export function setVacationEntitlement(employeeId, year, days, note = '') {
  db.prepare(
    `INSERT INTO vacation_entitlements (employee_id, year, days, note) VALUES (?,?,?,?)
     ON CONFLICT(employee_id, year) DO UPDATE SET days = excluded.days, note = excluded.note`
  ).run(Number(employeeId), Number(year), round2(Number(days) || 0), String(note || '').slice(0, 500));
  return vacationAccount(employeeId, year);
}

function mondayOf(date) {
  const cursor = new Date(date);
  const day = cursor.getDay();
  cursor.setDate(cursor.getDate() - (day === 0 ? 6 : day - 1));
  return cursor;
}

export function overtimeAccount(employeeId, { from = '', to = '' } = {}) {
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!employee) return null;
  const settings = getSettings();
  const weeklyHours = Number(employee.weekly_hours ?? settings.hr_weekly_hours ?? 40) || 0;
  const rangeFrom = isoDate(from) || `${new Date().getFullYear()}-01-01`;
  const rangeTo = isoDate(to) || todayISO();
  if (rangeTo < rangeFrom) return { weeks: [], balance_minutes: 0 };

  const rows = db.prepare(
    `SELECT date(start_at) AS day,
       COALESCE(SUM((julianday(COALESCE(end_at, datetime('now'))) - julianday(start_at)) * 24 * 60), 0) AS minutes
     FROM time_entries
     WHERE employee_id = ? AND type = 'arbeit' AND date(start_at) BETWEEN date(?) AND date(?)
     GROUP BY date(start_at)`
  ).all(employeeId, rangeFrom, rangeTo);
  const adjustments = db.prepare(
    'SELECT * FROM time_adjustments WHERE employee_id = ? AND date BETWEEN ? AND ?'
  ).all(employeeId, rangeFrom, rangeTo);

  const byDay = new Map(rows.map((row) => [row.day, Math.round(Number(row.minutes))]));
  const weeks = [];
  const cursor = mondayOf(atNoon(rangeFrom));
  const last = atNoon(rangeTo);
  let guard = 0;
  let balance = 0;
  while (cursor <= last && guard < 60) {
    const weekStart = cursor.toISOString().slice(0, 10);
    let minutes = 0;
    for (let index = 0; index < 7; index += 1) {
      const day = addDays(weekStart, index);
      minutes += byDay.get(day) || 0;
    }
    const adjustment = adjustments
      .filter((row) => row.date >= weekStart && row.date <= addDays(weekStart, 6))
      .reduce((sum, row) => sum + Number(row.minutes), 0);
    const target = Math.round(weeklyHours * 60);
    const diff = minutes + adjustment - target;
    balance += diff;
    weeks.push({
      week_start: weekStart,
      minutes,
      target,
      adjustment,
      diff,
      hours: round2(minutes / 60),
      diff_hours: round2(diff / 60),
    });
    cursor.setDate(cursor.getDate() + 7);
    guard += 1;
  }
  return {
    employee_id: Number(employeeId),
    employee_name: employee.name,
    weekly_hours: weeklyHours,
    from: rangeFrom,
    to: rangeTo,
    weeks,
    balance_minutes: balance,
    balance_hours: round2(balance / 60),
  };
}

export function hrOverview(year = new Date().getFullYear()) {
  const settings = getSettings();
  const employees = db.prepare('SELECT * FROM employees WHERE active = 1 ORDER BY name').all();
  return employees.map((employee) => ({
    ...employee,
    vacation: vacationAccount(employee.id, year),
    overtime: overtimeAccount(employee.id, {
      from: `${Number(year)}-01-01`,
      to: `${Number(year)}-12-31` > todayISO() ? todayISO() : `${Number(year)}-12-31`,
    }),
  })).map((employee) => ({
    id: employee.id,
    name: employee.name,
    role: employee.role,
    color: employee.color,
    weekly_hours: employee.weekly_hours ?? Number(settings.hr_weekly_hours ?? 40),
    vacation: employee.vacation,
    overtime_hours: employee.overtime.balance_hours,
    overtime_minutes: employee.overtime.balance_minutes,
  }));
}

export function listAdjustments({ employeeId = null, from = '', to = '' } = {}) {
  const clauses = [];
  const values = [];
  if (employeeId) { clauses.push('a.employee_id = ?'); values.push(Number(employeeId)); }
  if (from) { clauses.push('a.date >= ?'); values.push(isoDate(from)); }
  if (to) { clauses.push('a.date <= ?'); values.push(isoDate(to)); }
  return db.prepare(
    `SELECT a.*, e.name AS employee_name, u.name AS user_name
     FROM time_adjustments a
     JOIN employees e ON e.id = a.employee_id
     LEFT JOIN users u ON u.id = a.created_by
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY a.date DESC, a.id DESC LIMIT 500`
  ).all(...values);
}

export function createAdjustment(input = {}, userId = null) {
  const employeeId = Number(input.employee_id);
  if (!employeeId) throw new Error('Bitte einen Mitarbeiter auswählen');
  const date = isoDate(input.date) || todayISO();
  const minutes = Math.round(Number(input.minutes) || 0);
  if (!minutes) throw new Error('Bitte Minuten angeben (auch negativ möglich)');
  if (Math.abs(minutes) > 60 * 24 * 31) throw new Error('Der Wert ist zu groß');
  const id = Number(db.prepare(
    'INSERT INTO time_adjustments (employee_id, date, minutes, type, note, created_by) VALUES (?,?,?,?,?,?)'
  ).run(employeeId, date, minutes, String(input.type || 'korrektur'), String(input.note || '').slice(0, 1000), userId).lastInsertRowid);
  return db.prepare('SELECT * FROM time_adjustments WHERE id = ?').get(id);
}
