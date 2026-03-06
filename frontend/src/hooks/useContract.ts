// Contract hook — Shield Wallet integration (executeTransaction from useWallet)

import { useState } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { PROGRAM_ID } from '../deployed_program';
import { TRANSACTION_FEE } from '../utils/constants';
import { logger } from '../utils/logger';
import { stringToFields } from '../utils/messageUtils';
import { hashAddress } from '../utils/aleo-utils';
import { encryptMessage } from '../utils/crypto';
import { getCachedKeys } from '../utils/key-derivation';
import { safeBackendFetch } from '../utils/api-client';

export interface ExecuteTransactionOptions {
  maxRetries?: number;
}

export function useContract() {
  const { address, connected, executeTransaction: walletExecuteTransaction, requestRecords, transactionStatus } = useWallet();
  const publicKey = address; // Alias for backward compatibility
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Poll Shield Wallet for the real on-chain transaction ID.
   * Shield returns a temporary `shield_*` ID; polling resolves to `at1...`.
   */
  const pollForOnChainTxId = async (tempTxId: string, maxPolls = 60): Promise<string> => {
    for (let i = 0; i < maxPolls; i++) {
      try {
        const resp = await transactionStatus(tempTxId);
        const status = resp.status?.toLowerCase() || '';
        logger.debug(`[TX Poll #${i + 1}] ${tempTxId} → ${status}`, resp);

        if (status === 'accepted' || status === 'finalized') {
          const onChainId = resp.transactionId || tempTxId;
          logger.debug(`[TX] On-chain TX: ${onChainId}`);
          return onChainId;
        }
        if (status === 'rejected' || status === 'failed') {
          throw new Error(resp.error || `Transaction ${status}`);
        }
      } catch (err: any) {
        // If polling itself fails (e.g. not supported), return temp ID after a few tries
        if (i >= 3 && !err.message?.includes('rejected') && !err.message?.includes('failed')) {
          logger.warn('[TX Poll] Polling not supported, returning temp ID');
          return tempTxId;
        }
      }
      await new Promise(r => setTimeout(r, 2000)); // 2s interval
    }
    logger.warn('[TX Poll] Timed out, returning temp ID');
    return tempTxId;
  };

  /**
   * Execute a transaction via Shield Wallet
   */
  const executeTransaction = async (
    functionName: string,
    inputs: string[],
    options: ExecuteTransactionOptions = {}
  ) => {
    if (!connected || !address) {
      throw new Error('Wallet not connected');
    }

    setLoading(true);
    setError(null);

    try {
      // Validate inputs
      if (inputs.some((inp: string) =>
        inp.includes("NaN") || inp === "undefined" || inp === "null")) {
        throw new Error(`Invalid inputs detected: ${JSON.stringify(inputs)}`);
      }

      const result = await walletExecuteTransaction({
        program: String(PROGRAM_ID),
        function: String(functionName),
        inputs: inputs.map((x) => String(x)),
        fee: Number(TRANSACTION_FEE),
        privateFee: false,
      });

      const tempTxId = result?.transactionId;
      if (!tempTxId) {
        throw new Error("Transaction was rejected or failed");
      }

      logger.debug(`[TX] ${functionName} submitted — temp: ${tempTxId}`);

      // Poll for real on-chain txId in background (don't block the return)
      pollForOnChainTxId(tempTxId).then(onChainId => {
        if (onChainId !== tempTxId) {
          logger.debug(`[TX] ${functionName} confirmed: ${onChainId}`);
        }
      }).catch(e => logger.warn(`[TX] ${functionName} polling failed:`, e));

      return tempTxId;
    } catch (err: any) {
      const errorMsg = err?.message || 'Transaction failed';
      logger.error(`[TX] ${functionName} failed — ${errorMsg}`);
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

    const keys = getCachedKeys(publicKey);
    if (!keys) throw new Error("Encryption keys not available. Please reconnect wallet.");

    const keyFields = stringToFields(keys.publicKey, 2);

    const txId = await executeTransaction(
      'register_profile',
      [keyFields[0], keyFields[1]],
      options
    );

    return txId;
  };

  /**
   * Helper to find a Message record by timestamp
   */
  const findRecordByTimestamp = async (timestamp: number): Promise<string | null> => {
      if (!requestRecords) {
          return null;
      }
      const programIds = [PROGRAM_ID];
      for (const pid of programIds) {
        try {
          const records = await requestRecords(pid);
          if (records) {
            for (const rec of records as any[]) {
              const plaintext = rec.plaintext || rec;
              if (typeof plaintext === 'string' && plaintext.includes("record Message")) {
                const match = plaintext.match(/timestamp:\s*(\d+)u64/);
                if (match && parseInt(match[1]) === timestamp) {
                  return plaintext;
                }
              }
            }
          }
        } catch {
          // Wallet may not recognize this program yet — skip silently
        }
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

      const inputs = [record];

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

      const newPayloadFields = stringToFields(encryptedPayload).slice(0, 4);
      while (newPayloadFields.length < 4) {
          newPayloadFields.push("0field");
      }
      const payloadInput = `[${newPayloadFields.join(',')}]`;

      const inputs = [record, payloadInput];

      return await executeTransaction('update_message', inputs, options);
  };

  /**
   * Sends a message on-chain using pre-encrypted payload from off-chain flow.
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
   * Updates profile (on-chain) — uses update_profile transition
   */
  const updateProfile = async (options?: ExecuteTransactionOptions) => {
    if (!publicKey) throw new Error("Wallet not connected");

    const keys = getCachedKeys(publicKey);
    if (!keys) throw new Error("Encryption keys not available. Please reconnect wallet.");

    const keyFields = stringToFields(keys.publicKey, 2);

    const txId = await executeTransaction(
      'update_profile',
      [keyFields[0], keyFields[1]],
      options
    );

    return txId;
  };

  /**
   * Clear chat history (on-chain proof)
   */
  const clearHistoryOnChain = async (
    recipientAddress: string,
    options?: ExecuteTransactionOptions
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");

    const recipientHash = hashAddress(recipientAddress);
    return await executeTransaction('clear_history', [recipientHash], options);
  };

  /**
   * Delete chat (on-chain proof)
   */
  const deleteChatOnChain = async (
    recipientAddress: string,
    options?: ExecuteTransactionOptions
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");

    const recipientHash = hashAddress(recipientAddress);
    return await executeTransaction('delete_chat', [recipientHash], options);
  };

  /**
   * Add contact on-chain (proof of action)
   */
  const addContactOnChain = async (
    contactAddress: string,
    options?: ExecuteTransactionOptions
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const contactHash = hashAddress(contactAddress);
    return await executeTransaction('add_contact', [contactHash], options);
  };

  /**
   * Update contact on-chain (proof of rename)
   */
  const updateContactOnChain = async (
    contactAddress: string,
    options?: ExecuteTransactionOptions
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const contactHash = hashAddress(contactAddress);
    return await executeTransaction('update_contact', [contactHash], options);
  };

  /**
   * Delete contact on-chain (proof of removal)
   */
  const deleteContactOnChain = async (
    contactAddress: string,
    options?: ExecuteTransactionOptions
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const contactHash = hashAddress(contactAddress);
    return await executeTransaction('delete_contact', [contactHash], options);
  };

  /**
   * Proof of message edit (no record needed — works for off-chain messages)
   */
  const editMessageProof = async (
    timestamp: number,
    options?: ExecuteTransactionOptions
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    return await executeTransaction('edit_message_proof', [`${timestamp}field`], options);
  };

  /**
   * Proof of message delete (no record needed — works for off-chain messages)
   */
  const deleteMessageProof = async (
    timestamp: number,
    options?: ExecuteTransactionOptions
  ) => {
    if (!publicKey) throw new Error("Wallet not connected");
    return await executeTransaction('delete_message_proof', [`${timestamp}field`], options);
  };

  return {
    loading,
    error,
    sendMessageOnChain,
    registerProfile,
    updateProfile,
    deleteMessage,
    editMessage,
    clearHistoryOnChain,
    deleteChatOnChain,
    addContactOnChain,
    updateContactOnChain,
    deleteContactOnChain,
    editMessageProof,
    deleteMessageProof,
    findRecordByTimestamp,
    executeTransaction,
  };
}
