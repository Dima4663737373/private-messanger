import { hashAddress } from '../utils/aleo-utils';
import { useEffect, useRef, useState } from 'react';
import { Message, Room, PinnedMessage, RawMessage, RawRoom, RawRoomMessage } from '../types';
import { getQueuedMessages, dequeueMessage, enqueueMessage } from '../utils/offline-queue';
import { getCachedMessage, getCachedMessages, cacheMessage, removeCachedMessage, pruneExpired } from '../utils/message-cache';
import { fieldToString, fieldsToString } from '../utils/messageUtils';
import { encryptMessage, encryptRoomMessage, decryptRoomMessage, generateRoomKey, encryptRoomKeyForMember, decryptRoomKey } from '../utils/crypto';
import { getCachedKeys } from '../utils/key-derivation';
import { toast } from 'react-hot-toast';
import { API_CONFIG } from '../config';
import { safeBackendFetch } from '../utils/api-client';
import { useEncryptionWorker } from './useEncryptionWorker';
import { logger } from '../utils/logger';
import { setSessionToken } from '../utils/auth-store';
import nacl from 'tweetnacl';
import { decodeBase64 } from 'tweetnacl-util';
import { io, Socket } from 'socket.io-client';

export function useSync(
  address: string | null,
  onNewMessage: (msg: Message) => void,
  onMessageDeleted?: (msgId: string) => void,
  onMessageUpdated?: (msgId: string, newText: string, editedAt?: number, editCount?: number) => void,
  onReactionUpdate?: (msgId: string, reactions: Record<string, string[]>) => void,
  onRoomMessage?: (roomId: string, msg: Message) => void,
  onRoomCreated?: (room: Room) => void,
  onRoomDeleted?: (roomId: string) => void,
  onDMCleared?: (dialogHash: string) => void,
  onPinUpdate?: (contextId: string, pins: PinnedMessage[]) => void,
  onRoomMessageDeleted?: (roomId: string, messageId: string) => void,
  onRoomMessageEdited?: (roomId: string, messageId: string, text: string) => void,
  onDMSent?: (tempId: string, realId: string, dialogHash?: string) => void,
  onReadReceipt?: (dialogHash: string, messageIds: string[], readAt?: number) => void,
  onProfileUpdated?: (address: string, username?: string, showAvatar?: boolean, avatarCid?: string) => void
) {
  const ws = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, { ts: number; sender?: string }>>({}); // key -> { timestamp, sender? }
  const [blockedByUsers, setBlockedByUsers] = useState<string[]>([]); // addresses of users who blocked me
  const { decrypt, decryptAsSender } = useEncryptionWorker();

  // In-Memory Caches (bounded, cleared on refresh)
  const MAX_CACHE_SIZE = 1000;
  const MAX_KEY_CACHE_SIZE = 200;
  const decryptionCache = useRef<Map<string, string>>(new Map());
  const keyCache = useRef<Map<string, string>>(new Map());
  const roomKeyCache = useRef<Map<string, string>>(new Map()); // roomId -> decrypted symmetric key (base64)

  // Bounded cache set — evicts oldest entries when full
  const cacheSet = (cache: Map<string, string>, key: string, value: string, maxSize: number) => {
    if (cache.size >= maxSize) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) cache.delete(firstKey);
    }
    cache.set(key, value);
  };

  // Helper to get sender's encryption key (with retry for race conditions)
  const getSenderKey = async (senderAddr: string): Promise<string | null> => {
    // Skip invalid/placeholder addresses
    if (!senderAddr || senderAddr === 'unknown' || senderAddr.startsWith('hash:')) return null;

    // Return cached value only if it's a non-empty string
    const cached = keyCache.current.get(senderAddr);
    if (cached && cached.length > 0) return cached;

    // Fetch from backend (with retry — profile may still be registering)
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data } = await safeBackendFetch<any>(`profiles/${senderAddr}`, {
        mockFallback: { exists: false, profile: null }
      });

      if (data?.exists && data.profile?.encryption_public_key) {
        cacheSet(keyCache.current, senderAddr, data.profile.encryption_public_key, MAX_KEY_CACHE_SIZE);
        return data.profile.encryption_public_key;
      }

      // Wait before retry (profile registration may be in flight)
      if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
    }

    return null;
  };

  // Helper to decrypt - Unified logic using Worker
  // Check if raw payload looks like NaCl encrypted format (base64nonce.base64ciphertext)
  const isEncryptedFormat = (p: string): boolean => {
      if (!p || typeof p !== 'string') return false;
      const parts = p.split('.');
      if (parts.length !== 2) return false;
      const b64 = /^[A-Za-z0-9+/=]{16,}$/;
      return b64.test(parts[0]) && b64.test(parts[1]);
  };

  const decryptPayload = async (
      payload: string,
      sender: string,
      recipient: string,
      timestamp: number,
      payloadSelf?: string
  ): Promise<string> => {
      // Null/empty payload guard
      if (!payload || typeof payload !== 'string') return "[Encrypted Message]";

      // Check raw payload format BEFORE any processing
      const encrypted = isEncryptedFormat(payload);
      const isMine = sender === address;

      if (!address) return encrypted ? "[Encrypted Message]" : payload;

      try {
        const myKeys = getCachedKeys(address);
        if (!myKeys) return encrypted ? "[Encrypted Message]" : payload;
        const otherParty = isMine ? recipient : sender;

        // Strategy for "Encrypt to Self"
        if (isMine && payloadSelf) {
             try {
                const decryptedSelf = await decrypt(payloadSelf, myKeys.publicKey, myKeys.secretKey);
                if (decryptedSelf) return decryptedSelf;
             } catch (e) { /* ignore */ }
        }

        // fetch key if needed
        const otherKey = await getSenderKey(otherParty);

        if (otherKey) {
            if (isMine) {
                // I am the sender, decrypt using my secret + recipient public
                try {
                    const decrypted = await decryptAsSender(payload, otherKey, myKeys.secretKey);
                    if (decrypted) return decrypted;
                    logger.warn(`[Decrypt] decryptAsSender returned null for otherParty=${otherParty?.slice(0,10)}`);
                } catch (e) {
                    logger.warn(`[Decrypt] decryptAsSender error for otherParty=${otherParty?.slice(0,10)}:`, e);
                }
            } else {
                // I am the recipient, decrypt using sender public + my secret
                try {
                    const decrypted = await decrypt(payload, otherKey, myKeys.secretKey);
                    if (decrypted) return decrypted;
                    logger.warn(`[Decrypt] decrypt returned null for sender=${otherParty?.slice(0,10)}`);
                } catch (e) {
                    logger.warn(`[Decrypt] decrypt error for sender=${otherParty?.slice(0,10)}:`, e);
                }
            }
        } else {
            logger.warn(`[Decrypt] No encryption key for otherParty=${otherParty?.slice(0,10)} isMine=${isMine}`);
        }

        // Decryption failed — show clean placeholder for encrypted payloads
        if (encrypted) {
            return isMine ? "[Encrypted Sent Message]" : "[Encrypted Message]";
        }

        // Legacy plaintext fallback (non-encrypted Aleo field format)
        return fieldToString(payload);
      } catch (e) {
          return encrypted ? "[Encrypted Message]" : "[Encrypted Message]";
      }
  };

  // ── Room Key Helpers ──────────────────────────────

  /** Fetch and decrypt my room key from the backend */
  const getRoomKey = async (roomId: string): Promise<string | null> => {
    // Check cache first
    const cached = roomKeyCache.current.get(roomId);
    if (cached) return cached;

    if (!address) return null;
    const myKeys = getCachedKeys(address);
    if (!myKeys) return null;

    const { data } = await safeBackendFetch<any>(`rooms/${roomId}/keys`);
    if (!data || !data.exists) return null;

    const decrypted = decryptRoomKey(
      data.encrypted_room_key,
      data.nonce,
      data.sender_public_key,
      myKeys.secretKey
    );
    if (decrypted) {
      roomKeyCache.current.set(roomId, decrypted);
    }
    return decrypted;
  };

  /** Generate a room key and distribute to all members */
  const distributeRoomKey = async (roomId: string, roomSymKey?: string): Promise<string | null> => {
    if (!address) return null;
    const myKeys = getCachedKeys(address);
    if (!myKeys) return null;

    const symKey = roomSymKey || generateRoomKey();

    // Fetch all members with their public keys
    const { data: members } = await safeBackendFetch<any[]>(`rooms/${roomId}/members`);
    if (!members || !Array.isArray(members)) return null;

    const keysPayload: Array<{ userAddress: string; encryptedRoomKey: string; nonce: string; senderPublicKey: string }> = [];
    for (const member of members) {
      if (!member.encryption_public_key) continue;
      const { encryptedRoomKey, nonce } = encryptRoomKeyForMember(
        symKey,
        member.encryption_public_key,
        myKeys.secretKey
      );
      keysPayload.push({
        userAddress: member.address,
        encryptedRoomKey,
        nonce,
        senderPublicKey: myKeys.publicKey
      });
    }

    if (keysPayload.length > 0) {
      await safeBackendFetch(`rooms/${roomId}/keys`, {
        method: 'POST',
        body: { keys: keysPayload }
      });
    }

    roomKeyCache.current.set(roomId, symKey);
    return symKey;
  };

  /** Try to decrypt room message text, falling back to plaintext for legacy messages */
  const decryptRoomText = async (roomId: string, text: string): Promise<string> => {
    // Check if it looks like an encrypted payload (nonce.ciphertext, both base64)
    const parts = text.split('.');
    const isBase64 = /^[A-Za-z0-9+/=]{16,}$/;
    if (parts.length !== 2 || !isBase64.test(parts[0]) || !isBase64.test(parts[1])) {
      return text; // Plaintext (legacy message)
    }

    const roomSymKey = await getRoomKey(roomId);
    if (!roomSymKey) return '[Encrypted Room Message]';

    const decrypted = decryptRoomMessage(text, roomSymKey);
    return decrypted || '[Decryption Failed]';
  };

  // Callbacks Ref
  const callbacksRef = useRef({ onNewMessage, onMessageDeleted, onMessageUpdated, onReactionUpdate, onRoomMessage, onRoomCreated, onRoomDeleted, onDMCleared, onPinUpdate, onRoomMessageDeleted, onRoomMessageEdited, onDMSent, onReadReceipt, onProfileUpdated });
  useEffect(() => {
      callbacksRef.current = { onNewMessage, onMessageDeleted, onMessageUpdated, onReactionUpdate, onRoomMessage, onRoomCreated, onRoomDeleted, onDMCleared, onPinUpdate, onRoomMessageDeleted, onRoomMessageEdited, onDMSent, onReadReceipt, onProfileUpdated };
  }, [onNewMessage, onMessageDeleted, onMessageUpdated, onReactionUpdate, onRoomMessage, onRoomCreated, onRoomDeleted, onDMCleared, onPinUpdate, onRoomMessageDeleted, onRoomMessageEdited, onDMSent, onReadReceipt, onProfileUpdated]);

  // ── Socket.io Connection ──────────────────────────────
  useEffect(() => {
    if (!address) return;

    const socket = io(API_CONFIG.BACKEND_BASE, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      timeout: 10000,
    });
    ws.current = socket;

    // ── Connection established — start auth flow ──
    socket.on('connect', () => {
      logger.debug('Socket.io Connected - Authenticating...');
      socket.emit('AUTH', { address });
    });

    // ── Step 2a: Server sends NaCl-encrypted challenge ──
    socket.on('AUTH_CHALLENGE', async (data: { encryptedChallenge: string; nonce: string; serverPublicKey: string }) => {
      try {
        const myKeys = getCachedKeys(address);
        if (!myKeys) {
          logger.warn('Cannot respond to AUTH_CHALLENGE — keys not derived yet, requesting limited token');
          socket.emit('AUTH_KEY_MISMATCH', { address });
          return;
        }
        const encrypted = decodeBase64(data.encryptedChallenge);
        const nonce = decodeBase64(data.nonce);
        const serverPubKey = decodeBase64(data.serverPublicKey);
        const mySecretKey = decodeBase64(myKeys.secretKey);

        const decrypted = nacl.box.open(encrypted, nonce, serverPubKey, mySecretKey);
        if (!decrypted) {
          logger.warn('AUTH_CHALLENGE decryption failed (keys may have changed), requesting limited token');
          socket.emit('AUTH_KEY_MISMATCH', { address });
          return;
        }
        const decryptedChallenge = new TextDecoder().decode(decrypted);
        socket.emit('AUTH_RESPONSE', { decryptedChallenge });
      } catch (e) {
        logger.error('AUTH_CHALLENGE handling failed:', e);
        socket.emit('AUTH_KEY_MISMATCH', { address });
      }
    });

    // ── Step 2b: Authentication succeeded ──
    socket.on('AUTH_SUCCESS', async (data: { token?: string; requiresProfile?: boolean }) => {
      logger.debug('Socket.io Authenticated successfully');
      if (data.token) {
        setSessionToken(data.token);
      }
      setIsConnected(true);

      // Limited session — auto-register profile to upgrade to full access
      if (data.requiresProfile) {
        logger.info('Limited session — auto-registering profile to upgrade...');
        const keys = getCachedKeys(address);
        if (keys?.publicKey) {
          let addrHash = '';
          try { addrHash = hashAddress(address); } catch { /* ignore */ }
          safeBackendFetch('profiles', {
            method: 'POST',
            body: {
              address,
              encryptionPublicKey: keys.publicKey,
              addressHash: addrHash,
            }
          }).then(res => {
            if (res.error) {
              logger.warn('Auto profile registration failed:', res.error);
            } else {
              logger.info('✅ Profile updated with new encryption key — reconnecting...');
              toast.success('Encryption keys updated. Reconnecting...', { duration: 3000 });
              // Disconnect and reconnect to get proper AUTH_CHALLENGE with updated key
              setTimeout(() => { socket.disconnect(); socket.connect(); }, 1000);
            }
          }).catch(e => logger.error('Auto profile registration error:', e));
        } else {
          logger.warn('No encryption keys cached — cannot upgrade session');
        }
      }

      // Step 3: Subscribe to channels after successful auth
      try {
        const addressHash = hashAddress(address);
        socket.emit('SUBSCRIBE', { address, addressHash });
      } catch (e) {
        logger.error("Failed to hash address for WS subscription:", e);
        socket.emit('SUBSCRIBE', { address });
      }

      // Fetch who blocked me
      safeBackendFetch<{ blockedBy: string[] }>(`blocked-by/${address}`)
        .then(res => { if (res.data?.blockedBy) setBlockedByUsers(res.data.blockedBy); })
        .catch(() => {});

      // Flush offline queue after reconnection
      getQueuedMessages().then(async (queued) => {
        if (queued.length === 0) return;
        logger.info(`[OfflineQueue] Flushing ${queued.length} queued messages...`);
        for (const msg of queued) {
          try {
            if (socket.connected) {
              socket.emit('DM_MESSAGE', {
                sender: address,
                senderHash: msg.senderHash,
                recipientHash: msg.recipientHash,
                dialogHash: msg.dialogHash,
                encryptedPayload: msg.encryptedPayload || '',
                encryptedPayloadSelf: msg.encryptedPayloadSelf || '',
                timestamp: msg.timestamp,
                attachmentPart1: msg.attachmentCID || '',
                attachmentPart2: '',
                tempId: msg.id
              });
              await dequeueMessage(msg.id);
              logger.debug(`[OfflineQueue] Flushed message: ${msg.id}`);
            }
          } catch (err) {
            logger.error('[OfflineQueue] Failed to flush message:', err);
          }
        }
      }).catch(err => logger.error('[OfflineQueue] Flush error:', err));
    });

    socket.on('AUTH_FAILED', (data: { message?: string }) => {
      logger.error('Socket.io Authentication failed:', data.message);
      setSessionToken(null);
      toast.error('WebSocket authentication failed');
      setIsConnected(false);
      socket.disconnect();
    });

    // ── Reaction update ──
    socket.on('REACTION_UPDATE', (data: { messageId: string; reactions: Record<string, string[]> }) => {
      if (callbacksRef.current.onReactionUpdate) {
        callbacksRef.current.onReactionUpdate(data.messageId, data.reactions);
      }
    });

    // ── Typing indicator ──
    socket.on('TYPING', (data: { dialogHash: string }) => {
      const { dialogHash } = data;
      setTypingUsers(prev => ({ ...prev, [dialogHash]: { ts: Date.now() } }));
      setTimeout(() => {
        setTypingUsers(prev => {
          const copy = { ...prev };
          if (copy[dialogHash] && Date.now() - copy[dialogHash].ts > 2500) {
            delete copy[dialogHash];
          }
          return copy;
        });
      }, 3000);
    });

    // ── Room events ──
    socket.on('room_message', async (data: { roomId: string; id: string; sender: string; senderName: string; text: string; timestamp: number }) => {
      const { roomId, id, sender, senderName, text, timestamp } = data;
      if (callbacksRef.current.onRoomMessage) {
        const decryptedText = await decryptRoomText(roomId, text);
        callbacksRef.current.onRoomMessage(roomId, {
          id,
          text: decryptedText,
          time: new Date(Number(timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          senderId: sender === address ? 'me' : sender,
          isMine: sender === address,
          status: 'sent',
          timestamp: Number(timestamp),
          senderHash: senderName || sender?.slice(0, 10)
        });
      }
    });

    socket.on('room_created', (data: any) => {
      if (callbacksRef.current.onRoomCreated) {
        const r = data.room || data;
        callbacksRef.current.onRoomCreated({
          id: r.id, name: r.name, createdBy: r.created_by,
          isPrivate: r.is_private, type: r.type, memberCount: r.memberCount || 1
        });
      }
    });

    socket.on('room_deleted', (data: { roomId: string }) => {
      if (callbacksRef.current.onRoomDeleted) {
        callbacksRef.current.onRoomDeleted(data.roomId);
      }
      roomKeyCache.current.delete(data.roomId);
    });

    // When a new member joins — distribute room key to them if I have it
    socket.on('room_member_joined', (data: { roomId: string; address: string }) => {
      if (data.address !== address) {
        const cachedKey = roomKeyCache.current.get(data.roomId);
        if (cachedKey) {
          distributeRoomKey(data.roomId, cachedKey).catch(e => logger.warn('distributeRoomKey failed:', e));
        }
      }
    });

    socket.on('dm_cleared', (data: { dialogHash: string }) => {
      if (callbacksRef.current.onDMCleared) {
        callbacksRef.current.onDMCleared(data.dialogHash);
      }
    });

    socket.on('room_message_deleted', (data: { roomId: string; messageId: string }) => {
      if (callbacksRef.current.onRoomMessageDeleted) {
        callbacksRef.current.onRoomMessageDeleted(data.roomId, data.messageId);
      }
    });

    socket.on('room_message_edited', async (data: { roomId: string; messageId: string; text: string }) => {
      if (callbacksRef.current.onRoomMessageEdited) {
        const decryptedText = await decryptRoomText(data.roomId, data.text);
        callbacksRef.current.onRoomMessageEdited(data.roomId, data.messageId, decryptedText);
      }
    });

    socket.on('room_typing', (data: { roomId: string; sender: string }) => {
      const key = `room:${data.roomId}`;
      setTypingUsers(prev => ({ ...prev, [key]: { ts: Date.now(), sender: data.sender } }));
      setTimeout(() => {
        setTypingUsers(prev => {
          const copy = { ...prev };
          if (copy[key] && Date.now() - copy[key].ts > 2500) delete copy[key];
          return copy;
        });
      }, 3000);
    });

    socket.on('pin_update', (data: { contextId: string; pins: PinnedMessage[] }) => {
      if (callbacksRef.current.onPinUpdate) {
        callbacksRef.current.onPinUpdate(data.contextId, data.pins);
      }
    });

    socket.on('dm_sent', (data: { tempId: string; id: string; dialogHash: string }) => {
      if (callbacksRef.current.onDMSent) {
        callbacksRef.current.onDMSent(data.tempId, data.id, data.dialogHash);
      }
    });

    // ── Read receipt ──
    socket.on('READ_RECEIPT', (data: { dialogHash: string; messageIds: string[]; readAt?: number }) => {
      if (callbacksRef.current.onReadReceipt) {
        callbacksRef.current.onReadReceipt(data.dialogHash, data.messageIds, data.readAt);
      }
    });

    socket.on('profile_detected', (data: any) => {
      toast(`${data.username || 'User'} updated their profile`, { icon: '👤' });
      if (data.address) {
        keyCache.current.delete(data.address);
        if (callbacksRef.current.onProfileUpdated) {
          callbacksRef.current.onProfileUpdated(data.address, data.username, data.showAvatar, data.avatarCid);
        }
      }
    });

    socket.on('blocked_by_user', (data: { address: string }) => {
      const blockerAddr = data.address;
      if (blockerAddr) {
        setBlockedByUsers(prev => prev.includes(blockerAddr) ? prev : [...prev, blockerAddr]);
        toast('A user has blocked you', { icon: '🚫' });
      }
    });

    socket.on('unblocked_by_user', (data: { address: string }) => {
      const unblockerAddr = data.address;
      if (unblockerAddr) {
        setBlockedByUsers(prev => prev.filter(a => a !== unblockerAddr));
        toast('A user has unblocked you', { icon: '✅' });
      }
    });

    socket.on('message_deleted', (data: { id: string }) => {
      if (callbacksRef.current.onMessageDeleted) {
        callbacksRef.current.onMessageDeleted(data.id);
      }
      removeCachedMessage(data.id).catch(() => {});
    });

    socket.on('message_updated', async (data: { id: string; encryptedPayload: string; sender: string; recipient: string; timestamp: number; encryptedPayloadSelf?: string; editedAt?: number; editCount?: number }) => {
      const { id, encryptedPayload, sender, recipient, timestamp, encryptedPayloadSelf, editedAt, editCount } = data;
      const text = await decryptPayload(encryptedPayload, sender, recipient, timestamp, encryptedPayloadSelf);
      if (text) cacheSet(decryptionCache.current, id, text, MAX_CACHE_SIZE);
      if (callbacksRef.current.onMessageUpdated) {
        callbacksRef.current.onMessageUpdated(id, text || "Decryption Failed", editedAt, editCount);
      }
    });

    // ── Bulk delivery of messages received while offline ──
    socket.on('pending_messages', async (messages: any[]) => {
      if (!Array.isArray(messages)) return;
      for (const rawMsg of messages) {
        // Cache encryption key if provided
        if (rawMsg.senderEncryptionKey && rawMsg.senderEncryptionKey.length > 10 && rawMsg.sender !== address) {
          cacheSet(keyCache.current, rawMsg.sender, rawMsg.senderEncryptionKey, MAX_KEY_CACHE_SIZE);
        }

        // Decrypt (check caches first)
        let text = decryptionCache.current.get(rawMsg.id);
        if (!text) {
          text = await getCachedMessage(rawMsg.id).catch(() => null) || undefined;
        }
        if (!text) {
          text = await decryptPayload(
            rawMsg.encryptedPayload,
            rawMsg.sender,
            rawMsg.recipient,
            rawMsg.timestamp,
            rawMsg.encryptedPayloadSelf
          );
          if (text) {
            cacheSet(decryptionCache.current, rawMsg.id, text, MAX_CACHE_SIZE);
            cacheMessage(rawMsg.id, text, Number(rawMsg.timestamp)).catch(() => {});
          }
        } else if (!decryptionCache.current.has(rawMsg.id)) {
          cacheSet(decryptionCache.current, rawMsg.id, text, MAX_CACHE_SIZE);
        }

        const msg = {
          id: rawMsg.id,
          text: text || '[Encrypted message]',
          time: new Date(Number(rawMsg.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          senderId: rawMsg.sender === address ? 'me' : rawMsg.sender,
          isMine: rawMsg.sender === address,
          status: rawMsg.status || 'included',
          recipient: rawMsg.recipient,
          timestamp: Number(rawMsg.timestamp),
          senderHash: rawMsg.senderHash,
          recipientHash: rawMsg.recipientHash,
          dialogHash: rawMsg.dialogHash,
          replyToId: rawMsg.replyToId || undefined,
          replyToText: rawMsg.replyToText || undefined,
          replyToSender: rawMsg.replyToSender || undefined,
          encryptedPayload: rawMsg.encryptedPayload,
          encryptedPayloadSelf: rawMsg.encryptedPayloadSelf,
          _silent: true, // suppress toasts/sounds in handleNewMessage
        };
        callbacksRef.current.onNewMessage(msg as any);
      }
    });

    // ── New message detected (real-time DM or blockchain) ──
    socket.on('message_detected', async (rawMsg: any) => {
      const isMine = rawMsg.sender === address;
      logger.debug(`[WS] message_detected id=${rawMsg.id?.slice(0,8)} from=${rawMsg.sender?.slice(0,10)} to=${rawMsg.recipient?.slice(0,10)} isMine=${isMine} hasEncKey=${!!rawMsg.senderEncryptionKey}`);

      // Cache sender's encryption key from payload (avoids extra REST call)
      if (rawMsg.senderEncryptionKey && rawMsg.senderEncryptionKey.length > 10 && rawMsg.sender && rawMsg.sender !== address) {
        cacheSet(keyCache.current, rawMsg.sender, rawMsg.senderEncryptionKey, MAX_KEY_CACHE_SIZE);
      }

      let text = decryptionCache.current.get(rawMsg.id);
      if (!text) {
        text = await getCachedMessage(rawMsg.id).catch(() => null) || undefined;
      }
      if (!text) {
        text = await decryptPayload(
            rawMsg.encryptedPayload || rawMsg.content_encrypted,
            rawMsg.sender,
            rawMsg.recipient,
            rawMsg.timestamp,
            rawMsg.encryptedPayloadSelf || rawMsg.encrypted_payload_self
        );
        if (text) {
          cacheSet(decryptionCache.current, rawMsg.id, text, MAX_CACHE_SIZE);
          cacheMessage(rawMsg.id, text, Number(rawMsg.timestamp)).catch(() => {});
        }
        if (!text || text.includes('[Encrypted')) {
          logger.warn(`[Decrypt] Failed for msg ${rawMsg.id?.slice(0,8)}: sender=${rawMsg.sender?.slice(0,10)} recipient=${rawMsg.recipient?.slice(0,10)} isMine=${isMine} hasSenderKey=${!!rawMsg.senderEncryptionKey}`);
        }
      } else if (!decryptionCache.current.has(rawMsg.id)) {
        cacheSet(decryptionCache.current, rawMsg.id, text, MAX_CACHE_SIZE);
      }

      let attachment = undefined;
      if (rawMsg.attachment_part1 && rawMsg.attachment_part1 !== "0field") {
          const cid = fieldsToString([rawMsg.attachment_part1, rawMsg.attachment_part2 || "0field"]);
          if (cid) {
              attachment = {
                  type: 'file' as const,
                  cid: cid,
                  name: 'Attachment',
                  size: 0
              };
          }
      }

      const msg: Message & { recipient: string; encryptedPayload?: string; encryptedPayloadSelf?: string } = {
        id: rawMsg.id,
        text: text || "Decryption Failed",
        time: new Date(Number(rawMsg.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        senderId: rawMsg.sender === address ? 'me' : rawMsg.sender,
        isMine: rawMsg.sender === address,
        status: rawMsg.status || 'included',
        recipient: rawMsg.recipient,
        timestamp: Number(rawMsg.timestamp),
        attachment,
        senderHash: rawMsg.senderHash,
        recipientHash: rawMsg.recipientHash,
        dialogHash: rawMsg.dialogHash,
        replyToId: rawMsg.replyToId || rawMsg.reply_to_id || undefined,
        replyToText: rawMsg.replyToText || rawMsg.reply_to_text || undefined,
        replyToSender: rawMsg.replyToSender || rawMsg.reply_to_sender || undefined,
        encryptedPayload: rawMsg.encryptedPayload || rawMsg.content_encrypted,
        encryptedPayloadSelf: rawMsg.encryptedPayloadSelf || rawMsg.encrypted_payload_self
      };

      callbacksRef.current.onNewMessage(msg);

      // Browser notification when tab is in background
      if (!msg.isMine && document.hidden && Notification.permission === 'granted') {
        try {
          const senderName = rawMsg.senderName || rawMsg.sender?.slice(0, 10) || 'Someone';
          new Notification('Ghost Messenger', {
            body: `${senderName}: ${(text || '').slice(0, 60)}`,
            icon: '/ghost-icon.png',
            tag: `msg-${rawMsg.id}`,
          });
        } catch { /* ignore */ }
      }
    });

    // ── Blockchain confirmation ──
    socket.on('tx_confirmed', (data: { id: string; blockHeight: number }) => {
      callbacksRef.current.onNewMessage({ id: data.id, status: 'included' } as any);
    });

    socket.on('connect_error', (err: Error) => {
      logger.error('Socket.io connect error:', err.message);
    });

    socket.on('disconnect', (reason: string) => {
      logger.debug('Socket.io disconnected:', reason);
      setIsConnected(false);
      setSessionToken(null);
    });

    return () => {
      socket.disconnect();
      ws.current = null;
      setSessionToken(null);
    };
  }, [address]);

  // Only used for initial load or manual resync
  const fetchMessages = async (options?: number | { since?: number; limit?: number; offset?: number }) => {
    if (!address) return [];

    try {
      const params = new URLSearchParams();
    const opts = typeof options === 'number' ? { since: options } : (options || {});

    if (opts.since) params.append('since', String(opts.since));
    if (opts.limit) params.append('limit', String(opts.limit));
    if (opts.offset) params.append('offset', String(opts.offset));

    const { data: rawMessages } = await safeBackendFetch<any[]>(`messages/${address}?${params.toString()}`);

    if (!rawMessages || !Array.isArray(rawMessages)) return [];

    // Async Map for Decryption
    const decryptedMessages = await Promise.all(rawMessages.map(async (rawMsg: RawMessage) => {
        let text = decryptionCache.current.get(rawMsg.id);

        if (!text) {
             const payload = rawMsg.encrypted_payload || rawMsg.content_encrypted;
             text = await decryptPayload(
                 payload,
                 rawMsg.sender,
                 rawMsg.recipient,
                 rawMsg.timestamp,
                 rawMsg.encrypted_payload_self
            );
             if (text) cacheSet(decryptionCache.current, rawMsg.id, text, MAX_CACHE_SIZE);
        }

        let attachment = undefined;
        if (rawMsg.attachment_part1 && rawMsg.attachment_part1 !== "0field") {
            const cid = fieldsToString([rawMsg.attachment_part1, rawMsg.attachment_part2 || "0field"]);
            if (cid) {
                attachment = {
                    type: 'file' as const,
                    cid: cid,
                    name: 'Attachment',
                    size: 0
                };
            }
        }

        return {
          id: rawMsg.id,
          text: text,
          time: new Date(Number(rawMsg.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          senderId: rawMsg.sender === address ? 'me' : rawMsg.sender,
          isMine: rawMsg.sender === address,
          status: rawMsg.status,
          timestamp: Number(rawMsg.timestamp),
          recipient: rawMsg.recipient,
          attachment,
          edited: rawMsg.edit_count > 0 || !!rawMsg.edited_at,
          editedAt: rawMsg.edited_at ? Number(rawMsg.edited_at) : undefined,
          editCount: rawMsg.edit_count ? Number(rawMsg.edit_count) : undefined,
        };
      }));

      return decryptedMessages;
    } catch (e) {
      logger.error('Fetch messages failed:', e);
      return [];
    }
  };

  // Fetch Dialogs (Conversations) - Decrypted
  const fetchDialogs = async (addressHash: string) => {
    try {
        const { data: rawDialogs } = await safeBackendFetch<any[]>(`dialogs/${addressHash}`);
        if (!rawDialogs || !Array.isArray(rawDialogs)) return [];

        // Decrypt the last message of each dialog to show previews
        const decryptedDialogs = await Promise.all(rawDialogs.map(async (rawMsg: RawMessage) => {
          try {
             let text = decryptionCache.current.get(rawMsg.id);
             if (!text) {
                 const payload = rawMsg.encrypted_payload || rawMsg.content_encrypted;
                 text = await decryptPayload(
                     payload,
                     rawMsg.sender,
                     rawMsg.recipient,
                     rawMsg.timestamp,
                     rawMsg.encrypted_payload_self
                 );
                 if (text) cacheSet(decryptionCache.current, rawMsg.id, text, MAX_CACHE_SIZE);
             }
             return { ...rawMsg, text: text || "Encrypted Message" };
          } catch (e) {
             logger.error(`Failed to decrypt dialog msg ${rawMsg.id}:`, e);
             return { ...rawMsg, text: "Encrypted Message" };
          }
        }));

        return decryptedDialogs;
    } catch (e) {
        logger.error('Fetch dialogs failed:', e);
        return [];
    }
  };

  // Fetch Messages for a specific Dialog
  const fetchDialogMessages = async (dialogHash: string, options?: { limit?: number; offset?: number }) => {
      try {
        const params = new URLSearchParams();
        if (options?.limit) params.append('limit', String(options.limit));
        if (options?.offset) params.append('offset', String(options.offset));

        // Use the general messages endpoint which now supports dialogHash
        const { data: rawMessages } = await safeBackendFetch<any[]>(`messages/${dialogHash}?${params.toString()}`);
        if (!rawMessages || !Array.isArray(rawMessages)) return [];

        // Fetch reactions in batch for all messages (non-blocking)
        const messageIds = rawMessages.map((m: RawMessage) => m.id);
        const allReactions = await fetchReactionsBatch(messageIds).catch(e => {
          logger.error('Failed to fetch reactions batch:', e);
          return {} as Record<string, Record<string, string[]>>;
        });

        // Pre-fetch counterparty encryption key to avoid N+1 REST calls during decrypt
        const senders = new Set(rawMessages.map((m: RawMessage) => m.sender === address ? m.recipient : m.sender).filter(a => a && a !== 'unknown'));
        await Promise.all([...senders].map(addr => getSenderKey(addr)));

        // Pre-load IndexedDB cache for all message IDs
        const idbCache = await getCachedMessages(messageIds).catch(() => new Map<string, string>());

        const decryptedMessages = (await Promise.all(rawMessages.map(async (rawMsg: RawMessage) => {
          try {
            // Check in-memory cache → IndexedDB cache → decrypt
            let text = decryptionCache.current.get(rawMsg.id) || idbCache.get(rawMsg.id);
            if (!text) {
                 const payload = rawMsg.encrypted_payload || rawMsg.content_encrypted;
                 text = await decryptPayload(
                     payload,
                     rawMsg.sender,
                     rawMsg.recipient,
                     rawMsg.timestamp,
                     rawMsg.encrypted_payload_self
                 );
                 if (text) {
                   cacheSet(decryptionCache.current, rawMsg.id, text, MAX_CACHE_SIZE);
                   // Persist to IndexedDB for cross-session cache
                   cacheMessage(rawMsg.id, text, Number(rawMsg.timestamp)).catch(() => {});
                 }
            } else if (!decryptionCache.current.has(rawMsg.id)) {
                 // Restore in-memory cache from IndexedDB hit
                 cacheSet(decryptionCache.current, rawMsg.id, text, MAX_CACHE_SIZE);
            }

            let attachment = undefined;
            if (rawMsg.attachment_part1 && rawMsg.attachment_part1 !== "0field") {
                const cid = fieldsToString([rawMsg.attachment_part1, rawMsg.attachment_part2 || "0field"]);
                if (cid) {
                    attachment = {
                        type: 'file' as const,
                        cid: cid,
                        name: 'Attachment',
                        size: 0
                    };
                }
            }

            return {
              id: rawMsg.id,
              text: text,
              time: new Date(Number(rawMsg.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              senderId: rawMsg.sender === address ? 'me' : rawMsg.sender,
              isMine: rawMsg.sender === address,
              status: rawMsg.status || 'sent',
              timestamp: Number(rawMsg.timestamp),
              readAt: rawMsg.read_at ? Number(rawMsg.read_at) : undefined,
              recipient: rawMsg.recipient,
              attachment,
              reactions: allReactions[rawMsg.id] || undefined,
              replyToId: rawMsg.reply_to_id || undefined,
              replyToText: rawMsg.reply_to_text || undefined,
              replyToSender: rawMsg.reply_to_sender || undefined,
              edited: rawMsg.edit_count > 0 || !!rawMsg.edited_at,
              editedAt: rawMsg.edited_at ? Number(rawMsg.edited_at) : undefined,
              editCount: rawMsg.edit_count ? Number(rawMsg.edit_count) : undefined,
            };
          } catch (e) {
            logger.error(`Failed to decrypt message ${rawMsg.id}:`, e);
            return null;
          }
        }))).filter((m): m is NonNullable<typeof m> => m !== null);

        return decryptedMessages;
      } catch (e) {
          logger.error('Fetch dialog messages failed:', e);
          return [];
      }
  };




  const searchProfiles = async (query: string) => {
    const { data } = await safeBackendFetch<any[]>(`profiles/search?q=${encodeURIComponent(query)}`);
    return data || [];
  };

  const syncProfile = async (addr: string) => {
    const { data } = await safeBackendFetch<any>(`profiles/${addr}`, {
      mockFallback: { exists: false, profile: null }
    });
    return data && data.exists ? data.profile : null;
  };

  const notifyProfileUpdate = async (name: string, bio: string, txId: string, privacySettings?: { showLastSeen?: boolean; showProfilePhoto?: boolean }, extra?: { avatarCid?: string | null }) => {
    if (!address) return;
    const keys = getCachedKeys(address);
    let addressHash = '';
    try { addressHash = hashAddress(address); } catch { /* ignore */ }

    const { error } = await safeBackendFetch('profiles', {
      method: 'POST',
      body: {
          address,
          name,
          bio,
          txId,
          encryptionPublicKey: keys?.publicKey || '',
          addressHash,
          ...(privacySettings || {}),
          ...(extra || {})
      }
    });
    if (error) logger.warn('notifyProfileUpdate failed:', error);
  };

  const cacheDecryptedMessage = (id: string, text: string) => {
    cacheSet(decryptionCache.current, id, text, MAX_CACHE_SIZE);
  };

  // --- Reactions API ---
  const addReaction = async (messageId: string, emoji: string) => {
    if (!address) return;
    const { error } = await safeBackendFetch('reactions', {
      method: 'POST',
      body: { messageId, userAddress: address, emoji }
    });
    if (error) {
      logger.warn('addReaction failed:', error);
      toast.error('Failed to add reaction');
    }
  };

  const removeReaction = async (messageId: string, emoji: string) => {
    if (!address) return;
    const { error } = await safeBackendFetch('reactions', {
      method: 'DELETE',
      body: { messageId, userAddress: address, emoji }
    });
    if (error) {
      logger.warn('removeReaction failed:', error);
      toast.error('Failed to remove reaction');
    }
  };

  const fetchReactions = async (messageId: string): Promise<Record<string, string[]>> => {
    const { data } = await safeBackendFetch<Record<string, string[]>>(`reactions/${messageId}`);
    return data || {};
  };

  /** Fetch reactions for multiple messages in a single request */
  const fetchReactionsBatch = async (messageIds: string[]): Promise<Record<string, Record<string, string[]>>> => {
    if (messageIds.length === 0) return {};
    const { data } = await safeBackendFetch<Record<string, Record<string, string[]>>>('reactions/batch', {
      method: 'POST',
      body: { messageIds }
    });
    return data || {};
  };

  // Send typing indicator (debounced by caller)
  const sendTyping = (dialogHash: string) => {
    if (ws.current?.connected && address) {
      try {
        const senderHash = hashAddress(address);
        ws.current.emit('TYPING', { dialogHash, senderHash });
      } catch { /* ignore */ }
    }
  };

  // Send read receipt for messages in a dialog
  const sendReadReceipt = (dialogHash: string, messageIds: string[]) => {
    if (ws.current?.connected && address && messageIds.length > 0) {
      try {
        const senderHash = hashAddress(address);
        ws.current.emit('READ_RECEIPT', { dialogHash, senderHash, messageIds });
      } catch { /* ignore */ }
    }
  };

  // --- Room API ---
  const fetchRooms = async (type: 'channel' | 'group'): Promise<Room[]> => {
    const params = new URLSearchParams({ type });
    if (type === 'group' && address) params.append('address', address);
    const { data } = await safeBackendFetch<any[]>(`rooms?${params.toString()}`);
    if (!data || !Array.isArray(data)) return [];
    return data.map((r: RawRoom) => ({
      id: r.id, name: r.name, createdBy: r.created_by,
      isPrivate: r.is_private, type: r.type, memberCount: r.memberCount || 0,
      lastMessage: r.lastMessage || undefined,
      lastMessageTime: r.lastMessageTime ? String(r.lastMessageTime) : undefined
    }));
  };

  const createRoom = async (name: string, type: 'channel' | 'group') => {
    if (!address) return null;
    const { data } = await safeBackendFetch<any>('rooms', {
      method: 'POST',
      body: { name, type, creatorAddress: address }
    });
    if (data && data.id) {
      // Generate and distribute room encryption key
      await distributeRoomKey(data.id);
    }
    return data;
  };

  const deleteRoom = async (roomId: string) => {
    if (!address) return;
    await safeBackendFetch(`rooms/${roomId}?address=${encodeURIComponent(address)}`, {
      method: 'DELETE'
    });
  };

  const renameRoom = async (roomId: string, name: string) => {
    if (!address) return;
    const { data } = await safeBackendFetch<any>(`rooms/${roomId}`, {
      method: 'PATCH',
      body: { name, address }
    });
    return data;
  };

  const joinRoom = async (roomId: string) => {
    if (!address) return;
    await safeBackendFetch(`rooms/${roomId}/join`, {
      method: 'POST',
      body: { address }
    });
    // Try to fetch room key (may have been distributed by another member)
    await getRoomKey(roomId);
  };

  const leaveRoom = async (roomId: string) => {
    if (!address) return;
    await safeBackendFetch(`rooms/${roomId}/leave`, {
      method: 'POST',
      body: { address }
    });
  };

  const fetchRoomInfo = async (roomId: string): Promise<{ members: string[] } | null> => {
    const { data } = await safeBackendFetch<any>(`rooms/${roomId}`);
    if (!data) return null;
    return { members: data.members || [] };
  };

  const fetchRoomMessages = async (roomId: string, limit = 100, offset = 0): Promise<Message[]> => {
    const { data } = await safeBackendFetch<any[]>(`rooms/${roomId}/messages?limit=${limit}&offset=${offset}`);
    if (!data || !Array.isArray(data)) return [];
    // Decrypt all room messages (per-message try/catch to prevent one failure from losing all)
    const results = await Promise.all(data.map(async (m: RawRoomMessage) => {
      try {
        const decryptedText = await decryptRoomText(roomId, m.text);
        return {
          id: m.id,
          text: decryptedText,
          time: new Date(Number(m.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          senderId: m.sender === address ? 'me' : m.sender,
          isMine: m.sender === address,
          status: 'sent' as const,
          timestamp: Number(m.timestamp),
          senderHash: m.sender_name || m.sender?.slice(0, 10)
        };
      } catch (e) {
        logger.error(`Failed to decrypt room message ${m.id}:`, e);
        return null;
      }
    }));
    return results.filter((m): m is NonNullable<typeof m> => m !== null);
  };

  const sendRoomMessage = async (roomId: string, text: string, senderName?: string) => {
    if (ws.current?.connected && address) {
      // Encrypt the message with the room symmetric key
      let encryptedText = text;
      const roomSymKey = await getRoomKey(roomId);
      if (roomSymKey) {
        encryptedText = encryptRoomMessage(text, roomSymKey);
      }
      ws.current.emit('ROOM_MESSAGE', {
        roomId, sender: address, senderName: senderName || '', text: encryptedText, timestamp: Date.now()
      });
    }
  };

  const subscribeRoom = (roomId: string) => {
    if (ws.current?.connected) {
      ws.current.emit('SUBSCRIBE_ROOM', { roomId });
    }
  };

  const deleteRoomMessage = async (roomId: string, msgId: string) => {
    if (!address) return;
    const { error } = await safeBackendFetch(`rooms/${roomId}/messages/${msgId}?address=${encodeURIComponent(address)}`, {
      method: 'DELETE'
    });
    if (error) logger.warn('deleteRoomMessage failed:', error);
  };

  const editRoomMessage = async (roomId: string, msgId: string, text: string) => {
    if (!address) return;
    // Encrypt the edited text with room key
    let encryptedText = text;
    const roomSymKey = await getRoomKey(roomId);
    if (roomSymKey) {
      encryptedText = encryptRoomMessage(text, roomSymKey);
    }
    const { error } = await safeBackendFetch(`rooms/${roomId}/messages/${msgId}/edit`, {
      method: 'POST',
      body: { address, text: encryptedText }
    });
    if (error) logger.warn('editRoomMessage failed:', error);
  };

  const sendRoomTyping = (roomId: string) => {
    if (ws.current?.connected && address) {
      ws.current.emit('ROOM_TYPING', { roomId, sender: address });
    }
  };

  const clearDMHistory = async (dialogHash: string) => {
    const { error, status } = await safeBackendFetch('rooms/dm-clear', {
      method: 'DELETE',
      body: { dialogHash }
    });
    if (error || (status !== 200 && status !== 0)) {
      throw new Error(error || `Clear history failed (status ${status})`);
    }
  };

  // --- Off-chain DM API ---

  // Prepare encrypted payload without sending (for wallet-first flow)
  const prepareDMMessage = async (recipientAddress: string, text: string, attachmentCID?: string, replyTo?: { id: string; text: string; sender: string }): Promise<{ tempId: string; encryptedPayload: string; encryptedPayloadSelf: string; timestamp: number; senderHash: string; recipientHash: string; dialogHash: string; replyToId?: string; replyToText?: string; replyToSender?: string } | null> => {
    if (!ws.current?.connected || !address) return null;

    const myKeys = getCachedKeys(address);
    if (!myKeys) { logger.error('Encryption keys not available'); return null; }
    const senderHash = hashAddress(address);
    const recipientHash = hashAddress(recipientAddress);

    const dialogHash = senderHash < recipientHash
      ? `${senderHash}_${recipientHash}`
      : `${recipientHash}_${senderHash}`;

    // Fetch recipient's encryption public key from profile
    let recipientPubKey = '';
    try {
      const { data } = await safeBackendFetch<any>(`profiles/${recipientAddress}`);
      if (data && data.exists && data.profile && data.profile.encryption_public_key) {
        recipientPubKey = data.profile.encryption_public_key;
      }
    } catch { /* ignore */ }

    let encryptedPayload = text;
    let encryptedPayloadSelf = '';

    if (recipientPubKey) {
      encryptedPayload = encryptMessage(text, recipientPubKey, myKeys.secretKey);
      encryptedPayloadSelf = encryptMessage(text, myKeys.publicKey, myKeys.secretKey);
    } else {
      logger.warn('No encryption key for recipient — sending plaintext via WS');
    }

    const tempId = `temp_${Date.now()}_${Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(36)).join('').slice(0, 8)}`;
    const timestamp = Date.now();

    return { tempId, encryptedPayload, encryptedPayloadSelf, timestamp, senderHash, recipientHash, dialogHash, replyToId: replyTo?.id, replyToText: replyTo?.text, replyToSender: replyTo?.sender };
  };

  // Actually send the prepared message via Socket.io (queues to offline queue on failure)
  const commitDMMessage = (prepared: NonNullable<Awaited<ReturnType<typeof prepareDMMessage>>>, attachmentCID?: string): boolean => {
    const queueMsg = () => {
      enqueueMessage({
        id: prepared.tempId,
        type: 'dm',
        recipientAddress: '', // resolved by recipientHash on flush
        text: '',
        encryptedPayload: prepared.encryptedPayload,
        encryptedPayloadSelf: prepared.encryptedPayloadSelf,
        senderHash: prepared.senderHash,
        recipientHash: prepared.recipientHash,
        dialogHash: prepared.dialogHash,
        timestamp: prepared.timestamp,
        attachmentCID: attachmentCID || undefined
      });
      logger.info('[OfflineQueue] Message queued for later delivery');
    };

    if (!ws.current?.connected || !address) {
      logger.warn('Socket.io not connected — queuing message offline');
      queueMsg();
      return false;
    }

    try {
      ws.current.emit('DM_MESSAGE', {
        sender: address,
        senderHash: prepared.senderHash,
        recipientHash: prepared.recipientHash,
        dialogHash: prepared.dialogHash,
        encryptedPayload: prepared.encryptedPayload,
        encryptedPayloadSelf: prepared.encryptedPayloadSelf,
        timestamp: prepared.timestamp,
        attachmentPart1: attachmentCID || '',
        attachmentPart2: '',
        tempId: prepared.tempId,
        replyToId: prepared.replyToId || '',
        replyToText: prepared.replyToText || '',
        replyToSender: prepared.replyToSender || ''
      });
      return true;
    } catch (e) {
      logger.error('Failed to send Socket.io message — queuing offline:', e);
      queueMsg();
      return false;
    }
  };

  // Legacy combined function (prepare + send in one call)
  const sendDMMessage = async (recipientAddress: string, text: string, attachmentCID?: string): Promise<{ tempId: string; encryptedPayload: string; timestamp: number } | null> => {
    const prepared = await prepareDMMessage(recipientAddress, text, attachmentCID);
    if (!prepared) return null;
    commitDMMessage(prepared, attachmentCID);
    return { tempId: prepared.tempId, encryptedPayload: prepared.encryptedPayload, timestamp: prepared.timestamp };
  };

  const deleteDMMessage = async (msgId: string) => {
    if (!address) return;
    const { error } = await safeBackendFetch(`messages/${msgId}?address=${encodeURIComponent(address)}`, {
      method: 'DELETE'
    });
    if (error) logger.warn('deleteDMMessage failed:', error);
  };

  const editDMMessage = async (msgId: string, newText: string, recipientAddress: string) => {
    if (!address) return;

    const myKeys = getCachedKeys(address);
    if (!myKeys) { logger.error('Encryption keys not available for edit'); return; }

    // Fetch recipient's encryption public key from profile
    let recipientPubKey = '';
    try {
      const { data } = await safeBackendFetch<any>(`profiles/${recipientAddress}`);
      if (data && data.exists && data.profile && data.profile.encryption_public_key) {
        recipientPubKey = data.profile.encryption_public_key;
      }
    } catch { /* ignore */ }

    let encryptedPayload = newText;
    let encryptedPayloadSelf = '';

    if (recipientPubKey) {
      encryptedPayload = encryptMessage(newText, recipientPubKey, myKeys.secretKey);
      encryptedPayloadSelf = encryptMessage(newText, myKeys.publicKey, myKeys.secretKey);
    }

    const { error } = await safeBackendFetch(`messages/${msgId}/edit`, {
      method: 'POST',
      body: { address, encryptedPayload, encryptedPayloadSelf }
    });
    if (error) logger.warn('editDMMessage failed:', error);
  };

  // --- Pins API ---
  const fetchPins = async (contextId: string) => {
    const { data } = await safeBackendFetch<any[]>(`pins/${encodeURIComponent(contextId)}`);
    return data || [];
  };

  const pinMessage = async (contextId: string, messageId: string, messageText: string) => {
    if (!address) return;
    const { error } = await safeBackendFetch('pins', {
      method: 'POST',
      body: { contextId, messageId, pinnedBy: address, messageText }
    });
    if (error) logger.warn('pinMessage failed:', error);
  };

  const unpinMessage = async (contextId: string, messageId: string) => {
    const { error } = await safeBackendFetch('pins', {
      method: 'DELETE',
      body: { contextId, messageId }
    });
    if (error) logger.warn('unpinMessage failed:', error);
  };

  // Fetch online status + lastSeen for a contact
  const fetchOnlineStatus = async (addressHash: string): Promise<{ online: boolean; lastSeen: number | null; showAvatar: boolean }> => {
    try {
      const { data } = await safeBackendFetch<any>(`online/${addressHash}`, {
        mockFallback: { online: false, lastSeen: null, showAvatar: true }
      });
      return data || { online: false, lastSeen: null, showAvatar: true };
    } catch {
      return { online: false, lastSeen: null, showAvatar: true };
    }
  };

  // Fetch link preview metadata for a URL
  const fetchLinkPreview = async (url: string): Promise<{ title: string | null; description: string | null; image: string | null; siteName: string | null }> => {
    try {
      const { data } = await safeBackendFetch<any>(`link-preview?url=${encodeURIComponent(url)}`, {
        mockFallback: { title: null, description: null, image: null, siteName: null }
      });
      return data || { title: null, description: null, image: null, siteName: null };
    } catch {
      return { title: null, description: null, image: null, siteName: null };
    }
  };

  // Heartbeat — keep lastSeen fresh on server (every 30s)
  useEffect(() => {
    if (!isConnected) return;
    const interval = setInterval(() => {
      if (ws.current?.connected) {
        ws.current.emit('HEARTBEAT');
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [isConnected]);

  // Periodic IndexedDB cache cleanup (every 30 min)
  useEffect(() => {
    const pruneInterval = setInterval(() => {
      pruneExpired().catch(() => {});
    }, 30 * 60 * 1000);
    // Run once on mount
    pruneExpired().catch(() => {});
    return () => clearInterval(pruneInterval);
  }, []);

  return {
    isConnected,
    typingUsers,
    fetchMessages,
    fetchDialogs,
    fetchDialogMessages,
    searchProfiles,
    syncProfile,
    notifyProfileUpdate,
    cacheDecryptedMessage,
    sendTyping,
    sendReadReceipt,
    addReaction,
    removeReaction,
    fetchReactions,
    // Room functions
    fetchRooms,
    createRoom,
    deleteRoom,
    renameRoom,
    joinRoom,
    leaveRoom,
    fetchRoomInfo,
    fetchRoomMessages,
    sendRoomMessage,
    subscribeRoom,
    sendRoomTyping,
    clearDMHistory,
    deleteRoomMessage,
    editRoomMessage,
    // Off-chain DM
    prepareDMMessage,
    commitDMMessage,
    sendDMMessage,
    deleteDMMessage,
    editDMMessage,
    // Pins
    fetchPins,
    pinMessage,
    unpinMessage,
    // Online status
    fetchOnlineStatus,
    // Link preview
    fetchLinkPreview,
    // Blocked by
    blockedByUsers
  };
}
