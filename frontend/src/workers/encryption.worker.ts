/* eslint-disable no-restricted-globals */
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

// Use standard TextEncoder/TextDecoder for reliable UTF-8 conversion
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Remove padding from a decrypted message.
 * Reads the 2-byte length prefix and extracts the real message.
 * Falls back to returning raw bytes if not padded (backward compatible).
 */
const unpadMessage = (padded: Uint8Array): Uint8Array => {
  if (padded.length < 2) return padded;
  const realLength = (padded[0] << 8) | padded[1];
  if (realLength <= 0 || realLength + 2 > padded.length) return padded;
  return padded.slice(2, 2 + realLength);
};

/**
 * Pad a message to the next power-of-2 bucket (min 256 bytes).
 * Prevents ciphertext length from leaking plaintext length.
 * Format: [2-byte big-endian real length][message bytes][random padding]
 */
const padMessage = (msg: Uint8Array): Uint8Array => {
  const MIN_BUCKET = 256;
  const totalNeeded = 2 + msg.length;
  let bucket = MIN_BUCKET;
  while (bucket < totalNeeded) bucket *= 2;
  const padded = new Uint8Array(bucket);
  padded[0] = (msg.length >> 8) & 0xff;
  padded[1] = msg.length & 0xff;
  padded.set(msg, 2);
  const randomPad = nacl.randomBytes(bucket - totalNeeded);
  padded.set(randomPad, totalNeeded);
  return padded;
};

// Worker Message Types
type WorkerMessage =
  | { type: 'ENCRYPT'; id: string; text: string; recipientPublicKey: string; senderSecretKey: string }
  | { type: 'DECRYPT'; id: string; payload: string; senderPublicKey: string; recipientSecretKey: string }
  | { type: 'DECRYPT_AS_SENDER'; id: string; payload: string; recipientPublicKey: string; senderSecretKey: string };

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { type, id } = e.data;

  try {
    if (type === 'ENCRYPT') {
      const { text, recipientPublicKey, senderSecretKey } = e.data;
      const nonce = nacl.randomBytes(nacl.box.nonceLength);
      const msgBytes = textEncoder.encode(text);
      const paddedMsg = padMessage(msgBytes);
      const pk = decodeBase64(recipientPublicKey);
      const sk = decodeBase64(senderSecretKey);

      const encrypted = nacl.box(paddedMsg, nonce, pk, sk);
      const result = `${encodeBase64(nonce)}.${encodeBase64(encrypted)}`;

      self.postMessage({ type: 'ENCRYPT_SUCCESS', id, result });
    }
    else if (type === 'DECRYPT') {
      const { payload, senderPublicKey, recipientSecretKey } = e.data;
      const [nonceB64, ciphertextB64] = payload.split('.');

      if (!nonceB64 || !ciphertextB64) throw new Error("Invalid payload format");

      const nonce = decodeBase64(nonceB64);
      const ciphertext = decodeBase64(ciphertextB64);
      const pk = decodeBase64(senderPublicKey);
      const sk = decodeBase64(recipientSecretKey);

      const decrypted = nacl.box.open(ciphertext, nonce, pk, sk);
      if (!decrypted) throw new Error("Decryption returned null");

      const unpadded = unpadMessage(decrypted);
      const text = textDecoder.decode(unpadded);
      self.postMessage({ type: 'DECRYPT_SUCCESS', id, result: text });
    }
    else if (type === 'DECRYPT_AS_SENDER') {
      const { payload, recipientPublicKey, senderSecretKey } = e.data;
      const [nonceB64, ciphertextB64] = payload.split('.');

      if (!nonceB64 || !ciphertextB64) throw new Error("Invalid payload format");

      const nonce = decodeBase64(nonceB64);
      const ciphertext = decodeBase64(ciphertextB64);
      const pk = decodeBase64(recipientPublicKey);
      const sk = decodeBase64(senderSecretKey);

      const sharedKey = nacl.box.before(pk, sk);
      const decrypted = nacl.box.open.after(ciphertext, nonce, sharedKey);

      if (!decrypted) throw new Error("Decryption returned null");

      const unpadded = unpadMessage(decrypted);
      const text = textDecoder.decode(unpadded);
      self.postMessage({ type: 'DECRYPT_SUCCESS', id, result: text });
    }
  } catch (error) {
    self.postMessage({ type: 'ERROR', id, error: error.message });
  }
};
