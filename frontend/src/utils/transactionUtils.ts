// Utilities for checking transaction status and getting real TX ID

import { logger } from './logger';
import { ALEO_EXPLORER_URLS } from '../constants';

/** Wallet instance with optional transaction query methods */
interface WalletInstance {
  getTransaction?: (uuid: string) => Promise<{ transactionId?: string; id?: string }>;
  getTransactions?: () => Promise<Array<{ uuid?: string; id?: string; transactionUuid?: string; transactionId?: string; txId?: string }>>;
  adapter?: {
    getTransaction?: (uuid: string) => Promise<{ transactionId?: string }>;
  };
}

/**
 * Checks if this is real transaction ID (starts with at1)
 */
export function isRealTransactionId(txId: string): boolean {
  return txId && typeof txId === 'string' && txId.startsWith('at1');
}

/**
 * Checks if this is wallet UUID
 */
export function isWalletUuid(txId: string): boolean {
  if (!txId || typeof txId !== 'string') return false;
  // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(txId);
}

/**
 * Attempts to get real TX ID from wallet
 */
export async function getRealTransactionId(
  wallet: WalletInstance | null,
  transactionUuid: string,
  maxAttempts: number = 30,
  delayMs: number = 1000
): Promise<string | null> {
  // If this is already real TX ID, return it
  if (isRealTransactionId(transactionUuid)) {
    return transactionUuid;
  }

  // If this is not UUID, cannot check
  if (!isWalletUuid(transactionUuid)) {
    logger.warn('Transaction ID is neither UUID nor real TX ID:', transactionUuid);
    return null;
  }

  logger.debug(`Checking transaction status for UUID: ${transactionUuid}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Method 1: getTransaction (if available)
      if (wallet?.getTransaction && typeof wallet.getTransaction === 'function') {
        try {
          const txInfo = await wallet.getTransaction(transactionUuid);
          if (txInfo?.transactionId && isRealTransactionId(txInfo.transactionId)) {
            logger.debug(`Found real TX ID on attempt ${attempt}:`, txInfo.transactionId);
            return txInfo.transactionId;
          }
          if (txInfo?.id && isRealTransactionId(txInfo.id)) {
            logger.debug(`Found real TX ID (as id) on attempt ${attempt}:`, txInfo.id);
            return txInfo.id;
          }
        } catch (e) {
          // Method not supported, continue
        }
      }

      // Method 2: getTransactions (all transactions)
      if (wallet?.getTransactions && typeof wallet.getTransactions === 'function') {
        try {
          const transactions = await wallet.getTransactions();
          if (Array.isArray(transactions)) {
            const found = transactions.find((tx) => {
              const txUuid = tx.uuid || tx.id || tx.transactionUuid;
              return txUuid === transactionUuid;
            });

            if (found) {
              const realTxId = found.transactionId || found.id || found.txId;
              if (realTxId && isRealTransactionId(realTxId)) {
                logger.debug(`Found real TX ID in transactions list on attempt ${attempt}:`, realTxId);
                return realTxId;
              }
            }
          }
        } catch (e) {
          // Method not supported, continue
        }
      }

      // Method 3: Check via adapter (if available)
      const adapter = wallet?.adapter;
      if (adapter?.getTransaction && typeof adapter.getTransaction === 'function') {
        try {
          const txInfo = await adapter.getTransaction(transactionUuid);
          if (txInfo?.transactionId && isRealTransactionId(txInfo.transactionId)) {
            logger.debug(`Found real TX ID via adapter on attempt ${attempt}:`, txInfo.transactionId);
            return txInfo.transactionId;
          }
        } catch (e) {
          // Method not supported, continue
        }
      }

      // Wait before next attempt
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    } catch (error) {
      logger.debug(`Attempt ${attempt} failed:`, error);
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  logger.debug(`Could not find real TX ID after ${maxAttempts} attempts`);
  return null;
}

/**
 * Gets URL to view transaction in explorer
 */
export function getTransactionExplorerUrl(txId: string, network: 'testnet' | 'mainnet' = 'testnet'): string {
  if (!txId) return '';

  if (isRealTransactionId(txId)) {
    return `${ALEO_EXPLORER_URLS[network]}/transaction/${txId}`;
  }

  return '';
}
