import { createHmac, randomBytes } from 'node:crypto';
import { db, getSettings } from './db.js';
import { buildOciOrder } from './warehouse.js';

/* ------------------------------------------------------------------ GAEB */

export const GAEB_UNITS = {
  Stk: 'Stk', Stück: 'Stk', Std: 'H', h: 'H', m: 'm', 'm²': 'm2', 'm³': 'm3',
  kg: 'kg', l: 'l', Pauschale: 'psch', Tag: 'Tag',
};

const xmlEscape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[char]));

function parseXmlText(fragment) {
  return String(fragment || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function firstTag(block, names) {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
    if (match) return parseXmlText(match[1]);
  }
  return '';
}

export function exportGaeb(order, items) {
  const settings = getSettings();
  const date = new Date().toISOString().slice(0, 10);
  const positions = items.map((item, index) => {
    const oz = `01.${String(index + 1).padStart(4, '0')}`;
    return `        <Item RNoPart="${oz}">
          <Description>
            <CompleteText><DetailTx><TextOut><span>${xmlEscape(item.description)}</span></TextOut></DetailTx></CompleteText>
          </Description>
          <QU><Qty>${Number(item.quantity).toFixed(2)}</Qty><QU>${xmlEscape(GAEB_UNITS[item.unit] || item.unit || 'Stk')}</QU></QU>
          <UP><UP>${Number(item.unit_price).toFixed(2)}</UP><Currency>EUR</Currency></UP>
          <IT>${xmlEscape(item.kind === 'arbeit' ? 'Lohn' : 'Material')}</IT>
        </Item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/DA83/3.2">
  <GAEBInfo>
    <Version>3.2</Version>
    <Date>${date}</Date>
    <ProgSystem>HandwerkPro</ProgSystem>
  </GAEBInfo>
  <Award>
    <AwardInfo>
      <Label><LabelText><span>${xmlEscape(order.title)}</span></LabelText></Label>
      <Cur>EUR</Cur>
    </AwardInfo>
    <BoQ>
      <BoQInfo>
        <BoQName>${xmlEscape(order.number || 'LV')}</BoQName>
        <BoQInfoText>${xmlEscape(settings.company_name)}</BoQInfoText>
      </BoQInfo>
      <BoQBody>
        <BoQCtgy RNoPart="01">
          <LblTx><DetailTx><TextOut><span>${xmlEscape(order.title)}</span></TextOut></DetailTx></LblTx>
          <BoQBody>
            <Itemlist>
${positions}
            </Itemlist>
          </BoQBody>
        </BoQCtgy>
      </BoQBody>
    </BoQ>
  </Award>
</GAEB>
`;
}

export function parseGaeb(text) {
  const content = String(text || '');
  const items = [];
  const blocks = content.match(/<Item\b[\s\S]*?<\/Item>/gi) || [];
  for (const block of blocks) {
    const oz = (/RNoPart="([^"]+)"/i.exec(block) || [])[1] || '';
    const description = firstTag(block, ['span', 'CompleteText', 'Description']) || `Position ${oz}`;
    const quantity = Number(firstTag(block, ['Qty']).replace(',', '.')) || 0;
    const unit = firstTag(block, ['QU']) || 'Stk';
    const price = Number(firstTag(block, ['UP']).replace(',', '.')) || 0;
    if (quantity > 0) items.push({ oz, description: description.slice(0, 500), quantity, unit, unit_price: price });
  }
  if (items.length) return { format: 'X83', items };

  // Einfacher Fallback: OZ;Menge;Einheit;Einzelpreis;Beschreibung
  for (const line of content.split(/\r?\n/)) {
    const cells = line.split(';').map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const oz = cells[0];
    const quantity = Number(String(cells[1]).replace(',', '.'));
    if (!/^\d/.test(oz) || !quantity) continue;
    items.push({
      oz,
      quantity,
      unit: cells[2] || 'Stk',
      unit_price: Number(String(cells[3]).replace(',', '.')) || 0,
      description: (cells[4] || `Position ${oz}`).slice(0, 500),
    });
  }
  if (!items.length) throw new Error('Keine GAEB-Positionen gefunden');
  return { format: 'TEXT', items };
}

export function importGaebToOrder(orderId, text, { replace = false } = {}) {
  const parsed = parseGaeb(text);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('Auftrag nicht gefunden');
  db.exec('BEGIN');
  try {
    if (replace) db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
    let sort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS n FROM order_items WHERE order_id = ?').get(orderId).n;
    for (const item of parsed.items) {
      sort += 1;
      db.prepare(
        `INSERT INTO order_items (order_id, kind, article_id, description, quantity, unit, unit_price, sort)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(orderId, 'material', null, item.description, item.quantity, item.unit, item.unit_price, sort);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { format: parsed.format, count: parsed.items.length };
}

/* ------------------------------------------------------------------ OCI */

export function parseOciOrder(text) {
  const content = String(text || '');
  if (!/<ORDER/i.test(content)) throw new Error('Keine OCI-Bestellung erkannt');
  const blocks = content.match(/<ORDER_ITEM\b[\s\S]*?<\/ORDER_ITEM>/gi) || [];
  const items = [];
  for (const block of blocks) {
    const quantity = Number(firstTag(block, ['QUANTITY']).replace(',', '.')) || 0;
    if (!quantity) continue;
    const description = firstTag(block, ['DESCRIPTION_SHORT', 'DESCRIPTION', 'PRODUCT_NAME'])
      || firstTag(block, ['SUPPLIER_AID']) || 'OCI-Position';
    const unit = firstTag(block, ['ORDER_UNIT', 'UNIT']) || 'Stk';
    const price = Number(firstTag(block, ['PRICE', 'PRICE_AMOUNT']).replace(',', '.')) || 0;
    items.push({
      supplierAid: firstTag(block, ['SUPPLIER_AID', 'ARTICLE_ID']),
      description: description.slice(0, 500),
      quantity, unit, unit_price: price,
    });
  }
  if (!items.length) throw new Error('Keine OCI-Positionen gefunden');
  return {
    orderReference: firstTag(content, ['ORDER_ID', 'ORDER_REFERENCE']),
    items,
  };
}

export function importOciToOrder(orderId, text) {
  const parsed = parseOciOrder(text);
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('Auftrag nicht gefunden');
  let sort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS n FROM order_items WHERE order_id = ?').get(orderId).n;
  let created = 0;
  for (const item of parsed.items) {
    let article = item.supplierAid
      ? db.prepare('SELECT * FROM articles WHERE number = ? OR manufacturer_number = ?').get(item.supplierAid, item.supplierAid)
      : null;
    if (!article && item.supplierAid) {
      article = db.prepare('SELECT * FROM articles WHERE gtin = ?').get(item.supplierAid);
    }
    sort += 1;
    db.prepare(
      `INSERT INTO order_items (order_id, kind, article_id, description, quantity, unit, unit_price, sort)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(orderId, 'material', article?.id ?? null, item.description, item.quantity, item.unit,
      item.unit_price || Number(article?.sale_price) || 0, sort);
    created += 1;
  }
  return { count: created, orderReference: parsed.orderReference };
}

/* --------------------------------------------------------- GAEB X84 / OCI */
/** GAEB X84 (Kostenanschlag) – Positionen mit Mengen und Preisen. */
export function exportGaebX84(order, items) {
  const settings = getSettings();
  const date = new Date().toISOString().slice(0, 10);
  const positions = items.map((item, index) => {
    const oz = `01.${String(index + 1).padStart(4, '0')}`;
    return `        <Item RNoPart="${oz}">
          <Description>
            <CompleteText><DetailTx><TextOut><span>${xmlEscape(item.description)}</span></TextOut></DetailTx></CompleteText>
          </Description>
          <QU><Qty>${Number(item.quantity).toFixed(2)}</Qty><QU>${xmlEscape(GAEB_UNITS[item.unit] || item.unit || 'Stk')}</QU></QU>
          <UP><UP>${Number(item.unit_price).toFixed(2)}</UP><Currency>EUR</Currency></UP>
          <IT>${xmlEscape(item.kind === 'arbeit' ? 'Lohn' : 'Material')}</IT>
        </Item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/DA84/3.2">
  <GAEBInfo>
    <Version>3.2</Version>
    <Date>${date}</Date>
    <ProgSystem>HandwerkPro</ProgSystem>
  </GAEBInfo>
  <Award>
    <AwardInfo>
      <Label><LabelText><span>${xmlEscape(order.title)}</span></LabelText></Label>
      <Cur>EUR</Cur>
    </AwardInfo>
    <BoQ>
      <BoQInfo>
        <BoQName>${xmlEscape(order.number || 'Kostenanschlag')}</BoQName>
        <BoQInfoText>${xmlEscape(settings.company_name)}</BoQInfoText>
      </BoQInfo>
      <BoQBody>
        <BoQCtgy RNoPart="01">
          <LblTx><DetailTx><TextOut><span>${xmlEscape(order.title)}</span></TextOut></DetailTx></LblTx>
          <BoQBody>
            <Itemlist>
${positions}
            </Itemlist>
          </BoQBody>
        </BoQCtgy>
      </BoQBody>
    </BoQ>
  </Award>
</GAEB>
`;
}

/** OCI-Bestellung (OpenTrans 1.0) für Händler. */
export function exportOci(order, items) {
  return buildOciOrder(order, items);
}

/** Lexware-Buchhaltungsimport (CSV, Semikolon, Windows-1252-kompatibel). */
export function lexwareExport({ from = '', to = '' } = {}) {
  const clauses = ["i.status != 'storniert'"];
  const values = [];
  if (from) { clauses.push('date(i.date) >= date(?)'); values.push(from); }
  if (to) { clauses.push('date(i.date) <= date(?)'); values.push(to); }
  const rows = db.prepare(
    `SELECT i.number, i.date, i.due_date, i.status, i.kind, i.subtotal, i.tax_total, i.total, i.paid_total,
       c.number AS customer_number, c.company, c.first_name, c.last_name, c.email
     FROM invoices i JOIN customers c ON c.id = i.customer_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY i.date, i.id`
  ).all(...values);
  const header = ['Belegnr', 'Belegdatum', 'Faelligkeit', 'Belegart', 'Kundennr', 'Kunde', 'Netto', 'USt', 'Brutto', 'Bezahlt', 'Offen', 'Status', 'E-Mail'];
  const lines = [header.join(';')];
  const cell = (value) => {
    const text = String(value ?? '');
    return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const money = (value) => Number(value || 0).toFixed(2).replace('.', ',');
  for (const row of rows) {
    const name = row.company || `${row.first_name || ''} ${row.last_name || ''}`.trim();
    lines.push([
      row.number, row.date, row.due_date, row.kind === 'abschlag' ? 'Abschlag' : 'Rechnung',
      row.customer_number, name, money(row.subtotal), money(row.tax_total), money(row.total),
      money(row.paid_total), money(Number(row.total) - Number(row.paid_total)), row.status, row.email,
    ].map(cell).join(';'));
  }
  const stamp = from || to ? `${from || 'start'}_${to || 'heute'}` : new Date().toISOString().slice(0, 10);
  return {
    filename: `Lexware-Export-${stamp}.csv`,
    content: `\uFEFF${lines.join('\r\n')}\r\n`,
    count: rows.length,
  };
}

/* ------------------------------------------------------------------ Webhooks */

export const WEBHOOK_EVENTS = {
  'order.created': 'Auftrag angelegt',
  'order.status': 'Auftragsstatus geändert',
  'invoice.created': 'Rechnung erstellt',
  'invoice.paid': 'Rechnung bezahlt',
  'customer.created': 'Kunde angelegt',
  'document.uploaded': 'Dokument archiviert',
  'report.approved': 'Bericht freigegeben',
};

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/i;

export function webhookUrlAllowed(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl)); } catch { return { ok: false, error: 'Ungültige URL' }; }
  const allowHttp = getSettings().mat_allow_http === '1';
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    return { ok: false, error: 'Webhooks benötigen HTTPS (HTTP nur über die Einstellung erlauben)' };
  }
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return { ok: false, error: 'Private Netzwerkziele sind für Webhooks gesperrt' };
  }
  if (url.username || url.password) return { ok: false, error: 'Zugangsdaten in der URL sind nicht erlaubt' };
  return { ok: true, url };
}

export function listWebhooks() {
  return db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all().map((row) => {
    let events = [];
    try { events = JSON.parse(row.events); } catch { events = []; }
    return { ...row, secret: row.secret ? '********' : '', events, active: Boolean(row.active) };
  });
}

export function createWebhook(input = {}) {
  const check = webhookUrlAllowed(input.url);
  if (!check.ok) throw new Error(check.error);
  const events = Array.isArray(input.events) && input.events.length
    ? input.events.filter((event) => WEBHOOK_EVENTS[event] || event === '*')
    : ['*'];
  const secret = String(input.secret || randomBytes(24).toString('hex'));
  const id = Number(db.prepare(
    'INSERT INTO webhooks (url, events, secret, active) VALUES (?,?,?,?)'
  ).run(check.url.toString(), JSON.stringify(events), secret.slice(0, 200),
    input.active === 0 || input.active === '0' ? 0 : 1).lastInsertRowid);
  return { ...db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id), secret };
}

export function updateWebhook(id, input = {}) {
  const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
  if (!row) throw new Error('Webhook nicht gefunden');
  let url = row.url;
  if (input.url) {
    const check = webhookUrlAllowed(input.url);
    if (!check.ok) throw new Error(check.error);
    url = check.url.toString();
  }
  const events = Array.isArray(input.events)
    ? JSON.stringify(input.events.filter((event) => WEBHOOK_EVENTS[event] || event === '*'))
    : row.events;
  const secret = input.secret && input.secret !== '********' ? String(input.secret).slice(0, 200) : row.secret;
  db.prepare('UPDATE webhooks SET url = ?, events = ?, secret = ?, active = ? WHERE id = ?').run(
    url, events, secret,
    input.active === undefined ? row.active : (input.active === 0 || input.active === '0' ? 0 : 1),
    id,
  );
  return listWebhooks().find((entry) => entry.id === Number(id));
}

export function deleteWebhook(id) {
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
  return { ok: true };
}

export function webhookDeliveries(id, limit = 50) {
  return db.prepare(
    'SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT ?'
  ).all(id, Math.min(200, Number(limit) || 50));
}

async function deliver(webhook, event, payload) {
  const body = JSON.stringify({ event, at: new Date().toISOString(), data: payload });
  const signature = createHmac('sha256', webhook.secret || '').update(body).digest('hex');
  let status = null;
  let error = '';
  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'HandwerkPro-Webhook/1.0',
        'X-HandwerkPro-Event': event,
        'X-HandwerkPro-Signature': `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    status = response.status;
    if (!response.ok) error = `HTTP ${response.status}`;
  } catch (fetchError) {
    error = String(fetchError?.message || fetchError).slice(0, 500);
  }
  db.prepare(
    'INSERT INTO webhook_deliveries (webhook_id, event, status, error) VALUES (?,?,?,?)'
  ).run(webhook.id, event, status, error);
  db.prepare('UPDATE webhooks SET last_status = ?, last_at = datetime(\'now\') WHERE id = ?').run(status, webhook.id);
}

/** Fire-and-forget: Ein Webhook darf keinen API-Aufruf blockieren oder sprengen. */
export function emitWebhook(event, payload) {
  const hooks = db.prepare('SELECT * FROM webhooks WHERE active = 1').all().filter((hook) => {
    let events = [];
    try { events = JSON.parse(hook.events); } catch { events = []; }
    return events.includes('*') || events.includes(event);
  });
  for (const hook of hooks) {
    deliver(hook, event, payload).catch(() => {});
  }
  return hooks.length;
}

export async function testWebhook(id) {
  const hook = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
  if (!hook) throw new Error('Webhook nicht gefunden');
  await deliver(hook, 'test', { message: 'Testzustellung aus HandwerkPro' });
  return webhookDeliveries(id, 1)[0];
}

/* ------------------------------------------------------------------ API-Dokumentation */

export function openapiDocument(baseUrl = '') {
  const doc = {
    openapi: '3.0.3',
    info: {
      title: 'HandwerkPro API',
      version: '1.8.0',
      description: 'Interne REST-API. Anmeldung per Session-Cookie (hp_session). Alle Rechte werden serverseitig geprüft.',
    },
    servers: [{ url: baseUrl || '/' }],
    components: {
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'hp_session' },
      },
    },
    security: [{ cookieAuth: [] }],
    paths: {
      '/api/auth/login': { post: { summary: 'Anmelden', security: [], responses: { 200: { description: 'OK' } } } },
      '/api/dashboard': { get: { summary: 'Übersicht und Kennzahlen', responses: { 200: { description: 'OK' } } } },
      '/api/orders': {
        get: { summary: 'Aufträge und Angebote', responses: { 200: { description: 'OK' } } },
        post: { summary: 'Auftrag anlegen', responses: { 200: { description: 'OK' } } },
      },
      '/api/orders/{id}': {
        get: { summary: 'Auftragsdetails', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'OK' } } },
        put: { summary: 'Auftrag bearbeiten', responses: { 200: { description: 'OK' } } },
      },
      '/api/orders/{id}/calculation': { get: { summary: 'Kalkulation und Nachkalkulation', responses: { 200: { description: 'OK' } } } },
      '/api/orders/{id}/measurements': { get: { summary: 'Aufmaßpositionen', responses: { 200: { description: 'OK' } } } },
      '/api/orders/{id}/checklists': { get: { summary: 'Checklisten des Auftrags', responses: { 200: { description: 'OK' } } } },
      '/api/orders/{id}/diary': { get: { summary: 'Bautagebuch', responses: { 200: { description: 'OK' } } } },
      '/api/orders/{id}/gaeb': { get: { summary: 'GAEB X83 exportieren', responses: { 200: { description: 'XML' } } } },
      '/api/invoices': { get: { summary: 'Rechnungen', responses: { 200: { description: 'OK' } } } },
      '/api/invoices/{id}/einvoice': { get: { summary: 'E-Rechnung (XRechnung/ZUGFeRD)', responses: { 200: { description: 'XML oder PDF' } } } },
      '/api/customers': {
        get: { summary: 'Kunden', responses: { 200: { description: 'OK' } } },
        post: { summary: 'Kunde anlegen', responses: { 200: { description: 'OK' } } },
      },
      '/api/articles': { get: { summary: 'Artikel und Bestände', responses: { 200: { description: 'OK' } } } },
      '/api/documents': {
        get: { summary: 'Dokumente (DMS)', responses: { 200: { description: 'OK' } } },
        post: { summary: 'Dokument archivieren', responses: { 200: { description: 'OK' } } },
      },
      '/api/absences': { get: { summary: 'Abwesenheiten', responses: { 200: { description: 'OK' } } } },
      '/api/geo/status': { get: { summary: 'GPS-Status und Standorte', responses: { 200: { description: 'OK' } } } },
      '/api/geo/settings': { put: { summary: 'GPS-Zeiterfassung ein-/ausschalten', responses: { 200: { description: 'OK' } } } },
      '/api/geo/home': { put: { summary: 'Zuhause-Standort speichern', responses: { 200: { description: 'OK' } } } },
      '/api/orders/{id}/location': { put: { summary: 'Baustellen-Standort speichern', responses: { 200: { description: 'OK' } } } },
      '/api/geo/event': { post: { summary: 'GPS-Übergang melden', responses: { 200: { description: 'OK' } } } },
      '/api/hr/accounts': { get: { summary: 'Urlaubs- und Arbeitszeitkonten', responses: { 200: { description: 'OK' } } } },
      '/api/finance/datev': { get: { summary: 'DATEV-Buchungsstapel', responses: { 200: { description: 'CSV' } } } },
      '/api/finance/bank': { get: { summary: 'Bankumsätze', responses: { 200: { description: 'OK' } } } },
      '/api/finance/sepa': { get: { summary: 'SEPA pain.001', responses: { 200: { description: 'XML' } } } },
      '/api/webhooks': { get: { summary: 'Webhooks', responses: { 200: { description: 'OK' } } } },
      '/api/tasks': {
        get: { summary: 'Aufgaben', responses: { 200: { description: 'OK' } } },
        post: { summary: 'Aufgabe anlegen', responses: { 200: { description: 'OK' } } },
      },
      '/api/messages': {
        get: { summary: 'Nachrichten (optional je Auftrag)', responses: { 200: { description: 'OK' } } },
        post: { summary: 'Nachricht senden', responses: { 200: { description: 'OK' } } },
      },
      '/api/notifications': { get: { summary: 'Benachrichtigungen', responses: { 200: { description: 'OK' } } } },
      '/api/leads': {
        get: { summary: 'Anfragen/Leads', responses: { 200: { description: 'OK' } } },
        post: { summary: 'Anfrage anlegen', responses: { 200: { description: 'OK' } } },
      },
      '/api/leads/{id}/convert': { post: { summary: 'Anfrage in Kunde umwandeln', responses: { 200: { description: 'OK' } } } },
      '/api/orders/{id}/progress-invoice': { post: { summary: 'Abschlagsrechnung', responses: { 200: { description: 'OK' } } } },
      '/api/orders/{id}/oci': { get: { summary: 'OCI-Bestellung exportieren', responses: { 200: { description: 'XML' } } } },
      '/api/orders/{id}/reservations': {
        get: { summary: 'Materialreservierungen', responses: { 200: { description: 'OK' } } },
        post: { summary: 'Material reservieren', responses: { 200: { description: 'OK' } } },
      },
      '/api/orders/{id}/packlist': { get: { summary: 'Packliste', responses: { 200: { description: 'OK' } } } },
      '/api/employment-contracts': {
        get: { summary: 'Arbeitsverträge', responses: { 200: { description: 'OK' } } },
        post: { summary: 'Vertrag anlegen', responses: { 200: { description: 'OK' } } },
      },
      '/api/hr/payroll': { get: { summary: 'Lohnvorbereitung', responses: { 200: { description: 'OK' } } } },
      '/api/hr/payroll.csv': { get: { summary: 'Lohnvorbereitung als CSV', responses: { 200: { description: 'CSV' } } } },
      '/api/time-categories': { get: { summary: 'Zeitkategorien', responses: { 200: { description: 'OK' } } } },
      '/api/finance/lexware': { get: { summary: 'Lexware-CSV-Export', responses: { 200: { description: 'CSV' } } } },
      '/api/public/leads/{token}': { post: { summary: 'Öffentliche Anfrage (tokenisiert)', security: [], responses: { 200: { description: 'OK' } } } },
      '/api/public/portal/{token}': { get: { summary: 'Kundenportal (tokenisiert)', security: [], responses: { 200: { description: 'OK' } } } },
    },
  };
  return doc;
}
