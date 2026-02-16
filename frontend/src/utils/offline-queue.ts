/**
 * Offline Message Queue — IndexedDB-backed queue for unsent messages.
 *
 * When WebSocket is disconnected, messages are queued locally.
 * On reconnection, queued messages are flushed in order.
 */

import { logger } from './logger';
import {
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  MAX_OFFLINE_QUEUE_SIZE,
  OFFLINE_QUEUE_TTL
} from '../constants';

export interface QueuedMessage {
  id: string;
  type: 'dm' | 'room';
  recipientAddress?: string;
  roomId?: string;
  text: string;
  encryptedPayload?: string;
  encryptedPayloadSelf?: string;
  senderHash?: string;
  recipientHash?: string;
  dialogHash?: string;
  timestamp: number;
  replyToId?: string;
  replyToText?: string;
  replyToSender?: string;
  attachmentCID?: string;
}

const STORE_NAME = 'pending_messages';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Add a message to the offline queue
 */
export async function enqueueMessage(msg: QueuedMessage): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Check queue size limit
    const count = await new Promise<number>((resolve) => {
      const countReq = store.count();
      countReq.onsuccess = () => resolve(countReq.result);
      countReq.onerror = () => resolve(0);
    });

    if (count >= MAX_OFFLINE_QUEUE_SIZE) {
      logger.warn(`[OfflineQueue] Queue full (${count}/${MAX_OFFLINE_QUEUE_SIZE}), dropping oldest`);
      // Remove oldest message
      const cursor = store.index('timestamp').openCursor();
      await new Promise<void>((resolve) => {
        cursor.onsuccess = () => {
          if (cursor.result) {
            cursor.result.delete();
          }
          resolve();
        };
        cursor.onerror = () => resolve();
      });
    }

    store.put(msg);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
    logger.debug(`[OfflineQueue] Message queued: ${msg.id}`);
  } catch (e) {
    logger.error('[OfflineQueue] Failed to enqueue message:', e);
  }
}

/**
 * Get all queued messages (sorted by timestamp)
 */
export async function getQueuedMessages(): Promise<QueuedMessage[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');

    const messages = await new Promise<QueuedMessage[]>((resolve) => {
      const req = index.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    db.close();

    // Filter out expired messages
    const now = Date.now();
    return messages.filter(m => (now - m.timestamp) < OFFLINE_QUEUE_TTL);
  } catch (e) {
    logger.error('[OfflineQueue] Failed to get queued messages:', e);
    return [];
  }
}

/**
 * Remove a message from the queue (after successful send)
 */
export async function dequeueMessage(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
    logger.debug(`[OfflineQueue] Message dequeued: ${id}`);
  } catch (e) {
    logger.error('[OfflineQueue] Failed to dequeue message:', e);
  }
}

/**
 * Clear all queued messages
 */
export async function clearQueue(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
    logger.debug('[OfflineQueue] Queue cleared');
  } catch (e) {
    logger.error('[OfflineQueue] Failed to clear queue:', e);
  }
}

/**
 * Get queue size
 */
export async function getQueueSize(): Promise<number> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const count = await new Promise<number>((resolve) => {
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });

    db.close();
    return count;
  } catch {
    return 0;
  }
}
