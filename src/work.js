import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, normalize as normalizePath, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { db, DATA_DIR } from './db.js';

const PHOTO_DIR = join(DATA_DIR, 'fotos');

/* ------------------------------------------------------------------ Material-Erkennung */
const NUMBER_WORDS = {
  ein: 1, eine: 1, einen: 1, einem: 1, einer: 1, eins: 1,
  zwei: 2, zwo: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5,
  sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
  elf: 11, zwölf: 12, zwoelf: 12, fünfzehn: 15, zwanzig: 20,
};

const UNITS = [
  { pattern: /^(metern?|meter|m)$/i, unit: 'm' },
  { pattern: /^(st(ü|ue)ck|stk\.?|st\.?)$/i, unit: 'Stk' },
  { pattern: /^(kilogramm|kilo|kg)$/i, unit: 'kg' },
  { pattern: /^(litern?|liter|l)$/i, unit: 'l' },
  { pattern: /^(stunden?|std\.?|h)$/i, unit: 'Std' },
  { pattern: /^(pauschal|pausch\.?|psch\.?)$/i, unit: 'Pausch' },
];

const CONNECTORS = /^(und|dann|danach|außerdem|ausserdem|zudem|des Weiteren|weiterhin|habe|haben|ich|wir|noch|davon)\s+/i;
const NOISE = /\b(verwendet|verbaut|montiert|eingebaut|erneuert|getauscht|ausgetauscht|gebraucht|benötigt|benoetigt|geliefert|bestellt|verarbeitet|installiert)\b.*$/i;

const normalize = (value) => String(value || '')
  .toLowerCase()
  .replaceAll('ä', 'ae').replaceAll('ö', 'oe').replaceAll('ü', 'ue').replaceAll('ß', 'ss')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function parseQuantity(token) {
  const cleaned = String(token || '').trim().toLowerCase();
  if (/^\d/.test(cleaned)) return Number(cleaned.replace(',', '.'));
  return NUMBER_WORDS[cleaned] ?? 0;
}

function findUnit(token) {
  if (!token) return null;
  const cleaned = token.replace(/[.,]$/, '');
  return UNITS.find((entry) => entry.pattern.test(cleaned))?.unit ?? null;
}

function splitSegments(text) {
  return String(text || '')
    .split(/[.;\n!?]+/)
    .flatMap((part) => part.split(/\s+und\s+(?=(?:\d|ein|eine|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn))/i))
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && part.length <= 200);
}

function candidateFromSegment(segment) {
  let text = segment.trim();
  for (let i = 0; i < 4; i += 1) {
    const next = text.replace(CONNECTORS, '').trim();
    if (next === text) break;
    text = next;
  }
  text = text.replace(NOISE, '').trim();

  // "3 Meter Kupferrohr 15x1" / "zwei Stück Dichtungen"
  let match = text.match(/^(\d+(?:[.,]\d+)?|[a-zäöüß]+)\s*\.?\s*([a-zäöüß.]+)\s+(.+)$/i);
  if (match) {
    const quantity = parseQuantity(match[1]);
    const unit = findUnit(match[2]);
    if (quantity > 0 && unit) {
      return { quantity, unit, name: match[3] };
    }
  }

  // "Kupferrohr 15x1, 3 Meter"
  match = text.match(/^(.+?)\s+(\d+(?:[.,]\d+)?|[a-zäöüß]+)\s*\.?\s*([a-zäöüß.]+)$/i);
  if (match) {
    const quantity = parseQuantity(match[2]);
    const unit = findUnit(match[3]);
    if (quantity > 0 && unit) {
      return { quantity, unit, name: match[1] };
    }
  }

  // "3 x Gasdruckregler"
  match = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:x|mal)\s+(.+)$/i);
  if (match) {
    return { quantity: parseQuantity(match[1]), unit: 'Stk', name: match[2] };
  }

  // "zwei Gasdruckregler" – Menge ohne Einheit
  match = text.match(/^(\d+(?:[.,]\d+)?|[a-zäöüß]+)\s+(.+)$/i);
  if (match) {
    const quantity = parseQuantity(match[1]);
    if (quantity > 0) return { quantity, unit: 'Stk', name: match[2] };
  }

  return null;
}

function stem(word) {
  return String(word || '')
    .replace(/ungen$/i, 'ung')
    .replace(/(en|er|es|e|s)$/i, (match) => (String(word).length > match.length + 3 ? '' : match));
}

function scoreArticle(article, name) {
  const spoken = normalize(name);
  const articleName = normalize(article.name);
  if (!spoken) return 0;
  if (normalize(article.number) && normalize(article.number) === spoken) return 1;
  if (articleName === spoken) return 1;
  if (articleName.includes(spoken) || spoken.includes(articleName)) return 0.9;
  const spokenWords = new Set(spoken.split(' ').filter((word) => word.length > 2).map(stem));
  const articleWords = articleName.split(' ').filter((word) => word.length > 2);
  if (!spokenWords.size) return 0;
  if (articleWords.some((word) => spokenWords.has(stem(word)))) {
    const single = spokenWords.size === 1;
    return single ? 0.75 : 0.6;
  }
  const hits = articleWords.filter((word) => spokenWords.has(stem(word))).length;
  return hits / Math.max(articleWords.length, spokenWords.size);
}

export function parseMaterials(text, { articles } = {}) {
  const list = articles ?? db.prepare('SELECT * FROM articles WHERE active = 1').all();
  const found = [];
  const seen = new Set();

  for (const segment of splitSegments(text)) {
    const candidate = candidateFromSegment(segment);
    if (!candidate) continue;
    let name = candidate.name
      .replace(NOISE, '')
      .replace(/\s+/g, ' ')
      .replace(/[,;:.]+$/, '')
      .trim();
    if (!name || name.length < 2) continue;

    let best = null;
    let bestScore = 0;
    for (const article of list) {
      const score = scoreArticle(article, name);
      if (score > bestScore) {
        best = article;
        bestScore = score;
      }
    }

    const matched = bestScore >= 0.6 ? best : null;
    const description = matched ? matched.name : name.charAt(0).toUpperCase() + name.slice(1);
    const key = `${matched?.id ?? description}|${candidate.quantity}|${candidate.unit}`;
    if (seen.has(key)) continue;
    seen.add(key);

    found.push({
      article_id: matched?.id ?? null,
      description,
      quantity: candidate.quantity,
      unit: candidate.unit || matched?.unit || 'Stk',
      matched: Boolean(matched),
      source: 'sprache',
    });
    if (found.length >= 25) break;
  }
  return found;
}

/* ------------------------------------------------------------------ Fotos */
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function savePhoto({ orderId, reportId = null, employeeId = null, dataUrl, kind = 'sonstiges', caption = '' }) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s);
  if (!match) throw new Error('Ungültiges Bildformat – bitte JPG, PNG oder WebP verwenden');
  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new Error('Das Bild ist leer');
  if (buffer.length > 8 * 1024 * 1024) throw new Error('Das Bild ist zu groß (maximal 8 MB)');

  const folder = join(PHOTO_DIR, String(orderId));
  mkdirSync(folder, { recursive: true });
  const ext = MIME_EXT[mime];
  const filename = `${randomUUID()}.${ext}`;
  writeFileSync(join(folder, filename), buffer);

  const relative = join(String(orderId), filename);
  const id = Number(db.prepare(
    `INSERT INTO photos (order_id, report_id, employee_id, kind, filename, caption)
     VALUES (?,?,?,?,?,?)`
  ).run(orderId, reportId, employeeId, kind, relative, caption).lastInsertRowid);

  return db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
}

export function photoFile(photo) {
  const relative = normalizePath(photo.filename);
  const full = join(PHOTO_DIR, relative);
  if (!full.startsWith(`${PHOTO_DIR}${sep}`)) return null;
  return full;
}

export function photoMime(photo) {
  const ext = String(photo.filename).split('.').pop().toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml' }[ext]
    ?? 'application/octet-stream';
}

export function deletePhoto(photo) {
  const file = photoFile(photo);
  if (file) {
    try { unlinkSync(file); } catch { /* Datei bereits entfernt */ }
  }
  db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
}

/* ------------------------------------------------------------------ Zeiterfassung */
export function runningTime(user) {
  return db.prepare(
    `SELECT t.*, o.number AS order_number, o.title AS order_title
     FROM time_entries t LEFT JOIN orders o ON o.id = t.order_id
     WHERE t.user_id = ? AND t.end_at IS NULL
     ORDER BY t.id DESC LIMIT 1`
  ).get(user.id) ?? null;
}

export function startTime(user, { orderId = null, type = 'arbeit', note = '' } = {}) {
  db.prepare("UPDATE time_entries SET end_at = datetime('now') WHERE user_id = ? AND end_at IS NULL")
    .run(user.id);
  const id = Number(db.prepare(
    `INSERT INTO time_entries (employee_id, user_id, order_id, start_at, end_at, type, note)
     VALUES (?,?,?, datetime('now'), NULL, ?, ?)`
  ).run(user.employee_id ?? null, user.id, orderId ?? null, type, note).lastInsertRowid);
  return db.prepare(
    `SELECT t.*, o.number AS order_number, o.title AS order_title
     FROM time_entries t LEFT JOIN orders o ON o.id = t.order_id WHERE t.id = ?`
  ).get(id);
}

export function stopTime(user, { note = '' } = {}) {
  const open = runningTime(user);
  if (!open) throw new Error('Es läuft keine Zeiterfassung');
  db.prepare(
    `UPDATE time_entries
     SET end_at = datetime('now'), note = CASE WHEN ? = '' THEN note ELSE ? END
     WHERE id = ?`
  ).run(note, note, open.id);
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(open.id);
  const minutes = Math.max(0, Math.round(
    (new Date(entry.end_at.replace(' ', 'T') + 'Z') - new Date(entry.start_at.replace(' ', 'T') + 'Z')) / 60000
  ));
  return { ...entry, minutes };
}
