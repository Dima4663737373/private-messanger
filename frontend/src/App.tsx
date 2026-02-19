
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { WalletProvider, useWallet } from "@demox-labs/aleo-wallet-adapter-react";
import { LeoWalletAdapter } from "@demox-labs/aleo-wallet-adapter-leo";
import { WalletAdapterNetwork, DecryptPermission } from "@demox-labs/aleo-wallet-adapter-base";
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import LandingPage from './components/LandingPage';
import Preloader from './components/Preloader';
import { AppView, Chat, Message, Contact, DisappearTimer, DISAPPEAR_TIMERS, Room, RoomType, ChatContextAction, AppNotification, PinnedMessage, NetworkProfile } from './types';
import { uploadFileToIPFS } from './utils/ipfs';
import { hashAddress } from './utils/aleo-utils';
import { getAccountBalance } from './utils/aleo-rpc';
import { logger } from './utils/logger';
import ContactsView from './components/ContactsView';
import SettingsView from './components/SettingsView';
import NotificationsView from './components/NotificationsView';
import { Toaster, toast } from 'react-hot-toast';
import { mapErrorToUserMessage, getErrorMessage } from './utils/errors';
import { useSync } from './hooks/useSync';
import { useContract } from './hooks/useContract';
import { usePreferences } from './hooks/usePreferences';
import { migrateLegacyPreferences } from './utils/migrate-localStorage';
import { setCachedKeys, clearKeyCache, getCachedKeys, clearSessionKeys } from './utils/key-derivation';
import { generateKeyPair } from './utils/crypto';
import { fetchPreferences, updatePreferences } from './utils/preferences-api';
import { safeBackendFetch } from './utils/api-client';
import { playNotificationSound } from './utils/notification-sound';
// lucide icons removed - FAB is now in Sidebar
import ProfileView from './components/ProfileView';
import { applyTheme } from './hooks/useSystemTheme';
import {
  ADDRESS_DISPLAY,
  MESSAGE_PREVIEW,
  MAX_FILE_SIZE,
  MAX_FILENAME_LENGTH,
  buildAvatarUrl
} from './constants';
import { useMessageStorage } from './hooks/useMessageStorage';
import { useXMTP } from './hooks/useXMTP';

const mapContactToChat = (contact: Contact, isActive: boolean): Chat => ({
  id: contact.id,
  name: contact.name,
  avatar: buildAvatarUrl(contact.name, contact.avatarCid, contact.hideAvatar),
  status: 'offline',
  lastMessage: contact.lastMessage || 'No messages yet',
  time: contact.lastMessageTime ? new Date(contact.lastMessageTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
  unreadCount: contact.unreadCount || 0,
  type: 'private',
  address: contact.address
});

const InnerApp: React.FC = () => {
  const { publicKey, wallet, signMessage, requestTransaction, disconnect, select, wallets } = useWallet();
  const { executeTransaction, sendMessageOnChain, registerProfile: registerProfileOnChain, updateProfile: updateProfileOnChain, deleteMessage: deleteMessageOnChain, editMessage: editMessageOnChain, clearHistoryOnChain, deleteChatOnChain, addContactOnChain, updateContactOnChain, deleteContactOnChain, editMessageProof, deleteMessageProof, loading: contractLoading } = useContract();

  // XMTP decentralized messaging (secondary transport, auto-initialized on wallet connect)
  const { isXmtpReady, xmtpError, xmtpIdentity, sendXmtpMessage } = useXMTP(publicKey ?? null);

  // User Preferences (replaces localStorage)
  const {
    pinnedChats: pinnedChatIds,
    mutedChats: mutedChatIds,
    deletedChats,
    savedContacts: backendSavedContacts,
    disappearTimers,
    blockedUsers,
    setDisappearTimers,
    setSavedContacts: setBackendSavedContacts,
    blockUser,
    unblockUser,
    togglePin,
    toggleMute,
    markChatDeleted,
    setDisappearTimer: setDisappearTimerApi,
    isLoaded: preferencesLoaded,
    settings: userSettings,
    updateSetting
  } = usePreferences(publicKey);

  // IndexedDB Storage (persistent message storage)
  const {
    loadDialogMessages: loadDialogMessagesFromIDB,
    saveMessage: saveMessageToIDB,
    saveContact: saveContactToIDB,
    updateDialog: updateDialogInIDB,
  } = useMessageStorage({
    address: publicKey,
    onContactsLoaded: (contacts) => {
      // Merge IndexedDB contacts with existing contacts on init
      setContacts(prev => {
        const combined = [...prev];
        contacts.forEach(idbContact => {
          const existing = combined.find(c => c.id === idbContact.id);
          if (!existing) {
            combined.push(idbContact);
          }
        });
        return combined;
      });
    }
  });

  // Apply theme to document root only when user manually changes chatTheme
  useEffect(() => {
    applyTheme((userSettings.chatTheme || 'light') as any);
  }, [userSettings.chatTheme]);

  // Derive encryption keys EARLY — before WS connects, so AUTH_CHALLENGE can be answered
  // Uses signMessage from useWallet() context for deterministic derivation (like alpaca-invoice)
  const [keysReady, setKeysReady] = useState(false);
  useEffect(() => {
    if (!publicKey || !wallet) return;
    if (getCachedKeys(publicKey)) { setKeysReady(true); return; }

    (async () => {
      try {
        const { getOrDeriveKeys } = await import('./utils/key-derivation');
        const keys = await getOrDeriveKeys(signMessage || undefined, publicKey);
        setCachedKeys(publicKey, keys);
        logger.debug('Encryption keys derived early (before WS)');
      } catch {
        const keys = generateKeyPair();
        setCachedKeys(publicKey, keys);
        logger.warn('Key derivation failed, using random session keys');
      }
      setKeysReady(true);
    })();
  }, [publicKey, wallet, signMessage]);

  // Contacts State — persisted to backend via savedContacts preference
  const [contacts, setContacts] = useState<Contact[]>([]);
  const sessionInitDone = useRef(false); // True after initSession completes (contacts populated)

  // Sync contacts to backend whenever they change (debounced via usePreferences)
  useEffect(() => {
    // Skip before preferences are loaded OR before initSession has populated contacts
    // This prevents saving [] to backend and wiping saved chats
    if (!publicKey || !preferencesLoaded || !sessionInitDone.current) return;

    const toSave = contacts.map(c => ({ address: c.address, name: c.name }));
    setBackendSavedContacts(toSave);
  }, [contacts, publicKey, preferencesLoaded, setBackendSavedContacts]);

  // Track processed message IDs for deduplication
  const processedMsgIds = useRef<Set<string>>(new Set());

  // Ref to access current settings inside memoized callbacks
  const settingsRef = useRef(userSettings);
  settingsRef.current = userSettings;
  const blockedUsersRef = useRef(blockedUsers);
  blockedUsersRef.current = blockedUsers;

  // Ref to access activeChatId and sendReadReceipt inside memoized handleNewMessage
  const activeChatIdRef = useRef<string | null>(null);
  const sendReadReceiptRef = useRef<(dialogHash: string, messageIds: string[]) => void>(() => {});

  // Parse URL hash to restore navigation state on page reload
  const parseHash = (): { chatId: string | null; roomId: string | null; view: AppView } => {
    const hash = window.location.hash.slice(1); // remove #
    if (hash.startsWith('chat/')) return { chatId: hash.slice(5), roomId: null, view: 'chats' };
    if (hash.startsWith('room/')) return { roomId: hash.slice(5), chatId: null, view: 'chats' };
    const viewMap: Record<string, AppView> = { channels: 'channels', groups: 'groups', settings: 'settings', contacts: 'contacts', notifications: 'notifications' };
    if (viewMap[hash]) return { chatId: null, roomId: null, view: viewMap[hash] };
    return { chatId: null, roomId: null, view: 'chats' };
  };
  const initialHash = useRef(parseHash());

  const [activeChatId, setActiveChatId] = useState<string | null>(initialHash.current.chatId);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [currentView, setCurrentView] = useState<AppView>(initialHash.current.view);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  // Data State
  const [chats, setChats] = useState<Chat[]>([]);
  const [histories, setHistories] = useState<Record<string, Message[]>>({});
  const [myProfile, setMyProfile] = useState<{username?: string, bio?: string} | null>(null);
  const [myAvatarCid, setMyAvatarCid] = useState<string | null>(null);
  const [viewingProfile, setViewingProfile] = useState<Contact | NetworkProfile | null>(null);

  // Room State (Channels & Groups)
  const [channels, setChannels] = useState<Room[]>([]);
  const [groups, setGroups] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(initialHash.current.roomId);
  const [roomHistories, setRoomHistories] = useState<Record<string, Message[]>>({});
  const [roomMembers, setRoomMembers] = useState<string[]>([]);

  // FAB Modal State
  const [fabModal, setFabModal] = useState<RoomType | null>(null);
  const [fabModalName, setFabModalName] = useState('');

  // New Message Modal State (for chats FAB)
  const [newMsgModal, setNewMsgModal] = useState(false);
  const [newMsgAddress, setNewMsgAddress] = useState('');
  const [newMsgName, setNewMsgName] = useState('');

  // Pins State (contextId -> pinned message objects)
  const [pinnedMessages, setPinnedMessages] = useState<Record<string, any[]>>({});

  // Notifications inbox
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const pushNotification = React.useCallback((type: AppNotification['type'], title: string, body: string, chatId?: string) => {
    const notif: AppNotification = {
      id: `notif_${Date.now()}_${Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(36)).join('').slice(0, ADDRESS_DISPLAY.SHORT_PREFIX)}`,
      type,
      title,
      body,
      timestamp: Date.now(),
      read: false,
      chatId,
    };
    setNotifications(prev => [notif, ...prev].slice(0, MESSAGE_PREVIEW.MAX_NOTIFICATIONS));
  }, []);

  // SYNC
  const handleNewMessage = React.useCallback((msg: Message & { recipient?: string, recipientHash?: string, dialogHash?: string, encryptedPayload?: string, encryptedPayloadSelf?: string }) => {
    // Determine counterparty
    let counterpartyAddress = msg.isMine ? msg.recipient : msg.senderId;

    // Handle 'unknown' recipient for sent messages — skip them (can't send on-chain)
    if (msg.isMine && (counterpartyAddress === 'unknown' || !counterpartyAddress)) {
         logger.warn('Skipping message with unknown recipient:', msg.recipientHash);
         return;
    }

    if (!counterpartyAddress) return;

    // Block filter: suppress incoming messages from blocked users (still saved server-side)
    if (!msg.isMine && blockedUsersRef.current.includes(counterpartyAddress)) {
      return;
    }

    const isDuplicate = processedMsgIds.current.has(msg.id);
    processedMsgIds.current.add(msg.id);
    // Silent flag: set for messages pushed on SUBSCRIBE (offline catch-up). No toasts/sounds.
    const isSilent = !!(msg as any)._silent;

    // Save to IndexedDB for persistence (with encrypted payloads)
    if (msg.dialogHash && msg.encryptedPayload && publicKey) {
      saveMessageToIDB({
        ...msg,
        dialogHash: msg.dialogHash,
        sender: msg.isMine ? publicKey : msg.senderId,
        recipient: msg.isMine ? (msg.recipient || counterpartyAddress) : publicKey,
        encryptedPayload: msg.encryptedPayload,
        encryptedPayloadSelf: msg.encryptedPayloadSelf,
      }).catch(err => logger.error('[IndexedDB] Failed to save message:', err));
    }

    // Toast & notification only for new real-time messages (not duplicates, not offline catch-up)
    if (!isDuplicate && !isSilent && settingsRef.current.notifEnabled) {
      toast(`New message ${msg.isMine ? 'sent' : 'received'}`, { icon: '📨' });

      // Play notification sound if enabled
      if (!msg.isMine && settingsRef.current.notifSound) {
        playNotificationSound();
      }

      // Push to notification center for incoming messages
      if (!msg.isMine) {
        const preview = settingsRef.current.notifPreview
          ? (msg.text.length > MESSAGE_PREVIEW.CHAT_LIST ? msg.text.slice(0, MESSAGE_PREVIEW.CHAT_LIST) + '...' : msg.text)
          : 'New encrypted message';
        pushNotification('message', 'New message', preview, counterpartyAddress);
      }

      // Browser Notification when tab is not focused
      if (!msg.isMine && document.hidden && Notification.permission === 'granted') {
        const body = settingsRef.current.notifPreview
          ? (msg.text.length > MESSAGE_PREVIEW.NOTIFICATION ? msg.text.slice(0, MESSAGE_PREVIEW.NOTIFICATION) + '...' : msg.text)
          : 'New encrypted message';
        new Notification('Ghost Messenger', {
          body,
          icon: '/ghost-icon.png',
          tag: msg.id
        });
      }
    }

    // Always update contact sidebar preview (even for duplicates — ensures lastMessage is set)
    setContacts(prevContacts => {
      // Try to find by address OR dialogHash
      const existingIndex = prevContacts.findIndex(c =>
          c.address === counterpartyAddress || (msg.dialogHash && c.dialogHash === msg.dialogHash)
      );

      if (existingIndex === -1) {
        // Create new contact
        const newContact: Contact = {
          id: counterpartyAddress,
          name: `User ${counterpartyAddress.slice(0, ADDRESS_DISPLAY.SHORT_PREFIX)}...`,
          address: counterpartyAddress,
          dialogHash: msg.dialogHash,
          description: 'Discovered from network',
          context: 'Network',
          initials: 'UK',
          unreadCount: (msg.isMine || isSilent) ? 0 : 1,
          lastMessage: msg.text,
          lastMessageTime: new Date()
        };
        // Save new contact to IndexedDB
        saveContactToIDB({
          address: counterpartyAddress,
          name: newContact.name,
          dialogHash: msg.dialogHash,
          lastMessage: msg.text,
          lastMessageTime: msg.timestamp || Date.now(),
          unreadCount: newContact.unreadCount
        }).catch(err => logger.error('[IndexedDB] Failed to save contact:', err));

        // Fetch profile for this new contact
        if (counterpartyAddress.startsWith('aleo1')) {
            syncProfile(counterpartyAddress).then(profile => {
                 if (profile) {
                     setContacts(curr => curr.map(c => c.id === counterpartyAddress ? {
                       ...c,
                       ...(profile.username ? { name: profile.username, initials: profile.username.slice(0,2).toUpperCase() } : {}),
                       hideAvatar: profile.show_avatar === false
                     } : c));
                 }
            }).catch(() => { /* profile fetch failed, non-critical */ });
        }
        return [...prevContacts, newContact];
      }

      // Update existing
      const updatedContacts = prevContacts.map((c, idx) => {
          if (idx === existingIndex) {
              const updated = {
                  ...c,
                  dialogHash: msg.dialogHash || c.dialogHash, // Ensure dialogHash is set
                  lastMessage: msg.text,
                  lastMessageTime: new Date(),
                  // Silent (offline catch-up) messages don't bump unread — user sees them in chat
                  unreadCount: (msg.isMine || isSilent) ? c.unreadCount : (c.unreadCount || 0) + 1
              };
              // Save updated contact to IndexedDB
              saveContactToIDB({
                address: updated.address || updated.id,
                name: updated.name,
                dialogHash: updated.dialogHash,
                lastMessage: updated.lastMessage,
                lastMessageTime: msg.timestamp || Date.now(),
                unreadCount: updated.unreadCount
              }).catch(err => logger.error('[IndexedDB] Failed to update contact:', err));
              return updated;
          }
          return c;
      });
      return updatedContacts;
    });

    // Use counterpartyAddress directly as contactId (matches contact.id we set above)
    const contactId = counterpartyAddress;

    setHistories(prev => {
       const current = prev[contactId] || [];

       // If message exists, update it (e.g. status change)
       const existingIndex = current.findIndex(m => m.id === msg.id);
       if (existingIndex !== -1) {
           const updatedList = [...current];
           updatedList[existingIndex] = { ...updatedList[existingIndex], ...msg };
           return { ...prev, [contactId]: updatedList };
       }

       // Send read receipt if this chat is currently active and message is from counterparty
       if (!msg.isMine && contactId === activeChatIdRef.current && settingsRef.current.readReceipts && msg.dialogHash) {
         sendReadReceiptRef.current(msg.dialogHash, [msg.id]);
       }

       return {
         ...prev,
         [contactId]: [...current, msg]
       };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Uses functional updates for state (no stale closures). syncProfile and pushNotification are stable.
  }, [pushNotification]);

  const handleMessageDeleted = React.useCallback((msgId: string) => {
      setHistories(prev => {
          const newHistories = { ...prev };
          for (const chatId in newHistories) {
              if (newHistories[chatId].some(m => m.id === msgId)) {
                  newHistories[chatId] = newHistories[chatId]
                    .filter(m => m.id !== msgId)
                    // Update reply quotes that reference the deleted message
                    .map(m => m.replyToId === msgId ? { ...m, replyToText: 'Message deleted' } : m);
                  break;
              }
          }
          return newHistories;
      });
  }, []);

  const handleMessageUpdated = React.useCallback((msgId: string, newText: string, editedAt?: number, editCount?: number) => {
      setHistories(prev => {
          const newHistories = { ...prev };
          for (const chatId in newHistories) {
              const idx = newHistories[chatId].findIndex(m => m.id === msgId);
              if (idx !== -1) {
                  const msgs = [...newHistories[chatId]];
                  msgs[idx] = { ...msgs[idx], text: newText, edited: true, editedAt, editCount };
                  // Update reply quotes that reference the edited message
                  for (let i = 0; i < msgs.length; i++) {
                    if (msgs[i].replyToId === msgId) {
                      msgs[i] = { ...msgs[i], replyToText: newText };
                    }
                  }
                  newHistories[chatId] = msgs;
                  break;
              }
          }
          return newHistories;
      });
  }, []);

  const handleReactionUpdate = React.useCallback((msgId: string, reactions: Record<string, string[]>) => {
      setHistories(prev => {
          const newHistories = { ...prev };
          for (const chatId in newHistories) {
              const idx = newHistories[chatId].findIndex(m => m.id === msgId);
              if (idx !== -1) {
                  const msgs = [...newHistories[chatId]];
                  msgs[idx] = { ...msgs[idx], reactions };
                  newHistories[chatId] = msgs;
                  break;
              }
          }
          return newHistories;
      });
  }, []);

  // Room callbacks
  const handleRoomMessage = React.useCallback((roomId: string, msg: Message) => {
    setRoomHistories(prev => {
      const current = prev[roomId] || [];
      if (current.some(m => m.id === msg.id)) return prev;
      return { ...prev, [roomId]: [...current, msg] };
    });
    // Update sidebar preview for channels/groups
    const updateRoom = (prev: Room[]) => prev.map(r =>
      r.id === roomId ? { ...r, lastMessage: msg.text, lastMessageTime: String(Date.now()) } : r
    );
    setChannels(updateRoom);
    setGroups(updateRoom);
  }, []);

  const handleRoomCreated = React.useCallback((room: Room) => {
    if (room.type === 'channel') {
      setChannels(prev => prev.some(r => r.id === room.id) ? prev : [...prev, room]);
    } else {
      setGroups(prev => prev.some(r => r.id === room.id) ? prev : [...prev, room]);
    }
  }, []);

  const handleRoomDeleted = React.useCallback((roomId: string) => {
    setChannels(prev => prev.filter(r => r.id !== roomId));
    setGroups(prev => prev.filter(r => r.id !== roomId));
    if (activeRoomId === roomId) setActiveRoomId(null);
    setRoomHistories(prev => {
      const next = { ...prev };
      delete next[roomId];
      return next;
    });
  }, [activeRoomId]);

  const handleDMCleared = React.useCallback((dialogHash: string) => {
    // Use contacts ref via functional update to avoid stale closure
    setContacts(currentContacts => {
      setHistories(prev => {
        const next = { ...prev };
        for (const chatId in next) {
          const contact = currentContacts.find(c => c.id === chatId);
          if (contact?.dialogHash === dialogHash) {
            next[chatId] = [];
            break;
          }
        }
        return next;
      });
      return currentContacts; // Don't modify contacts
    });
  }, []);

  const handlePinUpdate = React.useCallback((contextId: string, pins: PinnedMessage[]) => {
    setPinnedMessages(prev => ({ ...prev, [contextId]: pins }));
  }, []);

  const handleRoomMessageDeleted = React.useCallback((roomId: string, messageId: string) => {
    setRoomHistories(prev => {
      const msgs = prev[roomId];
      if (!msgs) return prev;
      return { ...prev, [roomId]: msgs.filter(m => m.id !== messageId) };
    });
  }, []);

  const handleRoomMessageEdited = React.useCallback((roomId: string, messageId: string, text: string) => {
    setRoomHistories(prev => {
      const msgs = prev[roomId];
      if (!msgs) return prev;
      return { ...prev, [roomId]: msgs.map(m => m.id === messageId ? { ...m, text, edited: true } : m) };
    });
  }, []);

  const handleDMSent = React.useCallback((tempId: string, realId: string, dialogHash?: string) => {
    // Replace tempId with real ID in all histories
    setHistories(prev => {
      const next = { ...prev };
      for (const chatId in next) {
        const msgs = next[chatId];
        const idx = msgs.findIndex(m => m.id === tempId);
        if (idx !== -1) {
          next[chatId] = msgs.map(m => m.id === tempId ? { ...m, id: realId, status: 'sent' as const } : m);
          // Mark realId as processed so handleNewMessage deduplicates
          processedMsgIds.current.add(realId);
          // Ensure dialogHash is set on the contact (critical for message loading)
          if (dialogHash) {
            setContacts(prev => prev.map(c =>
              c.id === chatId ? { ...c, dialogHash: dialogHash || c.dialogHash } : c
            ));
          }
          break;
        }
      }
      return next;
    });
  }, []);

  // Read receipt — mark our sent messages as "read" when counterparty reads them
  const handleReadReceipt = React.useCallback((dialogHash: string, messageIds: string[], readAt?: number) => {
    const readTime = readAt || Date.now();
    setHistories(prev => {
      let changed = false;
      const next = { ...prev };
      for (const chatId in next) {
        const msgs = next[chatId];
        const updated = msgs.map(m => {
          if (messageIds.includes(m.id) && m.isMine && m.status !== 'read') {
            changed = true;
            return { ...m, status: 'read' as const, readAt: readTime };
          }
          return m;
        });
        if (changed) next[chatId] = updated;
      }
      return changed ? next : prev;
    });
  }, []);

  // Profile updated — update contact name + avatar visibility in real-time when someone changes their profile
  const handleProfileUpdated = React.useCallback((addr: string, username?: string, showAvatar?: boolean, avatarCid?: string) => {
    setContacts(prev => prev.map(c => {
      if (c.address !== addr) return c;
      const updates: Partial<Contact> = {};
      if (username) { updates.name = username; updates.initials = username.slice(0, ADDRESS_DISPLAY.INITIALS).toUpperCase(); }
      if (typeof showAvatar === 'boolean') { updates.hideAvatar = !showAvatar; }
      if (avatarCid !== undefined) { updates.avatarCid = avatarCid || undefined; }
      return { ...c, ...updates };
    }));
  }, []);

  // Wait for encryption keys to be derived before connecting WS — prevents limited sessions on new devices
  const { isConnected: isSyncConnected, typingUsers, notifyProfileUpdate, searchProfiles, fetchMessages, fetchDialogs, fetchDialogMessages, syncProfile, cacheDecryptedMessage, sendTyping, sendReadReceipt, addReaction, removeReaction, fetchRooms, createRoom, deleteRoom: deleteRoomApi, renameRoom: renameRoomApi, joinRoom, leaveRoom, fetchRoomInfo, fetchRoomMessages, sendRoomMessage, subscribeRoom, sendRoomTyping, clearDMHistory, deleteRoomMessage, editRoomMessage, prepareDMMessage, commitDMMessage, sendDMMessage, deleteDMMessage, editDMMessage, fetchPins, pinMessage, unpinMessage, fetchOnlineStatus, fetchLinkPreview, blockedByUsers } = useSync(keysReady ? publicKey : null, handleNewMessage, handleMessageDeleted, handleMessageUpdated, handleReactionUpdate, handleRoomMessage, handleRoomCreated, handleRoomDeleted, handleDMCleared, handlePinUpdate, handleRoomMessageDeleted, handleRoomMessageEdited, handleDMSent, handleReadReceipt, handleProfileUpdated);

  // Keep refs in sync for use inside memoized callbacks
  activeChatIdRef.current = activeChatId;
  sendReadReceiptRef.current = sendReadReceipt;

  // Disappearing Messages — per-chat timer wrapper with toast notification
  const setDisappearTimer = (chatId: string, timer: DisappearTimer) => {
    setDisappearTimerApi(chatId, timer);
    toast.success(timer === 'off' ? 'Disappearing messages disabled' : `Messages will disappear after ${timer}`);
  };

  // Disappearing messages cleanup timer
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setHistories(prev => {
        try {
          let changed = false;
          const newHistories = { ...prev };
          for (const chatId in newHistories) {
            const msgs = newHistories[chatId];
            if (!Array.isArray(msgs)) continue;
            const timer = disappearTimers[chatId];
            if (!timer || timer === 'off') continue;
            const ttl = DISAPPEAR_TIMERS[timer];
            if (!ttl) continue;
            const filtered = msgs.filter(m => {
              if (!m.timestamp) return true;
              return now - m.timestamp < ttl;
            });
            if (filtered.length !== msgs.length) {
              newHistories[chatId] = filtered;
              changed = true;
            }
          }
          return changed ? newHistories : prev;
        } catch {
          return prev;
        }
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [disappearTimers]);

  // Sync initial messages & Profile
  useEffect(() => {
    if (!isSyncConnected || !publicKey || !preferencesLoaded) return;

    const initSession = async () => {
      // 0. Migrate legacy localStorage data (one-time, must complete before key load)
      try {
        await migrateLegacyPreferences(publicKey);
      } catch (err) {
        logger.error('Migration failed:', err);
      }

      // Keys are already derived early (before WS connects) — see keysReady effect above

      // 1. Register encryption public key in profile (required for key exchange)
      // MUST complete before sending/receiving — recipient needs our key to decrypt
      if (getCachedKeys(publicKey)) {
        try {
          await notifyProfileUpdate('', '', '');
        } catch {
          logger.warn('Profile key registration failed — retrying...');
          try { await notifyProfileUpdate('', '', ''); } catch { /* give up */ }
        }
      }

      // 2. Sync My Profile
      syncProfile(publicKey).then(profile => {
        if (profile) {
          logger.debug("Synced profile:", profile);
          setMyProfile({ username: profile.username, bio: profile.bio });
          if (profile.avatar_cid) setMyAvatarCid(profile.avatar_cid);
        }
      }).catch(() => { /* own profile fetch failed, non-critical */ });

      // 2. Load saved contacts from backend (persisted empty chats etc.)
      if (backendSavedContacts.length > 0) {
        const restored: Contact[] = backendSavedContacts.map(sc => ({
          id: sc.address,
          name: sc.name,
          address: sc.address,
          description: 'Saved contact',
          context: 'Saved',
          initials: sc.name.slice(0, ADDRESS_DISPLAY.INITIALS).toUpperCase(),
          unreadCount: 0
        }));
        setContacts(restored);
      }

      // 3. Sync Dialogs (keys are now guaranteed to be cached)
      await loadDialogs();

      // Mark session as initialized — enables contacts auto-save to backend
      sessionInitDone.current = true;

      // Push a system notification for session start
      pushNotification('system', 'Connected', 'Encrypted session established. Keys loaded.');
    };

    const loadDialogs = async () => {
      try {
        const addressHash = hashAddress(publicKey);
        logger.debug(`[loadDialogs] Fetching dialogs for hash: ${addressHash.slice(0, 20)}...`);
        const dialogs = await fetchDialogs(addressHash);
        logger.debug(`[loadDialogs] Received ${dialogs.length} dialogs`);
        if (dialogs.length === 0) return;

        const newContacts: Contact[] = [];

        // Process each dialog
        for (const dialogMsg of dialogs) {
          const isMine = dialogMsg.sender === publicKey;
          const counterpartyAddress = isMine ? dialogMsg.recipient : dialogMsg.sender;

          let finalAddress = counterpartyAddress;
          let displayName = `User ${counterpartyAddress.slice(0, ADDRESS_DISPLAY.SHORT_PREFIX)}...`;

          // If recipient is 'unknown', try to resolve from recipientHash
          if (counterpartyAddress === 'unknown' && isMine && dialogMsg.recipient_hash) {
            const { data: hashProfile } = await safeBackendFetch<any>(`profiles/hash/${dialogMsg.recipient_hash}`);
            if (hashProfile?.exists && hashProfile.profile?.address) {
              finalAddress = hashProfile.profile.address;
              displayName = hashProfile.profile.username || `User ${finalAddress.slice(0, ADDRESS_DISPLAY.SHORT_PREFIX)}...`;
            } else {
              // Use dialog hash as fallback ID so chat is visible
              finalAddress = dialogMsg.dialog_hash || `hash:${dialogMsg.recipient_hash}`;
              displayName = `User ${dialogMsg.recipient_hash.slice(0, ADDRESS_DISPLAY.MEDIUM)}...`;
            }
          }

          // Use decrypted text from fetchDialogs
          let previewText = dialogMsg.text || "Encrypted Message";

          newContacts.push({
            id: finalAddress,
            name: displayName,
            address: finalAddress,
            dialogHash: dialogMsg.dialog_hash,
            description: 'Synced conversation',
            context: 'Network',
            initials: 'UK',
            unreadCount: 0,
            lastMessage: previewText,
            lastMessageTime: new Date(Number(dialogMsg.timestamp))
          });

          // Fetch profile for aleo addresses
          if (finalAddress.startsWith("aleo")) {
            syncProfile(finalAddress).then(profile => {
              if (profile) {
                setContacts(curr => curr.map(c =>
                  c.id === finalAddress
                    ? {
                        ...c,
                        ...(profile.username ? { name: profile.username, initials: profile.username.slice(0,2).toUpperCase() } : {}),
                        hideAvatar: profile.show_avatar === false,
                        avatarCid: profile.avatar_cid || undefined
                      }
                    : c
                ));
              }
            }).catch(() => { /* profile fetch failed, non-critical */ });
          }
        }

        // Merge contacts: add new ones, update existing with latest lastMessage
        if (newContacts.length > 0) {
          setContacts(prev => {
            const combined = [...prev];
            newContacts.forEach(nc => {
              const existingIdx = combined.findIndex(c => c.id === nc.id);
              if (existingIdx !== -1) {
                // Update existing contact's preview text and time
                combined[existingIdx] = {
                  ...combined[existingIdx],
                  lastMessage: nc.lastMessage || combined[existingIdx].lastMessage,
                  lastMessageTime: nc.lastMessageTime || combined[existingIdx].lastMessageTime,
                  dialogHash: nc.dialogHash || combined[existingIdx].dialogHash
                };
              } else {
                combined.push(nc);
              }
            });
            return combined;
          });
        }

        // Mark all loaded dialog messages as processed (prevent duplicate WS notifications)
        for (const dialogMsg of dialogs) {
          if (dialogMsg.id) processedMsgIds.current.add(dialogMsg.id);
        }

        // Push notifications for recent incoming messages (received within last 24h)
        const oneDayAgo = Date.now() - 86_400_000;
        for (const dialogMsg of dialogs) {
          const isMine = dialogMsg.sender === publicKey;
          if (!isMine && Number(dialogMsg.timestamp) > oneDayAgo) {
            const preview = dialogMsg.text && dialogMsg.text !== 'Encrypted Message'
              ? (dialogMsg.text.length > 80 ? dialogMsg.text.slice(0, MESSAGE_PREVIEW.CHAT_LIST) + '...' : dialogMsg.text)
              : 'New encrypted message';
            const senderAddr = dialogMsg.sender;
            pushNotification('message', 'Message received', preview, senderAddr);
          }
        }
      } catch (e) {
        logger.error("Failed to sync dialogs:", e);
      }
    };

    initSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // syncProfile, fetchDialogs, hashAddress are from useSync — stable by behavior but not by reference
    // backendSavedContacts intentionally NOT in deps — only read once during init
  }, [isSyncConnected, publicKey, preferencesLoaded]);

  // Load Channels & Groups on connect
  useEffect(() => {
    if (isSyncConnected && publicKey) {
      fetchRooms('channel').then(setChannels);
      fetchRooms('group').then(setGroups);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // fetchRooms is from useSync — stable by behavior
  }, [isSyncConnected, publicKey]);

  // Initialize
  useEffect(() => {
    const timer = setTimeout(() => setIsInitializing(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  // Sync URL hash with navigation state (enables page reload persistence + deep links)
  useEffect(() => {
    let hash = '';
    if (activeRoomId) {
      hash = `room/${activeRoomId}`;
    } else if (activeChatId) {
      hash = `chat/${activeChatId}`;
    } else if (currentView !== 'chats') {
      hash = currentView;
    }
    const newHash = hash ? `#${hash}` : '';
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, '', newHash || window.location.pathname);
    }
  }, [activeChatId, activeRoomId, currentView]);

  // Request notification permission on wallet connect
  useEffect(() => {
    if (publicKey && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [publicKey]);

  // Fetch Balance (Initial + Single Interval)
  useEffect(() => {
    if (publicKey) {
      getAccountBalance(publicKey).then(setBalance);
      // Keep balance polling for now as it's not message sync
      const interval = setInterval(() => {
        getAccountBalance(publicKey).then(setBalance);
      }, 30000); 
      return () => clearInterval(interval);
    } else {
      setBalance(null);
    }
  }, [publicKey]);

  // Update Chats derived from Contacts
  useEffect(() => {
    const derivedChats = contacts.map(c => mapContactToChat(c, c.id === activeChatId));
    setChats(derivedChats);
  }, [contacts, activeChatId]);

  const activeDialogHash = useMemo(() => {
    return contacts.find(c => c.id === activeChatId)?.dialogHash;
  }, [contacts, activeChatId]);

  // Build address → display name map for ChatArea (DM contacts + room members)
  const memberNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of contacts) {
      if (c.address && c.name && !c.name.startsWith('User ')) {
        map[c.address] = c.name;
      }
    }
    return map;
  }, [contacts]);

  // Fetch online status / lastSeen when active DM chat changes (+ poll every 30s)
  const [contactOnlineStatus, setContactOnlineStatus] = useState<{ online: boolean; lastSeen: number | null; showAvatar: boolean } | null>(null);
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  useEffect(() => {
    if (!activeChatId || activeRoomId) { setContactOnlineStatus(null); return; }
    const contact = contactsRef.current.find(c => c.id === activeChatId);
    if (!contact?.address) return;
    const poll = () => {
      try {
        const addrHash = hashAddress(contact.address);
        fetchOnlineStatus(addrHash).then(setContactOnlineStatus);
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId, activeRoomId]);

  // Load messages when active chat changes — IndexedDB first (instant), then backend (sync)
  useEffect(() => {
    if (!activeChatId || !publicKey || !activeDialogHash || !isSyncConnected) return;

    // Step 1: Load from IndexedDB immediately (instant, <100ms)
    loadDialogMessagesFromIDB(activeDialogHash, 100).then(cachedMsgs => {
      if (cachedMsgs && cachedMsgs.length > 0) {
        const sorted = cachedMsgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        setHistories(prev => ({ ...prev, [activeChatId]: sorted }));
        logger.debug(`[IndexedDB] Loaded ${cachedMsgs.length} cached messages for ${activeChatId.slice(0, 10)}`);
      }
    }).catch(err => logger.error('[IndexedDB] Failed to load messages:', err));

    // Step 2: Fetch from backend in background (sync any new messages)
    fetchDialogMessages(activeDialogHash, { limit: 100 }).then(msgs => {
      if (msgs && msgs.length > 0) {
        const sorted = msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        setHistories(prev => {
          // Merge backend messages with IndexedDB messages, removing duplicates
          const existing = prev[activeChatId] || [];
          const existingIds = new Set(existing.map(m => m.id));
          const newMessages = sorted.filter(m => !existingIds.has(m.id));

          if (newMessages.length > 0) {
            logger.debug(`[Backend] Synced ${newMessages.length} new messages from backend`);
            return { ...prev, [activeChatId]: [...existing, ...newMessages].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)) };
          }
          return prev;
        });

        // Send read receipts for unread messages from counterparty (if readReceipts enabled)
        if (settingsRef.current.readReceipts) {
          const unreadIds = sorted.filter(m => !m.isMine && m.status !== 'read').map(m => m.id);
          if (unreadIds.length > 0) {
            sendReadReceipt(activeDialogHash, unreadIds);
          }
        }
      }
    }).catch(err => logger.error('[Backend] Failed to fetch messages:', err));

    // eslint-disable-next-line react-hooks/exhaustive-deps
    // fetchDialogMessages, loadDialogMessagesFromIDB are stable by behavior
  }, [activeChatId, activeDialogHash, publicKey, isSyncConnected]);


  const handleConnectWallet = async () => {
    // If wallet is not selected, select it first
    if (!wallet && wallets.length > 0) {
        select(wallets[0].adapter.name);
        // We need to wait for the wallet to be selected in state
        // Since we can't await state update in this closure, we'll rely on the user clicking again
        // OR we can rely on the wallet adapter's internal state if we access it directly from `wallets`
        
        // Try to connect directly using the adapter instance if possible
        const adapter = wallets[0].adapter;
              if (adapter && !adapter.connected) {
                   setIsConnecting(true);
                   try {
                      await adapter.connect(
                        DecryptPermission.OnChainHistory,
                        WalletAdapterNetwork.TestnetBeta
                      );
                      toast.success('Wallet connected successfully');
                   } catch (err) {
                logger.error("Connection failed:", err);
                toast.error(mapErrorToUserMessage(err));
             } finally {
                setIsConnecting(false);
             }
        }
        return;
    }

    if (wallet?.adapter && !publicKey) {
            setIsConnecting(true);
            try {
              await wallet.adapter.connect(
                DecryptPermission.OnChainHistory,
                WalletAdapterNetwork.TestnetBeta
              );
              toast.success('Wallet connected successfully');
      } catch (err) {
        logger.error("Connection failed:", err);
        toast.error(mapErrorToUserMessage(err));
      } finally {
        setIsConnecting(false);
      }
    }
  };

  const handleDisconnect = () => {
    // Clear encryption keys from memory cache and session storage
    if (publicKey) {
      clearKeyCache(publicKey);
      clearSessionKeys(publicKey);
    }
    // Reset session state so contacts auto-save doesn't wipe on reconnect
    sessionInitDone.current = false;
    // Disconnect wallet
    if (disconnect) disconnect();
  };

  const handleSendMessage = async (text: string, file?: File, replyTo?: { id: string; text: string; sender: string }) => {
    if (!activeChatId || !publicKey) return;

    const contact = contacts.find(c => c.id === activeChatId);
    if (!contact || !contact.address) return;

    // Validate recipient address format (aleo1 + 58 chars = 63 total)
    if (!contact.address.startsWith('aleo1') || contact.address.length < 60) {
      toast.error('Invalid recipient address');
      logger.error('Invalid recipient address:', contact.address);
      return;
    }

    setIsSendingMessage(true);

    try {
      let attachmentCID: string | undefined;
      if (file) {
        // Validate file size (max 100MB)
        if (file.size > MAX_FILE_SIZE) {
          toast.error(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 100MB)`);
          return;
        }
        // Validate file name length
        if (file.name.length > MAX_FILENAME_LENGTH) {
          toast.error(`File name too long (max ${MAX_FILENAME_LENGTH} characters)`);
          return;
        }
        toast.loading("Uploading attachment to IPFS...", { id: "ipfs-upload" });
        attachmentCID = await uploadFileToIPFS(file);
        toast.success("Attachment uploaded", { id: "ipfs-upload" });
      }

      // 1. Prepare encrypted payload (NO WebSocket send yet)
      const prepared = await prepareDMMessage(contact.address, text, attachmentCID, replyTo);

      if (!prepared) {
        toast.error('Not connected to server. Please wait and try again.');
        return;
      }

      const { tempId, encryptedPayload, timestamp } = prepared;

      // 2. Request wallet approval FIRST (on-chain transaction)
      let txId: string | undefined;
      toast.loading('Waiting for wallet approval...', { id: 'tx-approval' });
      try {
        txId = await sendMessageOnChain(contact.address!, encryptedPayload, timestamp, attachmentCID);
        toast.dismiss('tx-approval');
      } catch (e) {
        toast.dismiss('tx-approval');
        logger.error('On-chain transaction failed:', e?.message);
        toast.error('Transaction failed: ' + (e?.message || 'Unknown error'));
        return; // Don't show message if wallet rejected/failed
      }

      // 3. Wallet approved → send off-chain via WebSocket
      const sent = commitDMMessage(prepared, attachmentCID);
      if (!sent) {
        throw new Error('Failed to send message — WebSocket not connected');
      }

      // 3b. Also send via XMTP (background, decentralized backup, non-blocking)
      if (isXmtpReady && !file) {
        sendXmtpMessage(contact.address!, text).catch(() => {
          // XMTP failures are silent — WebSocket is the primary transport
        });
      }

      // 4. Show message in UI
      const newMessage: Message = {
        id: tempId,
        text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp,
        senderId: 'me',
        isMine: true,
        status: txId ? 'confirmed' : 'pending',
        txId,
        replyToId: replyTo?.id,
        replyToText: replyTo?.text,
        replyToSender: replyTo?.sender,
        attachment: file && attachmentCID ? {
          type: file.type.startsWith('image/') ? 'image' : 'file',
          cid: attachmentCID,
          name: file.name,
          size: file.size,
          mimeType: file.type
        } : undefined
      };

      setHistories(prev => ({
        ...prev,
        [activeChatId]: [...(prev[activeChatId] || []), newMessage]
      }));

      // Update sidebar preview with sent message text + ensure dialogHash is set
      setContacts(prev => prev.map(c =>
        c.id === activeChatId ? { ...c, lastMessage: text, lastMessageTime: new Date(), dialogHash: prepared.dialogHash || c.dialogHash } : c
      ));

      // Cache the plaintext so deduplication works when dm_sent / message_detected arrives
      cacheDecryptedMessage(tempId, text);

      if (txId) {
        logger.debug('On-chain message txId:', txId);
        toast.success('Message sent');
        pushNotification('transaction', 'Transaction confirmed', `Message sent on-chain (${txId.slice(0, ADDRESS_DISPLAY.TX_ID)}...)`);
      }
    } catch (error) {
      logger.error("Failed to send message", error);
      toast.error('Failed to send message');
    } finally {
      setIsSendingMessage(false);
    }
  };

  // Add a chat entry locally WITHOUT on-chain transaction (for messaging non-contacts)
  const ensureChatExists = (address: string, name: string) => {
    if (contacts.some(c => c.address === address || c.id === address)) return;
    const newChat: Contact = {
      id: address,
      name,
      address,
      description: '',
      context: 'Direct message',
      initials: name.slice(0, ADDRESS_DISPLAY.INITIALS).toUpperCase(),
      unreadCount: 0
    };
    setContacts(prev => [...prev, newChat]);
  };

  const handleAddContact = async (address: string, name: string) => {
    if (!publicKey) {
        toast.error('Connect wallet to add contacts');
        return;
    }

    // Check for duplicates
    if (contacts.some(c => c.address === address)) {
        toast('Contact already exists', { icon: 'ℹ️' });
        return;
    }

    // On-chain transaction (wallet popup)
    try {
      toast.loading('Waiting for add contact transaction...', { id: 'add-contact-tx' });
      await addContactOnChain(address);
      toast.dismiss('add-contact-tx');
    } catch (e) {
      toast.dismiss('add-contact-tx');
      toast.error('Transaction rejected');
      logger.error('Add contact on-chain failed:', e?.message);
      return; // Don't add contact if transaction was rejected
    }

    const newContact: Contact = {
      id: address,
      name,
      address,
      description: 'Added via contacts',
      context: 'Manual add',
      initials: name.slice(0, ADDRESS_DISPLAY.INITIALS).toUpperCase(),
      unreadCount: 0
    };

    setContacts(prev => [...prev, newContact]);
    toast.success(`Contact ${name} added`);
  };

  const handleEditContact = async (id: string, newName: string) => {
    if (!publicKey) return;

    // On-chain transaction (wallet popup)
    try {
      toast.loading('Waiting for update contact transaction...', { id: 'update-contact-tx' });
      await updateContactOnChain(id); // id is the address
      toast.dismiss('update-contact-tx');
    } catch (e) {
      toast.dismiss('update-contact-tx');
      toast.error('Transaction rejected');
      logger.error('Update contact on-chain failed:', e?.message);
      return;
    }

    setContacts(prev =>
      prev.map(c => c.id === id ? { ...c, name: newName, initials: newName.slice(0, ADDRESS_DISPLAY.INITIALS).toUpperCase() } : c)
    );
    toast.success('Contact renamed');
  };

  const handleDeleteContact = async (id: string) => {
    if (!publicKey) return;

    // On-chain transaction (wallet popup)
    try {
      toast.loading('Waiting for delete contact transaction...', { id: 'delete-contact-tx' });
      await deleteContactOnChain(id); // id is the address
      toast.dismiss('delete-contact-tx');
    } catch (e) {
      toast.dismiss('delete-contact-tx');
      toast.error('Transaction rejected');
      logger.error('Delete contact on-chain failed:', e?.message);
      return;
    }

    setContacts(prev => prev.filter(c => c.id !== id));
    if (activeChatId === id) setActiveChatId(null);
    toast.success('Contact deleted');
  };

  const handleCreateProfile = async (name: string, bio: string) => {
    if (!publicKey) return;
    setIsProcessing(true);

    try {
      // 1. On-chain profile registration (wallet popup)
      toast.loading('Waiting for transaction approval...', { id: 'profile-tx' });
      const txId = await registerProfileOnChain();
      toast.dismiss('profile-tx');

      // 2. Save profile to backend (single call with ALL data: name, bio, key, txId)
      await notifyProfileUpdate(name, bio, txId || 'off-chain');
      setMyProfile({ username: name, bio });

      toast.success('Profile created on-chain');
      logger.debug('On-chain profile registered');
    } catch (e) {
      toast.dismiss('profile-tx');
      logger.error("Failed to create profile", e);
      toast.error('Profile creation failed: ' + (e?.message || 'Unknown error'));
      setMyProfile(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdateProfile = async (name: string, bio: string) => {
    if (!publicKey) return;
    setIsProcessing(true);

    const oldProfile = myProfile;

    try {
      // 1. On-chain profile update (wallet popup)
      toast.loading('Waiting for transaction approval...', { id: 'profile-update-tx' });
      const txId = await updateProfileOnChain();
      toast.dismiss('profile-update-tx');

      // 2. Save profile to backend (single call with ALL data)
      await notifyProfileUpdate(name, bio, txId || 'off-chain');
      setMyProfile({ username: name, bio });

      toast.success('Profile updated on-chain');
      logger.debug('On-chain profile updated');
    } catch (e) {
      toast.dismiss('profile-update-tx');
      logger.error("Failed to update profile", e);
      toast.error('Profile update failed: ' + (e?.message || 'Unknown error'));
      setMyProfile(oldProfile);
    } finally {
      setIsProcessing(false);
    }
  };


  const handleAvatarUpload = async (cid: string | null) => {
    if (!publicKey) return;
    await notifyProfileUpdate(myProfile?.username || '', myProfile?.bio || '', 'avatar-update', undefined, { avatarCid: cid });
    setMyAvatarCid(cid);
  };

  const handleSendMessageFromProfile = (contact: Contact | any) => {
    const address = contact.address || contact.id;
    const existing = contacts.find(c => c.address === address || c.id === address);

    if (existing) {
        setActiveChatId(existing.id);
    } else {
        // Create local chat without on-chain transaction
        ensureChatExists(address, contact.name || contact.username || 'Unknown');
        setActiveChatId(address);
    }
    setViewingProfile(null);
    setCurrentView('chats');
  };

  // --- Room Handlers ---
  const handleCreateRoom = async (name: string, type: RoomType) => {
    const result = await createRoom(name, type);
    if (result) {
      toast.success(`${type === 'channel' ? 'Channel' : 'Group'} "${name}" created`);
      fetchRooms(type).then(type === 'channel' ? setChannels : setGroups);

      // On-chain proof of creation (optional, non-blocking)
      if (publicKey) {
        (async () => {
          try {
            const nameHash = hashAddress(name);
            const creatorHash = hashAddress(publicKey);
            const fn = type === 'channel' ? 'create_channel' : 'create_group';
            await executeTransaction(fn, [nameHash, creatorHash]);
            toast.success(`On-chain ${type} proof recorded`);
          } catch (e) {
            logger.warn(`On-chain ${type} proof failed (non-critical):`, e?.message);
          }
        })();
      }
    }
  };

  const handleDeleteRoom = async (roomId: string) => {
    const room = [...channels, ...groups].find(r => r.id === roomId);
    try {
      await deleteRoomApi(roomId);
      setChannels(prev => prev.filter(r => r.id !== roomId));
      setGroups(prev => prev.filter(r => r.id !== roomId));
      if (activeRoomId === roomId) setActiveRoomId(null);
      toast.success('Room deleted');

      // On-chain deletion proof (optional, non-blocking)
      if (publicKey && room) {
        (async () => {
          try {
            const nameHash = hashAddress(room.name);
            const creatorHash = hashAddress(publicKey);
            const fn = room.type === 'channel' ? 'delete_channel' : 'delete_group';
            await executeTransaction(fn, [nameHash, creatorHash]);
          } catch (e) {
            logger.warn('On-chain room deletion failed (non-critical):', e?.message);
          }
        })();
      }
    } catch (e) {
      logger.error('Delete room failed:', e);
      toast.error('Failed to delete room');
    }
  };

  const handleJoinRoom = async (roomId: string) => {
    try {
      await joinRoom(roomId);
      subscribeRoom(roomId);
      toast.success('Joined room');
      fetchRooms('group').then(setGroups);
    } catch (e) {
      logger.error('Join room failed:', e);
      toast.error('Failed to join room');
    }
  };

  const handleLeaveRoom = async (roomId: string) => {
    try {
      await leaveRoom(roomId);
      if (activeRoomId === roomId) setActiveRoomId(null);
      toast.success('Left room');
      fetchRooms('group').then(setGroups);
    } catch (e) {
      logger.error('Leave room failed:', e);
      toast.error('Failed to leave room');
    }
  };

  const handleSelectRoom = async (roomId: string) => {
    setActiveRoomId(roomId);
    setActiveChatId(null);
    setRoomMembers([]);
    try {
      // Auto-join (idempotent on server: findOrCreate)
      await joinRoom(roomId);
      subscribeRoom(roomId);
      // Load room messages + members in parallel
      const [msgs, info] = await Promise.all([
        fetchRoomMessages(roomId),
        fetchRoomInfo(roomId)
      ]);
      setRoomHistories(prev => ({ ...prev, [roomId]: msgs }));
      if (info) setRoomMembers(info.members);
    } catch (e) {
      logger.error('Failed to load room:', e);
      toast.error('Failed to load room');
    }
  };

  // Forward a message to another contact
  const handleForwardMessage = async (toAddress: string, text: string, originalSender: string) => {
    if (!publicKey) return;
    if (!toAddress.startsWith('aleo1') || toAddress.length < 60) {
      toast.error('Invalid recipient address');
      return;
    }

    const forwardText = `↪ Forwarded from ${originalSender}:\n${text}`;

    try {
      const prepared = await prepareDMMessage(toAddress, forwardText);
      if (!prepared) { toast.error('Failed to prepare forward'); return; }

      await commitDMMessage(prepared);

      // Optimistic message in target chat
      const tempMsg: Message = {
        id: prepared.tempId,
        text: forwardText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: prepared.timestamp,
        senderId: 'me',
        isMine: true,
        status: 'sent',
      };

      setHistories(prev => ({
        ...prev,
        [toAddress]: [...(prev[toAddress] || []), tempMsg]
      }));

      // Update sidebar preview
      setContacts(prev => prev.map(c =>
        c.id === toAddress ? { ...c, lastMessage: forwardText, lastMessageTime: new Date() } : c
      ));

      cacheDecryptedMessage(prepared.tempId, forwardText);
    } catch (e) {
      logger.error('Forward failed:', e);
      toast.error('Forward failed');
    }
  };

  const handleSendRoomMessage = (text: string) => {
    if (!activeRoomId) return;
    sendRoomMessage(activeRoomId, text, myProfile?.username);
    // Optimistic update
    const tempMsg: Message = {
      id: Date.now().toString(),
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now(),
      senderId: 'me',
      isMine: true,
      status: 'sent',
      senderHash: myProfile?.username || publicKey?.slice(0, 10)
    };
    setRoomHistories(prev => ({
      ...prev,
      [activeRoomId]: [...(prev[activeRoomId] || []), tempMsg]
    }));
  };

  const handleDeleteRoomMessage = async (msgId: string) => {
    if (!activeRoomId) return;
    try {
      await deleteRoomMessage(activeRoomId, msgId);
      setRoomHistories(prev => ({
        ...prev,
        [activeRoomId]: (prev[activeRoomId] || []).filter(m => m.id !== msgId)
      }));
      toast.success('Message deleted');
    } catch (e) {
      logger.error('Delete room message failed:', e);
      toast.error('Failed to delete message');
    }
  };

  const handleEditRoomMessage = async (msgId: string, newText: string) => {
    if (!activeRoomId) return;
    try {
      await editRoomMessage(activeRoomId, msgId, newText);
      setRoomHistories(prev => ({
        ...prev,
        [activeRoomId]: (prev[activeRoomId] || []).map(m => m.id === msgId ? { ...m, text: newText, edited: true } : m)
      }));
      toast.success('Message edited');
    } catch (e) {
      logger.error('Edit room message failed:', e);
      toast.error('Failed to edit message');
    }
  };

  const handleClearDM = async () => {
    if (!activeChatId) return;
    const contact = contacts.find(c => c.id === activeChatId);
    const recipientAddress = contact?.address || activeChatId;

    // 1. On-chain proof via clear_history transition
    toast.loading('Waiting for transaction approval...', { id: 'clear-dm-tx' });
    try {
      await clearHistoryOnChain(recipientAddress);
      toast.dismiss('clear-dm-tx');
    } catch (e) {
      toast.dismiss('clear-dm-tx');
      logger.error('Clear history cancelled:', e?.message);
      toast.error('Clear history cancelled');
      return;
    }

    // 2. Delete messages from backend
    if (contact?.dialogHash) {
      try { await clearDMHistory(contact.dialogHash); } catch {}
    }

    // 3. Clear local state (messages + sidebar preview)
    setHistories(prev => ({ ...prev, [activeChatId!]: [] }));
    setContacts(prev => prev.map(c =>
      c.id === activeChatId ? { ...c, lastMessage: '', lastMessageTime: undefined } : c
    ));
    toast.success('Chat history cleared');
  };

  const handleDeleteChat = async (chatId: string) => {
    const contact = contacts.find(c => c.id === chatId);
    const recipientAddress = contact?.address || chatId;

    // 1. On-chain proof via delete_chat transition
    toast.loading('Waiting for transaction approval...', { id: 'delete-chat-tx' });
    try {
      await deleteChatOnChain(recipientAddress);
      toast.dismiss('delete-chat-tx');
    } catch (e) {
      toast.dismiss('delete-chat-tx');
      logger.error('Delete chat cancelled:', e?.message);
      toast.error('Delete chat cancelled');
      return;
    }

    // 2. Remove contact from state
    setContacts(prev => prev.filter(c => c.id !== chatId));
    // 3. Clear history + IndexedDB cache
    setHistories(prev => {
      const next = { ...prev };
      delete next[chatId];
      return next;
    });
    // Close chat if it was active
    if (activeChatId === chatId) setActiveChatId(null);
    // Mark as deleted in backend preferences
    markChatDeleted(chatId);
    toast.success('Chat deleted');
  };

  const handleClearAllConversations = async () => {
    try {
      const total = contacts.filter(c => c.dialogHash).length;
      if (total === 0) {
        toast('No conversations to clear', { icon: 'ℹ️' });
        return;
      }
      let failed = 0;
      for (const contact of contacts) {
        if (contact.dialogHash) {
          try { await clearDMHistory(contact.dialogHash); } catch { failed++; }
        }
      }
      setContacts([]);
      setHistories({});
      setActiveChatId(null);
      if (failed === total) {
        toast.error('Failed to clear conversations');
      } else if (failed > 0) {
        toast.error(`${failed} of ${total} conversations failed to clear`);
      } else {
        toast.success('All conversations cleared');
      }
    } catch (e: any) {
      logger.error('Clear all failed:', e?.message);
      toast.error('Failed to clear conversations');
    }
  };

  // --- Sidebar Context Menu Handler ---
  const handleContextAction = (action: ChatContextAction, id: string, itemType: 'chat' | 'channel' | 'group', newName?: string) => {
    switch (action) {
      case 'rename': {
        if (!newName) break;
        if (itemType === 'chat') {
          // Rename contact locally
          handleEditContact(id, newName);
        } else {
          // Rename room via backend
          renameRoomApi(id, newName).then(() => {
            if (itemType === 'channel') {
              setChannels(prev => prev.map(r => r.id === id ? { ...r, name: newName } : r));
            } else {
              setGroups(prev => prev.map(r => r.id === id ? { ...r, name: newName } : r));
            }
            toast.success('Renamed');
          });
        }
        break;
      }
      case 'pin': {
        togglePin(id);
        break;
      }
      case 'mute': {
        const wasMuted = mutedChatIds.includes(id);
        toggleMute(id);
        toast.success(wasMuted ? 'Unmuted' : 'Muted');
        break;
      }
      case 'mark_unread': {
        if (itemType === 'chat') {
          setContacts(prev => prev.map(c => c.id === id ? { ...c, unreadCount: Math.max(c.unreadCount || 0, 1) } : c));
          toast.success('Marked as unread');
        }
        break;
      }
      case 'archive': {
        toast('Archive coming soon', { icon: '📦' });
        break;
      }
      case 'delete': {
        if (itemType === 'chat') {
          handleDeleteChat(id);
        } else {
          handleDeleteRoom(id);
        }
        break;
      }
      case 'open_new_tab': {
        // Open same URL in a new browser tab
        window.open(window.location.href, '_blank');
        break;
      }
    }
  };

  // --- DM Delete / Edit (on-chain proof + off-chain) ---
  const handleDeleteDMMessage = async (msgId: string) => {
    const msg = activeChatId ? (histories[activeChatId] || []).find(m => m.id === msgId) : undefined;

    // 1. On-chain proof transaction (wallet popup — always required)
    if (msg?.timestamp) {
      try {
        toast.loading('Waiting for delete transaction approval...', { id: 'delete-tx' });
        await deleteMessageProof(msg.timestamp);
        toast.dismiss('delete-tx');
      } catch (e) {
        toast.dismiss('delete-tx');
        toast.error('Transaction rejected');
        logger.error('Delete message on-chain failed:', e?.message);
        return; // Don't delete if transaction was rejected
      }
    }

    // 2. Off-chain delete (instant)
    try {
      await deleteDMMessage(msgId);
      if (activeChatId) {
        setHistories(prev => {
          const remaining = (prev[activeChatId!] || []).filter(m => m.id !== msgId)
            .map(m => m.replyToId === msgId ? { ...m, replyToText: 'Message deleted' } : m);
          const lastMsg = remaining.length > 0 ? remaining[remaining.length - 1] : null;
          setContacts(pc => pc.map(c =>
            c.id === activeChatId
              ? { ...c, lastMessage: lastMsg?.text || '', lastMessageTime: lastMsg ? new Date(Number(lastMsg.timestamp)) : undefined }
              : c
          ));
          return { ...prev, [activeChatId!]: remaining };
        });
      }
      toast.success('Message deleted');
    } catch (e: any) {
      logger.error('Off-chain delete failed:', e?.message);
      toast.error('Failed to delete message: ' + (e?.message || 'Server error'));
    }
  };

  const handleEditDMMessage = async (msgId: string, newText: string) => {
    if (!activeChatId) return;
    const contact = contacts.find(c => c.id === activeChatId);
    if (!contact?.address) return;

    // 1. On-chain proof transaction (wallet popup — always required)
    const msg = (histories[activeChatId] || []).find(m => m.id === msgId);
    if (msg?.timestamp) {
      try {
        toast.loading('Waiting for edit transaction approval...', { id: 'edit-tx' });
        await editMessageProof(msg.timestamp);
        toast.dismiss('edit-tx');
      } catch (e) {
        toast.dismiss('edit-tx');
        toast.error('Transaction rejected');
        logger.error('Edit message on-chain failed:', e?.message);
        return; // Don't edit if transaction was rejected
      }
    }

    // 2. Off-chain edit (instant via backend)
    try {
      await editDMMessage(msgId, newText, contact.address);
      // Optimistic update only on success
      setHistories(prev => {
        const updated = (prev[activeChatId!] || []).map(m => {
          if (m.id === msgId) return { ...m, text: newText, edited: true };
          if (m.replyToId === msgId) return { ...m, replyToText: newText };
          return m;
        });
        const lastMsg = updated[updated.length - 1];
        if (lastMsg && lastMsg.id === msgId) {
          setContacts(pc => pc.map(c =>
            c.id === activeChatId ? { ...c, lastMessage: newText } : c
          ));
        }
        return { ...prev, [activeChatId!]: updated };
      });
      toast.success('Message edited');
    } catch (e: any) {
      logger.error('Off-chain edit failed:', e?.message);
      toast.error('Failed to edit message: ' + (e?.message || 'Server error'));
    }
  };

  // --- Pin Handlers ---
  const handlePinMessage = async (msgId: string, msgText: string) => {
    const contextId = activeRoomId || activeDialogHash;
    if (!contextId) return;
    try {
      await pinMessage(contextId, msgId, msgText);
      const pins = await fetchPins(contextId);
      setPinnedMessages(prev => ({ ...prev, [contextId]: pins }));
      toast.success('Message pinned');
    } catch (e: any) {
      toast.error('Failed to pin message: ' + (e?.message || 'Server error'));
    }
  };

  const handleUnpinMessage = async (msgId: string) => {
    const contextId = activeRoomId || activeDialogHash;
    if (!contextId) return;
    try {
      await unpinMessage(contextId, msgId);
      const pins = await fetchPins(contextId);
      setPinnedMessages(prev => ({ ...prev, [contextId]: pins }));
      toast.success('Message unpinned');
    } catch (e: any) {
      toast.error('Failed to unpin message: ' + (e?.message || 'Server error'));
    }
  };

  // Load pins when active chat/room changes
  useEffect(() => {
    const contextId = activeRoomId || activeDialogHash;
    if (!contextId || !isSyncConnected) return;
    fetchPins(contextId).then(pins => {
      setPinnedMessages(prev => ({ ...prev, [contextId]: pins }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // fetchPins is from useSync — stable by behavior
  }, [activeRoomId, activeDialogHash, isSyncConnected]);

  const handleLoadMore = async () => {
    if (!isSyncConnected || !publicKey || !activeChatId) return;
    
    const contact = contacts.find(c => c.id === activeChatId);
    if (!contact || !contact.dialogHash) {
        logger.warn("Cannot load more: No dialog hash for contact");
        return;
    }

    const currentMsgs = histories[activeChatId] || [];
    
    toast.loading("Loading older messages...", { id: "loading-more" });
    
    try {
        const olderMessages = await fetchDialogMessages(contact.dialogHash, { limit: 20, offset: currentMsgs.length });
        
        if (olderMessages.length > 0) {
            setHistories(prev => {
                const existing = prev[activeChatId] || [];
                // Merge and dedup
                const combined = [...existing];
                olderMessages.forEach(m => {
                     if (!combined.some(ex => ex.id === m.id)) combined.push(m);
                });
                combined.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                return { ...prev, [activeChatId]: combined };
            });
            toast.success(`Loaded ${olderMessages.length} older messages`, { id: "loading-more" });
        } else {
            toast("No more messages", { icon: 'End', id: "loading-more" });
        }
    } catch (e) {
        logger.error("Load more failed", e);
        toast.error("Failed to load history", { id: "loading-more" });
    }
  };

  if (isInitializing) return <Preloader />;

  if (!publicKey) {
    return (
      <>
        <Toaster 
          position="top-right"
          toastOptions={{
            style: {
              background: '#1A1A1A',
              color: '#fff',
              border: '1px solid #333',
            },
            success: {
              iconTheme: {
                primary: '#10B981',
                secondary: '#1A1A1A',
              },
            },
            error: {
              iconTheme: {
                primary: '#EF4444',
                secondary: '#1A1A1A',
              },
            },
          }}
        />
        <LandingPage onConnect={handleConnectWallet} isConnecting={isConnecting} />
      </>
    );
  }

  const activeChat = chats.find(c => c.id === activeChatId);
  const activeMessages = activeChatId ? (histories[activeChatId] || []) : [];
  const activeRoom = [...channels, ...groups].find(r => r.id === activeRoomId) || null;
  const activeRoomMessages = activeRoomId ? (roomHistories[activeRoomId] || []) : [];



  return (
    <div className="flex h-screen w-full bg-[#0A0A0A] overflow-hidden relative">
      <Toaster 
        position="top-right"
        toastOptions={{
          style: {
            background: '#1A1A1A',
            color: '#fff',
            border: '1px solid #333',
          },
          success: {
            iconTheme: {
              primary: '#10B981',
              secondary: '#1A1A1A',
            },
          },
          error: {
            iconTheme: {
              primary: '#EF4444',
              secondary: '#1A1A1A',
            },
          },
        }}
      />
      
      {/* Profile View Overlay */}
      {viewingProfile && (
        <ProfileView 
          contact={viewingProfile} 
          onClose={() => setViewingProfile(null)} 
          onSendMessage={handleSendMessageFromProfile}
          onAddContact={handleAddContact}
          isContact={contacts.some(c => c.address === (viewingProfile.address || viewingProfile.id))}
        />
      )}

      <Sidebar
        activeChatId={activeChatId}
        onSelectChat={(id) => {
          setActiveChatId(id);
          setActiveRoomId(null);
          setCurrentView('chats');
          setContacts(prev => prev.map(c => c.id === id ? { ...c, unreadCount: 0 } : c));
        }}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        currentView={currentView}
        onSetView={setCurrentView}
        isWalletConnected={!!publicKey}
        onConnectWallet={handleConnectWallet}
        onDisconnect={handleDisconnect}
        chats={chats}
        isConnecting={isConnecting}
        publicKey={publicKey}
        balance={balance}
        channels={channels}
        groups={groups}
        activeRoomId={activeRoomId}
        onSelectRoom={(id) => { handleSelectRoom(id); }}
        onCreateRoom={handleCreateRoom}
        onFabClick={() => {
          if (currentView === 'chats') {
            setNewMsgModal(true);
          } else {
            setFabModal(currentView === 'channels' ? 'channel' : 'group');
          }
        }}
        onContextAction={handleContextAction}
        pinnedIds={pinnedChatIds}
        mutedIds={mutedChatIds}
        avatarColor={userSettings.avatarColor}
        username={myProfile?.username}
        unreadNotifications={notifications.filter(n => !n.read).length}
        showOnlineStatus={userSettings.showOnlineStatus}
      />
      
      <main className="flex-1 flex overflow-hidden relative z-0 pointer-events-auto">
        {(currentView === 'chats' || currentView === 'channels' || currentView === 'groups') && (
          <ChatArea
            chatId={activeRoomId || activeChatId}
            onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            activeChat={activeRoom ? { id: activeRoom.id, name: activeRoom.name, avatar: '', status: 'online' as const, lastMessage: '', time: '', unreadCount: 0, type: 'group' as const } : activeChat}
            messages={activeRoomId ? activeRoomMessages : activeMessages}
            currentUserId={publicKey || 'me'}
            currentView={currentView}
            onSendMessage={activeRoomId ? (text: string) => handleSendRoomMessage(text) : handleSendMessage}
            isSending={isSendingMessage}
            onLoadMore={activeRoomId ? undefined : handleLoadMore}
            isLoading={false}
            isTyping={activeRoomId
              ? !!(typingUsers[`room:${activeRoomId}`])
              : !!(activeDialogHash && typingUsers[activeDialogHash])}
            typingUserName={activeRoomId
              ? (() => { const t = typingUsers[`room:${activeRoomId}`]; return t?.sender ? (memberNames[t.sender] || t.sender.slice(0, ADDRESS_DISPLAY.SHORT_PREFIX)) : undefined; })()
              : undefined}
            onTyping={!userSettings.typingIndicators ? undefined : activeRoomId
              ? () => sendRoomTyping(activeRoomId!)
              : () => activeDialogHash && sendTyping(activeDialogHash)}
            onViewProfile={activeRoomId ? undefined : (chat) => {
                const contact = contacts.find(c => c.id === chat.id);
                setViewingProfile(contact || { ...chat, address: chat.id });
            }}
            onReact={(msgId, emoji) => addReaction(msgId, emoji)}
            onRemoveReaction={(msgId, emoji) => removeReaction(msgId, emoji)}
            disappearTimer={activeChatId ? (disappearTimers[activeChatId] || 'off') : 'off'}
            onSetDisappearTimer={activeRoomId ? undefined : (timer) => activeChatId && setDisappearTimer(activeChatId, timer)}
            roomChat={activeRoom || undefined}
            onDeleteRoom={activeRoom && activeRoom.createdBy === publicKey ? () => handleDeleteRoom(activeRoom.id) : undefined}
            onLeaveRoom={activeRoom && activeRoom.createdBy !== publicKey ? () => handleLeaveRoom(activeRoom.id) : undefined}
            onClearDM={!activeRoomId && activeChatId ? handleClearDM : undefined}
            onDeleteChat={!activeRoomId && activeChatId ? () => handleDeleteChat(activeChatId!) : undefined}
            pinnedMessages={pinnedMessages[activeRoomId || activeDialogHash || ''] || []}
            onPinMessage={handlePinMessage}
            onUnpinMessage={handleUnpinMessage}
            onDeleteRoomMessage={activeRoomId ? handleDeleteRoomMessage : undefined}
            onEditRoomMessage={activeRoomId ? handleEditRoomMessage : undefined}
            onDeleteDMMessage={!activeRoomId && activeChatId ? handleDeleteDMMessage : undefined}
            onEditDMMessage={!activeRoomId && activeChatId ? handleEditDMMessage : undefined}
            roomMembers={activeRoomId ? roomMembers : undefined}
            memberNames={memberNames}
            contactOnline={contactOnlineStatus?.online}
            contactLastSeen={contactOnlineStatus?.lastSeen}
            contactHideAvatar={contactOnlineStatus?.showAvatar === false}
            linkPreviews={userSettings.linkPreviews}
            fetchLinkPreview={fetchLinkPreview}
            isBlocked={!activeRoomId && activeChatId ? blockedUsers.includes(activeChatId) : false}
            isBlockedByUser={!activeRoomId && activeChatId ? blockedByUsers.includes(activeChatId) : false}
            onBlockUser={!activeRoomId && activeChatId ? () => { blockUser(activeChatId!); toast.success('User blocked'); } : undefined}
            onUnblockUser={!activeRoomId && activeChatId ? () => { unblockUser(activeChatId!); toast.success('User unblocked'); } : undefined}
            forwardContacts={contacts.filter(c => c.address?.startsWith('aleo1')).map(c => ({ id: c.id, name: c.name, address: c.address || '' }))}
            onForwardMessage={handleForwardMessage}
            fontSize={userSettings.fontSize}
            chatTheme={userSettings.chatTheme}
            bubbleStyle={userSettings.bubbleStyle}
            compactMode={userSettings.compactMode}
            sendOnEnter={userSettings.sendOnEnter}
          />
        )}

        {currentView === 'contacts' && (
          <ContactsView
            contacts={contacts}
            onAddContact={handleAddContact}
            onEditContact={handleEditContact}
            onDeleteContact={handleDeleteContact}
            onSelectContact={(id) => {
              setActiveChatId(id);
              setCurrentView('chats');
            }}
            onSearchNetwork={searchProfiles}
            onViewProfile={setViewingProfile}
            onMessageUser={(address, name) => {
              ensureChatExists(address, name);
              setActiveChatId(address);
              setCurrentView('chats');
            }}
          />
        )}

        {currentView === 'notifications' && (
          <NotificationsView
            notifications={notifications}
            onMarkRead={(id) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))}
            onMarkAllRead={() => setNotifications(prev => prev.map(n => ({ ...n, read: true })))}
            onDismiss={(id) => setNotifications(prev => prev.filter(n => n.id !== id))}
            onClearAll={() => setNotifications([])}
            onNavigate={(chatId) => {
              setActiveChatId(chatId);
              setActiveRoomId(null);
              setCurrentView('chats');
            }}
          />
        )}

        {currentView === 'settings' && (
          <SettingsView
            onCreateProfile={handleCreateProfile}
            onUpdateProfile={handleUpdateProfile}
            isProcessing={isProcessing}
            initialData={myProfile}
            isWalletConnected={!!publicKey}
            publicKey={publicKey}
            balance={balance}
            onDisconnect={handleDisconnect}
            onClearAllConversations={handleClearAllConversations}
            contactCount={contacts.length}
            settings={userSettings}
            onUpdateSetting={(key, value) => {
              updateSetting(key, value);
              // Sync privacy settings to Profile so other users respect them
              if (key === 'showLastSeen' || key === 'showProfilePhoto') {
                const privacy = {
                  showLastSeen: key === 'showLastSeen' ? value as boolean : userSettings.showLastSeen,
                  showProfilePhoto: key === 'showProfilePhoto' ? value as boolean : userSettings.showProfilePhoto,
                };
                notifyProfileUpdate(myProfile?.username || '', myProfile?.bio || '', 'settings-update', privacy);
              }
            }}
            avatarCid={myAvatarCid}
            onAvatarUpload={handleAvatarUpload}
            blockedUsers={blockedUsers}
            onUnblockUser={(addr) => { unblockUser(addr); toast.success('User unblocked'); }}
            xmtpReady={isXmtpReady}
            xmtpError={xmtpError}
            xmtpIdentity={xmtpIdentity}
          />
        )}
      </main>

      {/* Create Room Modal */}
      {fabModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setFabModal(null); setFabModalName(''); }}>
          <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-6 w-[400px] max-w-[90vw] shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-white text-lg font-bold mb-1">
              {fabModal === 'channel' ? 'Create Channel' : 'Create Group'}
            </h3>
            <p className="text-[#666] text-sm mb-4">
              {fabModal === 'channel' ? 'Public channel for open discussion' : 'Private group for invited members'}
            </p>
            <input
              type="text"
              placeholder={fabModal === 'channel' ? 'Channel name...' : 'Group name...'}
              value={fabModalName}
              onChange={e => setFabModalName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && fabModalName.trim()) {
                  handleCreateRoom(fabModalName.trim(), fabModal);
                  setFabModal(null);
                  setFabModalName('');
                }
                if (e.key === 'Escape') { setFabModal(null); setFabModalName(''); }
              }}
              autoFocus
              className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl py-3 px-4 text-white text-sm focus:outline-none focus:border-[#FF8C00] transition-colors mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (fabModalName.trim()) {
                    handleCreateRoom(fabModalName.trim(), fabModal);
                    setFabModal(null);
                    setFabModalName('');
                  }
                }}
                disabled={!fabModalName.trim()}
                className="flex-1 py-2.5 bg-[#FF8C00] text-black font-bold rounded-xl hover:bg-[#FF9F2A] transition-all disabled:opacity-40 disabled:cursor-not-allowed btn-press hover:shadow-lg hover:shadow-[#FF8C00]/20"
              >
                Create
              </button>
              <button
                onClick={() => { setFabModal(null); setFabModalName(''); }}
                className="flex-1 py-2.5 bg-[#2A2A2A] text-[#888] font-bold rounded-xl hover:bg-[#333] transition-colors btn-press"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Message Modal */}
      {newMsgModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setNewMsgModal(false); setNewMsgAddress(''); setNewMsgName(''); }}>
          <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-6 w-[420px] max-w-[90vw] shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-white text-lg font-bold mb-1">New Message</h3>
            <p className="text-[#666] text-sm mb-4">Start a conversation with an Aleo address</p>

            {/* Existing contacts quick-pick */}
            {contacts.length > 0 && (
              <div className="mb-4">
                <p className="text-[#555] text-xs font-bold uppercase tracking-wider mb-2">Quick Pick</p>
                <div className="max-h-[140px] overflow-y-auto space-y-1 dark-scrollbar">
                  {contacts.map(c => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setActiveChatId(c.id);
                        setActiveRoomId(null);
                        setCurrentView('chats');
                        setNewMsgModal(false);
                        setNewMsgAddress('');
                        setNewMsgName('');
                      }}
                      className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-[#2A2A2A] transition-colors text-left"
                    >
                      <div className="w-8 h-8 bg-[#2A2A2A] rounded-full flex items-center justify-center text-xs text-[#FF8C00] font-bold shrink-0">
                        {c.initials || c.name.slice(0, ADDRESS_DISPLAY.INITIALS).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{c.name}</p>
                        <p className="text-[#666] text-xs font-mono truncate">{c.address ? `${c.address.slice(0, ADDRESS_DISPLAY.FULL_SHORT)}...` : ''}</p>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="border-t border-[#2A2A2A] my-3" />
              </div>
            )}

            <input
              type="text"
              placeholder="Wallet address (aleo1...)"
              value={newMsgAddress}
              onChange={e => setNewMsgAddress(e.target.value)}
              autoFocus
              className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl py-3 px-4 text-white text-sm font-mono focus:outline-none focus:border-[#FF8C00] transition-colors mb-3"
            />
            <input
              type="text"
              placeholder="Display name (optional)"
              value={newMsgName}
              onChange={e => setNewMsgName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newMsgAddress.startsWith('aleo1') && newMsgAddress.length >= 60) {
                  const name = newMsgName.trim() || `User ${newMsgAddress.slice(0, ADDRESS_DISPLAY.SHORT_PREFIX)}...`;
                  if (!contacts.some(c => c.address === newMsgAddress)) {
                    handleAddContact(newMsgAddress, name);
                  }
                  setActiveChatId(newMsgAddress);
                  setActiveRoomId(null);
                  setCurrentView('chats');
                  setNewMsgModal(false);
                  setNewMsgAddress('');
                  setNewMsgName('');
                }
                if (e.key === 'Escape') { setNewMsgModal(false); setNewMsgAddress(''); setNewMsgName(''); }
              }}
              className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl py-3 px-4 text-white text-sm focus:outline-none focus:border-[#FF8C00] transition-colors mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (newMsgAddress.startsWith('aleo1') && newMsgAddress.length >= 60) {
                    const name = newMsgName.trim() || `User ${newMsgAddress.slice(0, ADDRESS_DISPLAY.SHORT_PREFIX)}...`;
                    if (!contacts.some(c => c.address === newMsgAddress)) {
                      handleAddContact(newMsgAddress, name);
                    }
                    setActiveChatId(newMsgAddress);
                    setActiveRoomId(null);
                    setCurrentView('chats');
                    setNewMsgModal(false);
                    setNewMsgAddress('');
                    setNewMsgName('');
                  } else {
                    toast.error('Enter a valid Aleo address (aleo1...)');
                  }
                }}
                disabled={!newMsgAddress.startsWith('aleo1') || newMsgAddress.length < 60}
                className="flex-1 py-2.5 bg-[#FF8C00] text-black font-bold rounded-xl hover:bg-[#FF9F2A] transition-all disabled:opacity-40 disabled:cursor-not-allowed btn-press hover:shadow-lg hover:shadow-[#FF8C00]/20"
              >
                Start Chat
              </button>
              <button
                onClick={() => { setNewMsgModal(false); setNewMsgAddress(''); setNewMsgName(''); }}
                className="flex-1 py-2.5 bg-[#2A2A2A] text-[#888] font-bold rounded-xl hover:bg-[#333] transition-colors btn-press"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
};

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidMount() {
    // Catch unhandled promise rejections
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      logger.error('Unhandled promise rejection:', event.reason);
      // @ts-ignore - setState exists on Component instance
      this.setState({
        hasError: true,
        error: event.reason instanceof Error ? event.reason : new Error(String(event.reason))
      });
      event.preventDefault();
    });
  }

  render() {
    // @ts-ignore - state exists on Component instance
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-8">
          <div className="max-w-md text-center">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-red-500 text-3xl">!</span>
            </div>
            <h1 className="text-white text-2xl font-bold mb-3">Something went wrong</h1>
            {/* @ts-ignore */}
            <p className="text-[#999] mb-6">{this.state.error?.message || 'An unexpected error occurred.'}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-[#FF8C00] text-black font-bold rounded-xl hover:bg-[#FF9F2A] transition-all btn-press hover:shadow-lg hover:shadow-[#FF8C00]/20"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    // @ts-ignore - props exists on Component instance
    return this.props.children;
  }
}

function App() {
  const wallets = useMemo(
    () => [
      new LeoWalletAdapter({
        appName: "Ghost Messenger",
      }),
    ],
    []
  );

  return (
    <ErrorBoundary>
      <WalletProvider
        wallets={wallets}
        decryptPermission={DecryptPermission.OnChainHistory}
        network={WalletAdapterNetwork.TestnetBeta}
        autoConnect={true}
      >
        <InnerApp />
      </WalletProvider>
    </ErrorBoundary>
  );
}

export default App;
