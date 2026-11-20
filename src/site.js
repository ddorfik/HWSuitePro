import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, DATA_DIR, round2, todayISO } from './db.js';

const SIGNATURE_DIR = join(DATA_DIR, 'unterschriften');
mkdirSync(SIGNATURE_DIR, { recursive: true });

export const MEASUREMENT_CATEGORIES = {
  flaeche: 'Fläche (L × B)',
  wand: 'Wandfläche (L × H)',
  volumen: 'Volumen (L × B × H)',
  laenge: 'Länge (L)',
  stueck: 'Stück / Anzahl',
  allgemein: 'Frei (Menge direkt)',
};

const DEFAULT_UNITS = {
  flaeche: 'm²', wand: 'm²', volumen: 'm³', laenge: 'm', stueck: 'Stk', allgemein: 'Stk',
};

export function measurementQuantity(input = {}) {
  const length = Number(input.length) || 0;
  const width = Number(input.width) || 0;
  const height = Number(input.height) || 0;
  const count = Number(input.count) || 1;
  const factor = Number(input.factor) || 1;
  const category = MEASUREMENT_CATEGORIES[input.category] ? input.category : 'allgemein';
  let base;
  if (category === 'flaeche') base = length * width;
  else if (category === 'wand') base = length * height;
  else if (category === 'volumen') base = length * width * height;
  else if (category === 'laenge') base = length;
  else if (category === 'stueck') base = count;
  else base = Number(input.quantity) || 0;
  const quantity = category === 'stueck' || category === 'allgemein'
    ? base * factor
    : base * count * factor;
  return { category, quantity: Math.round((quantity + Number.EPSILON) * 10000) / 10000 };
}

export function listMeasurements(orderId) {
  return db.prepare(
    `SELECT m.*, u.name AS user_name FROM measurements m
     LEFT JOIN users u ON u.id = m.created_by
     WHERE m.order_id = ? ORDER BY m.room, m.id`
  ).all(orderId);
}

export function createMeasurement(orderId, input = {}, userId = null) {
  const description = String(input.description || '').trim();
  if (!description) throw new Error('Bitte eine Bezeichnung angeben');
  const computed = measurementQuantity(input);
  const unit = String(input.unit || DEFAULT_UNITS[computed.category] || 'Stk').slice(0, 20);
  const id = Number(db.prepare(
    `INSERT INTO measurements (order_id, room, category, description, length, width, height, count,
       factor, unit, quantity, note, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    orderId,
    String(input.room || '').slice(0, 200),
    computed.category,
    description.slice(0, 500),
    Number(input.length) || 0,
    Number(input.width) || 0,
    Number(input.height) || 0,
    Number(input.count) || 1,
    Number(input.factor) || 1,
    unit,
    computed.quantity,
    String(input.note || '').slice(0, 1000),
    userId ?? null,
  ).lastInsertRowid);
  return db.prepare('SELECT * FROM measurements WHERE id = ?').get(id);
}

export function updateMeasurement(orderId, id, input = {}) {
  const row = db.prepare('SELECT * FROM measurements WHERE id = ? AND order_id = ?').get(id, orderId);
  if (!row) throw new Error('Aufmaßposition nicht gefunden');
  const merged = {
    category: input.category ?? row.category,
    length: input.length ?? row.length,
    width: input.width ?? row.width,
    height: input.height ?? row.height,
    count: input.count ?? row.count,
    factor: input.factor ?? row.factor,
    quantity: input.quantity ?? row.quantity,
  };
  const computed = measurementQuantity(merged);
  db.prepare(
    `UPDATE measurements SET room = ?, category = ?, description = ?, length = ?, width = ?, height = ?,
       count = ?, factor = ?, unit = ?, quantity = ?, note = ? WHERE id = ? AND order_id = ?`
  ).run(
    input.room === undefined ? row.room : String(input.room || '').slice(0, 200),
    computed.category,
    input.description === undefined ? row.description : String(input.description || row.description).slice(0, 500),
    Number(merged.length) || 0, Number(merged.width) || 0, Number(merged.height) || 0,
    Number(merged.count) || 1, Number(merged.factor) || 1,
    input.unit === undefined ? row.unit : String(input.unit || row.unit).slice(0, 20),
    computed.quantity,
    input.note === undefined ? row.note : String(input.note || '').slice(0, 1000),
    id, orderId,
  );
  return db.prepare('SELECT * FROM measurements WHERE id = ?').get(id);
}

export function deleteMeasurement(orderId, id) {
  db.prepare('DELETE FROM measurements WHERE id = ? AND order_id = ?').run(id, orderId);
  return { ok: true };
}

export function applyMeasurements(orderId, { ids = [], kind = 'material', unitPrice = 0, roomSuffix = true } = {}) {
  const rows = ids.length
    ? db.prepare(
      `SELECT * FROM measurements WHERE order_id = ? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id`
    ).all(orderId, ...ids.map(Number))
    : db.prepare('SELECT * FROM measurements WHERE order_id = ? ORDER BY id').all(orderId);
  if (!rows.length) throw new Error('Keine Aufmaßpositionen vorhanden');
  let sort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS n FROM order_items WHERE order_id = ?').get(orderId).n;
  const created = [];
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      sort += 1;
      const description = roomSuffix && row.room
        ? `${row.description} (${row.room})`
        : row.description;
      const id = Number(db.prepare(
        `INSERT INTO order_items (order_id, kind, article_id, description, quantity, unit, unit_price, sort)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(orderId, kind === 'arbeit' ? 'arbeit' : 'material', null, description.slice(0, 500),
        row.quantity, row.unit, Number(unitPrice) || 0, sort).lastInsertRowid);
      created.push(id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { created, positions: created.length };
}

/* ------------------------------------------------------------------ Unterschrift */

export function saveSignature(orderId, input = {}, { userId = null, ip = '' } = {}) {
  const dataUrl = String(input.dataUrl || '');
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) throw new Error('Bitte eine gültige Unterschrift (PNG) übermitteln');
  const buffer = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  if (!buffer.length || buffer.length > 3 * 1024 * 1024) throw new Error('Die Unterschrift ist zu groß');
  if (!buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error('Ungültiges Bildformat');
  }
  const customerName = String(input.customer_name || '').trim();
  if (!customerName) throw new Error('Bitte den Namen des Unterzeichners angeben');
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('Auftrag nicht gefunden');
  const filename = `unterschrift-${orderId}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.png`;
  writeFileSync(join(SIGNATURE_DIR, filename), buffer, { mode: 0o600 });
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const id = Number(db.prepare(
    `INSERT INTO signatures (order_id, report_id, customer_name, image_path, sha256, note, user_id, ip)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    orderId,
    input.report_id ? Number(input.report_id) : null,
    customerName.slice(0, 200),
    filename, sha256,
    String(input.note || '').slice(0, 1000),
    userId ?? null,
    String(ip || '').slice(0, 200),
  ).lastInsertRowid);
  db.prepare(
    "UPDATE orders SET internal_note = COALESCE(internal_note, '') || ? WHERE id = ?"
  ).run(`\n${new Date().toISOString().slice(0, 10)}: Digital vom Kunden unterschrieben (${customerName}).`, orderId);
  return db.prepare('SELECT * FROM signatures WHERE id = ?').get(id);
}

export function listSignatures(orderId) {
  return db.prepare(
    `SELECT s.*, u.name AS user_name FROM signatures s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.order_id = ? ORDER BY s.signed_at DESC, s.id DESC`
  ).all(orderId);
}

export function signatureRow(id) {
  return db.prepare('SELECT * FROM signatures WHERE id = ?').get(id);
}

export function signatureFilePath(row) {
  const name = String(row?.image_path || '');
  if (!name || name.includes('/') || name.includes('\\')) return null;
  return join(SIGNATURE_DIR, name);
}

/* ------------------------------------------------------------------ Checklisten */

const DEFAULT_CHECKLIST_TEMPLATES = [
  {
    name: 'SHK-Wartung Gastherme',
    trade: 'SHK',
    items: [
      'Anlage spannungsfrei geschaltet und gesichert',
      'Abgasmessung durchgeführt und dokumentiert',
      'Wärmetauscher gereinigt',
      'Brenner und Düsen geprüft',
      'Druck der Anlage geprüft',
      'Sicherheitsventil geprüft',
      'Kunde in Bedienung eingewiesen',
      'Wartungsprotokoll unterschrieben',
    ],
  },
  {
    name: 'Baustelle – Vorbereitung',
    trade: 'Allgemein',
    items: [
      'Baustelle abgesperrt und gesichert',
      'Zugang und Schlüssel geklärt',
      'Material und Werkzeug vollständig',
      'Absperrventile geschlossen',
      'Strom- und Wasseranschluss geprüft',
      'Nachbarn informiert',
      'Fotos vor Beginn erstellt',
    ],
  },
  {
    name: 'Abnahme / Übergabe',
    trade: 'Allgemein',
    items: [
      'Alle Arbeiten laut Auftrag ausgeführt',
      'Funktionsprüfung erfolgreich',
      'Baustelle gereinigt',
      'Entsorgung dokumentiert',
      'Bedienungsanleitung übergeben',
      'Gewährleistungsfristen erklärt',
      'Abnahmeprotokoll unterschrieben',
    ],
  },
];

function seedChecklistTemplates() {
  if (db.prepare('SELECT COUNT(*) AS n FROM checklist_templates').get().n > 0) return;
  const insert = db.prepare('INSERT INTO checklist_templates (name, trade, items) VALUES (?,?,?)');
  for (const template of DEFAULT_CHECKLIST_TEMPLATES) {
    insert.run(template.name, template.trade, JSON.stringify(template.items));
  }
}
seedChecklistTemplates();

export function checklistTemplates() {
  return db.prepare('SELECT * FROM checklist_templates ORDER BY active DESC, name').all().map((row) => {
    let items = [];
    try { items = JSON.parse(row.items); } catch { items = []; }
    return { ...row, items: Array.isArray(items) ? items : [] };
  });
}

export function createChecklistTemplate(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Bitte einen Namen angeben');
  const items = Array.isArray(input.items)
    ? input.items.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 200)
    : String(input.items || '').split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 200);
  if (!items.length) throw new Error('Bitte mindestens einen Punkt angeben');
  const id = Number(db.prepare(
    'INSERT INTO checklist_templates (name, trade, items, active) VALUES (?,?,?,?)'
  ).run(name.slice(0, 200), String(input.trade || '').slice(0, 100), JSON.stringify(items),
    input.active === 0 || input.active === '0' ? 0 : 1).lastInsertRowid);
  return checklistTemplates().find((row) => row.id === id);
}

export function updateChecklistTemplate(id, input = {}) {
  const row = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(id);
  if (!row) throw new Error('Vorlage nicht gefunden');
  let items = row.items;
  if (Array.isArray(input.items)) {
    items = JSON.stringify(input.items.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 200));
  } else if (typeof input.items === 'string') {
    items = JSON.stringify(input.items.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 200));
  }
  db.prepare('UPDATE checklist_templates SET name = ?, trade = ?, items = ?, active = ? WHERE id = ?').run(
    String(input.name ?? row.name).slice(0, 200),
    String(input.trade ?? row.trade).slice(0, 100),
    items,
    input.active === undefined ? row.active : (input.active === 0 || input.active === '0' ? 0 : 1),
    id,
  );
  return checklistTemplates().find((entry) => entry.id === Number(id));
}

export function deleteChecklistTemplate(id) {
  const used = db.prepare('SELECT COUNT(*) AS n FROM order_checklists WHERE template_id = ?').get(id).n;
  if (used > 0) {
    db.prepare('UPDATE checklist_templates SET active = 0 WHERE id = ?').run(id);
    return { ok: true, deactivated: true };
  }
  db.prepare('DELETE FROM checklist_templates WHERE id = ?').run(id);
  return { ok: true };
}

export function orderChecklists(orderId) {
  const lists = db.prepare(
    'SELECT * FROM order_checklists WHERE order_id = ? ORDER BY id'
  ).all(orderId);
  return lists.map((list) => {
    const items = db.prepare(
      'SELECT * FROM checklist_entries WHERE checklist_id = ? ORDER BY sort, id'
    ).all(list.id);
    const done = items.filter((item) => item.checked).length;
    return {
      ...list,
      items,
      done,
      total: items.length,
      percent: items.length ? Math.round((done / items.length) * 100) : 0,
    };
  });
}

export function createOrderChecklist(orderId, { templateId = null, name = '', items = null } = {}, userId = null) {
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('Auftrag nicht gefunden');
  let title = String(name || '').trim();
  let entries = Array.isArray(items) ? items : null;
  if (templateId) {
    const template = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(templateId);
    if (!template) throw new Error('Vorlage nicht gefunden');
    title = title || template.name;
    try { entries = JSON.parse(template.items); } catch { entries = []; }
  }
  if (!entries || !entries.length) throw new Error('Bitte eine Vorlage auswählen oder Punkte angeben');
  if (!title) title = 'Checkliste';
  const id = Number(db.prepare(
    'INSERT INTO order_checklists (order_id, template_id, name, created_by) VALUES (?,?,?,?)'
  ).run(orderId, templateId ? Number(templateId) : null, title.slice(0, 200), userId ?? null).lastInsertRowid);
  const insert = db.prepare(
    'INSERT INTO checklist_entries (checklist_id, label, sort) VALUES (?,?,?)'
  );
  entries.slice(0, 200).forEach((label, index) => insert.run(id, String(label || '').slice(0, 500), index));
  return orderChecklists(orderId).find((list) => list.id === id);
}

export function updateChecklistEntry(checklistId, entryId, { checked = null, note = null } = {}, userId = null) {
  const entry = db.prepare(
    'SELECT e.* FROM checklist_entries e JOIN order_checklists c ON c.id = e.checklist_id WHERE e.id = ? AND e.checklist_id = ?'
  ).get(entryId, checklistId);
  if (!entry) throw new Error('Checklistenpunkt nicht gefunden');
  if (checked != null) {
    db.prepare(
      'UPDATE checklist_entries SET checked = ?, checked_by = ?, checked_at = ? WHERE id = ?'
    ).run(checked ? 1 : 0, checked ? (userId ?? null) : null, checked ? new Date().toISOString() : null, entryId);
  }
  if (note != null) {
    db.prepare('UPDATE checklist_entries SET note = ? WHERE id = ?').run(String(note).slice(0, 2000), entryId);
  }
  return db.prepare('SELECT * FROM checklist_entries WHERE id = ?').get(entryId);
}

export function addChecklistEntry(checklistId, label) {
  const text = String(label || '').trim();
  if (!text) throw new Error('Bitte einen Punkt angeben');
  const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM checklist_entries WHERE checklist_id = ?').get(checklistId).n;
  const id = Number(db.prepare(
    'INSERT INTO checklist_entries (checklist_id, label, sort) VALUES (?,?,?)'
  ).run(checklistId, text.slice(0, 500), sort).lastInsertRowid);
  return db.prepare('SELECT * FROM checklist_entries WHERE id = ?').get(id);
}

export function deleteChecklist(checklistId) {
  db.prepare('DELETE FROM order_checklists WHERE id = ?').run(checklistId);
  return { ok: true };
}

/* ------------------------------------------------------------------ Bautagebuch */

export function listDiary(orderId) {
  return db.prepare(
    `SELECT d.*, u.name AS user_name FROM site_diary d
     LEFT JOIN users u ON u.id = d.user_id
     WHERE d.order_id = ? ORDER BY d.date DESC, d.id DESC`
  ).all(orderId);
}

export function createDiaryEntry(orderId, input = {}, userId = null) {
  const workDone = String(input.work_done || '').trim();
  if (!workDone) throw new Error('Bitte die ausgeführten Arbeiten beschreiben');
  const id = Number(db.prepare(
    `INSERT INTO site_diary (order_id, date, weather, temperature, personnel, work_done, material, incidents, user_id)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    orderId,
    String(input.date || todayISO()).slice(0, 10),
    String(input.weather || '').slice(0, 100),
    String(input.temperature || '').slice(0, 50),
    String(input.personnel || '').slice(0, 500),
    workDone.slice(0, 5000),
    String(input.material || '').slice(0, 3000),
    String(input.incidents || '').slice(0, 3000),
    userId ?? null,
  ).lastInsertRowid);
  return db.prepare('SELECT * FROM site_diary WHERE id = ?').get(id);
}

export function updateDiaryEntry(orderId, id, input = {}) {
  const row = db.prepare('SELECT * FROM site_diary WHERE id = ? AND order_id = ?').get(id, orderId);
  if (!row) throw new Error('Eintrag nicht gefunden');
  db.prepare(
    `UPDATE site_diary SET date = ?, weather = ?, temperature = ?, personnel = ?, work_done = ?,
       material = ?, incidents = ? WHERE id = ? AND order_id = ?`
  ).run(
    String(input.date ?? row.date).slice(0, 10),
    String(input.weather ?? row.weather).slice(0, 100),
    String(input.temperature ?? row.temperature).slice(0, 50),
    String(input.personnel ?? row.personnel).slice(0, 500),
    String(input.work_done ?? row.work_done).slice(0, 5000),
    String(input.material ?? row.material).slice(0, 3000),
    String(input.incidents ?? row.incidents).slice(0, 3000),
    id, orderId,
  );
  return db.prepare('SELECT * FROM site_diary WHERE id = ?').get(id);
}

export function deleteDiaryEntry(orderId, id) {
  db.prepare('DELETE FROM site_diary WHERE id = ? AND order_id = ?').run(id, orderId);
  return { ok: true };
}

export function siteSummary(orderId) {
  const measurements = listMeasurements(orderId);
  const checklists = orderChecklists(orderId);
  return {
    measurements,
    signatures: listSignatures(orderId),
    checklists,
    diary: listDiary(orderId),
    quantity_total: round2(measurements.reduce((sum, row) => sum + Number(row.quantity), 0)),
    checklist_percent: checklists.length
      ? Math.round(checklists.reduce((sum, list) => sum + list.percent, 0) / checklists.length)
      : 0,
  };
}
