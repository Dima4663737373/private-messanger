import { logger } from './logger';
import { API_CONFIG } from '../config';

const API_BASE = API_CONFIG.EXPLORER_BASE;

// Validate network configuration
if (API_BASE !== 'https://api.explorer.aleo.org/v1') {
  logger.warn(`Using custom Explorer API: ${API_BASE}`);
}

interface FetchOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

interface MappingResult<T = any> {
  exists: boolean;
  value: T | null;
}

/**
 * Safely fetches a mapping value from the Aleo Explorer API.
 * Handles 404s as "no record found" (returns null/zero) instead of throwing.
 * Retries on network errors.
 */
export async function aleoSafeFetchMapping(
  programId: string,
  mappingName: string,
  key: string,
  options: FetchOptions = {}
): Promise<MappingResult> {
  const {
    timeout = 5000,
    retries = 2,
    retryDelay = 1000
  } = options;

  // Try multiple paths as explorer APIs vary
  const paths = [
    // Standard Provable/Aleo paths
    `/testnet/program/${programId}/mapping/${mappingName}/${key}`,
    `/testnet3/program/${programId}/mapping/${mappingName}/${key}`,
    `/program/${programId}/mapping/${mappingName}/${key}`,
    // Fallback specific to some explorers
    `/v1/testnet/program/${programId}/mapping/${mappingName}/${key}`
  ];

  let lastError: Error | null = null;

  for (const path of paths) {
    const url = `${API_BASE}${path}`;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          return { exists: true, value: data };
        }

        if (response.status === 404) {
          // Valid case: Mapping does not exist yet
          logger.debug(`Mapping not found (404) for ${mappingName}/${key} at ${url}`);
          // If we hit a 404 on a valid endpoint, we can assume the record doesn't exist.
          // However, some endpoints might return 404 for the *route* not found vs *record* not found.
          // But generally for explorer APIs, 404 on a specific mapping key means "no value".
          // We'll continue to try other paths just in case the route is wrong, 
          // but if all fail with 404, we return exists: false.
          lastError = new Error(`404 Not Found`);
          break; // Don't retry this path on 404, move to next path or finish
        }

        if (response.status >= 500) {
          throw new Error(`Server Error ${response.status}`);
        }

        throw new Error(`HTTP Error ${response.status}`);

      } catch (error: any) {
        lastError = error;
        
        // Don't retry on 404 (logic handled above, but double check)
        if (error.message.includes('404')) {
            break;
        }

        const isNetworkError = error.name === 'AbortError' || error.message.includes('Failed to fetch');
        
        if (attempt < retries && isNetworkError) {
          logger.warn(`Network error fetching mapping (attempt ${attempt + 1}/${retries + 1}): ${error.message}`);
          await new Promise(r => setTimeout(r, retryDelay * (attempt + 1))); // Exponential backoff
          continue;
        }

        // If we're out of retries or it's a non-retryable error, log and move to next path
        if (attempt === retries) {
             logger.warn(`Failed to fetch from ${url}: ${error.message}`);
        }
      }
    }
    
    // If we found a value, we returned already.
    // If we got a 404, we break the inner loop and try the next path.
    // If we exhausted retries, we try the next path.
  }

  // If we've tried all paths and haven't returned, we assume it doesn't exist (or failed)
  // If the last error was 404, it's definitely "not found".
  // If it was network error, we technically failed, but for UI resilience we often prefer "not found" or 0 over crashing.
  // However, the requirement says "throw only on 5xx or network errors".
  
  // Refined logic: If we got 404s, return exists: false.
  // If we got ONLY network errors/500s, we should probably throw or return error state?
  // The user says: "return { exists:false, value:null }" for 404.
  
  if (lastError && lastError.message.includes('404')) {
      return { exists: false, value: null };
  }

  // If we really failed (e.g. all endpoints down), we might want to throw to indicate system failure
  // strictly following "throw only on 5xx or network errors"
  if (lastError) {
      logger.error(`All mapping fetch attempts failed. Last error: ${lastError.message}`);
      // For now, let's be safe and return null but log the error, 
      // unless we want to strictly follow the "throw" instruction.
      // "throw only on 5xx or network errors" -> okay, let's throw.
      throw lastError;
  }

  return { exists: false, value: null };
}
