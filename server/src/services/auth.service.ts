import { getConfig } from '../config.js';
import { getLogger } from '../logger.js';
import { createHash, randomBytes } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { apiKeysRepo } from '../database/repositories.js';
import { getAdminSettings } from './setup.service.js';

let passwordHash = '';
let adminUsername = '';
let jwtSecretKey: Uint8Array;
let hashReady = false;
let argon2: any;

export async function initAuth(): Promise<void> {
  const config = getConfig();
  const log = getLogger();

  jwtSecretKey = new TextEncoder().encode(config.JWT_SECRET);

  try {
    argon2 = await import('argon2');
    hashReady = true;
    log.info('Auth: using argon2id');
  } catch {
    hashReady = true;
    log.warn('Auth: argon2 unavailable, using SHA-256 with salt fallback');
  }

  await refreshAuthState();
}

export async function refreshAuthState(): Promise<void> {
  const admin = getAdminSettings();
  if (!admin) {
    adminUsername = '';
    passwordHash = '';
    return;
  }

  adminUsername = admin.username;
  passwordHash = admin.passwordHash;
}

export async function hashPassword(password: string): Promise<string> {
  if (!hashReady) {
    throw new Error('Auth hashing is not initialized');
  }

  if (argon2) {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  const salt = randomBytes(16).toString('hex');
  return `sha256:${salt}:${createHash('sha256').update(salt + password).digest('hex')}`;
}

export function isAuthConfigured() {
  return Boolean(adminUsername && passwordHash);
}

export function getAdminUsername() {
  return adminUsername;
}

export async function verifyPassword(password: string): Promise<boolean> {
  if (!passwordHash) return false;

  if (passwordHash.startsWith('$argon2') && argon2) {
    return argon2.verify(passwordHash, password);
  }

  const parts = passwordHash.split(':');
  if (parts.length === 3 && parts[0] === 'sha256') {
    const salt = parts[1]!;
    const expected = parts[2]!;
    const actual = createHash('sha256').update(salt + password).digest('hex');
    if (actual.length !== expected.length) return false;
    let result = 0;
    for (let i = 0; i < actual.length; i++) {
      result |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return result === 0;
  }

  return false;
}

export async function createToken(username: string): Promise<string> {
  const config = getConfig();
  const expiryStr = config.JWT_EXPIRY;
  const match = expiryStr.match(/^(\d+)([hdm])$/);
  let expiresIn = '24h';
  if (match) {
    expiresIn = expiryStr;
  }

  return new SignJWT({ sub: username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(jwtSecretKey);
}

export async function verifyToken(token: string): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecretKey);
    return payload as { sub: string };
  } catch {
    return null;
  }
}

export function generateApiKey(): { key: string; hash: string } {
  const key = `piguard_${randomBytes(32).toString('hex')}`;
  const hash = createHash('sha256').update(key).digest('hex');
  return { key, hash };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function verifyApiKey(key: string): any {
  const hash = hashApiKey(key);
  const record = apiKeysRepo.findByHash(hash);
  if (record) {
    apiKeysRepo.updateLastUsed((record as any).id);
  }
  return record;
}
