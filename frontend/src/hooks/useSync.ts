import { hashAddress } from '../utils/aleo-utils';
import { useEffect, useRef, useState } from 'react';
import { Message, Room, PinnedMessage, RawMessage, RawRoom, RawRoomMessage } from '../types';
import { getQueuedMessages, dequeueMessage, enqueueMessage } from '../utils/offline-queue';
import { fieldToString, fieldsToString } from '../utils/messageUtils';
import { encryptMessage, KeyPair, encryptRoomMessage, decryptRoomMessage, generateRoomKey, encryptRoomKeyForMember, decryptRoomKey } from '../utils/crypto';
import { getCachedKeys } from '../utils/key-derivation';
import { toast } from 'react-hot-toast';
import { API_CONFIG } from '../config';
import { safeBackendFetch } from '../utils/api-client';
import { useEncryptionWorker } from './useEncryptionWorker';
import { logger } from '../utils/logger';
import { setSessionToken } from '../utils/auth-store';
import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';

export function useSync(
  address: string | null,
  onNewMessage: (msg: Message) => void,
  onMessageDeleted?: (msgId: string) => void,
  onMessageUpdated?: (msgId: string, newText: string) => void,
  onReactionUpdate?: (msgId: string, reactions: Record<string, string[]>) => void,
  onRoomMessage?: (roomId: string, msg: Message) => void,
  onRoomCreated?: (room: Room) => void,
  onRoomDeleted?: (roomId: string) => void,
  onDMCleared?: (dialogHash: string) => void,
  onPinUpdate?: (contextId: string, pins: PinnedMessage[]) => void,
  onRoomMessageDeleted?: (roomId: string, messageId: string) => void,
  onRoomMessageEdited?: (roomId: string, messageId: string, text: string) => void,
  onDMSent?: (tempId: string, realId: string) => void,
  onReadReceipt?: (dialogHash: string, messageIds: string[]) => void,
  onProfileUpdated?: (address: string, username?: string, showAvatar?: boolean) => void
) {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, { ts: number; sender?: string }>>({}); // key -> { timestamp, sender? }
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

  // Helper to get sender's encryption key
  const getSenderKey = async (senderAddr: string): Promise<string | null> => {
    // Skip invalid/placeholder addresses
    if (!senderAddr || senderAddr === 'unknown' || senderAddr.startsWith('hash:')) return null;

    if (keyCache.current.has(senderAddr)) return keyCache.current.get(senderAddr)!;

    // Safe fetch handling 404
    const { data } = await safeBackendFetch<any>(`profiles/${senderAddr}`, {
      mockFallback: { exists: false, profile: null }
    });

    if (data && data.exists && data.profile && data.profile.encryption_public_key) {
       cacheSet(keyCache.current, senderAddr, data.profile.encryption_public_key, MAX_KEY_CACHE_SIZE);
       return data.profile.encryption_public_key;
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
                } catch (e) { /* ignore */ }
            } else {
                // I am the recipient, decrypt using sender public + my secret
                try {
                    const decrypted = await decrypt(payload, otherKey, myKeys.secretKey);
                    if (decrypted) return decrypted;
                } catch (e) { /* ignore */ }
            }
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

  useEffect(() => {
    if (!address) return;

    let reconnectTimer: ReturnType<typeof setTimeout>;
    let reconnectDelay = 1000; // Start at 1s, backoff to 30s

    const connect = () => {
        const socket = new WebSocket(API_CONFIG.WS_URL);
        ws.current = socket;

        // Connection timeout: if not connected within 10s, close and retry
        const connectTimeout = setTimeout(() => {
          if (socket.readyState !== WebSocket.OPEN) {
            logger.warn('WS connection timeout (10s) — closing and retrying');
            socket.close();
          }
        }, 10000);

        socket.onopen = () => {
          clearTimeout(connectTimeout);
          logger.debug('WS Connected - Authenticating...');
          reconnectDelay = 1000; // Reset backoff on successful connect

          // Step 1: Authenticate with server before subscribing
          if (socket.readyState === WebSocket.OPEN) {
             socket.send(JSON.stringify({ type: 'AUTH', address }));
          }
        };

        socket.onmessage = async (event) => {
          try {
            const data = JSON.parse(event.data);
            const { onNewMessage, onMessageDeleted, onMessageUpdated } = callbacksRef.current;

            // WebSocket Authentication — Challenge-Response Flow

            // Step 2a: Server sends challenge for existing users
            if (data.type === 'AUTH_CHALLENGE') {
              try {
                const myKeys = getCachedKeys(address);
                if (!myKeys) {
                  logger.warn('Cannot respond to AUTH_CHALLENGE — keys not derived yet, requesting limited token');
                  socket.send(JSON.stringify({ type: 'AUTH_KEY_MISMATCH', address }));
                  return;
                }
                const encrypted = decodeBase64(data.encryptedChallenge);
                const nonce = decodeBase64(data.nonce);
                const serverPubKey = decodeBase64(data.serverPublicKey);
                const mySecretKey = decodeBase64(myKeys.secretKey);

                const decrypted = nacl.box.open(encrypted, nonce, serverPubKey, mySecretKey);
                if (!decrypted) {
                  logger.warn('AUTH_CHALLENGE decryption failed (keys may have changed), requesting limited token');
                  socket.send(JSON.stringify({ type: 'AUTH_KEY_MISMATCH', address }));
                  return;
                }
                const decryptedChallenge = new TextDecoder().decode(decrypted);
                socket.send(JSON.stringify({ type: 'AUTH_RESPONSE', decryptedChallenge }));
              } catch (e) {
                logger.error('AUTH_CHALLENGE handling failed:', e);
                socket.send(JSON.stringify({ type: 'AUTH_KEY_MISMATCH', address }));
              }
              return;
            }

            // Step 2b: Authentication succeeded — store session token
            if (data.type === 'AUTH_SUCCESS') {
              logger.debug('WS Authenticated successfully');
              // Store session token for REST API auth
              if (data.token) {
                setSessionToken(data.token);
              }
              setIsConnected(true);
              // Step 3: Subscribe to channels after successful auth
              try {
                const addressHash = hashAddress(address);
                socket.send(JSON.stringify({ type: 'SUBSCRIBE', address, addressHash }));
              } catch (e) {
                logger.error("Failed to hash address for WS subscription:", e);
                socket.send(JSON.stringify({ type: 'SUBSCRIBE', address }));
              }

              // Step 4: Flush offline queue after reconnection
              getQueuedMessages().then(async (queued) => {
                if (queued.length === 0) return;
                logger.info(`[OfflineQueue] Flushing ${queued.length} queued messages...`);
                for (const msg of queued) {
                  try {
                    if (socket.readyState === WebSocket.OPEN) {
                      socket.send(JSON.stringify({
                        type: 'DM_MESSAGE',
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
                      }));
                      await dequeueMessage(msg.id);
                      logger.debug(`[OfflineQueue] Flushed message: ${msg.id}`);
                    }
                  } catch (err) {
                    logger.error('[OfflineQueue] Failed to flush message:', err);
                  }
                }
              }).catch(err => logger.error('[OfflineQueue] Flush error:', err));

              return;
            }

            if (data.type === 'AUTH_FAILED') {
              logger.error('WS Authentication failed:', data.message);
              setSessionToken(null);
              toast.error('WebSocket authentication failed');
              setIsConnected(false);
              socket.close();
              return;
            }

            // Reaction update — broadcast from backend
            if (data.type === 'REACTION_UPDATE') {
              const { messageId, reactions } = data.payload;
              if (callbacksRef.current.onReactionUpdate) {
                callbacksRef.current.onReactionUpdate(messageId, reactions);
              }
              return;
            }

            // Typing indicator from another user
            if (data.type === 'TYPING') {
              const { dialogHash } = data.payload;
              setTypingUsers(prev => ({ ...prev, [dialogHash]: { ts: Date.now() } }));
              // Auto-clear after 3s
              setTimeout(() => {
                setTypingUsers(prev => {
                  const copy = { ...prev };
                  if (copy[dialogHash] && Date.now() - copy[dialogHash].ts > 2500) {
                    delete copy[dialogHash];
                  }
                  return copy;
                });
              }, 3000);
              return;
            }

            // Room events
            if (data.type === 'room_message') {
              const { roomId, id, sender, senderName, text, timestamp } = data.payload;
              if (callbacksRef.current.onRoomMessage) {
                // Decrypt room message (handles both encrypted and legacy plaintext)
                const decryptedText = await decryptRoomText(roomId, text);
                callbacksRef.current.onRoomMessage(roomId, {
                  id,
                  text: decryptedText,
                  time: new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  senderId: sender === address ? 'me' : sender,
                  isMine: sender === address,
                  status: 'sent',
                  timestamp,
                  senderHash: senderName || sender?.slice(0, 10)
                });
              }
              return;
            }

            if (data.type === 'room_created') {
              if (callbacksRef.current.onRoomCreated) {
                const r = data.payload.room || data.payload;
                callbacksRef.current.onRoomCreated({
                  id: r.id, name: r.name, createdBy: r.created_by,
                  isPrivate: r.is_private, type: r.type, memberCount: r.memberCount || 1
                });
              }
              return;
            }

            if (data.type === 'room_deleted') {
              if (callbacksRef.current.onRoomDeleted) {
                callbacksRef.current.onRoomDeleted(data.payload.roomId);
              }
              // Clean up cached room key
              roomKeyCache.current.delete(data.payload.roomId);
              return;
            }

            // When a new member joins — distribute room key to them if I have it
            if (data.type === 'room_member_joined') {
              const { roomId, address: joinedAddress } = data.payload;
              if (joinedAddress !== address) {
                // I'm an existing member — share my room key with the new member
                const cachedKey = roomKeyCache.current.get(roomId);
                if (cachedKey) {
                  distributeRoomKey(roomId, cachedKey).catch(() => {});
                }
              }
              return;
            }

            if (data.type === 'dm_cleared') {
              if (callbacksRef.current.onDMCleared) {
                callbacksRef.current.onDMCleared(data.payload.dialogHash);
              }
              return;
            }

            if (data.type === 'room_message_deleted') {
              const { roomId, messageId } = data.payload;
              if (callbacksRef.current.onRoomMessageDeleted) {
                callbacksRef.current.onRoomMessageDeleted(roomId, messageId);
              }
              return;
            }

            if (data.type === 'room_message_edited') {
              const { roomId, messageId, text } = data.payload;
              if (callbacksRef.current.onRoomMessageEdited) {
                const decryptedText = await decryptRoomText(roomId, text);
                callbacksRef.current.onRoomMessageEdited(roomId, messageId, decryptedText);
              }
              return;
            }

            if (data.type === 'room_typing') {
              const key = `room:${data.payload.roomId}`;
              setTypingUsers(prev => ({ ...prev, [key]: { ts: Date.now(), sender: data.payload.sender } }));
              setTimeout(() => {
                setTypingUsers(prev => {
                  const copy = { ...prev };
                  if (copy[key] && Date.now() - copy[key].ts > 2500) delete copy[key];
                  return copy;
                });
              }, 3000);
              return;
            }

            if (data.type === 'pin_update') {
              if (callbacksRef.current.onPinUpdate) {
                callbacksRef.current.onPinUpdate(data.payload.contextId, data.payload.pins);
              }
              return;
            }

            if (data.type === 'dm_sent') {
              const { tempId, id } = data.payload;
              if (callbacksRef.current.onDMSent) {
                callbacksRef.current.onDMSent(tempId, id);
              }
              return;
            }

            // Read receipt — other user read our messages
            if (data.type === 'READ_RECEIPT') {
              const { dialogHash, messageIds } = data.payload;
              if (callbacksRef.current.onReadReceipt) {
                callbacksRef.current.onReadReceipt(dialogHash, messageIds);
              }
              return;
            }

            if (data.type === 'profile_detected') {
                 toast(`${data.payload.username || 'User'} updated their profile`, { icon: '👤' });
                 if (data.payload.address) {
                     keyCache.current.delete(data.payload.address);
                     // Update contact name + avatar visibility in real-time
                     if (callbacksRef.current.onProfileUpdated) {
                       callbacksRef.current.onProfileUpdated(data.payload.address, data.payload.username, data.payload.showAvatar);
                     }
                 }
            }
            else if (data.type === 'message_deleted') {
                 if (onMessageDeleted) onMessageDeleted(data.payload.id);
            }
            else if (data.type === 'message_updated') {
                 const { id, encryptedPayload, sender, recipient, timestamp, encryptedPayloadSelf } = data.payload;
                 const text = await decryptPayload(
                     encryptedPayload, 
                     sender, 
                     recipient, 
                     timestamp,
                     encryptedPayloadSelf
                 );
                 if (text) cacheSet(decryptionCache.current, id, text, MAX_CACHE_SIZE);
                 if (onMessageUpdated) onMessageUpdated(id, text || "Decryption Failed");
            }
            else if (data.type === 'message_detected' || data.type === 'tx_confirmed') {
              // If it's just a confirmation of an existing message, we might handle it differently
              // But here we just update the message content/status
              
              if (data.type === 'tx_confirmed') {
                  // Just update status
                   onNewMessage({
                      id: data.payload.id,
                      status: 'included'
                   } as any);
                   return;
              }

              const rawMsg = data.payload;
              
              let text = decryptionCache.current.get(rawMsg.id);
              if (!text) {
                 text = await decryptPayload(
                     rawMsg.encryptedPayload || rawMsg.content_encrypted, 
                     rawMsg.sender, 
                     rawMsg.recipient, 
                     rawMsg.timestamp,
                     rawMsg.encryptedPayloadSelf || rawMsg.encrypted_payload_self
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

              const msg: Message & { recipient: string } = {
                id: rawMsg.id,
                text: text || "Decryption Failed",
                time: new Date(rawMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                senderId: rawMsg.sender === address ? 'me' : rawMsg.sender,
                isMine: rawMsg.sender === address,
                status: data.payload.status || 'included',
                recipient: rawMsg.recipient,
                timestamp: rawMsg.timestamp,
                attachment,
                senderHash: rawMsg.senderHash,
                recipientHash: rawMsg.recipientHash,
                dialogHash: rawMsg.dialogHash
              };
              
              onNewMessage(msg);
            }
          } catch (e) {
            logger.error('WS Message Error:', e);
          }
        };

        socket.onclose = () => {
            setIsConnected(false);
            setSessionToken(null);
            if (ws.current === socket) {
                reconnectTimer = setTimeout(connect, reconnectDelay);
                reconnectDelay = Math.min(reconnectDelay * 2, 30000);
            }
        };
        
        socket.onerror = (err) => {
            logger.error('WS Error:', err);
            socket.close();
        };
    };

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws.current) {
         ws.current.close();
         ws.current = null;
      }
      setSessionToken(null); // Clear session token on cleanup
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
          time: new Date(rawMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          senderId: rawMsg.sender === address ? 'me' : rawMsg.sender,
          isMine: rawMsg.sender === address,
          status: rawMsg.status,
          timestamp: rawMsg.timestamp,
          recipient: rawMsg.recipient,
          attachment
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

        // Fetch reactions in batch for all messages
        const messageIds = rawMessages.map((m: RawMessage) => m.id);
        const allReactions = await fetchReactionsBatch(messageIds);

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
              time: new Date(rawMsg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              senderId: rawMsg.sender === address ? 'me' : rawMsg.sender,
              isMine: rawMsg.sender === address,
              status: rawMsg.status,
              timestamp: rawMsg.timestamp,
              recipient: rawMsg.recipient,
              attachment,
              reactions: allReactions[rawMsg.id] || undefined
            };
        }));

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
  
  const notifyProfileUpdate = async (name: string, bio: string, txId: string, privacySettings?: { showLastSeen?: boolean; showProfilePhoto?: boolean }) => {
    if (!address) return;
    const keys = getCachedKeys(address);
    let addressHash = '';
    try { addressHash = hashAddress(address); } catch { /* ignore */ }

    await safeBackendFetch('profiles', {
      method: 'POST',
      body: {
          address,
          name,
          bio,
          txId,
          encryptionPublicKey: keys?.publicKey || '',
          addressHash,
          ...(privacySettings || {})
      }
    });
  };

  const cacheDecryptedMessage = (id: string, text: string) => {
    cacheSet(decryptionCache.current, id, text, MAX_CACHE_SIZE);
  };

  // --- Reactions API ---
  const addReaction = async (messageId: string, emoji: string) => {
    if (!address) return;
    await safeBackendFetch('reactions', {
      method: 'POST',
      body: { messageId, userAddress: address, emoji }
    });
  };

  const removeReaction = async (messageId: string, emoji: string) => {
    if (!address) return;
    await safeBackendFetch('reactions', {
      method: 'DELETE',
      body: { messageId, userAddress: address, emoji }
    });
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
    if (ws.current && ws.current.readyState === WebSocket.OPEN && address) {
      try {
        const senderHash = hashAddress(address);
        ws.current.send(JSON.stringify({ type: 'TYPING', dialogHash, senderHash }));
      } catch { /* ignore */ }
    }
  };

  // Send read receipt for messages in a dialog
  const sendReadReceipt = (dialogHash: string, messageIds: string[]) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN && address && messageIds.length > 0) {
      try {
        const senderHash = hashAddress(address);
        ws.current.send(JSON.stringify({ type: 'READ_RECEIPT', dialogHash, senderHash, messageIds }));
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
    // Decrypt all room messages
    return Promise.all(data.map(async (m: RawRoomMessage) => {
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
    }));
  };

  const sendRoomMessage = async (roomId: string, text: string, senderName?: string) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN && address) {
      // Encrypt the message with the room symmetric key
      let encryptedText = text;
      const roomSymKey = await getRoomKey(roomId);
      if (roomSymKey) {
        encryptedText = encryptRoomMessage(text, roomSymKey);
      }
      ws.current.send(JSON.stringify({
        type: 'ROOM_MESSAGE',
        roomId, sender: address, senderName: senderName || '', text: encryptedText, timestamp: Date.now()
      }));
    }
  };

  const subscribeRoom = (roomId: string) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: 'SUBSCRIBE_ROOM', roomId }));
    }
  };

  const deleteRoomMessage = async (roomId: string, msgId: string) => {
    if (!address) return;
    await safeBackendFetch(`rooms/${roomId}/messages/${msgId}?address=${encodeURIComponent(address)}`, {
      method: 'DELETE'
    });
  };

  const editRoomMessage = async (roomId: string, msgId: string, text: string) => {
    if (!address) return;
    // Encrypt the edited text with room key
    let encryptedText = text;
    const roomSymKey = await getRoomKey(roomId);
    if (roomSymKey) {
      encryptedText = encryptRoomMessage(text, roomSymKey);
    }
    await safeBackendFetch(`rooms/${roomId}/messages/${msgId}/edit`, {
      method: 'POST',
      body: { address, text: encryptedText }
    });
  };

  const sendRoomTyping = (roomId: string) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN && address) {
      ws.current.send(JSON.stringify({ type: 'ROOM_TYPING', roomId, sender: address }));
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
  const prepareDMMessage = async (recipientAddress: string, text: string, attachmentCID?: string): Promise<{ tempId: string; encryptedPayload: string; encryptedPayloadSelf: string; timestamp: number; senderHash: string; recipientHash: string; dialogHash: string } | null> => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN || !address) return null;

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

    return { tempId, encryptedPayload, encryptedPayloadSelf, timestamp, senderHash, recipientHash, dialogHash };
  };

  // Actually send the prepared message via WebSocket (queues to offline queue on failure)
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

    if (!ws.current || ws.current.readyState !== WebSocket.OPEN || !address) {
      logger.warn('WebSocket not connected — queuing message offline');
      queueMsg();
      return false;
    }

    try {
      ws.current.send(JSON.stringify({
        type: 'DM_MESSAGE',
        sender: address,
        senderHash: prepared.senderHash,
        recipientHash: prepared.recipientHash,
        dialogHash: prepared.dialogHash,
        encryptedPayload: prepared.encryptedPayload,
        encryptedPayloadSelf: prepared.encryptedPayloadSelf,
        timestamp: prepared.timestamp,
        attachmentPart1: attachmentCID || '',
        attachmentPart2: '',
        tempId: prepared.tempId
      }));
      return true;
    } catch (e) {
      logger.error('Failed to send WebSocket message — queuing offline:', e);
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
    await safeBackendFetch(`messages/${msgId}?address=${encodeURIComponent(address)}`, {
      method: 'DELETE'
    });
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

    await safeBackendFetch(`messages/${msgId}/edit`, {
      method: 'POST',
      body: { address, encryptedPayload, encryptedPayloadSelf }
    });
  };

  // --- Pins API ---
  const fetchPins = async (contextId: string) => {
    const { data } = await safeBackendFetch<any[]>(`pins/${encodeURIComponent(contextId)}`);
    return data || [];
  };

  const pinMessage = async (contextId: string, messageId: string, messageText: string) => {
    if (!address) return;
    await safeBackendFetch('pins', {
      method: 'POST',
      body: { contextId, messageId, pinnedBy: address, messageText }
    });
  };

  const unpinMessage = async (contextId: string, messageId: string) => {
    await safeBackendFetch('pins', {
      method: 'DELETE',
      body: { contextId, messageId }
    });
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
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'HEARTBEAT' }));
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [isConnected]);

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
    fetchLinkPreview
  };
}
