// Wallet utilities with timeout and retry logic (from tipzo)

import { logger } from './logger';

const WALLET_TIMEOUT = 30000; // 30 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

export interface WalletCallOptions {
    timeout?: number;
    maxRetries?: number;
    retryDelay?: number;
    onRetry?: (attempt: number) => void;
}

/**
 * Execute a wallet operation with timeout and retry logic
 */
export async function withWalletTimeout<T>(
    operation: () => Promise<T>,
    options: WalletCallOptions = {}
): Promise<T> {
    const timeout = options.timeout || WALLET_TIMEOUT;
    const maxRetries = options.maxRetries || MAX_RETRIES;
    const retryDelay = options.retryDelay || RETRY_DELAY;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (options.onRetry && attempt > 1) {
                options.onRetry(attempt);
            }

            const startTime = Date.now();
            
            // Create a promise that rejects after timeout
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Wallet operation timed out after ${timeout}ms`));
                }, timeout);
            });

            // Race between operation and timeout
            const result = await Promise.race([operation(), timeoutPromise]);
            
            const duration = Date.now() - startTime;
            logger.debug(`[Wallet] Completed in ${(duration / 1000).toFixed(2)}s`);
            
            return result;
        } catch (error: any) {
            lastError = error;
            const errorMsg = error?.message || String(error);
            
            // Don't retry on user cancellation
            if (errorMsg.includes("User rejected") || errorMsg.includes("User cancelled") ||
                errorMsg.includes("cancel") || errorMsg.includes("reject") ||
                errorMsg.includes("denied") || error?.code === 4001) {
                throw error;
            }

            // Don't retry on invalid parameters (same as tipzo: throw original error)
            if (errorMsg.includes("INVALID_PARAMS") || errorMsg.includes("Some of the parameters you provided are invalid")) {
                throw error;
            }

            // If this was the last attempt, throw the error
            if (attempt === maxRetries) {
                throw new Error(`Wallet operation failed after ${maxRetries} attempts: ${errorMsg}`);
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }

    throw lastError || new Error("Wallet operation failed");
}

/**
 * Request transaction with timeout and retry
 */
export async function requestTransactionWithRetry(
    adapter: any,
    transaction: any,
    options: WalletCallOptions = {}
): Promise<string> {
    return withWalletTimeout(
        async () => {
            if (!adapter?.requestTransaction) {
                throw new Error("Wallet adapter does not support requestTransaction");
            }
            const txId = await adapter.requestTransaction(transaction);
            if (!txId) {
                throw new Error("Transaction was rejected or failed");
            }
            return txId;
        },
        {
            ...options,
            onRetry: (attempt) => {
                if (options.onRetry) {
                    options.onRetry(attempt);
                }
            }
        }
    );
}
