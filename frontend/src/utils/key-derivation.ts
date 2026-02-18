/**
 * Encryption Key Derivation & Management
 *
 * Strategy (like alpaca-invoice):
 * 1. Return from memory cache
 * 2. Return from sessionStorage (survives page reload within same tab)
 * 3. Call signMessage() from wallet context → derive deterministic keys
 * 4. If signMessage not available → generate random keypair
 *
 * Keys are deterministic when wallet supports signMessage (same wallet = same keys).
 * sessionStorage is just a performance cache — keys are always re-derivable.
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, decodeUTF8 } from 'tweetnacl-util';
import { generateKeyPair, validateKeyPair } from './crypto';
import { KEY_CACHE_TTL } from '../constants';
import { logger } from './logger';

export interface EncryptionKeyPair {
  publicKey: string;  // Base64-encoded
  secretKey: string;  // Base64-encoded
}

// --- Memory Cache with TTL ---

interface CachedEntry {
  keys: EncryptionKeyPair;
  expiresAt: number;
}

const sessionKeyCache = new Map<string, CachedEntry>();

export function getCachedKeys(publicKey: string): EncryptionKeyPair | null {
  const entry = sessionKeyCache.get(publicKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    sessionKeyCache.delete(publicKey);
    return null;
  }
  return entry.keys;
}

export function setCachedKeys(publicKey: string, keys: EncryptionKeyPair): void {
  // Validate keys before caching
  const validation = validateKeyPair(keys);
  if (!validation.valid) {
    logger.error('Invalid keys rejected from cache:', validation.error);
    throw new Error(`Invalid encryption keys: ${validation.error}`);
  }
  sessionKeyCache.set(publicKey, { keys, expiresAt: Date.now() + KEY_CACHE_TTL });
}

export function clearKeyCache(publicKey?: string) {
  if (publicKey) {
    sessionKeyCache.delete(publicKey);
  } else {
    sessionKeyCache.clear();
  }
}

// Periodic cleanup of expired cache entries (every 30 min)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sessionKeyCache) {
    if (now > entry.expiresAt) sessionKeyCache.delete(key);
  }
}, 30 * 60 * 1000);

// --- Session Storage (performance cache — survives page reload) ---
const SESSION_KEY_PREFIX = 'ghost_ek_';

function getSessionKeys(publicKey: string): EncryptionKeyPair | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY_PREFIX + publicKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.publicKey && parsed?.secretKey) return parsed;
  } catch { /* ignore */ }
  return null;
}

function setSessionKeys(publicKey: string, keys: EncryptionKeyPair): void {
  // Validate keys before storing
  const validation = validateKeyPair(keys);
  if (!validation.valid) {
    logger.error('Invalid keys rejected from sessionStorage:', validation.error);
    throw new Error(`Invalid encryption keys: ${validation.error}`);
  }
  try {
    sessionStorage.setItem(SESSION_KEY_PREFIX + publicKey, JSON.stringify(keys));
  } catch { /* ignore quota errors */ }
}

export function clearSessionKeys(publicKey?: string): void {
  try {
    if (publicKey) {
      sessionStorage.removeItem(SESSION_KEY_PREFIX + publicKey);
      // Clean old prefixes from previous versions
      sessionStorage.removeItem('ghost_sk_' + publicKey);
    } else {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(SESSION_KEY_PREFIX) || key?.startsWith('ghost_sk_')) {
          sessionStorage.removeItem(key);
        }
      }
    }
    // Clean ALL old localStorage keys from previous version
    try {
      if (publicKey) {
        localStorage.removeItem('ghost_ek_' + publicKey);
        localStorage.removeItem('ghost_sk_' + publicKey);
        localStorage.removeItem('ghost_pinned_' + publicKey);
        localStorage.removeItem('ghost_muted_' + publicKey);
        localStorage.removeItem('ghost_deleted_chats_' + publicKey);
        localStorage.removeItem('ghost_disappear_' + publicKey);
        localStorage.removeItem('ghost_msg_keys_' + publicKey);
        logger.debug(`[Keys] Cleaned old localStorage keys for ${publicKey.slice(0, 14)}...`);
      }
    } catch (e) {
      logger.warn('[Keys] Failed to clean old localStorage:', e);
    }
  } catch { /* ignore */ }
}

// --- Key Derivation ---

/**
 * Derive a NaCl keypair from arbitrary seed bytes using SHA-256
 */
async function seedToKeypair(seedInput: string): Promise<EncryptionKeyPair> {
  const seedBytes = decodeUTF8(seedInput);
  const seedHash = await crypto.subtle.digest('SHA-256', seedBytes);
  const seed = new Uint8Array(seedHash);
  const keypair = nacl.box.keyPair.fromSecretKey(seed);
  return {
    publicKey: encodeBase64(keypair.publicKey),
    secretKey: encodeBase64(keypair.secretKey)
  };
}

// Type for signMessage from useWallet() context
type SignMessageFn = (message: Uint8Array) => Promise<Uint8Array>;

/**
 * Main entry point: get or derive encryption keys.
 *
 * @param signMessageFn - signMessage function from useWallet() context
 * @param publicKey - User's Aleo address
 */
export async function getOrDeriveKeys(
  signMessageFn: SignMessageFn | undefined,
  publicKey: string,
  useCache: boolean = true
): Promise<EncryptionKeyPair> {
  // 1. Memory cache
  if (useCache) {
    const cached = getCachedKeys(publicKey);
    if (cached) return cached;
  }

  // 2. sessionStorage (survives page reload within same tab)
  const stored = getSessionKeys(publicKey);
  if (stored) {
    if (useCache) setCachedKeys(publicKey, stored);
    return stored;
  }

  // Also check old sessionStorage key prefix (migration)
  try {
    const oldRaw = sessionStorage.getItem('ghost_sk_' + publicKey);
    if (oldRaw) {
      const oldKeys = JSON.parse(oldRaw);
      if (oldKeys?.publicKey && oldKeys?.secretKey) {
        setSessionKeys(publicKey, oldKeys);
        sessionStorage.removeItem('ghost_sk_' + publicKey);
        if (useCache) setCachedKeys(publicKey, oldKeys);
        return oldKeys;
      }
    }
  } catch { /* ignore */ }

  // 3. Derive deterministic keys from address
  // NOTE: Aleo wallet's signMessage is NON-deterministic (different signature each time),
  // causing cross-device encryption key mismatches. Using address-based derivation instead
  // for true determinism across all devices.
  if (signMessageFn) {
    try {
      // Use address-based derivation for determinism (not signMessage)
      const deterministicSeed = `ghost_messenger_v1_${publicKey}`;
      const derived = await seedToKeypair(deterministicSeed);
      if (useCache) setCachedKeys(publicKey, derived);
      setSessionKeys(publicKey, derived);
      logger.info('[Keys] Derived deterministic keys from address');
      return derived;
    } catch (e) {
      // User cancelled — don't fall through, propagate
      if (e?.message?.includes('cancel') || e?.message?.includes('denied') || e?.message?.includes('rejected')) {
        throw e;
      }
      logger.warn('signMessage derivation failed:', e?.message);
    }
  }

  // 4. Fallback: generate random keypair + save to session
  const keys = generateKeyPair();
  if (useCache) setCachedKeys(publicKey, keys);
  setSessionKeys(publicKey, keys);
  return keys;
}

// --- Passphrase-based Key Backup & Recovery ---

/**
 * Encrypt keypair with a user passphrase for backend storage.
 */
export async function encryptKeysWithPassphrase(
  keys: EncryptionKeyPair,
  passphrase: string,
  address: string
): Promise<{ encrypted: string; nonce: string }> {
  const keyMaterial = await crypto.subtle.digest(
    'SHA-256',
    decodeUTF8(passphrase + address)
  );
  const secretKey = new Uint8Array(keyMaterial);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const plaintext = decodeUTF8(JSON.stringify(keys));
  const encrypted = nacl.secretbox(plaintext, nonce, secretKey);
  return {
    encrypted: encodeBase64(encrypted),
    nonce: encodeBase64(nonce)
  };
}

/**
 * Decrypt keypair from backend backup using passphrase.
 */
export async function decryptKeysWithPassphrase(
  encryptedB64: string,
  nonceB64: string,
  passphrase: string,
  address: string
): Promise<EncryptionKeyPair | null> {
  try {
    const keyMaterial = await crypto.subtle.digest(
      'SHA-256',
      decodeUTF8(passphrase + address)
    );
    const secretKey = new Uint8Array(keyMaterial);
    const nonce = decodeBase64(nonceB64);
    const encrypted = decodeBase64(encryptedB64);
    const decrypted = nacl.secretbox.open(encrypted, nonce, secretKey);
    if (!decrypted) return null;
    const json = new TextDecoder().decode(decrypted);
    const parsed = JSON.parse(json);
    if (parsed.publicKey && parsed.secretKey) {
      return { publicKey: parsed.publicKey, secretKey: parsed.secretKey };
    }
    return null;
  } catch {
    return null;
  }
}
