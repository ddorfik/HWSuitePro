import { db, logActivity } from './db.js';
import { can } from './permissions.js';

/* Zusammenarbeit: Aufgaben, Nachrichten, Benachrichtigungen und Feed. */

export const TASK_STATUS = { offen: 'Offen', erledigt: 'Erledigt' };
export const TASK_PRIORITIES = { niedrig: 'Niedrig', normal: 'Normal', hoch: 'Hoch' };

const str = (value) => (value == null ? '' : String(value).trim());

export function createNotification(userId, { kind = 'info', title, body = '', link = null } = {}) {
  if (!userId || !str(title)) return null;
  const id = Number(db.prepare(
    `INSERT INTO notifications (user_id, kind, title, body, link) VALUES (?,?,?,?,?)`
  ).run(userId, kind, str(title).slice(0, 200), str(body).slice(0, 1000), link).lastInsertRowid);
  return db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
}

export function notifyEmployee(employeeId, payload = {}, excludeUserId = null) {
  if (!employeeId) return 0;
  const users = db.prepare('SELECT id FROM users WHERE employee_id = ? AND active = 1').all(employeeId);
  let count = 0;
  for (const user of users) {
    if (excludeUserId && user.id === excludeUserId) continue;
    createNotification(user.id, payload);
    count += 1;
  }
  return count;
}

export function notifyManagers(payload = {}, excludeUserId = null) {
  const users = db.prepare("SELECT id, role FROM users WHERE active = 1 AND role IN ('chef','vorgesetzt','buero')").all();
  for (const user of users) {
    if (excludeUserId && user.id === excludeUserId) continue;
    createNotification(user.id, payload);
  }
}

export function listNotifications(user, { unreadOnly = false, limit = 30 } = {}) {
  const clauses = ['user_id = ?'];
  if (unreadOnly) clauses.push('read_at IS NULL');
  return db.prepare(
    `SELECT * FROM notifications WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT ?`
  ).all(user.id, Math.min(100, Math.max(1, Number(limit) || 30)));
}

export function unreadNotificationCount(user) {
  return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(user.id).n;
}

export function markNotificationsRead(user, ids = null) {
  if (Array.isArray(ids) && ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(
      `UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND id IN (${placeholders}) AND read_at IS NULL`
    ).run(user.id, ...ids.map(Number));
  } else {
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(user.id);
  }
  return { unread: unreadNotificationCount(user) };
}

/* ------------------------------------------------------------------ Aufgaben */
function taskRows(where = '', values = []) {
  return db.prepare(
    `SELECT t.*, o.number AS order_number, o.title AS order_title,
       e.name AS employee_name, u.name AS created_by_name
     FROM tasks t
     LEFT JOIN orders o ON o.id = t.order_id
     LEFT JOIN employees e ON e.id = t.employee_id
     LEFT JOIN users u ON u.id = t.created_by
     ${where}
     ORDER BY CASE t.status WHEN 'offen' THEN 0 ELSE 1 END,
       COALESCE(t.due_date, '9999-12-31'), t.id DESC`
  ).all(...values).map((row) => ({
    ...row,
    status_label: TASK_STATUS[row.status] || row.status,
    priority_label: TASK_PRIORITIES[row.priority] || row.priority,
    overdue: Boolean(row.due_date && row.status === 'offen' && row.due_date < new Date().toISOString().slice(0, 10)),
  }));
}

export function listTasks(user, { status = '', orderId = null, employeeId = null } = {}) {
  const clauses = [];
  const values = [];
  if (!can(user, 'tasks.manage')) {
    clauses.push('t.employee_id = ?');
    values.push(user.employee_id ?? -1);
  } else if (employeeId) {
    clauses.push('t.employee_id = ?');
    values.push(Number(employeeId));
  }
  if (status) { clauses.push('t.status = ?'); values.push(status); }
  if (orderId) { clauses.push('t.order_id = ?'); values.push(Number(orderId)); }
  return taskRows(clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values);
}

export function createTask(user, input = {}) {
  const title = str(input.title);
  if (!title) throw new Error('Bitte einen Titel für die Aufgabe angeben');
  const employeeId = input.employee_id ? Number(input.employee_id) : (user.employee_id ?? null);
  const id = Number(db.prepare(
    `INSERT INTO tasks (title, description, order_id, employee_id, created_by, due_date, priority, status)
     VALUES (?,?,?,?,?,?,?, 'offen')`
  ).run(
    title.slice(0, 200),
    str(input.description).slice(0, 2000),
    input.order_id ? Number(input.order_id) : null,
    employeeId,
    user.id,
    str(input.due_date) || null,
    TASK_PRIORITIES[input.priority] ? input.priority : 'normal',
  ).lastInsertRowid);
  const task = taskRows('WHERE t.id = ?', [id])[0];
  if (employeeId && employeeId !== user.employee_id) {
    notifyEmployee(employeeId, {
      kind: 'task',
      title: 'Neue Aufgabe',
      body: title,
      link: '#/tasks',
    }, user.id);
  }
  logActivity('aufgabe', `Aufgabe „${title}“ angelegt${task.employee_name ? ` für ${task.employee_name}` : ''}.`);
  return task;
}

export function updateTask(user, id, input = {}) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id));
  if (!task) throw new Error('Aufgabe nicht gefunden');
  if (!can(user, 'tasks.manage') && task.employee_id !== user.employee_id) {
    throw new Error('Diese Aufgabe gehört nicht zu deinem Konto');
  }
  const status = input.status
    ? (TASK_STATUS[input.status] ? input.status : task.status)
    : task.status;
  const employeeId = input.employee_id !== undefined
    ? (input.employee_id ? Number(input.employee_id) : null)
    : task.employee_id;
  db.prepare(
    `UPDATE tasks SET title = ?, description = ?, order_id = ?, employee_id = ?, due_date = ?,
       priority = ?, status = ?, done_at = CASE WHEN ? = 'erledigt' THEN COALESCE(done_at, datetime('now')) ELSE NULL END
     WHERE id = ?`
  ).run(
    str(input.title ?? task.title).slice(0, 200) || task.title,
    str(input.description ?? task.description).slice(0, 2000),
    input.order_id !== undefined ? (input.order_id ? Number(input.order_id) : null) : task.order_id,
    employeeId,
    input.due_date !== undefined ? (str(input.due_date) || null) : task.due_date,
    TASK_PRIORITIES[input.priority] ? input.priority : task.priority,
    status,
    status,
    task.id,
  );
  if (employeeId && employeeId !== task.employee_id) {
    notifyEmployee(employeeId, { kind: 'task', title: 'Neue Aufgabe', body: task.title, link: '#/tasks' }, user.id);
  }
  return taskRows('WHERE t.id = ?', [task.id])[0];
}

export function setTaskDone(user, id, done = true) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id));
  if (!task) throw new Error('Aufgabe nicht gefunden');
  if (!can(user, 'tasks.complete') && !can(user, 'tasks.manage')) {
    throw new Error('Du darfst keine Aufgaben erledigen');
  }
  if (!can(user, 'tasks.manage') && task.employee_id !== user.employee_id) {
    throw new Error('Diese Aufgabe gehört nicht zu deinem Konto');
  }
  db.prepare(
    `UPDATE tasks SET status = ?, done_at = CASE WHEN ? THEN datetime('now') ELSE NULL END WHERE id = ?`
  ).run(done ? 'erledigt' : 'offen', done ? 1 : 0, task.id);
  if (done && task.created_by && task.created_by !== user.id) {
    createNotification(task.created_by, {
      kind: 'task',
      title: 'Aufgabe erledigt',
      body: task.title,
      link: '#/tasks',
    });
  }
  return taskRows('WHERE t.id = ?', [task.id])[0];
}

export function deleteTask(user, id) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(id));
  if (!task) throw new Error('Aufgabe nicht gefunden');
  if (!can(user, 'tasks.manage')) throw new Error('Du darfst keine Aufgaben löschen');
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  return { ok: true };
}

/* --------------------------------------------------------------- Nachrichten */
export function listMessages(user, { orderId = null, limit = 50 } = {}) {
  const clauses = [orderId ? 'm.order_id = ?' : 'm.order_id IS NULL'];
  const values = orderId ? [Number(orderId)] : [];
  const rows = db.prepare(
    `SELECT m.*, u.name AS user_name, e.name AS employee_name
     FROM messages m
     LEFT JOIN users u ON u.id = m.user_id
     LEFT JOIN employees e ON e.id = m.employee_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY m.id DESC LIMIT ?`
  ).all(...values, Math.min(200, Math.max(1, Number(limit) || 50)));
  return rows.reverse();
}

export function postMessage(user, { orderId = null, body } = {}) {
  const text = str(body);
  if (!text) throw new Error('Bitte eine Nachricht eingeben');
  const order = orderId ? db.prepare('SELECT id, number, employee_id, title FROM orders WHERE id = ?').get(Number(orderId)) : null;
  if (orderId && !order) throw new Error('Auftrag nicht gefunden');
  const id = Number(db.prepare(
    `INSERT INTO messages (order_id, user_id, employee_id, body) VALUES (?,?,?,?)`
  ).run(order?.id ?? null, user.id, user.employee_id ?? null, text.slice(0, 4000)).lastInsertRowid);
  if (order?.employee_id) {
    notifyEmployee(order.employee_id, {
      kind: 'message',
      title: `Neue Nachricht zu ${order.number}`,
      body: text.slice(0, 160),
      link: '#/orders',
    }, user.id);
  }
  const row = db.prepare(
    `SELECT m.*, u.name AS user_name FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?`
  ).get(id);
  return row;
}

/* --------------------------------------------------------------------- Feed */
export function activityFeed(limit = 30) {
  return db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT ?')
    .all(Math.min(100, Math.max(1, Number(limit) || 30)));
}
