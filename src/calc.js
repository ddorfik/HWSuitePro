import { db, getSettings, round2 } from './db.js';

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function itemCosts(order, item, settings) {
  const wageRate = number(order.calc_wage_rate, number(settings.default_calc_wage_rate, 42));
  const quantity = number(item.quantity);
  const article = item.article_id
    ? db.prepare('SELECT * FROM articles WHERE id = ?').get(item.article_id)
    : null;
  const defaultMaterial = article ? quantity * number(article.purchase_price) : 0;
  const defaultWage = item.kind === 'arbeit' ? quantity * wageRate : 0;
  const wage = item.cost_wage == null ? defaultWage : number(item.cost_wage);
  const material = item.cost_material == null ? defaultMaterial : number(item.cost_material);
  const equipment = number(item.cost_equipment);
  const other = number(item.cost_other);
  return {
    wage: round2(wage),
    material: round2(material),
    equipment: round2(equipment),
    other: round2(other),
    total: round2(wage + material + equipment + other),
  };
}

export function orderCalculation(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  const settings = getSettings();
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort, id').all(orderId);

  const wageRate = number(order.calc_wage_rate, number(settings.default_calc_wage_rate, 42));
  const overheadPct = number(order.calc_overhead_pct, number(settings.default_calc_overhead_pct, 8));
  const profitPct = number(order.calc_profit_pct, number(settings.default_calc_profit_pct, 12));
  const discountPct = number(order.calc_discount_pct, number(settings.default_calc_discount_pct, 0));

  let costTotal = 0;
  let revenue = 0;
  const lines = items.map((item) => {
    const costs = itemCosts(order, item, settings);
    const net = round2(number(item.quantity) * number(item.unit_price));
    costTotal = round2(costTotal + costs.total);
    revenue = round2(revenue + net);
    const target = round2(costs.total * (1 + overheadPct / 100) * (1 + profitPct / 100) * (1 - discountPct / 100));
    const marginPct = net > 0 ? round2(((net - costs.total) / net) * 100) : 0;
    return { ...item, costs, net, target, margin_pct: marginPct };
  });

  const overhead = round2(costTotal * (overheadPct / 100));
  const profit = round2((costTotal + overhead) * (profitPct / 100));
  const targetNet = round2((costTotal + overhead + profit) * (1 - discountPct / 100));
  const margin = revenue > 0 ? round2(((revenue - costTotal) / revenue) * 100) : 0;

  // Nachkalkulation: tatsächlich gestempelte Zeit und tatsächlicher Materialeinsatz.
  const time = db.prepare(
    `SELECT COALESCE(SUM((julianday(COALESCE(end_at, datetime('now'))) - julianday(start_at)) * 24), 0) AS hours
     FROM time_entries WHERE order_id = ? AND type = 'arbeit'`
  ).get(orderId);
  const actualHours = round2(number(time?.hours));
  const actualWage = round2(actualHours * wageRate);
  const actualMaterial = round2(lines.reduce((sum, line) => sum + line.costs.material, 0));
  const actualEquipment = round2(lines.reduce((sum, line) => sum + line.costs.equipment, 0));
  const actualOther = round2(lines.reduce((sum, line) => sum + line.costs.other, 0));
  const actualCost = round2(actualWage + actualMaterial + actualEquipment + actualOther);
  const invoiced = db.prepare(
    "SELECT COALESCE(SUM(subtotal), 0) AS net FROM invoices WHERE order_id = ? AND status != 'storniert'"
  ).get(orderId);
  const actualRevenue = number(invoiced?.net) || revenue;
  const actualMargin = actualRevenue > 0 ? round2(((actualRevenue - actualCost) / actualRevenue) * 100) : 0;

  return {
    order,
    items: lines,
    config: {
      wage_rate: wageRate,
      overhead_pct: overheadPct,
      profit_pct: profitPct,
      discount_pct: discountPct,
      mode: order.calc_mode || 'summe',
    },
    planned: {
      cost_total: costTotal,
      overhead,
      profit,
      target_net: targetNet,
      revenue,
      margin_pct: margin,
      margin_amount: round2(revenue - costTotal),
    },
    actual: {
      hours: actualHours,
      wage: actualWage,
      material: actualMaterial,
      equipment: actualEquipment,
      other: actualOther,
      cost_total: actualCost,
      revenue: actualRevenue,
      margin_pct: actualMargin,
      margin_amount: round2(actualRevenue - actualCost),
      deviation: round2(actualCost - costTotal),
    },
  };
}

export function updateCalculation(orderId, input = {}) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  const settings = getSettings();
  const mode = ['summe', 'aufschlag', 'marge'].includes(String(input.mode)) ? String(input.mode) : (order.calc_mode || 'summe');
  const data = {
    calc_wage_rate: number(input.wage_rate, number(order.calc_wage_rate, number(settings.default_calc_wage_rate, 42))),
    calc_overhead_pct: number(input.overhead_pct, number(order.calc_overhead_pct, number(settings.default_calc_overhead_pct, 8))),
    calc_profit_pct: number(input.profit_pct, number(order.calc_profit_pct, number(settings.default_calc_profit_pct, 12))),
    calc_discount_pct: number(input.discount_pct, number(order.calc_discount_pct, number(settings.default_calc_discount_pct, 0))),
    calc_mode: mode,
  };
  db.prepare(
    `UPDATE orders SET calc_wage_rate = ?, calc_overhead_pct = ?, calc_profit_pct = ?,
       calc_discount_pct = ?, calc_mode = ? WHERE id = ?`
  ).run(data.calc_wage_rate, data.calc_overhead_pct, data.calc_profit_pct, data.calc_discount_pct, data.calc_mode, orderId);

  const items = Array.isArray(input.items) ? input.items : [];
  for (const item of items) {
    const id = number(item.id);
    if (!id) continue;
    const owned = db.prepare('SELECT 1 FROM order_items WHERE id = ? AND order_id = ?').get(id, orderId);
    if (!owned) continue;
    db.prepare(
      `UPDATE order_items SET cost_wage = ?, cost_material = ?, cost_equipment = ?, cost_other = ?, calc_note = ?
       WHERE id = ? AND order_id = ?`
    ).run(
      item.cost_wage == null || item.cost_wage === '' ? null : number(item.cost_wage),
      item.cost_material == null || item.cost_material === '' ? null : number(item.cost_material),
      item.cost_equipment == null || item.cost_equipment === '' ? null : number(item.cost_equipment),
      item.cost_other == null || item.cost_other === '' ? null : number(item.cost_other),
      String(item.note || ''),
      id, orderId,
    );
  }
  return orderCalculation(orderId);
}

/**
 * Übernimmt die kalkulierten Preise in die Auftragspositionen.
 * Aufschlag = Kosten + Gemeinkosten + Gewinn, optional abzüglich Rabatt.
 */
export function applyCalculation(orderId, input = {}) {
  const calculation = updateCalculation(orderId, input);
  if (!calculation) return null;
  const { config } = calculation;
  const factor = (1 + config.overhead_pct / 100) * (1 + config.profit_pct / 100) * (1 - config.discount_pct / 100);
  db.exec('BEGIN');
  try {
    for (const line of calculation.items) {
      const quantity = Number(line.quantity) || 0;
      if (quantity <= 0) continue;
      const price = round2((line.costs.total / quantity) * factor);
      if (price <= 0) continue; // Positionen ohne hinterlegte Kosten bleiben unverändert.
      db.prepare('UPDATE order_items SET unit_price = ? WHERE id = ? AND order_id = ?')
        .run(price, line.id, orderId);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return orderCalculation(orderId);
}
