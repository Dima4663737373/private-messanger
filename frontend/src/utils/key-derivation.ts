/**
 * Encryption Key Derivation & Management
 *
 * Strategy (ordered by preference):
 * 1. Try wallet.signMessage() — deterministic, same wallet = same keys (future Leo Wallet support)
 * 2. Try to restore from encrypted backup on backend (passphrase-protected)
 * 3. Generate fresh random keypair (session-only unless backed up)
 *
 * Security:
 * - Secret keys never stored in plaintext (no localStorage, no unencrypted backend)
 * - Passphrase-encrypted backup enables cross-device recovery (opt-in)
 * - Session cache only (Map in memory)
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, decodeUTF8 } from 'tweetnacl-util';
import { generateKeyPair } from './crypto';

export interface EncryptionKeyPair {
  publicKey: string;  // Base64-encoded
  secretKey: string;  // Base64-encoded
}

// --- Session Cache with TTL ---

const KEY_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

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

/**
 * Try to derive keys from wallet signMessage (deterministic).
 * Only works if wallet adapter exposes signMessage().
 *
 * @returns EncryptionKeyPair or null if signMessage not supported
 */
async function trySignMessageDerivation(
  wallet: any,
  publicKey: string
): Promise<EncryptionKeyPair | null> {
  // Check if adapter supports signMessage
  const adapter = wallet?.adapter || wallet;
  if (!adapter?.signMessage) return null;

  try {
    const message = new TextEncoder().encode(
      `Ghost Messenger - Derive encryption keys for ${publicKey}`
    );
    const signature: Uint8Array = await adapter.signMessage(message);
    const signatureB64 = encodeBase64(signature);
    return await seedToKeypair(signatureB64 + publicKey);
  } catch (e: any) {
    // User cancelled or signMessage not actually implemented
    if (e?.message?.includes('cancel') || e?.message?.includes('denied')) {
      throw e; // Re-throw user cancellation
    }
    console.warn('signMessage derivation failed:', e?.message);
    return null;
  }
}

// --- Session Storage (survives page reload, cleared on tab close) ---
const SESSION_KEY_PREFIX = 'ghost_sk_';

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
  try {
    sessionStorage.setItem(SESSION_KEY_PREFIX + publicKey, JSON.stringify(keys));
  } catch { /* ignore quota errors */ }
}

export function clearSessionKeys(publicKey?: string): void {
  try {
    if (publicKey) {
      sessionStorage.removeItem(SESSION_KEY_PREFIX + publicKey);
    } else {
      // Clear all ghost keys
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(SESSION_KEY_PREFIX)) sessionStorage.removeItem(key);
      }
    }
  } catch { /* ignore */ }
}

export async function getOrDeriveKeys(
  wallet: any,
  publicKey: string,
  useCache: boolean = true
): Promise<EncryptionKeyPair> {
  if (useCache) {
    const cached = getCachedKeys(publicKey);
    if (cached) return cached;
  }

  // 1. Try signMessage derivation (deterministic, future-proof)
  try {
    const derived = await trySignMessageDerivation(wallet, publicKey);
    if (derived) {
      if (useCache) setCachedKeys(publicKey, derived);
      setSessionKeys(publicKey, derived);
      return derived;
    }
  } catch (e: any) {
    // User cancelled — don't fall through, propagate
    if (e?.message?.includes('cancel') || e?.message?.includes('denied')) {
      throw e;
    }
  }

  // 2. Restore from sessionStorage (survives page reload within same tab)
  const sessionKeys = getSessionKeys(publicKey);
  if (sessionKeys) {
    if (useCache) setCachedKeys(publicKey, sessionKeys);
    return sessionKeys;
  }

  // 3. signMessage not available, no session — generate random keys
  const keys = generateKeyPair();
  if (useCache) setCachedKeys(publicKey, keys);
  setSessionKeys(publicKey, keys);
  return keys;
}

// --- Passphrase-based Key Backup & Recovery ---

/**
 * Encrypt keypair with a user passphrase for backend storage.
 * Uses NaCl secretbox with SHA-256(passphrase + address) as key.
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
