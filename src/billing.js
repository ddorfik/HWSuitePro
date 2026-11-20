import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  db, DATA_DIR, getSettings, nextNumber, logActivity, invoiceTotals, round2, addDays, todayISO,
} from './db.js';
import { renderInvoicePdf, renderOrderPdf } from './documents.js';
import { archiveInvoicePdf } from './dms.js';

const PDF_DIR = join(DATA_DIR, 'dokumente');
mkdirSync(PDF_DIR, { recursive: true });

export function orderTotals(order) {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const totals = invoiceTotals(items, order.tax_rate);
  return { ...totals, items, count: items.length };
}

export function loadInvoiceData(invoiceId) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) return null;
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(invoice.customer_id);
  const property = invoice.property_id
    ? db.prepare('SELECT * FROM properties WHERE id = ?').get(invoice.property_id)
    : null;
  const order = invoice.order_id
    ? db.prepare('SELECT * FROM orders WHERE id = ?').get(invoice.order_id)
    : null;
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort, id').all(invoiceId);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY date').all(invoiceId);
  return { invoice, customer, property, order, items, payments };
}

export function loadOrderData(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
  const property = order.property_id
    ? db.prepare('SELECT * FROM properties WHERE id = ?').get(order.property_id)
    : null;
  const employee = order.employee_id
    ? db.prepare('SELECT * FROM employees WHERE id = ?').get(order.employee_id)
    : null;
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort, id').all(orderId);
  const invoice = db.prepare('SELECT * FROM invoices WHERE order_id = ? ORDER BY id DESC LIMIT 1').get(orderId);
  return { order, customer, property, employee, items, invoice };
}

function pdfFilename(invoice, suffix = '') {
  const safe = `${invoice.number}${suffix}`.replace(/[^A-Za-z0-9._-]+/g, '-');
  return `${safe}.pdf`;
}

export function invoicePdf(invoiceId, { dunning = null, persist = false, einvoiceXml = null } = {}) {
  const data = loadInvoiceData(invoiceId);
  if (!data) return null;
  const settings = getSettings();
  const buffer = renderInvoicePdf({ ...data, settings, dunning, einvoiceXml });
  const suffix = dunning ? `-Mahnung-${dunning.level}` : '';
  const filename = pdfFilename(data.invoice, suffix);
  const relative = join('dokumente', filename);
  if (persist || !dunning) {
    writeFileSync(join(PDF_DIR, filename), buffer);
    if (!dunning) {
      db.prepare('UPDATE invoices SET pdf_path = ? WHERE id = ?').run(relative, invoiceId);
    }
  }
  return { buffer, filename, relative };
}

export function ensureInvoicePdfs() {
  const invoices = db.prepare('SELECT * FROM invoices').all();
  for (const invoice of invoices) {
    const target = join(DATA_DIR, invoice.pdf_path || '');
    if (!invoice.pdf_path || !existsSync(target)) {
      invoicePdf(invoice.id, { persist: true });
    }
  }
}

export function nextDocumentNumber(scope) {
  const settings = getSettings();
  const prefix = scope === 'order' ? settings.order_prefix : settings.quote_prefix;
  return nextNumber(scope, prefix);
}

export function adjustStock(articleId, quantity, reason, refType = null, refId = null) {
  if (!articleId) return;
  db.prepare('UPDATE articles SET stock = ROUND(stock + ?, 3) WHERE id = ?').run(quantity, articleId);
  db.prepare(
    'INSERT INTO stock_movements (article_id, quantity, reason, ref_type, ref_id) VALUES (?,?,?,?,?)'
  ).run(articleId, quantity, reason, refType, refId);
}

export function createInvoiceFromOrder(orderId, { date = todayISO(), dueDays = null, notes = '' } = {}) {
  const data = loadOrderData(orderId);
  if (!data) throw new Error('Auftrag nicht gefunden');
  const { order, items, customer } = data;
  if (order.doc_type === 'angebot') throw new Error('Angebote müssen zuerst in einen Auftrag umgewandelt werden');
  if (order.status === 'storniert') throw new Error('Stornierte Aufträge können nicht abgerechnet werden');
  const existing = db.prepare('SELECT id, number FROM invoices WHERE order_id = ?').get(orderId);
  if (existing) throw new Error(`Für diesen Auftrag existiert bereits die Rechnung ${existing.number}`);

  const positions = items.length
    ? items
    : order.labor_hours > 0
      ? [{ kind: 'arbeit', description: 'Ausgeführte Arbeiten', quantity: order.labor_hours, unit: 'Std', unit_price: order.labor_rate }]
      : [];

  if (!positions.length) throw new Error('Der Auftrag hat keine abrechenbaren Positionen');

  const settings = getSettings();
  const taxRate = Number(order.tax_rate) || Number(settings.default_tax_rate);
  const totals = invoiceTotals(positions, taxRate);
  const paymentDays = Number(dueDays ?? customer?.payment_terms_days ?? settings.payment_days);
  const dueDate = addDays(date, paymentDays);
  const number = nextNumber('invoice', settings.invoice_prefix);

  db.exec('BEGIN');
  let invoiceId;
  try {
    invoiceId = Number(db.prepare(
      `INSERT INTO invoices (number, order_id, customer_id, property_id, date, due_date, service_date, status, tax_rate,
         subtotal, tax_total, total, notes, buyer_reference)
       VALUES (?,?,?,?,?,?,?,'offen',?,?,?,?,?,?)`
    ).run(number, order.id, order.customer_id, order.property_id, date, dueDate,
      (order.completed_at ? String(order.completed_at).slice(0, 10) : date), taxRate,
      totals.subtotal, totals.tax, totals.total, notes,
      customer?.leitweg_id || customer?.buyer_reference || number).lastInsertRowid);

    positions.forEach((item, index) => {
      db.prepare(
        `INSERT INTO invoice_items (invoice_id, kind, article_id, description, quantity, unit, unit_price, sort)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(invoiceId, item.kind ?? 'material', item.article_id ?? null, item.description,
        item.quantity, item.unit ?? 'Stk', item.unit_price, index);
    });

    db.prepare(
      `UPDATE orders SET status = 'abgerechnet', invoiced_at = datetime('now'), completed_at = COALESCE(completed_at, datetime('now'))
       WHERE id = ?`
    ).run(order.id);

    for (const item of positions) {
      if (item.kind === 'material' && item.article_id && Number(item.quantity) > 0) {
        adjustStock(item.article_id, -Math.abs(Number(item.quantity)), `Verbrauch Rechnung ${number}`, 'invoice', invoiceId);
      }
    }

    logActivity('rechnung', `Rechnung ${number} über ${totals.total.toFixed(2)} € aus Auftrag ${order.number} erstellt.`);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const created = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  try {
    const pdf = invoicePdf(invoiceId, { persist: true });
    archiveInvoicePdf(created, pdf?.buffer);
  } catch (error) {
    logActivity('fehler', `Dokumentenarchiv für ${number}: ${error.message}`);
  }
  return created;
}

export function recalcInvoice(invoiceId) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) return null;
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoiceId);
  const totals = invoiceTotals(items, invoice.tax_rate);
  const payments = db.prepare('SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = ?').get(invoiceId);
  const paid = round2(payments.paid);
  let status = invoice.status;
  if (invoice.status !== 'storniert') {
    if (paid >= totals.total - 0.005 && totals.total > 0) status = 'bezahlt';
    else if (paid > 0) status = 'teilweise';
    else status = invoice.dunning_level > 0 ? 'gemahnt' : 'offen';
  }
  db.prepare(
    'UPDATE invoices SET subtotal = ?, tax_total = ?, total = ?, paid_total = ?, status = ? WHERE id = ?'
  ).run(totals.subtotal, totals.tax, totals.total, paid, status, invoiceId);
  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
}

export function recordPayment(invoiceId, { date = todayISO(), amount, method = 'Überweisung', note = '' }) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) throw new Error('Rechnung nicht gefunden');
  if (invoice.status === 'storniert') throw new Error('Stornierte Rechnungen können nicht bezahlt werden');
  const value = round2(Number(amount));
  if (!value || value <= 0) throw new Error('Bitte einen gültigen Betrag angeben');

  db.prepare(
    'INSERT INTO payments (invoice_id, date, amount, method, note) VALUES (?,?,?,?,?)'
  ).run(invoiceId, date, value, method, note);
  const updated = recalcInvoice(invoiceId);
  logActivity('zahlung', `Zahlungseingang ${value.toFixed(2)} € für Rechnung ${invoice.number} verbucht.`);
  return updated;
}

export function createDunning(invoiceId) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) throw new Error('Rechnung nicht gefunden');
  if (invoice.status === 'bezahlt' || invoice.status === 'storniert') {
    throw new Error('Für diese Rechnung ist keine Mahnung möglich');
  }
  const settings = getSettings();
  const level = Number(invoice.dunning_level) + 1;
  const open = round2(Number(invoice.total) - Number(invoice.paid_total));
  if (open <= 0) throw new Error('Es ist kein offener Betrag vorhanden');

  db.prepare("UPDATE invoices SET dunning_level = ?, status = 'gemahnt', dunning_date = ? WHERE id = ?")
    .run(level, todayISO(), invoiceId);

  const dunning = {
    level,
    fee: Number(settings.dunning_fee) || 0,
    newDueDate: addDays(todayISO(), 7),
  };
  const refreshed = loadInvoiceData(invoiceId);
  const buffer = renderInvoicePdf({ ...refreshed, settings, dunning });
  const filename = pdfFilename(refreshed.invoice, `-Mahnung-${level}`);
  writeFileSync(join(PDF_DIR, filename), buffer);

  logActivity('mahnung', `${level}. Mahnung für Rechnung ${invoice.number} über ${open.toFixed(2)} € erzeugt.`);
  return { invoice: db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId), buffer, filename, dunning };
}

export function orderPdf(orderId) {
  const data = loadOrderData(orderId);
  if (!data) return null;
  const settings = getSettings();
  const buffer = renderOrderPdf({ ...data, settings, docType: data.order.doc_type });
  const prefix = data.order.doc_type === 'angebot' ? 'Angebot' : 'Auftrag';
  const filename = `${prefix}-${data.order.number}.pdf`.replace(/[^A-Za-z0-9._-]+/g, '-');
  writeFileSync(join(PDF_DIR, filename), buffer);
  return { buffer, filename };
}

export function invoiceStats() {
  const row = db.prepare(
    `SELECT
       COUNT(*) AS count,
       COALESCE(SUM(total), 0) AS total,
       COALESCE(SUM(paid_total), 0) AS paid,
       COALESCE(SUM(CASE WHEN status IN ('offen','teilweise','gemahnt') THEN total - paid_total ELSE 0 END), 0) AS open
     FROM invoices WHERE status != 'storniert'`
  ).get();
  return row;
}
