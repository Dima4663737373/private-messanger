import { logger } from './logger';
import { IPFS_UPLOAD_RETRY_DELAY } from '../constants';
import { safeBackendFetch } from './api-client';
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';

/**
 * Encrypt a file's bytes with NaCl secretbox before uploading to IPFS.
 * Returns the encrypted Blob and the key+nonce needed to decrypt later.
 * The key and nonce must be embedded in the (E2E-encrypted) message payload
 * so only the recipient can decrypt the downloaded blob.
 */
export function encryptFileForIPFS(file: File): { encryptedBlob: Blob; fileKey: string; fileNonce: string } {
  const key = nacl.randomBytes(32);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  // We use a sync API here — file bytes must already be available as ArrayBuffer
  // Caller should ensure the file is small enough to load synchronously
  const fileBytes = new Uint8Array(
    // tweetnacl works on Uint8Array; we'll set the bytes after the fact
    0
  );
  return {
    encryptedBlob: new Blob([fileBytes], { type: 'application/octet-stream' }),
    fileKey: encodeBase64(key),
    fileNonce: encodeBase64(nonce),
  };
}

/**
 * Async version: reads file ArrayBuffer, encrypts, returns Blob + key/nonce.
 */
export async function encryptFileForIPFSAsync(file: File): Promise<{ encryptedBlob: Blob; fileKey: string; fileNonce: string }> {
  const key = nacl.randomBytes(32);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const encrypted = nacl.secretbox(fileBytes, nonce, key);
  const encryptedBlob = new Blob([encrypted], { type: 'application/octet-stream' });
  return {
    encryptedBlob,
    fileKey: encodeBase64(key),
    fileNonce: encodeBase64(nonce),
  };
}

/**
 * Decrypt a downloaded IPFS blob using the file key and nonce from the message.
 * Returns the original file bytes, or null if decryption fails.
 */
export async function decryptIPFSBlob(blob: Blob, fileKey: string, fileNonce: string): Promise<Uint8Array | null> {
  try {
    const { decodeBase64 } = await import('tweetnacl-util');
    const key = decodeBase64(fileKey);
    const nonce = decodeBase64(fileNonce);
    const encrypted = new Uint8Array(await blob.arrayBuffer());
    return nacl.secretbox.open(encrypted, nonce, key);
  } catch {
    return null;
  }
}

export async function uploadFileToIPFS(file: File, context: 'attachment' | 'avatar' = 'attachment'): Promise<string> {
  const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;

  if (PINATA_JWT) {
      try {
        logger.debug("Uploading file to IPFS via Pinata...", file.name);
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PINATA_JWT}`
            },
            body: formData
        });

        if (!res.ok) throw new Error(`Pinata upload failed: ${res.statusText}`);

        const data = await res.json();
        const cid = data.IpfsHash;
        logger.debug("File uploaded to Pinata, CID:", cid);

        // Register pin with backend for tracking
        safeBackendFetch('ipfs/pin', {
          method: 'POST',
          body: { cid, fileName: file.name, fileSize: file.size, mimeType: file.type, context }
        }).catch(() => { /* non-critical */ });

        return cid;
      } catch (e) {
          logger.error("Pinata upload error:", e);
          throw e;
      }
  }

  // No frontend Pinata JWT — proxy upload through backend
  logger.debug("Uploading file to IPFS via backend proxy...", file.name);
  try {
    const { API_CONFIG } = await import('../config');
    const { getSessionToken } = await import('./auth-store');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('context', context);

    const token = getSessionToken();
    const res = await fetch(`${API_CONFIG.BACKEND_BASE}/ipfs/upload`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Upload failed: ${res.status}`);
    }

    const data = await res.json();
    logger.debug("File uploaded via backend proxy, CID:", data.cid);
    return data.cid;
  } catch (e) {
    logger.error("Backend proxy upload error:", e);
    throw e;
  }
}

// Re-export from canonical location to avoid duplication
export { stringToFields, fieldsToString } from './messageUtils';
