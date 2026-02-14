import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';

export interface KeyPair {
  publicKey: string;  // base64
  secretKey: string;  // base64
}

// ── Key Management ──────────────────────────────────

/** Generate a new NaCl box key pair for E2E encryption */
export function generateKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  };
}

/** Store keys in localStorage, generate if missing */
export function getOrCreateKeys(username: string): KeyPair {
  const key = `ghost_keys_${username}`;
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.publicKey && parsed.secretKey) return parsed;
    }
  } catch { /* regenerate */ }

  const kp = generateKeyPair();
  try { localStorage.setItem(key, JSON.stringify(kp)); } catch { /* ignore */ }
  return kp;
}

// ── E2E Encryption (NaCl box — DMs) ──────────────────

/** Encrypt plaintext for a specific recipient (DM) */
export function encryptForRecipient(
  plaintext: string,
  recipientPublicKey: string,
  senderSecretKey: string
): { payload: string; nonce: string } {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageBytes = decodeUTF8(plaintext);
  const pk = decodeBase64(recipientPublicKey);
  const sk = decodeBase64(senderSecretKey);

  const encrypted = nacl.box(messageBytes, nonce, pk, sk);
  if (!encrypted) throw new Error('Encryption failed');

  return {
    payload: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
  };
}

/** Decrypt a DM from a specific sender */
export function decryptFromSender(
  payload: string,
  nonce: string,
  senderPublicKey: string,
  recipientSecretKey: string
): string {
  const encrypted = decodeBase64(payload);
  const nonceBytes = decodeBase64(nonce);
  const pk = decodeBase64(senderPublicKey);
  const sk = decodeBase64(recipientSecretKey);

  const decrypted = nacl.box.open(encrypted, nonceBytes, pk, sk);
  if (!decrypted) throw new Error('Decryption failed');

  return encodeUTF8(decrypted);
}

// ── Symmetric Encryption (NaCl secretbox — Rooms) ──────

/** Derive a 32-byte room key from a passphrase */
export function deriveRoomKey(passphrase: string): string {
  const hash = nacl.hash(decodeUTF8(passphrase));
  return encodeBase64(hash.slice(0, nacl.secretbox.keyLength));
}

/** Encrypt with a symmetric room key */
export function encryptRoom(plaintext: string, roomKeyB64: string): { payload: string; nonce: string } {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const key = decodeBase64(roomKeyB64);
  const encrypted = nacl.secretbox(decodeUTF8(plaintext), nonce, key);
  if (!encrypted) throw new Error('Room encryption failed');
  return { payload: encodeBase64(encrypted), nonce: encodeBase64(nonce) };
}

/** Decrypt with a symmetric room key */
export function decryptRoom(payload: string, nonce: string, roomKeyB64: string): string {
  const decrypted = nacl.secretbox.open(
    decodeBase64(payload),
    decodeBase64(nonce),
    decodeBase64(roomKeyB64)
  );
  if (!decrypted) throw new Error('Room decryption failed');
  return encodeUTF8(decrypted);
}

// ── Hashing ──────────────────────────────────────

/** SHA-512 hash of a string, returned as hex */
export function hashMessage(text: string): string {
  const hash = nacl.hash(decodeUTF8(text));
  return Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Shorter hash suitable for Aleo field (first 31 bytes as decimal) */
export function hashForAleo(text: string): string {
  const hash = nacl.hash(decodeUTF8(text));
  // Convert first 31 bytes to a BigInt, then to decimal string for Aleo field
  let num = BigInt(0);
  for (let i = 0; i < 31; i++) {
    num = (num << BigInt(8)) | BigInt(hash[i]);
  }
  return num.toString() + 'field';
}
