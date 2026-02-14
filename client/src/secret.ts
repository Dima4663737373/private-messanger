import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';
import { hashForAleo } from './crypto';

export interface SecretPayload {
  payload: string;       // encrypted (base64)
  ephemeralPk: string;   // one-time public key (base64)
  nonce: string;         // nonce (base64)
  aleoHash: string;      // hash for on-chain registration
}

/**
 * Create a one-time secret message.
 *
 * 1. Generate ephemeral (one-time) key pair
 * 2. Encrypt plaintext with NaCl box (ephemeral secret + recipient public)
 * 3. Compute Aleo-compatible hash of the plaintext
 * 4. Return encrypted payload + ephemeral public key + hash
 *
 * The ephemeral secret key is discarded — only the recipient can decrypt.
 */
export function createSecretMessage(
  plaintext: string,
  recipientPublicKey: string
): SecretPayload {
  // 1. Ephemeral keypair — used once, then thrown away
  const ephemeral = nacl.box.keyPair();

  // 2. Encrypt
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageBytes = decodeUTF8(plaintext);
  const recipientPk = decodeBase64(recipientPublicKey);

  const encrypted = nacl.box(messageBytes, nonce, recipientPk, ephemeral.secretKey);
  if (!encrypted) throw new Error('Secret encryption failed');

  // 3. Hash for Aleo registration
  const aleoHash = hashForAleo(plaintext);

  // Ephemeral secret key is NOT stored or returned — truly one-time
  return {
    payload: encodeBase64(encrypted),
    ephemeralPk: encodeBase64(ephemeral.publicKey),
    nonce: encodeBase64(nonce),
    aleoHash,
  };
}

/**
 * Decrypt a one-time secret message.
 *
 * Uses the recipient's secret key + the ephemeral public key from the sender.
 */
export function readSecretMessage(
  payload: string,
  nonce: string,
  ephemeralPk: string,
  recipientSecretKey: string
): string {
  const encrypted = decodeBase64(payload);
  const nonceBytes = decodeBase64(nonce);
  const pk = decodeBase64(ephemeralPk);
  const sk = decodeBase64(recipientSecretKey);

  const decrypted = nacl.box.open(encrypted, nonceBytes, pk, sk);
  if (!decrypted) throw new Error('Secret decryption failed — message may have been tampered with');

  return encodeUTF8(decrypted);
}

/**
 * Verify an Aleo hash against plaintext.
 * Client-side verification (compare computed hash with registered hash).
 */
export function verifySecretHash(plaintext: string, expectedHash: string): boolean {
  return hashForAleo(plaintext) === expectedHash;
}
