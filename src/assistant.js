import { db, getSettings, round2 } from './db.js';

const deDate = (iso) => {
  if (!iso) return '';
  const [year, month, day] = String(iso).slice(0, 10).split('-');
  return `${day}.${month}.${year}`;
};

const euro = (value) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0);

function customerName(customer) {
  return customer?.company || [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || 'Kunde';
}

function greet(customer) {
  if (customer?.salutation === 'Herr') return `Sehr geehrter Herr ${customer.last_name || ''},`;
  if (customer?.salutation === 'Frau') return `Sehr geehrte Frau ${customer.last_name || ''},`;
  if (customer?.company) return `Guten Tag ${customer.company},`;
  return 'Guten Tag,';
}

/**
 * Lokaler Textassistent: arbeitet ausschließlich mit den vorhandenen Daten.
 * Kein externer KI-Dienst, keine Datenübermittlung.
 */
export function draftText({ kind = 'angebot', orderId = null, invoiceId = null, customerId = null, extra = '' } = {}) {
  const settings = getSettings();
  let order = null;
  let invoice = null;
  let customer = null;

  if (invoiceId) {
    invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
    if (invoice) customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(invoice.customer_id);
  }
  if (orderId) {
    order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (order && !customer) customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id);
  }
  if (customerId && !customer) customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) throw new Error('Bitte einen Kunden, Auftrag oder eine Rechnung auswählen');

  const name = customerName(customer);
  const company = settings.company_name || 'HandwerkPro';
  const items = order
    ? db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort, id').all(order.id)
    : invoice
      ? db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort, id').all(invoice.id)
      : [];
  const net = round2(items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0));
  const taxRate = Number(order?.tax_rate ?? invoice?.tax_rate ?? settings.default_tax_rate ?? 19);
  const gross = round2(net * (1 + taxRate / 100));
  const positions = items.map((item, index) =>
    `${index + 1}. ${item.description} – ${Number(item.quantity).toLocaleString('de-DE')} ${item.unit || ''} × ${euro(item.unit_price)} = ${euro(Number(item.quantity) * Number(item.unit_price))}`
  ).join('\n');

  if (kind === 'mahnung') {
    const open = round2(Number(invoice?.total || gross) - Number(invoice?.paid_total || 0));
    return {
      title: `Zahlungserinnerung ${invoice?.number || ''}`.trim(),
      text: `${greet(customer)}

zu der Rechnung ${invoice?.number || ''} vom ${deDate(invoice?.date)} über ${euro(invoice?.total || gross)} konnten wir bis heute keinen vollständigen Zahlungseingang feststellen.

Offener Betrag: ${euro(open)}
Ursprünglich fällig: ${deDate(invoice?.due_date)}

Wir bitten Sie, den offenen Betrag zu überweisen. Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.

Mit freundlichen Grüßen
${company}`,
      meta: { open_amount: open, invoice_number: invoice?.number || null },
    };
  }

  if (kind === 'zusammenfassung') {
    const time = order
      ? db.prepare(
        `SELECT COALESCE(SUM((julianday(COALESCE(end_at, datetime('now'))) - julianday(start_at)) * 24), 0) AS hours
         FROM time_entries WHERE order_id = ?`
      ).get(order.id)
      : { hours: 0 };
    const reports = order
      ? db.prepare('SELECT COUNT(*) AS n FROM reports WHERE order_id = ?').get(order.id).n
      : 0;
    const photos = order
      ? db.prepare('SELECT COUNT(*) AS n FROM photos WHERE order_id = ?').get(order.id).n
      : 0;
    return {
      title: `Zusammenfassung ${order?.number || invoice?.number || ''}`.trim(),
      text: `Kunde: ${name}
${order ? `Auftrag: ${order.number} – ${order.title}\nStatus: ${order.status}` : `Rechnung: ${invoice?.number || ''}`}
Positionen: ${items.length}
Netto: ${euro(net)} · Brutto: ${euro(gross)}
${order ? `Erfasste Zeit: ${Number(time.hours).toFixed(2)} Std.\nBerichte: ${reports} · Fotos: ${photos}` : ''}
${extra ? `\nHinweis: ${extra}` : ''}`,
      meta: { net, gross, positions: items.length },
    };
  }

  if (kind === 'checkliste') {
    const templates = db.prepare("SELECT * FROM checklist_templates WHERE active = 1 ORDER BY name").all();
    const template = templates.find((row) => String(row.trade || '').toLowerCase().includes(String(settings.trade || '').toLowerCase()))
      || templates[0];
    let points = [];
    try { points = JSON.parse(template?.items || '[]'); } catch { points = []; }
    return {
      title: `Checkliste ${order?.title || template?.name || ''}`.trim(),
      text: points.map((point) => `- [ ] ${point}`).join('\n') || '- [ ] Baustelle prüfen',
      meta: { template_id: template?.id ?? null },
    };
  }

  if (kind === 'email') {
    return {
      title: `E-Mail an ${name}`,
      text: `Betreff: ${order ? `Ihr Auftrag ${order.number}` : `Ihre Rechnung ${invoice?.number || ''}`}

${greet(customer)}

${extra || 'gerne senden wir Ihnen die gewünschten Informationen.'}

${order ? `Auftrag: ${order.number} – ${order.title}\nTermin: ${deDate(order.scheduled_date) || 'nach Absprache'}` : ''}
${invoice ? `Rechnung: ${invoice.number}\nBetrag: ${euro(invoice.total)}\nFällig: ${deDate(invoice.due_date)}` : ''}

Bei Rückfragen erreichen Sie uns unter ${settings.company_phone || settings.company_email || ''}.

Mit freundlichen Grüßen
${company}`,
      meta: {},
    };
  }

  // Standard: Angebotstext
  return {
    title: `Angebot ${order?.number || ''}`.trim(),
    text: `${greet(customer)}

vielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen folgende Leistungen an:

${positions || '– noch keine Positionen erfasst –'}

Zwischensumme netto: ${euro(net)}
zzgl. ${taxRate} % USt.: ${euro(gross - net)}
Gesamtbetrag: ${euro(gross)}

${extra || 'Das Angebot ist 30 Tage gültig. Für Rückfragen stehen wir Ihnen gerne zur Verfügung.'}

Mit freundlichen Grüßen
${company}`,
    meta: { net, gross, positions: items.length },
  };
}
