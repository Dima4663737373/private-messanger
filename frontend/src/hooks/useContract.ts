// Contract hook — transaction logic aligned with tipzo (fee 50000, feePrivate false, requestTransactionWithRetry, return txId as-is)

import { useState } from 'react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import { WalletAdapterNetwork } from '@demox-labs/aleo-wallet-adapter-base';
import { PROGRAM_ID } from '../deployed_program';
import { TRANSACTION_FEE } from '../utils/constants';
import { requestTransactionWithRetry } from '../utils/walletUtils';
import { logger } from '../utils/logger';
import { stringToFields } from '../utils/messageUtils';
import { hashAddress } from '../utils/aleo-utils';
import { encryptMessage } from '../utils/crypto';
import { getCachedKeys } from '../utils/key-derivation';
import { API_CONFIG } from '../config';
import { safeBackendFetch } from '../utils/api-client';

const BACKEND_URL = API_CONFIG.BACKEND_BASE;

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
      // Leo Wallet expects chainId as string; use explicit value to avoid INVALID_PARAMS
      const chainId = 'testnetbeta'; // Force 'testnetbeta' string
      const transaction = {
        address: typeof publicKey === 'string' ? publicKey : String(publicKey),
        chainId,
        fee: Number(TRANSACTION_FEE), // Ensure fee is sufficient
        feePrivate: false,
        transitions: [
          {
            program: String(PROGRAM_ID),
            functionName: String(functionName),
            inputs: inputs.map((x) => String(x)),
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
   * Registers profile (on-chain) — stores encryption key parts
   */
  const registerProfile = async (
    options?: ExecuteTransactionOptions
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    
    // Get encryption keys from session cache (derived from wallet signature)
    const keys = getCachedKeys(publicKey);
    if (!keys) throw new Error("Encryption keys not available. Please reconnect wallet.");
    
    // Split public key (base64) into two fields
    const keyFields = stringToFields(keys.publicKey, 2);
    
    const txId = await executeTransaction(
      'register_profile',
      [keyFields[0], keyFields[1]],
      options
    );

    // Push profile + Public Key to backend (for easier discovery by address)
    // Note: On-chain we only have hash->key. Backend helps map address->hash->key.
    // Uses safeBackendFetch for automatic auth token injection
    try {
        await safeBackendFetch('/profiles', {
            method: 'POST',
            body: {
                encryptionPublicKey: keys.publicKey,
                txId
            }
        });
    } catch (e) {
        logger.error("Failed to push profile metadata", e);
    }

    return txId;
  };

  /**
   * Helper to find a Message record by timestamp
   */
  const findRecordByTimestamp = async (timestamp: number): Promise<string | null> => {
      if (!adapter || !adapter.requestRecordPlaintexts) {
          logger.warn("Wallet adapter does not support requestRecordPlaintexts");
          return null;
      }
      try {
           const response = await adapter.requestRecordPlaintexts(PROGRAM_ID);
           if (response && response.records) {
               for (const rec of response.records) {
                   // Ensure it's a Message record
                   // The plaintext usually starts with "record Message {"
                   const plaintext = rec.plaintext || rec; // handle variations
                   if (typeof plaintext === 'string' && plaintext.includes("record Message")) {
                       const match = plaintext.match(/timestamp:\s*(\d+)u64/);
                       if (match && parseInt(match[1]) === timestamp) {
                           return plaintext;
                       }
                   }
               }
           }
      } catch (e) {
          logger.error("Failed to fetch records:", e);
      }
      return null;
  };

  /**
   * Deletes a message
   */
  const deleteMessage = async (timestamp: number, options?: ExecuteTransactionOptions) => {
      if (!publicKey) throw new Error("Wallet not connected");
      
      const record = await findRecordByTimestamp(timestamp);
      if (!record) {
          throw new Error("Message record not found in wallet. It may have already been spent or synced.");
      }

      // Contract expects only the Message record (no timestamp)
      const inputs = [
          record
      ];

      return await executeTransaction('delete_message', inputs, options);
  };

  /**
   * Edits a message
   */
  const editMessage = async (
      timestamp: number, 
      newText: string, 
      recipientAddress: string, 
      options?: ExecuteTransactionOptions
  ) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const record = await findRecordByTimestamp(timestamp);
      if (!record) {
          throw new Error("Message record not found in wallet.");
      }

      // Encrypt new text for Recipient
      // We need recipient's public key
      const senderKeys = getCachedKeys(publicKey);
      if (!senderKeys) throw new Error("Encryption keys not available.");
      let recipientPubKey = '';
      try {
        const { data } = await safeBackendFetch<any>(`/profiles/${recipientAddress}`);
        if (data?.profile?.encryption_public_key) {
           recipientPubKey = data.profile.encryption_public_key;
        }
      } catch (e) {
        logger.warn("Could not fetch recipient profile for encryption key");
      }

      if (!recipientPubKey) {
         throw new Error("Recipient public key not found");
      }

      const encryptedPayload = encryptMessage(newText, recipientPubKey, senderKeys.secretKey);

      // Convert encrypted payload to 4 fields (contract expects [field; 4])
      const newPayloadFields = stringToFields(encryptedPayload).slice(0, 4);
      while (newPayloadFields.length < 4) {
          newPayloadFields.push("0field");
      }
      const payloadInput = `[${newPayloadFields.join(',')}]`;

      const inputs = [
          record,
          payloadInput
      ];

      return await executeTransaction('update_message', inputs, options);
  };

  /**
   * Sends a message on-chain using pre-encrypted payload from off-chain flow.
   * This avoids double-encryption — reuses the payload already encrypted in sendDMMessage.
   */
  const sendMessageOnChain = async (
    recipientAddress: string,
    encryptedPayload: string,
    timestamp: number,
    attachmentCID?: string,
    options?: ExecuteTransactionOptions
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");

    const cleanRecipient = recipientAddress.trim().replace(/['"]/g, '');
    if (!cleanRecipient.startsWith('aleo1')) {
      throw new Error(`Invalid recipient format: ${cleanRecipient}`);
    }

    const senderHash = hashAddress(publicKey);
    const recipientHash = hashAddress(cleanRecipient);

    const messageFields = stringToFields(encryptedPayload).slice(0, 4);
    while (messageFields.length < 4) messageFields.push("0field");
    const payloadInput = `[${messageFields.join(',')}]`;

    const attachmentFields = attachmentCID
      ? stringToFields(attachmentCID, 2)
      : ["0field", "0field"];

    const inputs = [
      senderHash,
      recipientHash,
      cleanRecipient,
      payloadInput,
      `${timestamp}u64`,
      attachmentFields[0],
      attachmentFields[1]
    ];

    return await executeTransaction('send_message', inputs, options);
  };

  /**
   * Wallet proof-of-authorization — uses register_profile as an on-chain
   * proof that the wallet owner consciously approved a destructive action
   * (clear history, delete chat, etc.). The contract is @noupgrade, so
   * we reuse an existing idempotent transition.
   */
  const requestWalletProof = async (options?: ExecuteTransactionOptions) => {
    if (!publicKey) throw new Error("Wallet not connected");

    const keys = getCachedKeys(publicKey);
    if (!keys) throw new Error("Encryption keys not available. Please reconnect wallet.");

    const keyFields = stringToFields(keys.publicKey, 2);
    return await executeTransaction('register_profile', [keyFields[0], keyFields[1]], options);
  };

  return {
    loading,
    error,
    sendMessageOnChain,
    registerProfile,
    deleteMessage,
    editMessage,
    findRecordByTimestamp,
    executeTransaction,
    requestWalletProof,
  };
}
