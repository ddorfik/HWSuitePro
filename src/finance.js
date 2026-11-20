import { randomBytes } from 'node:crypto';
import { db, getSettings, todayISO, round2 } from './db.js';
import { recordPayment } from './billing.js';

const pad = (value) => String(value).padStart(2, '0');

function parseAmount(raw) {
  let text = String(raw ?? '').replace(/\s|€/g, '').replace(/\u00a0/g, '');
  if (!text) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  if (/-$/.test(text)) { negative = true; text = text.slice(0, -1); }
  if (text.startsWith('-')) { negative = true; text = text.slice(1); }
  if (text.includes(',') && text.includes('.')) {
    text = text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (text.includes(',')) {
    text = text.replace(',', '.');
  }
  const value = Number(text);
  return Number.isFinite(value) ? (negative ? -value : value) : 0;
}

function parseDate(raw) {
  const text = String(raw ?? '').trim();
  let match = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(text);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${pad(match[2])}-${pad(match[1])}`;
  }
  match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return todayISO();
}

function splitLines(text) {
  return String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
}

function detectDelimiter(line) {
  for (const candidate of [';', '\t', ',']) {
    if (line.split(candidate).length > 3) return candidate;
  }
  return ';';
}

function parseCsvLine(line, delimiter) {
  const out = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { out.push(current); current = ''; }
    else current += char;
  }
  out.push(current);
  return out.map((value) => value.trim());
}

const FIELD_HINTS = {
  date: ['buchungstag', 'buchungsdatum', 'datum', 'valuta', 'valutadatum', 'date'],
  amount: ['betrag', 'umsatz', 'amount', 'betrag eur'],
  purpose: ['verwendungszweck', 'buchungstext', 'purpose', 'verwendungszweck1', 'text'],
  counterparty: ['auftraggeber', 'empfänger', 'empfaenger', 'name', 'beguenstigter', 'zahlungspflichtiger', 'counterparty'],
  iban: ['iban', 'kontonummer', 'konto'],
  reference: ['kundenreferenz', 'referenz', 'reference', 'endtoendid'],
};

function mapHeader(header) {
  const normalized = header.map((cell) => String(cell || '').trim().toLowerCase());
  const mapping = {};
  for (const [key, hints] of Object.entries(FIELD_HINTS)) {
    const index = normalized.findIndex((cell) => hints.some((hint) => cell === hint || cell.includes(hint)));
    if (index >= 0) mapping[key] = index;
  }
  return mapping;
}

export function parseBankCsv(text) {
  const lines = splitLines(text);
  if (!lines.length) return [];
  const delimiter = detectDelimiter(lines[0]);
  const header = parseCsvLine(lines[0], delimiter);
  const mapping = mapHeader(header);
  if (mapping.amount == null || mapping.date == null) {
    throw new Error('CSV nicht erkannt: Spalten für Datum und Betrag fehlen');
  }
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line, delimiter);
    const value = {
      date: parseDate(cells[mapping.date]),
      amount: round2(parseAmount(cells[mapping.amount])),
      purpose: String(cells[mapping.purpose] ?? '').slice(0, 1000),
      counterparty: String(cells[mapping.counterparty] ?? '').slice(0, 300),
      iban: String(cells[mapping.iban] ?? '').replace(/\s+/g, '').slice(0, 40),
      reference: String(cells[mapping.reference] ?? '').slice(0, 200),
    };
    return value;
  }).filter((row) => row.amount !== 0 && row.date);
}

function pick(block, regex) {
  const match = regex.exec(block);
  return match ? match[1].trim() : '';
}

export function parseCamt053(text) {
  const xml = String(text || '');
  if (!/<(?:Document|BkToCstmrStmt)/i.test(xml)) return [];
  const entries = xml.match(/<(?:\w+:)?Ntry>[\s\S]*?<\/(?:\w+:)?Ntry>/g) || [];
  return entries.map((block) => {
    const amount = round2(parseAmount(pick(block, /<(?:\w+:)?Amt[^>]*>([\d.,]+)</)));
    const indicator = pick(block, /<(?:\w+:)?CdtDbtInd>([^<]+)</).toUpperCase();
    const signed = indicator === 'DBIT' ? -amount : amount;
    const date = parseDate(pick(block, /<(?:\w+:)?BookgDt>[\s\S]*?<(?:\w+:)?Dt>([^<]+)</)
      || pick(block, /<(?:\w+:)?ValDt>[\s\S]*?<(?:\w+:)?Dt>([^<]+)</));
    const purpose = [pick(block, /<(?:\w+:)?Ustrd>([^<]+)</), pick(block, /<(?:\w+:)?AddtlNtryInf>([^<]+)</)]
      .filter(Boolean).join(' ').slice(0, 1000);
    const counterparty = pick(block, /<(?:\w+:)?RltdPties>[\s\S]*?<(?:\w+:)?Nm>([^<]+)</)
      || pick(block, /<(?:\w+:)?Dbtr>[\s\S]*?<(?:\w+:)?Nm>([^<]+)</)
      || pick(block, /<(?:\w+:)?Cdtr>[\s\S]*?<(?:\w+:)?Nm>([^<]+)</);
    const iban = pick(block, /<(?:\w+:)?IBAN>([^<]+)</);
    return {
      date,
      amount: signed,
      purpose,
      counterparty: counterparty.slice(0, 300),
      iban: iban.replace(/\s+/g, '').slice(0, 40),
      reference: pick(block, /<(?:\w+:)?EndToEndId>([^<]+)</).slice(0, 200),
    };
  }).filter((row) => row.amount !== 0);
}

export function parseBankFile(text) {
  return /<\?xml|<Document/i.test(String(text || '')) ? parseCamt053(text) : parseBankCsv(text);
}

export function importBankTransactions(text, { filename = '', userId = null } = {}) {
  const rows = parseBankFile(text);
  if (!rows.length) throw new Error('Keine Buchungen in der Datei gefunden');
  if (rows.length > 5000) throw new Error('Zu viele Buchungen (maximal 5000 pro Import)');
  const batch = `BANK-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  let imported = 0;
  let skipped = 0;
  const insert = db.prepare(
    `INSERT INTO bank_transactions (date, amount, purpose, counterparty, iban, reference, batch, imported_by)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const exists = db.prepare(
    `SELECT 1 FROM bank_transactions WHERE date = ? AND amount = ? AND COALESCE(purpose, '') = ? AND COALESCE(iban, '') = ?`
  );
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      if (exists.get(row.date, row.amount, row.purpose || '', row.iban || '')) { skipped += 1; continue; }
      insert.run(row.date, row.amount, row.purpose || '', row.counterparty || '', row.iban || '',
        row.reference || '', batch, userId ?? null);
      imported += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  autoMatchTransactions();
  return { batch, filename, imported, skipped, total: rows.length };
}

export function listBankTransactions({ from = '', to = '', status = '', unmatched = false, q = '' } = {}) {
  const clauses = [];
  const values = [];
  if (from) { clauses.push('b.date >= ?'); values.push(String(from).slice(0, 10)); }
  if (to) { clauses.push('b.date <= ?'); values.push(String(to).slice(0, 10)); }
  if (status) { clauses.push('b.status = ?'); values.push(String(status)); }
  if (unmatched) clauses.push('b.invoice_id IS NULL');
  if (q) {
    const needle = `%${String(q).trim()}%`;
    clauses.push('(b.purpose LIKE ? OR b.counterparty LIKE ? OR b.reference LIKE ? OR b.iban LIKE ?)');
    values.push(needle, needle, needle, needle);
  }
  return db.prepare(
    `SELECT b.*, i.number AS invoice_number, i.total AS invoice_total, i.paid_total AS invoice_paid,
       c.company, c.first_name, c.last_name
     FROM bank_transactions b
     LEFT JOIN invoices i ON i.id = b.invoice_id
     LEFT JOIN customers c ON c.id = i.customer_id
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY b.date DESC, b.id DESC LIMIT 1000`
  ).all(...values);
}

function invoiceOpenAmount(invoice) {
  return round2(Number(invoice.total) - Number(invoice.paid_total));
}

export function autoMatchTransactions() {
  const transactions = db.prepare(
    "SELECT * FROM bank_transactions WHERE invoice_id IS NULL AND amount > 0 ORDER BY date"
  ).all();
  const invoices = db.prepare(
    "SELECT * FROM invoices WHERE status IN ('offen','teilweise','gemahnt') ORDER BY date"
  ).all();
  let matched = 0;
  for (const transaction of transactions) {
    const haystack = `${transaction.purpose} ${transaction.reference} ${transaction.counterparty}`.toUpperCase();
    const open = invoices.filter((invoice) => invoiceOpenAmount(invoice) > 0);
    let best = open.find((invoice) => invoice.number && haystack.includes(String(invoice.number).toUpperCase()));
    if (!best) {
      best = open.find((invoice) =>
        Math.abs(invoiceOpenAmount(invoice) - Number(transaction.amount)) < 0.01
        && Math.abs((new Date(invoice.date) - new Date(transaction.date)) / 86400000) <= 120);
    }
    if (best) {
      db.prepare("UPDATE bank_transactions SET invoice_id = ?, status = 'zugeordnet' WHERE id = ?")
        .run(best.id, transaction.id);
      matched += 1;
    }
  }
  return { matched };
}

export function unmatchTransaction(id) {
  db.prepare("UPDATE bank_transactions SET invoice_id = NULL, status = 'offen' WHERE id = ?").run(id);
  return db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id);
}

export function bookTransaction(id, { invoiceId = null, userId = null, note = '' } = {}) {
  const transaction = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id);
  if (!transaction) throw new Error('Buchung nicht gefunden');
  if (transaction.status === 'verbucht') throw new Error('Diese Buchung ist bereits verbucht');
  if (Number(transaction.amount) <= 0) throw new Error('Nur Eingänge können einer Rechnung zugeordnet werden');
  const targetId = Number(invoiceId || transaction.invoice_id);
  if (!targetId) throw new Error('Bitte eine Rechnung auswählen');
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(targetId);
  if (!invoice) throw new Error('Rechnung nicht gefunden');
  if (invoice.status === 'storniert') throw new Error('Stornierte Rechnungen können nicht bezahlt werden');
  const open = invoiceOpenAmount(invoice);
  if (Number(transaction.amount) > open + 0.01) {
    throw new Error(`Der Betrag ist höher als der offene Rechnungsbetrag (${open.toFixed(2)} €)`);
  }
  db.exec('BEGIN');
  try {
    recordPayment(invoice.id, {
      date: transaction.date,
      amount: transaction.amount,
      method: 'Bankabgleich',
      note: note || transaction.purpose || 'Zahlungseingang',
    });
    db.prepare("UPDATE bank_transactions SET invoice_id = ?, status = 'verbucht' WHERE id = ?")
      .run(invoice.id, transaction.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return {
    transaction: db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(transaction.id),
    invoice: db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id),
    user_id: userId,
  };
}

/* ------------------------------------------------------------------ DATEV */

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const deDate = (iso) => {
  const [year, month, day] = String(iso || todayISO()).slice(0, 10).split('-');
  return `${day}${month}${year}`;
};

/**
 * Buchungsstapel im DATEV-EXTF-Format (Format 700).
 * Enthält Debitoren, Erlöse, Umsatzsteuer und Zahlungseingänge.
 * Die Kontenrahmen-Zuordnung ist konfigurierbar und sollte mit dem Steuerberater abgestimmt werden.
 */
export function datevExport({ from = '', to = '' } = {}) {
  const settings = getSettings();
  const rangeFrom = String(from || `${new Date().getFullYear()}-01-01`).slice(0, 10);
  const rangeTo = String(to || todayISO()).slice(0, 10);
  const invoices = db.prepare(
    `SELECT i.*, c.company, c.first_name, c.last_name FROM invoices i
     JOIN customers c ON c.id = i.customer_id
     WHERE i.status != 'storniert' AND i.date BETWEEN ? AND ?
     ORDER BY i.date, i.id`
  ).all(rangeFrom, rangeTo);
  const revenueAccount = String(settings.datev_account_revenue || '8400');
  const debtorAccount = String(settings.datev_account_receivable || '10000');
  const bankAccount = String(settings.datev_account_bank || '1200');
  const taxAccount = '1776';

  const header = [
    'EXTF', '700', '510', '21', 'Buchungsstapel',
    settings.company_name || 'HandwerkPro',
    settings.datev_consultant || '', settings.datev_client || '',
    `${rangeFrom.slice(8, 10)}${rangeFrom.slice(5, 7)}${rangeFrom.slice(0, 4)}`,
    `${rangeTo.slice(8, 10)}${rangeTo.slice(5, 7)}${rangeTo.slice(0, 4)}`,
    `${rangeFrom.slice(0, 4)}`, '1', '0', '0', '', '', 'STANDARD', '1', '1', '0', '0', '0', '0', '', '', '',
  ];
  const columns = [
    'Umsatz', 'Soll/Haben-Kennzeichen', 'WKZ', 'Kurs', 'Konto', 'Gegenkonto',
    'BU-Schlüssel', 'Belegdatum', 'Belegfeld 1', 'Belegfeld 2', 'Buchungstext',
  ];
  const lines = [
    `EXTF;700;510;21;${header.slice(4).map(csvCell).join(';')}`,
    columns.map(csvCell).join(';'),
  ];
  const booking = (amount, side, account, counterAccount, bu, date, reference, text) => [
    amount.toFixed(2).replace('.', ','), side, '', '', account, counterAccount, bu,
    date, csvCell(reference), csvCell(''), csvCell(text),
  ].join(';');

  for (const invoice of invoices) {
    const name = invoice.company || `${invoice.first_name} ${invoice.last_name}`.trim();
    const text = `Rechnung ${invoice.number} ${name}`.slice(0, 60);
    const subtotal = round2(invoice.subtotal);
    const tax = round2(invoice.tax_total);
    const total = round2(invoice.total);
    lines.push(booking(total, 'S', debtorAccount, revenueAccount, '', deDate(invoice.date), invoice.number, text));
    lines.push(booking(subtotal, 'H', revenueAccount, debtorAccount, '', deDate(invoice.date), invoice.number, text));
    if (tax > 0) {
      lines.push(booking(tax, 'H', taxAccount, debtorAccount, '9', deDate(invoice.date), invoice.number, `USt. ${invoice.tax_rate}% ${invoice.number}`.slice(0, 60)));
    }
    const paid = round2(invoice.paid_total);
    if (paid > 0) {
      lines.push(booking(paid, 'S', bankAccount, debtorAccount, '', deDate(invoice.date), invoice.number, `Zahlung ${invoice.number}`.slice(0, 60)));
    }
  }

  return {
    filename: `DATEV-Buchungsstapel-${rangeFrom}-${rangeTo}.csv`,
    content: `\uFEFF${lines.join('\r\n')}\r\n`,
    count: invoices.length,
  };
}

/* ------------------------------------------------------------------ SEPA */

export function validIban(iban) {
  const clean = String(iban || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(clean)) return false;
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (char) => String(char.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

export function sepaPreview(invoiceIds = []) {
  const settings = getSettings();
  const ids = invoiceIds.map(Number).filter(Boolean);
  const rows = db.prepare(
    `SELECT i.*, c.company, c.first_name, c.last_name, c.iban, c.bic, c.sepa_mandate
     FROM invoices i JOIN customers c ON c.id = i.customer_id
     WHERE i.status IN ('offen','teilweise','gemahnt')
       ${ids.length ? `AND i.id IN (${ids.map(() => '?').join(',')})` : ''}
     ORDER BY i.due_date, i.id`
  ).all(...ids).map((invoice) => ({
    ...invoice,
    open_amount: invoiceOpenAmount(invoice),
    iban_valid: validIban(invoice.iban),
    name: invoice.company || `${invoice.first_name} ${invoice.last_name}`.trim(),
  }));
  return {
    creditor: settings.company_name,
    debtor_iban: String(settings.iban || '').replace(/\s+/g, ''),
    rows,
    payable: rows.filter((row) => row.open_amount > 0 && row.iban_valid),
    invalid: rows.filter((row) => row.open_amount > 0 && !row.iban_valid),
  };
}

export function sepaExport({ invoiceIds = [], executionDate = null } = {}) {
  const settings = getSettings();
  const preview = sepaPreview(invoiceIds);
  const rows = preview.payable;
  if (!rows.length) throw new Error('Keine Rechnung mit gültiger IBAN und offenem Betrag gefunden');
  const debtorIban = String(settings.iban || '').replace(/\s+/g, '').toUpperCase();
  if (!validIban(debtorIban)) throw new Error('Die IBAN des Betriebs ist ungültig oder nicht hinterlegt');
  const execution = String(executionDate || todayISO()).slice(0, 10);
  const total = round2(rows.reduce((sum, row) => sum + row.open_amount, 0));
  const messageId = `HP-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[char])).slice(0, 140);

  const transactions = rows.map((row) => `      <CdtTrfTxInf>
        <PmtId><EndToEndId>${escape(row.number)}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">${row.open_amount.toFixed(2)}</InstdAmt></Amt>
        ${row.bic ? `<CdtrAgt><FinInstnId><BIC>${escape(row.bic)}</BIC></FinInstnId></CdtrAgt>` : ''}
        <Cdtr><Nm>${escape(row.name)}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${escape(String(row.iban).replace(/\s+/g, '').toUpperCase())}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>Rechnung ${escape(row.number)}</Ustrd></RmtInf>
      </CdtTrfTxInf>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${messageId}</MsgId>
      <CreDtTm>${new Date().toISOString().slice(0, 19)}</CreDtTm>
      <NbOfTxs>${rows.length}</NbOfTxs>
      <CtrlSum>${total.toFixed(2)}</CtrlSum>
      <InitgPty><Nm>${escape(settings.company_name)}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${messageId}-1</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${rows.length}</NbOfTxs>
      <CtrlSum>${total.toFixed(2)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${execution}</ReqdExctnDt>
      <Dbtr><Nm>${escape(settings.company_name)}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${escape(debtorIban)}</IBAN></Id></DbtrAcct>
      ${settings.bic ? `<DbtrAgt><FinInstnId><BIC>${escape(settings.bic)}</BIC></FinInstnId></DbtrAgt>` : ''}
${transactions}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
  return {
    filename: `SEPA-${execution}.xml`,
    content: xml,
    count: rows.length,
    total,
  };
}

export function financeOverview() {
  const open = db.prepare(
    "SELECT COUNT(*) AS count, COALESCE(SUM(total - paid_total), 0) AS amount FROM invoices WHERE status IN ('offen','teilweise','gemahnt')"
  ).get();
  const bank = db.prepare(
    `SELECT
       COUNT(*) AS count,
       COALESCE(SUM(CASE WHEN invoice_id IS NULL THEN 1 ELSE 0 END), 0) AS unmatched,
       COALESCE(SUM(CASE WHEN invoice_id IS NULL AND amount > 0 THEN amount ELSE 0 END), 0) AS unmatched_amount,
       COALESCE(SUM(CASE WHEN status = 'verbucht' THEN 1 ELSE 0 END), 0) AS booked
     FROM bank_transactions`
  ).get();
  return { open_invoices: open, bank };
}
