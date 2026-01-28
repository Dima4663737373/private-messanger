// Contract hook with bypass logic for wallet's program check
// Uses public RPC endpoints to verify program existence before creating transactions

import { useState } from 'react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import { WalletAdapterNetwork } from '@demox-labs/aleo-wallet-adapter-base';
import { PROGRAM_ID } from '../deployed_program';
import { TRANSACTION_FEE } from '../utils/constants';
import { checkProgramExists, waitForProgram } from '../utils/aleo-rpc';
import { requestTransactionWithRetry } from '../utils/walletUtils';
import { isRealTransactionId, isWalletUuid, getRealTransactionId, getTransactionExplorerUrl } from '../utils/transactionUtils';
import { logger } from '../utils/logger';

export interface ExecuteTransactionOptions {
  skipProgramCheck?: boolean;
  maxRetries?: number;
  waitForIndexing?: boolean;
  maxWaitAttempts?: number;
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
      // Step 1: Check program via public RPC
      if (!options.skipProgramCheck) {
        logger.debug('Checking program on public RPC...');
        const programInfo = await checkProgramExists(PROGRAM_ID);

        if (!programInfo.exists) {
          if (options.waitForIndexing) {
            // If program not found, wait
            logger.debug('Program not found on RPC, waiting...');
            const maxAttempts = options.maxWaitAttempts || 5;
            const found = await waitForProgram(PROGRAM_ID, maxAttempts, 10000);

            if (!found) {
              throw new Error(
                'Program not indexed yet. Please try again in 5-10 minutes.'
              );
            }
          } else {
            // Just warn but continue
            console.warn('⚠️ Program not found on public RPC, but continuing anyway...');
          }
        } else {
          logger.debug('Program found on public RPC:', programInfo.url);
        }
      }

      // Step 2: Create transaction
      logger.debug('Creating transaction...');

      const transaction = {
        address: String(publicKey),
        chainId: network,
        fee: TRANSACTION_FEE,
        transitions: [
          {
            program: String(PROGRAM_ID),
            functionName: functionName,
            inputs: inputs,
          }
        ]
      };

      // Validate inputs
      if (transaction.transitions[0].inputs.some((inp: string) => 
        inp.includes("NaN") || inp === "undefined" || inp === "null")) {
        throw new Error(`Invalid inputs detected: ${JSON.stringify(transaction.transitions[0].inputs)}`);
      }

      // Attempt 1: Standard method with retry
      try {
        const maxRetries = options.maxRetries || 1;
        const txResponse = await requestTransactionWithRetry(adapter, transaction, {
          timeout: 30000,
          maxRetries: maxRetries,
        });

        logger.debug('Transaction response:', txResponse);
        
        // Check if this is real TX ID or wallet UUID
        if (isRealTransactionId(txResponse)) {
          logger.debug('Real transaction ID received:', txResponse);
          const explorerUrl = getTransactionExplorerUrl(txResponse, 'testnet');
          if (explorerUrl) {
            logger.debug('View transaction:', explorerUrl);
          }
          return txResponse;
        }
        
        if (isWalletUuid(txResponse)) {
          logger.debug('Wallet UUID received:', txResponse);
          console.log('💡 IMPORTANT: Check your wallet extension for a popup to approve the transaction.');
          console.log('💡 If no popup appears, wallet may have rejected the transaction silently.');
          
          // Wait for real TX ID (shorter timeout, because if popup didn't appear, it won't appear)
          logger.debug('Attempting to get real transaction ID...');
          logger.debug('Waiting up to 10 seconds for wallet to broadcast...');
          
          const realTxId = await getRealTransactionId(
            wallet,
            txResponse,
            10, // 10 attempts (10 seconds) - if popup didn't appear, it won't appear
            1000 // 1 second between attempts
          );
          
          if (realTxId) {
            logger.debug('Real transaction ID obtained:', realTxId);
            const explorerUrl = getTransactionExplorerUrl(realTxId, 'testnet');
            if (explorerUrl) {
              logger.debug('View transaction in explorer:', explorerUrl);
            }
            return realTxId;
          } else {
            // If real TX ID not obtained, this means:
            // 1. Popup didn't appear (wallet rejected transaction BEFORE signing)
            // 2. Wallet RPC hasn't indexed the program
            console.warn('⚠️ Could not get real TX ID after 10 attempts');
            console.warn('⚠️ This means wallet rejected the transaction BEFORE showing popup.');
            console.warn('⚠️ Wallet RPC endpoints have not indexed the program yet.');
            console.warn('⚠️ UUID:', txResponse);
            console.warn('⚠️ Program exists on public RPC:', `https://api.explorer.aleo.org/v1/testnet/program/${PROGRAM_ID}`);
            console.warn('⚠️ But wallet uses different RPC endpoints that may not have indexed it yet.');
            
            // Check if program exists on public RPC
            const programInfo = await checkProgramExists(PROGRAM_ID);
            
            if (programInfo.exists) {
              throw new Error(
                `Transaction created (UUID: ${txResponse.slice(0, 8)}...) but wallet rejected it before showing popup. ` +
                `Program ${PROGRAM_ID} exists on public RPC (${programInfo.url}) but wallet's RPC endpoints haven't indexed it yet. ` +
                `\n\nThis is a known issue with Aleo testnet - wallet uses different RPC than public explorers. ` +
                `\n\nSolution: Wait 5-10 minutes for wallet RPC to index the program, then try again. ` +
                `\n\nAlternatively, check your wallet extension for any pending transactions.`
              );
            } else {
              throw new Error(
                `Transaction created (UUID: ${txResponse.slice(0, 8)}...) but program ${PROGRAM_ID} not found on any RPC endpoint. ` +
                `Please verify the program is deployed.`
              );
            }
          }
        }
        
        // If not UUID and not real TX ID, return as is
        console.warn('⚠️ Unknown transaction ID format:', txResponse);
        return txResponse;

      } catch (walletError: any) {
        const errorMsg = walletError?.message || String(walletError);
        const errorCode = walletError?.code || '';
        const errorData = walletError?.data || '';
        
        console.error('❌ Wallet transaction failed:', {
          message: errorMsg,
          code: errorCode,
          data: errorData,
          fullError: walletError,
        });
        
        // If error occurred after receiving UUID, this means transaction was rejected
        if (errorMsg.includes('INVALID_PARAMS') && errorMsg.includes('UUID')) {
          console.error('❌ Transaction was created but rejected by wallet');
          console.error('❌ Wallet RPC endpoints have not indexed the program yet');
          console.error('❌ This is a known issue - wallet uses different RPC than public explorers');
        }

        // Detailed handling of INVALID_PARAMS error
        if (errorMsg.includes('INVALID_PARAMS') || errorCode === 'INVALID_PARAMS') {
          console.error('❌ INVALID_PARAMS Error Details:');
          console.error('  - Program:', PROGRAM_ID);
          console.error('  - Function:', functionName);
          console.error('  - Inputs:', JSON.stringify(inputs, null, 2));
          console.error('  - Inputs Count:', inputs.length);
          console.error('  - Expected: 4 parameters (recipient: address, amount: u64, message: field, timestamp: u64)');
          
          // Check if program exists
          const programInfo = await checkProgramExists(PROGRAM_ID);
          
          if (programInfo.exists) {
            // Program exists but parameters are invalid
            throw new Error(
              `INVALID_PARAMS: Transaction parameters are invalid. ` +
              `Program ${PROGRAM_ID} exists but wallet rejected the transaction. ` +
              `Please check:\n` +
              `1. Recipient address format (must be aleo1...)\n` +
              `2. Amount format (must be numberu64)\n` +
              `3. Message format (must be numberfield)\n` +
              `4. Timestamp format (must be numberu64, in seconds not milliseconds)\n` +
              `\nReceived inputs: ${JSON.stringify(inputs)}`
            );
          } else {
            // Program not found
            throw new Error(
              `Program ${PROGRAM_ID} not found on any RPC endpoint. ` +
              `Please verify the program is deployed.`
            );
          }
        }
        
        // Handle "program not found" error
        if (errorMsg.includes('program not found') || 
            errorMsg.includes('does not exist')) {
          
          // Check again via public RPC
          const programInfo = await checkProgramExists(PROGRAM_ID);
          
          if (programInfo.exists) {
            // Program exists on public RPC but wallet doesn't see it
            throw new Error(
              `Program ${PROGRAM_ID} is deployed but wallet's RPC endpoints haven't indexed it yet. ` +
              `This usually takes 5-10 minutes after deployment. ` +
              `Program confirmed at: ${programInfo.url || 'public RPC'}`
            );
          } else {
            // Program not found even on public RPC
            throw new Error(
              `Program ${PROGRAM_ID} not found on any RPC endpoint. ` +
              `Please verify the program is deployed.`
            );
          }
        }

        // Other errors just throw further
        throw walletError;
      }

    } catch (err: any) {
      console.error('❌ Transaction failed:', err);
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
      console.error('❌ Transaction Failed');
      console.error('Error Message:', err.message);
      console.error('Error Code:', err.code);
      console.error('Error Stack:', err.stack);
      console.error('Full Error:', err);
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
