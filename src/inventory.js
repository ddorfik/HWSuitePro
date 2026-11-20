import { db, round2, todayISO } from './db.js';
import { adjustStock } from './billing.js';

export function lookupArticleByCode(code) {
  const value = String(code || '').trim();
  if (!value) return null;
  return db.prepare(
    `SELECT * FROM articles WHERE gtin = ? OR barcode = ? OR number = ? OR manufacturer_number = ?
     ORDER BY active DESC LIMIT 1`
  ).get(value, value, value, value) || null;
}

export function listInventorySessions() {
  return db.prepare(
    `SELECT s.*, u.name AS user_name,
       (SELECT COUNT(*) FROM inventory_counts c WHERE c.session_id = s.id) AS counted,
       (SELECT COUNT(*) FROM articles a WHERE a.active = 1) AS articles
     FROM inventory_sessions s
     LEFT JOIN users u ON u.id = s.created_by
     ORDER BY s.created_at DESC, s.id DESC`
  ).all();
}

export function createInventorySession({ name = '', note = '', userId = null } = {}) {
  const id = Number(db.prepare(
    'INSERT INTO inventory_sessions (name, note, created_by) VALUES (?,?,?)'
  ).run(String(name || `Inventur ${todayISO()}`).slice(0, 200), String(note || '').slice(0, 1000), userId ?? null).lastInsertRowid);
  return db.prepare('SELECT * FROM inventory_sessions WHERE id = ?').get(id);
}

export function inventorySession(id) {
  const session = db.prepare('SELECT * FROM inventory_sessions WHERE id = ?').get(id);
  if (!session) return null;
  const counts = db.prepare(
    `SELECT c.*, a.number, a.name, a.unit, a.category, a.stock AS current_stock,
       a.purchase_price, u.name AS user_name
     FROM inventory_counts c
     JOIN articles a ON a.id = c.article_id
     LEFT JOIN users u ON u.id = c.counted_by
     WHERE c.session_id = ? ORDER BY a.category, a.name`
  ).all(id);
  const articles = db.prepare(
    'SELECT id, number, name, unit, category, stock, min_stock, location, barcode, gtin FROM articles WHERE active = 1 ORDER BY category, name'
  ).all();
  return {
    session,
    counts,
    articles,
    stats: {
      counted: counts.length,
      total: articles.length,
      differences: counts.filter((row) => Math.abs(Number(row.diff)) > 0.0001).length,
      value_diff: round2(counts.reduce((sum, row) => sum + Number(row.diff) * Number(row.purchase_price || 0), 0)),
    },
  };
}

export function saveInventoryCount(sessionId, { articleId = null, code = '', counted = 0, note = '' } = {}, userId = null) {
  const session = db.prepare('SELECT * FROM inventory_sessions WHERE id = ?').get(sessionId);
  if (!session) throw new Error('Inventur nicht gefunden');
  if (session.status !== 'offen') throw new Error('Diese Inventur ist bereits abgeschlossen');
  const article = articleId
    ? db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId)
    : lookupArticleByCode(code);
  if (!article) throw new Error('Artikel nicht gefunden');
  const value = Number(counted);
  if (!Number.isFinite(value) || value < 0) throw new Error('Bitte eine gültige Menge zählen');
  const systemQty = Number(article.stock);
  const diff = round2(value - systemQty);
  db.prepare(
    `INSERT INTO inventory_counts (session_id, article_id, system_qty, counted_qty, diff, note, counted_by)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(session_id, article_id) DO UPDATE SET
       system_qty = excluded.system_qty, counted_qty = excluded.counted_qty,
       diff = excluded.diff, note = excluded.note, counted_by = excluded.counted_by,
       counted_at = datetime('now')`
  ).run(sessionId, article.id, systemQty, value, diff, String(note || '').slice(0, 1000), userId ?? null);
  return inventorySession(sessionId);
}

export function closeInventorySession(sessionId, userId = null) {
  const session = db.prepare('SELECT * FROM inventory_sessions WHERE id = ?').get(sessionId);
  if (!session) throw new Error('Inventur nicht gefunden');
  if (session.status !== 'offen') throw new Error('Diese Inventur ist bereits abgeschlossen');
  const counts = db.prepare('SELECT * FROM inventory_counts WHERE session_id = ?').all(sessionId);
  db.exec('BEGIN');
  try {
    for (const count of counts) {
      if (Math.abs(Number(count.diff)) < 0.0001) continue;
      adjustStock(count.article_id, Number(count.diff), `Inventurdifferenz ${session.name}`, 'inventory', sessionId);
    }
    db.prepare("UPDATE inventory_sessions SET status = 'abgeschlossen', closed_at = datetime('now') WHERE id = ?")
      .run(sessionId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return inventorySession(sessionId);
}

export function deleteInventorySession(sessionId) {
  const session = db.prepare('SELECT * FROM inventory_sessions WHERE id = ?').get(sessionId);
  if (!session) throw new Error('Inventur nicht gefunden');
  if (session.status !== 'offen') throw new Error('Abgeschlossene Inventuren bleiben aus Nachvollziehbarkeitsgründen erhalten');
  db.prepare('DELETE FROM inventory_sessions WHERE id = ?').run(sessionId);
  return { ok: true };
}
