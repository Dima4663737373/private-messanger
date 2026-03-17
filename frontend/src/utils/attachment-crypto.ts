/**
 * Attachment encryption helpers — isolated from ipfs.ts to avoid circular deps.
 *
 * Flow:
 *   1. encryptFileForIPFSAsync(file) → { encryptedBlob, fileKey, fileNonce }
 *   2. Upload encryptedBlob to IPFS as opaque bytes (only ciphertext on IPFS)
 *   3. Embed fileKey + fileNonce inside the E2E-encrypted message payload
 *   4. Recipient: decryptIPFSBlob(blob, fileKey, fileNonce) → original bytes
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

/**
 * Encrypt file bytes with NaCl secretbox before uploading to IPFS.
 * Returns the encrypted Blob and the key+nonce needed to decrypt later.
 */
export async function encryptFileForIPFSAsync(
  file: File,
): Promise<{ encryptedBlob: Blob; fileKey: string; fileNonce: string }> {
  const key = nacl.randomBytes(32);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const encrypted = nacl.secretbox(fileBytes, nonce, key);
  return {
    encryptedBlob: new Blob([encrypted], { type: 'application/octet-stream' }),
    fileKey: encodeBase64(key),
    fileNonce: encodeBase64(nonce),
  };
}

/**
 * Decrypt a downloaded IPFS blob using the file key and nonce embedded in the message.
 * Returns the original file bytes, or null if decryption fails.
 */
export async function decryptIPFSBlob(
  blob: Blob,
  fileKey: string,
  fileNonce: string,
): Promise<Uint8Array | null> {
  try {
    const key = decodeBase64(fileKey);
    const nonce = decodeBase64(fileNonce);
    const encrypted = new Uint8Array(await blob.arrayBuffer());
    return nacl.secretbox.open(encrypted, nonce, key);
  } catch {
    return null;
  }
}
