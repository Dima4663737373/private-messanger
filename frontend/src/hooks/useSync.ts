import { hashAddress } from '../utils/aleo-utils';
import { useEffect, useRef, useState } from 'react';
import { Message, Room } from '../types';
import { fieldToString, fieldsToString } from '../utils/messageUtils';
import { getOrCreateMessagingKeys, encryptMessage } from '../utils/crypto';
import { toast } from 'react-hot-toast';
import { API_CONFIG } from '../config';
import { safeBackendFetch } from '../utils/api-client';
import { useEncryptionWorker } from './useEncryptionWorker';
import { logger } from '../utils/logger';

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
  onPinUpdate?: (contextId: string, pins: any[]) => void,
  onRoomMessageDeleted?: (roomId: string, messageId: string) => void,
  onRoomMessageEdited?: (roomId: string, messageId: string, text: string) => void,
  onDMSent?: (tempId: string, realId: string) => void
) {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Record<string, number>>({}); // dialogHash -> timestamp
  const { decrypt, decryptAsSender } = useEncryptionWorker();

  // In-Memory Caches (bounded, cleared on refresh)
  const MAX_CACHE_SIZE = 1000;
  const MAX_KEY_CACHE_SIZE = 200;
  const decryptionCache = useRef<Map<string, string>>(new Map());
  const keyCache = useRef<Map<string, string>>(new Map());

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
  const decryptPayload = async (
      payload: string, 
      sender: string, 
      recipient: string, 
      timestamp: number,
      payloadSelf?: string
  ): Promise<string> => {
      if (!address) return fieldToString(payload);

      try {
        const myKeys = getOrCreateMessagingKeys(address);
        const isMine = sender === address;
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
        
        // Fallback for legacy/plaintext
        const legacy = fieldToString(payload);
        
        // Stricter detection: encrypted payloads are "base64nonce.base64ciphertext"
        const parts = legacy.split('.');
        const isBase64 = /^[A-Za-z0-9+/=]{16,}$/;
        const isLikelyEncrypted = parts.length === 2 && isBase64.test(parts[0]) && isBase64.test(parts[1]);
        
        if (!isLikelyEncrypted) {
            return legacy;
        }
        
        return isMine ? "[Encrypted Sent Message]" : "[Encrypted Message]";
      } catch (e) {
          return fieldToString(payload);
      }
  };

  // Callbacks Ref
  const callbacksRef = useRef({ onNewMessage, onMessageDeleted, onMessageUpdated, onReactionUpdate, onRoomMessage, onRoomCreated, onRoomDeleted, onDMCleared, onPinUpdate, onRoomMessageDeleted, onRoomMessageEdited, onDMSent });
  useEffect(() => {
      callbacksRef.current = { onNewMessage, onMessageDeleted, onMessageUpdated, onReactionUpdate, onRoomMessage, onRoomCreated, onRoomDeleted, onDMCleared, onPinUpdate, onRoomMessageDeleted, onRoomMessageEdited, onDMSent };
  }, [onNewMessage, onMessageDeleted, onMessageUpdated, onReactionUpdate, onRoomMessage, onRoomCreated, onRoomDeleted, onDMCleared, onPinUpdate, onRoomMessageDeleted, onRoomMessageEdited, onDMSent]);

  useEffect(() => {
    if (!address) return;

    let reconnectTimer: ReturnType<typeof setTimeout>;
    let reconnectDelay = 1000; // Start at 1s, backoff to 30s

    const connect = () => {
        const socket = new WebSocket(API_CONFIG.WS_URL);
        ws.current = socket;

        socket.onopen = () => {
          logger.debug('WS Connected');
          setIsConnected(true);
          reconnectDelay = 1000; // Reset backoff on successful connect
          if (socket.readyState === WebSocket.OPEN) {
             try {
                 const addressHash = hashAddress(address);
                 socket.send(JSON.stringify({ type: 'SUBSCRIBE', address, addressHash }));
             } catch (e) {
                 logger.error("Failed to hash address for WS subscription:", e);
                 // Try sending without hash (server might reject or just default to address-only logic)
                 socket.send(JSON.stringify({ type: 'SUBSCRIBE', address }));
             }
          }
        };

        socket.onmessage = async (event) => {
          try {
            const data = JSON.parse(event.data);
            const { onNewMessage, onMessageDeleted, onMessageUpdated } = callbacksRef.current;

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
              setTypingUsers(prev => ({ ...prev, [dialogHash]: Date.now() }));
              // Auto-clear after 3s
              setTimeout(() => {
                setTypingUsers(prev => {
                  const copy = { ...prev };
                  if (copy[dialogHash] && Date.now() - copy[dialogHash] > 2500) {
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
                callbacksRef.current.onRoomMessage(roomId, {
                  id,
                  text,
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
                callbacksRef.current.onRoomMessageEdited(roomId, messageId, text);
              }
              return;
            }

            if (data.type === 'room_typing') {
              const key = `room:${data.payload.roomId}`;
              setTypingUsers(prev => ({ ...prev, [key]: Date.now() }));
              setTimeout(() => {
                setTypingUsers(prev => {
                  const copy = { ...prev };
                  if (copy[key] && Date.now() - copy[key] > 2500) delete copy[key];
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

            if (data.type === 'profile_detected') {
                 toast(`${data.payload.username || 'User'} updated their profile`, { icon: '👤' });
                 if (data.payload.address) {
                     keyCache.current.delete(data.payload.address);
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
            if (ws.current === socket) {
                reconnectTimer = setTimeout(connect, reconnectDelay);
                reconnectDelay = Math.min(reconnectDelay * 2, 30000); // Exponential backoff, max 30s
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
    const decryptedMessages = await Promise.all(rawMessages.map(async (rawMsg: any) => {
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
        const decryptedDialogs = await Promise.all(rawDialogs.map(async (rawMsg: any) => {
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

        const decryptedMessages = await Promise.all(rawMessages.map(async (rawMsg: any) => {
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
  
  const notifyProfileUpdate = async (name: string, bio: string, txId: string) => {
    if (!address) return;
    const keys = getOrCreateMessagingKeys(address);
    
    await safeBackendFetch('profiles', {
      method: 'POST',
      body: { 
          address, 
          name, 
          bio, 
          txId,
          encryptionPublicKey: keys.publicKey 
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

  // Send typing indicator (debounced by caller)
  const sendTyping = (dialogHash: string) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN && address) {
      try {
        const senderHash = hashAddress(address);
        ws.current.send(JSON.stringify({ type: 'TYPING', dialogHash, senderHash }));
      } catch { /* ignore */ }
    }
  };

  // --- Room API ---
  const fetchRooms = async (type: 'channel' | 'group'): Promise<Room[]> => {
    const params = new URLSearchParams({ type });
    if (type === 'group' && address) params.append('address', address);
    const { data } = await safeBackendFetch<any[]>(`rooms?${params.toString()}`);
    if (!data || !Array.isArray(data)) return [];
    return data.map((r: any) => ({
      id: r.id, name: r.name, createdBy: r.created_by,
      isPrivate: r.is_private, type: r.type, memberCount: r.memberCount || 0
    }));
  };

  const createRoom = async (name: string, type: 'channel' | 'group') => {
    if (!address) return null;
    const { data } = await safeBackendFetch<any>('rooms', {
      method: 'POST',
      body: { name, type, creatorAddress: address }
    });
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

  const fetchRoomMessages = async (roomId: string, limit = 50, offset = 0): Promise<Message[]> => {
    const { data } = await safeBackendFetch<any[]>(`rooms/${roomId}/messages?limit=${limit}&offset=${offset}`);
    if (!data || !Array.isArray(data)) return [];
    return data.map((m: any) => ({
      id: m.id,
      text: m.text,
      time: new Date(Number(m.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      senderId: m.sender === address ? 'me' : m.sender,
      isMine: m.sender === address,
      status: 'sent' as const,
      timestamp: Number(m.timestamp),
      senderHash: m.sender_name || m.sender?.slice(0, 10)
    }));
  };

  const sendRoomMessage = (roomId: string, text: string) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN && address) {
      ws.current.send(JSON.stringify({
        type: 'ROOM_MESSAGE',
        roomId, sender: address, text, timestamp: Date.now()
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
    await safeBackendFetch(`rooms/${roomId}/messages/${msgId}/edit`, {
      method: 'POST',
      body: { address, text }
    });
  };

  const sendRoomTyping = (roomId: string) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN && address) {
      ws.current.send(JSON.stringify({ type: 'ROOM_TYPING', roomId, sender: address }));
    }
  };

  const clearDMHistory = async (dialogHash: string) => {
    await safeBackendFetch('rooms/dm-clear', {
      method: 'DELETE',
      body: { dialogHash }
    });
  };

  // --- Off-chain DM API ---

  const sendDMMessage = async (recipientAddress: string, text: string, attachmentCID?: string): Promise<{ tempId: string; encryptedPayload: string; timestamp: number } | null> => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN || !address) return null;

    const myKeys = getOrCreateMessagingKeys(address);
    const senderHash = hashAddress(address);
    const recipientHash = hashAddress(recipientAddress);

    // Canonical dialog hash (sorted)
    const dialogHash = senderHash < recipientHash
      ? `${senderHash}_${recipientHash}`
      : `${recipientHash}_${senderHash}`;

    // Fetch recipient's encryption public key
    let recipientPubKey = '';
    try {
      const { data } = await safeBackendFetch<any>(`profiles/${recipientAddress}`);
      if (data && data.encryption_public_key) {
        recipientPubKey = data.encryption_public_key;
      }
    } catch { /* ignore */ }

    let encryptedPayload = text;
    let encryptedPayloadSelf = '';

    if (recipientPubKey) {
      encryptedPayload = encryptMessage(text, recipientPubKey, myKeys.secretKey);
      // Encrypt for self (so sender can read their own sent messages)
      encryptedPayloadSelf = encryptMessage(text, myKeys.publicKey, myKeys.secretKey);
    }

    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = Date.now();

    ws.current.send(JSON.stringify({
      type: 'DM_MESSAGE',
      sender: address,
      senderHash,
      recipientHash,
      dialogHash,
      encryptedPayload,
      encryptedPayloadSelf,
      timestamp,
      attachmentPart1: attachmentCID || '',
      attachmentPart2: '',
      tempId
    }));

    return { tempId, encryptedPayload, timestamp };
  };

  const deleteDMMessage = async (msgId: string) => {
    if (!address) return;
    await safeBackendFetch(`messages/${msgId}?address=${encodeURIComponent(address)}`, {
      method: 'DELETE'
    });
  };

  const editDMMessage = async (msgId: string, newText: string, recipientAddress: string) => {
    if (!address) return;

    const myKeys = getOrCreateMessagingKeys(address);

    // Fetch recipient's encryption public key
    let recipientPubKey = '';
    try {
      const { data } = await safeBackendFetch<any>(`profiles/${recipientAddress}`);
      if (data && data.encryption_public_key) {
        recipientPubKey = data.encryption_public_key;
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
    sendDMMessage,
    deleteDMMessage,
    editDMMessage,
    // Pins
    fetchPins,
    pinMessage,
    unpinMessage
  };
}
