import {
  db, getSettings, nextNumber, logActivity, addMonths, addDays, todayISO,
} from './db.js';
import { createDunning, createInvoiceFromOrder, nextDocumentNumber } from './billing.js';

/**
 * Zentrale Automatik:
 *  1. Fällige Wartungsverträge -> Auftrag
 *  2. Erledigte Aufträge      -> Rechnung (inkl. PDF)
 *  3. Überfällige Rechnungen  -> Mahnung
 */
export function runAutomation({ force = false } = {}) {
  const settings = getSettings();
  const result = { orders: [], invoices: [], dunnings: [], at: new Date().toISOString() };

  if (force || settings.auto_create_orders === '1') {
    const dueContracts = db.prepare(
      `SELECT * FROM contracts WHERE active = 1 AND date(next_due) <= date('now') ORDER BY next_due`
    ).all();

    for (const contract of dueContracts) {
      try {
        const tasks = JSON.parse(contract.tasks || '[]');
        const number = nextDocumentNumber('order');
        const scheduled = contract.next_due < todayISO() ? todayISO() : contract.next_due;
        const orderId = Number(db.prepare(
          `INSERT INTO orders (number, doc_type, customer_id, property_id, title, description, status, priority,
             scheduled_date, labor_rate, tax_rate, contract_id, internal_note)
           VALUES (?, 'auftrag', ?, ?, ?, ?, 'geplant', 'normal', ?, ?, 19, ?, ?)`
        ).run(number, contract.customer_id, contract.property_id, contract.title,
          `Automatisch erstellt aus Wartungsvertrag „${contract.title}“.`,
          scheduled, settings.default_labor_rate, settings.default_tax_rate, contract.id,
          contract.notes || '').lastInsertRowid);

        tasks.forEach((task, index) => {
          db.prepare(
            `INSERT INTO order_items (order_id, kind, article_id, description, quantity, unit, unit_price, sort)
             VALUES (?,?,?,?,?,?,?,?)`
          ).run(orderId, task.kind ?? 'arbeit', task.article_id ?? null, task.description ?? 'Wartungsleistung',
            task.quantity ?? 1, task.unit ?? 'Stk', task.unit_price ?? contract.price, index);
        });

        const nextDueBase = addMonths(contract.next_due, contract.interval_months);
        let nextDue = nextDueBase;
        let guard = 0;
        while (nextDue <= todayISO() && guard < 24) {
          nextDue = addMonths(nextDue, contract.interval_months);
          guard += 1;
        }
        db.prepare('UPDATE contracts SET next_due = ?, last_order_id = ? WHERE id = ?')
          .run(nextDue, orderId, contract.id);

        // Termin direkt einplanen (Standard: 08:00 Uhr, 2 Stunden)
        const start = `${scheduled}T08:00:00.000Z`;
        const end = `${scheduled}T10:00:00.000Z`;
        db.prepare(
          `INSERT INTO appointments (order_id, title, start_at, end_at, notes)
           VALUES (?,?,?,?,?)`
        ).run(orderId, contract.title, start, end, 'Automatisch aus Wartungsvertrag erzeugt.');

        logActivity('auftrag', `Wartungsauftrag ${number} automatisch aus Vertrag „${contract.title}“ erstellt.`);
        result.orders.push({ id: orderId, number, title: contract.title });
      } catch (error) {
        logActivity('fehler', `Wartungsvertrag ${contract.id}: ${error.message}`);
      }
    }
  }

  if (force || settings.auto_invoice === '1') {
    const completed = db.prepare(
      `SELECT o.* FROM orders o
       WHERE o.status = 'erledigt'
         AND o.doc_type = 'auftrag'
         AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id)
         AND (o.labor_hours > 0 OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id))
       ORDER BY o.completed_at`
    ).all();

    for (const order of completed) {
      try {
        const invoice = createInvoiceFromOrder(order.id);
        result.invoices.push({ id: invoice.id, number: invoice.number, total: invoice.total });
      } catch (error) {
        logActivity('fehler', `Automatische Rechnung für ${order.number}: ${error.message}`);
      }
    }
  }

  if (force || settings.auto_dunning === '1') {
    const dunningDays = Number(settings.dunning_days) || 30;
    const limit = addDays(todayISO(), -dunningDays);
    const overdue = db.prepare(
      `SELECT * FROM invoices
       WHERE status IN ('offen', 'teilweise')
         AND dunning_level = 0
         AND total - paid_total > 0.01
         AND date(due_date) <= date(?)
       ORDER BY due_date`
    ).all(limit);

    for (const invoice of overdue) {
      try {
        const dunning = createDunning(invoice.id);
        result.dunnings.push({ id: invoice.id, number: invoice.number, level: dunning.dunning.level });
      } catch (error) {
        logActivity('fehler', `Mahnung für ${invoice.number}: ${error.message}`);
      }
    }
  }

  return result;
}
