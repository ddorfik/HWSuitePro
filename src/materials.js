/**
 * Material- und Katalogdaten aus externen Quellen.
 *
 * Bewusst ohne Laufzeitabhängigkeiten:
 * - Datanorm 4 (Semikolon-Sätze) und BMEcat (XML) werden selbst geparst.
 * - CSV-Import ist tolerant gegenüber Trennzeichen und deutschen Spaltennamen.
 * - Icecat, UPCitemdb, ETIM und eine generische Händler-API laufen über fetch.
 *
 * Alle Quellen sind optional. Zugangsdaten liegen in den Einstellungen und
 * werden nur an Rollen mit `settings.manage` ausgeliefert.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';
import { Buffer } from 'node:buffer';
import { db, getSettings, logActivity, round2 } from './db.js';

export class MaterialError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const str = (value) => (value == null ? '' : String(value).trim());
const asBool = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'on', 'yes', 'ja'].includes(String(value).trim().toLowerCase());
};
const num = (value, fallback = 0) => {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const nowSql = () => db.prepare("SELECT datetime('now') AS now").get().now;
const MAX_ARTICLES = 50_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;

/* ------------------------------------------------------------------ Quellen-Registry */

const field = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });

export const MATERIAL_SOURCES = [
  {
    id: 'datanorm',
    label: 'Datanorm 4',
    kind: 'import',
    enabledKey: 'mat_datanorm_enabled',
    description: 'Artikelstammdaten und Preise aus Datanorm-Dateien (.001, .WRG, DATPREIS). '
      + 'Der Standard der SHK- und Elektro-Großhändler.',
    docs: 'https://datanorm.de/',
    accept: '.001,.d00,.d01,.wrg,.txt',
    fields: [
      field('mat_datanorm_supplier', 'Standard-Lieferant', 'text', {
        placeholder: 'z. B. Richter+Frenzel', full: true,
        hint: 'Wird beim Import vorbelegt; kann dort überschrieben werden.',
      }),
    ],
  },
  {
    id: 'bmecat',
    label: 'BMEcat (XML)',
    kind: 'import',
    enabledKey: 'mat_bmecat_enabled',
    description: 'XML-Kataloge von Herstellern und Großhändlern – inklusive ETIM/eCl@ss, '
      + 'Bildern, Datenblättern und Staffelpreisen.',
    docs: 'https://www.bme.de/services/bmecat/',
    accept: '.xml,.bme',
    fields: [
      field('mat_bmecat_supplier', 'Standard-Lieferant', 'text', {
        placeholder: 'z. B. Sonepar', full: true,
      }),
    ],
  },
  {
    id: 'csv',
    label: 'CSV / Excel-Export',
    kind: 'import',
    enabledKey: 'mat_csv_enabled',
    description: 'Eigene Preislisten oder Händler-Exporte als CSV. Spalten werden automatisch '
      + 'erkannt (Artikelnummer, Bezeichnung, EK, VK, EAN, Hersteller …).',
    docs: '',
    accept: '.csv,.txt',
    fields: [
      field('mat_csv_supplier', 'Standard-Lieferant', 'text', { placeholder: 'z. B. Würth', full: true }),
      field('mat_csv_delimiter', 'Trennzeichen', 'select', {
        options: [
          { value: ';', label: 'Semikolon (;)' },
          { value: ',', label: 'Komma (,)' },
          { value: '\t', label: 'Tabulator' },
          { value: 'auto', label: 'Automatisch erkennen' },
        ],
      }),
    ],
  },
  {
    id: 'icecat',
    label: 'Open Icecat',
    kind: 'lookup',
    enabledKey: 'mat_icecat_enabled',
    description: 'Kostenlose Produktdatenblätter, Bilder und technische Merkmale per GTIN/EAN. '
      + 'Open Icecat deckt nur sponsernde Marken ab; Full Icecat benötigt einen Vertrag.',
    docs: 'https://icecat.biz/',
    test: true,
    fields: [
      field('mat_icecat_shopname', 'Icecat-Benutzername', 'text', {
        placeholder: 'openicecat-live', hint: 'Für den kostenlosen Test reicht „openicecat-live“.',
      }),
      field('mat_icecat_api_token', 'API-Token', 'password', {
        hint: 'Für Full Icecat. Bleibt lokal; wird nie im Klartext ausgeliefert.', advanced: true,
      }),
      field('mat_icecat_content_token', 'Content-Token', 'password', {
        hint: 'Optional, für geschützte Bilder und Dokumente.', advanced: true,
      }),
      field('mat_icecat_lang', 'Sprache', 'select', {
        options: [
          { value: 'DE', label: 'Deutsch' },
          { value: 'EN', label: 'Englisch' },
          { value: 'NL', label: 'Niederländisch' },
          { value: 'FR', label: 'Französisch' },
        ],
      }),
    ],
  },
  {
    id: 'etim',
    label: 'ETIM-Klassifikation',
    kind: 'lookup',
    enabledKey: 'mat_etim_enabled',
    description: 'ETIM-Klassen und Merkmale für SHK und Elektro. Kostenlos für ETIM-Mitglieder; '
      + 'Zugangsdaten gibt es bei ETIM International oder der Länderorganisation.',
    docs: 'https://etimapi.etim-international.com/',
    test: true,
    fields: [
      field('mat_etim_client_id', 'Client-ID', 'text', { full: true }),
      field('mat_etim_client_secret', 'Client-Secret', 'password', { full: true, advanced: true }),
      field('mat_etim_language', 'Sprache', 'text', { placeholder: 'de-DE' }),
    ],
  },
  {
    id: 'upcitemdb',
    label: 'UPCitemdb (Barcode)',
    kind: 'lookup',
    enabledKey: 'mat_upcitemdb_enabled',
    description: 'Barcode-Lookup per EAN/GTIN. Kostenlose Teststufe mit wenigen Anfragen pro Tag; '
      + 'für Produktion einen Schlüssel eintragen.',
    docs: 'https://devs.upcitemdb.com/',
    test: true,
    fields: [
      field('mat_upcitemdb_trial', 'Kostenlose Teststufe nutzen', 'checkbox', {
        checkLabel: 'Trial-Endpunkt verwenden', full: true,
      }),
      field('mat_upcitemdb_key', 'API-Schlüssel', 'password', {
        hint: 'Nur für den kostenpflichtigen Endpunkt nötig.', advanced: true,
      }),
    ],
  },
  {
    id: 'gs1',
    label: 'GS1 / GTIN-Prüfung',
    kind: 'lookup',
    enabledKey: 'mat_gs1_enabled',
    description: 'Prüft GTIN/EAN lokal auf Format und Prüfziffer und verlinkt zu „Verified by GS1“. '
      + 'Kein Schlüssel nötig.',
    docs: 'https://www.gs1.org/services/verified-by-gs1',
    fields: [],
  },
  {
    id: 'dealer',
    label: 'Händler-API (REST/JSON)',
    kind: 'api',
    enabledKey: 'mat_dealer_enabled',
    description: 'Für Großhändler mit eigenem API-Zugang (z. B. Sonepar, Rexel, GC, Richter+Frenzel, '
      + 'Würth). Nur die Felder ausfüllen, die im Vertrag stehen – der Rest bleibt leer.',
    docs: '',
    test: true,
    fields: [
      field('mat_dealer_name', 'Anzeigename', 'text', { placeholder: 'z. B. Sonepar' }),
      field('mat_dealer_base_url', 'Basis-URL', 'text', {
        placeholder: 'https://api.haendler.de', full: true,
        hint: 'Nur HTTPS. Für lokale Tests kann HTTP in den Importoptionen erlaubt werden.',
      }),
      field('mat_dealer_auth_type', 'Anmeldung', 'select', {
        options: [
          { value: 'none', label: 'Keine' },
          { value: 'bearer', label: 'Bearer-Token' },
          { value: 'basic', label: 'Benutzername + Passwort' },
          { value: 'header', label: 'API-Key im Header' },
        ],
      }),
      field('mat_dealer_auth_user', 'Benutzername', 'text', { advanced: true }),
      field('mat_dealer_auth_secret', 'Passwort / Token / API-Key', 'password', { advanced: true }),
      field('mat_dealer_auth_header', 'Header-Name für API-Key', 'text', {
        placeholder: 'X-API-Key', advanced: true,
      }),
      field('mat_dealer_search_path', 'Such-Pfad', 'text', {
        placeholder: '/api/articles?q={query}', full: true,
        hint: 'Platzhalter: {query}, {article}, {gtin}.',
      }),
      field('mat_dealer_article_path', 'Artikel-Pfad', 'text', {
        placeholder: '/api/articles/{article}', full: true, advanced: true,
      }),
      field('mat_dealer_results_path', 'Pfad zur Ergebnisliste', 'text', {
        placeholder: 'data.items', hint: 'Punktschreibweise; leer = Antwort ist die Liste.',
      }),
      field('mat_dealer_map_number', 'Feld: Artikelnummer', 'text', { placeholder: 'number', advanced: true }),
      field('mat_dealer_map_name', 'Feld: Bezeichnung', 'text', { placeholder: 'name', advanced: true }),
      field('mat_dealer_map_price', 'Feld: EK-Preis', 'text', { placeholder: 'purchase_price', advanced: true }),
      field('mat_dealer_map_currency', 'Feld: Währung', 'text', { placeholder: 'currency', advanced: true }),
      field('mat_dealer_map_unit', 'Feld: Einheit', 'text', { placeholder: 'unit', advanced: true }),
      field('mat_dealer_map_manufacturer', 'Feld: Hersteller', 'text', { placeholder: 'manufacturer', advanced: true }),
      field('mat_dealer_map_gtin', 'Feld: GTIN/EAN', 'text', { placeholder: 'gtin', advanced: true }),
      field('mat_dealer_map_stock', 'Feld: Bestand', 'text', { placeholder: 'stock', advanced: true }),
      field('mat_dealer_map_datasheet', 'Feld: Datenblatt-URL', 'text', { placeholder: 'datasheet_url', advanced: true }),
      field('mat_dealer_map_image', 'Feld: Bild-URL', 'text', { placeholder: 'image_url', advanced: true }),
    ],
  },
  {
    id: 'ids',
    label: 'IDS-Connect / Händlershop',
    kind: 'api',
    enabledKey: 'mat_ids_enabled',
    description: 'Öffnet den Artikel im Händlershop (IDS-Connect-Deep-Link) mit den hinterlegten '
      + 'Konditionen. Ideal, wenn der Händler keine offene REST-API anbietet.',
    docs: 'https://itek.de/wissen/verzeichnis-branchenstandards/ids-connect',
    fields: [
      field('mat_ids_supplier', 'Händler', 'text', { placeholder: 'z. B. GC-Gruppe' }),
      field('mat_ids_shop_url', 'Shop-URL', 'text', {
        placeholder: 'https://www.gconlineplus.de', full: true,
      }),
      field('mat_ids_search_path', 'Such-Pfad', 'text', {
        placeholder: '/search?q={article}', full: true,
        hint: 'Platzhalter: {article}, {gtin}.',
      }),
    ],
  },
];

export const MATERIAL_SECRET_SETTINGS = [
  'mat_icecat_api_token',
  'mat_icecat_content_token',
  'mat_etim_client_secret',
  'mat_upcitemdb_key',
  'mat_dealer_auth_secret',
];

const sourceById = new Map(MATERIAL_SOURCES.map((source) => [source.id, source]));

function sourceConfigured(id, settings) {
  switch (id) {
    case 'datanorm':
    case 'bmecat':
    case 'csv':
    case 'gs1':
      return true;
    case 'icecat':
      return Boolean(str(settings.mat_icecat_shopname) || str(settings.mat_icecat_api_token));
    case 'etim':
      return Boolean(str(settings.mat_etim_client_id) && str(settings.mat_etim_client_secret));
    case 'upcitemdb':
      return settings.mat_upcitemdb_trial === '1' || Boolean(str(settings.mat_upcitemdb_key));
    case 'dealer':
      return Boolean(str(settings.mat_dealer_base_url));
    case 'ids':
      return Boolean(str(settings.mat_ids_shop_url));
    default:
      return false;
  }
}

export function materialSources(settings = getSettings(), { withFields = false } = {}) {
  return MATERIAL_SOURCES.map((source) => ({
    id: source.id,
    label: source.label,
    kind: source.kind,
    description: source.description,
    docs: source.docs,
    accept: source.accept || '',
    test: Boolean(source.test),
    enabled: settings[source.enabledKey] === '1',
    configured: sourceConfigured(source.id, settings),
    ...(withFields ? { fields: source.fields } : {}),
  }));
}

/* ------------------------------------------------------------------ Sichere HTTP-Aufrufe */

const PRIVATE_V4 = [
  [/^10\./, '10.0.0.0/8'],
  [/^127\./, 'Loopback'],
  [/^169\.254\./, 'Link-Local'],
  [/^172\.(1[6-9]|2\d|3[01])\./, '172.16.0.0/12'],
  [/^192\.168\./, '192.168.0.0/16'],
  [/^0\./, '0.0.0.0/8'],
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, 'Carrier-NAT'],
];

function isPrivateAddress(address) {
  const value = String(address || '').toLowerCase();
  if (!value) return true;
  if (value === '::1' || value === '::' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) {
    return true;
  }
  if (value.startsWith('::ffff:')) return isPrivateAddress(value.slice(7));
  return PRIVATE_V4.some(([pattern]) => pattern.test(value));
}

async function assertSafeUrl(raw, allowHttp = false) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new MaterialError(400, 'Die Adresse der Datenquelle ist ungültig.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new MaterialError(400, 'Nur HTTP(S)-Adressen sind erlaubt.');
  }
  if (url.protocol === 'http:' && !allowHttp) {
    throw new MaterialError(400, 'Die Datenquelle muss HTTPS verwenden.');
  }
  if (url.username || url.password) {
    throw new MaterialError(400, 'Zugangsdaten gehören nicht in die Adresse.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    if (!allowHttp) {
      throw new MaterialError(400, 'Lokale Adressen sind für Datenquellen nicht erlaubt.');
    }
    return url;
  }
  if (net.isIP(host)) {
    if (!allowHttp && isPrivateAddress(host)) {
      throw new MaterialError(400, 'Private Netzwerkadressen sind für Datenquellen nicht erlaubt.');
    }
    return url;
  }
  let addresses = [];
  try {
    addresses = await dnsLookup(host, { all: true, verbatim: true });
  } catch {
    throw new MaterialError(502, `Der Host „${host}“ konnte nicht aufgelöst werden.`);
  }
  if (!addresses.length || (!allowHttp && addresses.some((entry) => isPrivateAddress(entry.address)))) {
    throw new MaterialError(400, 'Die Datenquelle verweist auf ein privates Netzwerk.');
  }
  return url;
}

/** Nur echte Web-Adressen (http/https, ohne eingebettete Zugangsdaten) zulassen. */
function assertWebUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new MaterialError(400, 'Bitte eine gültige Adresse (http/https) eintragen.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new MaterialError(400, 'Bitte eine gültige Adresse (http/https) ohne Zugangsdaten eintragen.');
  }
  return url;
}

async function safeFetch(raw, {
  method = 'GET', headers = {}, body, timeout = 15_000, maxBytes = 5 * 1024 * 1024,
  allowHttp = false, redirects = 0,
} = {}) {
  if (redirects > 3) throw new MaterialError(502, 'Zu viele Weiterleitungen der Datenquelle.');
  const url = await assertSafeUrl(raw, allowHttp);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new MaterialError(504, 'Die Datenquelle hat nicht rechtzeitig geantwortet.');
    }
    throw new MaterialError(502, 'Die Datenquelle ist nicht erreichbar.');
  }
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    if (!location) throw new MaterialError(502, 'Die Datenquelle antwortet mit einer ungültigen Weiterleitung.');
    return safeFetch(new URL(location, url).toString(), {
      method, headers, body, timeout, maxBytes, allowHttp, redirects: redirects + 1,
    });
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    throw new MaterialError(502, 'Die Antwort der Datenquelle ist zu groß.');
  }
  // Auch bei chunked Antworten hart begrenzen, damit nichts den Speicher flutet.
  let text = '';
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > maxBytes) {
          await reader.cancel();
          throw new MaterialError(502, 'Die Antwort der Datenquelle ist zu groß.');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      try { reader.releaseLock(); } catch { /* bereits geschlossen */ }
    }
    text = Buffer.concat(chunks).toString('utf8');
  } else {
    text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new MaterialError(502, 'Die Antwort der Datenquelle ist zu groß.');
    }
  }
  if (!response.ok) {
    throw new MaterialError(502, `Die Datenquelle antwortet mit HTTP ${response.status}.`);
  }
  return { text, response };
}

function parseJson(text, sourceLabel) {
  try {
    return JSON.parse(text);
  } catch {
    throw new MaterialError(502, `${sourceLabel} hat keine gültige JSON-Antwort geliefert.`);
  }
}

/* ------------------------------------------------------------------ Normalisierung */

const UNIT_MAP = new Map([
  ['STK', 'Stk'], ['STCK', 'Stk'], ['STÜCK', 'Stk'], ['STUECK', 'Stk'], ['C62', 'Stk'], ['PCE', 'Stk'],
  ['M', 'm'], ['MTR', 'm'], ['METER', 'm'], ['LF', 'm'], ['LAUFMETER', 'm'],
  ['KG', 'kg'], ['KGM', 'kg'], ['KILOGRAMM', 'kg'],
  ['L', 'l'], ['LTR', 'l'], ['LITER', 'l'],
  ['PAUSCH', 'Pausch'], ['PAUSCHAL', 'Pausch'], ['STD', 'Std'], ['H', 'Std'], ['HUR', 'Std'],
]);

function normalizeUnit(value) {
  const raw = str(value).toUpperCase();
  if (!raw) return 'Stk';
  if (UNIT_MAP.has(raw)) return UNIT_MAP.get(raw);
  const mapped = UNIT_MAP.get(raw.replace(/[^A-ZÄÖÜ]/g, ''));
  return mapped || str(value).slice(0, 12) || 'Stk';
}

export function normalizeGtin(value) {
  const digits = str(value).replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(digits.length)) return '';
  return digits;
}

export function gtinChecksumValid(value) {
  const gtin = normalizeGtin(value);
  if (!gtin) return false;
  const digits = gtin.split('').map(Number);
  const check = digits.pop();
  let sum = 0;
  digits.reverse().forEach((digit, index) => {
    sum += digit * (index % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10 === check;
}

export function gtinInfo(value) {
  const gtin = normalizeGtin(value);
  return {
    gtin,
    valid: Boolean(gtin) && gtinChecksumValid(gtin),
    gs1Url: gtin ? `https://www.gs1.org/services/verified-by-gs1?query=${encodeURIComponent(gtin)}` : '',
  };
}

function cleanText(value, limit = 240) {
  return str(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function cleanUrl(value) {
  const raw = str(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.toString()
      : '';
  } catch {
    return '';
  }
}

function parseMoney(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? round2(value) : fallback;
  let text = String(value).trim().replace(/[^\d,.-]/g, '');
  if (!text) return fallback;
  if (text.includes(',') && text.includes('.')) {
    text = text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (text.includes(',')) {
    text = text.replace(',', '.');
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? round2(parsed) : fallback;
}

function normalizeItem(raw, defaults = {}) {
  const item = {
    number: cleanText(raw.number, 60),
    name: cleanText(raw.name, 240),
    category: cleanText(raw.category, 60) || defaults.category || 'Material',
    unit: normalizeUnit(raw.unit),
    purchasePrice: parseMoney(raw.purchasePrice, 0),
    salePrice: parseMoney(raw.salePrice, 0),
    stock: raw.stock == null || raw.stock === '' ? null : parseMoney(raw.stock, 0),
    minStock: raw.minStock == null || raw.minStock === '' ? null : parseMoney(raw.minStock, 0),
    supplier: cleanText(raw.supplier, 120),
    gtin: normalizeGtin(raw.gtin),
    manufacturer: cleanText(raw.manufacturer, 120),
    manufacturerNumber: cleanText(raw.manufacturerNumber, 80),
    etimClass: cleanText(raw.etimClass, 40),
    datasheetUrl: cleanUrl(raw.datasheetUrl),
    imageUrl: cleanUrl(raw.imageUrl),
    priceUnit: cleanText(raw.priceUnit, 40),
    source: cleanText(raw.source, 30) || defaults.source || '',
    sourceId: cleanText(raw.sourceId, 80),
    active: raw.active === false ? false : true,
    line: raw.line ?? null,
    warning: '',
  };
  if (!item.name && item.manufacturer && item.manufacturerNumber) {
    item.name = `${item.manufacturer} ${item.manufacturerNumber}`.trim();
  }
  if (!item.name && item.number) item.name = item.number;
  return item;
}

/* ------------------------------------------------------------------ Datei-Dekodierung */

// WHATWG TextDecoder kennt CP850 nicht – Datanorm braucht die klassische IBM-850-Tabelle.
const CP850_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´≡±‗¾¶§÷¸°¨·¹³²■\u00a0';

function decodeCp850(buffer) {
  let out = '';
  for (const byte of buffer) {
    out += byte < 0x80 ? String.fromCharCode(byte) : CP850_HIGH[byte - 0x80];
  }
  return out;
}

function decodeBuffer(buffer, preferred = 'utf-8') {
  if (!buffer.length) return '';
  if (buffer.length > MAX_FILE_BYTES) {
    throw new MaterialError(413, 'Die Datei ist zu groß (maximal 64 MB pro Datei).');
  }
  // Datanorm ist klassisch CP850. Moderne Exporte und Testdaten sind aber oft
  // UTF-8 – daher zuerst strikt UTF-8 prüfen und nur bei Fehlern zurückfallen.
  if (preferred === 'datanorm') {
    try {
      const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      if (/[^\x00-\x7F]/.test(utf8)) return utf8.replace(/^\uFEFF/, '');
    } catch { /* kein gültiges UTF-8 → CP850 */ }
    return decodeCp850(buffer).replace(/^\uFEFF/, '');
  }
  const encodings = ['utf-8', 'windows-1252'];
  let best = '';
  let bestBad = Infinity;
  for (const encoding of encodings) {
    let text;
    try {
      text = new TextDecoder(encoding).decode(buffer);
    } catch {
      continue;
    }
    const bad = (text.match(/\uFFFD/g) || []).length;
    if (bad < bestBad) {
      best = text;
      bestBad = bad;
    }
    if (bad === 0) break;
  }
  return best.replace(/^\uFEFF/, '');
}

function fileBuffer(file) {
  if (typeof file?.base64 === 'string' && file.base64) {
    return Buffer.from(file.base64, 'base64');
  }
  return Buffer.from(String(file?.content ?? ''), 'utf8');
}

/* ------------------------------------------------------------------ Datanorm 4 */

const DATANORM_UNIT_FACTOR = { 0: 1, 1: 10, 2: 100, 3: 1000 };

function datanormPrice(cents, indicator, taxRate, factor = 1) {
  const raw = Number(String(cents ?? '').replace(/[^\d-]/g, ''));
  if (!raw) return 0;
  let price = raw / 100 / (factor || 1);
  if (String(indicator) === '1') price /= 1 + (taxRate / 100);
  return round2(price);
}

function datanormPriceUnit(priceUnitRaw, unit) {
  const factor = DATANORM_UNIT_FACTOR[String(priceUnitRaw)] ?? 1;
  return factor > 1 ? `${factor} ${unit}` : unit;
}

function parseDatanormHeader(line, meta) {
  // V + Leerzeichen + Datum(6) + Text1(40) + Text2(40) + Text3(35) + Version(2) + Währung(3)
  meta.date = str(line.slice(2, 8));
  meta.header1 = cleanText(line.slice(8, 48), 120);
  meta.header2 = cleanText(line.slice(48, 88), 120);
  meta.header3 = cleanText(line.slice(88, 123), 120);
  meta.version = Number(str(line.slice(123, 125))) || 0;
  meta.currency = cleanText(line.slice(125, 128), 3) || 'EUR';
  meta.supplier = meta.header1 || meta.header2 || '';
}

function applyDatanormDiscounts(price, parts, offset) {
  let result = price;
  for (let index = 0; index < 3; index += 1) {
    const code = str(parts[offset + index * 2]);
    const value = Number(String(parts[offset + index * 2 + 1] ?? '').replace(/[^\d-]/g, ''));
    if (!code || !value) continue;
    if (code === '1') result -= result * (value / 10_000);
    else if (code === '2') result *= value / 1_000;
    else if (code === '3') result += result * (value / 100);
  }
  return round2(result);
}

export function parseDatanorm(files, { taxRate = 19 } = {}) {
  const meta = { version: 0, currency: 'EUR', supplier: '', date: '', header1: '', header2: '', header3: '' };
  const items = new Map();
  const groups = new Map();
  const pendingPrices = new Map();
  const deleted = new Set();
  let lineNumber = 0;

  const getItem = (number) => items.get(str(number));

  for (const file of files) {
    const text = decodeBuffer(fileBuffer(file), 'datanorm');
    for (const rawLine of text.split(/\r?\n/)) {
      lineNumber += 1;
      const line = rawLine.replace(/\u0000/g, '').trimEnd();
      if (!line) continue;
      if (line.startsWith('V ')) {
        parseDatanormHeader(line, meta);
        continue;
      }
      const parts = line.split(';');
      const tag = parts[0];
      if (tag === 'A') {
        const number = cleanText(parts[2], 60);
        const name = cleanText([parts[4], parts[5]].filter(Boolean).join(' '), 240);
        if (!number || !name) continue;
        const unit = normalizeUnit(parts[8]);
        const factor = DATANORM_UNIT_FACTOR[str(parts[7])] ?? 1;
        const item = normalizeItem({
          number,
          name,
          category: '',
          unit,
          purchasePrice: datanormPrice(parts[9], parts[6], taxRate, factor),
          priceUnit: datanormPriceUnit(parts[7], unit),
          supplier: meta.supplier,
          source: 'datanorm',
          sourceId: number,
          line: lineNumber,
        });
        item.textIndicator = cleanText(parts[3], 10);
        item.groupCode = cleanText(parts[11], 20);
        item.longtexts = [];
        item.priceFactor = factor;
        items.set(number, item);
        if (str(parts[1]).toUpperCase() === 'L') deleted.add(number);
      } else if (tag === 'B') {
        const item = getItem(parts[2]);
        if (!item) continue;
        item.gtin = normalizeGtin(parts[9]);
        item.matchcode = cleanText(parts[3], 80);
        if (!item.manufacturerNumber) item.manufacturerNumber = item.matchcode;
        item.manufacturer = cleanText(parts[14], 120) || item.manufacturer;
        item.groupCode = item.groupCode || cleanText(parts[11], 20);
        item.minOrderQuantity = parseMoney(parts[13], null);
      } else if (tag === 'D') {
        const item = getItem(parts[2]);
        if (!item || item.longtexts.length >= 20) continue;
        const textLine = cleanText([parts[5], parts[6]].filter(Boolean).join(' '), 400);
        if (textLine) item.longtexts.push(textLine);
      } else if (tag === 'S') {
        const mainId = cleanText(parts[2], 20);
        const mainName = cleanText(parts[3], 80);
        const subId = cleanText(parts[4], 20);
        const subName = cleanText(parts[5], 80);
        if (mainId && mainName) groups.set(mainId, mainName);
        if (subId && subName) groups.set(subId, subName);
      } else if (tag === 'P') {
        let index = 2;
        while (index + 8 < parts.length) {
          const article = str(parts[index]);
          const indicator = str(parts[index + 1]);
          const cents = parts[index + 2];
          if (!article) break;
          const base = datanormPrice(cents, indicator, taxRate, 1);
          const withDiscount = applyDatanormDiscounts(base, parts, index + 3);
          if (withDiscount > 0) {
            const existing = pendingPrices.get(article) || [];
            existing.push(withDiscount);
            pendingPrices.set(article, existing);
          }
          index += 9;
        }
      }
    }
  }

  for (const [number, prices] of pendingPrices) {
    const item = items.get(number);
    if (!item) continue;
    // Der letzte P-Satz ist der kundenspezifische Netto-Preis.
    item.purchasePrice = round2(prices[prices.length - 1] / (item.priceFactor || 1));
  }

  for (const item of items.values()) {
    item.category = groups.get(item.groupCode) || (item.groupCode ? `Warengruppe ${item.groupCode}` : 'Material');
    if (!item.name && item.longtexts.length) item.name = item.longtexts[0];
    if (!item.manufacturer) {
      const match = item.name.match(/^([A-ZÄÖÜ0-9&+.\-]{2,}(?:\s+[A-ZÄÖÜ0-9&+.\-]{1,})?)\s+/);
      if (match && match[1].length <= 24) item.manufacturer = match[1];
    }
    if (deleted.has(item.number)) item.active = false;
  }

  return {
    items: [...items.values()],
    deleted: [...deleted],
    supplier: meta.supplier,
    meta,
  };
}

/* ------------------------------------------------------------------ XML / BMEcat */

function decodeXmlEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function localName(name) {
  return String(name).split(':').pop();
}

/** Kleiner, toleranter XML-Parser (ohne externe Bibliothek). */
export function parseXml(text) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let index = 0;
  const source = String(text);
  while (index < source.length) {
    const lt = source.indexOf('<', index);
    if (lt === -1) {
      const tail = source.slice(index);
      if (tail) stack[stack.length - 1].text += decodeXmlEntities(tail);
      break;
    }
    if (lt > index) {
      const textPart = source.slice(index, lt);
      if (textPart.trim()) stack[stack.length - 1].text += decodeXmlEntities(textPart);
    }
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      index = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9);
      const cdata = source.slice(lt + 9, end === -1 ? source.length : end);
      stack[stack.length - 1].text += cdata;
      index = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<?', lt) || source.startsWith('<!', lt)) {
      const end = source.indexOf('>', lt + 2);
      index = end === -1 ? source.length : end + 1;
      continue;
    }
    const gt = source.indexOf('>', lt + 1);
    if (gt === -1) break;
    const raw = source.slice(lt + 1, gt).trim();
    index = gt + 1;
    if (!raw) continue;
    if (raw.startsWith('/')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1).trim() : raw;
    const match = body.match(/^([^\s/>]+)([\s\S]*)$/);
    if (!match) continue;
    const name = match[1];
    const attrs = {};
    const attrSource = match[2] || '';
    const attrRegex = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrSource))) {
      attrs[attrMatch[1]] = decodeXmlEntities(attrMatch[3] ?? attrMatch[4] ?? '');
    }
    const node = { name, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

function directChildren(node, name) {
  return node.children.filter((child) => localName(child.name) === name);
}

function firstChild(node, name) {
  return node.children.find((child) => localName(child.name) === name) || null;
}

function nodeText(node) {
  if (!node) return '';
  return cleanText(node.text || '', 1000);
}

function firstText(node, names) {
  for (const name of names) {
    const child = firstChild(node, name);
    if (child && nodeText(child)) return nodeText(child);
  }
  return '';
}

function descendant(node, name, depth = 6) {
  if (!node || depth < 0) return null;
  for (const child of node.children) {
    if (localName(child.name) === name) return child;
  }
  for (const child of node.children) {
    const found = descendant(child, name, depth - 1);
    if (found) return found;
  }
  return null;
}

function descendants(node, name, depth = 8, out = []) {
  if (!node || depth < 0) return out;
  for (const child of node.children) {
    if (localName(child.name) === name) out.push(child);
    descendants(child, name, depth - 1, out);
  }
  return out;
}

function bmecatUnit(value) {
  const raw = str(value).toUpperCase();
  const map = {
    C62: 'Stk', H87: 'Stk', EA: 'Stk', PCE: 'Stk',
    MTR: 'm', M: 'm', LM: 'm',
    KGM: 'kg', KG: 'kg',
    LTR: 'l', L: 'l',
    HUR: 'Std', H: 'Std',
  };
  return map[raw] || normalizeUnit(raw) || 'Stk';
}

function bmecatPrice(product, taxRate) {
  const priceNodes = [
    ...descendants(product, 'ARTICLE_PRICE', 8),
    ...descendants(product, 'PRODUCT_PRICE', 8),
    ...descendants(product, 'PRICE', 8),
  ];
  if (!priceNodes.length) return { price: 0, currency: 'EUR' };
  const ranked = [...priceNodes].sort((a, b) => {
    const score = (node) => {
      const type = str(node.attrs.price_type || node.attrs.type).toLowerCase();
      if (type.includes('net_customer')) return 0;
      if (type.includes('net_list')) return 1;
      if (type === 'net' || type.includes('net')) return 2;
      if (type.includes('gross')) return 4;
      return 3;
    };
    return score(a) - score(b);
  });
  const node = ranked[0];
  const amount = parseMoney(firstText(node, ['PRICE_AMOUNT', 'AMOUNT']), 0);
  const currency = firstText(node, ['PRICE_CURRENCY', 'CURRENCY']) || 'EUR';
  const tax = parseMoney(firstText(node, ['TAX', 'TAX_RATE']), taxRate);
  const type = str(node.attrs.price_type || node.attrs.type).toLowerCase();
  const quantity = parseMoney(firstText(product, ['PRICE_QUANTITY']), 1) || 1;
  let price = amount / quantity;
  if (type.includes('gross')) price /= 1 + (tax / 100);
  return { price: round2(price), currency, quantity };
}

function bmecatClassification(product) {
  const nodes = descendants(product, 'CLASSIFICATION', 6);
  let etim = '';
  let category = '';
  for (const node of nodes) {
    const system = firstText(node, ['CLASSIFICATION_SYSTEM_NAME', 'SYSTEM_NAME']).toUpperCase();
    const id = firstText(node, ['CLASSIFICATION_ID', 'ID']);
    if (!id) continue;
    if (system.includes('ETIM') && !etim) etim = id;
    else if (!category) category = id;
  }
  return { etim, category };
}

function bmecatMedia(product) {
  let image = '';
  let datasheet = '';
  const mimes = descendants(product, 'MIME', 7);
  for (const mime of mimes) {
    const source = firstText(mime, ['MIME_SOURCE', 'SOURCE']);
    const purpose = firstText(mime, ['MIME_PURPOSE', 'PURPOSE']).toLowerCase();
    const type = firstText(mime, ['MIME_TYPE', 'TYPE']).toLowerCase();
    const url = cleanUrl(source);
    if (!url) continue;
    if (!image && (purpose.includes('normal') || purpose.includes('product') || type.startsWith('image/'))) {
      image = url;
    }
    if (!datasheet && (purpose.includes('manual') || purpose.includes('data') || type === 'application/pdf')) {
      datasheet = url;
    }
  }
  const picture = descendants(product, 'PRODUCT_PICTURE', 5)[0];
  if (!image && picture) image = cleanUrl(firstText(picture, ['MIME_SOURCE', 'SOURCE']));
  return { image, datasheet };
}

export function parseBmecat(files, { taxRate = 19 } = {}) {
  const items = [];
  let supplier = '';
  for (const file of files) {
    const text = decodeBuffer(fileBuffer(file), 'utf-8');
    const root = parseXml(text);
    const header = descendant(root, 'HEADER', 4);
    if (header) supplier = supplier || firstText(header, ['SUPPLIER_NAME', 'SUPPLIER']);
    const products = [];
    const walk = (node, depth = 0) => {
      if (!node || depth > 12) return;
      const name = localName(node.name);
      if (name === 'PRODUCT' || name === 'ARTICLE') products.push(node);
      for (const child of node.children) walk(child, depth + 1);
    };
    walk(root);
    for (const product of products) {
      const number = firstText(product, ['SUPPLIER_AID', 'PRODUCT_ID', 'SUPPLIER_PID', 'ARTICLE_ID'])
        || firstText(descendant(product, 'PRODUCT_IDENTIFIER', 4), ['SUPPLIER_AID', 'ID']);
      let name = firstText(product, ['DESCRIPTION_SHORT', 'PRODUCT_NAME', 'NAME']);
      if (!name) name = firstText(product, ['DESCRIPTION_LONG', 'LONG_DESCRIPTION']);
      const ean = firstText(product, ['EAN', 'GTIN', 'INTERNATIONAL_PID']);
      const manufacturer = firstText(product, ['MANUFACTURER_NAME', 'MANUFACTURER']);
      const manufacturerNumber = firstText(product, ['MANUFACTURER_AID', 'MANUFACTURER_PID']);
      const orderUnit = firstText(product, ['ORDER_UNIT', 'UNIT']);
      const unit = bmecatUnit(orderUnit);
      const price = bmecatPrice(product, taxRate);
      const classification = bmecatClassification(product);
      const media = bmecatMedia(product);
      const group = firstText(product, ['PRODUCT_GROUP', 'ARTICLE_GROUP', 'GROUP_ID']);
      if (!number || !name) continue;
      items.push(normalizeItem({
        number,
        name,
        category: group || classification.category || 'Material',
        unit,
        purchasePrice: price.price,
        priceUnit: price.quantity > 1 ? `${price.quantity} ${unit}` : unit,
        supplier,
        gtin: ean,
        manufacturer,
        manufacturerNumber,
        etimClass: classification.etim,
        datasheetUrl: media.datasheet,
        imageUrl: media.image,
        source: 'bmecat',
        sourceId: number,
      }));
    }
  }
  return { items, supplier, meta: { currency: 'EUR' } };
}

/* ------------------------------------------------------------------ CSV */

function splitCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let fieldValue = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          fieldValue += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        fieldValue += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(fieldValue);
      fieldValue = '';
    } else if (char === '\n') {
      row.push(fieldValue);
      if (row.some((entry) => entry.trim())) rows.push(row);
      row = [];
      fieldValue = '';
    } else if (char !== '\r') {
      fieldValue += char;
    }
  }
  row.push(fieldValue);
  if (row.some((entry) => entry.trim())) rows.push(row);
  return rows;
}

const CSV_ALIASES = {
  number: ['artikelnummer', 'artikelnr', 'artnr', 'artnr.', 'artikel-nr', 'number', 'sku', 'bestellnummer', 'supplier_aid', 'artikelid'],
  name: ['bezeichnung', 'name', 'artikelbezeichnung', 'beschreibung', 'description', 'title', 'kurztext'],
  category: ['kategorie', 'warengruppe', 'category', 'gruppe', 'product_group'],
  unit: ['einheit', 'mengeneinheit', 'me', 'unit', 'order_unit'],
  purchasePrice: ['ek', 'ekpreis', 'einkaufspreis', 'purchase_price', 'preis', 'price', 'netto', 'nettopreis'],
  salePrice: ['vk', 'vkpreis', 'verkaufspreis', 'sale_price', 'listenpreis'],
  stock: ['bestand', 'stock', 'lagerbestand', 'menge'],
  minStock: ['mindestbestand', 'min_stock', 'min', 'minbestand'],
  supplier: ['lieferant', 'supplier', 'hersteller', 'manufacturer'],
  gtin: ['gtin', 'ean', 'ean_gtin', 'barcode', 'upc'],
  manufacturer: ['hersteller', 'manufacturer', 'marke', 'brand'],
  manufacturerNumber: ['herstellernummer', 'mpn', 'manufacturer_number', 'hersteller_artnr', 'herstellerartikelnummer'],
  etimClass: ['etim', 'etimklasse', 'etim_class'],
  datasheetUrl: ['datenblatt', 'datasheet', 'datasheet_url', 'pdf'],
  imageUrl: ['bild', 'image', 'image_url', 'bild_url'],
  active: ['aktiv', 'active'],
};

const normalizeHeader = (value) => str(value).toLowerCase()
  .replace(/^\uFEFF/, '')
  .replace(/[\s._\-/()]+/g, '');

function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find((entry) => entry.trim()) || '';
  const counts = [
    [';', (line.match(/;/g) || []).length],
    [',', (line.match(/,/g) || []).length],
    ['\t', (line.match(/\t/g) || []).length],
    ['|', (line.match(/\|/g) || []).length],
  ].sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ';';
}

export function parseCsv(files, { taxRate = 19, delimiter = ';' } = {}) {
  const items = [];
  let supplier = '';
  for (const file of files) {
    const text = decodeBuffer(fileBuffer(file), 'utf-8');
    const separator = delimiter === 'auto' || !delimiter ? detectDelimiter(text) : delimiter;
    const rows = splitCsv(text, separator);
    if (!rows.length) continue;
    const headerRow = rows[0].map(normalizeHeader);
    const mapping = {};
    for (const [canonical, aliases] of Object.entries(CSV_ALIASES)) {
      const aliasSet = new Set(aliases.map(normalizeHeader));
      const index = headerRow.findIndex((entry) => aliasSet.has(entry));
      if (index !== -1) mapping[canonical] = index;
    }
    const hasHeader = Object.keys(mapping).length >= 2;
    const dataRows = hasHeader ? rows.slice(1) : rows;
    if (!hasHeader) {
      ['number', 'name', 'category', 'unit', 'purchasePrice', 'salePrice', 'stock', 'minStock', 'supplier', 'gtin']
        .forEach((key, index) => { mapping[key] = index; });
    }
    dataRows.forEach((row, rowIndex) => {
      if (items.length >= MAX_ARTICLES) return;
      const value = (key) => (mapping[key] == null ? '' : row[mapping[key]] ?? '');
      const number = cleanText(value('number'), 60);
      const name = cleanText(value('name'), 240);
      if (!number && !name) return;
      const raw = {
        number: number || `EXT-${String(rowIndex + 1).padStart(5, '0')}`,
        name,
        category: value('category'),
        unit: value('unit'),
        purchasePrice: value('purchasePrice'),
        salePrice: value('salePrice'),
        stock: value('stock'),
        minStock: value('minStock'),
        supplier: value('supplier') || supplier,
        gtin: value('gtin'),
        manufacturer: value('manufacturer'),
        manufacturerNumber: value('manufacturerNumber'),
        etimClass: value('etimClass'),
        datasheetUrl: value('datasheetUrl'),
        imageUrl: value('imageUrl'),
        source: 'csv',
        sourceId: number,
        line: rowIndex + (hasHeader ? 2 : 1),
      };
      if (value('active') !== '') raw.active = !['0', 'nein', 'false', 'inaktiv'].includes(str(value('active')).toLowerCase());
      const item = normalizeItem(raw);
      if (item.purchasePrice <= 0 && item.salePrice > 0 && taxRate >= 0) {
        // Kein EK angegeben: VK bleibt erhalten, EK wird nicht künstlich berechnet.
        item.purchasePrice = 0;
      }
      items.push(item);
    });
  }
  return { items, supplier, meta: { delimiter } };
}

/* ------------------------------------------------------------------ Import in die Datenbank */

function findArticle(item) {
  if (item.gtin) {
    const row = db.prepare('SELECT * FROM articles WHERE gtin = ? LIMIT 1').get(item.gtin);
    if (row) return row;
  }
  if (item.manufacturerNumber && item.manufacturer) {
    const row = db.prepare(
      'SELECT * FROM articles WHERE lower(manufacturer) = lower(?) AND lower(manufacturer_number) = lower(?) LIMIT 1'
    ).get(item.manufacturer, item.manufacturerNumber);
    if (row) return row;
  }
  if (item.number) {
    const row = db.prepare('SELECT * FROM articles WHERE lower(number) = lower(?) LIMIT 1').get(item.number);
    if (row) return row;
  }
  return null;
}

function uniqueNumber(base) {
  const cleaned = cleanText(base, 60).replace(/\s+/g, '-') || `EXT-${Date.now()}`;
  let candidate = cleaned;
  let counter = 2;
  while (db.prepare('SELECT 1 FROM articles WHERE lower(number) = lower(?)').get(candidate)) {
    candidate = `${cleaned}-${counter}`;
    counter += 1;
    if (counter > 9999) break;
  }
  return candidate;
}

const ARTICLE_COLUMNS = [
  'number', 'name', 'category', 'unit', 'purchase_price', 'sale_price', 'stock', 'min_stock',
  'supplier', 'active', 'gtin', 'manufacturer', 'manufacturer_number', 'etim_class',
  'datasheet_url', 'image_url', 'source', 'source_id', 'price_unit', 'last_sync_at',
];

function articleValues(row) {
  return [
    row.number, row.name, row.category, row.unit, row.purchase_price, row.sale_price,
    row.stock, row.min_stock, row.supplier, row.active, row.gtin, row.manufacturer,
    row.manufacturer_number, row.etim_class, row.datasheet_url, row.image_url,
    row.source, row.source_id, row.price_unit, row.last_sync_at,
  ];
}

export function importCatalog({ source, supplier = '', files = [], options = {}, userId = null } = {}) {
  if (!['datanorm', 'bmecat', 'csv'].includes(source)) {
    throw new MaterialError(400, 'Unbekannte Importquelle.');
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new MaterialError(400, 'Bitte mindestens eine Datei auswählen.');
  }
  if (files.length > 10) {
    throw new MaterialError(400, 'Bitte höchstens 10 Dateien auf einmal importieren.');
  }
  const settings = getSettings();
  const sourceDefinition = sourceById.get(source);
  if (!sourceDefinition || settings[sourceDefinition.enabledKey] !== '1') {
    throw new MaterialError(400, 'Diese Importquelle ist in den Einstellungen ausgeschaltet.');
  }
  const taxRate = num(settings.default_tax_rate, 19);
  const markup = options.markup != null ? num(options.markup, 30) : num(settings.mat_markup_default, 30);
  const updatePrices = options.updatePrices != null
    ? asBool(options.updatePrices, true)
    : settings.mat_import_update_prices === '1';
  const keepSalePrice = options.keepSalePrice != null
    ? asBool(options.keepSalePrice, true)
    : settings.mat_import_keep_sale_price === '1';
  const updateStock = options.updateStock != null
    ? asBool(options.updateStock, false)
    : settings.mat_import_update_stock === '1';
  const supplierName = cleanText(supplier, 120)
    || cleanText(settings[`mat_${source}_supplier`], 120);

  let parsed;
  if (source === 'datanorm') parsed = parseDatanorm(files, { taxRate });
  else if (source === 'bmecat') parsed = parseBmecat(files, { taxRate });
  else parsed = parseCsv(files, { taxRate, delimiter: settings.mat_csv_delimiter });

  const finalSupplier = supplierName || cleanText(parsed.supplier, 120);
  const items = parsed.items.slice(0, MAX_ARTICLES);
  const details = [];
  const counts = { total: items.length, created: 0, updated: 0, skipped: 0, errors: 0 };
  const timestamp = nowSql();

  const insert = db.prepare(
    `INSERT INTO articles (${ARTICLE_COLUMNS.join(', ')}) VALUES (${ARTICLE_COLUMNS.map(() => '?').join(', ')})`
  );
  const update = db.prepare(
    `UPDATE articles SET ${ARTICLE_COLUMNS.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`
  );

  db.exec('BEGIN');
  try {
    for (const raw of items) {
      try {
        const existing = findArticle(raw);
        if (!raw.number && !raw.name) {
          counts.skipped += 1;
          continue;
        }
        const number = existing?.number || uniqueNumber(raw.number || `EXT-${raw.gtin || raw.manufacturerNumber || Date.now()}`);
        const purchase = updatePrices && raw.purchasePrice > 0
          ? raw.purchasePrice
          : Number(existing?.purchase_price ?? 0);
        let sale = Number(existing?.sale_price ?? 0);
        if (raw.salePrice > 0 && (!existing || !keepSalePrice)) sale = raw.salePrice;
        else if (!existing || !keepSalePrice || !sale) sale = round2(purchase * (1 + markup / 100));
        const stock = updateStock && raw.stock != null
          ? raw.stock
          : Number(existing?.stock ?? raw.stock ?? 0);
        const minStock = raw.minStock != null
          ? raw.minStock
          : Number(existing?.min_stock ?? 0);
        const row = {
          number,
          name: raw.name || existing?.name || number,
          category: raw.category || existing?.category || 'Material',
          unit: raw.unit || existing?.unit || 'Stk',
          purchase_price: purchase,
          sale_price: round2(sale),
          stock,
          min_stock: minStock,
          supplier: finalSupplier || existing?.supplier || '',
          active: raw.active === false ? 0 : (existing?.active ?? 1),
          gtin: raw.gtin || existing?.gtin || '',
          manufacturer: raw.manufacturer || existing?.manufacturer || '',
          manufacturer_number: raw.manufacturerNumber || existing?.manufacturer_number || '',
          etim_class: raw.etimClass || existing?.etim_class || '',
          datasheet_url: raw.datasheetUrl || existing?.datasheet_url || '',
          image_url: raw.imageUrl || existing?.image_url || '',
          source,
          source_id: raw.sourceId || existing?.source_id || '',
          price_unit: raw.priceUnit || existing?.price_unit || '',
          last_sync_at: timestamp,
        };
        if (existing) {
          update.run(...articleValues(row), existing.id);
          counts.updated += 1;
        } else {
          insert.run(...articleValues(row));
          counts.created += 1;
        }
      } catch (error) {
        counts.errors += 1;
        if (details.length < 20) {
          details.push({ line: raw.line ?? null, number: raw.number || '', message: error.message });
        }
      }
    }
    db.prepare(
      `INSERT INTO catalog_imports
       (source, supplier, filename, user_id, total, created, updated, skipped, errors, status, details)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      source, finalSupplier, files.map((file) => cleanText(file.name, 120)).join(', ').slice(0, 500),
      userId, counts.total, counts.created, counts.updated, counts.skipped, counts.errors,
      counts.errors ? 'warnung' : 'ok', JSON.stringify(details),
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error instanceof MaterialError ? error : new MaterialError(500, `Import fehlgeschlagen: ${error.message}`);
  }

  const summary = `${source}: ${counts.created} neu, ${counts.updated} aktualisiert`
    + `${counts.skipped ? `, ${counts.skipped} übersprungen` : ''}`
    + `${counts.errors ? `, ${counts.errors} Fehler` : ''}.`;
  logActivity('material', `Katalogimport (${finalSupplier || source}): ${summary}`);

  return {
    ...counts,
    source,
    supplier: finalSupplier,
    details,
    summary,
  };
}

/* ------------------------------------------------------------------ Icecat */

function stripHtml(value) {
  return cleanText(String(value || '').replace(/<[^>]*>/g, ' '), 2000);
}

function icecatAttributes(data) {
  const groups = data.FeaturesGroups || data.FeatureGroups || [];
  const attributes = [];
  for (const group of groups) {
    const groupName = group?.FeatureGroup?.Name?.Value || '';
    for (const feature of group?.Features || []) {
      const label = feature?.Feature?.Name?.Value || '';
      const value = feature?.PresentationValue || feature?.LocalValue || feature?.Value || feature?.RawValue || '';
      if (!label || !value) continue;
      const unit = feature?.Feature?.Measure?.Signs?._ || '';
      attributes.push({ group: groupName, label, value: unit ? `${value} ${unit}` : String(value) });
      if (attributes.length >= 40) return attributes;
    }
  }
  return attributes;
}

async function icecatLookup({ gtin, brand, productCode, icecatId }, settings) {
  if (settings.mat_icecat_enabled !== '1') throw new MaterialError(400, 'Open Icecat ist ausgeschaltet.');
  const shopname = str(settings.mat_icecat_shopname);
  const apiToken = str(settings.mat_icecat_api_token);
  if (!shopname && !apiToken) {
    throw new MaterialError(400, 'Bitte Icecat-Benutzername oder API-Token eintragen.');
  }
  const params = new URLSearchParams({ lang: str(settings.mat_icecat_lang) || 'DE' });
  if (shopname) params.set('shopname', shopname);
  if (icecatId) params.set('icecat_id', String(icecatId));
  else if (gtin) params.set('GTIN', gtin);
  else if (brand && productCode) {
    params.set('Brand', brand);
    params.set('ProductCode', productCode);
  } else {
    throw new MaterialError(400, 'Für Icecat wird eine GTIN, eine Marke + Artikelnummer oder eine Icecat-ID benötigt.');
  }
  const headers = {};
  if (apiToken) headers['api-token'] = apiToken;
  const contentToken = str(settings.mat_icecat_content_token);
  if (contentToken) headers['content-token'] = contentToken;
  const { text } = await safeFetch(`https://live.icecat.biz/api?${params.toString()}`, {
    headers, timeout: 15_000, maxBytes: 4 * 1024 * 1024,
  });
  const data = parseJson(text, 'Icecat');
  if (data.msg !== 'OK' || !data.data) {
    throw new MaterialError(502, data.Message || 'Icecat liefert für dieses Produkt keine Daten.');
  }
  const info = data.data.GeneralInfo || {};
  const image = data.data.Image || {};
  const description = info.Description || {};
  const category = info.Category?.Name?.Value || info.Category?.Value || '';
  const gtinValue = Array.isArray(info.GTIN) ? (info.GTIN[0] || '') : (info.GTIN || gtin || '');
  return {
    source: 'icecat',
    sourceId: String(info.IcecatId || ''),
    gtin: normalizeGtin(gtinValue),
    name: cleanText(info.Title || description.LongProductName || info.ProductName, 240),
    description: stripHtml(description.LongDesc || description.MiddleDesc),
    manufacturer: cleanText(info.Brand, 120),
    manufacturerNumber: cleanText(info.BrandPartCode || productCode, 80),
    category: cleanText(category, 60),
    unit: 'Stk',
    imageUrl: cleanUrl(image.Pic500x500 || image.HighPic || image.LowPic),
    datasheetUrl: cleanUrl(description.ManualPDFURL || description.LeafletPDFURL),
    etimClass: '',
    attributes: icecatAttributes(data.data),
  };
}

/* ------------------------------------------------------------------ UPCitemdb */

async function upcitemdbLookup({ gtin }, settings) {
  if (settings.mat_upcitemdb_enabled !== '1') throw new MaterialError(400, 'UPCitemdb ist ausgeschaltet.');
  const trial = settings.mat_upcitemdb_trial === '1';
  const key = str(settings.mat_upcitemdb_key);
  if (!trial && !key) throw new MaterialError(400, 'Bitte einen UPCitemdb-API-Schlüssel eintragen.');
  const base = trial
    ? 'https://api.upcitemdb.com/prod/trial/lookup'
    : 'https://api.upcitemdb.com/prod/v1/lookup';
  const headers = { Accept: 'application/json' };
  if (key) headers.user_key = key;
  const { text } = await safeFetch(`${base}?upc=${encodeURIComponent(gtin)}`, {
    headers, timeout: 12_000, maxBytes: 2 * 1024 * 1024,
  });
  const data = parseJson(text, 'UPCitemdb');
  const item = Array.isArray(data.items) ? data.items[0] : null;
  if (!item) return null;
  return {
    source: 'upcitemdb',
    sourceId: cleanText(item.ean || item.upc || gtin, 80),
    gtin: normalizeGtin(item.ean || item.upc || gtin),
    name: cleanText(item.title, 240),
    description: cleanText(item.description, 2000),
    manufacturer: cleanText(item.brand, 120),
    manufacturerNumber: cleanText(item.model, 80),
    category: cleanText(item.category, 60),
    unit: 'Stk',
    imageUrl: cleanUrl((item.images || [])[0]),
    datasheetUrl: '',
    etimClass: '',
    attributes: [],
  };
}

/* ------------------------------------------------------------------ ETIM */

let etimTokenCache = { token: '', expiresAt: 0 };

async function etimToken(settings) {
  if (etimTokenCache.token && etimTokenCache.expiresAt > Date.now() + 30_000) {
    return etimTokenCache.token;
  }
  const clientId = str(settings.mat_etim_client_id);
  const clientSecret = str(settings.mat_etim_client_secret);
  if (!clientId || !clientSecret) {
    throw new MaterialError(400, 'Bitte ETIM Client-ID und Client-Secret eintragen.');
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'EtimApi',
  });
  const { text } = await safeFetch('https://etimauth.etim-international.com/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    timeout: 12_000,
    maxBytes: 512 * 1024,
  });
  const data = parseJson(text, 'ETIM');
  if (!data.access_token) throw new MaterialError(502, 'ETIM hat kein Zugangstoken geliefert.');
  etimTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000,
  };
  return data.access_token;
}

async function etimSearch(query, settings) {
  if (settings.mat_etim_enabled !== '1') throw new MaterialError(400, 'ETIM ist ausgeschaltet.');
  const token = await etimToken(settings);
  const { text } = await safeFetch('https://etimapi.etim-international.com/api/v2/Class/Search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      from: 0,
      size: 10,
      languagecode: str(settings.mat_etim_language) || 'de-DE',
      searchString: cleanText(query, 100),
      include: { descriptions: true, fields: ['Group'] },
    }),
    timeout: 15_000,
    maxBytes: 2 * 1024 * 1024,
  });
  const data = parseJson(text, 'ETIM');
  return (data.classes || []).map((entry) => ({
    source: 'etim',
    sourceId: entry.code || '',
    gtin: '',
    name: cleanText(entry.description, 240),
    description: cleanText(entry.descriptionEn, 500),
    manufacturer: '',
    manufacturerNumber: '',
    category: cleanText(entry.group?.description || entry.group?.descriptionEn, 80),
    unit: '',
    imageUrl: '',
    datasheetUrl: '',
    etimClass: entry.code || '',
    attributes: [],
  }));
}

/* ------------------------------------------------------------------ Generische Händler-API */

function getPath(object, path) {
  if (!path) return object;
  return String(path).split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}

function dealerUrl(settings, { query, article, gtin }) {
  const base = str(settings.mat_dealer_base_url).replace(/\/+$/, '');
  if (!base) throw new MaterialError(400, 'Bitte die Basis-URL der Händler-API eintragen.');
  const template = article
    ? (str(settings.mat_dealer_article_path) || '/api/articles/{article}')
    : (str(settings.mat_dealer_search_path) || '/api/articles?q={query}');
  const path = template
    .replace(/\{query\}/g, encodeURIComponent(query || ''))
    .replace(/\{article\}/g, encodeURIComponent(article || ''))
    .replace(/\{gtin\}/g, encodeURIComponent(gtin || ''));
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

function dealerHeaders(settings) {
  const type = str(settings.mat_dealer_auth_type) || 'none';
  const user = str(settings.mat_dealer_auth_user);
  const secret = str(settings.mat_dealer_auth_secret);
  const headers = { Accept: 'application/json' };
  if (type === 'bearer' && secret) headers.Authorization = `Bearer ${secret}`;
  else if (type === 'basic' && (user || secret)) {
    headers.Authorization = `Basic ${Buffer.from(`${user}:${secret}`).toString('base64')}`;
  } else if (type === 'header' && secret) {
    headers[str(settings.mat_dealer_auth_header) || 'X-API-Key'] = secret;
  }
  return headers;
}

async function dealerSearch(settings, { query, article, gtin }) {
  if (settings.mat_dealer_enabled !== '1') throw new MaterialError(400, 'Die Händler-API ist ausgeschaltet.');
  const url = dealerUrl(settings, { query, article, gtin });
  const { text } = await safeFetch(url, {
    headers: dealerHeaders(settings),
    timeout: 15_000,
    maxBytes: 4 * 1024 * 1024,
    allowHttp: settings.mat_allow_http === '1',
  });
  const data = parseJson(text, 'Händler-API');
  const list = getPath(data, str(settings.mat_dealer_results_path));
  const entries = Array.isArray(list) ? list : (Array.isArray(data) ? data : []);
  const map = (key, fallback) => str(settings[key]) || fallback;
  return entries.slice(0, 50).map((entry) => ({
    source: 'dealer',
    sourceId: cleanText(getPath(entry, map('mat_dealer_map_number', 'number')), 80),
    gtin: normalizeGtin(getPath(entry, map('mat_dealer_map_gtin', 'gtin'))),
    name: cleanText(getPath(entry, map('mat_dealer_map_name', 'name')), 240),
    description: '',
    manufacturer: cleanText(getPath(entry, map('mat_dealer_map_manufacturer', 'manufacturer')), 120),
    manufacturerNumber: '',
    category: '',
    unit: normalizeUnit(getPath(entry, map('mat_dealer_map_unit', 'unit'))),
    purchasePrice: parseMoney(getPath(entry, map('mat_dealer_map_price', 'purchase_price')), 0),
    currency: cleanText(getPath(entry, map('mat_dealer_map_currency', 'currency')), 3),
    stock: parseMoney(getPath(entry, map('mat_dealer_map_stock', 'stock')), 0),
    imageUrl: cleanUrl(getPath(entry, map('mat_dealer_map_image', 'image_url'))),
    datasheetUrl: cleanUrl(getPath(entry, map('mat_dealer_map_datasheet', 'datasheet_url'))),
    etimClass: '',
    attributes: [],
  })).filter((entry) => entry.name || entry.sourceId);
}

/* ------------------------------------------------------------------ Öffentliche Lookups */

export async function lookupMaterial({ gtin, articleNumber, query, manufacturer } = {}) {
  const settings = getSettings();
  const normalizedGtin = normalizeGtin(gtin);
  const results = [];
  const warnings = [];
  const tasks = [];

  if (settings.mat_icecat_enabled === '1') {
    tasks.push((async () => {
      const result = await icecatLookup({
        gtin: normalizedGtin,
        brand: manufacturer,
        productCode: articleNumber,
      }, settings);
      if (result) results.push(result);
    })().catch((error) => warnings.push(`Icecat: ${error.message}`)));
  }
  if (settings.mat_upcitemdb_enabled === '1' && normalizedGtin) {
    tasks.push((async () => {
      const result = await upcitemdbLookup({ gtin: normalizedGtin }, settings);
      if (result) results.push(result);
    })().catch((error) => warnings.push(`UPCitemdb: ${error.message}`)));
  }
  if (settings.mat_dealer_enabled === '1' && (articleNumber || normalizedGtin)) {
    tasks.push((async () => {
      const found = await dealerSearch(settings, {
        article: articleNumber,
        gtin: normalizedGtin,
        query: articleNumber || normalizedGtin,
      });
      results.push(...found);
    })().catch((error) => warnings.push(`Händler-API: ${error.message}`)));
  }
  if (settings.mat_etim_enabled === '1' && query) {
    tasks.push((async () => {
      const found = await etimSearch(query, settings);
      results.push(...found);
    })().catch((error) => warnings.push(`ETIM: ${error.message}`)));
  }

  await Promise.all(tasks);
  return { results, warnings, gtin: gtinInfo(normalizedGtin) };
}

export async function enrichArticle(article, { overwritePrice = false } = {}) {
  if (!article) throw new MaterialError(404, 'Artikel nicht gefunden.');
  const settings = getSettings();
  const lookup = await lookupMaterial({
    gtin: article.gtin,
    articleNumber: article.manufacturer_number || article.number,
    manufacturer: article.manufacturer,
  });
  const result = lookup.results.find((entry) => entry.source !== 'etim') || null;
  if (!result) {
    return { article, applied: [], warnings: lookup.warnings, gtin: lookup.gtin };
  }
  const applied = [];
  const next = { ...article };
  const set = (column, value) => {
    if (value == null || value === '') return;
    if (next[column] === value) return;
    next[column] = value;
    applied.push(column);
  };
  set('gtin', result.gtin);
  set('manufacturer', result.manufacturer);
  set('manufacturer_number', result.manufacturerNumber);
  set('etim_class', result.etimClass);
  set('datasheet_url', result.datasheetUrl);
  set('image_url', result.imageUrl);
  if (!next.category || next.category === 'Material') set('category', result.category);
  if (overwritePrice && result.purchasePrice > 0) set('purchase_price', result.purchasePrice);
  if (!next.name && result.name) set('name', result.name);
  next.source = result.source;
  next.source_id = result.sourceId || next.source_id;
  next.last_sync_at = nowSql();
  db.prepare(
    `UPDATE articles SET gtin = ?, manufacturer = ?, manufacturer_number = ?, etim_class = ?,
       datasheet_url = ?, image_url = ?, category = ?, purchase_price = ?, name = ?,
       source = ?, source_id = ?, last_sync_at = ? WHERE id = ?`
  ).run(
    next.gtin || '', next.manufacturer || '', next.manufacturer_number || '', next.etim_class || '',
    next.datasheet_url || '', next.image_url || '', next.category || 'Material',
    Number(next.purchase_price) || 0, next.name, next.source || '', next.source_id || '',
    next.last_sync_at, article.id,
  );
  logActivity('material', `Artikel ${next.number} aus ${result.source} angereichert.`);
  return { article: next, applied, warnings: lookup.warnings, result, gtin: lookup.gtin };
}

export async function testSource(id, settings = getSettings()) {
  const source = sourceById.get(id);
  if (!source) throw new MaterialError(404, 'Unbekannte Datenquelle.');
  if (settings[source.enabledKey] !== '1') {
    throw new MaterialError(400, 'Diese Datenquelle ist ausgeschaltet.');
  }
  if (id === 'datanorm' || id === 'bmecat' || id === 'csv') {
    return { ok: true, message: 'Bereit. Der Import läuft über Lager → Katalog importieren.' };
  }
  if (id === 'gs1') {
    return { ok: true, message: 'GTIN-Prüfung ist lokal aktiv – kein Schlüssel nötig.' };
  }
  if (id === 'ids') {
    const base = str(settings.mat_ids_shop_url).replace(/\/+$/, '');
    assertWebUrl(base);
    const template = str(settings.mat_ids_search_path) || '/search?q={article}';
    const path = template
      .replace(/\{(article|query)\}/g, 'TEST')
      .replace(/\{gtin\}/g, '1234567890123');
    return { ok: true, message: `Shop-Link ist gültig: ${base}${path.startsWith('/') ? '' : '/'}${path}` };
  }
  if (!sourceConfigured(id, settings)) {
    throw new MaterialError(400, 'Bitte zuerst die Zugangsdaten der Datenquelle eintragen.');
  }
  if (id === 'icecat') {
    const result = await icecatLookup({ icecatId: '56195846' }, settings);
    return { ok: Boolean(result), message: result ? `Icecat erreichbar: ${result.name}` : 'Icecat erreichbar, aber kein Testprodukt gefunden.' };
  }
  if (id === 'upcitemdb') {
    const result = await upcitemdbLookup({ gtin: '012345678905' }, settings);
    return { ok: true, message: result ? `UPCitemdb erreichbar: ${result.name}` : 'UPCitemdb erreichbar (kein Testtreffer).' };
  }
  if (id === 'etim') {
    const classes = await etimSearch('Rohr', settings);
    return { ok: true, message: `ETIM erreichbar – ${classes.length} Testklassen gefunden.` };
  }
  if (id === 'dealer') {
    const results = await dealerSearch(settings, { query: 'Kabel', article: 'Kabel', gtin: '' });
    return { ok: true, message: `Händler-API erreichbar – ${results.length} Treffer.` };
  }
  return { ok: true, message: 'Bereit.' };
}

export function dealerDeepLink(article, settings = getSettings()) {
  if (settings.mat_ids_enabled !== '1') throw new MaterialError(400, 'IDS-Connect ist ausgeschaltet.');
  const base = str(settings.mat_ids_shop_url).replace(/\/+$/, '');
  if (!base) throw new MaterialError(400, 'Bitte die Shop-URL eintragen.');
  assertWebUrl(base);
  const template = str(settings.mat_ids_search_path) || '/search?q={article}';
  const identifier = article.gtin || article.manufacturer_number || article.number || '';
  const path = template
    .replace(/\{article\}/g, encodeURIComponent(identifier))
    .replace(/\{gtin\}/g, encodeURIComponent(article.gtin || ''));
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function catalogImportHistory(limit = 20) {
  return db.prepare(
    `SELECT i.*, u.name AS user_name
     FROM catalog_imports i
     LEFT JOIN users u ON u.id = i.user_id
     ORDER BY i.id DESC LIMIT ?`
  ).all(Math.min(Math.max(Number(limit) || 20, 1), 100)).map((row) => ({
    ...row,
    details: (() => {
      try { return JSON.parse(row.details || '[]'); } catch { return []; }
    })(),
  }));
}
