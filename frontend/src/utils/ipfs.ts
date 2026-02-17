import { logger } from './logger';
import { IPFS_UPLOAD_RETRY_DELAY } from '../constants';
import { safeBackendFetch } from './api-client';

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
