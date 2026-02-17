/**
 * Message Cache — IndexedDB-backed persistence for decrypted messages.
 *
 * Stores decrypted message text keyed by message ID so that
 * page refreshes don't require re-decryption of every message.
 * The cache has a TTL and maximum size to bound storage usage.
 */

import { logger } from './logger';

const DB_NAME = 'ghost_message_cache';
const DB_VERSION = 1;
const STORE_NAME = 'messages';
const MAX_CACHE_SIZE = 5000;
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CachedMessage {
  id: string;
  text: string;
  timestamp: number;
  cachedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('cachedAt', 'cachedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Cache a decrypted message text
 */
export async function cacheMessage(id: string, text: string, timestamp: number): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Evict oldest entries if at capacity
    const count = await new Promise<number>((resolve) => {
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });

    if (count >= MAX_CACHE_SIZE) {
      // Delete oldest 10% to avoid evicting on every write
      const deleteCount = Math.ceil(MAX_CACHE_SIZE * 0.1);
      const cursor = store.index('cachedAt').openCursor();
      let deleted = 0;
      await new Promise<void>((resolve) => {
        cursor.onsuccess = () => {
          if (cursor.result && deleted < deleteCount) {
            cursor.result.delete();
            deleted++;
            cursor.result.continue();
          } else {
            resolve();
          }
        };
        cursor.onerror = () => resolve();
      });
    }

    const entry: CachedMessage = { id, text, timestamp, cachedAt: Date.now() };
    store.put(entry);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
  } catch (e) {
    logger.error('[MessageCache] Failed to cache message:', e);
  }
}

/**
 * Batch-cache multiple messages at once
 */
export async function cacheMessages(messages: Array<{ id: string; text: string; timestamp: number }>): Promise<void> {
  if (messages.length === 0) return;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const now = Date.now();

    for (const msg of messages) {
      store.put({ id: msg.id, text: msg.text, timestamp: msg.timestamp, cachedAt: now });
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
  } catch (e) {
    logger.error('[MessageCache] Batch cache failed:', e);
  }
}

/**
 * Retrieve a cached decrypted message by ID
 */
export async function getCachedMessage(id: string): Promise<string | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const entry = await new Promise<CachedMessage | undefined>((resolve) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });

    db.close();

    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.cachedAt > CACHE_TTL) return null;

    return entry.text;
  } catch (e) {
    logger.error('[MessageCache] Failed to get cached message:', e);
    return null;
  }
}

/**
 * Batch-retrieve cached messages by IDs.
 * Returns a Map of id -> decrypted text (only for found + non-expired entries).
 */
export async function getCachedMessages(ids: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (ids.length === 0) return result;

  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const now = Date.now();

    await Promise.all(ids.map(id =>
      new Promise<void>((resolve) => {
        const req = store.get(id);
        req.onsuccess = () => {
          const entry = req.result as CachedMessage | undefined;
          if (entry && (now - entry.cachedAt) < CACHE_TTL) {
            result.set(id, entry.text);
          }
          resolve();
        };
        req.onerror = () => resolve();
      })
    ));

    db.close();
  } catch (e) {
    logger.error('[MessageCache] Batch get failed:', e);
  }

  return result;
}

/**
 * Remove a specific cached message (e.g. after deletion)
 */
export async function removeCachedMessage(id: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    logger.error('[MessageCache] Failed to remove cached message:', e);
  }
}

/**
 * Clear all cached messages for a specific dialog (by checking all messages)
 */
export async function clearCache(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    logger.debug('[MessageCache] Cache cleared');
  } catch (e) {
    logger.error('[MessageCache] Failed to clear cache:', e);
  }
}

/**
 * Clean up expired entries (run periodically)
 */
export async function pruneExpired(): Promise<number> {
  let pruned = 0;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const cutoff = Date.now() - CACHE_TTL;

    const cursor = store.index('cachedAt').openCursor(IDBKeyRange.upperBound(cutoff));
    await new Promise<void>((resolve) => {
      cursor.onsuccess = () => {
        if (cursor.result) {
          cursor.result.delete();
          pruned++;
          cursor.result.continue();
        } else {
          resolve();
        }
      };
      cursor.onerror = () => resolve();
    });

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    db.close();
    if (pruned > 0) logger.debug(`[MessageCache] Pruned ${pruned} expired entries`);
  } catch (e) {
    logger.error('[MessageCache] Prune failed:', e);
  }
  return pruned;
}
