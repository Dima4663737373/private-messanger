import { logger } from './logger';

export async function uploadFileToIPFS(file: File): Promise<string> {
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
        logger.debug("File uploaded to Pinata, CID:", data.IpfsHash);
        return data.IpfsHash;
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
  await new Promise(resolve => setTimeout(resolve, 500));
  const mockCID = "Qm" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  return mockCID;
}

// Re-export from canonical location to avoid duplication
export { stringToFields, fieldsToString } from './messageUtils';
