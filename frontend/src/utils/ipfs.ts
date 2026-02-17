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

  // Mock Fallback (dev only — no Pinata JWT configured)
  if (!import.meta.env.DEV) {
    logger.warn("No VITE_PINATA_JWT configured. File upload unavailable in production.");
    throw new Error("File upload not configured. Set VITE_PINATA_JWT.");
  }

  logger.info("Mock IPFS Upload (dev):", file.name);
  await new Promise(resolve => setTimeout(resolve, IPFS_UPLOAD_RETRY_DELAY));
  const mockCID = "Qm" + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(36)).join('').slice(0, 26);
  return mockCID;
}

// Re-export from canonical location to avoid duplication
export { stringToFields, fieldsToString } from './messageUtils';
