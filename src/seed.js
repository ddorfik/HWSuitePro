import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  db, DATA_DIR, nextNumber, logActivity, invoiceTotals, addDays, addMonths, todayISO,
} from './db.js';
import { hashPassword } from './password.js';

const now = new Date();
const timeAt = (offsetDays, hour = 8, minute = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const dateAt = (offsetDays) => {
  const d = new Date(now);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

function insert(sql, params) {
  return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

export function seedDemoData() {
  const settings = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
  if (settings === 0) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('seeded_at', datetime('now'))").run();
  }

  db.exec('BEGIN');
  try {
    // ---------------------------------------------------------------- Monteure
    const employees = [
      ['Stefan Möller', 'Meister', '0172 555 12 30', 78, '#0f766e'],
      ['Kevin Braun', 'Geselle', '0172 555 12 31', 62, '#2563eb'],
      ['Tobias Klein', 'Anlagenmechaniker', '0172 555 12 32', 64, '#b45309'],
      ['Ayla Yilmaz', 'Auszubildende', '0172 555 12 33', 38, '#7c3aed'],
    ];
    const empIds = employees.map(([name, role, phone, rate, color]) =>
      insert('INSERT INTO employees (name, role, phone, rate, color) VALUES (?,?,?,?,?)', [name, role, phone, rate, color])
    );

    // ---------------------------------------------------------------- Kunden
    const customers = [
      {
        type: 'Firma', salutation: 'Firma', company: 'Hausverwaltung Rheinblick GmbH', first_name: 'Sabine', last_name: 'Weber',
        street: 'Königsallee 42', zip: '40212', city: 'Düsseldorf',
        email: 's.weber@rheinblick-hv.de', phone: '0211 880 44 10', mobile: '0171 220 44 10',
        notes: 'Rahmenvertrag über 3 Objekte. Rechnungen bitte an die Verwaltung, Zahlungsziel 21 Tage.',
      },
      {
        type: 'Privat', salutation: 'Herr', company: '', first_name: 'Thomas', last_name: 'Schmitt',
        street: 'Lindenstraße 7', zip: '40545', city: 'Düsseldorf',
        email: 'familie.schmitt@web.de', phone: '0211 550 77 12', mobile: '0176 998 12 04',
        notes: 'Einfamilienhaus, Gastherme Baujahr 2012. Zugang über Garage.',
      },
      {
        type: 'Firma', salutation: 'Firma', company: 'Bäckerei Vollkorn Krause', first_name: 'Holger', last_name: 'Krause',
        street: 'Marktplatz 3', zip: '40878', city: 'Ratingen',
        email: 'krause@vollkorn-baeckerei.de', phone: '02102 44 88 20', mobile: '0151 223 88 20',
        notes: 'Backstube: Arbeiten nur zwischen 13:00 und 17:00 Uhr möglich.',
      },
      {
        type: 'Firma', salutation: 'Firma', company: 'Wohnbau Neuss AG', first_name: 'Miriam', last_name: 'Schulz',
        street: 'Further Straße 12', zip: '41460', city: 'Neuss',
        email: 'm.schulz@wohnbau-neuss.de', phone: '02131 90 11 55', mobile: '',
        notes: 'Wohnanlagen mit zentraler Trinkwasserversorgung. Sammelrechnung erwünscht.',
      },
      {
        type: 'Privat', salutation: 'Frau', company: '', first_name: 'Petra', last_name: 'Lang',
        street: 'Rosenweg 15', zip: '40625', city: 'Düsseldorf',
        email: 'petra.lang@mail.de', phone: '0211 289 55 03', mobile: '0170 445 92 11',
        notes: 'Wartungsvertrag Gastherme. Hund im Garten.',
      },
      {
        type: 'Firma', salutation: 'Firma', company: 'Hotel Stadtpark', first_name: 'Jan', last_name: 'Fischer',
        street: 'Parkstraße 1', zip: '42103', city: 'Wuppertal',
        email: 'technik@hotel-stadtpark.de', phone: '0202 77 33 90', mobile: '0160 555 90 12',
        notes: 'Trinkwasseranlage mit 48 Zapfstellen. Legionellenprüfung halbjährlich.',
      },
    ];
    const custIds = customers.map((c, i) => insert(
      `INSERT INTO customers (number, type, salutation, company, first_name, last_name, street, zip, city, email, phone, mobile, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [`KD-${String(1001 + i)}`, c.type, c.salutation, c.company, c.first_name, c.last_name, c.street, c.zip, c.city, c.email, c.phone, c.mobile, c.notes]
    ));

    // ---------------------------------------------------------------- Objekte
    const properties = [
      [custIds[0], 'MFH Königsallee 42', 'Königsallee 42', '40212', 'Düsseldorf', 'Mehrfamilienhaus', 1, 1, 'Gas-Zentralheizung', 'G-884213', '24 Wohneinheiten, 3 Heizungsstränge.'],
      [custIds[0], 'MFH Bilker Allee 88', 'Bilker Allee 88', '40219', 'Düsseldorf', 'Mehrfamilienhaus', 0, 1, 'Fernwärme', 'W-412880', 'Nur Wasser/Abwasser in unserer Zuständigkeit.'],
      [custIds[1], 'EFH Lindenstraße 7', 'Lindenstraße 7', '40545', 'Düsseldorf', 'Einfamilienhaus', 1, 1, 'Gas-Brennwert', 'G-772104', 'Gastherme Vaillant, Baujahr 2012.'],
      [custIds[2], 'Bäckerei Marktplatz 3', 'Marktplatz 3', '40878', 'Ratingen', 'Gewerbe', 1, 1, 'Gas-Durchlauferhitzer', 'G-559031', 'Backstube im Erdgeschoss, Gasleitung DN 20.'],
      [custIds[3], 'Wohnanlage Further Straße 12', 'Further Straße 12', '41460', 'Neuss', 'Mehrfamilienhaus', 1, 1, 'Gas-Zentralheizung', 'G-661200', '36 Wohneinheiten, Hausmeister Herr Peters.'],
      [custIds[3], 'Wohnanlage Am Rosengarten 4', 'Am Rosengarten 4', '41462', 'Neuss', 'Mehrfamilienhaus', 0, 1, 'Fernwärme', 'W-661201', 'Wasserschaden Keller Januar 2026.'],
      [custIds[4], 'EFH Rosenweg 15', 'Rosenweg 15', '40625', 'Düsseldorf', 'Einfamilienhaus', 1, 1, 'Gas-Brennwert', 'G-330912', 'Wartungsvertrag, Zugang über Seiteneingang.'],
      [custIds[5], 'Hotel Stadtpark', 'Parkstraße 1', '42103', 'Wuppertal', 'Gewerbe', 1, 1, 'Gas-Brennwert + Solar', 'G-778341', 'Technikraum Untergeschoss, Zutritt über Portier.'],
    ];
    const propIds = properties.map((p) => insert(
      `INSERT INTO properties (customer_id, label, street, zip, city, type, gas_connection, water_connection, heating_type, meter_number, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`, p
    ));

    // ---------------------------------------------------------------- Artikel
    const articles = [
      ['GA-1001', 'Gasdruckregler 1/2"', 'Gas', 'Stk', 38.50, 79.00, 12, 5, 'Sanitär Union'],
      ['GA-1002', 'Gasabsperrhahn 1/2"', 'Gas', 'Stk', 9.20, 24.50, 25, 10, 'Sanitär Union'],
      ['GA-1003', 'Gasleitung Kupfer 15x1', 'Gas', 'm', 3.10, 8.90, 118, 40, 'Metall Rohre GmbH'],
      ['GA-1004', 'Gasbrenner-Düse 1,15 mm', 'Gas', 'Stk', 4.10, 12.50, 30, 10, 'Vaillant'],
      ['GA-1005', 'Gas-Warnmelder', 'Gas', 'Stk', 42.00, 94.90, 6, 4, 'Sanitär Union'],
      ['GA-1006', 'Gelbgas-Schlauch 1/2"', 'Gas', 'm', 6.50, 15.90, 18, 10, 'Sanitär Union'],
      ['WA-2001', 'Pressfitting Bogen 15 mm', 'Wasser', 'Stk', 1.80, 4.90, 74, 30, 'Viega'],
      ['WA-2002', 'Absperrventil 1/2"', 'Wasser', 'Stk', 7.90, 19.90, 14, 10, 'Sanitär Union'],
      ['WA-2003', 'Trinkwasserfilter 3/4"', 'Wasser', 'Stk', 38.00, 89.00, 3, 4, 'Grünbeck'],
      ['WA-2004', 'Membran-Ausdehnungsgefäß 18 l', 'Wasser', 'Stk', 54.00, 119.00, 2, 3, 'Reflex'],
      ['WA-2005', 'Sicherheitsgruppe 1/2"', 'Wasser', 'Stk', 26.00, 59.00, 9, 5, 'Sanitär Union'],
      ['WA-2006', 'Thermostatkopf', 'Wasser', 'Stk', 12.50, 29.90, 22, 10, 'Heimeier'],
      ['WA-2007', 'Heizkörperventil 1/2"', 'Wasser', 'Stk', 15.90, 36.50, 16, 8, 'Heimeier'],
      ['WA-2008', 'Siphon 1 1/4"', 'Wasser', 'Stk', 5.40, 14.90, 11, 6, 'Sanitär Union'],
      ['WA-2009', 'Kupferrohr 15x1', 'Wasser', 'm', 2.90, 7.50, 92, 40, 'Metall Rohre GmbH'],
      ['WA-2010', 'Dichtung Flach 1/2"', 'Wasser', 'Stk', 0.30, 0.90, 186, 50, 'Sanitär Union'],
      ['WA-2011', 'Edelstahlwellrohr 3/4"', 'Wasser', 'm', 9.80, 22.50, 25, 10, 'Viega'],
      ['ZU-3001', 'Dämmung Rohr 15 mm', 'Zubehör', 'm', 1.10, 2.90, 58, 20, 'Metall Rohre GmbH'],
      ['ZU-3002', 'Hanf / Dichtfaden', 'Zubehör', 'Stk', 2.40, 5.90, 18, 8, 'Sanitär Union'],
      ['ZU-3003', 'Montagematerial-Set', 'Zubehör', 'Pausch', 8.00, 19.50, 20, 5, 'Sanitär Union'],
    ];
    const artIds = articles.map((a) => insert(
      `INSERT INTO articles (number, name, category, unit, purchase_price, sale_price, stock, min_stock, supplier)
       VALUES (?,?,?,?,?,?,?,?,?)`, a
    ));
    const art = (number) => artIds[articles.findIndex((a) => a[0] === number)];

    // ---------------------------------------------------------------- Wartungsverträge
    insert(
      `INSERT INTO contracts (customer_id, property_id, title, interval_months, next_due, price, tasks, notes)
       VALUES (?,?,?,?,?,?,?,?)`,
      [custIds[0], propIds[0], 'Wartung Gas-Zentralheizung Königsallee 42', 12, addDays(todayISO(), 9), 420,
        JSON.stringify([
          { kind: 'arbeit', description: 'Jahreswartung Gas-Zentralheizung inkl. Abgasmessung', quantity: 3, unit: 'Std', unit_price: 78 },
          { kind: 'material', article_id: art('GA-1004'), description: 'Gasbrenner-Düse 1,15 mm', quantity: 1, unit: 'Stk', unit_price: 12.5 },
        ]), 'Zutritt über Hausmeister, Schlüssel im Verwaltungsbüro.']
    );
    insert(
      `INSERT INTO contracts (customer_id, property_id, title, interval_months, next_due, price, tasks, notes)
       VALUES (?,?,?,?,?,?,?,?)`,
      [custIds[4], propIds[6], 'Jährliche Gasthermen-Wartung', 12, addDays(todayISO(), 4), 149,
        JSON.stringify([
          { kind: 'arbeit', description: 'Wartung Gastherme inkl. Funktionsprüfung', quantity: 1.5, unit: 'Std', unit_price: 68 },
        ]), 'Termin bitte telefonisch mit Frau Lang abstimmen.']
    );
    insert(
      `INSERT INTO contracts (customer_id, property_id, title, interval_months, next_due, price, tasks, notes)
       VALUES (?,?,?,?,?,?,?,?)`,
      [custIds[2], propIds[3], 'Wartung Gas-Durchlauferhitzer Backstube', 12, addDays(todayISO(), 24), 189,
        JSON.stringify([
          { kind: 'arbeit', description: 'Wartung Durchlauferhitzer, Prüfung Gasanschluss', quantity: 2, unit: 'Std', unit_price: 68 },
        ]), 'Nur nachmittags, Backbetrieb nicht unterbrechen.']
    );
    insert(
      `INSERT INTO contracts (customer_id, property_id, title, interval_months, next_due, price, tasks, notes)
       VALUES (?,?,?,?,?,?,?,?)`,
      [custIds[5], propIds[7], 'Trinkwasseranlage – Legionellenprüfung', 6, addDays(todayISO(), 38), 340,
        JSON.stringify([
          { kind: 'arbeit', description: 'Legionellenprüfung inkl. Probenahme und Dokumentation', quantity: 2, unit: 'Std', unit_price: 78 },
          { kind: 'material', article_id: art('WA-2003'), description: 'Trinkwasserfilter 3/4"', quantity: 1, unit: 'Stk', unit_price: 89 },
        ]), 'Bericht an die Gebäudetechnik senden.']
    );

    // ---------------------------------------------------------------- Aufträge
    const orderIds = [];
    function order(o) {
      const prefix = o.doc_type === 'angebot' ? 'AN' : 'AU';
      const number = nextNumber(o.doc_type === 'angebot' ? 'quote' : 'order', prefix);
      const id = insert(
        `INSERT INTO orders (number, doc_type, customer_id, property_id, title, description, status, priority,
           employee_id, scheduled_date, labor_hours, labor_rate, tax_rate, internal_note, created_at, completed_at, invoiced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [number, o.doc_type ?? 'auftrag', o.customer, o.property, o.title, o.description ?? '',
          o.status ?? 'neu', o.priority ?? 'normal', o.employee ?? null, o.scheduled ?? null,
          o.labor_hours ?? 0, o.labor_rate ?? 68, 19, o.internal_note ?? '',
          timeAt(o.created ?? -3, 9, 15), o.completed ?? null, o.invoiced ?? null]
      );
      orderIds.push(id);
      (o.items ?? []).forEach((item, index) => {
        insert(
          `INSERT INTO order_items (order_id, kind, article_id, description, quantity, unit, unit_price, sort)
           VALUES (?,?,?,?,?,?,?,?)`,
          [id, item.kind ?? 'material', item.article_id ?? null, item.description, item.quantity,
            item.unit ?? 'Stk', item.unit_price, index]
        );
      });
      if (o.scheduled) {
        const start = new Date(`${o.scheduled}T08:00:00`);
        if (o.time) {
          const [h, m] = o.time.split(':').map(Number);
          start.setHours(h, m, 0, 0);
        }
        const end = new Date(start.getTime() + (o.duration ?? 3) * 3600_000);
        insert(
          `INSERT INTO appointments (order_id, employee_id, title, start_at, end_at, notes)
           VALUES (?,?,?,?,?,?)`,
          [id, o.employee ?? null, o.title, start.toISOString().replace('.000Z', 'Z'), end.toISOString().replace('.000Z', 'Z'), '']
        );
      }
      return id;
    }

    const oGastherme = order({
      customer: custIds[1], property: propIds[2], title: 'Gastherme defekt – kein Warmwasser',
      description: 'Kundin meldet Störung: Warmwasser bleibt kalt, Heizung läuft. Fehlersuche und Reparatur.',
      status: 'in_arbeit', priority: 'dringend', employee: empIds[2], scheduled: dateAt(0), time: '08:30', duration: 4,
      created: -2, labor_hours: 2.5, labor_rate: 68, internal_note: 'Ersatzteil Gasdruckregler aus Lager entnommen.',
      items: [
        { kind: 'arbeit', description: 'Fehlersuche und Reparatur Gastherme', quantity: 2.5, unit: 'Std', unit_price: 68 },
        { kind: 'material', article_id: art('GA-1001'), description: 'Gasdruckregler 1/2"', quantity: 1, unit: 'Stk', unit_price: 79 },
        { kind: 'material', article_id: art('WA-2010'), description: 'Dichtung Flach 1/2"', quantity: 2, unit: 'Stk', unit_price: 0.9 },
      ],
    });

    order({
      customer: custIds[0], property: propIds[0], title: 'Störung Heizungsanlage Strang 3',
      description: 'Druckabfall im Strang 3, mehrere Wohnungen ohne Heizung. Ursache prüfen und abstellen.',
      status: 'geplant', priority: 'hoch', employee: empIds[1], scheduled: dateAt(2), time: '07:30', duration: 5,
      created: -1, labor_hours: 3, labor_rate: 68,
      items: [{ kind: 'arbeit', description: 'Störungssuche Heizungsstrang', quantity: 3, unit: 'Std', unit_price: 68 }],
    });

    const oBackstube = order({
      customer: custIds[2], property: propIds[3], title: 'Neue Gasleitung Backstube',
      description: 'Verlegung einer neuen Gasleitung DN 20 in der Backstube inkl. Absperrung und Druckprüfung.',
      status: 'erledigt', employee: empIds[2], scheduled: dateAt(-3), time: '13:00', duration: 6,
      created: -8, completed: `${dateAt(-3)}T17:40:00.000Z`, labor_hours: 6.5, labor_rate: 68,
      items: [
        { kind: 'arbeit', description: 'Gasleitung verlegen inkl. Druckprüfung', quantity: 6.5, unit: 'Std', unit_price: 68 },
        { kind: 'material', article_id: art('GA-1003'), description: 'Gasleitung Kupfer 15x1', quantity: 18, unit: 'm', unit_price: 8.9 },
        { kind: 'material', article_id: art('WA-2001'), description: 'Pressfitting Bogen 15 mm', quantity: 12, unit: 'Stk', unit_price: 4.9 },
        { kind: 'material', article_id: art('GA-1002'), description: 'Gasabsperrhahn 1/2"', quantity: 2, unit: 'Stk', unit_price: 24.5 },
      ],
    });

    order({
      customer: custIds[3], property: propIds[4], title: 'Trinkwasserfilter tauschen',
      description: 'Filterwechsel an der zentralen Trinkwasseranlage, Dokumentation im Anlagenbuch.',
      status: 'neu', employee: empIds[1], scheduled: dateAt(4), time: '09:00', duration: 2,
      created: -1, labor_hours: 1.5, labor_rate: 68,
      items: [
        { kind: 'arbeit', description: 'Filterwechsel Trinkwasseranlage', quantity: 1.5, unit: 'Std', unit_price: 68 },
        { kind: 'material', article_id: art('WA-2003'), description: 'Trinkwasserfilter 3/4"', quantity: 1, unit: 'Stk', unit_price: 89 },
      ],
    });

    const oWartungLang = order({
      customer: custIds[4], property: propIds[6], title: 'Gastherme warten – Wartungsvertrag',
      description: 'Jahreswartung gemäß Wartungsvertrag inkl. Abgasmessung.',
      status: 'erledigt', employee: empIds[0], scheduled: dateAt(-1), time: '10:00', duration: 2,
      created: -4, completed: `${dateAt(-1)}T11:30:00.000Z`, labor_hours: 1.5, labor_rate: 78,
      items: [
        { kind: 'arbeit', description: 'Jahreswartung Gastherme inkl. Abgasmessung', quantity: 1.5, unit: 'Std', unit_price: 78 },
        { kind: 'material', article_id: art('WA-2010'), description: 'Dichtung Flach 1/2"', quantity: 4, unit: 'Stk', unit_price: 0.9 },
      ],
    });

    order({
      customer: custIds[5], property: propIds[7], title: 'Legionellenprüfung Hotel Stadtpark',
      description: 'Halbjährliche Legionellenprüfung der Trinkwasseranlage inkl. Probenahme.',
      status: 'geplant', employee: empIds[1], scheduled: dateAt(6), time: '08:00', duration: 3,
      created: -1, labor_hours: 2, labor_rate: 78,
      items: [{ kind: 'arbeit', description: 'Legionellenprüfung inkl. Probenahme', quantity: 2, unit: 'Std', unit_price: 78 }],
    });

    order({
      doc_type: 'angebot', customer: custIds[0], property: propIds[1], title: 'Badsanierung – Wasserinstallation',
      description: 'Kompletterneuerung der Wasserinstallation in zwei Bädern, inkl. Vor- und Abwasserleitungen.',
      status: 'neu', employee: empIds[0], created: -5, labor_hours: 32, labor_rate: 68,
      items: [
        { kind: 'arbeit', description: 'Wasserinstallation Bad 1 + 2', quantity: 32, unit: 'Std', unit_price: 68 },
        { kind: 'material', article_id: art('WA-2009'), description: 'Kupferrohr 15x1', quantity: 60, unit: 'm', unit_price: 7.5 },
        { kind: 'material', article_id: art('WA-2001'), description: 'Pressfitting Bogen 15 mm', quantity: 40, unit: 'Stk', unit_price: 4.9 },
        { kind: 'material', article_id: art('WA-2002'), description: 'Absperrventil 1/2"', quantity: 6, unit: 'Stk', unit_price: 19.9 },
      ],
    });

    order({
      doc_type: 'angebot', customer: custIds[1], property: propIds[2], title: 'Neue Brennwerttherme inkl. Einbau',
      description: 'Austausch der Gastherme gegen ein Brennwertgerät inkl. Abgasführung und hydraulischem Abgleich.',
      status: 'neu', employee: empIds[0], created: -6, labor_hours: 8, labor_rate: 68,
      items: [
        { kind: 'arbeit', description: 'Austausch und Inbetriebnahme Brennwerttherme', quantity: 8, unit: 'Std', unit_price: 68 },
        { kind: 'material', description: 'Brennwerttherme Vaillant ecoTEC plus 20 kW', quantity: 1, unit: 'Stk', unit_price: 2280 },
        { kind: 'material', article_id: art('GA-1001'), description: 'Gasdruckregler 1/2"', quantity: 1, unit: 'Stk', unit_price: 79 },
      ],
    });

    const oWasserschaden = order({
      customer: custIds[3], property: propIds[5], title: 'Wasserschaden Keller – Leckortung',
      description: 'Leckortung und Reparatur an der Steigleitung im Keller, Trocknung veranlasst.',
      status: 'abgerechnet', priority: 'hoch', employee: empIds[1], scheduled: dateAt(-18), time: '08:00', duration: 5,
      created: -21, completed: `${dateAt(-18)}T14:20:00.000Z`, invoiced: `${dateAt(-17)}T09:00:00.000Z`,
      labor_hours: 4.5, labor_rate: 68,
      items: [
        { kind: 'arbeit', description: 'Leckortung und Reparatur Steigleitung', quantity: 4.5, unit: 'Std', unit_price: 68 },
        { kind: 'material', article_id: art('WA-2009'), description: 'Kupferrohr 15x1', quantity: 8, unit: 'm', unit_price: 7.5 },
        { kind: 'material', article_id: art('WA-2001'), description: 'Pressfitting Bogen 15 mm', quantity: 6, unit: 'Stk', unit_price: 4.9 },
      ],
    });

    const oWartungAlt = order({
      customer: custIds[0], property: propIds[0], title: 'Jahreswartung 2025 – Heizungsanlage',
      description: 'Jahreswartung der Gas-Zentralheizung inkl. Abgasmessung und Prüfprotokoll.',
      status: 'abgerechnet', employee: empIds[0], scheduled: dateAt(-62), time: '09:00', duration: 4,
      created: -70, completed: `${dateAt(-62)}T13:00:00.000Z`, invoiced: `${dateAt(-60)}T10:00:00.000Z`,
      labor_hours: 3.5, labor_rate: 78,
      items: [
        { kind: 'arbeit', description: 'Jahreswartung inkl. Abgasmessung', quantity: 3.5, unit: 'Std', unit_price: 78 },
        { kind: 'material', article_id: art('GA-1004'), description: 'Gasbrenner-Düse 1,15 mm', quantity: 1, unit: 'Stk', unit_price: 12.5 },
      ],
    });

    const oWasserhahn = order({
      customer: custIds[1], property: propIds[2], title: 'Reparatur Wasserhahn Küche',
      description: 'Wasserhahn tropft, Armatur und Dichtungen erneuert.',
      status: 'abgerechnet', employee: empIds[2], scheduled: dateAt(-38), time: '14:00', duration: 1,
      created: -42, completed: `${dateAt(-38)}T15:10:00.000Z`, invoiced: `${dateAt(-36)}T09:00:00.000Z`,
      labor_hours: 1, labor_rate: 68,
      items: [
        { kind: 'arbeit', description: 'Armatur erneuern', quantity: 1, unit: 'Std', unit_price: 68 },
        { kind: 'material', article_id: art('WA-2010'), description: 'Dichtung Flach 1/2"', quantity: 2, unit: 'Stk', unit_price: 0.9 },
      ],
    });

    // ---------------------------------------------------------------- Rechnungen (Historie)
    function createSeedInvoice(orderId, { date, dueDays, status, paid, dunning = 0, number }) {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort').all(orderId);
      const totals = invoiceTotals(items, order.tax_rate);
      const invoiceNumber = number ?? nextNumber('invoice', 'RE');
      const invoiceId = insert(
        `INSERT INTO invoices (number, order_id, customer_id, property_id, date, due_date, service_date, status, tax_rate,
           subtotal, tax_total, total, paid_total, dunning_level, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [invoiceNumber, orderId, order.customer_id, order.property_id, date, addDays(date, dueDays),
          (order.completed_at ? String(order.completed_at).slice(0, 10) : date), status,
          order.tax_rate, totals.subtotal, totals.tax, totals.total, paid ?? 0, dunning,
          'Vielen Dank für Ihren Auftrag.']
      );
      items.forEach((item, index) => {
        insert(
          `INSERT INTO invoice_items (invoice_id, kind, article_id, description, quantity, unit, unit_price, sort)
           VALUES (?,?,?,?,?,?,?,?)`,
          [invoiceId, item.kind, item.article_id, item.description, item.quantity, item.unit, item.unit_price, index]
        );
      });
      const paidAmount = status === 'bezahlt' ? totals.total : paid;
      if (paidAmount) {
        insert(
          'INSERT INTO payments (invoice_id, date, amount, method, note) VALUES (?,?,?,?,?)',
          [invoiceId, addDays(date, 7), paidAmount, 'Überweisung', 'Zahlungseingang laut Kontoauszug']
        );
      }
      return invoiceId;
    }

    createSeedInvoice(oWartungAlt, { date: dateAt(-60), dueDays: 14, status: 'gemahnt', paid: 0, dunning: 1 });
    createSeedInvoice(oWasserschaden, { date: dateAt(-17), dueDays: 14, status: 'offen', paid: 0 });
    createSeedInvoice(oWasserhahn, { date: dateAt(-36), dueDays: 14, status: 'bezahlt' });

    // ---------------------------------------------------------------- Aktivität
    logActivity('system', 'Demo-Daten geladen – System ist einsatzbereit.');
    logActivity('auftrag', `Auftrag für ${db.prepare('SELECT number FROM orders WHERE id = ?').get(oBackstube).number} auf "erledigt" gesetzt.`);
    logActivity('rechnung', 'Zahlungseingang für Rechnung über 70,04 € verbucht.');
    logActivity('lager', 'Gasdruckregler 1/2" aus Lager entnommen (Auftrag Gastherme).');

    db.exec('COMMIT');

    // Büro- und Führungstermine (außerhalb der Transaktion, eigene Prüfung)
    seedOfficeAppointments();
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/* ------------------------------------------------------------------ Büro- und Führungstermine */
/**
 * Typische Termine von Chef und Vorgesetztem: Kundenbesuche, Besprechungen,
 * Personalgespräche, Lieferanten und Fortbildungen.
 * Läuft nur, wenn noch keine solchen Termine existieren (idempotent).
 */
export function seedOfficeAppointments() {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE kind IS NOT NULL AND kind <> 'baustelle'").get().n;
  if (existing > 0) return 0;

  const emp = (fragment) => db.prepare(
    'SELECT id FROM employees WHERE name LIKE ? ORDER BY id LIMIT 1'
  ).get(`%${fragment}%`)?.id ?? null;
  const cust = (number) => db.prepare('SELECT id FROM customers WHERE number = ?').get(number)?.id ?? null;
  if (!emp('Möller') || !cust('KD-1001')) return 0;

  const at = (offsetDays, hour) => {
    const day = new Date();
    day.setDate(day.getDate() + offsetDays);
    day.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
    return day.toISOString();
  };

  const entries = [
    // Chef
    [emp('Möller'), cust('KD-1002'), 'kundenbesuch', 'Kundenbesuch: Angebot Heizungstausch', 'Lindenstraße 7, Düsseldorf', 0, 10, 11, 'Vor-Ort-Termin zur Aufnahme der neuen Anlage.'],
    [emp('Möller'), null, 'meeting', 'Wochenbesprechung Büro', 'Büro', 0, 15, 16, 'Auftragslage, offene Rechnungen und Personalthemen mit dem Büro.'],
    [emp('Möller'), null, 'personal', 'Personalgespräch: Ayla Yilmaz', 'Büro', 1, 9, 10, 'Zwischengespräch Ausbildung, Feedback zum letzten Bericht.'],
    [emp('Möller'), cust('KD-1001'), 'kundenbesuch', 'Kundenbesuch: Jahresgespräch Hausverwaltung', 'Königsallee 42, Düsseldorf', 2, 11, 12, 'Rahmenvertrag und Wartungspauschale für das kommende Jahr besprechen.'],
    [emp('Möller'), null, 'lieferant', 'Lieferantentermin Großhandel', 'Werkstatt', 3, 13, 14, 'Preise für Brennwertgeräte und Lieferzeiten klären.'],
    [emp('Möller'), null, 'fortbildung', 'Schulung: Trinkwasserverordnung', 'Schulungsraum Düsseldorf', 4, 8, 12, 'Pflichtschulung inklusive Zertifikat.'],
    // Vorgesetzter
    [emp('Klein'), null, 'meeting', 'Team-Meeting Montage', 'Büro', 0, 7, 8, 'Tagesplanung mit den Monteuren, offene Baustellen durchgehen.'],
    [emp('Klein'), cust('KD-1003'), 'kundenbesuch', 'Kundenbesuch: Wartungsvertrag Bäckerei', 'Marktplatz 3, Ratingen', 1, 10, 11, 'Wartungsvertrag für die Backstube anbieten.'],
    [emp('Klein'), null, 'meeting', 'Materialbestellung mit Büro', 'Büro', 2, 14, 15, 'Bestand prüfen und Nachbestellung für nächste Woche abstimmen.'],
    [emp('Klein'), null, 'notdienst', 'Notdienst-Bereitschaft', 'Telefonisch', 5, 17, 20, 'Rufbereitschaft, Absprache mit der Zentrale.'],
  ];

  for (const [employeeId, customerId, kind, title, location, offset, from, to, notes] of entries) {
    insert(
      `INSERT INTO appointments (employee_id, customer_id, kind, title, location, start_at, end_at, notes)
       VALUES (?,?,?,?,?,?,?,?)`,
      [employeeId, customerId, kind, title, location, at(offset, from), at(offset, to), notes]
    );
  }
  return entries.length;
}

/* ------------------------------------------------------------------ Benutzer */
export function seedUsersIfEmpty() {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;

  const employeeId = (fragment) => db.prepare(
    'SELECT id FROM employees WHERE name LIKE ? ORDER BY id LIMIT 1'
  ).get(`%${fragment}%`)?.id ?? null;

  const demoUsers = [
    ['chef', 'chef123', 'Stefan Möller', 'chef', employeeId('Möller')],
    ['buero', 'buero123', 'Sabine Weber', 'buero', null],
    ['vorgesetzt', 'vorgesetzt123', 'Tobias Klein', 'vorgesetzt', employeeId('Klein')],
    ['monteur', 'monteur123', 'Kevin Braun', 'monteur', employeeId('Braun')],
    ['azubi', 'azubi123', 'Ayla Yilmaz', 'monteur', employeeId('Yilmaz')],
    ['hr', 'hr123', 'Petra Hoffmann', 'hr', null],
  ];

  const insert = db.prepare(
    'INSERT INTO users (username, password_hash, name, role, employee_id) VALUES (?,?,?,?,?)'
  );
  for (const [username, password, name, role, employee] of demoUsers) {
    insert.run(username, hashPassword(password), name, role, employee);
  }
  logActivity('system', 'Demo-Benutzer für alle Rollen angelegt.');
}

/* ------------------------------------------------------------------ Zeiten, Berichte, Fotos */
export function seedOperationsIfEmpty() {
  if (db.prepare('SELECT COUNT(*) AS n FROM time_entries').get().n > 0) return;

  const user = db.prepare("SELECT * FROM users WHERE role = 'monteur' ORDER BY id LIMIT 1").get();
  const employee = (user?.employee_id
    ? db.prepare('SELECT * FROM employees WHERE id = ?').get(user.employee_id)
    : null) ?? db.prepare('SELECT * FROM employees ORDER BY id LIMIT 1').get();
  const order = (employee
    ? db.prepare(
      "SELECT * FROM orders WHERE employee_id = ? AND status IN ('in_arbeit','geplant') ORDER BY id LIMIT 1"
    ).get(employee.id)
    : null) ?? db.prepare(
    "SELECT * FROM orders WHERE status IN ('in_arbeit','geplant') ORDER BY id LIMIT 1"
  ).get();
  if (!employee || !order) return;

  const startOfDaysAgo = (days, hour, minute = 0) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  };

  const insertTime = db.prepare(
    'INSERT INTO time_entries (employee_id, user_id, order_id, start_at, end_at, type, note) VALUES (?,?,?,?,?,?,?)'
  );
  insertTime.run(employee.id, user?.id ?? null, order.id,
    startOfDaysAgo(2, 8, 0), startOfDaysAgo(2, 15, 30), 'arbeit', 'Montage vor Ort');
  insertTime.run(employee.id, user?.id ?? null, order.id,
    startOfDaysAgo(1, 7, 30), startOfDaysAgo(1, 16, 0), 'arbeit', 'Montage und Inbetriebnahme');

  // Demo-Bericht mit Material
  const reportId = Number(db.prepare(
    `INSERT INTO reports (order_id, employee_id, user_id, type, content, weather, hours, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,'eingereicht', datetime('now','-1 day'), datetime('now','-1 day'))`
  ).run(order.id, employee.id, user?.id ?? null, 'montage',
    'Anlage geprüft und instand gesetzt. Gasdruckregler getauscht, Dichtungen erneuert und Anlage auf Dichtheit geprüft. '
    + 'Alles wieder betriebsbereit, keine Auffälligkeiten. Kunde wurde eingewiesen.',
    'trocken, 12 °C', 2.5).lastInsertRowid);

  const material = db.prepare(
    'INSERT INTO report_materials (report_id, article_id, description, quantity, unit, source) VALUES (?,?,?,?,?,?)'
  );
  const regler = db.prepare("SELECT * FROM articles WHERE number = 'GA-1001'").get();
  const dichtung = db.prepare("SELECT * FROM articles WHERE number = 'WA-2010'").get();
  if (regler) material.run(reportId, regler.id, regler.name, 1, regler.unit, 'sprache');
  if (dichtung) material.run(reportId, dichtung.id, dichtung.name, 2, dichtung.unit, 'sprache');

  // Demo-Fotos mit Vorher/Nachher-Vergleich (SVG-Platzhalter)
  const folder = join(DATA_DIR, 'fotos', String(order.id));
  mkdirSync(folder, { recursive: true });

  const photoSvg = (title, subtitle, from, to) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>
  </linearGradient></defs>
  <rect width="1200" height="800" fill="url(#g)"/>
  <rect x="60" y="60" width="1080" height="680" rx="24" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.25)" stroke-width="4"/>
  <text x="100" y="300" font-family="Segoe UI, Arial, sans-serif" font-size="92" font-weight="700" fill="#ffffff">${title}</text>
  <text x="100" y="370" font-family="Segoe UI, Arial, sans-serif" font-size="34" fill="rgba(255,255,255,0.85)">${subtitle}</text>
  <text x="100" y="690" font-family="Segoe UI, Arial, sans-serif" font-size="24" fill="rgba(255,255,255,0.55)">Demo-Foto · HandwerkPro</text>
</svg>`;

  const photoInsert = db.prepare(
    'INSERT INTO photos (order_id, report_id, employee_id, kind, filename, caption) VALUES (?,?,?,?,?,?)'
  );
  const beforeFile = `${order.id}/vorher-demo.svg`;
  const afterFile = `${order.id}/nachher-demo.svg`;
  writeFileSync(join(DATA_DIR, 'fotos', beforeFile), photoSvg('Vorher', 'Alte Armatur mit Undichtigkeit', '#5b3a29', '#8b5e34'));
  writeFileSync(join(DATA_DIR, 'fotos', afterFile), photoSvg('Nachher', 'Neue Armatur, Anlage dicht', '#0f4c5c', '#12657a'));
  photoInsert.run(order.id, reportId, employee.id, 'vorher', beforeFile, 'Zustand vor der Reparatur');
  photoInsert.run(order.id, reportId, employee.id, 'nachher', afterFile, 'Fertige Anlage nach der Reparatur');
}
