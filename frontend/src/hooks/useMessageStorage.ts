/**
 * Message Storage Hook
 *
 * Integrates IndexedDB with the messaging system.
 * Messages flow: IndexedDB (instant) → Backend (sync) → Blockchain (proof)
 */

import { useEffect, useCallback, useRef } from 'react';
import { indexedDBStorage, StoredMessage, StoredContact, StoredDialog } from '../utils/indexeddb-storage';
import { Message } from '../types';
import { logger } from '../utils/logger';

export interface UseMessageStorageOptions {
  address: string | null;
  onMessagesLoaded?: (dialogHash: string, messages: Message[]) => void;
  onContactsLoaded?: (contacts: any[]) => void;
}

export function useMessageStorage({ address, onMessagesLoaded, onContactsLoaded }: UseMessageStorageOptions) {
  const initDone = useRef(false);

  /**
   * Initialize IndexedDB and load cached data
   */
  const initialize = useCallback(async () => {
    if (!address || initDone.current) return;

    try {
      logger.info('[MessageStorage] Initializing IndexedDB...');
      await indexedDBStorage.init();

      // Load contacts from IndexedDB
      const contacts = await indexedDBStorage.getAllContacts();
      logger.info(`[MessageStorage] Loaded ${contacts.length} contacts from IndexedDB`);

      if (contacts.length > 0 && onContactsLoaded) {
        // Convert StoredContact to Contact format
        const mappedContacts = contacts.map(c => ({
          id: c.address,
          name: c.name,
          address: c.address,
          dialogHash: c.dialogHash,
          lastMessage: c.lastMessage,
          lastMessageTime: c.lastMessageTime ? new Date(c.lastMessageTime) : undefined,
          unreadCount: c.unreadCount || 0,
          initials: c.username?.slice(0, 2).toUpperCase() || c.name.slice(0, 2).toUpperCase(),
          description: 'Stored contact',
          context: 'IndexedDB',
          hideAvatar: c.hideAvatar,
          avatarCid: c.avatarCid,
        }));
        onContactsLoaded(mappedContacts);
      }

      initDone.current = true;
      logger.info('[MessageStorage] Initialization complete');
    } catch (error) {
      logger.error('[MessageStorage] Initialization failed:', error);
    }
  }, [address, onContactsLoaded]);

  /**
   * Load messages for a specific dialog from IndexedDB
   */
  const loadDialogMessages = useCallback(async (dialogHash: string, limit = 100): Promise<Message[]> => {
    try {
      const stored = await indexedDBStorage.getDialogMessages(dialogHash, limit);

      // Convert StoredMessage to Message format
      const messages: Message[] = stored.map(msg => ({
        id: msg.id,
        text: msg.decryptedText || '[Encrypted]',
        time: new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: msg.timestamp,
        senderId: msg.sender === address ? 'me' : msg.sender,
        isMine: msg.sender === address,
        status: msg.status,
        readAt: msg.readAt,
        attachment: msg.attachmentCid ? {
          type: 'file' as const,
          cid: msg.attachmentCid,
          name: 'Attachment',
          size: 0,
        } : undefined,
        replyToId: msg.replyToId,
        replyToText: msg.replyToText,
        replyToSender: msg.replyToSender,
        edited: !!msg.editedAt,
        editedAt: msg.editedAt,
        editCount: msg.editCount,
        reactions: msg.reactions,
      }));

      return messages;
    } catch (error) {
      logger.error(`[MessageStorage] Failed to load messages for dialog ${dialogHash}:`, error);
      return [];
    }
  }, [address]);

  /**
   * Save a message to IndexedDB
   */
  const saveMessage = useCallback(async (message: Message & {
    dialogHash: string;
    sender: string;
    recipient: string;
    encryptedPayload: string;
    encryptedPayloadSelf?: string;
  }) => {
    try {
      const stored: StoredMessage = {
        id: message.id,
        dialogHash: message.dialogHash,
        sender: message.sender,
        recipient: message.recipient,
        encryptedPayload: message.encryptedPayload,
        encryptedPayloadSelf: message.encryptedPayloadSelf,
        timestamp: message.timestamp || Date.now(),
        status: message.status || 'sent',
        decryptedText: message.text,
        attachmentCid: message.attachment?.cid,
        replyToId: message.replyToId,
        replyToText: message.replyToText,
        replyToSender: message.replyToSender,
        editedAt: message.editedAt,
        editCount: message.editCount,
        readAt: message.readAt,
        reactions: message.reactions,
      };

      await indexedDBStorage.saveMessage(stored);
      logger.debug(`[MessageStorage] Saved message ${message.id.slice(0, 8)} to IndexedDB`);
    } catch (error) {
      logger.error('[MessageStorage] Failed to save message:', error);
    }
  }, []);

  /**
   * Save multiple messages in batch
   */
  const saveMessages = useCallback(async (messages: (Message & {
    dialogHash: string;
    sender: string;
    recipient: string;
    encryptedPayload: string;
    encryptedPayloadSelf?: string;
  })[]) => {
    try {
      const stored: StoredMessage[] = messages.map(msg => ({
        id: msg.id,
        dialogHash: msg.dialogHash,
        sender: msg.sender,
        recipient: msg.recipient,
        encryptedPayload: msg.encryptedPayload,
        encryptedPayloadSelf: msg.encryptedPayloadSelf,
        timestamp: msg.timestamp || Date.now(),
        status: msg.status || 'sent',
        decryptedText: msg.text,
        attachmentCid: msg.attachment?.cid,
        replyToId: msg.replyToId,
        replyToText: msg.replyToText,
        replyToSender: msg.replyToSender,
        editedAt: msg.editedAt,
        editCount: msg.editCount,
        readAt: msg.readAt,
        reactions: msg.reactions,
      }));

      await indexedDBStorage.saveMessages(stored);
      logger.debug(`[MessageStorage] Saved ${messages.length} messages to IndexedDB`);
    } catch (error) {
      logger.error('[MessageStorage] Failed to save messages:', error);
    }
  }, []);

  /**
   * Save/update contact
   */
  const saveContact = useCallback(async (contact: {
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
  }) => {
    try {
      const stored: StoredContact = {
        address: contact.address,
        name: contact.name,
        dialogHash: contact.dialogHash,
        lastMessage: contact.lastMessage,
        lastMessageTime: contact.lastMessageTime,
        unreadCount: contact.unreadCount,
        encryptionPublicKey: contact.encryptionPublicKey,
        username: contact.username,
        avatarCid: contact.avatarCid,
        hideAvatar: contact.hideAvatar,
      };

      await indexedDBStorage.saveContact(stored);
      logger.debug(`[MessageStorage] Saved contact ${contact.address.slice(0, 10)} to IndexedDB`);
    } catch (error) {
      logger.error('[MessageStorage] Failed to save contact:', error);
    }
  }, []);

  /**
   * Update dialog metadata
   */
  const updateDialog = useCallback(async (dialogHash: string, updates: {
    lastMessageId?: string;
    lastMessageTime?: number;
    unreadCount?: number;
    isPinned?: boolean;
    isMuted?: boolean;
  }) => {
    try {
      // Load existing dialog or create new
      const dialogs = await indexedDBStorage.getAllDialogs();
      const existing = dialogs.find(d => d.dialogHash === dialogHash);

      const dialog: StoredDialog = {
        dialogHash,
        participants: existing?.participants || ['', ''], // Will be set properly later
        lastMessageId: updates.lastMessageId || existing?.lastMessageId,
        lastMessageTime: updates.lastMessageTime || existing?.lastMessageTime,
        unreadCount: updates.unreadCount ?? existing?.unreadCount,
        isPinned: updates.isPinned ?? existing?.isPinned,
        isMuted: updates.isMuted ?? existing?.isMuted,
      };

      await indexedDBStorage.saveDialog(dialog);
      logger.debug(`[MessageStorage] Updated dialog ${dialogHash.slice(0, 16)}`);
    } catch (error) {
      logger.error('[MessageStorage] Failed to update dialog:', error);
    }
  }, []);

  /**
   * Delete a message
   */
  const deleteMessage = useCallback(async (messageId: string) => {
    try {
      await indexedDBStorage.deleteMessage(messageId);
      logger.debug(`[MessageStorage] Deleted message ${messageId.slice(0, 8)}`);
    } catch (error) {
      logger.error('[MessageStorage] Failed to delete message:', error);
    }
  }, []);

  /**
   * Clear all messages in a dialog
   */
  const clearDialog = useCallback(async (dialogHash: string) => {
    try {
      await indexedDBStorage.deleteDialogMessages(dialogHash);
      logger.info(`[MessageStorage] Cleared dialog ${dialogHash.slice(0, 16)}`);
    } catch (error) {
      logger.error('[MessageStorage] Failed to clear dialog:', error);
    }
  }, []);

  /**
   * Get storage usage statistics
   */
  const getStorageStats = useCallback(async () => {
    try {
      const estimate = await indexedDBStorage.getStorageEstimate();
      if (estimate) {
        const usageMB = (estimate.usage / 1024 / 1024).toFixed(2);
        const quotaMB = (estimate.quota / 1024 / 1024).toFixed(2);
        const percentUsed = ((estimate.usage / estimate.quota) * 100).toFixed(1);
        logger.info(`[MessageStorage] Storage: ${usageMB}MB / ${quotaMB}MB (${percentUsed}%)`);
        return { usageMB, quotaMB, percentUsed };
      }
      return null;
    } catch (error) {
      logger.error('[MessageStorage] Failed to get storage stats:', error);
      return null;
    }
  }, []);

  // Initialize on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  return {
    loadDialogMessages,
    saveMessage,
    saveMessages,
    saveContact,
    updateDialog,
    deleteMessage,
    clearDialog,
    getStorageStats,
  };
}
