import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

const directory = mkdtempSync(join(tmpdir(), 'handwerkpro-test-'));
process.env.GASWASSER_DATA = directory;
process.env.GASWASSER_DB = join(directory, 'test.db');

const { db, invoiceTotals, getSettings, todayISO } = await import('../src/db.js');
const billing = await import('../src/billing.js');
const { runAutomation } = await import('../src/automation.js');
const { verifyPassword } = await import('../src/password.js');
const { permissionsFor, can } = await import('../src/permissions.js');
const { parseMaterials } = await import('../src/work.js');
const materials = await import('../src/materials.js');
const einvoice = await import('../src/einvoice.js');
const dms = await import('../src/dms.js');
const calc = await import('../src/calc.js');
const hr = await import('../src/hr.js');
const finance = await import('../src/finance.js');
const site = await import('../src/site.js');
const inventory = await import('../src/inventory.js');
const interfaces = await import('../src/interfaces.js');
const resources = await import('../src/resources.js');
const geo = await import('../src/geo.js');

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

test('GTIN-Prüfung erkennt gültige und ungültige Prüfziffern', () => {
  assert.equal(materials.gtinChecksumValid('4006381333931'), true);
  assert.equal(materials.gtinChecksumValid('4006381333932'), false);
  assert.equal(materials.gtinChecksumValid('1234'), false);
  assert.equal(materials.normalizeGtin('4 006381 333931'), '4006381333931');
  assert.equal(materials.gtinInfo('4006381333931').valid, true);
  assert.match(materials.gtinInfo('4006381333931').gs1Url, /verified-by-gs1/);
});

test('Datanorm 4 wird mit Preisen, EAN und Warengruppen gelesen', () => {
  const file = [
    `V 010125${'Muster Großhandel'.padEnd(40)}${'DATANORM'.padEnd(40)}${'Test'.padEnd(35)}04EUR`,
    'A;VK;4711;00;Viega Pressfitting 15 mm;Sanpress;2;0;STK;1234;10;001; ;',
    'B;VK;4711;VIE 123456; ; ;0;0;0;4012345678901; ;001; ; ;VIE; ;',
    'S; ;001;Sanitär;0011;Fittings;',
    'D;VK;4711;1; ;Zusätzlicher;Langtext;',
    'P;VK;4711;2;900;1;1000;;;;;',
  ].join('\r\n');
  const parsed = materials.parseDatanorm([{ name: 'DATANORM.001', content: file }], { taxRate: 19 });
  assert.equal(parsed.items.length, 1);
  const item = parsed.items[0];
  assert.equal(item.number, '4711');
  assert.equal(item.name, 'Viega Pressfitting 15 mm Sanpress');
  assert.equal(item.unit, 'Stk');
  assert.equal(item.purchasePrice, 8.1, 'P-Satz: 9,00 € minus 10 % Rabatt');
  assert.equal(item.gtin, '4012345678901');
  assert.equal(item.manufacturer, 'VIE');
  assert.equal(item.category, 'Sanitär');
  assert.equal(parsed.meta.version, 4);
  assert.equal(parsed.meta.currency, 'EUR');
});

test('Datanorm dekodiert klassische CP850-Umlaute', () => {
  const v = `V 010125${'Firma'.padEnd(40)}${'DATANORM'.padEnd(40)}${''.padEnd(35)}04EUR`;
  const file = Buffer.concat([
    Buffer.from(`${v}\r\nA;VK;850;00;Test m`, 'latin1'),
    Buffer.from([0x94]), // CP850: ö
    Buffer.from('glich;Kurz;2;0;STK;100;;;\r\n', 'latin1'),
  ]);
  const parsed = materials.parseDatanorm([{ name: 'DATANORM.001', base64: file.toString('base64') }], { taxRate: 19 });
  assert.equal(parsed.items.length, 1);
  assert.match(parsed.items[0].name, /möglich/);
});

test('BMEcat-XML und CSV werden tolerant gelesen', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <BMECAT><HEADER><SUPPLIER_NAME>Muster AG</SUPPLIER_NAME></HEADER>
      <T_PRODUCT><PRODUCT>
        <SUPPLIER_AID>B-100</SUPPLIER_AID>
        <DESCRIPTION_SHORT>Kupferrohr 15 mm</DESCRIPTION_SHORT>
        <ORDER_UNIT>MTR</ORDER_UNIT>
        <PRODUCT_PRICE_DETAILS><PRODUCT_PRICE>
          <PRICE_AMOUNT>4.20</PRICE_AMOUNT><PRICE_CURRENCY>EUR</PRICE_CURRENCY>
          <TAX>19</TAX><PRICE_QUANTITY>1</PRICE_QUANTITY>
        </PRODUCT_PRICE></PRODUCT_PRICE_DETAILS>
        <CLASSIFICATION><CLASSIFICATION_SYSTEM_NAME>ETIM</CLASSIFICATION_SYSTEM_NAME><CLASSIFICATION_ID>EC000001</CLASSIFICATION_ID></CLASSIFICATION>
      </PRODUCT></T_PRODUCT>
    </BMECAT>`;
  const bmecat = materials.parseBmecat([{ name: 'katalog.xml', content: xml }], { taxRate: 19 });
  assert.equal(bmecat.items.length, 1);
  assert.equal(bmecat.items[0].number, 'B-100');
  assert.equal(bmecat.items[0].unit, 'm');
  assert.equal(bmecat.items[0].purchasePrice, 4.2);
  assert.equal(bmecat.items[0].etimClass, 'EC000001');
  assert.equal(bmecat.supplier, 'Muster AG');

  const csv = 'Artikelnummer;Bezeichnung;Warengruppe;Einheit;EK;VK;EAN;Hersteller\n'
    + '4712;Testrohr;Rohre;m;2,50;3,90;4012345678901;Muster';
  const parsed = materials.parseCsv([{ name: 'liste.csv', content: csv }], { taxRate: 19, delimiter: ';' });
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].number, '4712');
  assert.equal(parsed.items[0].purchasePrice, 2.5);
  assert.equal(parsed.items[0].salePrice, 3.9);
  assert.equal(parsed.items[0].unit, 'm');
  assert.equal(parsed.items[0].gtin, '4012345678901');
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

  // Kleiner SMTP-Server für die E-Mail-Tests
  const mails = [];
  const smtpServer = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    socket.write('220 test.local ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (inData) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end === -1) return;
        mails.push(buffer.slice(0, end));
        buffer = buffer.slice(end + 5);
        inData = false;
        socket.write('250 2.0.0 Ok: queued\r\n');
        return;
      }
      let index;
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (/^EHLO/i.test(line)) socket.write('250-test.local\r\n250-8BITMIME\r\n250 SIZE 10240000\r\n');
        else if (/^MAIL FROM/i.test(line)) socket.write('250 2.1.0 Ok\r\n');
        else if (/^RCPT TO/i.test(line)) socket.write('250 2.1.5 Ok\r\n');
        else if (/^DATA/i.test(line)) { inData = true; socket.write('354 End data with <CR><LF>.<CR><LF>\r\n'); return; }
        else if (/^QUIT/i.test(line)) { socket.write('221 2.0.0 Bye\r\n'); socket.end(); }
        else socket.write('250 2.0.0 Ok\r\n');
      }
    });
    socket.on('error', () => {});
  });
  await new Promise((resolve) => smtpServer.listen(0, '127.0.0.1', resolve));
  const smtpPort = smtpServer.address().port;

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

  // Startpasswörter müssen beim ersten Login geändert werden – der Helfer merkt sich das neue.
  const credentials = {};
  const login = async (username, password) => {
    const current = credentials[username] || password;
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: current }),
    });
    assert.equal(response.status, 200, `Login ${username}`);
    let cookie = response.headers.get('set-cookie').split(';')[0];
    let data = await response.json();

    if (data.user.must_change_password) {
      const blocked = await fetch(`${base}/api/dashboard`, { headers: { Cookie: cookie } });
      assert.equal(blocked.status, 403, 'Startpasswort muss zuerst geändert werden');
      assert.equal((await blocked.json()).code, 'password_change_required');

      const nextPassword = `${current}-test`;
      const changed = await fetch(`${base}/api/auth/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ currentPassword: current, newPassword: nextPassword }),
      });
      assert.equal(changed.status, 200, `Passwortwechsel ${username}`);
      const changedData = await changed.json();
      assert.equal(changedData.user.must_change_password, false);

      // Die alte Sitzung ist beendet, das neue Cookie gilt.
      assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })).status, 401,
        'Alte Sitzung ist nach dem Passwortwechsel ungültig');
      cookie = changed.headers.get('set-cookie').split(';')[0];
      data = changedData;
      credentials[username] = nextPassword;
    }
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
    const sessionRows = db.prepare('SELECT id FROM sessions').all();
    assert.ok(sessionRows.every((row) => /^[a-f0-9]{64}$/.test(row.id)), 'Sitzungstokens liegen nur gehasht vor');

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

    // ---------------------------------------------------------- Kundennotizen
    const noteCustomer = customers[0].id;
    const noteResult = await json(await call(chef.cookie, `/api/customers/${noteCustomer}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Schlüssel liegt beim Nachbarn.' }),
    }));
    assert.equal(noteResult.notes.length, 1);
    assert.match(noteResult.notes[0].text, /Nachbarn/);
    assert.ok(noteResult.notes[0].user_name, 'Autor wird mitgeliefert');

    const withNotes = await json(await call(chef.cookie, `/api/customers/${noteCustomer}`));
    assert.equal(withNotes.notes.length, 1, 'Notizen kommen mit den Kundendetails');

    const ownCustomer = ownOrder.customer_id;
    assert.equal((await call(monteur.cookie, `/api/customers/${ownCustomer}/notes`)).status, 200, 'Monteur liest Notizen eigener Kunden');
    assert.equal((await call(monteur.cookie, `/api/customers/${ownCustomer}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Nicht erlaubt' }),
    })).status, 403, 'Monteur darf keine Notizen anlegen');
    assert.equal((await call(chef.cookie, `/api/customers/${noteCustomer}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    })).status, 400, 'Leere Notiz wird abgelehnt');

    const afterDelete = await json(await call(chef.cookie, `/api/customers/${noteCustomer}/notes/${noteResult.notes[0].id}`, { method: 'DELETE' }));
    assert.equal(afterDelete.notes.length, 0);

    // ---------------------------------------------------------- Terminbestätigung
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const appointment = await json(await call(chef.cookie, '/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: target.id,
        employee_id: 1,
        title: 'Wartung Gastherme',
        start_at: new Date(tomorrow.setHours(9, 0, 0, 0)).toISOString(),
        end_at: new Date(tomorrow.setHours(11, 0, 0, 0)).toISOString(),
      }),
    }));
    assert.ok(appointment.id);
    assert.equal((await call(monteur.cookie, `/api/appointments/${appointment.id}/confirm-link`, { method: 'POST' })).status, 403,
      'Nur Planung darf Bestätigungslinks erzeugen');

    const link = await json(await call(chef.cookie, `/api/appointments/${appointment.id}/confirm-link`, { method: 'POST' }));
    assert.match(link.path, /^\/termin\/[a-f0-9]{48}$/);
    const token = link.path.split('/').pop();
    const sameLink = await json(await call(chef.cookie, `/api/appointments/${appointment.id}/confirm-link`, { method: 'POST' }));
    assert.equal(sameLink.token, token, 'Link bleibt stabil');

    const page = await fetch(`${base}/termin/${token}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);

    const publicView = await fetch(`${base}/api/public/appointments/${token}`);
    assert.equal(publicView.status, 200, 'Öffentlicher Link funktioniert ohne Anmeldung');
    const publicData = await publicView.json();
    assert.equal(publicData.appointment.confirmed_at, null);
    assert.equal(publicData.appointment.title, 'Wartung Gastherme');
    assert.ok(publicData.company.name);
    assert.equal(publicData.order.number, target.number);
    assert.equal((await fetch(`${base}/api/public/appointments/${'0'.repeat(48)}`)).status, 404, 'Unbekannter Token ist ungültig');

    const confirmed = await json(await fetch(`${base}/api/public/appointments/${token}/confirm`, { method: 'POST' }));
    assert.ok(confirmed.appointment.confirmed_at, 'Kunde bestätigt den Termin');
    assert.equal(confirmed.appointment.declined_at, null);

    const internal = await json(await call(chef.cookie, '/api/appointments'));
    const saved = internal.find((row) => row.id === appointment.id);
    assert.ok(saved.confirmed_at, 'Bestätigung ist intern sichtbar');

    const declined = await json(await fetch(`${base}/api/public/appointments/${token}/decline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Bitte nachmittags' }),
    }));
    assert.equal(declined.appointment.confirmed_at, null);
    assert.ok(declined.appointment.declined_at);
    assert.equal(declined.appointment.customer_reply, 'Bitte nachmittags');

    const reset = await call(chef.cookie, `/api/appointments/${appointment.id}/confirm-reset`, { method: 'POST' });
    assert.equal(reset.status, 200);
    const resetView = await json(await fetch(`${base}/api/public/appointments/${token}`));
    assert.equal(resetView.appointment.confirmed_at, null);
    assert.equal(resetView.appointment.declined_at, null);
    assert.equal(resetView.appointment.customer_reply, '');

    // ---------------------------------------------------------- Terminarten und Mein Tag
    const meeting = await json(await call(chef.cookie, '/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'meeting',
        title: 'Wochenbesprechung Büro',
        location: 'Büro',
        customer_id: customers[0].id,
        employee_id: 1,
        start_at: new Date(`${new Date().toISOString().slice(0, 10)}T15:00:00`).toISOString(),
        end_at: new Date(`${new Date().toISOString().slice(0, 10)}T16:00:00`).toISOString(),
      }),
    }));
    assert.equal(meeting.kind, 'meeting');
    assert.equal(meeting.location, 'Büro');
    assert.equal(meeting.customer_id, customers[0].id);

    const changedKind = await json(await call(chef.cookie, `/api/appointments/${meeting.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'kundenbesuch', location: 'beim Kunden' }),
    }));
    assert.equal(changedKind.kind, 'kundenbesuch');
    const fallbackKind = await json(await call(chef.cookie, `/api/appointments/${meeting.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'gibtsnicht' }),
    }));
    assert.equal(fallbackKind.kind, 'baustelle', 'Unbekannte Terminart fällt auf Baustelle zurück');

    const listWithKind = await json(await call(chef.cookie, '/api/appointments'));
    const listing = listWithKind.find((row) => row.id === meeting.id);
    assert.ok(listing, 'Termin erscheint in der Liste');
    assert.ok(listing.customer_id, 'Kunde ist auch ohne Auftrag verknüpft');
    assert.ok(listing.company || listing.first_name, 'Kundendaten werden mitgeliefert');

    const myDay = await json(await call(chef.cookie, '/api/my-day'));
    assert.equal(myDay.employee.name, 'Stefan Möller');
    assert.ok(Array.isArray(myDay.appointments));
    assert.ok(Array.isArray(myDay.upcoming));
    assert.ok(myDay.appointments.some((row) => row.kind), 'Eigene Termine enthalten die Terminart');
    assert.ok(myDay.teamToday.length >= 3, 'Team-Übersicht für Führungskräfte');

    const monteurDay = await json(await call(monteur.cookie, '/api/my-day'));
    assert.ok(monteurDay.employee, 'Monteur hat einen eigenen Tag');
    assert.equal(monteurDay.kpis.reportsToApprove, 0, 'Monteur sieht keine Freigaben');
    assert.equal((await fetch(`${base}/api/my-day`)).status, 401, 'Mein Tag braucht Anmeldung');

    const hrDay = await json(await call(hr.cookie, '/api/my-day'));
    assert.equal(hrDay.employee?.name, 'Petra Hoffmann', 'HR hat ein Mitarbeiterkonto');
    assert.ok(Array.isArray(hrDay.appointments), 'HR sieht eigene Termine');
    assert.ok(Array.isArray(hrDay.teamToday));

    const officeStaff = await json(await call(chef.cookie, '/api/employees'));
    assert.ok(officeStaff.some((row) => row.name === 'Sabine Weber' && row.role === 'Büro'));
    assert.ok(officeStaff.some((row) => row.name === 'Petra Hoffmann' && row.role === 'Personal'));

    // ---------------------------------------------------------- E-Mail-Versand
    const smtpSettings = await json(await call(chef.cookie, '/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        smtp_host: '127.0.0.1',
        smtp_port: String(smtpPort),
        smtp_secure: '0',
        smtp_password: 'geheim',
        smtp_from: 'noreply@example.test',
        smtp_from_name: 'HandwerkPro Test',
      }),
    }));
    assert.equal(smtpSettings.settings.smtp_password, '********', 'Passwort wird nie im Klartext ausgeliefert');

    const testMail = await json(await call(chef.cookie, '/api/mail/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'test@example.test' }),
    }));
    assert.equal(testMail.ok, true);
    assert.equal(mails.length, 1, 'Testmail wurde zugestellt');
    assert.match(mails[0], /To: <test@example\.test>/);
    assert.match(mails[0], /Subject: Testmail aus/);

    const mailedLink = await json(await call(chef.cookie, `/api/appointments/${appointment.id}/confirm-mail`, { method: 'POST' }));
    assert.equal(mailedLink.sent, true);
    assert.equal(mails.length, 2, 'Terminbestätigung wurde versendet');
    assert.match(mailedLink.link, /^http:\/\/127\.0\.0\.1:\d+\/termin\/[a-f0-9]{48}$/);
    // Nachrichtentext ist Base64-kodiert – zum Prüfen dekodieren
    const mailBody = mails[1].split('\r\n')
      .filter((line) => /^[A-Za-z0-9+/=]{20,}$/.test(line))
      .map((line) => Buffer.from(line, 'base64').toString('utf8'))
      .join('');
    assert.ok(mailBody.includes('/termin/'), 'E-Mail enthält den Bestätigungslink');
    assert.ok(mailBody.includes('Termin bestätigen'), 'E-Mail enthält eine Handlungsaufforderung');

    const afterMail = await json(await call(chef.cookie, '/api/appointments'));
    assert.ok(afterMail.find((row) => row.id === appointment.id)?.mail_sent_at, 'Versandzeitpunkt wird gespeichert');

    // Kunde bestätigt → das Büro bekommt eine Benachrichtigung
    await fetch(`${base}/api/public/appointments/${token}/confirm`, { method: 'POST' });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const decodeMail = (raw) => raw.split('\r\n')
      .filter((line) => /^[A-Za-z0-9+/=]{20,}$/.test(line))
      .map((line) => Buffer.from(line, 'base64').toString('utf8'))
      .join('');
    assert.ok(mails.some((mail) => decodeMail(mail).includes('Termin bestätigt')),
      'Büro wird bei Bestätigung per E-Mail informiert');

    // Ohne Konfiguration: klare Fehlermeldung mit Code
    await call(chef.cookie, '/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ smtp_host: '', smtp_from: '' }),
    });
    const noMail = await call(chef.cookie, '/api/mail/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'test@example.test' }),
    });
    assert.equal(noMail.status, 400);
    assert.equal((await noMail.json()).code, 'mail_not_configured');
    assert.equal((await call(monteur.cookie, `/api/appointments/${appointment.id}/confirm-mail`, { method: 'POST' })).status, 403,
      'Nur Planung darf Bestätigungen versenden');

    // ---------------------------------------------------------- Sicherheit
    // Kaputte Pfade, Cookies und Host-Header dürfen den Server nicht beenden.
    const rawRequest = (rawPath, extraHeaders = '', hostValue = '127.0.0.1') => new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write(`GET ${rawPath} HTTP/1.1\r\nHost: ${hostValue}\r\n${extraHeaders}Connection: close\r\n\r\n`);
      });
      let data = '';
      socket.on('data', (chunk) => { data += chunk.toString('utf8'); });
      socket.on('end', () => resolve(data.split('\r\n')[0]));
      socket.on('error', reject);
      socket.setTimeout(4000, () => { socket.destroy(); resolve('timeout'); });
    });
    assert.match(await rawRequest('/api/customers/%'), /400/, 'Kaputte URL wird abgelehnt');
    assert.match(await rawRequest('/api/auth/me', 'Cookie: hp_session=%\r\n'), /401/, 'Kaputtes Cookie wird abgelehnt');
    assert.match(await rawRequest('/api/auth/meta', '', 'bad host'), /^HTTP\/1\.1 /, 'Ungültiger Host beendet den Server nicht');
    const stillAlive = await fetch(`${base}/api/auth/meta`);
    assert.equal(stillAlive.status, 200, 'Server läuft nach kaputten Anfragen weiter');

    // Sicherheitsheader sind gesetzt
    const home = await fetch(`${base}/`);
    assert.match(home.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    assert.equal(home.headers.get('referrer-policy'), 'no-referrer');

    // Fremde Herkunft darf keine Änderungen auslösen (CSRF-Schutz).
    const foreign = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ username: 'chef', password: 'chef123' }),
    });
    assert.equal(foreign.status, 403);

    // Einstellungen: keine SMTP- oder Bankdaten für Rollen ohne Recht.
    const monteurAgain = await login('monteur', 'monteur123');
    for (const key of ['smtp_host', 'smtp_user', 'smtp_password', 'smtp_from', 'iban', 'bic', 'public_url']) {
      assert.equal(monteurAgain.data.settings[key], undefined, `${key} bleibt verborgen`);
    }
    assert.equal(monteurAgain.data.settings.company_email, 'info@moeller-gaswasser.de');

    // CSV-Formeln werden entschärft (Schutz vor Tabellenkalkulations-Injection).
    const csvCustomer = await json(await call(chef.cookie, '/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: '=cmd|/C calc!A0', last_name: 'Test' }),
    }));
    const exportedCsv = await (await call(chef.cookie, '/api/export/kunden.csv')).text();
    assert.ok(exportedCsv.includes(`\"'=cmd|/C calc!A0\"`), 'Formel wird als Text exportiert');
    await call(chef.cookie, `/api/customers/${csvCustomer.id}`, { method: 'DELETE' });

    // ---------------------------------------------------------- Materialquellen
    const sourceList = await json(await call(chef.cookie, '/api/materials/sources'));
    assert.ok(sourceList.sources.length >= 9, 'Alle optionalen Materialquellen sind registriert');
    assert.ok(sourceList.sources.every((source) => typeof source.enabled === 'boolean'));
    assert.ok(
      sourceList.sources.every((source) => typeof source.enabledKey === 'string' && source.enabledKey.startsWith('mat_')),
      'Jede Quelle liefert den Namen ihres Einstellungs-Schalters',
    );
    assert.ok(sourceList.sources.some((source) => source.id === 'datanorm' && source.accept));
    assert.ok(sourceList.sources.every((source) => Array.isArray(source.fields)));

    // Zugangsdaten: Chef bekommt Platzhalter, andere Rollen gar keine Material-Keys.
    await call(chef.cookie, '/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mat_icecat_api_token: 'geheim-123', mat_csv_enabled: '1' }),
    });
    const chefSettings = (await json(await call(chef.cookie, '/api/settings'))).settings;
    assert.equal(chefSettings.mat_icecat_api_token, '********');
    await call(chef.cookie, '/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mat_icecat_api_token: '********' }),
    });
    assert.equal(
      db.prepare("SELECT value FROM settings WHERE key = 'mat_icecat_api_token'").get().value,
      'geheim-123',
      'Platzhalter überschreibt das gespeicherte Geheimnis nicht',
    );
    const bueroUser = await login('buero', 'buero123');
    const bueroSettings = bueroUser.data.settings;
    assert.equal(bueroSettings.mat_icecat_api_token, undefined);
    assert.equal(bueroSettings.mat_csv_enabled, undefined);
    const bueroSources = await json(await call(bueroUser.cookie, '/api/materials/sources'));
    assert.ok(bueroSources.sources.length >= 9);
    assert.equal(bueroSources.canManage, false);
    assert.equal(bueroSources.sources[0].fields, undefined, 'Felddefinitionen nur für Einstellungs-Verwalter');

    // Import nur mit Recht und nur für eingeschaltete Quellen.
    const monteurUser = await login('monteur', 'monteur123');
    assert.equal((await call(monteurUser.cookie, '/api/materials/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'csv', files: [] }),
    })).status, 403);
    const disabledImport = await call(chef.cookie, '/api/materials/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'datanorm', files: [{ name: 'x.001', content: 'A;VK;1;00;Test; ;2;0;STK;100;;;' }] }),
    });
    assert.equal(disabledImport.status, 400, 'Ausgeschaltete Quelle wird nicht importiert');

    const csvImport = await json(await call(chef.cookie, '/api/materials/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'csv',
        supplier: 'Muster AG',
        files: [{
          name: 'preise.csv',
          content: 'Artikelnummer;Bezeichnung;Warengruppe;Einheit;EK;VK;EAN\nMAT-1;Testartikel;Rohre;Stk;10,00;15,00;4006381333931',
        }],
      }),
    }));
    assert.equal(csvImport.created, 1);
    const imported = db.prepare("SELECT * FROM articles WHERE number = 'MAT-1'").get();
    assert.ok(imported);
    assert.equal(imported.purchase_price, 10);
    assert.equal(imported.sale_price, 15);
    assert.equal(imported.gtin, '4006381333931');
    assert.equal(imported.supplier, 'Muster AG');

    const secondImport = await json(await call(chef.cookie, '/api/materials/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'csv',
        supplier: 'Muster AG',
        files: [{
          name: 'preise.csv',
          content: 'Artikelnummer;Bezeichnung;Warengruppe;Einheit;EK;VK\nMAT-1;Testartikel;Rohre;Stk;11,00;19,00',
        }],
        options: { updatePrices: true, keepSalePrice: true },
      }),
    }));
    assert.equal(secondImport.updated, 1);
    const importedAgain = db.prepare("SELECT * FROM articles WHERE number = 'MAT-1'").get();
    assert.equal(importedAgain.purchase_price, 11);
    assert.equal(importedAgain.sale_price, 15, 'Gepflegter VK bleibt erhalten');

    const history = await json(await call(chef.cookie, '/api/materials/imports?limit=5'));
    assert.ok(history.length >= 2);
    assert.ok(history.every((row) => Array.isArray(row.details)));

    const gtinCheck = await json(await call(chef.cookie, '/api/materials/gtin/4006381333931'));
    assert.equal(gtinCheck.valid, true);

    // Ohne eingeschaltete Lookup-Quellen bleibt die Anreicherung folgenlos.
    const enriched = await json(await call(chef.cookie, `/api/materials/articles/${imported.id}/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }));
    assert.deepEqual(enriched.applied, []);

    // Händler-Deep-Link nur mit eingeschaltetem Shop.
    await call(chef.cookie, '/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mat_ids_enabled: '1',
        mat_ids_shop_url: 'https://shop.example.test',
        mat_ids_search_path: '/search?q={article}',
      }),
    });
    const deepLink = await json(await call(chef.cookie, `/api/materials/deep-link/${imported.id}`));
    assert.match(deepLink.url, /^https:\/\/shop\.example\.test\/search\?q=/);
    assert.ok(deepLink.url.includes('4006381333931'), 'Deep-Link nutzt GTIN, wenn vorhanden');
    // SSRF-Schutz: private/HTTP-Ziele werden ohne bewusste Testfreigabe abgelehnt.
    await call(chef.cookie, '/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mat_dealer_enabled: '1',
        mat_dealer_base_url: `http://127.0.0.1:${port}/api/dashboard`,
        mat_dealer_search_path: '/',
        mat_allow_http: '0',
      }),
    });
    const blockedDealer = await call(chef.cookie, '/api/materials/sources/dealer/test', { method: 'POST' });
    assert.equal(blockedDealer.status, 400, 'HTTP/private Ziele sind gesperrt');
    assert.match((await blockedDealer.json()).error, /HTTPS|privates Netzwerk/);

    await call(chef.cookie, '/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mat_ids_enabled: '0', mat_csv_enabled: '0', mat_icecat_api_token: '',
        mat_dealer_enabled: '0', mat_dealer_base_url: '', mat_allow_http: '0',
      }),
    });

    // ---------------------------------------------------------- Abmelden
    await call(chef.cookie, '/api/auth/logout', { method: 'POST' });
    assert.equal((await call(chef.cookie, '/api/dashboard')).status, 401);
  } finally {
    smtpServer.close();
    child.kill();
  }
});

/* ============================================================================
 * HERO-Parität: E-Rechnung, DMS, Kalkulation, Personal, Finanzen, Baustelle,
 * Inventur und Schnittstellen.
 * ========================================================================== */

test('E-Rechnung erzeugt XRechnung, ZUGFeRD-XML und eingebettetes PDF', () => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE status != 'storniert' ORDER BY id LIMIT 1").get();
  assert.ok(invoice, 'Eine Rechnung ist vorhanden');
  const data = billing.loadInvoiceData(invoice.id);
  const settings = getSettings();

  const ubl = einvoice.buildXRechnung(data, settings);
  assert.match(ubl, /xrechnung_3\.0/);
  assert.match(ubl, /<cbc:PayableAmount currencyID="EUR">/);
  assert.match(ubl, /<cbc:InvoiceTypeCode>380<\/cbc:InvoiceTypeCode>/);

  const cii = einvoice.buildZugferdXml(data, settings);
  assert.match(cii, /CrossIndustryInvoice/);
  assert.match(cii, /<ram:DuePayableAmount>/);
  assert.match(cii, /<ram:BuyerReference>/);

  const pdf = billing.invoicePdf(invoice.id, { einvoiceXml: cii, persist: true });
  const raw = pdf.buffer.toString('latin1');
  assert.equal(pdf.buffer.subarray(0, 8).toString('latin1'), '%PDF-1.7');
  assert.match(raw, /\/EmbeddedFile/);
  assert.ok(raw.includes('CrossIndustryInvoice'), 'ZUGFeRD-XML ist im PDF eingebettet');

  assert.equal(einvoice.xmlFilename(invoice, 'zugferd').endsWith('-zugferd.xml'), true);
  assert.equal(einvoice.unitCode('m²'), 'MTK');
});

test('DMS archiviert Dokumente mit Versionen, Prüfsumme und GoBD-Löschung', () => {
  const first = dms.storeDocument({
    buffer: Buffer.from('Erste Fassung'),
    originalName: 'vertrag.txt',
    mime: 'text/plain',
    title: 'Testvertrag',
    category: 'vertrag',
  });
  assert.equal(first.version, 1);
  assert.equal(first.sha256.length, 64);
  assert.equal(dms.readDocument(first).toString(), 'Erste Fassung');

  const second = dms.storeDocument({
    buffer: Buffer.from('Zweite Fassung'),
    originalName: 'vertrag.txt',
    title: 'Testvertrag',
    parentId: first.id,
  });
  assert.equal(second.version, 2);
  const versions = dms.documentVersions(first.id);
  assert.equal(versions.length, 2);
  assert.equal(dms.documentEvents(second.id).some((event) => event.action === 'version'), true);

  const deleted = dms.softDeleteDocument(first.id, 1);
  assert.ok(deleted.deleted_at, 'Löschung ist nur eine Markierung');
  assert.equal(dms.listDocuments({}).some((row) => row.id === first.id), false);
  assert.equal(dms.listDocuments({ includeDeleted: true }).some((row) => row.id === first.id), true);
  assert.throws(() => dms.storeDocument({ buffer: Buffer.from('<html><script>alert(1)</script>'), originalName: 'x.html' }), /Sicherheitsgründen/);
});

test('Kalkulation rechnet Vorgabe und Nachkalkulation, Preise werden übernommen', () => {
  const row = db.prepare('SELECT order_id FROM order_items ORDER BY id LIMIT 1').get();
  assert.ok(row, 'Ein Auftrag mit Positionen ist vorhanden');
  const orderId = row.order_id;
  const item = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id LIMIT 1').get(orderId);

  const calculation = calc.updateCalculation(orderId, {
    wage_rate: 48, overhead_pct: 10, profit_pct: 20, discount_pct: 5,
    items: [{ id: item.id, cost_wage: 200, cost_material: 100 }],
  });
  assert.equal(calculation.config.wage_rate, 48);
  assert.equal(calculation.config.overhead_pct, 10);
  const line = calculation.items.find((entry) => entry.id === item.id);
  assert.equal(line.costs.wage, 200);
  assert.equal(line.costs.material, 100);
  assert.ok(line.target > 0);
  assert.ok(calculation.actual && typeof calculation.actual.margin_pct === 'number');
  assert.ok(calculation.planned.cost_total >= 300);

  const applied = calc.applyCalculation(orderId, { wage_rate: 48, overhead_pct: 10, profit_pct: 20, discount_pct: 5 });
  const updated = applied.items.find((entry) => entry.id === item.id);
  assert.ok(updated.unit_price > 0, 'Kalkulierter Preis wird in die Position geschrieben');
});

test('Personal: Urlaubsantrag, Resturlaub und Arbeitszeitkonto', () => {
  const employee = db.prepare('SELECT * FROM employees WHERE active = 1 ORDER BY id LIMIT 1').get();
  const absence = hr.createAbsence({
    employee_id: employee.id,
    type: 'urlaub',
    start_date: '2026-12-21',
    end_date: '2026-12-24',
  }, 1);
  assert.equal(absence.status, 'beantragt');
  assert.equal(absence.days, 4, 'Wochenenden werden nicht mitgezählt');

  hr.decideAbsence(absence.id, 'genehmigt', 1);
  const account = hr.vacationAccount(employee.id, 2026);
  assert.ok(account.approved >= 4);
  assert.equal(account.remaining, account.entitled - account.approved);
  assert.ok(hr.listAbsences({ year: 2026 }).some((row) => row.id === absence.id));

  hr.createAdjustment({ employee_id: employee.id, date: '2026-11-20', minutes: 90, note: 'Nachtrag' }, 1);
  const overtime = hr.overtimeAccount(employee.id, { from: '2026-11-16', to: '2026-11-22' });
  assert.ok(Array.isArray(overtime.weeks));
  assert.equal(overtime.weeks[0].adjustment, 90);
  assert.equal(typeof overtime.balance_hours, 'number');
  assert.ok(hr.hrOverview(2026).length >= 1);
});

test('Plantafel zeigt beantragten und genehmigten Urlaub', () => {
  const employee = db.prepare('SELECT * FROM employees WHERE active = 1 ORDER BY id LIMIT 1').get();
  const pending = hr.createAbsence({
    employee_id: employee.id,
    type: 'urlaub',
    start_date: '2026-12-05',
    end_date: '2026-12-06',
  }, 1);
  assert.equal(pending.status, 'beantragt');
  const approved = hr.createAbsence({
    employee_id: employee.id,
    type: 'urlaub',
    start_date: '2026-12-09',
    end_date: '2026-12-09',
    status: 'genehmigt',
  }, 1);
  assert.equal(approved.status, 'genehmigt');

  const board = resources.planningBoard({ from: '2026-12-01', to: '2026-12-10' });
  const shown = board.absences.find((row) => row.id === pending.id);
  assert.ok(shown, 'Beantragter Urlaub erscheint auf der Plantafel');
  assert.equal(shown.type_label, 'Urlaub');
  assert.equal(shown.status_label, 'Beantragt');
  assert.ok(board.absences.some((row) => row.id === approved.id), 'Genehmigter Urlaub erscheint ebenfalls');
  assert.ok(board.absences.every((row) => row.status !== 'abgelehnt'), 'Abgelehnter Urlaub wird ausgeblendet');
});

test('GPS-Zeiterfassung startet und stoppt Zeit an Baustelle und Zuhause', () => {
  const user = db.prepare("SELECT * FROM users WHERE username = 'vorgesetzt'").get();
  assert.ok(user?.employee_id, 'Vorgesetzter ist einem Mitarbeiter zugeordnet');
  db.prepare("UPDATE time_entries SET end_at = datetime('now') WHERE user_id = ? AND end_at IS NULL").run(user.id);
  const order = db.prepare(
    `SELECT o.id FROM orders o JOIN properties p ON p.id = o.property_id
     WHERE o.employee_id = ? AND o.doc_type = 'auftrag'
       AND o.status NOT IN ('erledigt', 'abgerechnet', 'storniert')
     ORDER BY o.id LIMIT 1`
  ).get(user.employee_id);
  assert.ok(order, 'Aktiver Auftrag mit Objekt vorhanden');

  const home = { latitude: 51.2277, longitude: 6.7735 };
  const site = { latitude: 51.2280, longitude: 6.7740 };
  geo.setHomeLocation(user, { ...home, accuracy: 8 });
  geo.setOrderLocation(user, order.id, site);
  geo.updateGeoSettings(user, { enabled: true, radius_m: 150 });

  assert.ok(geo.distanceMeters(home.latitude, home.longitude, 50.9375, 6.9603) > 30000);

  const entered = geo.geoEvent(user, {
    kind: 'order_enter', order_id: order.id, latitude: site.latitude, longitude: site.longitude, accuracy: 10,
  });
  assert.equal(entered.started, true);
  assert.equal(entered.time.order_id, order.id);
  assert.equal(entered.time.source, 'gps');
  assert.equal(db.prepare('SELECT end_at FROM time_entries WHERE id = ?').get(entered.time.id).end_at, null);

  const duplicate = geo.geoEvent(user, {
    kind: 'order_enter', order_id: order.id, latitude: site.latitude, longitude: site.longitude, accuracy: 10,
  });
  assert.equal(duplicate.duplicate, true, 'Doppeltes Ereignis wird nicht doppelt gebucht');

  assert.throws(() => geo.geoEvent(user, {
    kind: 'order_enter', order_id: order.id, latitude: 52.5, longitude: 7.0, accuracy: 10,
  }), /entfernt/, 'Zu weit entfernte Position wird abgelehnt');

  const exited = geo.geoEvent(user, {
    kind: 'order_exit', order_id: order.id, latitude: 51.24, longitude: 6.79, accuracy: 10,
  });
  assert.equal(exited.stopped, true);
  assert.ok(db.prepare('SELECT end_at FROM time_entries WHERE id = ?').get(entered.time.id).end_at);
  assert.ok(exited.time && exited.time.end_at === null, 'Nach der Abfahrt läuft die Wegezeit weiter');
  assert.equal(exited.time.order_id, null);

  const homeAgain = geo.geoEvent(user, {
    kind: 'home_enter', latitude: home.latitude, longitude: home.longitude, accuracy: 10,
  });
  assert.equal(homeAgain.stopped, true);
  assert.equal(homeAgain.time, null);

  const leftHome = geo.geoEvent(user, {
    kind: 'home_exit', latitude: 51.24, longitude: 6.79, accuracy: 10,
  });
  assert.equal(leftHome.started, true);
  assert.equal(leftHome.time.order_id, null);

  // 30-Sekunden-Schutz gegen doppelte Ereignisse im Test zurücksetzen.
  db.prepare('DELETE FROM geo_time_events WHERE user_id = ?').run(user.id);
  const backHome = geo.geoEvent(user, {
    kind: 'home_enter', latitude: home.latitude, longitude: home.longitude, accuracy: 10,
  });
  assert.equal(backHome.stopped, true);

  const absence = hr.createAbsence({
    employee_id: user.employee_id,
    type: 'urlaub',
    start_date: todayISO(),
    end_date: todayISO(),
    status: 'genehmigt',
  }, 1);
  const paused = geo.geoEvent(user, {
    kind: 'home_exit', latitude: 51.24, longitude: 6.79, accuracy: 10,
  });
  assert.equal(paused.skipped, true, 'Genehmigte Abwesenheit pausiert die Automatik');
  hr.deleteAbsence(absence.id);

  geo.updateGeoSettings(user, { enabled: false, radius_m: 150 });
  assert.throws(() => geo.geoEvent(user, {
    kind: 'home_exit', latitude: 51.24, longitude: 6.79, accuracy: 10,
  }), /ausgeschaltet/);
});

test('Finanzen: Bankimport mit Duplikatfilter, DATEV, IBAN und SEPA', () => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE status IN ('offen','teilweise','gemahnt') ORDER BY id LIMIT 1").get();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(invoice.customer_id);
  const validIban = 'DE89370400440532013000';
  assert.equal(finance.validIban(validIban), true);
  assert.equal(finance.validIban('DE00370400440532013000'), false);

  const csv = [
    'Buchungstag;Betrag;Verwendungszweck;Auftraggeber;IBAN',
    `03.05.2021;${Number(invoice.total).toFixed(2).replace('.', ',')};Rechnung ${invoice.number} ${customer.company || ''};Testkunde;${validIban}`,
    '04.05.2021;-12,50;Material;Baumarkt;',
  ].join('\n');
  const imported = finance.importBankTransactions(csv, { filename: 'test.csv' });
  assert.equal(imported.imported, 2);
  const again = finance.importBankTransactions(csv, { filename: 'test.csv' });
  assert.equal(again.imported, 0);
  assert.equal(again.skipped, 2);

  const rows = finance.listBankTransactions({});
  const matched = rows.find((row) => row.date === '2021-05-03' && row.amount > 0);
  assert.equal(matched.invoice_id, invoice.id, 'Zahlung wird über die Rechnungsnummer zugeordnet');

  const datev = finance.datevExport({ from: '2021-01-01', to: '2021-12-31' });
  assert.match(datev.content, /^\uFEFFEXTF;700;510;21;/);
  assert.match(datev.content, /"Umsatz";"Soll\/Haben-Kennzeichen"/);

  db.prepare('UPDATE customers SET iban = ?, bic = ? WHERE id = ?').run(validIban, 'COBADEFFXXX', customer.id);
  db.prepare("UPDATE invoices SET status = 'offen', paid_total = 0 WHERE id = ?").run(invoice.id);
  const sepa = finance.sepaExport({ invoiceIds: [invoice.id], executionDate: '2026-12-01' });
  assert.equal(sepa.count, 1);
  assert.match(sepa.content, /pain\.001\.001\.03/);
  assert.match(sepa.content, /<IBAN>DE89370400440532013000<\/IBAN>/);
});

test('Aufmaß, Checklisten, Bautagebuch und Unterschrift', () => {
  const row = db.prepare('SELECT order_id FROM order_items ORDER BY id LIMIT 1').get();
  const orderId = row.order_id;

  const measurement = site.createMeasurement(orderId, {
    room: 'Bad', category: 'flaeche', description: 'Fliesen', length: 2.5, width: 2, count: 2,
  }, 1);
  assert.equal(measurement.quantity, 10);
  const applied = site.applyMeasurements(orderId, { ids: [measurement.id], unitPrice: 45 });
  assert.equal(applied.positions, 1);

  const template = site.createChecklistTemplate({ name: 'Testvorlage', trade: 'Test', items: ['Punkt A', 'Punkt B'] });
  const checklist = site.createOrderChecklist(orderId, { templateId: template.id }, 1);
  assert.equal(checklist.items.length, 2);
  site.updateChecklistEntry(checklist.id, checklist.items[0].id, { checked: true }, 1);
  assert.equal(site.orderChecklists(orderId).find((list) => list.id === checklist.id).done, 1);
  site.addChecklistEntry(checklist.id, 'Punkt C');
  assert.equal(site.orderChecklists(orderId).find((list) => list.id === checklist.id).total, 3);

  const diary = site.createDiaryEntry(orderId, { date: '2026-11-20', work_done: 'Rohre verlegt', weather: 'trocken' }, 1);
  assert.equal(diary.work_done, 'Rohre verlegt');
  assert.equal(site.listDiary(orderId).length >= 1, true);

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAZ7f2sQAAAAASUVORK5CYII=', 'base64');
  const signature = site.saveSignature(orderId, {
    customer_name: 'Max Mustermann',
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
  }, { userId: 1, ip: '127.0.0.1' });
  assert.equal(signature.sha256.length, 64);
  assert.ok(site.signatureFilePath(signature).endsWith('.png'));
  assert.equal(site.siteSummary(orderId).signatures.length >= 1, true);
  assert.throws(() => site.saveSignature(orderId, { customer_name: 'Test', dataUrl: 'data:text/plain;base64,QQ==' }), /PNG/);
});

test('Inventur zählt und korrigiert Bestände erst beim Abschluss', () => {
  const article = db.prepare('SELECT * FROM articles WHERE active = 1 ORDER BY id LIMIT 1').get();
  const session = inventory.createInventorySession({ name: 'Testinventur', userId: 1 });
  assert.equal(session.status, 'offen');
  const counted = Number(article.stock) - 2;
  inventory.saveInventoryCount(session.id, { articleId: article.id, counted }, 1);
  assert.equal(Number(db.prepare('SELECT stock FROM articles WHERE id = ?').get(article.id).stock), Number(article.stock),
    'Bestand bleibt vor dem Abschluss unverändert');

  const closed = inventory.closeInventorySession(session.id, 1);
  assert.equal(closed.session.status, 'abgeschlossen');
  assert.equal(Number(db.prepare('SELECT stock FROM articles WHERE id = ?').get(article.id).stock), counted);
  assert.throws(() => inventory.saveInventoryCount(session.id, { articleId: article.id, counted: 1 }), /abgeschlossen/);
  assert.throws(() => inventory.deleteInventorySession(session.id), /Nachvollziehbarkeit/);
});

test('Schnittstellen: GAEB, OCI und Webhook-Schutz', () => {
  const row = db.prepare('SELECT order_id FROM order_items ORDER BY id LIMIT 1').get();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(row.order_id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort, id').all(order.id);

  const gaeb = interfaces.exportGaeb(order, items);
  assert.match(gaeb, /GAEB_DA_XML\/DA83/);
  const parsed = interfaces.parseGaeb(gaeb);
  assert.equal(parsed.items.length, items.length);
  const importResult = interfaces.importGaebToOrder(order.id, gaeb);
  assert.equal(importResult.count, items.length);

  const oci = `<ORDER><ORDER_HEADER><ORDER_ID>OCI-1</ORDER_ID></ORDER_HEADER><ORDER_ITEM_LIST>
    <ORDER_ITEM><LINE_ITEM_ID>1</LINE_ITEM_ID><QUANTITY>2</QUANTITY><ORDER_UNIT>Stk</ORDER_UNIT>
    <PRICE>9.50</PRICE><DESCRIPTION_SHORT>OCI-Testartikel</DESCRIPTION_SHORT></ORDER_ITEM></ORDER_ITEM_LIST></ORDER>`;
  const ociResult = interfaces.importOciToOrder(order.id, oci);
  assert.equal(ociResult.count, 1);

  assert.equal(interfaces.webhookUrlAllowed('https://example.com/hook').ok, true);
  assert.equal(interfaces.webhookUrlAllowed('http://example.com/hook').ok, false);
  assert.equal(interfaces.webhookUrlAllowed('https://127.0.0.1/hook').ok, false);
  assert.equal(interfaces.webhookUrlAllowed('https://192.168.0.5/hook').ok, false);
  assert.equal(interfaces.webhookUrlAllowed('https://user:pass@example.com/hook').ok, false);
  assert.ok(interfaces.openapiDocument().paths['/api/finance/datev']);
});

test('Neue Module über HTTP inklusive Rechteprüfung', async () => {
  const port = 3490;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50 && !ready; i += 1) {
    try { ready = (await fetch(`${base}/api/auth/meta`)).ok; } catch { await new Promise((resolve) => setTimeout(resolve, 150)); }
  }
  assert.ok(ready, 'Server ist erreichbar');

  const credentials = {};
  const login = async (username, password) => {
    const candidates = [credentials[username], password, `${password}-test`].filter(Boolean);
    let response = null;
    for (const candidate of candidates) {
      response = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: candidate }),
      });
      if (response.ok) break;
    }
    assert.equal(response.status, 200, `Login ${username}`);
    let cookie = response.headers.get('set-cookie').split(';')[0];
    let data = await response.json();
    if (data.user.must_change_password) {
      const next = `${candidates[candidates.length - 1]}-neu`;
      const changed = await fetch(`${base}/api/auth/password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ currentPassword: candidates[candidates.length - 1], newPassword: next }),
      });
      assert.equal(changed.status, 200, 'Startpasswort geändert');
      cookie = changed.headers.get('set-cookie').split(';')[0];
      credentials[username] = next;
      data = await changed.json();
    }
    return { cookie, data };
  };
  const call = (cookie, path, options = {}) => fetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Cookie: cookie },
  });
  const json = (response) => response.json();
  const post = (cookie, path, body) => call(cookie, path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  try {
    const chef = await login('chef', 'chef123');
    const order = db.prepare("SELECT * FROM orders WHERE doc_type = 'auftrag' ORDER BY id LIMIT 1").get();
    const invoice = db.prepare("SELECT * FROM invoices WHERE status != 'storniert' ORDER BY id LIMIT 1").get();

    const documents = await json(await call(chef.cookie, '/api/documents'));
    assert.ok(Array.isArray(documents));
    const overview = await json(await call(chef.cookie, '/api/finance/overview'));
    assert.ok(overview.open_invoices);
    assert.ok(Array.isArray(await json(await call(chef.cookie, '/api/finance/bank'))));
    const datev = await call(chef.cookie, '/api/finance/datev?from=2021-01-01&to=2021-12-31');
    assert.equal(datev.status, 200);
    assert.match(await datev.text(), /EXTF;700/);

    const board = await json(await call(chef.cookie, '/api/planning/board'));
    assert.ok(Array.isArray(board.resources));
    const accounts = await json(await call(chef.cookie, '/api/hr/accounts'));
    assert.ok(Array.isArray(accounts.employees));
    const calculation = await json(await call(chef.cookie, `/api/orders/${order.id}/calculation`));
    assert.ok(calculation.planned && calculation.actual);
    const siteData = await json(await call(chef.cookie, `/api/orders/${order.id}/site`));
    assert.equal(typeof siteData.checklist_percent, 'number');
    const templates = await json(await call(chef.cookie, '/api/checklist-templates'));
    assert.ok(templates.length >= 3);
    assert.ok(Array.isArray(await json(await call(chef.cookie, '/api/inventory'))));

    const ubl = await call(chef.cookie, `/api/invoices/${invoice.id}/einvoice?format=xrechnung`);
    assert.equal(ubl.status, 200);
    assert.match(await ubl.text(), /xrechnung_3\.0/);
    const zugferd = await call(chef.cookie, `/api/invoices/${invoice.id}/einvoice?format=zugferd&pdf=1`);
    assert.equal(zugferd.status, 200);
    const pdfBytes = Buffer.from(await zugferd.arrayBuffer());
    assert.equal(pdfBytes.subarray(0, 8).toString('latin1'), '%PDF-1.7');
    assert.ok(pdfBytes.toString('latin1').includes('EmbeddedFile'));

    const uploaded = await json(await post(chef.cookie, '/api/documents', {
      filename: 'http-test.txt', title: 'HTTP-Testdokument', category: 'vertrag', content: 'Inhalt', order_id: order.id,
    }));
    assert.equal(uploaded.sha256.length, 64);
    const file = await call(chef.cookie, `/api/documents/${uploaded.id}/file`);
    assert.equal(await file.text(), 'Inhalt');
    const version = await json(await post(chef.cookie, `/api/documents/${uploaded.id}/versions`, { filename: 'v2.txt', content: 'Neu' }));
    assert.equal(version.document.version, 2);

    const draft = await json(await post(chef.cookie, '/api/assistant/draft', { kind: 'angebot', order_id: order.id }));
    assert.match(draft.text, /Gesamtbetrag/);
    const measurement = await json(await post(chef.cookie, `/api/orders/${order.id}/measurements`, {
      room: 'Küche', category: 'flaeche', description: 'Fliesen', length: 2, width: 2, count: 1,
    }));
    assert.equal(measurement.quantity, 4);
    assert.equal((await call(chef.cookie, `/api/orders/${order.id}/measurements/${measurement.id}`, { method: 'DELETE' })).status, 200);

    const checklist = await json(await post(chef.cookie, `/api/orders/${order.id}/checklists`, { template_id: templates[0].id }));
    assert.ok(checklist.items.length > 0);
    const entry = await call(chef.cookie, `/api/checklists/${checklist.id}/entries/${checklist.items[0].id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checked: 1 }),
    });
    assert.equal((await entry.json()).checked, 1);

    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAZ7f2sQAAAAASUVORK5CYII=';
    const signature = await json(await post(chef.cookie, `/api/orders/${order.id}/signatures`, {
      customer_name: 'HTTP Kunde', dataUrl: `data:image/png;base64,${png}`,
    }));
    const signatureFile = await call(chef.cookie, `/api/signatures/${signature.id}/file`);
    assert.equal(signatureFile.status, 200);

    // ---------------------------------------------------------- Rechte
    const monteur = await login('monteur', 'monteur123');
    assert.equal((await call(monteur.cookie, '/api/documents')).status, 403);
    assert.equal((await call(monteur.cookie, '/api/finance/overview')).status, 403);
    assert.equal((await call(monteur.cookie, '/api/webhooks')).status, 403);
    assert.equal((await post(monteur.cookie, '/api/inventory', { name: 'Verboten' })).status, 403);
    assert.equal((await post(monteur.cookie, '/api/assistant/draft', { kind: 'angebot', order_id: order.id })).status, 403);
    assert.equal((await post(monteur.cookie, `/api/orders/${order.id}/calculation/apply`, {})).status, 403);
    const ownAccount = await json(await call(monteur.cookie, '/api/hr/accounts'));
    assert.equal(ownAccount.employees, undefined, 'Monteure sehen keine fremden Personalkonten');
    assert.ok(ownAccount.vacation);
    const employeeList = await json(await call(monteur.cookie, '/api/employees'));
    const otherEmployee = employeeList.find((row) => row.id !== monteur.data.user.employee_id);
    assert.equal(otherEmployee.home_lat, undefined, 'Fremde Hausanschrift wird nicht ausgeliefert');
    const ownOrderDetail = await json(await call(monteur.cookie, `/api/orders/${db.prepare(
      "SELECT id FROM orders WHERE employee_id = ? AND doc_type = 'auftrag' ORDER BY id LIMIT 1"
    ).get(monteur.data.user.employee_id).id}`));
    if (ownOrderDetail.employee) {
      assert.equal(ownOrderDetail.employee.home_lat, undefined, 'Hausanschrift nicht in Auftragsdetails');
    }

    // GPS-Zeiterfassung: eigene Standorte setzen und Zeit automatisch schalten.
    const geoOrder = db.prepare(
      `SELECT o.id FROM orders o JOIN properties p ON p.id = o.property_id
       WHERE o.employee_id = ? AND o.doc_type = 'auftrag'
         AND o.status NOT IN ('erledigt', 'abgerechnet', 'storniert')
       ORDER BY o.id LIMIT 1`
    ).get(monteur.data.user.employee_id);
    assert.ok(geoOrder, 'Monteur hat einen aktiven Auftrag mit Objekt');
    db.prepare('DELETE FROM geo_time_events WHERE user_id = ?').run(monteur.data.user.id);
    const put = (cookie, path, body) => call(cookie, path, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    await put(monteur.cookie, '/api/geo/settings', { enabled: false, radius_m: 150 });
    const geoStatus = await json(await call(monteur.cookie, '/api/geo/status'));
    assert.equal(geoStatus.enabled, false);
    const geoEnabled = await json(await put(monteur.cookie, '/api/geo/settings', { enabled: true, radius_m: 150 }));
    assert.equal(geoEnabled.enabled, true);
    const geoHome = await json(await put(monteur.cookie, '/api/geo/home', {
      latitude: 51.2277, longitude: 6.7735, accuracy: 8,
      home_street: 'Testweg 1', home_zip: '40210', home_city: 'Düsseldorf',
    }));
    assert.equal(geoHome.home.latitude, 51.2277);
    const geoLocation = await json(await put(monteur.cookie, `/api/orders/${geoOrder.id}/location`, {
      latitude: 51.2280, longitude: 6.7740, accuracy: 8,
    }));
    assert.equal(geoLocation.order_id, geoOrder.id);
    const geoEnter = await json(await post(monteur.cookie, '/api/geo/event', {
      kind: 'order_enter', order_id: geoOrder.id, latitude: 51.2280, longitude: 6.7740, accuracy: 10,
    }));
    assert.equal(geoEnter.started, true);
    assert.equal(geoEnter.time.source, 'gps');
    const geoExit = await json(await post(monteur.cookie, '/api/geo/event', {
      kind: 'order_exit', order_id: geoOrder.id, latitude: 51.2400, longitude: 6.7900, accuracy: 10,
    }));
    assert.equal(geoExit.stopped, true);
    assert.ok(geoExit.time && geoExit.time.end_at === null, 'Wegezeit läuft nach Abfahrt weiter');
    const geoHomeStop = await json(await post(monteur.cookie, '/api/geo/event', {
      kind: 'home_enter', latitude: 51.2277, longitude: 6.7735, accuracy: 10,
    }));
    assert.equal(geoHomeStop.stopped, true);
    assert.equal((await post(monteur.cookie, '/api/geo/event', {
      kind: 'order_enter', order_id: geoOrder.id, latitude: 52.5, longitude: 7.0, accuracy: 10,
    })).status, 400);
    assert.ok((await json(await call(monteur.cookie, '/api/geo/events'))).length >= 2);

    const hrUser = await login('hr', 'hr123');
    const hrAccounts = await json(await call(hrUser.cookie, '/api/hr/accounts'));
    assert.ok(Array.isArray(hrAccounts.employees));
    const hrEmployees = await json(await call(hrUser.cookie, '/api/employees'));
    assert.ok(hrEmployees.every((row) => 'home_lat' in row), 'HR sieht die Hausanschriften');
    assert.equal((await call(hrUser.cookie, '/api/finance/overview')).status, 403);
    assert.equal((await put(hrUser.cookie, `/api/orders/${geoOrder.id}/location`, {
      latitude: 51.2280, longitude: 6.7740,
    })).status, 403, 'HR darf keine Auftragsstandorte setzen');
  } finally {
    child.kill();
  }
});

test('HERO 4–9: Zusammenarbeit, CRM, Portal, Lager und Lohn über HTTP', async () => {
  const port = 3491;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50 && !ready; i += 1) {
    try { ready = (await fetch(`${base}/api/auth/meta`)).ok; } catch { await new Promise((resolve) => setTimeout(resolve, 150)); }
  }
  assert.ok(ready, 'Server ist erreichbar');

  const credentials = {};
  const login = async (username, password) => {
    const candidates = [
      credentials[username], password, `${password}-test`, `${password}-test-neu`, `${password}-neu`,
    ].filter(Boolean);
    let response = null;
    for (const candidate of candidates) {
      response = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: candidate }),
      });
      if (response.ok) break;
    }
    assert.equal(response?.status, 200, `Login ${username}`);
    let cookie = response.headers.get('set-cookie').split(';')[0];
    let data = await response.json();
    if (data.user.must_change_password) {
      const next = `${password}-test-neu2`;
      const changed = await fetch(`${base}/api/auth/password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ currentPassword: candidates[candidates.length - 1], newPassword: next }),
      });
      assert.equal(changed.status, 200, 'Startpasswort geändert');
      cookie = changed.headers.get('set-cookie').split(';')[0];
      credentials[username] = next;
      data = await changed.json();
    }
    return { cookie, data };
  };
  const call = (cookie, path, options = {}) => fetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Cookie: cookie },
  });
  const json = (response) => response.json();
  const post = (cookie, path, body) => call(cookie, path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const put = (cookie, path, body) => call(cookie, path, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  try {
    const chef = await login('chef', 'chef123');
    const monteur = await login('monteur', 'monteur123');
    const customer = db.prepare('SELECT * FROM customers ORDER BY id LIMIT 1').get();
    const article = db.prepare('SELECT * FROM articles ORDER BY id LIMIT 1').get();
    const employeeId = monteur.data.user.employee_id;

    // Aufgaben: Chef legt zu, Monteur erledigt, Monteur darf nicht anlegen.
    const task = await json(await post(chef.cookie, '/api/tasks', {
      title: 'HTTP-Testaufgabe', description: 'Bitte prüfen', employee_id: employeeId,
    }));
    assert.equal(task.status, 'offen');
    assert.ok((await json(await call(chef.cookie, '/api/notifications'))).items.length >= 1);
    const monteurTasks = await json(await call(monteur.cookie, '/api/tasks'));
    assert.ok(monteurTasks.tasks.some((row) => row.id === task.id));
    assert.equal((await post(monteur.cookie, '/api/tasks', { title: 'Verboten' })).status, 403);
    const done = await json(await post(monteur.cookie, `/api/tasks/${task.id}/done`, { done: true }));
    assert.equal(done.status, 'erledigt');

    // Nachrichten am Auftrag.
    const order = await json(await post(chef.cookie, '/api/orders', {
      customer_id: customer.id,
      title: 'HERO-HTTP-Auftrag',
      employee_id: employeeId,
      items: [{ description: 'Testleistung', quantity: 2, unit: 'Std', unit_price: 50, kind: 'arbeit' }],
    }));
    await post(chef.cookie, '/api/messages', { order_id: order.order.id, body: 'Bitte am Montag starten.' });
    const messages = await json(await call(monteur.cookie, `/api/messages?order_id=${order.order.id}`));
    assert.equal(messages.messages.length, 1);

    // CRM: Anfrage anlegen, öffentliches Formular, Umwandlung in Kunde.
    const lead = await json(await post(chef.cookie, '/api/leads', {
      name: 'Max Mustermann', email: 'max@example.test', phone: '0170 0000000', source: 'telefon', value: 500,
    }));
    assert.equal(lead.name, 'Max Mustermann');
    const token = 'testtoken'.padEnd(48, 'a');
    await put(chef.cookie, '/api/settings', { lead_token: token });
    const publicLead = await fetch(`${base}/api/public/leads/${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Website Kunde', email: 'website@example.test', message: 'Heizung defekt' }),
    });
    assert.equal(publicLead.status, 200);
    const converted = await json(await post(chef.cookie, `/api/leads/${lead.id}/convert`));
    assert.equal(converted.created, true);
    assert.equal((await post(monteur.cookie, '/api/leads', { name: 'Verboten', email: 'x@example.test' })).status, 403);

    // Kundenportal: Link erzeugen, öffentlich lesen, Rechnung als PDF.
    const portal = await json(await post(chef.cookie, `/api/customers/${customer.id}/portal`));
    assert.match(portal.path, /^\/portal\//);
    const portalDoc = await json(await post(chef.cookie, '/api/documents', {
      customer_id: customer.id,
      category: 'protokoll',
      title: 'Portal-Testdokument',
      filename: 'notiz.txt',
      mime: 'text/plain',
      dataUrl: `data:text/plain;base64,${Buffer.from('Portal-Dokument').toString('base64')}`,
    }));
    const portalData = await json(await fetch(`${base}/api/public/portal/${portal.token}`));
    assert.equal(portalData.customer.number, customer.number);
    assert.ok(portalData.documents.some((doc) => doc.id === portalDoc.id), 'Dokument erscheint im Portal');
    const portalFile = await fetch(`${base}/api/public/portal/${portal.token}/documents/${portalDoc.id}/file`);
    assert.equal(portalFile.status, 200);
    assert.equal(await portalFile.text(), 'Portal-Dokument');
    assert.equal((await post(monteur.cookie, `/api/customers/${customer.id}/portal`)).status, 403);
    const customerInvoice = db.prepare('SELECT * FROM invoices WHERE customer_id = ? LIMIT 1').get(customer.id);
    if (customerInvoice) {
      const pdf = await fetch(`${base}/api/public/portal/${portal.token}/invoices/${customerInvoice.id}/pdf`);
      assert.equal(pdf.status, 200);
      assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString('latin1'), '%PDF-');
    }

    // Lager: Reservierung, Packliste und OCI-Export.
    const reservation = await json(await post(chef.cookie, `/api/orders/${order.order.id}/reservations`, {
      article_id: article.id, quantity: 2,
    }));
    assert.equal(reservation.reservations.length, 1);
    const pack = await json(await call(chef.cookie, `/api/orders/${order.order.id}/packlist`));
    assert.equal(pack.total_count, 1);
    const oci = await call(chef.cookie, `/api/orders/${order.order.id}/oci`);
    assert.equal(oci.status, 200);
    assert.match(await oci.text(), /ORDER_ITEM/);
    assert.equal((await post(monteur.cookie, `/api/orders/${order.order.id}/reservations`, {
      article_id: article.id, quantity: 1,
    })).status, 403, 'Monteure dürfen keine Reservierungen anlegen');

    // Abschlagsrechnung und Dokumente.
    const progress = await json(await post(chef.cookie, `/api/orders/${order.order.id}/progress-invoice`, { percent: 30 }));
    assert.equal(progress.invoice.kind, 'abschlag');
    assert.ok(Number(progress.invoice.total) > 0);
    const confirmation = await call(chef.cookie, `/api/orders/${order.order.id}/pdf?type=auftragsbestaetigung`);
    assert.equal(confirmation.status, 200);
    const delivery = await call(chef.cookie, `/api/orders/${order.order.id}/pdf?type=lieferschein`);
    assert.equal(delivery.status, 200);
    const gaeb84 = await call(chef.cookie, `/api/orders/${order.order.id}/gaeb?format=x84`);
    assert.equal(gaeb84.status, 200);
    assert.match(await gaeb84.text(), /DA84/);

    // Personal: Verträge, Lohnvorbereitung, Zeitkategorien und Rechte.
    const contract = await json(await post(chef.cookie, '/api/employment-contracts', {
      employee_id: employeeId, kind: 'unbefristet', start_date: '2026-01-01', weekly_hours: 40, salary: 3200,
    }));
    assert.equal(contract.employee_id, employeeId);
    assert.equal((await call(monteur.cookie, '/api/employment-contracts')).status, 403);
    assert.equal((await call(monteur.cookie, '/api/hr/payroll')).status, 403);
    const payroll = await json(await call(chef.cookie, '/api/hr/payroll?year=2026&month=11'));
    assert.ok(Array.isArray(payroll.rows));
    const payrollCsv = await call(chef.cookie, '/api/hr/payroll.csv?year=2026&month=11');
    assert.equal(payrollCsv.status, 200);
    assert.match(await payrollCsv.text(), /Mitarbeiter/);
    const categories = await json(await call(monteur.cookie, '/api/time-categories'));
    assert.ok(categories.categories.length >= 5);
    assert.equal((await post(monteur.cookie, '/api/time-categories', { label: 'Verboten' })).status, 403);
    const maternity = await json(await call(chef.cookie, '/api/hr/maternity?due_date=2026-12-01'));
    assert.ok(maternity.protection_start < maternity.due_date);

    // Lexware-Export.
    const lexware = await call(chef.cookie, '/api/finance/lexware');
    assert.equal(lexware.status, 200);
    assert.match(await lexware.text(), /Belegnr/);
  } finally {
    child.kill();
  }
});
