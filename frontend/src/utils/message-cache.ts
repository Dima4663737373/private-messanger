/**
 * IndexedDB Message Cache
 *
 * Persists chat messages locally so they survive page reloads
 * and backend resets (Railway ephemeral filesystem wipes SQLite).
 *
 * Schema: one object store keyed by chatId, each entry holds Message[].
 */

import { Message } from '../types';
import { logger } from './logger';

const DB_NAME = 'ghost_msg_cache';
const DB_VERSION = 1;
const STORE = 'histories';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      logger.warn('[MsgCache] IndexedDB open failed:', req.error);
      reject(req.error);
    };
  });
  return dbPromise;
}

/**
 * Save messages for a single chat.
 */
export async function cacheMessages(chatId: string, messages: Message[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(messages, chatId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    logger.warn('[MsgCache] cacheMessages failed:', e);
  }
}

/**
 * Load messages for a single chat from cache.
 */
export async function getCachedMessages(chatId: string): Promise<Message[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(chatId);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

/**
 * Load ALL cached histories (for initial app startup).
 */
export async function getAllCachedHistories(): Promise<Record<string, Message[]>> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const result: Record<string, Message[]> = {};

    return new Promise((resolve) => {
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const chatId = cursor.key as string;
          const messages = cursor.value as Message[];
          if (Array.isArray(messages) && messages.length > 0) {
            result[chatId] = messages;
          }
          cursor.continue();
        } else {
          resolve(result);
        }
      };
      cursorReq.onerror = () => resolve({});
    });
  } catch {
    return {};
  }
}

/**
 * Save entire histories map at once (batch save).
 */
export async function cacheAllHistories(histories: Record<string, Message[]>): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const [chatId, messages] of Object.entries(histories)) {
      store.put(messages, chatId);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    logger.warn('[MsgCache] cacheAllHistories failed:', e);
  }
}

/**
 * Clear cached messages for one or all chats.
 */
export async function clearCachedMessages(chatId?: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    if (chatId) {
      tx.objectStore(STORE).delete(chatId);
    } else {
      tx.objectStore(STORE).clear();
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    logger.warn('[MsgCache] clearCachedMessages failed:', e);
  }
}
