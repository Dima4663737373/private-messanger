import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';
import { logger } from './logger';

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
    // @ts-ignore - tweetnacl-util type definitions are incorrect
    messageUint8 = encodeUTF8(message) as unknown as Uint8Array;
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
    return decodeUTF8(decrypted as unknown as string) as unknown as string;
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
    return decodeUTF8(decrypted as unknown as string) as unknown as string;
  } catch (e) {
    logger.error("Sender Decryption failed:", e);
    return null;
  }
};

// Helper to ensure we have keys in local storage (with safe fallback)
export const getOrCreateMessagingKeys = (walletAddress: string): KeyPair => {
  const STORAGE_KEY = `ghost_msg_keys_${walletAddress}`;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Validate stored keys are valid base64 and correct length
      if (parsed.publicKey && parsed.secretKey) {
        const pk = decodeBase64(parsed.publicKey);
        const sk = decodeBase64(parsed.secretKey);
        if (pk.length === nacl.box.publicKeyLength && sk.length === nacl.box.secretKeyLength) {
          return parsed;
        }
      }
    }
  } catch {
    // localStorage unavailable or corrupted data — regenerate
  }

  const newKeys = generateKeyPair();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newKeys));
  } catch {
    // Storage full or unavailable — keys live in memory only this session
    logger.warn('Could not persist messaging keys to localStorage');
  }
  return newKeys;
};
