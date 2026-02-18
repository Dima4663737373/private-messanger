/**
 * Blockchain Sync Service
 *
 * Syncs messages from Aleo blockchain to rebuild IndexedDB.
 * Used for recovery when local storage is cleared.
 */

import { logger } from '../utils/logger';
import { indexedDBStorage, StoredMessage } from '../utils/indexeddb-storage';
import { hashAddress } from '../utils/aleo-utils';

const EXPLORER_API = 'https://api.explorer.provable.com/v1';
const PROGRAM_ID = 'ghost_msg_018.aleo';

export interface BlockchainMessage {
  transactionId: string;
  programId: string;
  functionName: string;
  senderHash: string;
  recipientHash: string;
  payload: string[]; // Array of 4 fields
  timestamp: number;
  attachmentPart1?: string;
  attachmentPart2?: string;
  blockHeight: number;
  blockTimestamp: number;
}

export interface BlockchainProfile {
  addressHash: string;
  encryptionKeyPart1: string;
  encryptionKeyPart2: string;
  blockHeight: number;
}

/**
 * Fetch program transitions from Aleo Explorer
 */
async function fetchProgramTransitions(
  programId: string,
  functionName?: string,
  page = 0,
  size = 100
): Promise<any[]> {
  try {
    const url = `${EXPLORER_API}/program/${programId}/transitions?page=${page}&size=${size}`;
    logger.debug(`[BlockchainSync] Fetching: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Explorer API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const transitions = data.transitions || [];

    // Filter by function name if provided
    if (functionName) {
      return transitions.filter((t: any) => t.function === functionName);
    }

    return transitions;
  } catch (error) {
    logger.error('[BlockchainSync] Failed to fetch transitions:', error);
    return [];
  }
}

/**
 * Parse send_message transition inputs
 */
function parseSendMessageTransition(transition: any): BlockchainMessage | null {
  try {
    if (transition.function !== 'send_message') return null;

    const inputs = transition.inputs || [];
    if (inputs.length < 7) {
      logger.warn('[BlockchainSync] Invalid send_message transition (missing inputs):', transition.id);
      return null;
    }

    // Inputs: [sender_hash, recipient_hash, recipient_addr, payload[4], timestamp, attachment_part1, attachment_part2]
    return {
      transactionId: transition.id,
      programId: transition.program,
      functionName: transition.function,
      senderHash: inputs[0]?.value || inputs[0],
      recipientHash: inputs[1]?.value || inputs[1],
      payload: Array.isArray(inputs[3]) ? inputs[3].map((p: any) => p.value || p) : [inputs[3]?.value || inputs[3]],
      timestamp: parseInt(inputs[4]?.value || inputs[4] || '0'),
      attachmentPart1: inputs[5]?.value || inputs[5],
      attachmentPart2: inputs[6]?.value || inputs[6],
      blockHeight: transition.block_height || 0,
      blockTimestamp: transition.timestamp || 0,
    };
  } catch (error) {
    logger.error('[BlockchainSync] Failed to parse transition:', error);
    return null;
  }
}

/**
 * Parse register_profile / update_profile transition
 */
function parseProfileTransition(transition: any): BlockchainProfile | null {
  try {
    if (transition.function !== 'register_profile' && transition.function !== 'update_profile') {
      return null;
    }

    const inputs = transition.inputs || [];
    if (inputs.length < 2) return null;

    // Derive sender hash from caller address (if available)
    let addressHash = '';
    if (transition.caller) {
      try {
        addressHash = hashAddress(transition.caller);
      } catch {
        addressHash = inputs[0]?.value || '';
      }
    }

    return {
      addressHash,
      encryptionKeyPart1: inputs[0]?.value || inputs[0],
      encryptionKeyPart2: inputs[1]?.value || inputs[1],
      blockHeight: transition.block_height || 0,
    };
  } catch (error) {
    logger.error('[BlockchainSync] Failed to parse profile transition:', error);
    return null;
  }
}

/**
 * Sync messages from blockchain for a specific user
 */
export async function syncMessagesFromBlockchain(
  userAddress: string,
  options: {
    maxPages?: number;
    onProgress?: (current: number, total: number) => void;
  } = {}
): Promise<BlockchainMessage[]> {
  try {
    const { maxPages = 10, onProgress } = options;
    const userHash = hashAddress(userAddress);
    logger.info(`[BlockchainSync] Syncing messages for ${userAddress.slice(0, 10)}... (hash: ${userHash.slice(0, 20)}...)`);

    const allMessages: BlockchainMessage[] = [];
    let page = 0;

    // Fetch multiple pages
    while (page < maxPages) {
      if (onProgress) onProgress(page + 1, maxPages);

      const transitions = await fetchProgramTransitions(PROGRAM_ID, 'send_message', page, 100);
      if (transitions.length === 0) break; // No more pages

      for (const transition of transitions) {
        const msg = parseSendMessageTransition(transition);
        if (!msg) continue;

        // Filter: only messages where user is sender OR recipient
        if (msg.senderHash === userHash || msg.recipientHash === userHash) {
          allMessages.push(msg);
        }
      }

      page++;
      if (transitions.length < 100) break; // Last page
    }

    logger.info(`[BlockchainSync] Found ${allMessages.length} messages on blockchain`);
    return allMessages;

  } catch (error) {
    logger.error('[BlockchainSync] Sync failed:', error);
    throw error;
  }
}

/**
 * Rebuild IndexedDB from blockchain (recovery mode)
 */
export async function rebuildFromBlockchain(
  userAddress: string,
  options: {
    onProgress?: (message: string) => void;
  } = {}
): Promise<{ messagesCount: number; contactsCount: number }> {
  try {
    const { onProgress } = options;

    onProgress?.('Scanning blockchain for messages...');
    logger.info('[BlockchainSync] Starting rebuild from blockchain...');

    // Sync messages
    const messages = await syncMessagesFromBlockchain(userAddress, {
      maxPages: 20,
      onProgress: (current, total) => {
        onProgress?.(`Scanning page ${current}/${total}...`);
      },
    });

    if (messages.length === 0) {
      logger.warn('[BlockchainSync] No messages found on blockchain');
      return { messagesCount: 0, contactsCount: 0 };
    }

    onProgress?.(`Processing ${messages.length} messages...`);

    // Group by dialog hash to extract contacts
    const dialogMap = new Map<string, { participants: Set<string>; lastTime: number }>();
    const userHash = hashAddress(userAddress);

    const storedMessages: StoredMessage[] = messages.map(msg => {
      // Compute dialog hash
      const dialogHash = msg.senderHash < msg.recipientHash
        ? `${msg.senderHash}_${msg.recipientHash}`
        : `${msg.recipientHash}_${msg.senderHash}`;

      // Track participants
      if (!dialogMap.has(dialogHash)) {
        dialogMap.set(dialogHash, {
          participants: new Set([msg.senderHash, msg.recipientHash]),
          lastTime: msg.timestamp,
        });
      } else {
        const dialog = dialogMap.get(dialogHash)!;
        dialog.lastTime = Math.max(dialog.lastTime, msg.timestamp);
      }

      // Determine sender/recipient addresses (will be resolved later from profiles)
      const isMine = msg.senderHash === userHash;
      const sender = isMine ? userAddress : `hash:${msg.senderHash}`;
      const recipient = isMine ? `hash:${msg.recipientHash}` : userAddress;

      return {
        id: msg.transactionId,
        dialogHash,
        sender,
        recipient,
        encryptedPayload: msg.payload.join(','), // Concatenate field array
        timestamp: msg.timestamp,
        status: 'sent' as const,
        // Note: encrypted text is not decryptable without encryption keys
      };
    });

    // Save messages to IndexedDB
    onProgress?.('Saving messages to IndexedDB...');
    await indexedDBStorage.saveMessages(storedMessages);
    logger.info(`[BlockchainSync] Saved ${storedMessages.length} messages to IndexedDB`);

    // Extract and save contacts
    onProgress?.('Extracting contacts...');
    const contacts = Array.from(dialogMap.entries()).map(([dialogHash, dialog]) => {
      // Find the other participant (not current user)
      const otherHash = Array.from(dialog.participants).find(h => h !== userHash);
      if (!otherHash) return null;

      return {
        address: `hash:${otherHash}`, // Placeholder until profile is resolved
        name: `User ${otherHash.slice(0, 10)}...`,
        dialogHash,
        lastMessageTime: dialog.lastTime,
      };
    }).filter(Boolean);

    for (const contact of contacts) {
      if (contact) {
        await indexedDBStorage.saveContact(contact);
      }
    }

    logger.info(`[BlockchainSync] Extracted ${contacts.length} contacts`);
    onProgress?.('Rebuild complete!');

    return {
      messagesCount: storedMessages.length,
      contactsCount: contacts.length,
    };

  } catch (error) {
    logger.error('[BlockchainSync] Rebuild failed:', error);
    throw error;
  }
}

/**
 * Verify message exists on blockchain (proof verification)
 */
export async function verifyMessageOnChain(transactionId: string): Promise<boolean> {
  try {
    const url = `${EXPLORER_API}/transaction/${transactionId}`;
    const response = await fetch(url);

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data.status === 'accepted' || data.status === 'finalized';

  } catch (error) {
    logger.error('[BlockchainSync] Verification failed:', error);
    return false;
  }
}

/**
 * Get blockchain sync status
 */
export async function getSyncStatus(userAddress: string): Promise<{
  lastScannedBlock: number;
  totalMessages: number;
  needsSync: boolean;
}> {
  try {
    // Check latest block on chain
    const latestBlockRes = await fetch(`${EXPLORER_API}/latest/block`);
    if (!latestBlockRes.ok) throw new Error('Failed to fetch latest block');

    const latestBlock = await latestBlockRes.json();
    const currentBlock = latestBlock.height || 0;

    // Check local IndexedDB
    const dialogs = await indexedDBStorage.getAllDialogs();
    const messages = await Promise.all(
      dialogs.map(d => indexedDBStorage.getDialogMessages(d.dialogHash, 1000))
    );
    const totalLocal = messages.reduce((sum, msgs) => sum + msgs.length, 0);

    // Simple heuristic: if local DB is empty and blockchain has activity, needs sync
    const needsSync = totalLocal === 0 && currentBlock > 0;

    return {
      lastScannedBlock: currentBlock,
      totalMessages: totalLocal,
      needsSync,
    };

  } catch (error) {
    logger.error('[BlockchainSync] Failed to get sync status:', error);
    return {
      lastScannedBlock: 0,
      totalMessages: 0,
      needsSync: false,
    };
  }
}
