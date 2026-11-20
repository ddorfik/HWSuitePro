import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { db, DATA_DIR, logActivity } from './db.js';

const ARCHIVE_DIR = join(DATA_DIR, 'ablage');
mkdirSync(ARCHIVE_DIR, { recursive: true });

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export const DOCUMENT_CATEGORIES = {
  rechnung: 'Rechnung',
  angebot: 'Angebot',
  auftrag: 'Auftrag',
  aufmass: 'Aufmaß',
  foto: 'Foto',
  protokoll: 'Protokoll',
  vertrag: 'Vertrag',
  lieferschein: 'Lieferschein',
  eingangsrechnung: 'Eingangsrechnung',
  steuer: 'Steuer / Buchhaltung',
  sonstiges: 'Sonstiges',
};

const ALLOWED_EXT = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.xml', '.csv', '.txt', '.eml',
  '.docx', '.xlsx', '.odt', '.ods', '.zip',
]);

function sniff(buffer) {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 6).toString('latin1') === 'GIF87a' || buffer.subarray(0, 6).toString('latin1') === 'GIF89a') return 'image/gif';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'application/zip';
  return null;
}

function looksLikeMarkup(buffer) {
  const head = buffer.subarray(0, 2048).toString('utf8').trim().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<svg')
    || head.startsWith('<script') || head.includes('<script');
}

function safeExtension(originalName, mime) {
  const raw = extname(String(originalName || '')).toLowerCase();
  if (ALLOWED_EXT.has(raw)) return raw;
  const byMime = {
    'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg',
    'image/webp': '.webp', 'image/gif': '.gif', 'text/xml': '.xml',
    'application/xml': '.xml', 'text/csv': '.csv', 'text/plain': '.txt',
    'application/zip': '.zip', 'message/rfc822': '.eml',
  };
  return byMime[mime] || '.bin';
}

export function logDocumentEvent(documentId, userId, action, detail = '', ip = '') {
  db.prepare(
    'INSERT INTO document_events (document_id, user_id, action, detail, ip) VALUES (?,?,?,?,?)'
  ).run(documentId, userId ?? null, action, String(detail).slice(0, 500), String(ip || '').slice(0, 200));
}

export function storeDocument({
  buffer, originalName = '', mime = '', title = '', category = 'sonstiges',
  customerId = null, orderId = null, invoiceId = null, reportId = null,
  note = '', userId = null, parentId = null, ip = '',
}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Die Datei ist leer');
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new Error('Die Datei ist zu groß (maximal 25 MB)');
  if (looksLikeMarkup(buffer)) throw new Error('HTML- und SVG-Dateien werden aus Sicherheitsgründen nicht archiviert');

  const detected = sniff(buffer);
  if (!detected && buffer.includes(0)) throw new Error('Dieser Dateityp wird nicht unterstützt');
  const effectiveMime = detected || String(mime || 'text/plain').split(';')[0];
  const extension = safeExtension(originalName, effectiveMime);
  if (extension === '.bin') throw new Error('Dieser Dateityp wird nicht unterstützt');

  let version = 1;
  let rootId = null;
  if (parentId) {
    const parent = db.prepare('SELECT * FROM documents WHERE id = ?').get(parentId);
    if (!parent) throw new Error('Vorversion nicht gefunden');
    rootId = parent.parent_id || parent.id;
    version = Number(parent.version || 1) + 1;
  }

  const filename = `${Date.now().toString(36)}-${randomBytes(10).toString('hex')}${extension}`;
  writeFileSync(join(ARCHIVE_DIR, filename), buffer, { mode: 0o600 });
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  const id = Number(db.prepare(
    `INSERT INTO documents (customer_id, order_id, invoice_id, report_id, category, title, filename,
       original_name, mime, size, sha256, version, parent_id, note, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    customerId ? Number(customerId) : null,
    orderId ? Number(orderId) : null,
    invoiceId ? Number(invoiceId) : null,
    reportId ? Number(reportId) : null,
    DOCUMENT_CATEGORIES[category] ? category : 'sonstiges',
    String(title || originalName || 'Dokument').slice(0, 300),
    filename,
    String(originalName || '').slice(0, 300),
    effectiveMime,
    buffer.length,
    sha256,
    version,
    parentId ? Number(parentId) : null,
    String(note || '').slice(0, 2000),
    userId ?? null,
  ).lastInsertRowid);

  logDocumentEvent(id, userId, version > 1 ? 'version' : 'upload', `${title || originalName} (${buffer.length} Bytes)`, ip);
  logActivity('dokument', `${version > 1 ? 'Neue Version' : 'Dokument'} „${title || originalName}" archiviert.`);
  if (rootId) return { ...db.prepare('SELECT * FROM documents WHERE id = ?').get(id), root_id: rootId };
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
}

export function storeFromDataUrl(dataUrl, meta = {}) {
  const match = /^data:([a-z0-9.+/-]+);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!match) throw new Error('Ungültige Datei');
  return storeDocument({ ...meta, mime: match[1], buffer: Buffer.from(match[2], 'base64') });
}

export function documentRow(id) {
  return db.prepare(
    `SELECT d.*, c.company, c.first_name, c.last_name, o.number AS order_number,
       i.number AS invoice_number, u.name AS user_name
     FROM documents d
     LEFT JOIN customers c ON c.id = d.customer_id
     LEFT JOIN orders o ON o.id = d.order_id
     LEFT JOIN invoices i ON i.id = d.invoice_id
     LEFT JOIN users u ON u.id = d.created_by
     WHERE d.id = ?`
  ).get(id);
}

export function documentFilePath(row) {
  if (!row?.filename) return null;
  const target = normalize(join(ARCHIVE_DIR, row.filename));
  if (!target.startsWith(ARCHIVE_DIR + sep)) return null;
  return existsSync(target) ? target : null;
}

export function listDocuments({ customerId = null, orderId = null, invoiceId = null, category = '', q = '', includeDeleted = false } = {}) {
  const clauses = [];
  const values = [];
  if (!includeDeleted) clauses.push('d.deleted_at IS NULL');
  if (customerId) { clauses.push('d.customer_id = ?'); values.push(Number(customerId)); }
  if (orderId) { clauses.push('d.order_id = ?'); values.push(Number(orderId)); }
  if (invoiceId) { clauses.push('d.invoice_id = ?'); values.push(Number(invoiceId)); }
  if (category) { clauses.push('d.category = ?'); values.push(String(category)); }
  const needle = `%${String(q || '').trim()}%`;
  if (q) {
    clauses.push('(d.title LIKE ? OR d.original_name LIKE ? OR d.note LIKE ? OR c.company LIKE ? OR c.last_name LIKE ? OR o.number LIKE ?)');
    values.push(needle, needle, needle, needle, needle, needle);
  }
  return db.prepare(
    `SELECT d.*, c.company, c.first_name, c.last_name, o.number AS order_number,
       i.number AS invoice_number, u.name AS user_name
     FROM documents d
     LEFT JOIN customers c ON c.id = d.customer_id
     LEFT JOIN orders o ON o.id = d.order_id
     LEFT JOIN invoices i ON i.id = d.invoice_id
     LEFT JOIN users u ON u.id = d.created_by
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY d.created_at DESC, d.id DESC LIMIT 500`
  ).all(...values);
}

export function documentVersions(id) {
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  if (!row) return [];
  let root = row;
  const seen = new Set();
  while (root.parent_id && !seen.has(root.id)) {
    seen.add(root.id);
    const parent = db.prepare('SELECT * FROM documents WHERE id = ?').get(root.parent_id);
    if (!parent) break;
    root = parent;
  }
  return db.prepare(
    `SELECT d.*, u.name AS user_name FROM documents d
     LEFT JOIN users u ON u.id = d.created_by
     WHERE d.id = ? OR d.parent_id = ?
     ORDER BY d.version, d.id`
  ).all(root.id, root.id);
}

export function documentEvents(id) {
  return db.prepare(
    `SELECT e.*, u.name AS user_name FROM document_events e
     LEFT JOIN users u ON u.id = e.user_id
     WHERE e.document_id = ? ORDER BY e.id DESC`
  ).all(id);
}

export function softDeleteDocument(id, userId, ip = '') {
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare("UPDATE documents SET deleted_at = datetime('now') WHERE id = ?").run(id);
  logDocumentEvent(id, userId, 'gelöscht', 'Datei bleibt GoBD-konform im Archiv', ip);
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
}

export function archiveInvoicePdf(invoice, buffer, userId = null) {
  if (!invoice || !buffer) return null;
  const existing = db.prepare(
    "SELECT id FROM documents WHERE invoice_id = ? AND category = 'rechnung' AND deleted_at IS NULL"
  ).get(invoice.id);
  if (existing) return db.prepare('SELECT * FROM documents WHERE id = ?').get(existing.id);
  return storeDocument({
    buffer,
    originalName: `${invoice.number}.pdf`,
    mime: 'application/pdf',
    title: `Rechnung ${invoice.number}`,
    category: 'rechnung',
    customerId: invoice.customer_id,
    orderId: invoice.order_id,
    invoiceId: invoice.id,
    note: 'Automatisch beim Erzeugen archiviert',
    userId,
  });
}

export function readDocument(row) {
  const path = documentFilePath(row);
  return path ? readFileSync(path) : null;
}
