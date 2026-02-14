// Utility functions for checking program existence via public RPC endpoints
// Bypasses wallet's RPC endpoints which may not have indexed the program yet

import { PROGRAM_ID } from '../deployed_program';
import { logger } from './logger';
import { aleoSafeFetchMapping } from './safe-fetch';
import { API_CONFIG } from '../config';

const API_BASE = API_CONFIG.EXPLORER_BASE;

export interface ProgramInfo {
  exists: boolean;
  program: string | null;
  source?: string;
  url?: string;
}

/**
 * Checks if program exists via public RPC endpoints
 */
export async function checkProgramExists(
  programId: string = PROGRAM_ID
): Promise<ProgramInfo> {
  // Try configured endpoint first, then fallbacks
  const endpointsToTry = [
    API_BASE,
    'https://api.explorer.aleo.org/v1',
    'https://vm.aleo.org/api',
    'https://api.explorer.provable.com/v1',
    'https://api.explorer.provable.com/v2',
  ];

  // Deduplicate endpoints
  const uniqueEndpoints = [...new Set(endpointsToTry)];

  for (const endpoint of uniqueEndpoints) {
    try {
      // Try different path formats
      const paths = [
        `/testnet/program/${programId}`,  // Try testnet first (most common)
        `/testnet3/program/${programId}`,
        `/program/${programId}`,
      ];

      for (const path of paths) {
        try {
          const url = `${endpoint}${path}`;
          const response = await fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          });

          if (response.ok) {
            const data = await response.json();
            const source = typeof data === 'string' ? data : (data.program || data.source || JSON.stringify(data));
            return {
              exists: true,
              program: programId,
              source: source,
              url: url,
            };
          }
          // 404 is expected for some endpoints, silently continue
          if (response.status === 404) {
            continue; // Try next path/endpoint
          }
        } catch (pathError: any) {
          // Silently continue on network errors (404s are expected)
          continue;
        }
      }
    } catch (error: any) {
      // Only log unexpected errors (not 404s)
      if (error?.message && !error.message.includes('404')) {
        logger.debug(`RPC ${endpoint} failed:`, error);
      }
      continue;
    }
  }

  return { exists: false, program: null };
}

/**
 * Gets mapping value via public RPC using safe fetch
 */
export async function getMappingValue(
  programId: string,
  mappingName: string,
  key: string
): Promise<any | null> {
  try {
    const result = await aleoSafeFetchMapping(programId, mappingName, key);
    if (result.exists) {
        return result.value;
    }
    return null;
  } catch (error) {
    logger.error(`Failed to get mapping value for ${programId}/${mappingName}/${key}`, error);
    // Even on error, we might want to return null to avoid crashing UI, 
    // but safe-fetch should have handled retries.
    // If it threw, it's serious.
    return null;
  }
}

/**
 * Waits for program to appear on RPC (with timeout)
 */
export async function waitForProgram(
  programId: string = PROGRAM_ID,
  maxAttempts: number = 30,
  delayMs: number = 10000
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    logger.debug(`Checking program (attempt ${i + 1}/${maxAttempts})...`);
    
    const info = await checkProgramExists(programId);
    if (info.exists) {
      logger.debug('Program found on RPC!');
      return true;
    }

    if (i < maxAttempts - 1) {
      logger.debug(`Waiting ${delayMs / 1000}s before next check...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return false;
}

/**
 * Gets account public balance (credits.aleo)
 */
export async function getAccountBalance(address: string): Promise<number> {
  try {
    // Use safe fetch directly or via getMappingValue
    const balanceVal = await getMappingValue('credits.aleo', 'account', address);
    
    if (!balanceVal) {
        // 404 or null means zero balance/not initialized
        logger.debug(`Mapping not initialized (404) for ${address}, returning 0`);
        return 0;
    }

    // Balance is usually returned as u64 string e.g. "1000000u64"
    if (typeof balanceVal === 'string') {
        return parseInt(balanceVal.replace('u64', '')) / 1000000;
    }
    
    // Handle case where it might be returned as number or other format
    if (typeof balanceVal === 'number') {
        return balanceVal / 1000000;
    }

    return 0;
  } catch (e) {
    logger.debug('Failed to get balance:', e);
    return 0;
  }
}
