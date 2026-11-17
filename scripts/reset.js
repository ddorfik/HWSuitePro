/**
 * Setzt die Demo-Datenbank zurück (ACHTUNG: alle Daten werden gelöscht).
 * Aufruf: npm run reset -- --yes
 */
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = process.env.GASWASSER_DATA || join(root, 'data');

if (!process.argv.includes('--yes')) {
  console.log('');
  console.log('  Dies löscht ALLE Daten (Kunden, Aufträge, Rechnungen, Lager).');
  console.log('  Wenn du sicher bist:  npm run reset -- --yes');
  console.log('');
  process.exit(1);
}

for (const file of ['gaswasser.db', 'gaswasser.db-wal', 'gaswasser.db-shm']) {
  rmSync(join(dataDir, file), { force: true });
}
rmSync(join(dataDir, 'dokumente'), { recursive: true, force: true });
rmSync(join(dataDir, 'fotos'), { recursive: true, force: true });

const { db } = await import('../src/db.js');
const { ensureInvoicePdfs } = await import('../src/billing.js');
const { runAutomation } = await import('../src/automation.js');

const automation = runAutomation();
ensureInvoicePdfs();

console.log('');
console.log('  Datenbank neu angelegt und Demo-Daten geladen.');
console.log(`  Kunden: ${db.prepare('SELECT COUNT(*) AS n FROM customers').get().n}`);
console.log(`  Aufträge: ${db.prepare('SELECT COUNT(*) AS n FROM orders').get().n}`);
console.log(`  Rechnungen: ${db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n}`);
console.log(`  Automatik: ${automation.invoices.length} Rechnung(en) erzeugt`);
console.log('');
