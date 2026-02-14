import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { logger } from './logger';

// Use standard TextEncoder/TextDecoder for reliable UTF-8 conversion
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface KeyPair {
  publicKey: string;
  secretKey: string;
}

export interface EncryptedMessage {
  nonce: string;
  ciphertext: string;
  senderPublicKey: string; // Ephemeral or identity
}

// Generate a new keypair for the client (Messaging Key)
export const generateKeyPair = (): KeyPair => {
  const keys = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(keys.publicKey),
    secretKey: encodeBase64(keys.secretKey)
  };
};

// Encrypt a message for a recipient
export const encryptMessage = (
  message: string | Uint8Array,
  recipientPublicKeyB64: string,
  senderSecretKeyB64: string
): string => {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  
  const recipientPublicKey = decodeBase64(recipientPublicKeyB64);
  const senderSecretKey = decodeBase64(senderSecretKeyB64);
  
  let messageUint8: Uint8Array;
  
  if (typeof message === 'string') {
    messageUint8 = textEncoder.encode(message);
  } else if (message instanceof Uint8Array) {
    messageUint8 = message;
  } else {
    // Attempt to convert if it's an array-like object but not Uint8Array
    try {
        messageUint8 = new Uint8Array(message as any);
    } catch (e) {
        throw new TypeError('unexpected type, use Uint8Array or string');
    }
  }
  
  // Double check keys are Uint8Array (handling potential polyfill issues)
  // We explicitly create new Uint8Array instances to ensure they match the current realm's Uint8Array
  // This fixes "TypeError: unexpected type, use Uint8Array" which can occur if types mismatch
  const pk = new Uint8Array(recipientPublicKey instanceof Uint8Array ? recipientPublicKey : new Uint8Array(recipientPublicKey));
  const sk = new Uint8Array(senderSecretKey instanceof Uint8Array ? senderSecretKey : new Uint8Array(senderSecretKey));
  const msgBytes = new Uint8Array(messageUint8);
  const nonceBytes = new Uint8Array(nonce);

  const encrypted = nacl.box(
    msgBytes,
    nonceBytes,
    pk,
    sk
  );

  // Return formatted string: nonce.ciphertext
  return `${encodeBase64(nonce)}.${encodeBase64(encrypted)}`;
};

// Decrypt a message
export const decryptMessage = (
  encryptedPayload: string,
  senderPublicKeyB64: string,
  recipientSecretKeyB64: string
): string | null => {
  try {
    const [nonceB64, ciphertextB64] = encryptedPayload.split('.');
    if (!nonceB64 || !ciphertextB64) throw new Error("Invalid payload format");

    const nonce = decodeBase64(nonceB64);
    const ciphertext = decodeBase64(ciphertextB64);
    const senderPublicKey = decodeBase64(senderPublicKeyB64);
    const recipientSecretKey = decodeBase64(recipientSecretKeyB64);

    const decrypted = nacl.box.open(
      ciphertext,
      nonce,
      senderPublicKey,
      recipientSecretKey
    );

    if (!decrypted) return null;
    return textDecoder.decode(decrypted);
  } catch (e) {
    logger.error("Decryption failed:", e);
    return null;
  }
};

// Decrypt a message where I am the sender
export const decryptMessageAsSender = (
  encryptedPayload: string,
  recipientPublicKeyB64: string,
  senderSecretKeyB64: string
): string | null => {
  try {
    const [nonceB64, ciphertextB64] = encryptedPayload.split('.');
    if (!nonceB64 || !ciphertextB64) throw new Error("Invalid payload format");

    const nonce = decodeBase64(nonceB64);
    const ciphertext = decodeBase64(ciphertextB64);
    const recipientPublicKey = decodeBase64(recipientPublicKeyB64);
    const senderSecretKey = decodeBase64(senderSecretKeyB64);

    // Compute shared key: Box.before(pk, sk)
    const sharedKey = nacl.box.before(recipientPublicKey, senderSecretKey);

    // Decrypt using shared key: Box.open.after(msg, nonce, sharedKey)
    const decrypted = nacl.box.open.after(
      ciphertext,
      nonce,
      sharedKey
    );

    if (!decrypted) return null;
    return textDecoder.decode(decrypted);
  } catch (e) {
    logger.error("Sender Decryption failed:", e);
    return null;
  }
};

// ── Room (Symmetric) Encryption ─────────────────────────────
// Room messages use NaCl secretbox (symmetric) instead of box (asymmetric).
// A shared room key is distributed to members via NaCl box encryption.

/** Generate a random 32-byte room symmetric key (base64) */
export const generateRoomKey = (): string => {
  return encodeBase64(nacl.randomBytes(nacl.secretbox.keyLength));
};

/** Encrypt a message with a symmetric room key (secretbox) */
export const encryptRoomMessage = (message: string, roomKeyB64: string): string => {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const messageBytes = textEncoder.encode(message);
  const key = decodeBase64(roomKeyB64);
  const encrypted = nacl.secretbox(new Uint8Array(messageBytes), new Uint8Array(nonce), new Uint8Array(key));
  return `${encodeBase64(nonce)}.${encodeBase64(encrypted)}`;
};

/** Decrypt a message with a symmetric room key (secretbox) */
export const decryptRoomMessage = (encryptedPayload: string, roomKeyB64: string): string | null => {
  try {
    const [nonceB64, ciphertextB64] = encryptedPayload.split('.');
    if (!nonceB64 || !ciphertextB64) return null;
    const nonce = decodeBase64(nonceB64);
    const ciphertext = decodeBase64(ciphertextB64);
    const key = decodeBase64(roomKeyB64);
    const decrypted = nacl.secretbox.open(new Uint8Array(ciphertext), new Uint8Array(nonce), new Uint8Array(key));
    if (!decrypted) return null;
    return textDecoder.decode(decrypted);
  } catch (e) {
    return null;
  }
};

/** Encrypt a room key for a specific member using NaCl box */
export const encryptRoomKeyForMember = (
  roomKeyB64: string,
  memberPublicKeyB64: string,
  mySecretKeyB64: string
): { encryptedRoomKey: string; nonce: string } => {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const roomKeyBytes = decodeBase64(roomKeyB64);
  const memberPk = decodeBase64(memberPublicKeyB64);
  const mySk = decodeBase64(mySecretKeyB64);
  const encrypted = nacl.box(
    new Uint8Array(roomKeyBytes),
    new Uint8Array(nonce),
    new Uint8Array(memberPk),
    new Uint8Array(mySk)
  );
  return {
    encryptedRoomKey: encodeBase64(encrypted),
    nonce: encodeBase64(nonce)
  };
};

/** Decrypt a room key that was encrypted for me using NaCl box */
export const decryptRoomKey = (
  encryptedRoomKeyB64: string,
  nonceB64: string,
  senderPublicKeyB64: string,
  mySecretKeyB64: string
): string | null => {
  try {
    const encrypted = decodeBase64(encryptedRoomKeyB64);
    const nonce = decodeBase64(nonceB64);
    const senderPk = decodeBase64(senderPublicKeyB64);
    const mySk = decodeBase64(mySecretKeyB64);
    const decrypted = nacl.box.open(
      new Uint8Array(encrypted),
      new Uint8Array(nonce),
      new Uint8Array(senderPk),
      new Uint8Array(mySk)
    );
    if (!decrypted) return null;
    return encodeBase64(decrypted);
  } catch (e) {
    return null;
  }
};

/**
 * SECURITY UPDATE (2026-02-14):
 *
 * The getOrCreateMessagingKeys() function has been REMOVED to eliminate
 * localStorage-based key storage vulnerability.
 *
 * Encryption keys are now derived from wallet transaction signatures using
 * the key-derivation.ts module. This provides:
 * - Zero localStorage usage (eliminates XSS theft risk)
 * - Deterministic key generation from wallet signature
 * - True ownership proof (wallet required for key access)
 *
 * To get encryption keys, use:
 *   import { getOrDeriveKeys } from './key-derivation';
 *   const keys = await getOrDeriveKeys(wallet, publicKey);
 *
 * See: frontend/src/utils/key-derivation.ts
 */
