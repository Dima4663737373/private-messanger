/**
 * IndexedDB Storage Service
 *
 * Persistent client-side storage for messages, contacts, and profiles.
 * Similar to alpaca-invoice's StorageService but optimized for messaging.
 *
 * Architecture:
 * - Primary storage: IndexedDB (survives browser restart)
 * - Backend: Sync point for cross-device messaging
 * - Blockchain: Immutable proof of conversations
 */

import { logger } from './logger';

const DB_NAME = 'ghost_messenger_db';
const DB_VERSION = 1;

// Store names
export const STORES = {
  MESSAGES: 'messages',
  CONTACTS: 'contacts',
  DIALOGS: 'dialogs',
  PROFILES: 'profiles',
  KEYS: 'keys', // Encryption keys backup (encrypted with passphrase)
} as const;

export interface StoredMessage {
  id: string;
  dialogHash: string;
  sender: string;
  recipient: string;
  encryptedPayload: string;
  encryptedPayloadSelf?: string;
  timestamp: number;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'confirmed' | 'failed' | 'included';
  decryptedText?: string; // Cached plaintext
  attachmentCid?: string;
  replyToId?: string;
  replyToText?: string;
  replyToSender?: string;
  editedAt?: number;
  editCount?: number;
  readAt?: number;
  reactions?: Record<string, string[]>; // emoji -> [addresses]
}

export interface StoredContact {
  address: string;
  name: string;
  dialogHash?: string;
  lastMessage?: string;
  lastMessageTime?: number;
  unreadCount?: number;
  encryptionPublicKey?: string;
  username?: string;
  avatarCid?: string;
  hideAvatar?: boolean;
}

export interface StoredDialog {
  dialogHash: string;
  participants: [string, string]; // [addr1, addr2]
  lastMessageId?: string;
  lastMessageTime?: number;
  unreadCount?: number;
  isPinned?: boolean;
  isMuted?: boolean;
}

export interface StoredProfile {
  address: string;
  username?: string;
  bio?: string;
  encryptionPublicKey: string;
  addressHash: string;
  avatarCid?: string;
  showAvatar?: boolean;
  showLastSeen?: boolean;
  lastSeen?: number;
  fetchedAt: number; // Cache timestamp
}

class IndexedDBStorage {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize database connection
   */
  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        logger.error('[IndexedDB] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        logger.info('[IndexedDB] Database opened successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        logger.info(`[IndexedDB] Upgrading database from version ${event.oldVersion} to ${event.newVersion}`);

        // Messages store: indexed by id, dialogHash, timestamp
        if (!db.objectStoreNames.contains(STORES.MESSAGES)) {
          const messagesStore = db.createObjectStore(STORES.MESSAGES, { keyPath: 'id' });
          messagesStore.createIndex('dialogHash', 'dialogHash', { unique: false });
          messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
          messagesStore.createIndex('sender', 'sender', { unique: false });
          messagesStore.createIndex('recipient', 'recipient', { unique: false });
          logger.info('[IndexedDB] Created messages store');
        }

        // Contacts store: indexed by address
        if (!db.objectStoreNames.contains(STORES.CONTACTS)) {
          const contactsStore = db.createObjectStore(STORES.CONTACTS, { keyPath: 'address' });
          contactsStore.createIndex('lastMessageTime', 'lastMessageTime', { unique: false });
          logger.info('[IndexedDB] Created contacts store');
        }

        // Dialogs store: indexed by dialogHash
        if (!db.objectStoreNames.contains(STORES.DIALOGS)) {
          const dialogsStore = db.createObjectStore(STORES.DIALOGS, { keyPath: 'dialogHash' });
          dialogsStore.createIndex('lastMessageTime', 'lastMessageTime', { unique: false });
          logger.info('[IndexedDB] Created dialogs store');
        }

        // Profiles store: indexed by address
        if (!db.objectStoreNames.contains(STORES.PROFILES)) {
          const profilesStore = db.createObjectStore(STORES.PROFILES, { keyPath: 'address' });
          profilesStore.createIndex('fetchedAt', 'fetchedAt', { unique: false });
          logger.info('[IndexedDB] Created profiles store');
        }

        // Keys store: encrypted backup of encryption keys
        if (!db.objectStoreNames.contains(STORES.KEYS)) {
          db.createObjectStore(STORES.KEYS, { keyPath: 'address' });
          logger.info('[IndexedDB] Created keys store');
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Save a single message
   */
  async saveMessage(message: StoredMessage): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.MESSAGES, 'readwrite');
      const store = tx.objectStore(STORES.MESSAGES);
      const request = store.put(message);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save multiple messages in a single transaction
   */
  async saveMessages(messages: StoredMessage[]): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.MESSAGES, 'readwrite');
      const store = tx.objectStore(STORES.MESSAGES);

      let completed = 0;
      const total = messages.length;

      messages.forEach((message) => {
        const request = store.put(message);
        request.onsuccess = () => {
          completed++;
          if (completed === total) resolve();
        };
        request.onerror = () => reject(request.error);
      });

      if (total === 0) resolve();
    });
  }

  /**
   * Get messages for a specific dialog
   */
  async getDialogMessages(dialogHash: string, limit = 100, offset = 0): Promise<StoredMessage[]> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.MESSAGES, 'readonly');
      const store = tx.objectStore(STORES.MESSAGES);
      const index = store.index('dialogHash');
      const request = index.getAll(IDBKeyRange.only(dialogHash));

      request.onsuccess = () => {
        const messages = request.result as StoredMessage[];
        // Sort by timestamp descending, apply pagination
        const sorted = messages.sort((a, b) => a.timestamp - b.timestamp);
        const paginated = sorted.slice(offset, offset + limit);
        resolve(paginated);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all dialogs (last message per dialog)
   */
  async getAllDialogs(): Promise<StoredDialog[]> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.DIALOGS, 'readonly');
      const store = tx.objectStore(STORES.DIALOGS);
      const request = store.getAll();

      request.onsuccess = () => {
        const dialogs = request.result as StoredDialog[];
        // Sort by last message time
        dialogs.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
        resolve(dialogs);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save/update dialog metadata
   */
  async saveDialog(dialog: StoredDialog): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.DIALOGS, 'readwrite');
      const store = tx.objectStore(STORES.DIALOGS);
      const request = store.put(dialog);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save/update contact
   */
  async saveContact(contact: StoredContact): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.CONTACTS, 'readwrite');
      const store = tx.objectStore(STORES.CONTACTS);
      const request = store.put(contact);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all contacts
   */
  async getAllContacts(): Promise<StoredContact[]> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.CONTACTS, 'readonly');
      const store = tx.objectStore(STORES.CONTACTS);
      const request = store.getAll();

      request.onsuccess = () => {
        const contacts = request.result as StoredContact[];
        // Sort by last message time
        contacts.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));
        resolve(contacts);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get a specific contact by address
   */
  async getContact(address: string): Promise<StoredContact | null> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.CONTACTS, 'readonly');
      const store = tx.objectStore(STORES.CONTACTS);
      const request = store.get(address);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save/update profile
   */
  async saveProfile(profile: StoredProfile): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.PROFILES, 'readwrite');
      const store = tx.objectStore(STORES.PROFILES);
      const request = store.put(profile);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get a profile by address
   */
  async getProfile(address: string): Promise<StoredProfile | null> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.PROFILES, 'readonly');
      const store = tx.objectStore(STORES.PROFILES);
      const request = store.get(address);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.MESSAGES, 'readwrite');
      const store = tx.objectStore(STORES.MESSAGES);
      const request = store.delete(messageId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete all messages in a dialog
   */
  async deleteDialogMessages(dialogHash: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORES.MESSAGES, 'readwrite');
      const store = tx.objectStore(STORES.MESSAGES);
      const index = store.index('dialogHash');
      const request = index.openCursor(IDBKeyRange.only(dialogHash));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all data (for testing or reset)
   */
  async clearAll(): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const stores = [STORES.MESSAGES, STORES.CONTACTS, STORES.DIALOGS, STORES.PROFILES];

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(stores, 'readwrite');

      stores.forEach((storeName) => {
        const store = tx.objectStore(storeName);
        store.clear();
      });

      tx.oncomplete = () => {
        logger.info('[IndexedDB] All data cleared');
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Get database size estimation
   */
  async getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage || 0,
        quota: estimate.quota || 0,
      };
    }
    return null;
  }
}

// Singleton instance
export const indexedDBStorage = new IndexedDBStorage();
