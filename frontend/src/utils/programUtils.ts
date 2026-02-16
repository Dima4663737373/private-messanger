// Utility functions for checking program deployment status

import { API_CONFIG } from '../config';
import { ALEO_RPC_ENDPOINTS, ALEO_EXPLORER_URLS } from '../constants';
import { getErrorMessage } from './errors';

export const PROGRAM_ID = API_CONFIG.PROGRAM_ID;

// Provable API v2 endpoint (recommended)
const PROVABLE_API_V2 = "https://api.explorer.provable.com/v2";
// Fallback endpoints
const RPC_ENDPOINTS = [
    { base: API_CONFIG.EXPLORER_BASE, paths: [`/testnet3/program/${PROGRAM_ID}`, `/program/${PROGRAM_ID}`] },
    ...ALEO_RPC_ENDPOINTS.map(base => ({
        base,
        paths: [`/testnet3/program/${PROGRAM_ID}`, `/program/${PROGRAM_ID}`]
    })),
    { base: "https://vm.aleo.org/api", paths: [`/testnet3/program/${PROGRAM_ID}`, `/program/${PROGRAM_ID}`] }
];

export interface ProgramStatus {
    exists: boolean;
    source?: string;
    url?: string;
    error?: string;
}

/**
 * Check if program exists on Provable API v2 (recommended)
 */
export async function checkProgramExistsV2(): Promise<ProgramStatus> {
    try {
        const url = `${PROVABLE_API_V2}/programs/${PROGRAM_ID}`;
        const res = await fetch(url);
        
        if (res.ok) {
            const data = await res.json();
            return {
                exists: true,
                source: data.program || data.source || JSON.stringify(data),
                url: url
            };
        } else if (res.status === 404) {
            return {
                exists: false,
                error: `Program not found (404)`
            };
        } else {
            return {
                exists: false,
                error: `HTTP ${res.status}: ${res.statusText}`
            };
        }
    } catch (error) {
        return {
            exists: false,
            error: getErrorMessage(error)
        };
    }
}

/**
 * Check if program exists on any RPC endpoint (fallback)
 */
export async function checkProgramExistsFallback(): Promise<ProgramStatus> {
    for (const rpc of RPC_ENDPOINTS) {
        for (const path of rpc.paths) {
            try {
                const url = `${rpc.base}${path}`;
                const res = await fetch(url);
                
                if (res.ok) {
                    const content = await res.text();
                    return {
                        exists: true,
                        source: content,
                        url: url
                    };
                }
            } catch (error) {
                // Continue to next endpoint
                continue;
            }
        }
    }
    
    return {
        exists: false,
        error: "Program not found on any RPC endpoint"
    };
}

/**
 * Check if program exists (tries v2 first, then fallback)
 */
export async function checkProgramExists(): Promise<ProgramStatus> {
    // Try Provable API v2 first (recommended)
    const v2Result = await checkProgramExistsV2();
    if (v2Result.exists) {
        return v2Result;
    }
    
    // Fallback to other endpoints
    return await checkProgramExistsFallback();
}

/**
 * Get AleoScan URL for program
 */
export function getAleoScanUrl(): string {
    return `${ALEO_EXPLORER_URLS.testnet}/program/${PROGRAM_ID}`;
}
