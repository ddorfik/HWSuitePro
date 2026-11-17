import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi, readBody } from './src/api.js';
import { ensureInvoicePdfs } from './src/billing.js';
import { runAutomation } from './src/automation.js';
import { DATA_DIR, getSettings } from './src/db.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || undefined;
const HTTPS_KEY = process.env.HTTPS_KEY;
const HTTPS_CERT = process.env.HTTPS_CERT;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

// node:sqlite meldet sich beim Start als "experimental" – für die Konsole ausblenden.
const originalEmit = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  if (String(warning).includes('SQLite is an experimental feature')) return;
  return originalEmit.call(process, warning, ...args);
};

const safeHostValue = (value) => {
  const host = String(value || '').split(',')[0].trim().toLowerCase();
  return /^[a-z0-9.-]+(?::\d+)?$/.test(host) || /^\[[0-9a-f:]+\](?::\d+)?$/.test(host)
    ? host
    : '';
};

const requestHost = (headers) => safeHostValue(headers['x-forwarded-host']) || safeHostValue(headers.host);

/* Schutz gegen Cross-Site-Requests: Browser senden bei POST/PUT/DELETE einen Origin-Header. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const source = new URL(origin);
    const host = requestHost(req.headers);
    return Boolean(host) && source.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function sendError(res, status, message) {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: message }));
}

function sendFile(res, file, headers) {
  res.writeHead(200, headers);
  const stream = createReadStream(file);
  // Datei könnte zwischen Prüfung und Lesen verschwinden – darf den Prozess nicht beenden.
  stream.on('error', () => {
    if (!res.writableEnded) res.end();
  });
  stream.pipe(res);
}

function applySecurityHeaders(res, secure) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
}

async function handleRequest(req, res) {
  const secure = Boolean(req.socket?.encrypted);
  applySecurityHeaders(res, secure);

  const host = requestHost(req.headers) || 'localhost';
  let url;
  try {
    url = new URL(req.url, `${secure ? 'https' : 'http'}://${host}`);
  } catch {
    sendError(res, 400, 'Ungültige Anfrage');
    return;
  }

  // Steuerzeichen (z. B. Nullbytes) niemals weiterreichen.
  if (/[\u0000-\u001f]/.test(req.url)) {
    sendError(res, 400, 'Ungültige Anfrage');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !sameOrigin(req)) {
    sendError(res, 403, 'Anfrage von einer fremden Seite abgelehnt');
    return;
  }

  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    try {
      req.body = await readBody(req);
    } catch (error) {
      sendError(res, error.status || 400, error.message || 'Ungültige Anfrage');
      return;
    }
  }

  if (url.pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res, url);
    if (!handled) sendError(res, 404, 'API-Endpunkt nicht gefunden');
    return;
  }

  // Terminbestätigung für Kunden: eigene, schlanke Seite ohne App-Hülle
  if (url.pathname === '/termin' || url.pathname.startsWith('/termin/')) {
    sendFile(res, join(PUBLIC, 'termin.html'), {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    return;
  }

  // Statische Dateien
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(PUBLIC, safePath);

  if (filePath.startsWith(`${PUBLIC}${sep}`) && existsSync(filePath) && statSync(filePath).isFile()) {
    sendFile(res, filePath, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': safePath === '/sw.js' ? 'no-store' : 'no-cache',
    });
    return;
  }

  // SPA-Fallback
  sendFile(res, join(PUBLIC, 'index.html'), {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
}

/* Kein Fehler darf den Prozess beenden – ein kaputter Request darf die App nicht lahmlegen. */
async function safeHandler(req, res) {
  try {
    await handleRequest(req, res);
  } catch (error) {
    console.error('Anfrage fehlgeschlagen:', error?.message || error);
    sendError(res, 500, 'Interner Serverfehler');
  }
}

const useHttps = Boolean(HTTPS_KEY && HTTPS_CERT);
const server = useHttps
  ? createHttpsServer({ key: readFileSync(HTTPS_KEY), cert: readFileSync(HTTPS_CERT) }, safeHandler)
  : createServer(safeHandler);

server.on('clientError', (error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

// Hängende oder sehr langsame Verbindungen nicht unbegrenzt offen halten.
server.headersTimeout = 20_000;
server.requestTimeout = 120_000;
server.keepAliveTimeout = 15_000;

server.listen(PORT, HOST, () => {
  const settings = getSettings();
  const protocol = useHttps ? 'https' : 'http';
  console.log('');
  console.log(`  ${settings.app_name} – Handwerkersoftware für ${settings.trade}`);
  console.log(`  ➜  ${protocol}://localhost:${PORT}`);
  console.log(`  Datenbank: ${join(DATA_DIR, 'gaswasser.db')}`);
  if (!useHttps) {
    console.log('  Hinweis: Sprachsteuerung im Mobilbrowser benötigt HTTPS oder localhost.');
    console.log('  Hinweis: Ohne HTTPS sind Anmeldung und Daten im Netzwerk unverschlüsselt.');
  }
  console.log('');

  try {
    ensureInvoicePdfs();
    const result = runAutomation();
    const count = result.orders.length + result.invoices.length + result.dunnings.length;
    if (count > 0) {
      console.log(`  Automatik: ${result.orders.length} Auftrag/Aufträge, ${result.invoices.length} Rechnung(en), ${result.dunnings.length} Mahnung(en) erzeugt.`);
    } else {
      console.log('  Automatik: keine fälligen Vorgänge.');
    }
  } catch (error) {
    console.error('Automatik-Start fehlgeschlagen:', error.message);
  }
  console.log('');
});

setInterval(() => {
  try {
    const result = runAutomation();
    const count = result.orders.length + result.invoices.length + result.dunnings.length;
    if (count > 0) {
      console.log(`[Automatik] ${new Date().toLocaleString('de-DE')}: ${count} Vorgang/Vorgänge erzeugt.`);
    }
  } catch (error) {
    console.error('[Automatik] Fehler:', error.message);
  }
}, 5 * 60 * 1000);
