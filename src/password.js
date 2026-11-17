import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, KEY_LENGTH, { N, r: R, p: P }).toString('hex');
  return `scrypt$${N}$${R}$${P}$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algorithm, n, r, p, salt, hash] = String(stored).split('$');
    if (algorithm !== 'scrypt') return false;
    const derived = scryptSync(String(password), salt, KEY_LENGTH, {
      N: Number(n), r: Number(r), p: Number(p),
    });
    const expected = Buffer.from(hash, 'hex');
    return expected.length === derived.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}
