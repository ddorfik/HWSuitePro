import { createHash } from 'node:crypto';
import { db } from './db.js';
import { verifyPassword, hashPassword, randomToken } from './password.js';
import { permissionsFor, roleLabel } from './permissions.js';

export const SESSION_COOKIE = 'hp_session';
const SESSION_DAYS = 30;

const loginAttempts = new Map();
export const TRUST_PROXY = process.env.TRUST_PROXY === '1';

/**
 * Client-IP für Limits. Hinter einem Reverse-Proxy (TRUST_PROXY=1) zählt die
 * X-Forwarded-For-Adresse, sonst die direkte Verbindung.
 */
export function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded.slice(0, 100);
  }
  return String(req.socket?.remoteAddress || 'unknown');
}

/* In der Datenbank liegt nur der Hash des Sitzungstokens – ein DB-Leak erlaubt keine Anmeldung. */
const hashSessionToken = (token) => createHash('sha256').update(String(token)).digest('hex');

/* Gleiche Rechenzeit für unbekannte Benutzer (keine Rückschlüsse auf existierende Konten). */
const DUMMY_PASSWORD_HASH = hashPassword(randomToken(16));

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      // Kaputte Cookie-Werte ignorieren, statt die Anfrage abzubrechen.
      cookies[key] = value;
    }
  }
  return cookies;
}

export function isSecureRequest(req) {
  return Boolean(req.socket?.encrypted)
    || (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
}

export function sessionCookie(token, req) {
  const flags = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ];
  if (isSecureRequest(req)) flags.push('Secure');
  return flags.join('; ');
}

export function clearSessionCookie(req) {
  const flags = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecureRequest(req)) flags.push('Secure');
  return flags.join('; ');
}

export function getUserById(id) {
  const row = db.prepare(
    `SELECT u.*, e.name AS employee_name, e.color AS employee_color, e.role AS employee_role
     FROM users u LEFT JOIN employees e ON e.id = u.employee_id
     WHERE u.id = ?`
  ).get(id);
  if (!row) return null;
  return decorate(row);
}

function decorate(row) {
  const role = row.role;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role,
    role_label: roleLabel(role),
    employee_id: row.employee_id,
    employee_name: row.employee_name,
    employee_color: row.employee_color,
    active: row.active,
    must_change_password: Number(row.must_change_password) === 1,
    permissions: permissionsFor(role),
    last_login: row.last_login,
    created_at: row.created_at,
  };
}

export function authenticate(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const session = db.prepare(
    "SELECT * FROM sessions WHERE id = ? AND datetime(expires_at) > datetime('now')"
  ).get(hashSessionToken(token));
  if (!session) return null;
  const user = getUserById(session.user_id);
  if (!user || !user.active) return null;
  return user;
}

/** Legt eine neue Sitzung an und liefert das Token für das Cookie zurück. */
export function issueSession(userId, req) {
  db.prepare("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')").run();
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, user_agent, ip) VALUES (?,?,?,?,?)'
  ).run(hashSessionToken(token), userId, expires,
    String(req.headers['user-agent'] || '').slice(0, 250),
    String(req.socket?.remoteAddress || ''));
  return token;
}

export function login(username, password, req) {
  const name = String(username || '').trim();
  const secret = String(password || '');
  // Übergroße Eingaben verhindern (kein CPU-/Speichermissbrauch über den Login).
  if (!name || name.length > 100 || secret.length > 200) {
    return { error: 'Benutzername oder Passwort ist falsch.' };
  }
  const user = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(name);
  if (!user || !user.active) {
    verifyPassword(secret, DUMMY_PASSWORD_HASH);
    return { error: 'Benutzername oder Passwort ist falsch.' };
  }
  if (!verifyPassword(secret, user.password_hash)) {
    return { error: 'Benutzername oder Passwort ist falsch.' };
  }

  const token = issueSession(user.id, req);
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);
  return { token, user: getUserById(user.id) };
}

export function logout(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(hashSessionToken(token));
}

export function deleteUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function changePassword(userId, currentPassword, newPassword) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('Benutzer nicht gefunden');
  if (!verifyPassword(currentPassword, user.password_hash)) {
    throw new Error('Das aktuelle Passwort ist falsch');
  }
  if (String(newPassword || '').length < 8) {
    throw new Error('Das neue Passwort muss mindestens 8 Zeichen haben');
  }
  if (String(newPassword || '').length > 200) {
    throw new Error('Das neue Passwort ist zu lang (maximal 200 Zeichen)');
  }
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(hashPassword(newPassword), userId);
  // Alle bisherigen Sitzungen beenden (auch auf anderen Geräten).
  deleteUserSessions(userId);
  return true;
}

/* Einfache Brute-Force-Bremse pro IP */
export function checkLoginAllowed(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return true;
  if (entry.blockedUntil && entry.blockedUntil > Date.now()) return false;
  return true;
}

export function registerLoginFailure(ip) {
  const entry = loginAttempts.get(ip) ?? { count: 0, blockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= 10) {
    entry.blockedUntil = Date.now() + 5 * 60 * 1000;
    entry.count = 0;
  }
  loginAttempts.set(ip, entry);
  // Speicher begrenzen: abgelaufene Einträge bei vielen Angreifern aufräumen.
  if (loginAttempts.size > 5000) {
    const now = Date.now();
    for (const [key, value] of loginAttempts) {
      if (!value.blockedUntil || value.blockedUntil <= now) loginAttempts.delete(key);
    }
  }
}

export function resetLoginFailures(ip) {
  loginAttempts.delete(ip);
}
