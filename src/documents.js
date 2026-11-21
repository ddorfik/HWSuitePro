import { PDF, euro, deDate, deNumber } from './pdf.js';

const W = 595.28;
const H = 841.89;
const ML = 50;
const MR = 50;
const RIGHT = W - MR;
const CONTENT = RIGHT - ML;
const PETROL = '#0f4c5c';
const PETROL_LIGHT = '#e6f0f2';
const INK = '#111827';
const GREY = '#6b7280';
const LINE = '#d9dee3';

const SALUTATION = (customer) => {
  if (customer.salutation === 'Frau') return `Sehr geehrte Frau ${customer.last_name || ''},`;
  if (customer.salutation === 'Herr') return `Sehr geehrter Herr ${customer.last_name || ''},`;
  return 'Sehr geehrte Damen und Herren,';
};

function recipientLines(customer) {
  const lines = [];
  if (customer.type === 'Firma' && customer.company) {
    lines.push(customer.company);
    const contact = [customer.first_name, customer.last_name].filter(Boolean).join(' ');
    if (contact) lines.push(`z. Hd. ${contact}`);
  } else {
    lines.push([customer.first_name, customer.last_name].filter(Boolean).join(' '));
  }
  if (customer.street) lines.push(customer.street);
  lines.push([customer.zip, customer.city].filter(Boolean).join(' '));
  return lines.filter(Boolean);
}

function footer(doc, settings, pageLabel = '') {
  const y = H - 46;
  doc.line(ML, y, RIGHT, y, { color: LINE });
  doc.text(
    `${settings.company_name} · ${settings.company_street} · ${settings.company_zip} ${settings.company_city} · Tel. ${settings.company_phone} · ${settings.company_email}`,
    ML, y + 12, { size: 7.5, color: GREY }
  );
  doc.text(
    `USt-IdNr. ${settings.vat_id} · Steuernr. ${settings.tax_number} · ${settings.bank_name} · IBAN ${settings.iban} · BIC ${settings.bic}`,
    ML, y + 23, { size: 7.5, color: GREY }
  );
  if (pageLabel) doc.textRight(pageLabel, RIGHT, y + 12, { size: 7.5, color: GREY });
}

function header(doc, settings, { label, number, subtitle, info = [], recipient, introY = 0 }) {
  doc.rect(0, 0, W, 8, { fill: PETROL });

  doc.text(settings.company_name, ML, 52, { size: 16, bold: true, color: PETROL });
  doc.text(settings.trade_tagline || settings.trade || 'Handwerkersoftware', ML, 66, { size: 8.5, color: GREY });
  doc.text(`${settings.company_street} · ${settings.company_zip} ${settings.company_city}`, ML, 81, { size: 8.5, color: GREY });
  doc.text(`Tel. ${settings.company_phone} · ${settings.company_email}`, ML, 92, { size: 8.5, color: GREY });

  doc.textRight(label, RIGHT, 52, { size: label.length > 14 ? 15 : 20, bold: true, color: PETROL });
  if (number) doc.textRight(number, RIGHT, 68, { size: 11, color: INK });

  let infoY = 96;
  for (const row of info) {
    doc.textRight(`${row.label}:`, RIGHT - 92, infoY, { size: 8.5, color: GREY });
    doc.textRight(String(row.value ?? '–'), RIGHT, infoY, { size: 8.5, color: INK });
    infoY += 12;
  }

  const recipientTop = 136;
  doc.text(
    `${settings.company_name} · ${settings.company_street} · ${settings.company_zip} ${settings.company_city}`,
    ML, recipientTop - 12, { size: 7, color: GREY }
  );
  recipientLines(recipient).forEach((line, index) => {
    doc.text(line, ML, recipientTop + index * 13, { size: index === 0 ? 10.5 : 10, bold: index === 0, color: INK });
  });

  doc.line(ML, 206, RIGHT, 206, { color: LINE });
  if (subtitle) doc.text(subtitle, ML, 224, { size: 11, bold: true, color: INK });
  return introY || 248;
}

function tableHeader(doc, y, columns, { fill = PETROL, color = '#ffffff' } = {}) {
  doc.rect(ML, y, CONTENT, 22, { fill });
  for (const col of columns) {
    if (col.align === 'right') doc.textRight(col.label, col.x, y + 14, { size: 8.5, bold: true, color });
    else doc.text(col.label, col.x, y + 14, { size: 8.5, bold: true, color });
  }
  return y + 22;
}

function itemTable(doc, settings, items, startY, { showPrices = true } = {}) {
  const cols = [
    { key: 'pos', label: 'Pos.', x: ML + 6 },
    { key: 'desc', label: 'Beschreibung', x: ML + 34 },
    { key: 'qty', label: 'Menge', x: 352, align: 'right' },
    { key: 'unit', label: 'Einheit', x: 362 },
    ...(showPrices ? [
      { key: 'price', label: 'Einzelpreis', x: 455, align: 'right' },
      { key: 'total', label: 'Gesamt', x: RIGHT - 6, align: 'right' },
    ] : []),
  ];
  let y = tableHeader(doc, startY, cols);
  let page = 1;

  items.forEach((item, index) => {
    const descWidth = 250;
    const lines = doc.wrap(item.description, descWidth, 9.5);
    const rowHeight = Math.max(20, lines.length * 11 + 9);
    if (y + rowHeight > H - 110) {
      footer(doc, settings, `Seite ${page}`);
      doc.addPage();
      page += 1;
      doc.text('Fortsetzung', ML, 50, { size: 9, color: GREY });
      y = tableHeader(doc, 66, cols);
    }
    lines.forEach((line, lineIndex) => {
      doc.text(line, ML + 34, y + 13 + lineIndex * 11, { size: 9.5, color: INK });
    });
    doc.text(String(index + 1), ML + 6, y + 13, { size: 9.5, color: GREY });
    doc.textRight(deNumber(item.quantity, 2), 352, y + 13, { size: 9.5 });
    doc.text(item.unit || '', 362, y + 13, { size: 9.5, color: GREY });
    if (showPrices) {
      doc.textRight(euro(item.unit_price), 455, y + 13, { size: 9.5 });
      doc.textRight(euro(item.quantity * item.unit_price), RIGHT - 6, y + 13, { size: 9.5, bold: true });
    }
    doc.line(ML, y + rowHeight, RIGHT, y + rowHeight, { color: LINE, width: 0.4 });
    y += rowHeight;
  });

  return { y, page };
}

function totalsBlock(doc, y, { subtotal, tax, total, taxRate, paid = null, label = 'Gesamtbetrag' }) {
  const boxW = 250;
  const boxX = RIGHT - boxW;
  y += 12;
  doc.text('Zwischensumme netto', boxX, y + 6, { size: 9.5, color: GREY });
  doc.textRight(euro(subtotal), RIGHT, y + 6, { size: 9.5 });
  doc.text(`zzgl. ${deNumber(taxRate, 0)} % USt.`, boxX, y + 21, { size: 9.5, color: GREY });
  doc.textRight(euro(tax), RIGHT, y + 21, { size: 9.5 });

  doc.rect(boxX - 10, y + 30, boxW + 10, 28, { fill: PETROL_LIGHT });
  doc.text(label, boxX, y + 48, { size: 11, bold: true, color: PETROL });
  doc.textRight(euro(total), RIGHT - 2, y + 48, { size: 13, bold: true, color: PETROL });

  let next = y + 66;
  if (paid != null && paid > 0) {
    doc.text('abzüglich Zahlungen', boxX, next + 4, { size: 9, color: GREY });
    doc.textRight(`- ${euro(paid)}`, RIGHT, next + 4, { size: 9, color: GREY });
    doc.text('Offener Betrag', boxX, next + 19, { size: 10, bold: true });
    doc.textRight(euro(Math.max(0, total - paid)), RIGHT, next + 19, { size: 11, bold: true });
    next += 34;
  }
  return next;
}

function paymentBox(doc, y, settings, { dueDays, dueDate, intro }) {
  y = Math.max(y + 10, y);
  const text = (intro || settings.invoice_footer)
    .replaceAll('{days}', String(dueDays))
    .replaceAll('{due}', deDate(dueDate));
  const lines = doc.wrap(text, CONTENT - 28, 9);
  const height = 46 + lines.length * 12;
  if (y + height > H - 100) {
    doc.addPage();
    y = 70;
  }
  doc.rect(ML, y, CONTENT, height, { fill: '#f4f7f8', stroke: '#e2e8ea' });
  doc.text('Zahlungsinformationen', ML + 14, y + 16, { size: 9, bold: true, color: PETROL });
  lines.forEach((line, index) => doc.text(line, ML + 14, y + 31 + index * 12, { size: 9, color: '#374151' }));
  doc.text(
    `${settings.bank_name} · IBAN ${settings.iban} · BIC ${settings.bic}`,
    ML + 14, y + height - 12, { size: 8.5, color: GREY }
  );
  return y + height;
}

function closing(doc, y, settings) {
  y += 26;
  if (y > H - 160) return y;
  doc.text('Mit freundlichen Grüßen', ML, y, { size: 9.5, color: INK });
  doc.text(settings.company_name, ML, y + 40, { size: 9.5, bold: true, color: INK });
  doc.text(settings.company_owner, ML, y + 54, { size: 8.5, color: GREY });
  return y + 54;
}

export function renderInvoicePdf(data) {
  const { settings, invoice, customer, property, items, order, dunning } = data;
  const docLabel = invoice.kind === 'abschlag' ? 'Abschlagsrechnung' : 'Rechnung';
  const doc = new PDF({ title: `${docLabel} ${invoice.number}`, author: settings.company_name });
  const isDunning = Boolean(dunning);
  const label = isDunning
    ? (dunning.level > 1 ? `${dunning.level}. Mahnung` : 'Zahlungserinnerung')
    : (invoice.kind === 'abschlag' ? 'ABSCHLAGSRECHNUNG' : 'RECHNUNG');

  const info = [
    { label: 'Rechnungsnr.', value: invoice.number },
    { label: 'Rechnungsdatum', value: deDate(invoice.date) },
    { label: 'Leistungsdatum', value: deDate(invoice.service_date || invoice.date) },
    { label: 'Kundennr.', value: customer.number },
  ];
  if (order?.number) info.push({ label: 'Auftrag', value: order.number });
  info.push({ label: 'Fällig am', value: deDate(invoice.due_date) });
  if (property) info.push({ label: 'Objekt', value: property.label });

  let y = header(doc, settings, {
    label,
    number: isDunning ? invoice.number : null,
    subtitle: isDunning
      ? `Offener Rechnungsbetrag aus Rechnung ${invoice.number}`
      : (order?.title > '' ? order.title : `Rechnung ${invoice.number}`),
    info,
    recipient: customer,
  });

  if (isDunning) {
    const paid = Number(invoice.paid_total) || 0;
    const open = Math.max(0, Number(invoice.total) - paid);
    y = doc.paragraph(
      `Sehr geehrte Damen und Herren,\n\nzu der unten aufgeführten Rechnung konnten wir bis heute keinen vollständigen Zahlungseingang feststellen. ` +
      `Wir bitten Sie, den offenen Betrag von ${euro(open)} bis zum ${deDate(dunning.newDueDate)} zu überweisen.`,
      ML, y, CONTENT, { size: 9.5, lineHeight: 13 }
    );
    y += 18;

    const rows = [
      ['Rechnungsnummer', invoice.number],
      ['Rechnungsdatum', deDate(invoice.date)],
      ['Ursprünglich fällig', deDate(invoice.due_date)],
      ['Rechnungsbetrag', euro(invoice.total)],
      ['Zahlungen', `- ${euro(paid)}`],
      ['Offener Betrag', euro(open)],
    ];
    doc.rect(ML, y, CONTENT, rows.length * 18 + 14, { fill: '#faf6ef', stroke: '#e8dcc8' });
    rows.forEach(([key, value], index) => {
      const bold = key === 'Offener Betrag';
      doc.text(key, ML + 14, y + 24 + index * 18, { size: 9.5, bold, color: bold ? PETROL : GREY });
      doc.textRight(value, RIGHT - 14, y + 24 + index * 18, { size: bold ? 11 : 9.5, bold, color: bold ? PETROL : INK });
    });
    y += rows.length * 18 + 32;

    y = doc.paragraph(
      `Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos. ` +
      `Bei Rückfragen stehen wir Ihnen gerne unter ${settings.company_phone} zur Verfügung.` +
      (dunning.fee ? `\n\nHinweis: Es wird eine Mahngebühr in Höhe von ${euro(dunning.fee)} geltend gemacht.` : ''),
      ML, y, CONTENT, { size: 9.5, lineHeight: 13 }
    );
    y += 16;
  } else {
    const greeting = SALUTATION(customer);
    const intro = `${greeting}\n\n${settings.invoice_intro}`;
    y = doc.paragraph(intro, ML, y, CONTENT, { size: 9.5, lineHeight: 13 });
    y += 6;
  }

  const table = isDunning ? { y } : itemTable(doc, settings, items, y + 6);
  y = table.y;

  if (!isDunning) {
    y = totalsBlock(doc, y, {
      subtotal: invoice.subtotal,
      tax: invoice.tax_total,
      total: invoice.total,
      taxRate: invoice.tax_rate,
      paid: null,
    });
  }

  if (invoice.notes && !isDunning) {
    y += 14;
    if (y < H - 150) {
      doc.text('Hinweis', ML, y, { size: 8.5, bold: true, color: GREY });
      doc.paragraph(invoice.notes, ML, y + 13, CONTENT - 20, { size: 8.5, color: '#4b5563', lineHeight: 11 });
    }
  }

  if (isDunning) {
    y = paymentBox(doc, y + 16, settings, {
      dueDays: 7,
      dueDate: dunning.newDueDate,
      intro: 'Bitte überweisen Sie den offenen Betrag bis zum {due} auf das unten genannte Konto.',
    });
  } else {
    y = paymentBox(doc, y + 16, settings, {
      dueDays: settings.payment_days,
      dueDate: invoice.due_date,
    });
  }

  if (!isDunning) closing(doc, y, settings);
  footer(doc, settings, `Seite ${doc.pages.length}`);
  if (data.einvoiceXml) {
    doc.attach({
      name: `${String(invoice.number).replace(/[^A-Za-z0-9._-]+/g, '-')}-zugferd.xml`,
      mime: 'text/xml',
      data: data.einvoiceXml,
      description: 'ZUGFeRD-Rechnungsdaten (CII)',
    });
  }
  return doc.build();
}

const ORDER_DOC_TYPES = {
  angebot: { label: 'ANGEBOT', title: 'Angebot', numberLabel: 'Angebotsnr.' },
  auftrag: { label: 'AUFTRAG', title: 'Auftrag', numberLabel: 'Auftragsnr.' },
  auftragsbestaetigung: { label: 'AUFTRAGSBESTÄTIGUNG', title: 'Auftragsbestätigung', numberLabel: 'Auftragsnr.' },
  lieferschein: { label: 'LIEFERSCHEIN', title: 'Lieferschein', numberLabel: 'Lieferscheinnr.' },
};

export function renderOrderPdf(data) {
  const { settings, order, customer, property, employee, items, docType = 'auftrag' } = data;
  const kind = ORDER_DOC_TYPES[docType] ? docType : 'auftrag';
  const meta = ORDER_DOC_TYPES[kind];
  const isQuote = kind === 'angebot';
  const isDelivery = kind === 'lieferschein';
  const doc = new PDF({
    title: `${meta.title} ${order.number}`,
    author: settings.company_name,
  });

  const info = [
    { label: meta.numberLabel, value: order.number },
    { label: 'Datum', value: deDate(order.created_at) },
    { label: 'Kundennr.', value: customer.number },
  ];
  if (order.scheduled_date) info.push({ label: 'Termin', value: deDate(order.scheduled_date) });
  if (employee) info.push({ label: 'Monteur', value: employee.name });
  if (property) info.push({ label: 'Objekt', value: property.label });

  let y = header(doc, settings, {
    label: meta.label,
    number: null,
    subtitle: `${meta.title} ${order.number} · ${order.title}`,
    info,
    recipient: customer,
  });

  if (order.description) {
    y = doc.paragraph(order.description, ML, y, CONTENT, { size: 9.5, lineHeight: 13 }) + 10;
  }

  if (kind === 'auftragsbestaetigung') {
    y = doc.paragraph(
      'vielen Dank für Ihren Auftrag. Wir bestätigen die Ausführung der nachstehend aufgeführten Leistungen zu den vereinbarten Konditionen.',
      ML, y, CONTENT, { size: 9.5, lineHeight: 13 }
    ) + 10;
  } else if (isDelivery) {
    y = doc.paragraph(
      'wir liefern Ihnen die nachstehend aufgeführten Positionen. Die Berechnung erfolgt separat mit der Rechnung.',
      ML, y, CONTENT, { size: 9.5, lineHeight: 13 }
    ) + 10;
  }

  const table = itemTable(doc, settings, items, y + 6, { showPrices: !isDelivery });
  y = table.y;

  if (!isDelivery) {
    const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
    const net = round2(items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0));
    const tax = round2((net * order.tax_rate) / 100);
    y = totalsBlock(doc, y, {
      subtotal: net,
      tax,
      total: round2(net + tax),
      taxRate: order.tax_rate,
      label: isQuote ? 'Gesamtbetrag' : 'Auftragssumme',
    });
  }

  if (property && (property.street || property.city)) {
    y += 16;
    if (y < H - 130) {
      doc.text('Ausführungsort', ML, y, { size: 8.5, bold: true, color: GREY });
      doc.text(
        `${property.label} · ${property.street}, ${property.zip} ${property.city}`,
        ML, y + 13, { size: 9, color: '#374151' }
      );
    }
  }

  if (isDelivery) {
    y += 34;
    if (y < H - 120) {
      doc.text('Ware erhalten am / Unterschrift Empfänger', ML, y, { size: 8.5, color: GREY });
      doc.line(ML, y + 34, 280, y + 34, { color: '#9ca3af' });
      doc.text('Ort, Datum', 320, y, { size: 8.5, color: GREY });
      doc.line(320, y + 34, RIGHT, y + 34, { color: '#9ca3af' });
    }
  }

  if (isQuote) {
    y += 30;
    if (y < H - 170) {
      doc.paragraph(
        'Dieses Angebot ist 30 Tage gültig. Die Preise verstehen sich inklusive der gesetzlichen Umsatzsteuer. ' +
        'Für Rückfragen und die Terminabstimmung stehen wir Ihnen gerne zur Verfügung.',
        ML, y, CONTENT, { size: 9, color: '#374151', lineHeight: 12 }
      );
      y += 34;
      doc.text('Ort, Datum', ML, y, { size: 8.5, color: GREY });
      doc.text('Unterschrift Auftraggeber', 320, y, { size: 8.5, color: GREY });
      doc.line(ML, y + 34, 230, y + 34, { color: '#9ca3af' });
      doc.line(320, y + 34, RIGHT, y + 34, { color: '#9ca3af' });
    }
  }

  footer(doc, settings, `Seite ${doc.pages.length}`);
  return doc.build();
}
