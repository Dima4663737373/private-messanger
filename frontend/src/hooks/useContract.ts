// Contract hook — transaction logic aligned with tipzo (same fee 10_000, shape, requestTransactionWithRetry, return txId as-is)

import { useState } from 'react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import { WalletAdapterNetwork } from '@demox-labs/aleo-wallet-adapter-base';
import { PROGRAM_ID } from '../deployed_program';
import { TRANSACTION_FEE } from '../utils/constants';
import { requestTransactionWithRetry } from '../utils/walletUtils';
import { logger } from '../utils/logger';

export interface ExecuteTransactionOptions {
  maxRetries?: number;
}

export function useContract() {
  const { wallet, publicKey } = useWallet();
  const adapter = wallet?.adapter as any;
  const network = WalletAdapterNetwork.TestnetBeta;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Creates transaction with program check bypass
   */
  const executeTransaction = async (
    functionName: string,
    inputs: string[],
    options: ExecuteTransactionOptions = {}
  ) => {
    if (!wallet || !publicKey || !adapter) {
      throw new Error('Wallet not connected');
    }

    setLoading(true);
    setError(null);

    try {
      const transaction = {
        address: String(publicKey),
        chainId: network,
        fee: TRANSACTION_FEE,
        feePrivate: false,
        transitions: [
          {
            program: String(PROGRAM_ID),
            functionName: functionName,
            inputs: inputs,
          }
        ]
      };

      if (transaction.transitions[0].inputs.some((inp: string) =>
        inp.includes("NaN") || inp === "undefined" || inp === "null")) {
        throw new Error(`Invalid inputs detected: ${JSON.stringify(transaction.transitions[0].inputs)}`);
      }

      const txId = await requestTransactionWithRetry(adapter, transaction, {
        timeout: 30000,
        maxRetries: options.maxRetries ?? 3,
      });

      logger.debug('Transaction response:', txId);
      return txId;
    } catch (err: any) {
      const errorMsg = err?.message || 'Transaction failed';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Sends message
   */
  const sendMessage = async (
    recipient: string,
    amount: number,
    message: string,
    timestamp: number,
    options?: ExecuteTransactionOptions
  ) => {
    logger.group('🚀 Sending Message Transaction');
    
    try {
      // Step 1: Clean and validate parameters
      const cleanRecipient = recipient.trim().replace(/['"]/g, '');
      
      // Check recipient format
      if (!cleanRecipient.startsWith('aleo1')) {
        throw new Error(`Invalid recipient format: ${cleanRecipient}. Must start with "aleo1"`);
      }
      
      // Check timestamp (must be in seconds)
      if (!Number.isInteger(timestamp)) {
        throw new Error(`Invalid timestamp: ${timestamp}. Must be an integer`);
      }
      
      if (timestamp > 10000000000) {
        console.warn('⚠️ Warning: Timestamp seems to be in milliseconds, converting to seconds...');
        timestamp = Math.floor(timestamp / 1000);
      }
      
      // Check amount
      if (!Number.isInteger(amount) || amount < 0) {
        throw new Error(`Invalid amount: ${amount}. Must be a non-negative integer`);
      }
      
      // Check message field format
      if (!message || !message.endsWith('field')) {
        throw new Error(`Invalid message format: ${message}. Must end with "field"`);
      }
      
      // Form parameters
      const recipientParam = cleanRecipient;
      const amountParam = `${amount}u64`;
      const messageParam = message; // Already formatted as field
      const timestampParam = `${timestamp}u64`;
      
      const inputs = [
        recipientParam,
        amountParam,
        messageParam,
        timestampParam,
      ];
      
      logger.debug('Input Parameters:', {
        recipient: recipientParam,
        amount: amountParam,
        message: messageParam,
        timestamp: timestampParam,
        timestampDate: new Date(timestamp * 1000).toISOString(),
      });
      
      logger.debug('Formatted Inputs:', inputs);
      logger.debug('Inputs Count:', inputs.length);
      logger.debug('Inputs Types:', [
        `[0] address: ${recipientParam}`,
        `[1] u64: ${amountParam}`,
        `[2] field: ${messageParam}`,
        `[3] u64: ${timestampParam}`,
      ]);
      
      // Check for invalid values
      if (inputs.some((inp: string) => 
        inp.includes("NaN") || inp === "undefined" || inp === "null" || inp === "")) {
        throw new Error(`Invalid inputs detected: ${JSON.stringify(inputs)}`);
      }
      
      logger.debug('All parameters validated');
      logger.debug('Requesting transaction from wallet...');
      
      // Call executeTransaction
      const txId = await executeTransaction(
        'send_message',
        inputs,
        options
      );
      
      logger.debug('Transaction Created:', txId);
      logger.groupEnd();
      
      return txId;
      
    } catch (err: any) {
      logger.groupEnd();
      throw err;
    }
  };

  /**
   * Creates profile
   */
  const createProfile = async (
    name: string,
    bio: string,
    options?: ExecuteTransactionOptions
  ) => {
    return executeTransaction(
      'create_profile',
      [name, bio],
      options
    );
  };

  return {
    loading,
    error,
    sendMessage,
    createProfile,
    executeTransaction,
  };
}
