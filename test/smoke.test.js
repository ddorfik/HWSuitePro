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

const { db, invoiceTotals } = await import('../src/db.js');
const billing = await import('../src/billing.js');
const { runAutomation } = await import('../src/automation.js');
const { verifyPassword } = await import('../src/password.js');
const { permissionsFor, can } = await import('../src/permissions.js');
const { parseMaterials } = await import('../src/work.js');
const materials = await import('../src/materials.js');

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
