import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi, readBody } from './src/api.js';
import { ensureInvoicePdfs } from './src/billing.js';
import { runAutomation } from './src/automation.js';
import { DATA_DIR, getSettings } from './src/db.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
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

// node:sqlite meldet sich beim Start als "experimental" – für die Konsole ausblenden.
const originalEmit = process.emitWarning;
process.emitWarning = (warning, ...args) => {
  if (String(warning).includes('SQLite is an experimental feature')) return;
  return originalEmit.call(process, warning, ...args);
};

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    try {
      req.body = await readBody(req);
    } catch (error) {
      res.writeHead(error.status || 400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message }));
      return;
    }
  }

  if (url.pathname.startsWith('/api/')) {
    if (!(await handleApi(req, res, url))) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'API-Endpunkt nicht gefunden' }));
    }
    return;
  }

  // Terminbestätigung für Kunden: eigene, schlanke Seite ohne App-Hülle
  if (url.pathname.startsWith('/termin/')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    createReadStream(join(PUBLIC, 'termin.html')).pipe(res);
    return;
  }

  // Statische Dateien
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(PUBLIC, safePath);

  if (filePath.startsWith(PUBLIC) && existsSync(filePath) && statSync(filePath).isFile()) {
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': safePath === '/sw.js' ? 'no-store' : 'no-cache',
    });
    createReadStream(filePath).pipe(res);
    return;
  }

  // SPA-Fallback
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  createReadStream(join(PUBLIC, 'index.html')).pipe(res);
}

const useHttps = Boolean(HTTPS_KEY && HTTPS_CERT);
const server = useHttps
  ? createHttpsServer({ key: readFileSync(HTTPS_KEY), cert: readFileSync(HTTPS_CERT) }, handleRequest)
  : createServer(handleRequest);

server.listen(PORT, () => {
  const settings = getSettings();
  const protocol = useHttps ? 'https' : 'http';
  console.log('');
  console.log(`  ${settings.app_name} – Handwerkersoftware für ${settings.trade}`);
  console.log(`  ➜  ${protocol}://localhost:${PORT}`);
  console.log(`  Datenbank: ${join(DATA_DIR, 'gaswasser.db')}`);
  if (!useHttps) {
    console.log('  Hinweis: Sprachsteuerung im Mobilbrowser benötigt HTTPS oder localhost.');
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
