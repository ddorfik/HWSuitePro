import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const directory = mkdtempSync(join(tmpdir(), 'handwerkpro-test-'));
process.env.GASWASSER_DATA = directory;
process.env.GASWASSER_DB = join(directory, 'test.db');

const { db, invoiceTotals } = await import('../src/db.js');
const billing = await import('../src/billing.js');
const { runAutomation } = await import('../src/automation.js');
const { verifyPassword } = await import('../src/password.js');
const { permissionsFor, can } = await import('../src/permissions.js');
const { parseMaterials } = await import('../src/work.js');

const invoiceCount = () => db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n;

test('Demo-Daten werden geladen', () => {
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM customers').get().n >= 5);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n >= 8);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n >= 10);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM contracts').get().n >= 3);
  assert.ok(invoiceCount() >= 3);
});

test('Benutzerkonten und Passwörter sind eingerichtet', () => {
  const users = db.prepare('SELECT * FROM users').all();
  assert.ok(users.length >= 6);
  const chef = users.find((user) => user.username === 'chef');
  assert.ok(chef);
  assert.equal(chef.role, 'chef');
  assert.ok(verifyPassword('chef123', chef.password_hash));
  assert.equal(verifyPassword('falsch', chef.password_hash), false);
  assert.ok(users.some((user) => user.role === 'monteur'));
  assert.ok(users.some((user) => user.role === 'hr'));
});

test('Rollenmatrix trennt Rechte sauber', () => {
  const monteur = { role: 'monteur', permissions: permissionsFor('monteur') };
  const hr = { role: 'hr', permissions: permissionsFor('hr') };
  const chef = { role: 'chef', permissions: ['*'] };
  assert.equal(can(monteur, 'orders.view.own'), true);
  assert.equal(can(monteur, 'invoices.view'), false);
  assert.equal(can(monteur, 'users.manage'), false);
  assert.equal(can(hr, 'customers.view'), false);
  assert.equal(can(hr, 'employees.manage'), true);
  assert.equal(can(chef, 'irgendwas'), true);
});

test('Materialparser erkennt Mengen, Einheiten und Artikel', () => {
  const materials = parseMaterials('3 Meter Kupferrohr eingebaut und 2 Stück Dichtungen erneuert.');
  assert.equal(materials.length, 2);
  assert.equal(materials[0].quantity, 3);
  assert.equal(materials[0].unit, 'm');
  assert.ok(materials[0].article_id);
  assert.equal(materials[1].quantity, 2);
  assert.ok(materials[1].article_id);

  const spoken = parseMaterials('Ich habe zwei Gasdruckregler montiert.');
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].quantity, 2);
  assert.equal(spoken[0].unit, 'Stk');
});

test('Rechnungssummen werden korrekt gerundet', () => {
  const totals = invoiceTotals([
    { quantity: 2.5, unit_price: 68 },
    { quantity: 3, unit_price: 0.9 },
  ], 19);
  assert.equal(totals.subtotal, 172.7);
  assert.equal(totals.tax, 32.81);
  assert.equal(totals.total, 205.51);
});

test('Automatik erzeugt Rechnungen für erledigte Aufträge', () => {
  const before = invoiceCount();
  const result = runAutomation();
  assert.equal(result.invoices.length, 2);
  assert.equal(invoiceCount(), before + 2);

  const done = db.prepare("SELECT * FROM orders WHERE id IN (3,5)").all();
  assert.deepEqual(done.map((order) => order.status), ['abgerechnet', 'abgerechnet']);

  const invoice = db.prepare('SELECT * FROM invoices WHERE order_id = 3').get();
  assert.ok(invoice.number.startsWith('RE-'));
  assert.ok(invoice.total > 0);
  assert.ok(invoice.pdf_path);
  assert.ok(existsSync(join(directory, invoice.pdf_path)));
  assert.equal(readFileSync(join(directory, invoice.pdf_path)).subarray(0, 5).toString(), '%PDF-');
});

test('Material wird beim Abrechnen aus dem Lager gebucht', () => {
  const article = db.prepare("SELECT * FROM articles WHERE number = 'GA-1003'").get();
  assert.ok(article.stock < 118, 'Bestand wurde reduziert');
  const movements = db.prepare('SELECT * FROM stock_movements WHERE article_id = ?').all(article.id);
  assert.ok(movements.some((movement) => movement.quantity < 0));
});

test('Zahlungseingang setzt Rechnung auf bezahlt', () => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE order_id = 3').get();
  const updated = billing.recordPayment(invoice.id, { amount: invoice.total, method: 'Überweisung', note: 'Test' });
  assert.equal(updated.status, 'bezahlt');
  assert.equal(updated.paid_total, invoice.total);
});

test('Teilzahlung wird als teilweise bezahlt geführt', () => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE status = 'offen' ORDER BY id LIMIT 1").get();
  const updated = billing.recordPayment(invoice.id, { amount: 10 });
  assert.equal(updated.status, 'teilweise');
  assert.equal(updated.paid_total, 10);
});

test('Mahnung erhöht Mahnstufe und erzeugt PDF', () => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE status = 'gemahnt' ORDER BY id LIMIT 1").get();
  const before = invoice.dunning_level;
  const result = billing.createDunning(invoice.id);
  assert.equal(result.invoice.dunning_level, before + 1);
  assert.ok(result.buffer.subarray(0, 5).toString() === '%PDF-');
  assert.ok(result.filename.includes('Mahnung'));
});

test('Rechnung kann aus einem Auftrag erzeugt werden', () => {
  const order = db.prepare("SELECT * FROM orders WHERE status = 'neu' AND doc_type = 'auftrag' LIMIT 1").get();
  const invoice = billing.createInvoiceFromOrder(order.id);
  assert.equal(invoice.order_id, order.id);
  assert.ok(invoice.number.startsWith('RE-'));
  assert.throws(() => billing.createInvoiceFromOrder(order.id), /bereits/);
});

test('Login, Rollen, Zeiten, Berichte, Fotos und Sprachsuche über HTTP', async () => {
  const port = 3488;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });

  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50 && !ready; i += 1) {
    try {
      const response = await fetch(`${base}/api/auth/meta`);
      ready = response.ok;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  assert.ok(ready, 'Server ist erreichbar');

  const login = async (username, password) => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(response.status, 200, `Login ${username}`);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const data = await response.json();
    return { cookie, data };
  };
  const call = (cookie, path, options = {}) => fetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Cookie: cookie },
  });
  const json = (response) => response.json();

  try {
    const anonymous = await fetch(`${base}/api/dashboard`);
    assert.equal(anonymous.status, 401, 'Ohne Anmeldung gesperrt');
    const meta = await json(await fetch(`${base}/api/auth/meta`));
    assert.ok(meta.app_name);
    assert.ok(meta.roles.length >= 5);

    // ---------------------------------------------------------- Chef
    const chef = await login('chef', 'chef123');
    assert.equal(chef.data.user.role, 'chef');

    const dashboard = await json(await call(chef.cookie, '/api/dashboard'));
    assert.ok(dashboard.kpis.openOrders >= 1);
    assert.ok(Array.isArray(dashboard.activity));

    const invoices = await json(await call(chef.cookie, '/api/invoices'));
    assert.ok(invoices.length >= 5);

    const pdf = await call(chef.cookie, `/api/invoices/${invoices[0].id}/pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal((await pdf.arrayBuffer()).byteLength > 3000, true);

    const customers = await json(await call(chef.cookie, '/api/customers'));
    const newOrder = await json(await call(chef.cookie, '/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: customers[0].id,
        title: 'HTTP-Testauftrag',
        scheduled_date: new Date().toISOString().slice(0, 10),
      }),
    }));
    const target = newOrder.order;

    const item = await json(await call(chef.cookie, `/api/orders/${target.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Testleistung', quantity: 2, unit: 'Std', unit_price: 68, kind: 'arbeit' }),
    }));
    assert.ok(item.id);

    const changed = await json(await call(chef.cookie, `/api/orders/${target.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'erledigt' }),
    }));
    assert.ok(changed.autoInvoice, 'Rechnung wird automatisch erzeugt');
    assert.equal(changed.autoInvoice.total, 161.84);

    const settings = await json(await call(chef.cookie, '/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_days: '21' }),
    }));
    assert.equal(settings.settings.payment_days, '21');

    const csv = await call(chef.cookie, '/api/export/rechnungen.csv');
    assert.match(csv.headers.get('content-type'), /text\/csv/);

    const quotes = await json(await call(chef.cookie, '/api/orders?type=angebot'));
    assert.ok(quotes.length >= 1);
    const converted = await json(await call(chef.cookie, `/api/orders/${quotes[0].id}/convert`, { method: 'POST' }));
    assert.match(converted.number, /^AU-/);
    const newOrderData = await json(await call(chef.cookie, `/api/orders/${converted.orderId}`));
    assert.equal(newOrderData.order.doc_type, 'auftrag');
    assert.ok(newOrderData.items.length > 0);

    const allOrders = await json(await call(chef.cookie, '/api/orders'));
    const users = await json(await call(chef.cookie, '/api/users'));
    assert.ok(users.length >= 6);

    // ---------------------------------------------------------- Monteur
    const monteur = await login('monteur', 'monteur123');
    assert.equal(monteur.data.user.role, 'monteur');
    assert.ok(monteur.data.user.permissions.includes('time.own'));
    assert.equal((await call(monteur.cookie, '/api/invoices')).status, 403);
    assert.equal((await call(monteur.cookie, '/api/users')).status, 403);
    assert.equal((await call(monteur.cookie, '/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })).status, 403);

    const ownOrders = await json(await call(monteur.cookie, '/api/orders'));
    assert.ok(ownOrders.length >= 1);
    assert.ok(ownOrders.length < allOrders.length, 'Monteur sieht nur eigene Aufträge');
    assert.ok(ownOrders.every((order) => order.net === undefined && order.invoice_number === undefined), 'Keine Finanzdaten für Monteure');

    const ownDashboard = await json(await call(monteur.cookie, '/api/dashboard'));
    assert.equal(ownDashboard.personal, true);

    const ownOrder = ownOrders[0];
    const started = await json(await call(monteur.cookie, '/api/time/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: ownOrder.id }),
    }));
    assert.ok(started.id);
    const running = await json(await call(monteur.cookie, '/api/time/running'));
    assert.equal(running.id, started.id);
    const stopped = await json(await call(monteur.cookie, '/api/time/stop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }));
    assert.equal(stopped.running, false);

    const report = await json(await call(monteur.cookie, '/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: ownOrder.id,
        content: '3 Meter Kupferrohr eingebaut und 2 Stück Dichtungen erneuert.',
        hours: 2.5,
        auto_parse: true,
      }),
    }));
    assert.equal(report.report.status, 'eingereicht');
    assert.ok(report.materials.length >= 1);
    assert.ok(report.materials.every((material) => material.quantity > 0));

    const parsed = await json(await call(monteur.cookie, `/api/reports/${report.report.id}/parse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'zwei Gasdruckregler' }),
    }));
    assert.equal(parsed.materials.length, 1);
    assert.equal(parsed.materials[0].quantity, 2);

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAZ7f2sQAAAAASUVORK5CYII=', 'base64');
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    const photosBefore = (await json(await call(monteur.cookie, `/api/photos?order_id=${ownOrder.id}`))).length;
    const photo = await json(await call(monteur.cookie, '/api/photos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: ownOrder.id,
        kind: 'vorher',
        caption: 'Testfoto',
        dataUrl,
      }),
    }));
    assert.ok(photo.id);
    const photoFile = await call(monteur.cookie, `/api/photos/${photo.id}/file`);
    assert.equal(photoFile.status, 200);
    assert.equal(photoFile.headers.get('content-type'), 'image/png');

    // Mehrere Fotos in einem Aufruf – alle werden am Auftrag archiviert
    const batch = await json(await call(monteur.cookie, '/api/photos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photos: [
          { order_id: ownOrder.id, kind: 'vorher', caption: 'Serie 1', dataUrl },
          { order_id: ownOrder.id, kind: 'vorher', caption: 'Serie 2', dataUrl },
          { order_id: ownOrder.id, kind: 'nachher', caption: 'Serie 3', dataUrl },
        ],
      }),
    }));
    assert.equal(batch.length, 3);
    const listed = await json(await call(monteur.cookie, `/api/photos?order_id=${ownOrder.id}`));
    assert.equal(listed.length, photosBefore + 4, 'Alle Fotos sind am Auftrag hinterlegt');
    assert.ok(listed.filter((row) => row.kind === 'nachher').length >= 1);

    for (const row of [photo, ...batch]) {
      assert.equal((await call(monteur.cookie, `/api/photos/${row.id}`, { method: 'DELETE' })).status, 200);
    }
    assert.equal((await json(await call(monteur.cookie, `/api/photos?order_id=${ownOrder.id}`))).length, photosBefore);

    const voice = await json(await call(monteur.cookie, '/api/voice/search?q=K%C3%B6nigsallee'));
    assert.ok(voice.length >= 1);
    assert.ok(voice[0].number);

    // ---------------------------------------------------------- Freigabe durch Chef
    const approved = await json(await call(chef.cookie, `/api/reports/${report.report.id}/approve`, { method: 'POST' }));
    assert.equal(approved.report.status, 'freigegeben');
    const beforeItems = (await json(await call(chef.cookie, `/api/orders/${ownOrder.id}`))).items.length;
    const applied = await json(await call(chef.cookie, `/api/reports/${report.report.id}/apply`, { method: 'POST' }));
    assert.ok(applied.report.applied_at);
    const afterItems = (await json(await call(chef.cookie, `/api/orders/${ownOrder.id}`))).items.length;
    assert.ok(afterItems > beforeItems, 'Material wurde in den Auftrag übernommen');

    // ---------------------------------------------------------- HR
    const hr = await login('hr', 'hr123');
    assert.equal((await call(hr.cookie, '/api/customers')).status, 403);
    assert.equal((await call(hr.cookie, '/api/users')).status, 403);
    const hrDashboard = await json(await call(hr.cookie, '/api/dashboard'));
    assert.equal(hrDashboard.hr, true);
    assert.ok(hrDashboard.employees.length >= 1);
    assert.equal((await call(hr.cookie, '/api/reports')).status, 200);
    assert.equal((await call(hr.cookie, '/api/time')).status, 200);

    // ---------------------------------------------------------- Büro
    const buero = await login('buero', 'buero123');
    assert.equal((await call(buero.cookie, '/api/invoices')).status, 200);
    assert.equal((await call(buero.cookie, '/api/users')).status, 403);
    assert.equal((await call(buero.cookie, '/api/photos')).status, 200);
    assert.equal((await call(hr.cookie, '/api/photos')).status, 403);

    // ---------------------------------------------------------- Abmelden
    await call(chef.cookie, '/api/auth/logout', { method: 'POST' });
    assert.equal((await call(chef.cookie, '/api/dashboard')).status, 401);
  } finally {
    child.kill();
  }
});
