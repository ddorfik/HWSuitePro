import { db, getSettings, logActivity } from './db.js';

/* Lager-Erweiterungen: Reservierungen, Packlisten und Händlerbestellung. */

const str = (value) => (value == null ? '' : String(value).trim());
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/i;
const isPrivateHost = (host) => {
  const name = String(host || '').toLowerCase();
  return PRIVATE_HOST.test(name) || /^172\.(1[6-9]|2\d|3[01])\./.test(name);
};
const xmlEscape = (value) => String(value ?? '').replace(/[<>&"']/g, (char) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
}[char]));

export function reservedQuantity(articleId) {
  const row = db.prepare(
    'SELECT COALESCE(SUM(quantity), 0) AS n FROM order_reservations WHERE article_id = ? AND packed_at IS NULL'
  ).get(Number(articleId));
  return Number(row?.n) || 0;
}

export function stockLevels(article) {
  const reserved = reservedQuantity(article.id);
  return {
    ...article,
    reserved,
    available: Math.round((Number(article.stock) - reserved + Number.EPSILON) * 1000) / 1000,
  };
}

export function listReservations(orderId = null) {
  const where = orderId ? 'WHERE r.order_id = ?' : '';
  const values = orderId ? [Number(orderId)] : [];
  return db.prepare(
    `SELECT r.*, a.number AS article_number, a.name AS article_name, a.unit,
       a.stock, a.purchase_price, a.sale_price, o.number AS order_number, o.title AS order_title,
       u.name AS created_by_name
     FROM order_reservations r
     JOIN articles a ON a.id = r.article_id
     JOIN orders o ON o.id = r.order_id
     LEFT JOIN users u ON u.id = r.created_by
     ${where}
     ORDER BY r.packed_at IS NOT NULL, r.id`
  ).all(...values).map((row) => ({
    ...row,
    packed: Boolean(row.packed_at),
    reserved_open: row.packed_at ? 0 : Number(row.quantity),
  }));
}

export function addReservation(user, orderId, input = {}) {
  const order = db.prepare('SELECT id, number FROM orders WHERE id = ?').get(Number(orderId));
  if (!order) throw new Error('Auftrag nicht gefunden');
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(Number(input.article_id));
  if (!article) throw new Error('Artikel nicht gefunden');
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Bitte eine Menge größer 0 angeben');
  const existing = db.prepare(
    'SELECT * FROM order_reservations WHERE order_id = ? AND article_id = ? AND packed_at IS NULL'
  ).get(order.id, article.id);
  if (existing) {
    db.prepare('UPDATE order_reservations SET quantity = quantity + ? WHERE id = ?').run(quantity, existing.id);
  } else {
    db.prepare(
      'INSERT INTO order_reservations (order_id, article_id, quantity, created_by) VALUES (?,?,?,?)'
    ).run(order.id, article.id, quantity, user.id);
  }
  logActivity('lager', `${quantity} ${article.unit || ''} ${article.name} für ${order.number} reserviert.`);
  return listReservations(order.id);
}

export function updateReservation(id, input = {}) {
  const row = db.prepare('SELECT * FROM order_reservations WHERE id = ?').get(Number(id));
  if (!row) throw new Error('Reservierung nicht gefunden');
  db.prepare('UPDATE order_reservations SET quantity = ?, packed_at = ? WHERE id = ?').run(
    input.quantity !== undefined ? Math.max(0, Number(input.quantity) || 0) : row.quantity,
    input.packed === undefined ? row.packed_at : (input.packed ? (row.packed_at || new Date().toISOString().slice(0, 19).replace('T', ' ')) : null),
    row.id,
  );
  return listReservations(row.order_id);
}

export function deleteReservation(id) {
  const row = db.prepare('SELECT * FROM order_reservations WHERE id = ?').get(Number(id));
  if (!row) throw new Error('Reservierung nicht gefunden');
  db.prepare('DELETE FROM order_reservations WHERE id = ?').run(row.id);
  return listReservations(row.order_id);
}

export function packlist(orderId) {
  const order = db.prepare(
    `SELECT o.id, o.number, o.title, o.scheduled_date, o.status,
       c.company, c.first_name, c.last_name, p.label AS property_label,
       p.street, p.zip, p.city, e.name AS employee_name
     FROM orders o JOIN customers c ON c.id = o.customer_id
     LEFT JOIN properties p ON p.id = o.property_id
     LEFT JOIN employees e ON e.id = o.employee_id
     WHERE o.id = ?`
  ).get(Number(orderId));
  if (!order) throw new Error('Auftrag nicht gefunden');
  const rows = listReservations(order.id);
  return {
    order,
    items: rows,
    open_count: rows.filter((row) => !row.packed).length,
    total_count: rows.length,
  };
}

/* ------------------------------------------------------------------ OCI */
export function buildOciOrder(order, items) {
  const settings = getSettings();
  const date = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const positions = items.map((item, index) => `    <ORDER_ITEM>
      <LINE_ITEM_ID>${index + 1}</LINE_ITEM_ID>
      <SUPPLIER_AID>${xmlEscape(item.article_number || '')}</SUPPLIER_AID>
      <DESCRIPTION_SHORT>${xmlEscape(item.article_name || item.description || '')}</DESCRIPTION_SHORT>
      <QUANTITY>${Number(item.quantity).toFixed(2)}</QUANTITY>
      <ORDER_UNIT>${xmlEscape(item.unit || 'Stk')}</ORDER_UNIT>
      <PRICE>${Number(item.purchase_price ?? item.unit_price ?? 0).toFixed(2)}</PRICE>
    </ORDER_ITEM>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ORDER xmlns="http://www.opentrans.org/XMLSchema/1.0">
  <ORDER_HEADER>
    <ORDER_INFO>
      <ORDER_ID>${xmlEscape(order.number)}</ORDER_ID>
      <ORDER_DATE>${date}</ORDER_DATE>
      <PARTIES>
        <PARTY>
          <PARTY_ID type="buyer">${xmlEscape(settings.company_name)}</PARTY_ID>
        </PARTY>
      </PARTIES>
      <ORDER_PARTIES>
        <BUYER_ID>${xmlEscape(settings.company_name)}</BUYER_ID>
      </ORDER_PARTIES>
    </ORDER_INFO>
  </ORDER_HEADER>
  <ORDER_ITEM_LIST>
${positions}
  </ORDER_ITEM_LIST>
</ORDER>
`;
}

export function orderForTransfer(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(orderId));
  if (!order) throw new Error('Auftrag nicht gefunden');
  const reserved = listReservations(order.id);
  const items = reserved.length
    ? reserved.filter((row) => !row.packed).map((row) => ({
      article_number: row.article_number,
      article_name: row.article_name,
      quantity: row.quantity,
      unit: row.unit,
      purchase_price: row.purchase_price,
      unit_price: row.sale_price,
    }))
    : db.prepare(
      `SELECT a.number AS article_number, a.name AS article_name, oi.quantity, oi.unit,
         a.purchase_price, oi.unit_price
       FROM order_items oi LEFT JOIN articles a ON a.id = oi.article_id
       WHERE oi.order_id = ? AND oi.kind = 'material'`
    ).all(order.id);
  if (!items.length) throw new Error('Keine Materialpositionen für die Bestellung vorhanden');
  return { order, items };
}

export async function sendDealerOrder(user, orderId) {
  const settings = getSettings();
  const { order, items } = orderForTransfer(orderId);
  const xml = buildOciOrder(order, items);
  if (settings.mat_dealer_order_enabled !== '1' || !str(settings.mat_dealer_base_url)) {
    return { sent: false, xml, filename: `Bestellung-${order.number}.xml`, message: 'Händlerbestellung ist nicht eingerichtet – OCI-Datei zum Download.' };
  }
  const base = str(settings.mat_dealer_base_url).replace(/\/+$/, '');
  let url;
  try { url = new URL(`${base}${str(settings.mat_dealer_order_path) || '/api/orders'}`); } catch { throw new Error('Ungültige Händler-URL'); }
  if (url.protocol !== 'https:' && !(settings.mat_allow_http === '1' && url.protocol === 'http:')) {
    throw new Error('Händlerbestellungen benötigen HTTPS (HTTP nur über die Einstellung erlauben)');
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error('Private Netzwerkziele sind für Händlerbestellungen gesperrt');
  }
  if (url.username || url.password) throw new Error('Zugangsdaten in der URL sind nicht erlaubt');
  const headers = { 'Content-Type': 'application/xml; charset=utf-8', Accept: 'application/json, application/xml' };
  const authType = str(settings.mat_dealer_auth_type) || 'none';
  if (authType === 'bearer') headers.Authorization = `Bearer ${settings.mat_dealer_auth_secret}`;
  else if (authType === 'basic') {
    headers.Authorization = `Basic ${Buffer.from(`${settings.mat_dealer_auth_user}:${settings.mat_dealer_auth_secret}`, 'utf8').toString('base64')}`;
  } else if (authType === 'api_key') {
    headers[str(settings.mat_dealer_auth_header) || 'X-API-Key'] = settings.mat_dealer_auth_secret;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { method: 'POST', headers, body: xml, signal: controller.signal });
    const text = await response.text().catch(() => '');
    if (!response.ok) throw new Error(`Händler hat die Bestellung abgelehnt (${response.status}) ${text.slice(0, 200)}`.trim());
    logActivity('lager', `Bestellung ${order.number} an ${settings.mat_dealer_name || url.hostname} gesendet.`);
    return { sent: true, status: response.status, message: `Bestellung an ${settings.mat_dealer_name || url.hostname} gesendet.` };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Zeitüberschreitung bei der Händlerbestellung');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
