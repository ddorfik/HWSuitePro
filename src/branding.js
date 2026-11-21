import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { DATA_DIR, getSettings, setSettings } from './db.js';
import { jpegInfo } from './pdf.js';

/**
 * Firmenlogo: wird unter data/branding abgelegt und über /branding/logo
 * öffentlich ausgeliefert. Für PDFs wird bewusst nur JPEG unterstützt –
 * das Formular wandelt PNG/WebP im Browser vor dem Hochladen um.
 */
export const BRANDING_DIR = join(DATA_DIR, 'branding');
export const LOGO_FILENAME = 'logo.jpg';
export const MAX_LOGO_BYTES = 4 * 1024 * 1024;

export function saveLogo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Die Datei ist leer');
  if (buffer.length > MAX_LOGO_BYTES) throw new Error('Das Logo ist zu groß (maximal 4 MB)');
  const info = jpegInfo(buffer);
  if (!info) throw new Error('Bitte ein gültiges JPEG-Bild hochladen (PNG wird im Formular automatisch umgewandelt)');
  if (info.width < 8 || info.height < 8) throw new Error('Das Logo ist zu klein (mindestens 8 × 8 Pixel)');
  if (info.width > 6000 || info.height > 3000) throw new Error('Das Logo ist zu groß (maximal 6000 × 3000 Pixel)');

  mkdirSync(BRANDING_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(join(BRANDING_DIR, LOGO_FILENAME), buffer);
  const version = new Date().toISOString();
  setSettings({ company_logo: LOGO_FILENAME, company_logo_updated: version });
  return { logo: LOGO_FILENAME, version, width: info.width, height: info.height };
}

export function removeLogo() {
  const path = join(BRANDING_DIR, LOGO_FILENAME);
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch { /* Datei darf fehlen */ }
  setSettings({ company_logo: '', company_logo_updated: '' });
  return { ok: true };
}

/** Absoluter Pfad des hinterlegten Logos oder null. */
export function logoPath(settings = getSettings()) {
  const name = String(settings.company_logo || '').trim();
  if (!name) return null;
  const resolved = normalize(join(BRANDING_DIR, name));
  if (!resolved.startsWith(`${BRANDING_DIR}${sep}`) || !existsSync(resolved)) return null;
  return resolved;
}

export function logoImage(settings = getSettings()) {
  const path = logoPath(settings);
  if (!path) return null;
  try {
    return { buffer: readFileSync(path), mime: 'image/jpeg' };
  } catch {
    return null;
  }
}

/** Öffentliche URL inklusive Cache-Version oder leer. */
export function logoUrl(settings = getSettings()) {
  if (!logoPath(settings)) return '';
  const version = String(settings.company_logo_updated || settings.company_logo || '1');
  return `/branding/logo?v=${encodeURIComponent(version)}`;
}
