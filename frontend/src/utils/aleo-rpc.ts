// Utility functions for checking program existence via public RPC endpoints
// Bypasses wallet's RPC endpoints which may not have indexed the program yet

import { PROGRAM_ID } from '../deployed_program';
import { logger } from './logger';

const PUBLIC_RPC_ENDPOINTS = [
  'https://api.explorer.aleo.org/v1',
  'https://vm.aleo.org/api',
  'https://api.explorer.provable.com/v1',
  'https://api.explorer.provable.com/v2',
];

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
  // Try endpoints in order (aleo.org first as it's most reliable)
  const endpointsToTry = [
    'https://api.explorer.aleo.org/v1',
    'https://vm.aleo.org/api',
    'https://api.explorer.provable.com/v1',
    'https://api.explorer.provable.com/v2',
  ];

  for (const endpoint of endpointsToTry) {
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
 * Gets mapping value via public RPC
 */
export async function getMappingValue(
  programId: string,
  mappingName: string,
  key: string
): Promise<any> {
  for (const endpoint of PUBLIC_RPC_ENDPOINTS) {
    try {
      const paths = [
        `/testnet3/program/${programId}/mapping/${mappingName}/${key}`,
        `/program/${programId}/mapping/${mappingName}/${key}`,
        `/testnet/program/${programId}/mapping/${mappingName}/${key}`,
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
            return data;
          }
        } catch (pathError) {
          continue;
        }
      }
    } catch (error) {
      logger.debug(`RPC ${endpoint} failed:`, error);
      continue;
    }
  }

  throw new Error(`Mapping value not found: ${mappingName}/${key}`);
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
