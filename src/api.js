import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  db, getSettings, setSettings, logActivity, todayISO, addDays, round2,
} from './db.js';
import {
  createInvoiceFromOrder, invoicePdf, orderPdf, recordPayment, createDunning,
  recalcInvoice, loadInvoiceData, loadOrderData, adjustStock, invoiceStats,
  nextDocumentNumber, orderTotals, createProgressInvoice,
} from './billing.js';
import { runAutomation } from './automation.js';
import {
  authenticate, login, logout, changePassword, sessionCookie, clearSessionCookie,
  parseCookies, SESSION_COOKIE, checkLoginAllowed, registerLoginFailure, resetLoginFailures,
  getUserById, issueSession, deleteUserSessions, isSecureRequest, clientIp, TRUST_PROXY,
} from './auth.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  can, canAny, permissionsFor, roleLabel, ROLES,
} from './permissions.js';
import {
  parseMaterials, savePhoto, photoFile, photoMime, deletePhoto,
  runningTime, startTime, stopTime,
} from './work.js';
import { sendMail, mailConfigured } from './mail.js';
import {
  materialSources, MATERIAL_SECRET_SETTINGS, importCatalog, testSource, lookupMaterial,
  enrichArticle, catalogImportHistory, dealerDeepLink, gtinInfo,
} from './materials.js';
import { buildXRechnung, buildZugferdXml, xmlFilename } from './einvoice.js';
import {
  DOCUMENT_CATEGORIES, listDocuments, storeDocument, storeFromDataUrl, documentRow,
  documentFilePath, documentVersions, documentEvents, softDeleteDocument, logDocumentEvent,
  archiveInvoicePdf,
} from './dms.js';
import { orderCalculation, updateCalculation, applyCalculation } from './calc.js';
import {
  planningBoard, listResources, createResource, updateResource, deleteResource,
  createBooking, updateBooking, deleteBooking,
} from './resources.js';
import {
  ABSENCE_TYPES, ABSENCE_STATUS, listAbsences, createAbsence, decideAbsence, deleteAbsence,
  vacationAccount, setVacationEntitlement, overtimeAccount, hrOverview,
  listAdjustments, createAdjustment, CONTRACT_KINDS, listContracts, createContract,
  updateContract, deleteContract, listTimeCategories, createTimeCategory, updateTimeCategory,
  deleteTimeCategory, payrollMonth, payrollCsv, maternityProtection,
} from './hr.js';
import {
  parseBankFile, importBankTransactions, listBankTransactions, autoMatchTransactions,
  bookTransaction, unmatchTransaction, datevExport, sepaPreview, sepaExport, financeOverview,
} from './finance.js';
import {
  MEASUREMENT_CATEGORIES, measurementQuantity, listMeasurements, createMeasurement,
  updateMeasurement, deleteMeasurement, applyMeasurements, saveSignature, listSignatures,
  signatureRow, checklistTemplates, createChecklistTemplate, updateChecklistTemplate,
  deleteChecklistTemplate, orderChecklists, createOrderChecklist, updateChecklistEntry,
  addChecklistEntry, deleteChecklist, listDiary, createDiaryEntry, updateDiaryEntry,
  deleteDiaryEntry, siteSummary, signatureFilePath,
} from './site.js';
import {
  exportGaeb, importGaebToOrder, importOciToOrder, listWebhooks, createWebhook,
  updateWebhook, deleteWebhook, webhookDeliveries, testWebhook, emitWebhook,
  openapiDocument, exportGaebX84, exportOci, lexwareExport,
} from './interfaces.js';
import {
  lookupArticleByCode, listInventorySessions, createInventorySession, inventorySession,
  saveInventoryCount, closeInventorySession, deleteInventorySession,
} from './inventory.js';
import {
  TASK_STATUS, TASK_PRIORITIES, listTasks, createTask, updateTask, setTaskDone, deleteTask,
  listMessages, postMessage, listNotifications, unreadNotificationCount, markNotificationsRead,
  activityFeed,
} from './collab.js';
import {
  LEAD_SOURCES, leadStages, createLeadStage, updateLeadStage, deleteLeadStage,
  listLeads, getLead, createLead, updateLead, deleteLead, convertLead, publicLeadIntake,
  ensurePortalToken, revokePortalToken, portalData, portalPdfInvoice, portalMessage,
  notifyAppointmentConfirmed,
} from './crm.js';
import {
  listReservations, addReservation, updateReservation, deleteReservation, packlist,
  sendDealerOrder, orderForTransfer,
} from './warehouse.js';
import { draftText } from './assistant.js';
import {
  GEO_KINDS, geoStatus, updateGeoSettings, setHomeLocation, setOrderLocation, geoEvent, geoEvents,
} from './geo.js';

class HttpError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const routes = [];
const route = (method, path, handler, options = {}) => {
  routes.push({ method, segments: path.split('/').filter(Boolean), handler, options });
};

const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const str = (value) => (value == null ? '' : String(value).trim());
const bool = (value) => (value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0);
const coordinate = (value) => {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 1e7) / 1e7 : null;
};
const bodyBoolean = (value) => value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
const search = (value) => `%${str(value)}%`;

/** Absolute Adresse für Links in E-Mails (optional über Einstellungen festgelegt). */
const safeHostHeader = (value) => {
  const host = String(value || '').split(',')[0].trim().toLowerCase();
  return /^[a-z0-9.-]+(?::\d+)?$/.test(host) || /^\[[0-9a-f:]+\](?::\d+)?$/.test(host) ? host : '';
};

const publicBaseUrl = (req) => {
  const configured = str(getSettings().public_url);
  if (configured) {
    try {
      const url = new URL(configured);
      if (['http:', 'https:'].includes(url.protocol) && !/[\r\n]/.test(configured)) {
        return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
      }
    } catch { /* ungültige Adresse ignorieren */ }
  }
  // Forwarded-Header nur hinter einem vertrauenswürdigen Proxy auswerten.
  const forwardedHost = TRUST_PROXY ? safeHostHeader(req.headers['x-forwarded-host']) : '';
  const host = forwardedHost || safeHostHeader(req.headers.host) || 'localhost';
  const forwardedProto = TRUST_PROXY ? str(req.headers['x-forwarded-proto']).split(',')[0].trim().toLowerCase() : '';
  const proto = forwardedProto === 'https' || req.socket?.encrypted ? 'https' : 'http';
  return `${proto}://${host}`;
};

const escHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

const FINANCE_SETTINGS = ['tax_number', 'vat_id', 'register_court', 'register_number', 'bank_name', 'iban', 'bic', 'dunning_fee', 'default_labor_rate', 'default_tax_rate'];
const MAIL_SETTINGS = ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_password', 'smtp_from', 'smtp_from_name', 'mail_notify_replies', 'public_url'];

/**
 * Einstellungen je Rolle: Bank- und SMTP-Zugangsdaten bleiben bei den Rollen,
 * die sie benötigen. Das Passwort wird nie im Klartext ausgeliefert.
 */
function settingsForUser(settings, user) {
  const visible = { ...settings };
  if (!can(user, 'invoices.view')) {
    for (const key of FINANCE_SETTINGS) delete visible[key];
  }
  if (!can(user, 'settings.manage')) {
    for (const key of MAIL_SETTINGS) delete visible[key];
    for (const key of Object.keys(visible)) {
      if (key.startsWith('mat_')) delete visible[key];
    }
  } else {
    visible.smtp_password = visible.smtp_password ? '********' : '';
    for (const key of MATERIAL_SECRET_SETTINGS) {
      visible[key] = visible[key] ? '********' : '';
    }
  }
  return visible;
}

/** ISO-Zeitpunkt als deutsche Kurzform, z. B. „20.11.2026, 08:00". */
const deDateTime = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? str(value)
    : date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin' });
};

function pick(body, fields) {
  const out = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) out[field] = body[field];
  }
  return out;
}

/** Modulfehler (Validierung) als 400 ausliefern, echte Fehler bleiben 500. */
function asApi(fn) {
  const convert = (error) => {
    if (error?.status) throw error;
    throw new HttpError(400, error?.message || 'Ungültige Eingabe');
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') return result.catch(convert);
    return result;
  } catch (error) {
    return convert(error);
  }
}

const decodeUpload = (body = {}) => {
  if (body.dataUrl) {
    const match = /^data:([a-z0-9.+/-]+);base64,(.+)$/i.exec(String(body.dataUrl));
    if (!match) throw new HttpError(400, 'Ungültige Datei');
    return { buffer: Buffer.from(match[2], 'base64'), mime: match[1] };
  }
  if (body.base64) return { buffer: Buffer.from(String(body.base64), 'base64'), mime: str(body.mime) };
  if (body.content != null) return { buffer: Buffer.from(String(body.content), 'utf8'), mime: str(body.mime) || 'text/plain' };
  throw new HttpError(400, 'Bitte eine Datei übermitteln');
};

function insertRow(table, data) {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return Number(db.prepare(sql).run(...keys.map((key) => data[key])).lastInsertRowid);
}

function updateRow(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...keys.map((key) => data[key]), id);
}

function customerNumber() {
  const prefix = getSettings().customer_prefix || 'KD';
  let n = 1001;
  while (db.prepare('SELECT 1 FROM customers WHERE number = ?').get(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ Zugriff & Aufbereitung */
function hasAllOrders(user) {
  return can(user, 'orders.view.all');
}

function ownEmployeeId(user) {
  return user?.employee_id ?? -1;
}

function ownOrderClause(alias = 'o') {
  return `(${alias}.employee_id = ? OR EXISTS (
    SELECT 1 FROM appointments a WHERE a.order_id = ${alias}.id AND a.employee_id = ?
  ))`;
}

function assertOrderAccess(user, orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new HttpError(404, 'Auftrag nicht gefunden');
  if (hasAllOrders(user)) return order;
  const own = db.prepare(
    `SELECT 1 FROM orders o WHERE o.id = ? AND ${ownOrderClause('o')}`
  ).get(orderId, ownEmployeeId(user), ownEmployeeId(user));
  if (!own) throw new HttpError(403, 'Dieser Auftrag ist dir nicht zugewiesen');
  return order;
}

function assertReportAccess(user, reportId) {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
  if (!report) throw new HttpError(404, 'Bericht nicht gefunden');
  if (can(user, 'reports.view.all')) return report;
  const own = report.user_id === user.id
    || (user.employee_id != null && report.employee_id === user.employee_id);
  if (!own) throw new HttpError(403, 'Dieser Bericht gehört nicht zu deinen Aufträgen');
  return report;
}

function assertPhotoAccess(user, photo) {
  if (can(user, 'photos.manage')) return;
  if (user.employee_id != null && photo.employee_id === user.employee_id) return;
  assertOrderAccess(user, photo.order_id);
}

function assertCustomerAccess(user, customerId) {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) throw new HttpError(404, 'Kunde nicht gefunden');
  if (!hasAllOrders(user)) {
    const own = db.prepare(
      `SELECT 1 FROM orders o WHERE o.customer_id = ? AND ${ownOrderClause('o')}`
    ).get(customerId, ownEmployeeId(user), ownEmployeeId(user));
    if (!own) throw new HttpError(403, 'Dieser Kunde gehört nicht zu deinen Aufträgen');
  }
  return customer;
}

function customerNoteList(customerId) {
  return db.prepare(
    `SELECT n.id, n.customer_id, n.text, n.created_at, n.user_id,
       COALESCE(u.name, 'Unbekannt') AS user_name
     FROM customer_notes n
     LEFT JOIN users u ON u.id = n.user_id
     WHERE n.customer_id = ?
     ORDER BY n.created_at DESC, n.id DESC`
  ).all(customerId);
}

/* Einfache Bremse für öffentliche Endpunkte (pro IP und Zeitfenster). */
const requestCounts = new Map();
function rateLimit(ip, bucket, limit, windowMs) {
  const now = Date.now();
  const key = `${bucket}|${ip}`;
  let entry = requestCounts.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    requestCounts.set(key, entry);
  }
  entry.count += 1;
  if (requestCounts.size > 10000) {
    for (const [entryKey, value] of requestCounts) {
      if (value.resetAt <= now) requestCounts.delete(entryKey);
    }
  }
  return entry.count <= limit;
}

function publicRateLimit(req, bucket, limit = 60, windowMs = 60_000) {
  const ip = clientIp(req);
  if (!rateLimit(ip, bucket, limit, windowMs)) {
    throw new HttpError(429, 'Zu viele Anfragen – bitte kurz warten.');
  }
}

/* Terminbestätigung: Der Kunde bekommt einen Link mit zufälligem Token. */
const CONFIRM_TOKEN = /^[a-f0-9]{48}$/;

function appointmentByToken(token) {
  const value = str(token).toLowerCase();
  if (!CONFIRM_TOKEN.test(value)) throw new HttpError(404, 'Dieser Link ist ungültig');
  const row = db.prepare(
    `SELECT a.*, o.number AS order_number, o.title AS order_title, o.customer_id, o.property_id,
       e.name AS employee_name,
       c.salutation, c.company, c.first_name, c.last_name, c.street, c.zip, c.city,
       p.label AS property_label, p.street AS property_street, p.zip AS property_zip, p.city AS property_city
     FROM appointments a
     LEFT JOIN orders o ON o.id = a.order_id
     LEFT JOIN employees e ON e.id = a.employee_id
     LEFT JOIN customers c ON c.id = COALESCE(o.customer_id, a.customer_id)
     LEFT JOIN properties p ON p.id = o.property_id
     WHERE a.confirm_token = ?`
  ).get(value);
  if (!row) throw new HttpError(404, 'Dieser Link ist ungültig oder abgelaufen');
  return row;
}

/** Öffentliche Sicht auf einen Termin – nur das, was der Kunde sehen darf. */
const mailDate = (value, options = {}) => new Date(value).toLocaleDateString('de-DE', {
  weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin', ...options,
});
const mailTime = (value) => new Date(value).toLocaleTimeString('de-DE', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
});

function mailGreeting(customer) {
  const lastName = str(customer?.last_name);
  if (customer?.salutation === 'Herr' && lastName) return `Sehr geehrter Herr ${lastName},`;
  if (customer?.salutation === 'Frau' && lastName) return `Sehr geehrte Frau ${lastName},`;
  const company = str(customer?.company);
  if (company) return `Guten Tag ${company},`;
  return 'Guten Tag,';
}

function confirmationMail(req, appointment, customer, token) {
  const settings = getSettings();
  const link = `${publicBaseUrl(req)}/termin/${token}`;
  const date = mailDate(appointment.start_at);
  const time = `${mailTime(appointment.start_at)} – ${mailTime(appointment.end_at)} Uhr`;
  const address = [str(customer?.street), [str(customer?.zip), str(customer?.city)].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  const subject = `Terminbestätigung: ${date} um ${mailTime(appointment.start_at)} Uhr`;
  const companyLine = [settings.company_name, settings.company_phone].filter(Boolean).join(' · ');

  const text = [
    mailGreeting(customer),
    '',
    `wir möchten Sie an unseren Termin erinnern und bitten um eine kurze Bestätigung:`,
    '',
    `Datum: ${date}`,
    `Uhrzeit: ${time}`,
    appointment.title ? `Leistung: ${appointment.title}` : '',
    address ? `Ort: ${address}` : '',
    '',
    'Termin bestätigen oder absagen:',
    link,
    '',
    'Falls der Termin nicht passt, können Sie uns über denselben Link eine Nachricht schicken – wir melden uns dann mit einem neuen Vorschlag.',
    '',
    'Freundliche Grüße',
    settings.company_name,
    [settings.company_street, `${settings.company_zip} ${settings.company_city}`.trim()].filter(Boolean).join(', '),
    companyLine,
  ].filter((line) => line !== '').join('\n');

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#0f1c21;line-height:1.6">
    <p>${escHtml(mailGreeting(customer))}</p>
    <p>wir möchten Sie an unseren Termin erinnern und bitten um eine kurze Bestätigung:</p>
    <table style="border-collapse:collapse;margin:14px 0">
      <tr><td style="padding:3px 14px 3px 0;color:#64748b">Datum</td><td><b>${escHtml(date)}</b></td></tr>
      <tr><td style="padding:3px 14px 3px 0;color:#64748b">Uhrzeit</td><td><b>${escHtml(time)}</b></td></tr>
      ${appointment.title ? `<tr><td style="padding:3px 14px 3px 0;color:#64748b">Leistung</td><td>${escHtml(appointment.title)}</td></tr>` : ''}
      ${address ? `<tr><td style="padding:3px 14px 3px 0;color:#64748b">Ort</td><td>${escHtml(address)}</td></tr>` : ''}
    </table>
    <p style="margin:22px 0">
      <a href="${escHtml(link)}" style="background:#0f4c5c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Termin bestätigen</a>
    </p>
    <p style="font-size:13px;color:#64748b">Passt der Termin nicht? Über denselben Link können Sie uns absagen und einen Wunsch mitgeben.</p>
    <p style="margin-top:24px">Freundliche Grüße<br /><b>${escHtml(settings.company_name || '')}</b><br />
      ${escHtml([settings.company_street, `${settings.company_zip} ${settings.company_city}`.trim()].filter(Boolean).join(', '))}<br />
      ${escHtml(companyLine)}</p>
  </div>`;

  return { to: str(customer?.email), subject, text, html, link };
}

function publicAppointment(row) {
  const settings = getSettings();
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  const customerName = name || str(row.company) || '';
  return {
    appointment: {
      title: row.title,
      kind: row.kind || 'baustelle',
      kind_label: APPOINTMENT_KINDS[row.kind] || APPOINTMENT_KINDS.baustelle,
      location: str(row.location),
      start_at: row.start_at,
      end_at: row.end_at,
      confirmed_at: row.confirmed_at || null,
      declined_at: row.declined_at || null,
      customer_reply: row.customer_reply || '',
    },
    order: row.order_number ? { number: row.order_number, title: row.order_title } : null,
    customer: { name: customerName, salutation: str(row.salutation) },
    address: {
      label: str(row.property_label),
      street: str(row.property_street || row.street),
      zip: str(row.property_zip || row.zip),
      city: str(row.property_city || row.city),
    },
    employee: { name: str(row.employee_name) },
    company: {
      name: settings.company_name,
      phone: settings.company_phone,
      email: settings.company_email,
      city: settings.company_city,
    },
  };
}

function sanitizeEmployee(row) {
  if (!row) return row;
  const copy = { ...row };
  delete copy.rate;
  // Hausanschrift und GPS-Koordinaten gehören nicht in Auftragsdetails.
  delete copy.home_street;
  delete copy.home_zip;
  delete copy.home_city;
  delete copy.home_lat;
  delete copy.home_lng;
  delete copy.home_geo_at;
  return copy;
}

/** Entfernt Preise und Finanzdaten für Rollen ohne Rechnungsrecht. */
function sanitizeOrderData(data, user) {
  if (!data) return data;
  const showMoney = can(user, 'invoices.view');
  const { order, items, employee, invoice, totals, ...rest } = data;
  const cleanOrder = { ...order };
  const cleanItems = (items ?? []).map((item) => ({ ...item }));
  if (!showMoney) {
    delete cleanOrder.labor_rate;
    delete cleanOrder.tax_rate;
    cleanItems.forEach((item) => { delete item.unit_price; });
  }
  return {
    ...rest,
    ...(showMoney ? { totals } : {}),
    order: cleanOrder,
    items: cleanItems,
    employee: sanitizeEmployee(employee),
    invoice: showMoney ? invoice : null,
  };
}

function sanitizeCustomer(row, user) {
  if (!row || can(user, 'invoices.view')) return row;
  const copy = { ...row };
  delete copy.open_amount;
  delete copy.invoice_count;
  return copy;
}

function minutesBetween(start, end) {
  if (!start) return 0;
  const from = new Date(String(start).replace(' ', 'T') + (String(start).includes('Z') ? '' : 'Z'));
  const to = end
    ? new Date(String(end).replace(' ', 'T') + (String(end).includes('Z') ? '' : 'Z'))
    : new Date();
  return Math.max(0, Math.round((to - from) / 60000));
}

function decorateTime(entry) {
  if (!entry) return entry;
  return { ...entry, minutes: minutesBetween(entry.start_at, entry.end_at), running: !entry.end_at };
}

function timeRows(where, params) {
  return db.prepare(
    `SELECT t.*, e.name AS employee_name, e.color AS employee_color,
       u.name AS user_name, o.number AS order_number, o.title AS order_title
     FROM time_entries t
     LEFT JOIN employees e ON e.id = t.employee_id
     LEFT JOIN users u ON u.id = t.user_id
     LEFT JOIN orders o ON o.id = t.order_id
     ${where}
     ORDER BY t.start_at DESC, t.id DESC`
  ).all(...params).map(decorateTime);
}

function todayMinutes(user) {
  const row = db.prepare(
    `SELECT COALESCE(SUM((julianday(COALESCE(end_at, datetime('now'))) - julianday(start_at)) * 24 * 60), 0) AS minutes
     FROM time_entries WHERE user_id = ? AND date(start_at) = date('now')`
  ).get(user.id);
  return Math.max(0, Math.round(row?.minutes ?? 0));
}

function weekMinutes(user) {
  const row = db.prepare(
    `SELECT COALESCE(SUM((julianday(COALESCE(end_at, datetime('now'))) - julianday(start_at)) * 24 * 60), 0) AS minutes
     FROM time_entries WHERE user_id = ? AND date(start_at) >= date('now', '-6 days')`
  ).get(user.id);
  return Math.max(0, Math.round(row?.minutes ?? 0));
}

function reportRows(where, params) {
  return db.prepare(
    `SELECT r.*, o.number AS order_number, o.title AS order_title, o.status AS order_status,
       o.scheduled_date, c.company, c.first_name, c.last_name,
       e.name AS employee_name, e.color AS employee_color,
       u.name AS user_name,
       (SELECT COUNT(*) FROM report_materials m WHERE m.report_id = r.id) AS material_count,
       (SELECT COUNT(*) FROM photos p WHERE p.report_id = r.id) AS photo_count
     FROM reports r
     JOIN orders o ON o.id = r.order_id
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN employees e ON e.id = r.employee_id
     LEFT JOIN users u ON u.id = r.user_id
     ${where}
     ORDER BY r.created_at DESC, r.id DESC`
  ).all(...params);
}

function reportDetails(reportId) {
  const report = db.prepare(
    `SELECT r.*, o.number AS order_number, o.title AS order_title, o.status AS order_status,
       c.company, c.first_name, c.last_name, c.street AS customer_street, c.city AS customer_city,
       p.label AS property_label, p.street AS property_street,
       e.name AS employee_name, e.color AS employee_color, u.name AS user_name
     FROM reports r
     JOIN orders o ON o.id = r.order_id
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN properties p ON p.id = o.property_id
     LEFT JOIN employees e ON e.id = r.employee_id
     LEFT JOIN users u ON u.id = r.user_id
     WHERE r.id = ?`
  ).get(reportId);
  if (!report) return null;
  const materials = db.prepare(
    'SELECT * FROM report_materials WHERE report_id = ? ORDER BY id'
  ).all(reportId);
  const photos = db.prepare(
    'SELECT * FROM photos WHERE report_id = ? ORDER BY id'
  ).all(reportId);
  return { report, materials, photos };
}

function publicSettings() {
  const settings = getSettings();
  return {
    app_name: settings.app_name,
    trade: settings.trade,
    trade_tagline: settings.trade_tagline,
    company_name: settings.company_name,
    payment_days: settings.payment_days,
  };
}

function photoRow(photo) {
  return { ...photo, url: `/api/photos/${photo.id}/file` };
}

// ----------------------------------------------------------------- Dashboard
route('GET', '/api/dashboard', (req) => {
  const user = req.user;
  if (hasAllOrders(user)) return managementDashboard(user);
  if (can(user, 'orders.view.own')) return technicianDashboard(user);
  return hrDashboard(user);
}, { permission: 'dashboard.view' });

// Persönlicher Tag für alle Rollen mit eigenem Mitarbeiterkonto (Chef, Vorgesetzte, Monteure)
route('GET', '/api/my-day', (req) => {
  const user = req.user;
  const today = todayISO();
  const employeeId = ownEmployeeId(user);
  const employee = employeeId > 0
    ? db.prepare('SELECT id, name, color FROM employees WHERE id = ?').get(employeeId)
    : null;

  const rows = employeeId > 0 ? db.prepare(
    `SELECT a.*, o.number AS order_number, o.title AS order_title, o.status AS order_status,
       e.name AS employee_name, e.color AS employee_color,
       c.id AS customer_id, c.company, c.first_name, c.last_name,
       c.street AS customer_street, c.city AS customer_city,
       p.label AS property_label, p.street AS property_street, p.city AS property_city
     FROM appointments a
     LEFT JOIN orders o ON o.id = a.order_id
     LEFT JOIN employees e ON e.id = a.employee_id
     LEFT JOIN customers c ON c.id = COALESCE(o.customer_id, a.customer_id)
     LEFT JOIN properties p ON p.id = o.property_id
     WHERE a.employee_id = ? AND date(a.start_at) BETWEEN date(?) AND date(?, '+13 days')
     ORDER BY a.start_at`
  ).all(employeeId, today, today) : [];

  const isToday = (row) => String(row.start_at).slice(0, 10) === today;
  const kpis = {
    openOrders: hasAllOrders(user)
      ? db.prepare("SELECT COUNT(*) AS n FROM orders WHERE doc_type = 'auftrag' AND status IN ('neu','geplant','in_arbeit')").get().n
      : 0,
    reportsToApprove: can(user, 'reports.approve')
      ? db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'eingereicht'").get().n
      : 0,
    overdueInvoices: can(user, 'invoices.view')
      ? db.prepare(
        "SELECT COUNT(*) AS n FROM invoices WHERE status IN ('offen','teilweise','gemahnt') AND date(due_date) < date(?)"
      ).get(today).n
      : 0,
  };

  const teamToday = can(user, 'employees.view')
    ? db.prepare(
      `SELECT e.id, e.name, e.color, COUNT(a.id) AS appointments
       FROM employees e
       LEFT JOIN appointments a ON a.employee_id = e.id AND date(a.start_at) = date(?)
       WHERE e.active = 1
       GROUP BY e.id
       ORDER BY e.name`
    ).all(today)
    : [];

  return {
    today,
    employee,
    appointments: rows.filter(isToday),
    upcoming: rows.filter((row) => !isToday(row)),
    kpis,
    teamToday,
  };
}, { permission: 'dashboard.view' });

function managementDashboard(user) {
  const showMoney = can(user, 'invoices.view');
  const today = todayISO();
  const openOrders = db.prepare(
    `SELECT COUNT(*) AS n FROM orders WHERE status IN ('neu','geplant','in_arbeit')`
  ).get().n;
  const inProgress = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'in_arbeit'").get().n;
  const todayJobs = db.prepare(
    `SELECT COUNT(*) AS n FROM appointments WHERE date(start_at) = date(?)`
  ).get(today).n;
  const reportsOpen = db.prepare(
    "SELECT COUNT(*) AS n FROM reports WHERE status IN ('entwurf','eingereicht')"
  ).get().n;

  const openInvoices = showMoney
    ? db.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total - paid_total), 0) AS sum FROM invoices
       WHERE status IN ('offen','teilweise','gemahnt')`
    ).get()
    : { n: 0, sum: 0 };
  const overdue = showMoney
    ? db.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total - paid_total), 0) AS sum FROM invoices
       WHERE status IN ('offen','teilweise','gemahnt') AND date(due_date) < date(?)`
    ).get(today)
    : { n: 0, sum: 0 };
  const revenue = showMoney
    ? db.prepare(
      `SELECT COALESCE(SUM(total), 0) AS sum FROM invoices
       WHERE status != 'storniert' AND strftime('%Y-%m', date) = strftime('%Y-%m', date(?))`
    ).get(today)
    : { sum: 0 };
  const lowStock = db.prepare(
    'SELECT * FROM articles WHERE active = 1 AND stock <= min_stock ORDER BY (min_stock - stock) DESC LIMIT 8'
  ).all();

  const revenueByMonth = [];
  if (showMoney) {
    for (let i = 5; i >= 0; i -= 1) {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const row = db.prepare(
        `SELECT COALESCE(SUM(total), 0) AS sum FROM invoices
         WHERE status != 'storniert' AND strftime('%Y-%m', date) = ?`
      ).get(key);
      revenueByMonth.push({
        month: key,
        label: date.toLocaleDateString('de-DE', { month: 'short' }),
        value: round2(row.sum),
      });
    }
  }

  const appointments = db.prepare(
    `SELECT a.*, o.number AS order_number, o.title AS order_title, e.name AS employee_name, e.color AS employee_color,
       c.company, c.first_name, c.last_name
     FROM appointments a
     LEFT JOIN orders o ON o.id = a.order_id
     LEFT JOIN employees e ON e.id = a.employee_id
     LEFT JOIN customers c ON c.id = o.customer_id
     WHERE date(a.start_at) BETWEEN date(?) AND date(?, '+7 days')
     ORDER BY a.start_at LIMIT 12`
  ).all(today, today);

  const overdueInvoices = showMoney
    ? db.prepare(
      `SELECT i.*, c.company, c.first_name, c.last_name,
         CAST(julianday(date('now')) - julianday(i.due_date) AS INTEGER) AS days_overdue
       FROM invoices i JOIN customers c ON c.id = i.customer_id
       WHERE i.status IN ('offen','teilweise','gemahnt') AND date(i.due_date) < date(?)
       ORDER BY i.due_date LIMIT 6`
    ).all(today)
    : [];

  const recentOrders = db.prepare(
    `SELECT o.*, c.company, c.first_name, c.last_name FROM orders o
     JOIN customers c ON c.id = o.customer_id
     ORDER BY o.created_at DESC LIMIT 6`
  ).all();

  const recentReports = reportRows('WHERE r.status IN (\'entwurf\',\'eingereicht\')', []).slice(0, 5);
  const activity = db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 10').all();
  const stats = showMoney ? invoiceStats() : { count: 0, total: 0 };

  return {
    today,
    personal: false,
    kpis: {
      openOrders,
      inProgress,
      todayJobs,
      reportsOpen,
      openInvoiceCount: openInvoices.n,
      openInvoiceSum: round2(openInvoices.sum),
      overdueCount: overdue.n,
      overdueSum: round2(overdue.sum),
      revenueMonth: round2(revenue.sum),
      invoiceCount: stats.count,
      totalRevenue: round2(stats.total),
    },
    revenueByMonth,
    lowStock,
    appointments,
    overdueInvoices,
    recentOrders,
    recentReports,
    activity,
    finances: showMoney,
  };
}

function technicianDashboard(user) {
  const today = todayISO();
  const employeeId = ownEmployeeId(user);
  const own = ownOrderClause('o');
  const openOrders = db.prepare(
    `SELECT COUNT(*) AS n FROM orders o
     WHERE o.status IN ('neu','geplant','in_arbeit') AND ${own}`
  ).get(employeeId, employeeId).n;
  const inProgress = db.prepare(
    `SELECT COUNT(*) AS n FROM orders o WHERE o.status = 'in_arbeit' AND ${own}`
  ).get(employeeId, employeeId).n;
  const todayJobs = db.prepare(
    `SELECT COUNT(*) AS n FROM appointments a WHERE a.employee_id = ? AND date(a.start_at) = date(?)`
  ).get(employeeId, today).n;

  const orders = db.prepare(
    `SELECT o.*, c.company, c.first_name, c.last_name, c.street AS customer_street, c.city AS customer_city,
       p.label AS property_label, p.street AS property_street, e.name AS employee_name,
       (SELECT COUNT(*) FROM reports r WHERE r.order_id = o.id) AS report_count,
       (SELECT COUNT(*) FROM photos p2 WHERE p2.order_id = o.id) AS photo_count
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN properties p ON p.id = o.property_id
     LEFT JOIN employees e ON e.id = o.employee_id
     WHERE o.status NOT IN ('abgerechnet','storniert') AND ${own}
     ORDER BY CASE WHEN date(o.scheduled_date) = date(?) THEN 0 ELSE 1 END,
       COALESCE(o.scheduled_date, '9999-12-31'), o.priority = 'dringend' DESC, o.id DESC
     LIMIT 12`
  ).all(employeeId, employeeId, today).map((row) => {
    const copy = { ...row };
    delete copy.labor_rate;
    delete copy.tax_rate;
    return copy;
  });

  const appointments = db.prepare(
    `SELECT a.*, o.number AS order_number, o.title AS order_title, o.status AS order_status,
       c.company, c.first_name, c.last_name, c.street AS customer_street, c.city AS customer_city
     FROM appointments a
     LEFT JOIN orders o ON o.id = a.order_id
     LEFT JOIN customers c ON c.id = o.customer_id
     WHERE a.employee_id = ? AND date(a.start_at) BETWEEN date(?) AND date(?, '+7 days')
     ORDER BY a.start_at LIMIT 10`
  ).all(employeeId, today, today);

  const ownReports = reportRows(
    'WHERE (r.user_id = ? OR (r.employee_id IS NOT NULL AND r.employee_id = ?))',
    [user.id, ownEmployeeId(user)]
  ).slice(0, 5);

  const running = runningTime(user);
  return {
    today,
    personal: true,
    time: running ? decorateTime(running) : null,
    todayMinutes: todayMinutes(user),
    weekMinutes: weekMinutes(user),
    kpis: {
      openOrders,
      inProgress,
      todayJobs,
      reportsOpen: ownReports.filter((row) => ['entwurf', 'eingereicht'].includes(row.status)).length,
      myReports: ownReports.length,
    },
    orders,
    appointments,
    reports: ownReports,
  };
}

function hrDashboard(user) {
  const today = todayISO();
  const employees = db.prepare(
    `SELECT e.*, 
       (SELECT COALESCE(SUM((julianday(COALESCE(t.end_at, datetime('now'))) - julianday(t.start_at)) * 24 * 60), 0)
          FROM time_entries t WHERE t.employee_id = e.id AND date(t.start_at) = date('now')) AS today_minutes,
       (SELECT t.id FROM time_entries t WHERE t.employee_id = e.id AND t.end_at IS NULL ORDER BY t.id DESC LIMIT 1) AS running_id
     FROM employees e WHERE e.active = 1 ORDER BY e.name`
  ).all().map((row) => ({ ...sanitizeEmployee(row), today_minutes: Math.round(row.today_minutes || 0), running: Boolean(row.running_id) }));

  const week = db.prepare(
    `SELECT COALESCE(SUM((julianday(COALESCE(end_at, datetime('now'))) - julianday(start_at)) * 24 * 60), 0) AS minutes
     FROM time_entries WHERE date(start_at) >= date('now', '-6 days')`
  ).get();
  const entriesToday = db.prepare(
    `SELECT COUNT(*) AS n FROM time_entries WHERE date(start_at) = date('now')`
  ).get().n;
  const openReports = db.prepare(
    "SELECT COUNT(*) AS n FROM reports WHERE status IN ('entwurf','eingereicht')"
  ).get().n;
  const time = timeRows("WHERE date(t.start_at) = date('now')", []);
  const reports = reportRows('', []).slice(0, 6);

  return {
    today,
    hr: true,
    kpis: {
      employees: employees.length,
      todayEntries: entriesToday,
      weekHours: Math.round((week.minutes / 60) * 10) / 10,
      reportsOpen: openReports,
    },
    employees,
    time,
    reports,
  };
}


// ----------------------------------------------------------------- Anmeldung
const DEMO_PASSWORDS = {
  chef: 'chef123',
  buero: 'buero123',
  vorgesetzt: 'vorgesetzt123',
  monteur: 'monteur123',
  azubi: 'azubi123',
  hr: 'hr123',
};

/**
 * Konten, die noch das öffentlich bekannte Startpasswort verwenden.
 * scrypt ist absichtlich teuer – das Ergebnis wird deshalb zwischengespeichert.
 */
let demoAccountCache = null;
function demoAccountsWithDefaultPassword() {
  if (demoAccountCache) return demoAccountCache;
  const found = [];
  for (const [username, password] of Object.entries(DEMO_PASSWORDS)) {
    const row = db.prepare(
      'SELECT username, password_hash FROM users WHERE lower(username) = lower(?) AND active = 1'
    ).get(username);
    if (row && verifyPassword(password, row.password_hash)) found.push(row.username);
  }
  demoAccountCache = found;
  return found;
}

function invalidateDemoAccountCache() {
  demoAccountCache = null;
}

route('POST', '/api/auth/login', (req, res) => {
  const ip = clientIp(req);
  if (!checkLoginAllowed(ip)) {
    throw new HttpError(429, 'Zu viele Fehlversuche – bitte in einigen Minuten erneut versuchen.');
  }
  const result = login(req.body?.username, req.body?.password, req);
  if (result.error) {
    registerLoginFailure(ip);
    throw new HttpError(401, result.error);
  }
  resetLoginFailures(ip);
  res.setHeader('Set-Cookie', sessionCookie(result.token, req));
  const running = runningTime(result.user);
  return {
    user: result.user,
    settings: settingsForUser(getSettings(), result.user),
    time: running ? decorateTime(running) : null,
  };
}, { public: true });

route('POST', '/api/auth/logout', (req, res) => {
  logout(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  res.setHeader('Set-Cookie', clearSessionCookie(req));
  return { ok: true };
}, { authenticated: true });

route('GET', '/api/auth/me', (req) => {
  const running = runningTime(req.user);
  return {
    user: req.user,
    settings: settingsForUser(getSettings(), req.user),
    time: running ? decorateTime(running) : null,
    todayMinutes: todayMinutes(req.user),
    weekMinutes: weekMinutes(req.user),
  };
}, { authenticated: true });

route('GET', '/api/auth/meta', (req) => {
  const demoUsers = getSettings().demo_mode === '1' ? demoAccountsWithDefaultPassword() : [];
  return {
    app_name: getSettings().app_name,
    trade: getSettings().trade,
    trade_tagline: getSettings().trade_tagline,
    company_name: getSettings().company_name,
    secure: isSecureRequest(req),
    roles: Object.entries(ROLES).map(([key, role]) => ({
      key, label: role.label, short: role.short, description: role.description, color: role.color,
      permissions: permissionsFor(key),
    })),
    // Demo-Zugänge nur anzeigen, solange sie noch das Startpasswort haben und Demo-Modus aktiv ist.
    demo_users: demoUsers,
    demo_passwords: Object.fromEntries(demoUsers.map((username) => [username, DEMO_PASSWORDS[username]])),
  };
}, { public: true });

route('POST', '/api/auth/password', (req, res) => {
  try {
    changePassword(req.user.id, req.body?.currentPassword, req.body?.newPassword);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
  invalidateDemoAccountCache();
  // Nach dem Beenden aller Sitzungen sofort eine neue für dieses Gerät ausstellen.
  const token = issueSession(req.user.id, req);
  res.setHeader('Set-Cookie', sessionCookie(token, req));
  return { ok: true, user: getUserById(req.user.id) };
}, { authenticated: true });

// ----------------------------------------------------------------- Einstellungen
route('GET', '/api/settings', (req) => {
  const result = { settings: settingsForUser(getSettings(), req.user) };
  if (can(req.user, 'settings.manage')) {
    result.security = {
      https: isSecureRequest(req),
      demo_accounts: demoAccountsWithDefaultPassword(),
      must_change: db.prepare('SELECT COUNT(*) AS n FROM users WHERE must_change_password = 1').get().n,
    };
  }
  return result;
}, { authenticated: true });
route('PUT', '/api/settings', (req) => {
  const patch = { ...(req.body ?? {}) };
  // Platzhalter aus dem Formular niemals als Passwort speichern
  if (patch.smtp_password === '********') delete patch.smtp_password;
  for (const key of MATERIAL_SECRET_SETTINGS) {
    if (patch[key] === '********') delete patch[key];
  }
  return { settings: settingsForUser(setSettings(patch), req.user) };
}, { permission: 'settings.manage' });

route('POST', '/api/mail/test', async (req) => {
  const to = str(req.body?.to) || str(getSettings().company_email);
  if (!to) throw new HttpError(400, 'Bitte eine Empfängeradresse angeben');
  if (!mailConfigured()) {
    throw new HttpError(400, 'E-Mail-Versand ist noch nicht eingerichtet. Bitte SMTP-Server und Absender speichern.', 'mail_not_configured');
  }
  try {
    await sendMail({
      to,
      subject: `Testmail aus ${getSettings().app_name || 'HandwerkPro'}`,
      text: `Diese Testmail bestätigt, dass der E-Mail-Versand funktioniert.\n\nGesendet am ${new Date().toLocaleString('de-DE')}.`,
    });
  } catch (error) {
    throw new HttpError(400, error.message, 'mail_failed');
  }
  logActivity('system', `Testmail an ${to} gesendet.`);
  return { ok: true, to };
}, { permission: 'settings.manage' });

// ----------------------------------------------------------------- Kunden
route('GET', '/api/customers', (req, res, params, url) => {
  const q = search(url.searchParams.get('q'));
  const values = [q, q, q, q, q, q];
  let scope = '';
  if (!hasAllOrders(req.user)) {
    scope = `AND EXISTS (
      SELECT 1 FROM orders o WHERE o.customer_id = c.id AND ${ownOrderClause('o')}
    )`;
    values.push(ownEmployeeId(req.user), ownEmployeeId(req.user));
  }
  return db.prepare(
    `SELECT c.*,
       (SELECT COUNT(*) FROM properties p WHERE p.customer_id = c.id) AS property_count,
       (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS order_count,
       (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.status != 'storniert') AS invoice_count,
       (SELECT COALESCE(SUM(i.total - i.paid_total), 0) FROM invoices i
          WHERE i.customer_id = c.id AND i.status IN ('offen','teilweise','gemahnt')) AS open_amount
     FROM customers c
     WHERE (? = '%%' OR c.company LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?
        OR c.city LIKE ? OR c.number LIKE ?)
       ${scope}
     ORDER BY COALESCE(NULLIF(c.company, ''), c.last_name), c.first_name`
  ).all(...values).map((row) => sanitizeCustomer(row, req.user));
}, { permission: 'customers.view' });

route('GET', '/api/customers/:id', (req, res, params) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(params.id);
  if (!customer) throw new HttpError(404, 'Kunde nicht gefunden');
  if (!hasAllOrders(req.user)) {
    const own = db.prepare(
      `SELECT 1 FROM orders o WHERE o.customer_id = ? AND ${ownOrderClause('o')}`
    ).get(params.id, ownEmployeeId(req.user), ownEmployeeId(req.user));
    if (!own) throw new HttpError(403, 'Dieser Kunde gehört nicht zu deinen Aufträgen');
  }
  const properties = db.prepare('SELECT * FROM properties WHERE customer_id = ? ORDER BY label').all(params.id);
  const orders = db.prepare(
    `SELECT o.*, 
       (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM order_items oi WHERE oi.order_id = o.id) AS net
     FROM orders o WHERE o.customer_id = ? ORDER BY o.created_at DESC`
  ).all(params.id).map((row) => {
    if (can(req.user, 'invoices.view')) return row;
    const copy = { ...row };
    delete copy.net;
    delete copy.labor_rate;
    delete copy.tax_rate;
    return copy;
  });
  const invoices = can(req.user, 'invoices.view')
    ? db.prepare('SELECT * FROM invoices WHERE customer_id = ? ORDER BY date DESC').all(params.id)
    : [];
  return {
    customer: sanitizeCustomer(customer, req.user),
    properties,
    orders,
    invoices,
    notes: customerNoteList(customer.id),
  };
}, { permission: 'customers.view' });

// ----------------------------------------------------------------- Kunden-Notizen
route('GET', '/api/customers/:id/notes', (req, res, params) => {
  const customer = assertCustomerAccess(req.user, params.id);
  return customerNoteList(customer.id);
}, { permission: 'customers.view' });

route('POST', '/api/customers/:id/notes', (req, res, params) => {
  const customer = assertCustomerAccess(req.user, params.id);
  const text = str(req.body?.text);
  if (!text) throw new HttpError(400, 'Bitte eine Notiz eingeben');
  if (text.length > 4000) throw new HttpError(400, 'Notiz ist zu lang (maximal 4000 Zeichen)');
  insertRow('customer_notes', {
    customer_id: customer.id,
    user_id: req.user.id,
    text,
  });
  logActivity('kunde', `Notiz zu ${customer.company || `${customer.first_name} ${customer.last_name}`.trim()} hinzugefügt.`);
  return { notes: customerNoteList(customer.id) };
}, { permission: 'customers.manage' });

route('DELETE', '/api/customers/:id/notes/:noteId', (req, res, params) => {
  const customer = assertCustomerAccess(req.user, params.id);
  db.prepare('DELETE FROM customer_notes WHERE id = ? AND customer_id = ?')
    .run(num(params.noteId), customer.id);
  return { notes: customerNoteList(customer.id) };
}, { permission: 'customers.manage' });

route('POST', '/api/customers', (req) => {
  const body = req.body ?? {};
  if (!str(body.company) && !str(body.last_name)) {
    throw new HttpError(400, 'Bitte Firmenname oder Nachnamen angeben');
  }
  const data = {
    number: customerNumber(),
    type: str(body.type) || 'Firma',
    salutation: str(body.salutation) || (body.type === 'Privat' ? 'Herr' : 'Firma'),
    company: str(body.company),
    first_name: str(body.first_name),
    last_name: str(body.last_name),
    street: str(body.street),
    zip: str(body.zip),
    city: str(body.city),
    email: str(body.email),
    phone: str(body.phone),
    mobile: str(body.mobile),
    notes: str(body.notes),
    leitweg_id: str(body.leitweg_id),
    iban: str(body.iban).replace(/\s+/g, '').toUpperCase(),
    bic: str(body.bic).replace(/\s+/g, '').toUpperCase(),
    sepa_mandate: str(body.sepa_mandate),
    sepa_mandate_date: str(body.sepa_mandate_date) || null,
    payment_terms_days: body.payment_terms_days ? num(body.payment_terms_days) : null,
  };
  const id = insertRow('customers', data);
  logActivity('kunde', `Neuer Kunde ${data.company || `${data.first_name} ${data.last_name}`} angelegt.`);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  emitWebhook('customer.created', { id: customer.id, number: customer.number, name: data.company || `${data.first_name} ${data.last_name}` });
  return customer;
}, { permission: 'customers.manage' });

route('PUT', '/api/customers/:id', (req, res, params) => {
  const data = pick(req.body ?? {}, [
    'type', 'salutation', 'company', 'first_name', 'last_name', 'street', 'zip', 'city',
    'email', 'phone', 'mobile', 'notes', 'leitweg_id', 'iban', 'bic', 'sepa_mandate',
    'sepa_mandate_date', 'payment_terms_days',
  ]);
  if ('iban' in data) data.iban = str(data.iban).replace(/\s+/g, '').toUpperCase();
  if ('bic' in data) data.bic = str(data.bic).replace(/\s+/g, '').toUpperCase();
  if ('sepa_mandate_date' in data && !data.sepa_mandate_date) data.sepa_mandate_date = null;
  if ('payment_terms_days' in data) data.payment_terms_days = data.payment_terms_days ? num(data.payment_terms_days) : null;
  updateRow('customers', params.id, data);
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(params.id);
}, { permission: 'customers.manage' });

route('DELETE', '/api/customers/:id', (req, res, params) => {
  const orders = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?').get(params.id).n;
  if (orders > 0) throw new HttpError(409, 'Kunde hat Aufträge und kann nicht gelöscht werden');
  db.prepare('DELETE FROM customers WHERE id = ?').run(params.id);
  return { ok: true };
}, { permission: 'customers.manage' });

// ----------------------------------------------------------------- Objekte
route('GET', '/api/properties', (req, res, params, url) => {
  const customerId = url.searchParams.get('customer_id');
  const clauses = [];
  const values = [];
  if (customerId) {
    clauses.push('p.customer_id = ?');
    values.push(customerId);
  }
  if (!hasAllOrders(req.user)) {
    clauses.push(`EXISTS (
      SELECT 1 FROM orders o WHERE o.customer_id = p.customer_id AND ${ownOrderClause('o')}
    )`);
    values.push(ownEmployeeId(req.user), ownEmployeeId(req.user));
  }
  return db.prepare(
    `SELECT p.*, COALESCE(NULLIF(c.company, ''), c.last_name) AS customer_name
     FROM properties p JOIN customers c ON c.id = p.customer_id
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY c.company, p.label`
  ).all(...values);
}, { permission: 'customers.view' });

route('POST', '/api/properties', (req) => {
  const body = req.body ?? {};
  if (!body.customer_id) throw new HttpError(400, 'Bitte einen Kunden auswählen');
  if (!str(body.label)) throw new HttpError(400, 'Bitte eine Objektbezeichnung angeben');
  const id = insertRow('properties', {
    customer_id: num(body.customer_id),
    label: str(body.label),
    street: str(body.street),
    zip: str(body.zip),
    city: str(body.city),
    type: str(body.type) || 'Einfamilienhaus',
    gas_connection: bool(body.gas_connection ?? 1),
    water_connection: bool(body.water_connection ?? 1),
    heating_type: str(body.heating_type),
    meter_number: str(body.meter_number),
    latitude: coordinate(body.latitude),
    longitude: coordinate(body.longitude),
    notes: str(body.notes),
  });
  return db.prepare('SELECT * FROM properties WHERE id = ?').get(id);
}, { permission: 'customers.manage' });

route('PUT', '/api/properties/:id', (req, res, params) => {
  const data = pick(req.body ?? {}, [
    'customer_id', 'label', 'street', 'zip', 'city', 'type', 'gas_connection',
    'water_connection', 'heating_type', 'meter_number', 'notes', 'latitude', 'longitude',
  ]);
  if ('gas_connection' in data) data.gas_connection = bool(data.gas_connection);
  if ('water_connection' in data) data.water_connection = bool(data.water_connection);
  if ('latitude' in data) data.latitude = coordinate(data.latitude);
  if ('longitude' in data) data.longitude = coordinate(data.longitude);
  updateRow('properties', params.id, data);
  return db.prepare('SELECT * FROM properties WHERE id = ?').get(params.id);
}, { permission: 'customers.manage' });

route('DELETE', '/api/properties/:id', (req, res, params) => {
  db.prepare('DELETE FROM properties WHERE id = ?').run(params.id);
  return { ok: true };
}, { permission: 'customers.manage' });

// ----------------------------------------------------------------- Monteure
route('GET', '/api/employees', (req) => {
  const showRates = can(req.user, 'employees.rates');
  const showHome = can(req.user, 'employees.manage') || can(req.user, 'hr.manage');
  return db.prepare('SELECT * FROM employees ORDER BY active DESC, name').all()
    .map((row) => {
      const copy = { ...row };
      if (!showRates) delete copy.rate;
      if (!showHome && row.id !== req.user.employee_id) {
        delete copy.home_street;
        delete copy.home_zip;
        delete copy.home_city;
        delete copy.home_lat;
        delete copy.home_lng;
        delete copy.home_geo_at;
      }
      return copy;
    });
}, { permission: 'employees.view' });

route('POST', '/api/employees', (req) => {
  const body = req.body ?? {};
  if (!str(body.name)) throw new HttpError(400, 'Bitte einen Namen angeben');
  const id = insertRow('employees', {
    name: str(body.name),
    role: str(body.role) || 'Monteur',
    phone: str(body.phone),
    rate: num(body.rate),
    color: str(body.color) || '#0f766e',
    active: bool(body.active ?? 1),
    weekly_hours: body.weekly_hours !== undefined ? num(body.weekly_hours, 40) : num(getSettings().hr_weekly_hours, 40),
    vacation_days: body.vacation_days !== undefined ? num(body.vacation_days, 30) : num(getSettings().hr_vacation_days, 30),
    entry_date: str(body.entry_date) || null,
    exit_date: str(body.exit_date) || null,
    home_street: str(body.home_street),
    home_zip: str(body.home_zip),
    home_city: str(body.home_city),
  });
  return db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
}, { permission: 'employees.manage' });

route('PUT', '/api/employees/:id', (req, res, params) => {
  const data = pick(req.body ?? {}, ['name', 'role', 'phone', 'rate', 'color', 'active', 'weekly_hours', 'vacation_days', 'entry_date', 'exit_date', 'home_street', 'home_zip', 'home_city']);
  if ('active' in data) data.active = bool(data.active);
  if ('entry_date' in data && !data.entry_date) data.entry_date = null;
  if ('exit_date' in data && !data.exit_date) data.exit_date = null;
  updateRow('employees', params.id, data);
  return db.prepare('SELECT * FROM employees WHERE id = ?').get(params.id);
}, { permission: 'employees.manage' });

route('DELETE', '/api/employees/:id', (req, res, params) => {
  const used = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE employee_id = ?').get(params.id).n;
  if (used > 0) {
    updateRow('employees', params.id, { active: 0 });
    return { ok: true, deactivated: true };
  }
  db.prepare('DELETE FROM employees WHERE id = ?').run(params.id);
  return { ok: true };
}, { permission: 'employees.manage' });

// ----------------------------------------------------------------- Artikel / Lager
route('GET', '/api/articles', (req, res, params, url) => {
  const q = search(url.searchParams.get('q'));
  const low = url.searchParams.get('low') === '1';
  const rows = db.prepare(
    `SELECT a.*, ROUND(stock * purchase_price, 2) AS stock_value,
       CASE WHEN stock <= min_stock THEN 1 ELSE 0 END AS low,
       (SELECT COALESCE(SUM(r.quantity), 0) FROM order_reservations r
          WHERE r.article_id = a.id AND r.packed_at IS NULL) AS reserved
     FROM articles a
     WHERE (? = '%%' OR a.name LIKE ? OR a.number LIKE ? OR a.category LIKE ?
        OR a.gtin LIKE ? OR a.barcode LIKE ? OR a.manufacturer_number LIKE ?)
       ${low ? 'AND a.stock <= a.min_stock' : ''}
     ORDER BY a.category, a.name`
  ).all(q, q, q, q, q, q, q).map((row) => ({
    ...row,
    reserved: Number(row.reserved) || 0,
    available: Math.round((Number(row.stock) - Number(row.reserved) + Number.EPSILON) * 1000) / 1000,
  }));
  if (can(req.user, 'invoices.view')) return rows;
  return rows.map((row) => {
    const copy = { ...row };
    delete copy.purchase_price;
    delete copy.stock_value;
    return copy;
  });
}, { permission: 'warehouse.view' });

route('POST', '/api/articles', (req) => {
  const body = req.body ?? {};
  if (!str(body.name)) throw new HttpError(400, 'Bitte eine Artikelbezeichnung angeben');
  const id = insertRow('articles', {
    number: str(body.number) || `ART-${Date.now().toString().slice(-6)}`,
    name: str(body.name),
    category: str(body.category) || 'Allgemein',
    unit: str(body.unit) || 'Stk',
    purchase_price: num(body.purchase_price),
    sale_price: num(body.sale_price),
    stock: num(body.stock),
    min_stock: num(body.min_stock),
    supplier: str(body.supplier),
    active: bool(body.active ?? 1),
    gtin: str(body.gtin),
    manufacturer: str(body.manufacturer),
    manufacturer_number: str(body.manufacturer_number),
    etim_class: str(body.etim_class),
    datasheet_url: str(body.datasheet_url),
    image_url: str(body.image_url),
    source: str(body.source),
    source_id: str(body.source_id),
    price_unit: str(body.price_unit),
    barcode: str(body.barcode),
    location: str(body.location),
  });
  if (num(body.stock) !== 0) {
    adjustStock(id, num(body.stock), 'Anfangsbestand');
  }
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
}, { permission: 'warehouse.manage' });

route('PUT', '/api/articles/:id', (req, res, params) => {
  const data = pick(req.body ?? {}, [
    'number', 'name', 'category', 'unit', 'purchase_price', 'sale_price',
    'stock', 'min_stock', 'supplier', 'active', 'gtin', 'manufacturer',
    'manufacturer_number', 'etim_class', 'datasheet_url', 'image_url',
    'source', 'source_id', 'price_unit', 'barcode', 'location',
  ]);
  if ('active' in data) data.active = bool(data.active);
  updateRow('articles', params.id, data);
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(params.id);
}, { permission: 'warehouse.manage' });

route('DELETE', '/api/articles/:id', (req, res, params) => {
  db.prepare('DELETE FROM articles WHERE id = ?').run(params.id);
  return { ok: true };
}, { permission: 'warehouse.manage' });

route('POST', '/api/articles/:id/stock', (req, res, params) => {
  const body = req.body ?? {};
  const quantity = num(body.quantity);
  if (!quantity) throw new HttpError(400, 'Bitte eine Menge angeben');
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(params.id);
  if (!article) throw new HttpError(404, 'Artikel nicht gefunden');
  adjustStock(params.id, quantity, str(body.reason) || (quantity > 0 ? 'Wareneingang' : 'Entnahme'));
  logActivity('lager', `${quantity > 0 ? 'Wareneingang' : 'Entnahme'} ${Math.abs(quantity)} ${article.unit} ${article.name}.`);
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(params.id);
}, { permission: 'warehouse.manage' });

route('GET', '/api/articles/:id/movements', (req, res, params) =>
  db.prepare('SELECT * FROM stock_movements WHERE article_id = ? ORDER BY id DESC LIMIT 50').all(params.id), { permission: 'warehouse.view' });

// ----------------------------------------------------------------- Materialquellen
route('GET', '/api/materials/sources', (req) => {
  const withFields = can(req.user, 'settings.manage');
  return {
    sources: materialSources(getSettings(), { withFields }),
    canManage: withFields,
    allowHttp: withFields ? getSettings().mat_allow_http === '1' : undefined,
  };
}, { permissions: ['warehouse.view', 'settings.manage'] });

route('POST', '/api/materials/sources/:id/test', async (req, res, params) => {
  const result = await testSource(params.id);
  logActivity('material', `Datenquelle ${params.id} getestet.`);
  return result;
}, { permission: 'settings.manage' });

route('POST', '/api/materials/import', (req) => {
  const body = req.body ?? {};
  const files = Array.isArray(body.files) ? body.files : [];
  return importCatalog({
    source: str(body.source),
    supplier: str(body.supplier),
    files,
    options: body.options && typeof body.options === 'object' ? body.options : {},
    userId: req.user.id,
  });
}, { permission: 'warehouse.manage' });

route('GET', '/api/materials/imports', (req, res, params, url) =>
  catalogImportHistory(url.searchParams.get('limit')), { permission: 'warehouse.view' });

route('POST', '/api/materials/lookup', async (req) => {
  const body = req.body ?? {};
  const result = await lookupMaterial({
    gtin: str(body.gtin),
    articleNumber: str(body.articleNumber),
    manufacturer: str(body.manufacturer),
    query: str(body.query),
  });
  if (!can(req.user, 'invoices.view')) {
    result.results = result.results.map((entry) => {
      const copy = { ...entry };
      delete copy.purchasePrice;
      return copy;
    });
  }
  return result;
}, { permission: 'warehouse.view' });

route('POST', '/api/materials/articles/:id/enrich', async (req, res, params) => {
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(params.id);
  if (!article) throw new HttpError(404, 'Artikel nicht gefunden');
  const result = await enrichArticle(article, {
    overwritePrice: can(req.user, 'invoices.manage') && bodyBoolean(req.body?.overwritePrice),
  });
  return result;
}, { permission: 'warehouse.manage' });

route('GET', '/api/materials/deep-link/:id', (req, res, params) => {
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(params.id);
  if (!article) throw new HttpError(404, 'Artikel nicht gefunden');
  return { url: dealerDeepLink(article), name: str(getSettings().mat_ids_supplier) };
}, { permission: 'warehouse.view' });

route('GET', '/api/materials/gtin/:value', (req, res, params) =>
  gtinInfo(params.value), { permission: 'warehouse.view' });

// ----------------------------------------------------------------- Wartungsverträge
route('GET', '/api/contracts', () =>
  db.prepare(
    `SELECT k.*, c.company, c.first_name, c.last_name, c.number AS customer_number,
       p.label AS property_label,
       CAST(julianday(k.next_due) - julianday(date('now')) AS INTEGER) AS days_until_due
     FROM contracts k
     JOIN customers c ON c.id = k.customer_id
     LEFT JOIN properties p ON p.id = k.property_id
     ORDER BY k.active DESC, k.next_due`
  ).all(), { permission: 'contracts.view' });

route('POST', '/api/contracts', (req) => {
  const body = req.body ?? {};
  if (!body.customer_id) throw new HttpError(400, 'Bitte einen Kunden auswählen');
  if (!str(body.title)) throw new HttpError(400, 'Bitte einen Titel angeben');
  const id = insertRow('contracts', {
    customer_id: num(body.customer_id),
    property_id: body.property_id ? num(body.property_id) : null,
    title: str(body.title),
    interval_months: num(body.interval_months, 12) || 12,
    next_due: str(body.next_due) || todayISO(),
    price: num(body.price),
    tasks: JSON.stringify(body.tasks ?? []),
    active: bool(body.active ?? 1),
    notes: str(body.notes),
  });
  logActivity('vertrag', `Wartungsvertrag „${str(body.title)}“ angelegt.`);
  return db.prepare('SELECT * FROM contracts WHERE id = ?').get(id);
}, { permission: 'contracts.manage' });

route('PUT', '/api/contracts/:id', (req, res, params) => {
  const body = req.body ?? {};
  const data = pick(body, ['customer_id', 'property_id', 'title', 'interval_months', 'next_due', 'price', 'active', 'notes']);
  if ('tasks' in body) data.tasks = JSON.stringify(body.tasks ?? []);
  if ('active' in data) data.active = bool(data.active);
  if ('property_id' in data && !data.property_id) data.property_id = null;
  updateRow('contracts', params.id, data);
  return db.prepare('SELECT * FROM contracts WHERE id = ?').get(params.id);
}, { permission: 'contracts.manage' });

route('DELETE', '/api/contracts/:id', (req, res, params) => {
  db.prepare('DELETE FROM contracts WHERE id = ?').run(params.id);
  return { ok: true };
}, { permission: 'contracts.manage' });

route('POST', '/api/contracts/:id/order', (req, res, params) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(params.id);
  if (!contract) throw new HttpError(404, 'Vertrag nicht gefunden');
  const tasks = parseJson(contract.tasks, []);
  const number = nextDocumentNumber('order');
  const orderId = insertRow('orders', {
    number,
    doc_type: 'auftrag',
    customer_id: contract.customer_id,
    property_id: contract.property_id,
    title: contract.title,
    description: `Erstellt aus Wartungsvertrag „${contract.title}“.`,
    status: 'geplant',
    priority: 'normal',
    scheduled_date: todayISO(),
    labor_rate: num(getSettings().default_labor_rate),
    tax_rate: num(getSettings().default_tax_rate, 19),
    contract_id: contract.id,
    internal_note: contract.notes ?? '',
  });
  tasks.forEach((task, index) => {
    db.prepare(
      `INSERT INTO order_items (order_id, kind, article_id, description, quantity, unit, unit_price, sort)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(orderId, task.kind ?? 'arbeit', task.article_id ?? null, task.description ?? contract.title,
      task.quantity ?? 1, task.unit ?? 'Stk', task.unit_price ?? contract.price, index);
  });
  db.prepare('UPDATE contracts SET last_order_id = ? WHERE id = ?').run(orderId, contract.id);
  logActivity('auftrag', `Auftrag ${number} manuell aus Vertrag „${contract.title}“ erzeugt.`);
  return { ok: true, orderId, number };
}, { permission: 'contracts.manage' });

// ----------------------------------------------------------------- Aufträge
function orderFilter(url, user) {
  const status = url.searchParams.get('status') ?? '';
  const type = url.searchParams.get('type') ?? '';
  const q = search(url.searchParams.get('q'));
  const clauses = [];
  const params = [];
  if (status === 'offen') {
    clauses.push("o.status IN ('neu','geplant','in_arbeit')");
  } else if (status) {
    const list = status.split(',').map(() => '?').join(',');
    clauses.push(`o.status IN (${list})`);
    params.push(...status.split(','));
  }
  if (type) {
    clauses.push('o.doc_type = ?');
    params.push(type);
  }
  if (q !== '%%') {
    clauses.push('(o.number LIKE ? OR o.title LIKE ? OR c.company LIKE ? OR c.last_name LIKE ? OR p.label LIKE ?)');
    params.push(q, q, q, q, q);
  }
  if (!hasAllOrders(user)) {
    clauses.push(ownOrderClause('o'));
    params.push(ownEmployeeId(user), ownEmployeeId(user));
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

route('GET', '/api/orders', (req, res, params, url) => {
  const { where, params: values } = orderFilter(url, req.user);
  return db.prepare(
    `SELECT o.*, c.company, c.first_name, c.last_name, c.type AS customer_type,
       e.name AS employee_name, p.label AS property_label,
       (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM order_items oi WHERE oi.order_id = o.id) AS net,
       (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
       (SELECT i.number FROM invoices i WHERE i.order_id = o.id ORDER BY i.id DESC LIMIT 1) AS invoice_number
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN employees e ON e.id = o.employee_id
     LEFT JOIN properties p ON p.id = o.property_id
     ${where}
     ORDER BY o.created_at DESC, o.id DESC`
  ).all(...values).map((row) => {
    if (can(req.user, 'invoices.view')) return row;
    const copy = { ...row };
    delete copy.net;
    delete copy.invoice_number;
    delete copy.labor_rate;
    delete copy.tax_rate;
    return copy;
  });
}, { permissions: ['orders.view.all', 'orders.view.own'] });

route('GET', '/api/orders/:id', (req, res, params) => {
  const order = assertOrderAccess(req.user, params.id);
  const data = loadOrderData(order.id);
  if (!data) throw new HttpError(404, 'Auftrag nicht gefunden');
  const totals = orderTotals(data.order);
  const appointments = db.prepare('SELECT * FROM appointments WHERE order_id = ? ORDER BY start_at').all(params.id);
  const reports = reportRows('WHERE r.order_id = ?', [params.id]);
  const photos = db.prepare(
    'SELECT * FROM photos WHERE order_id = ? ORDER BY created_at, id'
  ).all(params.id).map(photoRow);
  const time = can(req.user, 'time.view.all')
    ? timeRows('WHERE t.order_id = ?', [params.id])
    : timeRows('WHERE t.order_id = ? AND t.user_id = ?', [params.id, req.user.id]);
  return sanitizeOrderData({
    ...data, totals, appointments, reports, photos, time,
  }, req.user);
}, { permissions: ['orders.view.all', 'orders.view.own'] });

route('POST', '/api/orders', (req) => {
  const body = req.body ?? {};
  if (!body.customer_id) throw new HttpError(400, 'Bitte einen Kunden auswählen');
  if (!str(body.title)) throw new HttpError(400, 'Bitte einen Titel angeben');
  const docType = body.doc_type === 'angebot' ? 'angebot' : 'auftrag';
  const number = str(body.number) || nextDocumentNumber(docType === 'angebot' ? 'quote' : 'order');
  const id = insertRow('orders', {
    number,
    doc_type: docType,
    customer_id: num(body.customer_id),
    property_id: body.property_id ? num(body.property_id) : null,
    title: str(body.title),
    description: str(body.description),
    status: str(body.status) || (docType === 'angebot' ? 'neu' : 'neu'),
    priority: str(body.priority) || 'normal',
    employee_id: body.employee_id ? num(body.employee_id) : null,
    scheduled_date: str(body.scheduled_date) || null,
    labor_hours: num(body.labor_hours),
    labor_rate: num(body.labor_rate, num(getSettings().default_labor_rate)),
    tax_rate: num(body.tax_rate, num(getSettings().default_tax_rate, 19)),
    internal_note: str(body.internal_note),
  });

  const items = Array.isArray(body.items) ? body.items : [];
  items.forEach((item, index) => {
    db.prepare(
      `INSERT INTO order_items (order_id, kind, article_id, description, quantity, unit, unit_price, sort)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(id, item.kind ?? 'material', item.article_id ?? null, str(item.description) || 'Leistung',
      num(item.quantity, 1), str(item.unit) || 'Stk', num(item.unit_price), index);
  });

  if (body.scheduled_date && body.employee_id) {
    const start = `${str(body.scheduled_date)}T08:00:00.000Z`;
    const end = `${str(body.scheduled_date)}T11:00:00.000Z`;
    db.prepare(
      'INSERT INTO appointments (order_id, employee_id, title, start_at, end_at) VALUES (?,?,?,?,?)'
    ).run(id, num(body.employee_id), str(body.title), start, end);
  }

  logActivity('auftrag', `${docType === 'angebot' ? 'Angebot' : 'Auftrag'} ${number} für ${str(body.title)} angelegt.`);
  emitWebhook('order.created', { id, number, doc_type: docType, title: str(body.title), customer_id: num(body.customer_id) });
  return loadOrderData(id);
}, { permission: 'orders.manage' });

route('PUT', '/api/orders/:id', (req, res, params) => {
  const body = req.body ?? {};
  const data = pick(body, [
    'doc_type', 'customer_id', 'property_id', 'title', 'description', 'status', 'priority',
    'employee_id', 'scheduled_date', 'labor_hours', 'labor_rate', 'tax_rate', 'internal_note',
  ]);
  if ('property_id' in data && !data.property_id) data.property_id = null;
  if ('employee_id' in data && !data.employee_id) data.employee_id = null;
  if ('scheduled_date' in data && !data.scheduled_date) data.scheduled_date = null;
  if (data.status === 'erledigt') data.completed_at = new Date().toISOString();
  if (data.status && data.status !== 'erledigt') data.completed_at = null;
  updateRow('orders', params.id, data);
  return loadOrderData(params.id);
}, { permission: 'orders.manage' });

route('DELETE', '/api/orders/:id', (req, res, params) => {
  const invoiced = db.prepare('SELECT COUNT(*) AS n FROM invoices WHERE order_id = ?').get(params.id).n;
  if (invoiced > 0) throw new HttpError(409, 'Abgerechnete Aufträge können nicht gelöscht werden');
  db.prepare('DELETE FROM orders WHERE id = ?').run(params.id);
  return { ok: true };
}, { permission: 'orders.manage' });

route('POST', '/api/orders/:id/convert', (req, res, params) => {
  const quote = db.prepare('SELECT * FROM orders WHERE id = ?').get(params.id);
  if (!quote) throw new HttpError(404, 'Angebot nicht gefunden');
  if (quote.doc_type !== 'angebot') throw new HttpError(400, 'Nur Angebote können umgewandelt werden');

  const number = nextDocumentNumber('order');
  const id = insertRow('orders', {
    number,
    doc_type: 'auftrag',
    customer_id: quote.customer_id,
    property_id: quote.property_id,
    title: quote.title,
    description: quote.description,
    status: 'neu',
    priority: quote.priority,
    employee_id: quote.employee_id,
    scheduled_date: quote.scheduled_date,
    labor_hours: quote.labor_hours,
    labor_rate: quote.labor_rate,
    tax_rate: quote.tax_rate,
    internal_note: quote.internal_note,
  });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort, id').all(params.id);
  items.forEach((item, index) => {
    db.prepare(
      `INSERT INTO order_items (order_id, kind, article_id, description, quantity, unit, unit_price, sort)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(id, item.kind, item.article_id, item.description, item.quantity, item.unit, item.unit_price, index);
  });
  updateRow('orders', params.id, {
    status: 'angenommen',
    internal_note: `${quote.internal_note ? `${quote.internal_note}\n` : ''}Umgewandelt in Auftrag ${number}.`,
  });
  logActivity('auftrag', `Angebot ${quote.number} in Auftrag ${number} umgewandelt.`);
  return { ok: true, orderId: id, number };
}, { permission: 'orders.manage' });

route('POST', '/api/orders/:id/status', (req, res, params) => {
  const status = str(req.body?.status);
  const allowed = ['neu', 'geplant', 'in_arbeit', 'erledigt', 'storniert', 'angenommen'];
  if (!allowed.includes(status)) throw new HttpError(400, 'Ungültiger Status');
  const order = assertOrderAccess(req.user, params.id);

  const data = { status };
  if (status === 'erledigt') data.completed_at = new Date().toISOString();
  else if (order.status === 'erledigt') data.completed_at = null;
  updateRow('orders', params.id, data);
  logActivity('auftrag', `Auftrag ${order.number} auf „${status}“ gesetzt.`);
  emitWebhook('order.status', { id: order.id, number: order.number, status });

  let invoice = null;
  if (status === 'erledigt' && getSettings().auto_invoice === '1' && can(req.user, 'invoices.manage')) {
    try {
      invoice = createInvoiceFromOrder(order.id);
    } catch (error) {
      if (!/bereits/.test(error.message)) {
        logActivity('fehler', `Automatische Rechnung für ${order.number}: ${error.message}`);
      }
    }
  }
  return { ...loadOrderData(params.id), autoInvoice: invoice };
}, { permission: 'orders.progress' });

route('POST', '/api/orders/:id/items', (req, res, params) => {
  const body = req.body ?? {};
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(params.id);
  if (!order) throw new HttpError(404, 'Auftrag nicht gefunden');
  let unitPrice = num(body.unit_price);
  let description = str(body.description);
  if (body.article_id) {
    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(body.article_id);
    if (article) {
      if (!description) description = article.name;
      if (!body.unit_price) unitPrice = article.sale_price;
    }
  }
  if (!description) throw new HttpError(400, 'Bitte eine Beschreibung angeben');
  const id = insertRow('order_items', {
    order_id: num(params.id),
    kind: str(body.kind) || 'material',
    article_id: body.article_id ? num(body.article_id) : null,
    description,
    quantity: num(body.quantity, 1),
    unit: str(body.unit) || 'Stk',
    unit_price: unitPrice,
    sort: db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM order_items WHERE order_id = ?').get(params.id).n,
  });
  return db.prepare('SELECT * FROM order_items WHERE id = ?').get(id);
}, { permission: 'orders.manage' });

route('PUT', '/api/orders/:id/items/:itemId', (req, res, params) => {
  const data = pick(req.body ?? {}, ['kind', 'article_id', 'description', 'quantity', 'unit', 'unit_price', 'sort']);
  if ('article_id' in data && !data.article_id) data.article_id = null;
  updateRow('order_items', params.itemId, data);
  return db.prepare('SELECT * FROM order_items WHERE id = ?').get(params.itemId);
}, { permission: 'orders.manage' });

route('DELETE', '/api/orders/:id/items/:itemId', (req, res, params) => {
  db.prepare('DELETE FROM order_items WHERE id = ? AND order_id = ?').run(params.itemId, params.id);
  return { ok: true };
}, { permission: 'orders.manage' });

route('POST', '/api/orders/:id/invoice', (req, res, params) => {
  const body = req.body ?? {};
  const invoice = createInvoiceFromOrder(params.id, {
    date: str(body.date) || todayISO(),
    dueDays: body.dueDays != null ? num(body.dueDays) : null,
    notes: str(body.notes),
  });
  emitWebhook('invoice.created', { id: invoice.id, number: invoice.number, total: invoice.total, order_id: invoice.order_id });
  return { invoice, pdf: `/api/invoices/${invoice.id}/pdf` };
}, { permission: 'invoices.manage' });

route('POST', '/api/orders/:id/progress-invoice', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  const body = req.body ?? {};
  const invoice = createProgressInvoice(order.id, {
    percent: body.percent != null ? num(body.percent) : 0,
    amount: body.amount != null && str(body.amount) !== '' ? num(body.amount) : null,
    date: str(body.date) || todayISO(),
    dueDays: body.dueDays != null ? num(body.dueDays) : null,
    notes: str(body.notes),
  });
  emitWebhook('invoice.created', { id: invoice.id, number: invoice.number, total: invoice.total, order_id: invoice.order_id });
  return { invoice, pdf: `/api/invoices/${invoice.id}/pdf` };
}), { permission: 'invoices.manage' });

/** PDF eines Auftragsdokuments (Auftragsbestätigung, Lieferschein …) per E-Mail versenden. */
route('POST', '/api/orders/:id/send-document', async (req, res, params) => asApi(async () => {
  const order = assertOrderAccess(req.user, params.id);
  const { customer } = loadOrderData(order.id);
  const to = str(req.body?.to) || str(customer?.email);
  if (!to) throw new HttpError(400, 'Für diesen Kunden ist keine E-Mail-Adresse hinterlegt.');
  const requested = str(req.body?.type) || 'auftragsbestaetigung';
  const type = ['angebot', 'auftrag', 'auftragsbestaetigung', 'lieferschein'].includes(requested)
    ? requested
    : 'auftragsbestaetigung';
  if (!mailConfigured()) {
    throw new HttpError(400, 'E-Mail-Versand ist noch nicht eingerichtet. Bitte in den Einstellungen einen SMTP-Server hinterlegen.', 'mail_not_configured');
  }
  const pdf = orderPdf(order.id, type);
  if (!pdf) throw new HttpError(404, 'Auftrag nicht gefunden');
  const names = { angebot: 'Angebot', auftrag: 'Auftrag', auftragsbestaetigung: 'Auftragsbestätigung', lieferschein: 'Lieferschein' };
  const subject = `${names[type]} ${order.number} – ${order.title}`;
  const text = [
    'Guten Tag,',
    '',
    `anbei erhalten Sie ${names[type] === 'Angebot' ? 'unser Angebot' : `unsere ${names[type]}`} ${order.number} zu „${order.title}“.`,
    '',
    'Bei Rückfragen stehen wir Ihnen gerne zur Verfügung.',
    '',
    getSettings().company_name,
  ].join('\n');
  await sendMail({
    to, subject, text,
    attachments: [{ filename: pdf.filename, content: pdf.buffer, contentType: 'application/pdf' }],
  });
  logActivity('auftrag', `${names[type]} ${order.number} an ${to} gesendet.`);
  return { sent: true, to, type };
}), { permission: 'orders.manage' });

route('POST', '/api/invoices/:id/send-mail', async (req, res, params) => asApi(async () => {
  const data = loadInvoiceData(params.id);
  if (!data) throw new HttpError(404, 'Rechnung nicht gefunden');
  if (data.invoice.status === 'storniert') throw new HttpError(400, 'Stornierte Rechnungen werden nicht versendet');
  const to = str(req.body?.to) || str(data.customer?.email);
  if (!to) throw new HttpError(400, 'Für diesen Kunden ist keine E-Mail-Adresse hinterlegt.');
  if (!mailConfigured()) {
    throw new HttpError(400, 'E-Mail-Versand ist noch nicht eingerichtet. Bitte in den Einstellungen einen SMTP-Server hinterlegen.', 'mail_not_configured');
  }
  const pdf = invoicePdf(data.invoice.id, { persist: true });
  const label = data.invoice.kind === 'abschlag' ? 'Abschlagsrechnung' : 'Rechnung';
  const text = [
    'Guten Tag,',
    '',
    `anbei erhalten Sie unsere ${label} ${data.invoice.number} über ${Number(data.invoice.total).toFixed(2).replace('.', ',')} €.`,
    `Zahlbar bis zum ${deDateTime(data.invoice.due_date).split(',')[0]}.`,
    '',
    'Bei Rückfragen stehen wir Ihnen gerne zur Verfügung.',
    '',
    getSettings().company_name,
  ].join('\n');
  await sendMail({
    to,
    subject: `${label} ${data.invoice.number}`,
    text,
    attachments: [{ filename: pdf.filename, content: pdf.buffer, contentType: 'application/pdf' }],
  });
  logActivity('rechnung', `${label} ${data.invoice.number} an ${to} gesendet.`);
  return { sent: true, to };
}), { permission: 'invoices.manage' });

route('GET', '/api/orders/:id/pdf', (req, res, params, url) => {
  const order = assertOrderAccess(req.user, params.id);
  const requested = str(url.searchParams.get('type'));
  const type = ['angebot', 'auftrag', 'auftragsbestaetigung', 'lieferschein'].includes(requested)
    ? requested
    : order.doc_type;
  const pdf = orderPdf(order.id, type);
  if (!pdf) throw new HttpError(404, 'Auftrag nicht gefunden');
  return { __pdf: pdf.buffer, filename: pdf.filename };
}, { permissions: ['orders.view.all', 'orders.view.own'] });

// ----------------------------------------------------------------- Termine
export const APPOINTMENT_KINDS = {
  baustelle: 'Baustelle / Auftrag',
  kundenbesuch: 'Kundenbesuch / Beratung',
  meeting: 'Meeting / Besprechung',
  personal: 'Personal / HR',
  notdienst: 'Notdienst',
  fortbildung: 'Fortbildung / Schulung',
  lieferant: 'Lieferant / Werkstatt',
  sonstiges: 'Sonstiges',
};

const appointmentKind = (value) => (APPOINTMENT_KINDS[str(value)] ? str(value) : 'baustelle');

route('GET', '/api/appointments', (req, res, params, url) => {
  const from = str(url.searchParams.get('from')) || addDays(todayISO(), -7);
  const to = str(url.searchParams.get('to')) || addDays(todayISO(), 28);
  const ownOnly = !can(req.user, 'planning.manage');
  return db.prepare(
    `SELECT a.*, o.number AS order_number, o.title AS order_title, o.status AS order_status,
       e.name AS employee_name, e.color AS employee_color,
       c.company, c.first_name, c.last_name, c.id AS customer_id, c.street AS customer_street,
       c.zip AS customer_zip, c.city AS customer_city,
       p.label AS property_label, p.street AS property_street, p.city AS property_city
     FROM appointments a
     LEFT JOIN orders o ON o.id = a.order_id
     LEFT JOIN employees e ON e.id = a.employee_id
     LEFT JOIN customers c ON c.id = COALESCE(o.customer_id, a.customer_id)
     LEFT JOIN properties p ON p.id = o.property_id
     WHERE date(a.start_at) BETWEEN date(?) AND date(?)
       ${ownOnly ? 'AND a.employee_id = ?' : ''}
     ORDER BY a.start_at`
  ).all(...(ownOnly ? [from, to, ownEmployeeId(req.user)] : [from, to]));
}, { permission: 'planning.view' });

route('POST', '/api/appointments', (req) => {
  const body = req.body ?? {};
  if (!str(body.title) || !body.start_at || !body.end_at) {
    throw new HttpError(400, 'Bitte Titel, Start und Ende angeben');
  }
  const id = insertRow('appointments', {
    order_id: body.order_id ? num(body.order_id) : null,
    customer_id: body.customer_id ? num(body.customer_id) : null,
    employee_id: body.employee_id ? num(body.employee_id) : null,
    kind: appointmentKind(body.kind),
    title: str(body.title),
    location: str(body.location),
    start_at: str(body.start_at),
    end_at: str(body.end_at),
    notes: str(body.notes),
    status: str(body.status) || 'geplant',
  });
  return db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
}, { permission: 'planning.manage' });

route('PUT', '/api/appointments/:id', (req, res, params) => {
  const body = req.body ?? {};
  const data = pick(body, ['order_id', 'customer_id', 'employee_id', 'kind', 'title', 'location', 'start_at', 'end_at', 'notes', 'status']);
  if ('order_id' in data && !data.order_id) data.order_id = null;
  if ('customer_id' in data && !data.customer_id) data.customer_id = null;
  if ('kind' in data) data.kind = appointmentKind(data.kind);
  if ('employee_id' in data && !data.employee_id) data.employee_id = null;
  updateRow('appointments', params.id, data);
  return db.prepare('SELECT * FROM appointments WHERE id = ?').get(params.id);
}, { permission: 'planning.manage' });

route('DELETE', '/api/appointments/:id', (req, res, params) => {
  db.prepare('DELETE FROM appointments WHERE id = ?').run(params.id);
  return { ok: true };
}, { permission: 'planning.manage' });

// ----------------------------------------------------------------- Terminbestätigung
route('POST', '/api/appointments/:id/confirm-link', (req, res, params) => {
  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(num(params.id));
  if (!appointment) throw new HttpError(404, 'Termin nicht gefunden');
  let token = appointment.confirm_token;
  if (!token) {
    token = randomBytes(24).toString('hex');
    db.prepare('UPDATE appointments SET confirm_token = ? WHERE id = ?').run(token, appointment.id);
  }
  return { token, path: `/termin/${token}` };
}, { permission: 'planning.manage' });

function appointmentWithCustomer(id) {
  const row = db.prepare(
    `SELECT a.*, COALESCE(o.customer_id, a.customer_id) AS effective_customer_id,
       o.number AS order_number
     FROM appointments a
     LEFT JOIN orders o ON o.id = a.order_id
     WHERE a.id = ?`
  ).get(num(id));
  if (!row) throw new HttpError(404, 'Termin nicht gefunden');
  const customer = row.effective_customer_id
    ? db.prepare('SELECT * FROM customers WHERE id = ?').get(row.effective_customer_id)
    : null;
  return { appointment: row, customer };
}

function ensureConfirmToken(appointment) {
  if (appointment.confirm_token) return appointment.confirm_token;
  const token = randomBytes(24).toString('hex');
  db.prepare('UPDATE appointments SET confirm_token = ? WHERE id = ?').run(token, appointment.id);
  appointment.confirm_token = token;
  return token;
}

route('POST', '/api/appointments/:id/confirm-mail', async (req, res, params) => {
  const { appointment, customer } = appointmentWithCustomer(params.id);
  if (!mailConfigured()) {
    throw new HttpError(400, 'E-Mail-Versand ist noch nicht eingerichtet. Bitte in den Einstellungen einen SMTP-Server hinterlegen.', 'mail_not_configured');
  }
  const to = str(customer?.email);
  if (!to) throw new HttpError(400, 'Für diesen Kunden ist keine E-Mail-Adresse hinterlegt.');
  const token = ensureConfirmToken(appointment);
  const mail = confirmationMail(req, appointment, customer, token);
  try {
    await sendMail(mail);
  } catch (error) {
    throw new HttpError(400, error.message, 'mail_failed');
  }
  db.prepare("UPDATE appointments SET mail_sent_at = datetime('now') WHERE id = ?").run(appointment.id);
  logActivity('termin', `Terminbestätigung an ${to} gesendet.`);
  return { sent: true, to, link: mail.link };
}, { permission: 'planning.manage' });

/* Nachricht an das Büro, wenn der Kunde bestätigt oder absagt (best effort). */
function notifyReply(appointment, statusText) {
  const settings = getSettings();
  if (settings.mail_notify_replies !== '1' || !mailConfigured()) return;
  const to = str(settings.company_email) || str(settings.smtp_from);
  if (!to) return;
  const text = [
    `${statusText}: ${appointment.title}`,
    '',
    `Termin: ${mailDate(appointment.start_at)} um ${mailTime(appointment.start_at)} Uhr`,
    `Kunde: ${[appointment.first_name, appointment.last_name].filter(Boolean).join(' ') || appointment.company || 'unbekannt'}`,
    appointment.customer_reply ? `Nachricht: ${appointment.customer_reply}` : '',
    appointment.order_number ? `Auftrag: ${appointment.order_number}` : '',
  ].filter(Boolean).join('\n');
  sendMail({ to, subject: `Rückmeldung zum Termin: ${appointment.title}`, text })
    .catch((error) => logActivity('fehler', `Terminbenachrichtigung: ${error.message}`));
}

route('POST', '/api/appointments/:id/confirm-reset', (req, res, params) => {
  const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(num(params.id));
  if (!appointment) throw new HttpError(404, 'Termin nicht gefunden');
  db.prepare(`UPDATE appointments
    SET confirmed_at = NULL, declined_at = NULL, customer_reply = NULL WHERE id = ?`).run(appointment.id);
  return { ok: true };
}, { permission: 'planning.manage' });

// Öffentlich: Der Kunde öffnet den Link ohne Anmeldung.
route('GET', '/api/public/appointments/:token', (req, res, params) => {
  publicRateLimit(req, 'termin-read', 90);
  return publicAppointment(appointmentByToken(params.token));
}, { public: true });

route('POST', '/api/public/appointments/:token/confirm', (req, res, params) => {
  publicRateLimit(req, 'termin-write', 20);
  const appointment = appointmentByToken(params.token);
  db.prepare(`UPDATE appointments
    SET confirmed_at = datetime('now'), declined_at = NULL, customer_reply = NULL
    WHERE id = ?`).run(appointment.id);
  logActivity('termin', `Kunde hat den Termin am ${deDateTime(appointment.start_at)} bestätigt.`);
  notifyReply(appointmentByToken(params.token), 'Termin bestätigt');
  notifyAppointmentConfirmed(appointmentByToken(params.token));
  return publicAppointment(appointmentByToken(params.token));
}, { public: true });

route('POST', '/api/public/appointments/:token/decline', (req, res, params) => {
  publicRateLimit(req, 'termin-write', 20);
  const appointment = appointmentByToken(params.token);
  const reply = str(req.body?.message).slice(0, 500);
  db.prepare(`UPDATE appointments
    SET declined_at = datetime('now'), confirmed_at = NULL, customer_reply = ?
    WHERE id = ?`).run(reply, appointment.id);
  logActivity('termin', `Kunde kann den Termin am ${deDateTime(appointment.start_at)} nicht wahrnehmen${reply ? `: „${reply}“` : ''}.`);
  notifyReply(appointmentByToken(params.token), 'Termin passt nicht');
  notifyAppointmentConfirmed(appointmentByToken(params.token));
  return publicAppointment(appointmentByToken(params.token));
}, { public: true });

// ----------------------------------------------------------------- Rechnungen
route('GET', '/api/invoices', (req, res, params, url) => {
  const status = str(url.searchParams.get('status'));
  const q = search(url.searchParams.get('q'));
  const clauses = [];
  const values = [];
  if (status === 'offen') clauses.push("i.status IN ('offen','teilweise','gemahnt')");
  else if (status) {
    clauses.push(`i.status = ?`);
    values.push(status);
  }
  if (q !== '%%') {
    clauses.push('(i.number LIKE ? OR c.company LIKE ? OR c.last_name LIKE ? OR o.number LIKE ?)');
    values.push(q, q, q, q);
  }
  return db.prepare(
    `SELECT i.*, c.company, c.first_name, c.last_name, c.number AS customer_number,
       o.number AS order_number,
       CASE WHEN i.status IN ('offen','teilweise','gemahnt') AND date(i.due_date) < date('now') THEN 1 ELSE 0 END AS overdue,
       CAST(julianday(date('now')) - julianday(i.due_date) AS INTEGER) AS days_overdue
     FROM invoices i
     JOIN customers c ON c.id = i.customer_id
     LEFT JOIN orders o ON o.id = i.order_id
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY i.date DESC, i.id DESC`
  ).all(...values);
}, { permission: 'invoices.view' });

route('GET', '/api/invoices/:id', (req, res, params) => {
  const data = loadInvoiceData(params.id);
  if (!data) throw new HttpError(404, 'Rechnung nicht gefunden');
  return data;
}, { permission: 'invoices.view' });

route('PUT', '/api/invoices/:id', (req, res, params) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(params.id);
  if (!invoice) throw new HttpError(404, 'Rechnung nicht gefunden');
  const body = req.body ?? {};
  const data = pick(body, ['date', 'due_date', 'service_date', 'notes', 'status', 'buyer_reference', 'einvoice_format', 'einvoice_status']);
  if ('status' in data && !['offen', 'bezahlt', 'storniert', 'gemahnt', 'teilweise'].includes(data.status)) {
    throw new HttpError(400, 'Ungültiger Status');
  }
  if ('einvoice_format' in data && !['xrechnung', 'zugferd'].includes(data.einvoice_format)) {
    throw new HttpError(400, 'Unbekanntes E-Rechnungsformat');
  }
  if ('einvoice_status' in data && !['entwurf', 'erzeugt', 'versendet'].includes(data.einvoice_status)) {
    throw new HttpError(400, 'Unbekannter E-Rechnungsstatus');
  }
  if ('date' in data && !('due_date' in data)) {
    const days = Math.round(
      (new Date(invoice.due_date) - new Date(invoice.date)) / 86400000
    );
    data.due_date = addDays(str(data.date), Number.isFinite(days) ? days : 14);
  }
  updateRow('invoices', params.id, data);
  if ('status' in data && data.status === 'storniert') {
    logActivity('rechnung', `Rechnung ${invoice.number} storniert.`);
  }
  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(params.id);
}, { permission: 'invoices.manage' });

route('GET', '/api/invoices/:id/pdf', (req, res, params, url) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(params.id);
  if (!invoice) throw new HttpError(404, 'Rechnung nicht gefunden');
  const settings = getSettings();
  const wantReminder = url.searchParams.get('mahnung') === '1' && invoice.dunning_level > 0;
  const pdf = wantReminder
    ? invoicePdf(params.id, {
        dunning: {
          level: invoice.dunning_level,
          fee: Number(settings.dunning_fee) || 0,
          newDueDate: addDays(invoice.dunning_date || todayISO(), 7),
        },
      })
    : invoicePdf(params.id);
  try { archiveInvoicePdf(invoice, pdf.buffer); } catch { /* Archiv ist optional */ }
  return { __pdf: pdf.buffer, filename: pdf.filename };
}, { permission: 'invoices.view' });

route('POST', '/api/invoices/:id/payments', (req, res, params) => {
  const body = req.body ?? {};
  const invoice = recordPayment(params.id, {
    date: str(body.date) || todayISO(),
    amount: body.amount,
    method: str(body.method) || 'Überweisung',
    note: str(body.note),
  });
  emitWebhook('invoice.paid', { id: invoice.id, number: invoice.number, paid_total: invoice.paid_total, total: invoice.total });
  return { invoice };
}, { permission: 'invoices.manage' });

route('POST', '/api/invoices/:id/dunning', (req, res, params) => {
  const result = createDunning(params.id);
  return { invoice: result.invoice, filename: result.filename, dunning: result.dunning };
}, { permission: 'invoices.manage' });

// ----------------------------------------------------------------- Automatik
route('POST', '/api/automation/run', (req, res, params, url) => {
  const result = runAutomation({ force: url.searchParams.get('force') === '1' });
  const total = result.orders.length + result.invoices.length + result.dunnings.length;
  return {
    ...result,
    summary: total === 0
      ? 'Keine fälligen Vorgänge – alles aktuell.'
      : `${result.orders.length} ${result.orders.length === 1 ? 'Auftrag' : 'Aufträge'}, ${result.invoices.length} ${result.invoices.length === 1 ? 'Rechnung' : 'Rechnungen'}, ${result.dunnings.length} ${result.dunnings.length === 1 ? 'Mahnung' : 'Mahnungen'} erzeugt.`,
  };
}, { permission: 'automation.run' });

// ----------------------------------------------------------------- Export
const csvEscape = (value) => {
  let text = String(value ?? '');
  // Tabellenkalkulationen dürfen Zellwerte nicht als Formel ausführen.
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(?:[.,]\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

function sendCsv(res, rows, headers, filename) {
  const lines = [headers.map(csvEscape).join(';')];
  for (const row of rows) lines.push(row.map(csvEscape).join(';'));
  const buffer = Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  res.end(buffer);
  return { __sent: true };
}

route('GET', '/api/export/:type', (req, res, params, url) => {
  const type = params.type.replace(/\.csv$/, '');
  if (type === 'rechnungen') {
    const statusLabels = { offen: 'Offen', teilweise: 'Teilweise bezahlt', bezahlt: 'Bezahlt', gemahnt: 'Gemahnt', storniert: 'Storniert' };
    const rows = db.prepare(
      `SELECT i.number, i.date, i.service_date, i.due_date, i.status, c.company, c.first_name, c.last_name,
         i.subtotal, i.tax_total, i.total, i.paid_total
       FROM invoices i JOIN customers c ON c.id = i.customer_id ORDER BY i.date`
    ).all();
    return sendCsv(res, rows.map((r) => [
      r.number, r.date, r.service_date || r.date, r.due_date, statusLabels[r.status] || r.status,
      r.company || `${r.first_name} ${r.last_name}`,
      r.subtotal.toFixed(2).replace('.', ','), r.tax_total.toFixed(2).replace('.', ','),
      r.total.toFixed(2).replace('.', ','), r.paid_total.toFixed(2).replace('.', ','),
    ]), ['Rechnungsnr.', 'Datum', 'Leistungsdatum', 'Fällig', 'Status', 'Kunde', 'Netto', 'USt.', 'Brutto', 'Bezahlt'],
    'rechnungen.csv');
  }
  if (type === 'auftraege') {
    const rows = db.prepare(
      `SELECT o.number, o.doc_type, o.status, o.title, o.scheduled_date, o.created_at,
         c.company, c.first_name, c.last_name, e.name AS employee,
         (SELECT COALESCE(SUM(quantity * unit_price), 0) FROM order_items oi WHERE oi.order_id = o.id) AS net
       FROM orders o JOIN customers c ON c.id = o.customer_id
       LEFT JOIN employees e ON e.id = o.employee_id ORDER BY o.created_at`
    ).all();
    return sendCsv(res, rows.map((r) => [
      r.number, r.doc_type === 'angebot' ? 'Angebot' : 'Auftrag', r.status, r.title,
      r.scheduled_date, r.company || `${r.first_name} ${r.last_name}`, r.employee,
      Number(r.net).toFixed(2).replace('.', ','),
    ]), ['Nummer', 'Art', 'Status', 'Titel', 'Termin', 'Kunde', 'Monteur', 'Netto'],
    'auftraege.csv');
  }
  if (type === 'kunden') {
    const rows = db.prepare(
      `SELECT number, type, company, first_name, last_name, street, zip, city, phone, email FROM customers ORDER BY number`
    ).all();
    return sendCsv(res, rows.map((r) => [
      r.number, r.type, r.company, `${r.first_name} ${r.last_name}`.trim(), r.street, r.zip, r.city, r.phone, r.email,
    ]), ['Kundennr.', 'Typ', 'Firma', 'Name', 'Straße', 'PLZ', 'Ort', 'Telefon', 'E-Mail'], 'kunden.csv');
  }
  if (type === 'lager') {
    const rows = db.prepare('SELECT * FROM articles ORDER BY category, name').all();
    return sendCsv(res, rows.map((r) => [
      r.number, r.name, r.category, r.unit, r.stock, r.min_stock,
      r.purchase_price.toFixed(2).replace('.', ','), r.sale_price.toFixed(2).replace('.', ','), r.supplier,
    ]), ['Artikel-Nr.', 'Bezeichnung', 'Kategorie', 'Einheit', 'Bestand', 'Mindestbestand', 'EK', 'VK', 'Lieferant'],
    'lager.csv');
  }
  throw new HttpError(404, 'Unbekannter Export');
}, { permission: 'exports.run' });

// ----------------------------------------------------------------- Benutzer
route('GET', '/api/users', () => db.prepare(
  `SELECT u.id, u.username, u.name, u.role, u.employee_id, u.active, u.created_at, u.last_login,
     u.must_change_password, e.name AS employee_name
   FROM users u LEFT JOIN employees e ON e.id = u.employee_id
   ORDER BY u.active DESC, u.name`
).all().map((row) => ({
  ...row,
  role_label: roleLabel(row.role),
  permissions: permissionsFor(row.role),
})), { permission: 'users.manage' });

route('POST', '/api/users', (req) => {
  const body = req.body ?? {};
  const username = str(body.username).toLowerCase();
  if (!username) throw new HttpError(400, 'Bitte einen Benutzernamen angeben');
  if (username.length > 100) throw new HttpError(400, 'Der Benutzername ist zu lang');
  if (String(body.password || '').length < 8) throw new HttpError(400, 'Das Passwort muss mindestens 8 Zeichen haben');
  if (String(body.password || '').length > 200) throw new HttpError(400, 'Das Passwort ist zu lang (maximal 200 Zeichen)');
  if (!ROLES[body.role]) throw new HttpError(400, 'Unbekannte Rolle');
  if (db.prepare('SELECT 1 FROM users WHERE lower(username) = lower(?)').get(username)) {
    throw new HttpError(409, 'Dieser Benutzername ist bereits vergeben');
  }
  const id = insertRow('users', {
    username,
    password_hash: hashPassword(body.password),
    name: str(body.name) || username,
    role: body.role,
    employee_id: body.employee_id ? num(body.employee_id) : null,
    active: bool(body.active ?? 1),
    must_change_password: 1,
  });
  invalidateDemoAccountCache();
  logActivity('personal', `Benutzerkonto ${username} (${roleLabel(body.role)}) angelegt.`);
  return db.prepare(
    'SELECT id, username, name, role, employee_id, active, created_at FROM users WHERE id = ?'
  ).get(id);
}, { permission: 'users.manage' });

function hasOtherActiveChef(userId) {
  return db.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'chef' AND active = 1 AND id != ?"
  ).get(userId).n > 0;
}

route('PUT', '/api/users/:id', (req, res, params) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(params.id);
  if (!user) throw new HttpError(404, 'Benutzer nicht gefunden');
  const body = req.body ?? {};
  const data = pick(body, ['username', 'name', 'role', 'employee_id', 'active']);
  const removesChef = user.role === 'chef'
    && ((data.role && data.role !== 'chef') || (data.active !== undefined && !bool(data.active)));
  if (removesChef && !hasOtherActiveChef(user.id)) {
    throw new HttpError(400, 'Mindestens ein aktives Chef-Konto muss erhalten bleiben');
  }
  if ('username' in data) {
    data.username = str(data.username).toLowerCase();
    if (!data.username) throw new HttpError(400, 'Bitte einen Benutzernamen angeben');
    const taken = db.prepare('SELECT 1 FROM users WHERE lower(username) = lower(?) AND id != ?')
      .get(data.username, params.id);
    if (taken) throw new HttpError(409, 'Dieser Benutzername ist bereits vergeben');
  }
  if ('role' in data && !ROLES[data.role]) throw new HttpError(400, 'Unbekannte Rolle');
  if ('employee_id' in data && !data.employee_id) data.employee_id = null;
  if ('active' in data) {
    data.active = bool(data.active);
    if (!data.active && user.id === req.user.id) throw new HttpError(400, 'Das eigene Konto kann nicht deaktiviert werden');
  }
  if (body.password) {
    if (String(body.password).length < 8) throw new HttpError(400, 'Das Passwort muss mindestens 8 Zeichen haben');
    if (String(body.password).length > 200) throw new HttpError(400, 'Das Passwort ist zu lang (maximal 200 Zeichen)');
    data.password_hash = hashPassword(body.password);
    // Ein vom Admin gesetztes Startpasswort muss beim nächsten Login geändert werden.
    data.must_change_password = user.id === req.user.id ? 0 : 1;
  }
  updateRow('users', params.id, data);
  invalidateDemoAccountCache();
  // Deaktivierte Konten sofort abmelden – auch wenn sie später wieder aktiviert werden.
  if (data.active === 0) deleteUserSessions(user.id);
  if (body.password) {
    deleteUserSessions(user.id);
    if (user.id === req.user.id) {
      const token = issueSession(req.user.id, req);
      res.setHeader('Set-Cookie', sessionCookie(token, req));
    }
  }
  return db.prepare(
    'SELECT id, username, name, role, employee_id, active, created_at, must_change_password FROM users WHERE id = ?'
  ).get(params.id);
}, { permission: 'users.manage' });

route('DELETE', '/api/users/:id', (req, res, params) => {
  if (Number(params.id) === req.user.id) throw new HttpError(400, 'Das eigene Konto kann nicht gelöscht werden');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(params.id);
  if (!user) throw new HttpError(404, 'Benutzer nicht gefunden');
  if (user.role === 'chef' && !hasOtherActiveChef(user.id)) {
    throw new HttpError(400, 'Mindestens ein aktives Chef-Konto muss erhalten bleiben');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(params.id);
  invalidateDemoAccountCache();
  return { ok: true };
}, { permission: 'users.manage' });

// ----------------------------------------------------------------- Zeiterfassung
route('GET', '/api/time/running', (req) => {
  const entry = runningTime(req.user);
  return entry ? decorateTime(entry) : null;
}, { permission: 'time.own' });

route('POST', '/api/time/start', (req) => {
  const orderId = req.body?.order_id ? num(req.body.order_id) : null;
  if (orderId) assertOrderAccess(req.user, orderId);
  const entry = startTime(req.user, {
    orderId,
    type: str(req.body?.type) || 'arbeit',
    note: str(req.body?.note),
  });
  logActivity('zeit', `${req.user.name} hat sich eingestempelt${entry.order_number ? ` (${entry.order_number})` : ''}.`);
  return decorateTime(entry);
}, { permission: 'time.own' });

route('POST', '/api/time/stop', (req) => {
  const entry = stopTime(req.user, { note: str(req.body?.note) });
  logActivity('zeit', `${req.user.name} hat sich ausgestempelt (${entry.minutes} Min.).`);
  return decorateTime(entry);
}, { permission: 'time.own' });

route('GET', '/api/time', (req, res, params, url) => {
  const clauses = [];
  const values = [];
  if (!can(req.user, 'time.view.all')) {
    clauses.push('t.user_id = ?');
    values.push(req.user.id);
  }
  const employeeId = str(url.searchParams.get('employee_id'));
  if (employeeId) {
    clauses.push('t.employee_id = ?');
    values.push(num(employeeId));
  }
  const orderId = str(url.searchParams.get('order_id'));
  if (orderId) {
    clauses.push('t.order_id = ?');
    values.push(num(orderId));
  }
  const from = str(url.searchParams.get('from'));
  if (from) {
    clauses.push('date(t.start_at) >= date(?)');
    values.push(from);
  }
  const to = str(url.searchParams.get('to'));
  if (to) {
    clauses.push('date(t.start_at) <= date(?)');
    values.push(to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return timeRows(where, values);
}, { permissions: ['time.own', 'time.view.all'] });

route('POST', '/api/time', (req) => {
  const body = req.body ?? {};
  const manager = can(req.user, 'time.manage');
  if (!manager) {
    body.employee_id = req.user.employee_id;
    body.user_id = req.user.id;
    // Ohne Verwaltungsrecht nur auf eigene Aufträge stempeln.
    if (body.order_id) assertOrderAccess(req.user, body.order_id);
  }
  const startAt = str(body.start_at) || new Date().toISOString();
  const endAt = str(body.end_at) || null;
  if (endAt && new Date(endAt) < new Date(startAt)) {
    throw new HttpError(400, 'Das Ende darf nicht vor dem Start liegen');
  }
  const employeeId = body.employee_id ? num(body.employee_id) : req.user.employee_id;
  const id = insertRow('time_entries', {
    employee_id: employeeId ?? null,
    user_id: body.user_id ? num(body.user_id) : (manager ? null : req.user.id),
    order_id: body.order_id ? num(body.order_id) : null,
    start_at: startAt,
    end_at: endAt,
    type: str(body.type) || 'arbeit',
    note: str(body.note),
  });
  return decorateTime(db.prepare(
    `SELECT t.*, e.name AS employee_name, o.number AS order_number, o.title AS order_title
     FROM time_entries t LEFT JOIN employees e ON e.id = t.employee_id
     LEFT JOIN orders o ON o.id = t.order_id WHERE t.id = ?`
  ).get(id));
}, { permissions: ['time.own', 'time.manage'] });

route('PUT', '/api/time/:id', (req, res, params) => {
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(params.id);
  if (!entry) throw new HttpError(404, 'Zeiteintrag nicht gefunden');
  if (!can(req.user, 'time.manage') && entry.user_id !== req.user.id) {
    throw new HttpError(403, 'Dieser Zeiteintrag gehört nicht zu deinem Konto');
  }
  const data = pick(req.body ?? {}, ['order_id', 'start_at', 'end_at', 'type', 'note']);
  if ('order_id' in data && !data.order_id) data.order_id = null;
  if (data.order_id && !can(req.user, 'time.manage')) assertOrderAccess(req.user, data.order_id);
  updateRow('time_entries', params.id, data);
  return decorateTime(db.prepare(
    `SELECT t.*, e.name AS employee_name, o.number AS order_number, o.title AS order_title
     FROM time_entries t LEFT JOIN employees e ON e.id = t.employee_id
     LEFT JOIN orders o ON o.id = t.order_id WHERE t.id = ?`
  ).get(params.id));
}, { permissions: ['time.own', 'time.manage'] });

route('DELETE', '/api/time/:id', (req, res, params) => {
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(params.id);
  if (!entry) throw new HttpError(404, 'Zeiteintrag nicht gefunden');
  if (!can(req.user, 'time.manage') && entry.user_id !== req.user.id) {
    throw new HttpError(403, 'Dieser Zeiteintrag gehört nicht zu deinem Konto');
  }
  db.prepare('DELETE FROM time_entries WHERE id = ?').run(params.id);
  return { ok: true };
}, { permissions: ['time.own', 'time.manage'] });

// ----------------------------------------------------------------- GPS-Zeiterfassung
route('GET', '/api/geo/status', (req) => asApi(() => ({
  ...geoStatus(req.user),
  kinds: GEO_KINDS,
  time: decorateTime(runningTime(req.user)),
})), { permission: 'time.own' });

route('PUT', '/api/geo/settings', (req) => asApi(() => {
  const status = updateGeoSettings(req.user, req.body ?? {});
  logActivity('zeit', `GPS-Zeiterfassung ${status.enabled ? 'aktiviert' : 'deaktiviert'}.`);
  return { ...status, time: decorateTime(runningTime(req.user)) };
}), { permission: 'time.own' });

route('PUT', '/api/geo/home', (req) => asApi(() => {
  const status = setHomeLocation(req.user, req.body ?? {});
  logActivity('zeit', 'Zuhause-Standort für die GPS-Zeiterfassung gespeichert.');
  return { ...status, time: decorateTime(runningTime(req.user)) };
}), { permission: 'time.own' });

route('PUT', '/api/orders/:id/location', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  const location = setOrderLocation(req.user, order.id, req.body ?? {});
  logActivity('auftrag', `Standort für ${order.number} gespeichert (GPS).`);
  return location;
}), { permissions: ['orders.progress', 'orders.manage'] });

route('POST', '/api/geo/event', (req) => asApi(() => {
  const body = req.body ?? {};
  if (body.order_id) assertOrderAccess(req.user, body.order_id);
  const result = geoEvent(req.user, body);
  if (result.started || result.stopped) logActivity('zeit', result.message);
  return { ...result, time: result.time ? decorateTime(result.time) : null };
}), { permission: 'time.own' });

route('GET', '/api/geo/events', (req, res, params, url) => asApi(() =>
  geoEvents(req.user, url.searchParams.get('limit'))
), { permission: 'time.own' });

// ----------------------------------------------------------------- Berichte
route('GET', '/api/reports', (req, res, params, url) => {
  const clauses = [];
  const values = [];
  if (!can(req.user, 'reports.view.all')) {
    clauses.push('(r.user_id = ? OR (r.employee_id IS NOT NULL AND r.employee_id = ?))');
    values.push(req.user.id, ownEmployeeId(req.user));
  }
  const status = str(url.searchParams.get('status'));
  if (status) {
    clauses.push('r.status = ?');
    values.push(status);
  }
  const orderId = str(url.searchParams.get('order_id'));
  if (orderId) {
    clauses.push('r.order_id = ?');
    values.push(num(orderId));
  }
  const employeeId = str(url.searchParams.get('employee_id'));
  if (employeeId) {
    clauses.push('r.employee_id = ?');
    values.push(num(employeeId));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return reportRows(where, values);
}, { permissions: ['reports.own', 'reports.view.all'] });

route('GET', '/api/reports/:id', (req, res, params) => {
  assertReportAccess(req.user, params.id);
  const details = reportDetails(params.id);
  details.photos = details.photos.map(photoRow);
  details.applicable = can(req.user, 'reports.manage') && !details.report.applied_at;
  details.canApprove = can(req.user, 'reports.approve');
  return details;
}, { permissions: ['reports.own', 'reports.view.all'] });

route('POST', '/api/reports', (req) => {
  const body = req.body ?? {};
  const orderId = num(body.order_id);
  if (!orderId) throw new HttpError(400, 'Bitte einen Auftrag auswählen');
  assertOrderAccess(req.user, orderId);
  const content = str(body.content);
  const id = Number(db.prepare(
    `INSERT INTO reports (order_id, employee_id, user_id, type, content, weather, hours, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?, datetime('now'), datetime('now'))`
  ).run(
    orderId, req.user.employee_id ?? null, req.user.id,
    str(body.type) || 'montage', content, str(body.weather), num(body.hours),
    can(req.user, 'reports.manage') ? (str(body.status) || 'eingereicht') : 'eingereicht'
  ).lastInsertRowid);

  const materials = Array.isArray(body.materials) ? body.materials : [];
  if (body.auto_parse && content) {
    materials.push(...parseMaterials(content));
  }
  const insert = db.prepare(
    `INSERT INTO report_materials (report_id, article_id, description, quantity, unit, source)
     VALUES (?,?,?,?,?,?)`
  );
  const seen = new Set();
  for (const material of materials) {
    const description = str(material.description);
    if (!description) continue;
    const key = `${material.article_id ?? description}|${material.quantity}|${material.unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    insert.run(
      id, material.article_id ? num(material.article_id) : null, description,
      num(material.quantity, 1) || 1, str(material.unit) || 'Stk', str(material.source) || 'manuell'
    );
  }
  logActivity('bericht', `Bericht für Auftrag ${db.prepare('SELECT number FROM orders WHERE id = ?').get(orderId)?.number ?? orderId} erstellt.`);
  const details = reportDetails(id);
  details.photos = details.photos.map(photoRow);
  return details;
}, { permission: 'reports.own' });

route('PUT', '/api/reports/:id', (req, res, params) => {
  const report = assertReportAccess(req.user, params.id);
  if (!can(req.user, 'reports.manage')
    && report.user_id !== req.user.id
    && (req.user.employee_id == null || report.employee_id !== req.user.employee_id)) {
    throw new HttpError(403, 'Keine Berechtigung für diesen Bericht');
  }
  const body = req.body ?? {};
  const data = pick(body, ['type', 'content', 'weather', 'hours', 'status']);
  if ('hours' in data) data.hours = num(data.hours);
  if ('status' in data && !['entwurf', 'eingereicht', 'freigegeben', 'abgerechnet'].includes(data.status)) {
    throw new HttpError(400, 'Ungültiger Berichtsstatus');
  }
  if ('status' in data && !can(req.user, 'reports.manage')
    && !['entwurf', 'eingereicht'].includes(data.status)) {
    throw new HttpError(403, 'Freigabe und Abrechnung erfolgen durch Vorgesetzte oder das Büro');
  }
  data.updated_at = new Date().toISOString();
  updateRow('reports', params.id, data);
  const details = reportDetails(params.id);
  details.photos = details.photos.map(photoRow);
  return details;
}, { permissions: ['reports.own', 'reports.manage'] });

route('DELETE', '/api/reports/:id', (req, res, params) => {
  const report = assertReportAccess(req.user, params.id);
  if (!can(req.user, 'reports.manage') && report.user_id !== req.user.id) {
    throw new HttpError(403, 'Keine Berechtigung für diesen Bericht');
  }
  for (const photo of db.prepare('SELECT * FROM photos WHERE report_id = ?').all(params.id)) {
    deletePhoto(photo);
  }
  db.prepare('DELETE FROM reports WHERE id = ?').run(params.id);
  return { ok: true };
}, { permissions: ['reports.own', 'reports.manage'] });

route('POST', '/api/reports/:id/parse', (req, res, params) => {
  assertReportAccess(req.user, params.id);
  const details = reportDetails(params.id);
  const text = str(req.body?.text) || details.report.content;
  const materials = parseMaterials(text);
  return { materials, text };
}, { permissions: ['reports.own', 'reports.manage'] });

route('POST', '/api/reports/:id/materials', (req, res, params) => {
  assertReportAccess(req.user, params.id);
  const items = Array.isArray(req.body?.materials) ? req.body.materials : [req.body ?? {}];
  const insert = db.prepare(
    `INSERT INTO report_materials (report_id, article_id, description, quantity, unit, source)
     VALUES (?,?,?,?,?,?)`
  );
  for (const material of items) {
    const description = str(material.description);
    if (!description) continue;
    insert.run(
      params.id, material.article_id ? num(material.article_id) : null, description,
      num(material.quantity, 1) || 1, str(material.unit) || 'Stk', str(material.source) || 'manuell'
    );
  }
  const details = reportDetails(params.id);
  details.photos = details.photos.map(photoRow);
  return details;
}, { permissions: ['reports.own', 'reports.manage'] });

route('DELETE', '/api/reports/:id/materials/:materialId', (req, res, params) => {
  assertReportAccess(req.user, params.id);
  db.prepare('DELETE FROM report_materials WHERE id = ? AND report_id = ?').run(params.materialId, params.id);
  const details = reportDetails(params.id);
  details.photos = details.photos.map(photoRow);
  return details;
}, { permissions: ['reports.own', 'reports.manage'] });

route('POST', '/api/reports/:id/approve', (req, res, params) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(params.id);
  if (!report) throw new HttpError(404, 'Bericht nicht gefunden');
  db.prepare(
    "UPDATE reports SET status = 'freigegeben', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(req.user.id, params.id);
  logActivity('bericht', `Bericht #${params.id} freigegeben.`);
  emitWebhook('report.approved', { id: report.id, order_id: report.order_id, hours: report.hours });
  const details = reportDetails(params.id);
  details.photos = details.photos.map(photoRow);
  return details;
}, { permission: 'reports.approve' });

route('POST', '/api/reports/:id/apply', (req, res, params) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(params.id);
  if (!report) throw new HttpError(404, 'Bericht nicht gefunden');
  if (report.applied_at) throw new HttpError(409, 'Dieser Bericht wurde bereits übernommen');
  const materials = db.prepare('SELECT * FROM report_materials WHERE report_id = ?').all(params.id);
  if (!materials.length) throw new HttpError(400, 'Der Bericht enthält kein Material');

  let sort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS n FROM order_items WHERE order_id = ?')
    .get(report.order_id).n;
  const insert = db.prepare(
    `INSERT INTO order_items (order_id, kind, article_id, description, quantity, unit, unit_price, sort)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  for (const material of materials) {
    sort += 1;
    const article = material.article_id
      ? db.prepare('SELECT * FROM articles WHERE id = ?').get(material.article_id)
      : null;
    insert.run(
      report.order_id, 'material', material.article_id ?? null, material.description,
      material.quantity, material.unit, article?.sale_price ?? 0, sort
    );
    if (article) {
      adjustStock(article.id, -Number(material.quantity), `Bericht #${report.id}`);
    }
  }
  db.prepare(
    "UPDATE reports SET applied_at = datetime('now'), status = 'abgerechnet', updated_at = datetime('now') WHERE id = ?"
  ).run(params.id);
  logActivity('bericht', `Material aus Bericht #${params.id} in Auftrag übernommen.`);
  const details = reportDetails(params.id);
  details.photos = details.photos.map(photoRow);
  return details;
}, { permission: 'reports.manage' });

// ----------------------------------------------------------------- Fotos
route('POST', '/api/photos', (req) => {
  const body = req.body ?? {};
  const batch = Array.isArray(body.photos) ? body.photos : null;
  const items = batch ?? [body];
  if (!items.length) throw new HttpError(400, 'Keine Fotos übergeben');
  if (items.length > 20) throw new HttpError(400, 'Bitte höchstens 20 Fotos auf einmal übertragen');

  const counts = new Map();
  const saved = [];
  for (const item of items) {
    const dataUrl = item.dataUrl ?? item.data_url;
    if (!dataUrl) throw new HttpError(400, 'Fotodaten fehlen');
    const orderId = num(item.order_id ?? body.order_id);
    if (!orderId) throw new HttpError(400, 'Bitte einen Auftrag auswählen');
    const order = assertOrderAccess(req.user, orderId);
    if (!counts.has(orderId)) {
      counts.set(orderId, db.prepare('SELECT COUNT(*) AS n FROM photos WHERE order_id = ?').get(orderId).n);
    }
    const count = counts.get(orderId);
    if (count >= 200) {
      throw new HttpError(400, 'Für diesen Auftrag sind bereits genug Fotos gespeichert (maximal 200).');
    }
    counts.set(orderId, count + 1);
    const rawReportId = item.report_id ?? body.report_id;
    const reportId = rawReportId ? num(rawReportId) : null;
    if (reportId) {
      const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
      if (!report) throw new HttpError(404, 'Bericht nicht gefunden');
      if (report.order_id !== order.id) throw new HttpError(400, 'Bericht und Auftrag passen nicht zusammen');
    }
    const kindValue = item.kind ?? body.kind;
    const kind = ['vorher', 'nachher', 'sonstiges'].includes(kindValue) ? kindValue : 'sonstiges';
    let photo;
    try {
      photo = savePhoto({
        orderId,
        reportId,
        employeeId: req.user.employee_id ?? null,
        dataUrl,
        kind,
        caption: str(item.caption ?? body.caption),
      });
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    saved.push(photoRow(photo));
  }

  return batch ? saved : saved[0];
}, { permissions: ['photos.own', 'photos.manage'] });

route('GET', '/api/photos', (req, res, params, url) => {
  const clauses = [];
  const values = [];
  const orderId = str(url.searchParams.get('order_id'));
  if (orderId) {
    clauses.push('p.order_id = ?');
    values.push(num(orderId));
  }
  const reportId = str(url.searchParams.get('report_id'));
  if (reportId) {
    clauses.push('p.report_id = ?');
    values.push(num(reportId));
  }
  const kind = str(url.searchParams.get('kind'));
  if (kind) {
    clauses.push('p.kind = ?');
    values.push(kind);
  }
  if (!can(req.user, 'photos.manage')) {
    clauses.push(`EXISTS (SELECT 1 FROM orders o WHERE o.id = p.order_id AND ${ownOrderClause('o')})`);
    values.push(ownEmployeeId(req.user), ownEmployeeId(req.user));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(
    `SELECT p.*, e.name AS employee_name FROM photos p
     LEFT JOIN employees e ON e.id = p.employee_id
     ${where} ORDER BY p.created_at, p.id`
  ).all(...values).map(photoRow);
}, { permissions: ['photos.own', 'photos.manage'] });

route('GET', '/api/photos/:id/file', (req, res, params) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(params.id);
  if (!photo) throw new HttpError(404, 'Foto nicht gefunden');
  assertPhotoAccess(req.user, photo);
  const file = photoFile(photo);
  if (!file) throw new HttpError(404, 'Fotodatei nicht gefunden');
  return { __file: file, mime: photoMime(photo), filename: String(photo.filename).split('/').pop() };
}, { permissions: ['photos.own', 'photos.manage'] });

route('DELETE', '/api/photos/:id', (req, res, params) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(params.id);
  if (!photo) throw new HttpError(404, 'Foto nicht gefunden');
  if (!can(req.user, 'photos.manage')
    && (req.user.employee_id == null || photo.employee_id !== req.user.employee_id)) {
    throw new HttpError(403, 'Dieses Foto gehört nicht zu deinem Konto');
  }
  deletePhoto(photo);
  return { ok: true };
}, { permissions: ['photos.own', 'photos.manage'] });

// ----------------------------------------------------------------- Sprache
route('GET', '/api/voice/search', (req, res, params, url) => {
  const q = str(url.searchParams.get('q'));
  const clauses = ["o.status NOT IN ('storniert')"];
  const values = [];
  if (q) {
    clauses.push(`(o.number LIKE ? OR o.title LIKE ? OR c.company LIKE ? OR c.first_name LIKE ?
      OR c.last_name LIKE ? OR c.street LIKE ? OR c.city LIKE ? OR p.street LIKE ? OR p.label LIKE ?
      OR CAST(o.id AS TEXT) = ?)`);
    const like = `%${q}%`;
    values.push(like, like, like, like, like, like, like, like, like, q);
  }
  if (!hasAllOrders(req.user)) {
    clauses.push(ownOrderClause('o'));
    values.push(ownEmployeeId(req.user), ownEmployeeId(req.user));
  }
  const rows = db.prepare(
    `SELECT o.id, o.number, o.title, o.status, o.doc_type, o.scheduled_date, o.priority,
       c.company, c.first_name, c.last_name, c.street AS customer_street, c.city AS customer_city,
       p.label AS property_label, p.street AS property_street
     FROM orders o
     JOIN customers c ON c.id = o.customer_id
     LEFT JOIN properties p ON p.id = o.property_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY
       CASE WHEN lower(o.number) = lower(?) THEN 0
            WHEN c.last_name LIKE ? OR c.company LIKE ? THEN 1
            WHEN o.title LIKE ? THEN 2
            ELSE 3 END,
       CASE WHEN date(o.scheduled_date) = date('now') THEN 0 ELSE 1 END,
       o.id DESC
     LIMIT 8`
  ).all(...values, q, `%${q}%`, `%${q}%`, `%${q}%`);
  return rows;
}, { permissions: ['orders.view.all', 'orders.view.own'] });


/* ============================================================================
 * HERO-Parität: E-Rechnung, DMS, Kalkulation, Plantafel, Personal, Finanzen,
 * Aufmaß/Unterschrift/Checklisten/Bautagebuch, Inventur, Schnittstellen, Assistent
 * ========================================================================== */

// ----------------------------------------------------------------- E-Rechnung
route('GET', '/api/invoices/:id/einvoice', (req, res, params, url) => asApi(() => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(params.id);
  if (!invoice) throw new HttpError(404, 'Rechnung nicht gefunden');
  if (invoice.status === 'storniert') throw new HttpError(400, 'Stornierte Rechnungen werden nicht als E-Rechnung erzeugt');
  const data = loadInvoiceData(invoice.id);
  const settings = getSettings();
  const requested = str(url.searchParams.get('format')) || invoice.einvoice_format || settings.einvoice_format || 'xrechnung';
  const format = requested === 'zugferd' ? 'zugferd' : 'xrechnung';
  const xml = format === 'zugferd' ? buildZugferdXml(data, settings) : buildXRechnung(data, settings);
  db.prepare(
    "UPDATE invoices SET einvoice_format = ?, einvoice_status = CASE WHEN einvoice_status = 'versendet' THEN 'versendet' ELSE 'erzeugt' END, einvoice_at = datetime('now') WHERE id = ?"
  ).run(format, invoice.id);
  logActivity('rechnung', `${format === 'zugferd' ? 'ZUGFeRD' : 'XRechnung'} für ${invoice.number} erzeugt.`);

  if (format === 'zugferd' && (url.searchParams.get('pdf') === '1' || url.searchParams.get('download') === 'pdf')) {
    const pdf = invoicePdf(invoice.id, { einvoiceXml: xml, persist: true });
    return {
      __pdf: pdf.buffer,
      filename: pdf.filename.replace(/\.pdf$/i, '-zugferd.pdf'),
    };
  }
  return {
    __buffer: Buffer.from(xml, 'utf8'),
    mime: 'application/xml; charset=utf-8',
    filename: xmlFilename(invoice, format),
    disposition: 'attachment',
  };
}), { permission: 'invoices.view' });

route('POST', '/api/invoices/:id/einvoice/status', (req, res, params) => asApi(() => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(params.id);
  if (!invoice) throw new HttpError(404, 'Rechnung nicht gefunden');
  const status = str(req.body?.status) || 'versendet';
  if (!['entwurf', 'erzeugt', 'versendet'].includes(status)) throw new HttpError(400, 'Ungültiger Status');
  db.prepare('UPDATE invoices SET einvoice_status = ?, einvoice_at = datetime(\'now\') WHERE id = ?').run(status, invoice.id);
  return db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id);
}), { permission: 'invoices.manage' });

// ----------------------------------------------------------------- DMS
route('GET', '/api/documents', (req, res, params, url) => asApi(() => asApiListDocuments(req, url)), { permission: 'documents.view' });

function asApiListDocuments(req, url) {
  return listDocuments({
    customerId: url.searchParams.get('customer_id'),
    orderId: url.searchParams.get('order_id'),
    invoiceId: url.searchParams.get('invoice_id'),
    employeeId: url.searchParams.get('employee_id'),
    category: str(url.searchParams.get('category')),
    q: str(url.searchParams.get('q')),
    includeDeleted: url.searchParams.get('deleted') === '1' && can(req.user, 'settings.manage'),
  });
}

route('POST', '/api/documents', (req) => asApi(() => {
  const body = req.body ?? {};
  const upload = decodeUpload(body);
  if (body.order_id) assertOrderAccess(req.user, body.order_id);
  if (body.customer_id) assertCustomerAccess(req.user, body.customer_id);
  if (body.invoice_id && !db.prepare('SELECT 1 FROM invoices WHERE id = ?').get(body.invoice_id)) {
    throw new HttpError(404, 'Rechnung nicht gefunden');
  }
  const document = storeDocument({
    buffer: upload.buffer,
    mime: upload.mime || str(body.mime),
    originalName: str(body.filename) || str(body.original_name),
    title: str(body.title),
    category: str(body.category) || 'sonstiges',
    customerId: body.customer_id ? num(body.customer_id) : null,
    orderId: body.order_id ? num(body.order_id) : null,
    invoiceId: body.invoice_id ? num(body.invoice_id) : null,
    reportId: body.report_id ? num(body.report_id) : null,
    employeeId: body.employee_id ? num(body.employee_id) : null,
    note: str(body.note),
    userId: req.user.id,
    parentId: body.parent_id ? num(body.parent_id) : null,
    ip: clientIp(req),
  });
  emitWebhook('document.uploaded', {
    id: document.id, title: document.title, category: document.category,
    order_id: document.order_id, customer_id: document.customer_id,
  });
  return document;
}), { permission: 'documents.manage' });

route('GET', '/api/documents/:id', (req, res, params) => asApi(() => {
  const row = documentRow(params.id);
  if (!row) throw new HttpError(404, 'Dokument nicht gefunden');
  return { document: row, versions: documentVersions(row.id), events: documentEvents(row.id) };
}), { permission: 'documents.view' });

route('GET', '/api/documents/:id/file', (req, res, params) => asApi(() => {
  const row = documentRow(params.id);
  if (!row) throw new HttpError(404, 'Dokument nicht gefunden');
  const path = documentFilePath(row);
  if (!path) throw new HttpError(404, 'Datei nicht gefunden');
  logDocumentEvent(row.id, req.user.id, 'download', row.original_name || row.title, clientIp(req));
  return {
    __file: path,
    mime: row.mime || 'application/octet-stream',
    filename: row.original_name || row.title,
    disposition: 'attachment',
  };
}), { permission: 'documents.view' });

route('GET', '/api/documents/:id/versions', (req, res, params) => asApi(() => {
  const row = documentRow(params.id);
  if (!row) throw new HttpError(404, 'Dokument nicht gefunden');
  return documentVersions(row.id);
}), { permission: 'documents.view' });

route('POST', '/api/documents/:id/versions', (req, res, params) => asApi(() => {
  const parent = documentRow(params.id);
  if (!parent) throw new HttpError(404, 'Dokument nicht gefunden');
  const body = req.body ?? {};
  const upload = decodeUpload(body);
  const document = storeDocument({
    buffer: upload.buffer,
    mime: upload.mime || str(body.mime),
    originalName: str(body.filename) || parent.original_name,
    title: str(body.title) || parent.title,
    category: parent.category,
    customerId: parent.customer_id,
    orderId: parent.order_id,
    invoiceId: parent.invoice_id,
    reportId: parent.report_id,
    note: str(body.note),
    userId: req.user.id,
    parentId: parent.id,
    ip: clientIp(req),
  });
  return { document, versions: documentVersions(document.id) };
}), { permission: 'documents.manage' });

route('DELETE', '/api/documents/:id', (req, res, params) => asApi(() => {
  const row = documentRow(params.id);
  if (!row) throw new HttpError(404, 'Dokument nicht gefunden');
  return softDeleteDocument(row.id, req.user.id, clientIp(req));
}), { permission: 'documents.manage' });

// ----------------------------------------------------------------- Kalkulation
function assertCalculationAccess(user) {
  if (!can(user, 'invoices.view')) throw new HttpError(403, 'Kalkulation ist nur für Finanzrollen sichtbar');
}

route('GET', '/api/orders/:id/calculation', (req, res, params) => asApi(() => {
  assertCalculationAccess(req.user);
  assertOrderAccess(req.user, params.id);
  const result = orderCalculation(params.id);
  if (!result) throw new HttpError(404, 'Auftrag nicht gefunden');
  return result;
}), { permissions: ['orders.view.all', 'orders.view.own'] });

route('PUT', '/api/orders/:id/calculation', (req, res, params) => asApi(() => {
  assertCalculationAccess(req.user);
  assertOrderAccess(req.user, params.id);
  const result = updateCalculation(params.id, req.body ?? {});
  if (!result) throw new HttpError(404, 'Auftrag nicht gefunden');
  return result;
}), { permissions: ['orders.view.all', 'orders.view.own'] });

route('POST', '/api/orders/:id/calculation/apply', (req, res, params) => asApi(() => {
  assertCalculationAccess(req.user);
  const order = assertOrderAccess(req.user, params.id);
  const result = applyCalculation(order.id, req.body ?? {});
  logActivity('kalkulation', `Kalkulation für ${order.number} in die Positionen übernommen.`);
  return result;
}), { permission: 'orders.manage' });

// ----------------------------------------------------------------- Plantafel
route('GET', '/api/planning/board', (req, res, params, url) => asApi(() => {
  const board = planningBoard({ from: str(url.searchParams.get('from')), to: str(url.searchParams.get('to')) });
  if (!can(req.user, 'planning.manage')) {
    const employeeId = ownEmployeeId(req.user);
    board.employees = board.employees.filter((row) => row.id === employeeId);
    board.appointments = board.appointments.filter((row) => row.employee_id === employeeId);
    board.absences = board.absences.filter((row) => row.employee_id === employeeId);
    board.bookings = board.bookings.filter((row) => row.employee_id === employeeId);
  }
  return board;
}), { permission: 'planning.view' });

route('GET', '/api/resources', () => listResources(), { permission: 'planning.view' });
route('POST', '/api/resources', (req) => asApi(() => createResource(req.body ?? {})), { permissions: ['planning.manage', 'resources.manage'] });
route('PUT', '/api/resources/:id', (req, res, params) => asApi(() => updateResource(params.id, req.body ?? {})), { permissions: ['planning.manage', 'resources.manage'] });
route('DELETE', '/api/resources/:id', (req, res, params) => asApi(() => deleteResource(params.id)), { permissions: ['planning.manage', 'resources.manage'] });

route('GET', '/api/resource-bookings', (req, res, params, url) => asApi(() => {
  const from = str(url.searchParams.get('from')) || addDays(todayISO(), -7);
  const to = str(url.searchParams.get('to')) || addDays(todayISO(), 28);
  const rows = db.prepare(
    `SELECT b.*, r.name AS resource_name, r.type AS resource_type, r.color AS resource_color,
       o.number AS order_number, o.title AS order_title, e.name AS employee_name
     FROM resource_bookings b
     JOIN resources r ON r.id = b.resource_id
     LEFT JOIN orders o ON o.id = b.order_id
     LEFT JOIN employees e ON e.id = b.employee_id
     WHERE date(b.start_at) <= date(?) AND date(b.end_at) >= date(?)
     ORDER BY b.start_at`
  ).all(to, from);
  if (can(req.user, 'planning.manage')) return rows;
  const own = ownEmployeeId(req.user);
  return rows.filter((row) => row.employee_id === own);
}), { permission: 'planning.view' });

route('POST', '/api/resource-bookings', (req) => asApi(() => {
  const body = req.body ?? {};
  if (body.order_id) assertOrderAccess(req.user, body.order_id);
  return createBooking(body);
}), { permission: 'planning.manage' });

route('PUT', '/api/resource-bookings/:id', (req, res, params) => asApi(() =>
  updateBooking(params.id, req.body ?? {})), { permission: 'planning.manage' });

route('DELETE', '/api/resource-bookings/:id', (req, res, params) => asApi(() =>
  deleteBooking(params.id)), { permission: 'planning.manage' });

// ----------------------------------------------------------------- Personal
route('GET', '/api/absences', (req, res, params, url) => asApi(() => {
  const ownOnly = !can(req.user, 'hr.manage') && !can(req.user, 'time.view.all');
  return {
    absences: listAbsences({
      employeeId: ownOnly ? ownEmployeeId(req.user) : (url.searchParams.get('employee_id') || null),
      year: url.searchParams.get('year') || null,
      status: str(url.searchParams.get('status')),
      from: str(url.searchParams.get('from')),
      to: str(url.searchParams.get('to')),
    }),
    types: ABSENCE_TYPES,
    statuses: ABSENCE_STATUS,
  };
}), { permission: 'employees.view' });

route('POST', '/api/absences', (req) => asApi(() => {
  const body = { ...(req.body ?? {}) };
  if (!can(req.user, 'hr.manage')) {
    if (!req.user.employee_id) throw new HttpError(400, 'Dein Benutzerkonto ist keinem Mitarbeiter zugeordnet');
    body.employee_id = req.user.employee_id;
    delete body.status;
  }
  const absence = createAbsence(body, req.user.id);
  logActivity('personal', `Abwesenheit (${ABSENCE_TYPES[absence.type]}) für ${absence.start_date} beantragt.`);
  return absence;
}), { permissions: ['time.own', 'hr.manage'] });

route('POST', '/api/absences/:id/decide', (req, res, params) => asApi(() => {
  const status = str(req.body?.status);
  const absence = decideAbsence(params.id, status, req.user.id);
  logActivity('personal', `Abwesenheit ${absence.id} ${ABSENCE_STATUS[absence.status]}.`);
  return absence;
}), { permission: 'hr.manage' });

route('DELETE', '/api/absences/:id', (req, res, params) => asApi(() => {
  const row = db.prepare('SELECT * FROM absences WHERE id = ?').get(params.id);
  if (!row) throw new HttpError(404, 'Antrag nicht gefunden');
  if (!can(req.user, 'hr.manage')) {
    const own = row.employee_id === req.user.employee_id && row.status === 'beantragt';
    if (!own) throw new HttpError(403, 'Dieser Antrag kann nicht gelöscht werden');
  }
  return deleteAbsence(row.id);
}), { permissions: ['time.own', 'hr.manage'] });

route('GET', '/api/hr/accounts', (req, res, params, url) => asApi(() => {
  const year = Number(url.searchParams.get('year')) || new Date().getFullYear();
  const employeeId = url.searchParams.get('employee_id');
  if (!can(req.user, 'hr.manage')) {
    const own = req.user.employee_id;
    if (!own) throw new HttpError(403, 'Dein Benutzerkonto ist keinem Mitarbeiter zugeordnet');
    if (employeeId && Number(employeeId) !== own) throw new HttpError(403, 'Nur das eigene Konto einsehbar');
    return {
      year,
      vacation: vacationAccount(own, year),
      overtime: overtimeAccount(own, {
        from: `${year}-01-01`,
        to: `${year}-12-31` > todayISO() ? todayISO() : `${year}-12-31`,
      }),
    };
  }
  const overview = hrOverview(year);
  return { year, employees: overview };
}), { permissions: ['hr.manage', 'time.own'] });

route('GET', '/api/hr/my-account', (req, res, params, url) => asApi(() => {
  if (!req.user.employee_id) throw new HttpError(400, 'Dein Benutzerkonto ist keinem Mitarbeiter zugeordnet');
  const year = Number(url.searchParams.get('year')) || new Date().getFullYear();
  return {
    year,
    vacation: vacationAccount(req.user.employee_id, year),
    overtime: overtimeAccount(req.user.employee_id, {
      from: `${year}-01-01`,
      to: `${year}-12-31` > todayISO() ? todayISO() : `${year}-12-31`,
    }),
  };
}), { permission: 'time.own' });

route('PUT', '/api/vacation-entitlements', (req) => asApi(() => {
  const body = req.body ?? {};
  if (!body.employee_id) throw new HttpError(400, 'Bitte einen Mitarbeiter auswählen');
  return setVacationEntitlement(body.employee_id, body.year || new Date().getFullYear(), body.days, body.note);
}), { permission: 'hr.manage' });

route('GET', '/api/time-adjustments', (req, res, params, url) => asApi(() => listAdjustments({
  employeeId: url.searchParams.get('employee_id') || null,
  from: str(url.searchParams.get('from')),
  to: str(url.searchParams.get('to')),
})), { permission: 'hr.manage' });

route('POST', '/api/time-adjustments', (req) => asApi(() =>
  createAdjustment(req.body ?? {}, req.user.id)), { permission: 'hr.manage' });

// ----------------------------------------------------------------- Finanzen
route('GET', '/api/finance/overview', () => asApi(() => financeOverview()), { permission: 'finance.view' });

route('GET', '/api/finance/datev', (req, res, params, url) => asApi(() => {
  const result = datevExport({ from: str(url.searchParams.get('from')), to: str(url.searchParams.get('to')) });
  return {
    __buffer: Buffer.from(result.content, 'utf8'),
    mime: 'text/csv; charset=utf-8',
    filename: result.filename,
    disposition: 'attachment',
  };
}), { permission: 'finance.view' });

route('GET', '/api/finance/lexware', (req, res, params, url) => asApi(() => {
  const result = lexwareExport({ from: str(url.searchParams.get('from')), to: str(url.searchParams.get('to')) });
  return {
    __buffer: Buffer.from(result.content, 'utf8'),
    mime: 'text/csv; charset=utf-8',
    filename: result.filename,
    disposition: 'attachment',
  };
}), { permission: 'finance.view' });

route('GET', '/api/finance/bank', (req, res, params, url) => asApi(() => listBankTransactions({
  from: str(url.searchParams.get('from')),
  to: str(url.searchParams.get('to')),
  status: str(url.searchParams.get('status')),
  unmatched: url.searchParams.get('unmatched') === '1',
  q: str(url.searchParams.get('q')),
})), { permission: 'finance.view' });

route('POST', '/api/finance/bank/import', (req) => asApi(() => {
  const body = req.body ?? {};
  let text = '';
  if (body.content != null) text = String(body.content);
  else if (body.dataUrl) {
    const match = /^data:([^;]+);base64,(.+)$/i.exec(String(body.dataUrl));
    if (!match) throw new HttpError(400, 'Ungültige Datei');
    text = Buffer.from(match[2], 'base64').toString('utf8');
  } else if (body.base64) text = Buffer.from(String(body.base64), 'base64').toString('utf8');
  if (!text) throw new HttpError(400, 'Bitte eine CSV- oder CAMT-Datei übermitteln');
  if (text.length > 8_000_000) throw new HttpError(400, 'Die Datei ist zu groß');
  const result = importBankTransactions(text, { filename: str(body.filename), userId: req.user.id });
  logActivity('finanzen', `${result.imported} Bankumsätze importiert (${result.skipped} Duplikate übersprungen).`);
  return result;
}), { permission: 'finance.manage' });

route('POST', '/api/finance/bank/auto-match', () => asApi(() => autoMatchTransactions()), { permission: 'finance.manage' });

route('POST', '/api/finance/bank/:id/book', (req, res, params) => asApi(() => {
  const result = bookTransaction(params.id, {
    invoiceId: req.body?.invoice_id,
    userId: req.user.id,
    note: str(req.body?.note),
  });
  emitWebhook('invoice.paid', { invoice_id: result.invoice.id, number: result.invoice.number, amount: result.transaction.amount });
  return result;
}), { permission: 'finance.manage' });

route('POST', '/api/finance/bank/:id/unmatch', (req, res, params) => asApi(() =>
  unmatchTransaction(params.id)), { permission: 'finance.manage' });

route('GET', '/api/finance/sepa', (req, res, params, url) => asApi(() => {
  const ids = str(url.searchParams.get('ids')).split(',').map(Number).filter(Boolean);
  return sepaPreview(ids);
}), { permission: 'finance.view' });

route('POST', '/api/finance/sepa', (req) => asApi(() => {
  const result = sepaExport({
    invoiceIds: Array.isArray(req.body?.invoice_ids) ? req.body.invoice_ids : [],
    executionDate: str(req.body?.execution_date),
  });
  logActivity('finanzen', `SEPA-Überweisung über ${result.total.toFixed(2)} € für ${result.count} Rechnungen erzeugt.`);
  return {
    __buffer: Buffer.from(result.content, 'utf8'),
    mime: 'application/xml; charset=utf-8',
    filename: result.filename,
    disposition: 'attachment',
  };
}), { permission: 'finance.manage' });

route('GET', '/api/finance/sepa/file', (req, res, params, url) => asApi(() => {
  const ids = str(url.searchParams.get('ids')).split(',').map(Number).filter(Boolean);
  const result = sepaExport({
    invoiceIds: ids,
    executionDate: str(url.searchParams.get('execution_date')),
  });
  logActivity('finanzen', `SEPA-Überweisung über ${result.total.toFixed(2)} € für ${result.count} Rechnungen erzeugt.`);
  return {
    __buffer: Buffer.from(result.content, 'utf8'),
    mime: 'application/xml; charset=utf-8',
    filename: result.filename,
    disposition: 'attachment',
  };
}), { permission: 'finance.manage' });

// ----------------------------------------------------------------- Aufmaß / Unterschrift / Checklisten / Bautagebuch
route('GET', '/api/orders/:id/measurements', (req, res, params) => asApi(() => {
  assertOrderAccess(req.user, params.id);
  return { measurements: listMeasurements(params.id), categories: MEASUREMENT_CATEGORIES };
}), { permissions: ['orders.view.all', 'orders.view.own'] });

route('POST', '/api/orders/:id/measurements', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  return createMeasurement(order.id, req.body ?? {}, req.user.id);
}), { permission: 'orders.progress' });

route('PUT', '/api/orders/:id/measurements/:measurementId', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  return updateMeasurement(order.id, params.measurementId, req.body ?? {});
}), { permission: 'orders.progress' });

route('DELETE', '/api/orders/:id/measurements/:measurementId', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  return deleteMeasurement(order.id, params.measurementId);
}), { permission: 'orders.progress' });

route('POST', '/api/orders/:id/measurements/apply', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  const body = req.body ?? {};
  const result = applyMeasurements(order.id, {
    ids: Array.isArray(body.ids) ? body.ids : [],
    kind: str(body.kind) || 'material',
    unitPrice: num(body.unit_price),
    roomSuffix: body.room_suffix !== false,
  });
  logActivity('aufmass', `${result.positions} Aufmaßpositionen in ${order.number} übernommen.`);
  return result;
}), { permission: 'orders.manage' });

route('GET', '/api/orders/:id/signatures', (req, res, params) => asApi(() => {
  assertOrderAccess(req.user, params.id);
  return listSignatures(params.id);
}), { permissions: ['orders.view.all', 'orders.view.own'] });

route('POST', '/api/orders/:id/signatures', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  const signature = saveSignature(order.id, req.body ?? {}, { userId: req.user.id, ip: clientIp(req) });
  logActivity('unterschrift', `Auftrag ${order.number} digital unterschrieben (${signature.customer_name}).`);
  return signature;
}), { permission: 'orders.progress' });

route('GET', '/api/signatures/:id/file', (req, res, params) => asApi(() => {
  const row = signatureRow(params.id);
  if (!row) throw new HttpError(404, 'Unterschrift nicht gefunden');
  assertOrderAccess(req.user, row.order_id);
  const path = signatureFilePath(row);
  if (!path) throw new HttpError(404, 'Datei nicht gefunden');
  return { __file: path, mime: 'image/png', filename: `Unterschrift-${row.customer_name}.png`, disposition: 'inline' };
}), { permissions: ['orders.view.all', 'orders.view.own'] });

route('GET', '/api/checklist-templates', () => asApi(() => checklistTemplates()), {
  permissions: ['orders.view.all', 'orders.view.own', 'hr.manage'],
});

route('POST', '/api/checklist-templates', (req) => asApi(() => createChecklistTemplate(req.body ?? {})), {
  permissions: ['orders.manage', 'hr.manage'],
});

route('PUT', '/api/checklist-templates/:id', (req, res, params) => asApi(() =>
  updateChecklistTemplate(params.id, req.body ?? {})), { permissions: ['orders.manage', 'hr.manage'] });

route('DELETE', '/api/checklist-templates/:id', (req, res, params) => asApi(() =>
  deleteChecklistTemplate(params.id)), { permissions: ['orders.manage', 'hr.manage'] });

route('GET', '/api/orders/:id/checklists', (req, res, params) => asApi(() => {
  assertOrderAccess(req.user, params.id);
  return { checklists: orderChecklists(params.id), templates: checklistTemplates().filter((row) => row.active) };
}), { permissions: ['orders.view.all', 'orders.view.own'] });

route('POST', '/api/orders/:id/checklists', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  const body = req.body ?? {};
  return createOrderChecklist(order.id, {
    templateId: body.template_id ?? body.templateId ?? null,
    name: str(body.name),
    items: Array.isArray(body.items) ? body.items : null,
  }, req.user.id);
}), { permission: 'orders.progress' });

route('PUT', '/api/checklists/:id/entries/:entryId', (req, res, params) => asApi(() => {
  const checklist = db.prepare('SELECT * FROM order_checklists WHERE id = ?').get(params.id);
  if (!checklist) throw new HttpError(404, 'Checkliste nicht gefunden');
  assertOrderAccess(req.user, checklist.order_id);
  return updateChecklistEntry(checklist.id, params.entryId, req.body ?? {}, req.user.id);
}), { permission: 'orders.progress' });

route('POST', '/api/checklists/:id/entries', (req, res, params) => asApi(() => {
  const checklist = db.prepare('SELECT * FROM order_checklists WHERE id = ?').get(params.id);
  if (!checklist) throw new HttpError(404, 'Checkliste nicht gefunden');
  assertOrderAccess(req.user, checklist.order_id);
  return addChecklistEntry(checklist.id, req.body?.label);
}), { permission: 'orders.progress' });

route('DELETE', '/api/checklists/:id', (req, res, params) => asApi(() => {
  const checklist = db.prepare('SELECT * FROM order_checklists WHERE id = ?').get(params.id);
  if (!checklist) throw new HttpError(404, 'Checkliste nicht gefunden');
  assertOrderAccess(req.user, checklist.order_id);
  return deleteChecklist(checklist.id);
}), { permission: 'orders.manage' });

route('GET', '/api/orders/:id/diary', (req, res, params) => asApi(() => {
  assertOrderAccess(req.user, params.id);
  return listDiary(params.id);
}), { permissions: ['orders.view.all', 'orders.view.own'] });

route('POST', '/api/orders/:id/diary', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  return createDiaryEntry(order.id, req.body ?? {}, req.user.id);
}), { permission: 'orders.progress' });

route('PUT', '/api/orders/:id/diary/:entryId', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  return updateDiaryEntry(order.id, params.entryId, req.body ?? {});
}), { permission: 'orders.progress' });

route('DELETE', '/api/orders/:id/diary/:entryId', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  return deleteDiaryEntry(order.id, params.entryId);
}), { permission: 'orders.progress' });

route('GET', '/api/orders/:id/site', (req, res, params) => asApi(() => {
  assertOrderAccess(req.user, params.id);
  return siteSummary(params.id);
}), { permissions: ['orders.view.all', 'orders.view.own'] });

// ----------------------------------------------------------------- Inventur & Scan
route('GET', '/api/articles/lookup', (req, res, params, url) => asApi(() => {
  const code = str(url.searchParams.get('code'));
  if (!code) throw new HttpError(400, 'Bitte einen Code scannen oder eingeben');
  const article = lookupArticleByCode(code);
  return { article, code };
}), { permission: 'warehouse.view' });

route('GET', '/api/inventory', () => asApi(() => listInventorySessions()), { permission: 'warehouse.view' });

route('POST', '/api/inventory', (req) => asApi(() =>
  createInventorySession({ ...(req.body ?? {}), userId: req.user.id })), { permission: 'warehouse.manage' });

route('GET', '/api/inventory/:id', (req, res, params) => asApi(() => {
  const result = inventorySession(params.id);
  if (!result) throw new HttpError(404, 'Inventur nicht gefunden');
  return result;
}), { permission: 'warehouse.view' });

route('POST', '/api/inventory/:id/count', (req, res, params) => asApi(() =>
  saveInventoryCount(params.id, {
    articleId: req.body?.article_id,
    code: str(req.body?.code),
    counted: req.body?.counted,
    note: str(req.body?.note),
  }, req.user.id)), { permission: 'warehouse.manage' });

route('POST', '/api/inventory/:id/close', (req, res, params) => asApi(() => {
  const result = closeInventorySession(params.id, req.user.id);
  logActivity('lager', `Inventur „${result.session.name}" abgeschlossen.`);
  return result;
}), { permission: 'warehouse.manage' });

route('DELETE', '/api/inventory/:id', (req, res, params) => asApi(() =>
  deleteInventorySession(params.id)), { permission: 'warehouse.manage' });

// ----------------------------------------------------------------- GAEB / OCI
route('GET', '/api/orders/:id/gaeb', (req, res, params, url) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort, id').all(order.id);
  const x84 = str(url.searchParams.get('format')).toLowerCase() === 'x84';
  const xml = x84 ? exportGaebX84(order, items) : exportGaeb(order, items);
  return {
    __buffer: Buffer.from(xml, 'utf8'),
    mime: 'application/xml; charset=utf-8',
    filename: `${String(order.number || 'LV').replace(/[^A-Za-z0-9._-]+/g, '-')}.${x84 ? 'x84' : 'x83'}`,
    disposition: 'attachment',
  };
}), { permissions: ['orders.view.all', 'orders.view.own'] });

route('GET', '/api/orders/:id/oci', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  const { items } = orderForTransfer(order.id);
  return {
    __buffer: Buffer.from(exportOci(order, items), 'utf8'),
    mime: 'application/xml; charset=utf-8',
    filename: `Bestellung-${String(order.number || order.id).replace(/[^A-Za-z0-9._-]+/g, '-')}.xml`,
    disposition: 'attachment',
  };
}), { permissions: ['warehouse.view', 'orders.view.all', 'orders.view.own'] });

route('POST', '/api/orders/:id/gaeb/import', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  const text = str(req.body?.content);
  if (!text) throw new HttpError(400, 'Bitte eine GAEB-Datei übermitteln');
  const result = importGaebToOrder(order.id, text, { replace: bodyBoolean(req.body?.replace) });
  logActivity('gaeb', `${result.count} GAEB-Positionen in ${order.number} importiert.`);
  return result;
}), { permission: 'orders.manage' });

route('POST', '/api/orders/:id/oci/import', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  const text = str(req.body?.content);
  if (!text) throw new HttpError(400, 'Bitte eine OCI-Bestellung übermitteln');
  const result = importOciToOrder(order.id, text);
  logActivity('oci', `${result.count} OCI-Positionen in ${order.number} importiert.`);
  return result;
}), { permission: 'orders.manage' });

// ----------------------------------------------------------------- Webhooks & API-Doku
route('GET', '/api/webhooks', () => asApi(() => ({ webhooks: listWebhooks() })), { permission: 'settings.manage' });
route('POST', '/api/webhooks', (req) => asApi(() => createWebhook(req.body ?? {})), { permission: 'settings.manage' });
route('PUT', '/api/webhooks/:id', (req, res, params) => asApi(() =>
  updateWebhook(params.id, req.body ?? {})), { permission: 'settings.manage' });
route('DELETE', '/api/webhooks/:id', (req, res, params) => asApi(() => deleteWebhook(params.id)), { permission: 'settings.manage' });
route('GET', '/api/webhooks/:id/deliveries', (req, res, params) => asApi(() =>
  webhookDeliveries(params.id)), { permission: 'settings.manage' });
route('POST', '/api/webhooks/:id/test', async (req, res, params) => asApi(async () =>
  testWebhook(params.id)), { permission: 'settings.manage' });

route('GET', '/api/openapi.json', (req) => ({
  ...openapiDocument(publicBaseUrl(req)),
  paths: openapiDocument().paths,
}), { authenticated: true });

// ----------------------------------------------------------------- Textassistent
route('POST', '/api/assistant/draft', (req) => asApi(() => {
  const body = req.body ?? {};
  const kind = ['angebot', 'mahnung', 'zusammenfassung', 'checkliste', 'email'].includes(str(body.kind))
    ? str(body.kind) : 'angebot';
  if (body.order_id) assertOrderAccess(req.user, body.order_id);
  return draftText({
    kind,
    orderId: body.order_id ? num(body.order_id) : null,
    invoiceId: body.invoice_id ? num(body.invoice_id) : null,
    customerId: body.customer_id ? num(body.customer_id) : null,
    extra: str(body.extra),
  });
}), { permission: 'assistant.use' });

// ============================================================================
// HERO-Parität: Zusammenarbeit, CRM, Kundenportal, Lager, Personal-Erweiterung
// ============================================================================

// ----------------------------------------------------------------- Aufgaben
route('GET', '/api/tasks', (req, res, params, url) => asApi(() => ({
  tasks: listTasks(req.user, {
    status: str(url.searchParams.get('status')),
    orderId: url.searchParams.get('order_id') || null,
    employeeId: url.searchParams.get('employee_id') || null,
  }),
  statuses: TASK_STATUS,
  priorities: TASK_PRIORITIES,
  unread: unreadNotificationCount(req.user),
})), { permission: 'tasks.view' });

route('POST', '/api/tasks', (req) => asApi(() => {
  const body = req.body ?? {};
  if (body.order_id) assertOrderAccess(req.user, body.order_id);
  return createTask(req.user, body);
}), { permission: 'tasks.manage' });

route('PUT', '/api/tasks/:id', (req, res, params) => asApi(() => {
  const body = req.body ?? {};
  if (body.order_id) assertOrderAccess(req.user, body.order_id);
  return updateTask(req.user, params.id, body);
}), { permission: 'tasks.manage' });

route('POST', '/api/tasks/:id/done', (req, res, params) => asApi(() =>
  setTaskDone(req.user, params.id, req.body?.done !== false)), { permission: 'tasks.complete' });

route('DELETE', '/api/tasks/:id', (req, res, params) => asApi(() =>
  deleteTask(req.user, params.id)), { permission: 'tasks.manage' });

// --------------------------------------------------------------- Nachrichten
route('GET', '/api/messages', (req, res, params, url) => asApi(() => {
  const orderId = url.searchParams.get('order_id');
  if (orderId) assertOrderAccess(req.user, orderId);
  return {
    messages: listMessages(req.user, { orderId: orderId || null, limit: url.searchParams.get('limit') || 50 }),
    unread: unreadNotificationCount(req.user),
  };
}), { permission: 'messages.use' });

route('POST', '/api/messages', (req) => asApi(() => {
  const body = req.body ?? {};
  if (body.order_id) assertOrderAccess(req.user, body.order_id);
  return postMessage(req.user, { orderId: body.order_id || null, body: body.body });
}), { permission: 'messages.use' });

route('GET', '/api/notifications', (req, res, params, url) => asApi(() => ({
  items: listNotifications(req.user, {
    unreadOnly: url.searchParams.get('unread') === '1',
    limit: url.searchParams.get('limit') || 30,
  }),
  unread: unreadNotificationCount(req.user),
})), { authenticated: true });

route('POST', '/api/notifications/read', (req) => asApi(() =>
  markNotificationsRead(req.user, Array.isArray(req.body?.ids) ? req.body.ids : null)), { authenticated: true });

route('GET', '/api/feed', (req, res, params, url) => asApi(() =>
  ({ items: activityFeed(url.searchParams.get('limit') || 30) })), { authenticated: true });

// --------------------------------------------------------------------- CRM
route('GET', '/api/lead-stages', () => asApi(() => ({
  stages: leadStages(),
  sources: LEAD_SOURCES,
})), { permission: 'leads.view' });

route('POST', '/api/lead-stages', (req) => asApi(() =>
  createLeadStage(req.body ?? {})), { permission: 'leads.manage' });
route('PUT', '/api/lead-stages/:id', (req, res, params) => asApi(() =>
  updateLeadStage(params.id, req.body ?? {})), { permission: 'leads.manage' });
route('DELETE', '/api/lead-stages/:id', (req, res, params) => asApi(() =>
  deleteLeadStage(params.id)), { permission: 'leads.manage' });

route('GET', '/api/leads', (req, res, params, url) => asApi(() => ({
  leads: listLeads({
    stageId: url.searchParams.get('stage_id') || null,
    q: str(url.searchParams.get('q')),
    limit: Number(url.searchParams.get('limit')) || 200,
  }),
  stages: leadStages(),
  sources: LEAD_SOURCES,
})), { permission: 'leads.view' });

route('GET', '/api/leads/:id', (req, res, params) => asApi(() => {
  const lead = getLead(params.id);
  if (!lead) throw new HttpError(404, 'Anfrage nicht gefunden');
  return lead;
}), { permission: 'leads.view' });

route('POST', '/api/leads', (req) => asApi(() =>
  createLead(req.body ?? {})), { permission: 'leads.manage' });
route('PUT', '/api/leads/:id', (req, res, params) => asApi(() =>
  updateLead(params.id, req.body ?? {})), { permission: 'leads.manage' });
route('DELETE', '/api/leads/:id', (req, res, params) => asApi(() =>
  deleteLead(params.id)), { permission: 'leads.manage' });

route('POST', '/api/leads/:id/convert', (req, res, params) => asApi(() => {
  const result = convertLead(params.id, req.user);
  return result;
}), { permission: 'leads.manage' });

route('POST', '/api/leads/token', (req) => asApi(() => {
  const current = str(getSettings().lead_token);
  const token = current || randomBytes(24).toString('hex');
  if (!current) setSettings({ lead_token: token });
  return { token, path: `/anfrage/${token}` };
}), { permission: 'leads.manage' });

// -------------------------------------------------------------- Kundenportal
route('POST', '/api/customers/:id/portal', (req, res, params) => asApi(() => {
  const customer = assertCustomerAccess(req.user, params.id);
  const token = ensurePortalToken(customer.id);
  logActivity('portal', `Kundenportal-Link für ${customer.company || `${customer.first_name} ${customer.last_name}`.trim()} erstellt.`);
  return { token, path: `/portal/${token}` };
}), { permission: 'portal.manage' });

route('DELETE', '/api/customers/:id/portal', (req, res, params) => asApi(() => {
  const customer = assertCustomerAccess(req.user, params.id);
  revokePortalToken(customer.id);
  return { ok: true };
}), { permission: 'portal.manage' });

// ------------------------------------------------------------------- Lager
route('GET', '/api/orders/:id/reservations', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  return { reservations: listReservations(order.id) };
}), { permission: 'warehouse.view' });

route('POST', '/api/orders/:id/reservations', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  return { reservations: addReservation(req.user, order.id, req.body ?? {}) };
}), { permission: 'warehouse.manage' });

route('PUT', '/api/reservations/:id', (req, res, params) => asApi(() => {
  const row = db.prepare('SELECT * FROM order_reservations WHERE id = ?').get(num(params.id));
  if (!row) throw new HttpError(404, 'Reservierung nicht gefunden');
  assertOrderAccess(req.user, row.order_id);
  return { reservations: updateReservation(row.id, req.body ?? {}) };
}), { permission: 'warehouse.manage' });

route('DELETE', '/api/reservations/:id', (req, res, params) => asApi(() => {
  const row = db.prepare('SELECT * FROM order_reservations WHERE id = ?').get(num(params.id));
  if (!row) throw new HttpError(404, 'Reservierung nicht gefunden');
  assertOrderAccess(req.user, row.order_id);
  return { reservations: deleteReservation(row.id) };
}), { permission: 'warehouse.manage' });

route('GET', '/api/orders/:id/packlist', (req, res, params) => asApi(() => {
  const order = assertOrderAccess(req.user, params.id);
  return packlist(order.id);
}), { permission: 'warehouse.view' });

route('POST', '/api/orders/:id/dealer-order', (req, res, params) => asApi(async () => {
  const order = assertOrderAccess(req.user, params.id);
  return sendDealerOrder(req.user, order.id);
}), { permission: 'warehouse.manage' });

// --------------------------------------------------- Personal-Erweiterung
route('GET', '/api/employment-contracts', (req, res, params, url) => asApi(() => ({
  contracts: listContracts(url.searchParams.get('employee_id') || null),
  kinds: CONTRACT_KINDS,
})), { permissions: ['hr.manage', 'hr.payroll'] });

route('POST', '/api/employment-contracts', (req) => asApi(() =>
  createContract(req.body ?? {})), { permission: 'hr.manage' });
route('PUT', '/api/employment-contracts/:id', (req, res, params) => asApi(() =>
  updateContract(params.id, req.body ?? {})), { permission: 'hr.manage' });
route('DELETE', '/api/employment-contracts/:id', (req, res, params) => asApi(() =>
  deleteContract(params.id)), { permission: 'hr.manage' });

route('GET', '/api/time-categories', (req, res, params, url) => asApi(() => ({
  categories: listTimeCategories({
    includeInactive: url.searchParams.get('all') === '1' && can(req.user, 'hr.manage'),
  }),
})), { authenticated: true });

route('POST', '/api/time-categories', (req) => asApi(() =>
  createTimeCategory(req.body ?? {})), { permission: 'hr.manage' });
route('PUT', '/api/time-categories/:id', (req, res, params) => asApi(() =>
  updateTimeCategory(params.id, req.body ?? {})), { permission: 'hr.manage' });
route('DELETE', '/api/time-categories/:id', (req, res, params) => asApi(() =>
  deleteTimeCategory(params.id)), { permission: 'hr.manage' });

route('GET', '/api/hr/payroll', (req, res, params, url) => asApi(() => {
  const now = new Date();
  return payrollMonth(
    url.searchParams.get('year') || now.getFullYear(),
    url.searchParams.get('month') || now.getMonth() + 1,
  );
}), { permission: 'hr.payroll' });

route('GET', '/api/hr/payroll.csv', (req, res, params, url) => asApi(() => {
  const now = new Date();
  const result = payrollCsv(
    url.searchParams.get('year') || now.getFullYear(),
    url.searchParams.get('month') || now.getMonth() + 1,
  );
  return {
    __buffer: Buffer.from(result.content, 'utf8'),
    mime: 'text/csv; charset=utf-8',
    filename: result.filename,
    disposition: 'attachment',
  };
}), { permission: 'hr.payroll' });

route('GET', '/api/hr/maternity', (req, res, params, url) => asApi(() =>
  maternityProtection(url.searchParams.get('due_date'), {
    weeksBefore: num(url.searchParams.get('weeks_before')) || 6,
    weeksAfter: num(url.searchParams.get('weeks_after')) || 8,
  })), { permission: 'hr.manage' });

route('GET', '/api/employees/:id/file', (req, res, params, url) => asApi(() => {
  const employeeId = num(params.id);
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!employee) throw new HttpError(404, 'Mitarbeiter nicht gefunden');
  const self = req.user.employee_id === employeeId;
  if (!self && !can(req.user, 'hr.manage')) throw new HttpError(403, 'Personalakte nur für HR und die eigene Person');
  const year = Number(url.searchParams.get('year')) || new Date().getFullYear();
  return {
    employee: can(req.user, 'hr.manage') ? employee : sanitizeEmployee(employee),
    contracts: can(req.user, 'hr.manage') ? listContracts(employeeId) : [],
    documents: listDocuments({ employeeId }),
    absences: listAbsences({ employeeId, year }),
    vacation: vacationAccount(employeeId, year),
    overtime: overtimeAccount(employeeId, {
      from: `${year}-01-01`,
      to: `${year}-12-31` > todayISO() ? todayISO() : `${year}-12-31`,
    }),
  };
}), { permissions: ['hr.manage', 'time.own'] });

// ---------------------------------------------------- Öffentliche Seiten
route('POST', '/api/public/leads/:token', (req, res, params) => {
  publicRateLimit(req, 'lead-write', 10, 60_000);
  return asApi(() => publicLeadIntake(params.token, req.body ?? {}));
}, { public: true });

route('GET', '/api/public/portal/:token', (req, res, params) => {
  publicRateLimit(req, 'portal-read', 90, 60_000);
  const data = portalData(params.token);
  if (!data) throw new HttpError(404, 'Dieser Portal-Link ist ungültig oder wurde zurückgezogen');
  return data;
}, { public: true });

route('GET', '/api/public/portal/:token/invoices/:invoiceId/pdf', (req, res, params) => {
  publicRateLimit(req, 'portal-read', 90, 60_000);
  const invoice = portalPdfInvoice(params.token, params.invoiceId);
  if (!invoice) throw new HttpError(404, 'Rechnung nicht gefunden');
  const pdf = invoicePdf(invoice.id);
  if (!pdf) throw new HttpError(404, 'Rechnung nicht gefunden');
  return { __pdf: pdf.buffer, filename: pdf.filename };
}, { public: true });

route('GET', '/api/public/portal/:token/documents/:documentId/file', (req, res, params) => {
  publicRateLimit(req, 'portal-read', 90, 60_000);
  const visible = portalData(params.token);
  if (!visible) throw new HttpError(404, 'Dieser Portal-Link ist ungültig');
  const row = documentRow(params.documentId);
  const ownerOrder = row?.order_id
    ? db.prepare('SELECT customer_id FROM orders WHERE id = ?').get(row.order_id)
    : null;
  const allowed = row && !row.deleted_at && (Number(row.customer_id) === Number(visible.customer.id)
    || Number(ownerOrder?.customer_id) === Number(visible.customer.id));
  if (!allowed) {
    throw new HttpError(404, 'Dokument nicht gefunden');
  }
  const path = documentFilePath(row);
  if (!path) throw new HttpError(404, 'Datei nicht gefunden');
  return {
    __file: path,
    mime: row.mime || 'application/octet-stream',
    filename: row.original_name || row.title,
    disposition: 'attachment',
  };
}, { public: true });

route('POST', '/api/public/portal/:token/messages', (req, res, params) => {
  publicRateLimit(req, 'portal-write', 20, 60_000);
  return asApi(() => {
    const result = portalMessage(params.token, req.body ?? {});
    if (!result) throw new HttpError(404, 'Dieser Portal-Link ist ungültig');
    return result;
  });
}, { public: true });

// ----------------------------------------------------------------- Router
export async function handleApi(req, res, url) {
  const segments = url.pathname.split('/').filter(Boolean);
  req.user = req.user ?? authenticate(req);
  for (const entry of routes) {
    if (entry.method !== req.method || entry.segments.length !== segments.length) continue;
    const params = {};
    let matches = true;
    for (let i = 0; i < entry.segments.length; i += 1) {
      const segment = entry.segments[i];
      if (segment.startsWith(':')) {
        try {
          params[segment.slice(1)] = decodeURIComponent(segments[i]);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'Ungültiger Pfad' }));
          return true;
        }
      } else if (segment !== segments[i]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;

    if (!entry.options.public) {
      if (!req.user) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Bitte zuerst anmelden', code: 'unauthorized' }));
        return true;
      }
      const passwordChangeAllowed = ['/api/auth/password', '/api/auth/logout', '/api/auth/me']
        .includes(url.pathname);
      if (req.user.must_change_password && !passwordChangeAllowed) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          error: 'Bitte zuerst ein neues Passwort festlegen',
          code: 'password_change_required',
        }));
        return true;
      }
      const allowed = entry.options.permission
        ? can(req.user, entry.options.permission)
        : entry.options.permissions
          ? canAny(req.user, entry.options.permissions)
          : entry.options.authenticated === true;
      if (!allowed) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Keine Berechtigung für diese Aktion', code: 'forbidden' }));
        return true;
      }
    }

    try {
      const result = await entry.handler(req, res, params, url);
      if (result?.__sent) return true;
      if (!result) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Nicht gefunden' }));
        return true;
      }
      if (result.__pdf) {
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${result.filename}"`,
          'Content-Length': result.__pdf.length,
          'Cache-Control': 'no-store',
        });
        res.end(result.__pdf);
        return true;
      }
      if (result.__buffer) {
        res.writeHead(200, {
          'Content-Type': result.mime || 'application/octet-stream',
          'Content-Disposition': `${result.disposition || 'attachment'}; filename="${String(result.filename || 'datei').replace(/["\r\n]/g, '')}"`,
          'Content-Length': result.__buffer.length,
          'Cache-Control': 'no-store',
        });
        res.end(result.__buffer);
        return true;
      }
      if (result.__file) {
        if (!existsSync(result.__file)) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Datei nicht gefunden' }));
          return true;
        }
        const buffer = readFileSync(result.__file);
        res.writeHead(200, {
          'Content-Type': result.mime || 'application/octet-stream',
          'Content-Disposition': `${result.disposition || 'inline'}; filename="${String(result.filename || 'datei').replace(/["\r\n]/g, '')}"`,
          'Content-Length': buffer.length,
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(buffer);
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(result));
      return true;
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500) console.error(error);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        error: error.message || 'Interner Fehler',
        ...(error.code ? { code: error.code } : {}),
      }));
      return true;
    }
  }
  return false;
}

export function readBody(req, limit = 16_000_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Anfrage zu groß'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new HttpError(400, 'Ungültiges JSON'));
      }
    });
    req.on('error', reject);
  });
}

export { HttpError };
