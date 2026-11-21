import { db, todayISO } from './db.js';
import { can } from './permissions.js';
import { runningTime, startTime, stopTime } from './work.js';
import { ABSENCE_TYPES } from './hr.js';

/* GPS-Zeiterfassung (Geofencing)
 * Die App prüft den Standort nur, solange sie geöffnet ist. Der Server
 * bekommt ausschließlich die Übergänge (Betreten/Verlassen) und prüft sie
 * gegen die gespeicherten Standorte. Ein dauerhafter Standortverlauf wird
 * nicht angelegt.
 */

export const GEO_KINDS = {
  order_enter: 'Ankunft Baustelle',
  order_exit: 'Abfahrt Baustelle',
  home_enter: 'Ankunft Zuhause',
  home_exit: 'Abfahrt Zuhause',
};

export const GEO_RADIUS_MIN = 75;
export const GEO_RADIUS_MAX = 500;
export const GEO_RADIUS_DEFAULT = 150;

const EARTH_RADIUS_M = 6371000;
const DEG_TO_RAD = Math.PI / 180;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round1 = (value) => Math.round(Number(value) * 10) / 10;

/** Entfernung zwischen zwei Koordinaten in Metern (Haversine). */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (value) => Number(value) * DEG_TO_RAD;
  const dLat = toRad(lat2) - toRad(lat1);
  const dLng = toRad(lng2) - toRad(lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function coordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error('Ungültige GPS-Koordinaten');
  }
  return { latitude: Math.round(lat * 1e7) / 1e7, longitude: Math.round(lng * 1e7) / 1e7 };
}

function userSettings(user) {
  const row = db.prepare(
    'SELECT geo_time_enabled, geo_radius_m, geo_consent_at FROM users WHERE id = ?'
  ).get(user.id);
  return {
    enabled: Boolean(row?.geo_time_enabled),
    radius: clamp(Number(row?.geo_radius_m) || GEO_RADIUS_DEFAULT, GEO_RADIUS_MIN, GEO_RADIUS_MAX),
    consent_at: row?.geo_consent_at ?? null,
  };
}

function ownOrderClause() {
  return `(o.employee_id = ? OR EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.order_id = o.id AND a.employee_id = ?
      AND date(a.start_at) BETWEEN date('now', '-2 days') AND date('now', '+10 days')
  ))`;
}

export function geoTargets(user) {
  const own = !can(user, 'orders.view.all');
  const employeeId = user.employee_id ?? -1;
  return db.prepare(
    `SELECT o.id AS order_id, o.number, o.title, o.status, o.scheduled_date,
       p.id AS property_id, p.label AS property_label, p.street, p.zip, p.city,
       p.latitude, p.longitude,
       c.company, c.first_name, c.last_name
     FROM orders o
     JOIN properties p ON p.id = o.property_id
     JOIN customers c ON c.id = o.customer_id
     WHERE o.doc_type = 'auftrag'
       AND o.status NOT IN ('erledigt', 'abgerechnet', 'storniert')
       AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
       ${own ? `AND ${ownOrderClause()}` : ''}
     ORDER BY o.scheduled_date IS NULL, o.scheduled_date, o.id
     LIMIT 200`
  ).all(...(own ? [employeeId, employeeId] : [])).map((row) => ({
    ...row,
    address: [row.street, row.zip, row.city].filter(Boolean).join(', '),
  }));
}

function missingLocationCount(user) {
  if (!user.employee_id) return 0;
  return db.prepare(
    `SELECT COUNT(*) AS n
     FROM orders o JOIN properties p ON p.id = o.property_id
     WHERE o.doc_type = 'auftrag'
       AND o.status NOT IN ('erledigt', 'abgerechnet', 'storniert')
       AND (p.latitude IS NULL OR p.longitude IS NULL)
       AND ${ownOrderClause()}`
  ).get(user.employee_id, user.employee_id).n;
}

function employeeHome(user) {
  if (!user.employee_id) return null;
  const row = db.prepare(
    `SELECT id, name, home_street, home_zip, home_city, home_lat, home_lng, home_geo_at
     FROM employees WHERE id = ?`
  ).get(user.employee_id);
  if (!row) return null;
  return {
    ...row,
    latitude: row.home_lat,
    longitude: row.home_lng,
    address: [row.home_street, row.home_zip, row.home_city].filter(Boolean).join(', '),
    has_location: row.home_lat != null && row.home_lng != null,
  };
}

function recentEvents(user, limit = 10) {
  return db.prepare(
    `SELECT g.*, o.number AS order_number, o.title AS order_title
     FROM geo_time_events g
     LEFT JOIN orders o ON o.id = g.order_id
     WHERE g.user_id = ?
     ORDER BY g.id DESC LIMIT ?`
  ).all(user.id, clamp(Number(limit) || 10, 1, 50)).map((row) => ({
    ...row,
    kind_label: GEO_KINDS[row.kind] || row.kind,
  }));
}

function approvedAbsenceToday(user) {
  if (!user.employee_id) return null;
  const row = db.prepare(
    `SELECT id, type, start_date, end_date FROM absences
     WHERE employee_id = ? AND status = 'genehmigt'
       AND start_date <= ? AND end_date >= ?
     ORDER BY id DESC LIMIT 1`
  ).get(user.employee_id, todayISO(), todayISO());
  return row ? { ...row, type_label: ABSENCE_TYPES[row.type] || row.type } : null;
}

export function geoStatus(user) {
  const settings = userSettings(user);
  const employee = employeeHome(user);
  return {
    enabled: settings.enabled,
    radius_m: settings.radius,
    radius_min: GEO_RADIUS_MIN,
    radius_max: GEO_RADIUS_MAX,
    consent_at: settings.consent_at,
    employee,
    home: employee?.has_location
      ? { latitude: employee.latitude, longitude: employee.longitude, address: employee.address, updated_at: employee.home_geo_at }
      : null,
    targets: geoTargets(user),
    missing_locations: missingLocationCount(user),
    events: recentEvents(user),
    absence_today: approvedAbsenceToday(user),
  };
}

export function updateGeoSettings(user, input = {}) {
  const current = userSettings(user);
  const enabled = input.enabled === undefined
    ? current.enabled
    : ['1', 'true', 'on', 1, true].includes(input.enabled);
  const radius = clamp(
    Number(input.radius_m) || current.radius,
    GEO_RADIUS_MIN,
    GEO_RADIUS_MAX,
  );
  db.prepare(
    `UPDATE users SET geo_time_enabled = ?, geo_radius_m = ?,
       geo_consent_at = CASE WHEN ? = 1 AND geo_consent_at IS NULL
         THEN datetime('now') ELSE geo_consent_at END
     WHERE id = ?`
  ).run(enabled ? 1 : 0, Math.round(radius), enabled ? 1 : 0, user.id);
  return geoStatus(user);
}

export function setHomeLocation(user, input = {}) {
  if (!user.employee_id) throw new Error('Dein Benutzerkonto ist keinem Mitarbeiter zugeordnet');
  const { latitude, longitude } = coordinates(input.latitude, input.longitude);
  const fields = [
    'home_lat = ?', 'home_lng = ?', 'home_geo_at = datetime(\'now\')',
  ];
  const values = [latitude, longitude];
  ['home_street', 'home_zip', 'home_city'].forEach((column) => {
    const value = String(input[column] ?? '').trim();
    if (value) {
      fields.push(`${column} = ?`);
      values.push(value.slice(0, 200));
    }
  });
  db.prepare(`UPDATE employees SET ${fields.join(', ')} WHERE id = ?`).run(...values, user.employee_id);
  return geoStatus(user);
}

export function setOrderLocation(user, orderId, input = {}) {
  const order = db.prepare(
    `SELECT o.id, o.number, o.title, o.property_id, p.latitude, p.longitude
     FROM orders o LEFT JOIN properties p ON p.id = o.property_id WHERE o.id = ?`
  ).get(Number(orderId));
  if (!order) {
    const error = new Error('Auftrag nicht gefunden');
    error.status = 404;
    throw error;
  }
  if (!order.property_id) {
    throw new Error('Dieser Auftrag hat kein Objekt. Bitte zuerst ein Objekt mit Adresse zuordnen.');
  }
  const { latitude, longitude } = coordinates(input.latitude, input.longitude);
  db.prepare(
    `UPDATE properties SET latitude = ?, longitude = ?, geo_at = datetime('now') WHERE id = ?`
  ).run(latitude, longitude, order.property_id);
  return {
    order_id: order.id,
    order_number: order.number,
    property_id: order.property_id,
    latitude,
    longitude,
    address_known: true,
  };
}

/** Verarbeitet ein GPS-Übergangsereignis und startet/stoppt die Zeit. */
export function geoEvent(user, input = {}) {
  const settings = userSettings(user);
  if (!settings.enabled) throw new Error('GPS-Zeiterfassung ist für dein Konto ausgeschaltet');

  const kind = String(input.kind || '');
  if (!GEO_KINDS[kind]) throw new Error('Unbekanntes GPS-Ereignis');
  const { latitude, longitude } = coordinates(input.latitude, input.longitude);
  const absence = approvedAbsenceToday(user);
  if (absence && (kind === 'order_enter' || kind === 'home_exit')) {
    return {
      kind,
      kind_label: GEO_KINDS[kind],
      skipped: true,
      started: false,
      stopped: false,
      message: `Genehmigte Abwesenheit (${absence.type_label}) – automatische Zeiterfassung pausiert.`,
      time: runningTime(user),
    };
  }
  const accuracy = clamp(Number(input.accuracy) || 0, 0, 5000);
  const radius = settings.radius;
  const tolerance = Math.max(40, Math.min(250, accuracy));
  let order = null;
  let distance = null;

  if (kind === 'order_enter' || kind === 'order_exit') {
    const orderId = Number(input.order_id);
    if (!orderId) throw new Error('Bitte einen Auftrag angeben');
    order = db.prepare(
      `SELECT o.id, o.number, o.title, p.latitude, p.longitude
       FROM orders o LEFT JOIN properties p ON p.id = o.property_id WHERE o.id = ?`
    ).get(orderId);
    if (!order) {
      const error = new Error('Auftrag nicht gefunden');
      error.status = 404;
      throw error;
    }
    if (order.latitude == null || order.longitude == null) {
      throw new Error('Für diesen Auftrag ist noch kein Standort gespeichert');
    }
    distance = distanceMeters(latitude, longitude, order.latitude, order.longitude);
    if (kind === 'order_enter' && distance > radius + tolerance) {
      throw new Error(`Position ist ${Math.round(distance)} m vom Baustellen-Standort entfernt (Radius ${radius} m)`);
    }
  } else {
    const employee = employeeHome(user);
    if (!employee?.has_location) {
      throw new Error('Für dich ist noch kein Zuhause-Standort gespeichert');
    }
    distance = distanceMeters(latitude, longitude, employee.latitude, employee.longitude);
    if (kind === 'home_enter' && distance > radius + tolerance) {
      throw new Error(`Position ist ${Math.round(distance)} m vom Zuhause-Standort entfernt (Radius ${radius} m)`);
    }
  }

  // Doppelte Ereignisse (z. B. durch einen Browser-Neustart) ignorieren.
  const duplicate = db.prepare(
    `SELECT id FROM geo_time_events
     WHERE user_id = ? AND kind = ? AND COALESCE(order_id, 0) = ?
       AND created_at >= datetime('now', '-30 seconds')
     ORDER BY id DESC LIMIT 1`
  ).get(user.id, kind, order?.id ?? 0);
  if (duplicate) {
    return {
      kind,
      kind_label: GEO_KINDS[kind],
      duplicate: true,
      started: false,
      stopped: false,
      message: 'Ereignis wurde bereits erfasst.',
      time: runningTime(user),
    };
  }

  const running = runningTime(user);
  let entry = null;
  let started = false;
  let stopped = false;
  let message = '';

  if (kind === 'order_enter') {
    if (running && running.order_id === order.id) {
      message = `Zeit läuft bereits für ${order.number}.`;
    } else {
      entry = startTime(user, {
        orderId: order.id,
        type: 'arbeit',
        note: 'Automatisch per GPS',
        source: 'gps',
      });
      started = true;
      message = `GPS: Zeit gestartet – ${order.number}${order.title ? ` · ${order.title}` : ''}.`;
    }
  } else if (kind === 'order_exit') {
    if (running && running.order_id === order.id) {
      entry = stopTime(user);
      stopped = true;
      // Die Arbeitszeit läuft als Wege-/Fahrtzeit weiter, bis Zuhause oder der
      // nächste Auftrag erreicht ist. So entsteht ein durchgehender Arbeitstag.
      startTime(user, {
        type: 'arbeit',
        note: 'Fahrt/Arbeitszeit per GPS',
        source: 'gps',
      });
      message = `GPS: Zeit für ${order.number} gestoppt – Arbeitszeit läuft weiter.`;
    } else {
      message = 'Keine laufende Zeit für diesen Auftrag.';
    }
  } else if (kind === 'home_exit') {
    if (running) {
      message = 'Arbeitszeit läuft bereits.';
    } else {
      entry = startTime(user, {
        type: 'arbeit',
        note: 'Arbeitsbeginn per GPS',
        source: 'gps',
      });
      started = true;
      message = 'GPS: Arbeitsbeginn – guten Start!';
    }
  } else if (kind === 'home_enter') {
    if (running) {
      entry = stopTime(user);
      stopped = true;
      message = 'GPS: Arbeitsende – Feierabend!';
    } else {
      message = 'Es läuft keine Arbeitszeit.';
    }
  }

  const eventId = Number(db.prepare(
    `INSERT INTO geo_time_events
       (user_id, employee_id, kind, order_id, latitude, longitude, accuracy,
        distance_m, radius_m, time_entry_id, message)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    user.id,
    user.employee_id ?? null,
    kind,
    order?.id ?? null,
    latitude,
    longitude,
    accuracy || null,
    distance == null ? null : round1(distance),
    radius,
    entry?.id ?? null,
    message,
  ).lastInsertRowid);

  return {
    event_id: eventId,
    kind,
    kind_label: GEO_KINDS[kind],
    started,
    stopped,
    message,
    distance_m: distance == null ? null : round1(distance),
    radius_m: radius,
    time: runningTime(user),
  };
}

export function geoEvents(user, limit = 10) {
  return recentEvents(user, limit);
}
