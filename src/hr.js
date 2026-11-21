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

/* ------------------------------------------------------------------ Verträge */
export const CONTRACT_KINDS = {
  unbefristet: 'Unbefristet',
  befristet: 'Befristet',
  minijob: 'Minijob',
  werkstudent: 'Werkstudent',
  ausbildung: 'Ausbildung',
  praktikum: 'Praktikum',
};

export function listContracts(employeeId = null) {
  const clauses = [];
  const values = [];
  if (employeeId) { clauses.push('c.employee_id = ?'); values.push(Number(employeeId)); }
  return db.prepare(
    `SELECT c.*, e.name AS employee_name,
       d.id AS document_ref, d.title AS document_title
     FROM employment_contracts c
     JOIN employees e ON e.id = c.employee_id
     LEFT JOIN documents d ON d.id = c.document_id
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY e.name, c.start_date DESC, c.id DESC`
  ).all(...values).map((row) => ({
    ...row,
    kind_label: CONTRACT_KINDS[row.kind] || row.kind,
    current: !row.end_date || row.end_date >= todayISO(),
  }));
}

export function createContract(input = {}) {
  const employeeId = Number(input.employee_id);
  if (!employeeId) throw new Error('Bitte einen Mitarbeiter auswählen');
  if (!db.prepare('SELECT 1 FROM employees WHERE id = ?').get(employeeId)) throw new Error('Mitarbeiter nicht gefunden');
  const start = isoDate(input.start_date) || todayISO();
  const end = isoDate(input.end_date) || null;
  if (end && end < start) throw new Error('Das Ende darf nicht vor dem Beginn liegen');
  const kind = CONTRACT_KINDS[input.kind] ? input.kind : 'unbefristet';
  const weekly = Number(input.weekly_hours ?? getSettings().hr_weekly_hours ?? 40);
  if (!Number.isFinite(weekly) || weekly < 0 || weekly > 80) throw new Error('Bitte gültige Wochenstunden angeben');
  const salary = Number(input.salary) || 0;
  if (salary < 0) throw new Error('Das Gehalt darf nicht negativ sein');
  const id = Number(db.prepare(
    `INSERT INTO employment_contracts (employee_id, kind, start_date, end_date, weekly_hours, salary, notes, document_id)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    employeeId, kind, start, end, weekly, Math.round(salary * 100) / 100,
    String(input.notes || '').slice(0, 2000),
    input.document_id ? Number(input.document_id) : null,
  ).lastInsertRowid);
  db.prepare('UPDATE employees SET weekly_hours = ? WHERE id = ?').run(weekly, employeeId);
  return listContracts(employeeId).find((row) => row.id === id);
}

export function updateContract(id, input = {}) {
  const row = db.prepare('SELECT * FROM employment_contracts WHERE id = ?').get(Number(id));
  if (!row) throw new Error('Vertrag nicht gefunden');
  const start = input.start_date !== undefined ? (isoDate(input.start_date) || row.start_date) : row.start_date;
  const end = input.end_date !== undefined ? (isoDate(input.end_date) || null) : row.end_date;
  if (end && end < start) throw new Error('Das Ende darf nicht vor dem Beginn liegen');
  const weekly = input.weekly_hours !== undefined ? Number(input.weekly_hours) : row.weekly_hours;
  if (!Number.isFinite(weekly) || weekly < 0 || weekly > 80) throw new Error('Bitte gültige Wochenstunden angeben');
  db.prepare(
    `UPDATE employment_contracts SET kind = ?, start_date = ?, end_date = ?, weekly_hours = ?, salary = ?,
       notes = ?, document_id = ? WHERE id = ?`
  ).run(
    CONTRACT_KINDS[input.kind] ? input.kind : row.kind,
    start,
    end,
    weekly,
    input.salary !== undefined ? Math.max(0, Number(input.salary) || 0) : row.salary,
    String(input.notes ?? row.notes).slice(0, 2000),
    input.document_id !== undefined ? (input.document_id ? Number(input.document_id) : null) : row.document_id,
    row.id,
  );
  db.prepare('UPDATE employees SET weekly_hours = ? WHERE id = ?').run(weekly, row.employee_id);
  return listContracts(row.employee_id).find((entry) => entry.id === row.id);
}

export function deleteContract(id) {
  db.prepare('DELETE FROM employment_contracts WHERE id = ?').run(Number(id));
  return { ok: true };
}

/* ------------------------------------------------------------ Pausenautomatik */
/** Zusätzliche Pause laut ArbZG, wenn die Automatik aktiviert ist. */
export function autoBreakMinutes(workMinutes) {
  const settings = getSettings();
  if (String(settings.break_auto) !== '1') return 0;
  const hours = Math.max(0, Number(workMinutes) || 0) / 60;
  if (hours > 9) return Math.max(0, Math.round(Number(settings.break_after_9h) || 45));
  if (hours > 6) return Math.max(0, Math.round(Number(settings.break_after_6h) || 30));
  return 0;
}

/* ------------------------------------------------------------- Zeitkategorien */
export function listTimeCategories({ includeInactive = false } = {}) {
  return db.prepare(
    `SELECT * FROM time_categories ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, id`
  ).all();
}

export function createTimeCategory(input = {}) {
  const label = String(input.label || '').trim();
  if (!label) throw new Error('Bitte eine Bezeichnung angeben');
  const key = String(input.key || label).toLowerCase()
    .replace(/[äöüß]/g, (char) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[char]))
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
    || `kategorie_${Date.now()}`;
  if (db.prepare('SELECT 1 FROM time_categories WHERE key = ?').get(key)) {
    throw new Error('Diese Kategorie existiert bereits');
  }
  const sort = Number(input.sort) || (Number(db.prepare('SELECT MAX(sort) AS s FROM time_categories').get().s) + 10);
  const id = Number(db.prepare('INSERT INTO time_categories (key, label, active, sort) VALUES (?,?,?,?)')
    .run(key, label.slice(0, 80), input.active === false ? 0 : 1, sort).lastInsertRowid);
  return db.prepare('SELECT * FROM time_categories WHERE id = ?').get(id);
}

export function updateTimeCategory(id, input = {}) {
  const row = db.prepare('SELECT * FROM time_categories WHERE id = ?').get(Number(id));
  if (!row) throw new Error('Kategorie nicht gefunden');
  db.prepare('UPDATE time_categories SET label = ?, active = ?, sort = ? WHERE id = ?').run(
    String(input.label ?? row.label).trim().slice(0, 80) || row.label,
    input.active !== undefined ? (input.active ? 1 : 0) : row.active,
    input.sort !== undefined ? Number(input.sort) || 0 : row.sort,
    row.id,
  );
  return db.prepare('SELECT * FROM time_categories WHERE id = ?').get(row.id);
}

export function deleteTimeCategory(id) {
  const row = db.prepare('SELECT * FROM time_categories WHERE id = ?').get(Number(id));
  if (!row) throw new Error('Kategorie nicht gefunden');
  const used = db.prepare('SELECT COUNT(*) AS n FROM time_entries WHERE type = ?').get(row.key).n;
  if (used) {
    db.prepare('UPDATE time_categories SET active = 0 WHERE id = ?').run(row.id);
    return { ok: true, deactivated: true, used };
  }
  db.prepare('DELETE FROM time_categories WHERE id = ?').run(row.id);
  return { ok: true, deactivated: false };
}

/* -------------------------------------------------------- Lohnvorbereitung */
const pad2 = (value) => String(value).padStart(2, '0');

export function payrollMonth(year, month) {
  const y = Number(year) || new Date().getFullYear();
  const m = Math.min(12, Math.max(1, Number(month) || (new Date().getMonth() + 1)));
  const from = `${y}-${pad2(m)}-01`;
  const to = `${y}-${pad2(m)}-${pad2(new Date(y, m, 0).getDate())}`;
  const employees = db.prepare('SELECT * FROM employees WHERE active = 1 ORDER BY name').all();
  const rows = employees.map((employee) => {
    const contract = db.prepare(
      `SELECT * FROM employment_contracts
       WHERE employee_id = ? AND (start_date IS NULL OR start_date <= ?)
         AND (end_date IS NULL OR end_date >= ?)
       ORDER BY start_date DESC, id DESC LIMIT 1`
    ).get(employee.id, to, from);
    const time = db.prepare(
      `SELECT COALESCE(SUM((julianday(COALESCE(end_at, datetime('now'))) - julianday(start_at)) * 24 * 60), 0) AS minutes,
         COALESCE(SUM(break_minutes), 0) AS break_minutes
       FROM time_entries
       WHERE employee_id = ? AND type = 'arbeit' AND date(start_at) BETWEEN date(?) AND date(?)`
    ).get(employee.id, from, to);
    const grossMinutes = Math.round(Number(time.minutes) || 0);
    const explicitBreak = Math.round(Number(time.break_minutes) || 0);
    const autoBreak = autoBreakMinutes(grossMinutes);
    const breakMinutes = Math.max(explicitBreak, autoBreak);
    const absences = db.prepare(
      `SELECT type, COALESCE(SUM(days), 0) AS days FROM absences
       WHERE employee_id = ? AND status = 'genehmigt' AND start_date <= ? AND end_date >= ?
       GROUP BY type`
    ).all(employee.id, to, from);
    const vacationDays = Number(absences.find((row) => row.type === 'urlaub')?.days) || 0;
    const sickDays = Number(absences.find((row) => row.type === 'krank')?.days) || 0;
    const weeklyHours = Number(contract?.weekly_hours ?? employee.weekly_hours ?? getSettings().hr_weekly_hours ?? 40);
    const targetMinutes = Math.round(weeklyHours * 60 * (workdays(from, to) / 5));
    return {
      employee_id: employee.id,
      employee_name: employee.name,
      role: employee.role,
      contract_id: contract?.id ?? null,
      contract_kind: contract ? (CONTRACT_KINDS[contract.kind] || contract.kind) : 'ohne Vertrag',
      weekly_hours: Number(contract?.weekly_hours ?? employee.weekly_hours ?? 0),
      salary: Number(contract?.salary ?? 0),
      gross_minutes: grossMinutes,
      break_minutes: breakMinutes,
      auto_break_minutes: autoBreak,
      net_minutes: Math.max(0, grossMinutes - breakMinutes),
      net_hours: round2(Math.max(0, grossMinutes - breakMinutes) / 60),
      target_minutes: targetMinutes,
      diff_minutes: Math.max(0, grossMinutes - breakMinutes) - targetMinutes,
      vacation_days: vacationDays,
      sick_days: sickDays,
    };
  });
  return {
    year: y, month: m, from, to,
    rows,
    totals: {
      employees: rows.length,
      net_hours: round2(rows.reduce((sum, row) => sum + row.net_hours, 0)),
      salary: round2(rows.reduce((sum, row) => sum + row.salary, 0)),
      vacation_days: round2(rows.reduce((sum, row) => sum + row.vacation_days, 0)),
      sick_days: round2(rows.reduce((sum, row) => sum + row.sick_days, 0)),
    },
  };
}

const csvCell = (value) => {
  const text = String(value ?? '');
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function payrollCsv(year, month) {
  const data = payrollMonth(year, month);
  const header = ['Mitarbeiter', 'Rolle', 'Vertrag', 'Wochenstunden', 'Gehalt', 'Brutto-Stunden', 'Pause', 'Netto-Stunden', 'Soll-Stunden', 'Differenz', 'Urlaubstage', 'Krankheitstage'];
  const lines = [header.join(';')];
  for (const row of data.rows) {
    lines.push([
      row.employee_name, row.role, row.contract_kind, row.weekly_hours, row.salary.toFixed(2),
      (row.gross_minutes / 60).toFixed(2), (row.break_minutes / 60).toFixed(2), row.net_hours.toFixed(2),
      (row.target_minutes / 60).toFixed(2), (row.diff_minutes / 60).toFixed(2),
      row.vacation_days, row.sick_days,
    ].map(csvCell).join(';'));
  }
  return {
    filename: `Lohnvorbereitung-${data.year}-${pad2(data.month)}.csv`,
    content: `\uFEFF${lines.join('\r\n')}\r\n`,
    data,
  };
}

/* ------------------------------------------------------------- Mutterschutz */
/** Mutterschutzfristen aus dem voraussichtlichen Entbindungstermin. */
export function maternityProtection(dueDate, { weeksBefore = 6, weeksAfter = 8 } = {}) {
  const due = isoDate(dueDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Bitte einen gültigen Entbindungstermin angeben');
  return {
    due_date: due,
    protection_start: addDays(due, -7 * weeksBefore),
    protection_end: addDays(due, 7 * weeksAfter),
    weeks_before: weeksBefore,
    weeks_after: weeksAfter,
    note: 'Bei Früh- oder Mehrlingsgeburten verlängert sich die Schutzfrist nach § 3 MuSchG.',
  };
}
