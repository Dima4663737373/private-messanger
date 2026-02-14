import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { initDB, Message, Profile, SyncStatus, Reaction, Room, RoomMember, RoomMessage, PinnedMessage, UserPreferences, sequelize } from './database';
import { v4 as uuidv4 } from 'uuid';
import { IndexerService } from './services/indexer';
import { Op } from 'sequelize';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// --- Security Middleware ---

// HTTP security headers
app.use(helmet({
  contentSecurityPolicy: false, // Allow frontend to load resources
  crossOriginEmbedderPolicy: false
}));

// CORS — restrict to known origins (localhost dev + configurable production)
const HARDCODED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'https://ghost-aleo.netlify.app'
];
const EXTRA_ORIGINS = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()) : [];
const ALLOWED_ORIGINS = [...new Set([...HARDCODED_ORIGINS, ...EXTRA_ORIGINS])];
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin in dev (curl, mobile apps, etc)
    if (!origin) {
      callback(null, !IS_PRODUCTION);
      return;
    }
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

// Global rate limiter: 200 requests per 15 minutes per IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
}));

// Stricter limiter for search endpoint
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Search rate limit exceeded' }
});

// Stricter limiter for profile creation
const profileWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Profile update rate limit exceeded' }
});

app.use(express.json({ limit: '100kb' }));

const indexer = new IndexerService(wss);

// --- Input Validation Helpers ---

function clampInt(val: any, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (isNaN(n) || !Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function isValidHash(str: string): boolean {
  // Aleo field hashes or dialog hashes (hash_hash)
  return /^[a-zA-Z0-9_]{1,300}$/.test(str);
}

function isValidAddress(str: string): boolean {
  return /^aleo1[a-z0-9]{58}$/.test(str);
}

function sanitizeSearchQuery(q: string): string {
  // Limit length and strip dangerous characters for LIKE
  return q.slice(0, 100).replace(/[%_\\]/g, '');
}

// --- WebSocket Connection ---

// Track per-connection message rate
const WS_MSG_LIMIT = 30; // max messages per 60s
const WS_MSG_WINDOW = 60_000;

// Helper: broadcast to all WS clients in a specific room
function broadcastToRoom(roomId: string, msg: object, exclude?: WebSocket) {
  wss.clients.forEach((client: any) => {
    if (client.readyState === WebSocket.OPEN && client !== exclude) {
      if (client.subscribedRooms && client.subscribedRooms.has(roomId)) {
        client.send(JSON.stringify(msg));
      }
    }
  });
}

wss.on('connection', (ws: any) => {
  ws._msgTimestamps = [] as number[];
  ws.subscribedRooms = new Set<string>();
  ws.authenticated = false; // Require authentication before subscribing

  ws.on('message', async (message: any) => {
    try {
      // Rate limit WS messages
      const now = Date.now();
      ws._msgTimestamps = (ws._msgTimestamps || []).filter((t: number) => now - t < WS_MSG_WINDOW);
      if (ws._msgTimestamps.length >= WS_MSG_LIMIT) {
        ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }));
        return;
      }
      ws._msgTimestamps.push(now);

      const data = JSON.parse(message.toString());

      // AUTH message — authenticate the connection
      if (data.type === 'AUTH') {
        const { address } = data;
        if (!address || !isValidAddress(address)) {
          ws.send(JSON.stringify({ type: 'AUTH_FAILED', message: 'Invalid address' }));
          return;
        }

        // Authenticate (in production, verify signature here)
        ws.authenticated = true;
        ws.authenticatedAddress = address;
        ws.send(JSON.stringify({ type: 'AUTH_SUCCESS', address }));
        return;
      }

      // Require authentication for all other operations
      if (!ws.authenticated) {
        ws.send(JSON.stringify({ type: 'error', message: 'Authentication required. Send AUTH message first.' }));
        return;
      }

      if (data.type === 'SUBSCRIBE') {
        if (data.addressHash && typeof data.addressHash === 'string' && isValidHash(data.addressHash)) {
          ws.subscribedAddress = data.address;
          ws.subscribedHash = data.addressHash;
          ws.lastSeen = Date.now();
        }
        if (data.dialogHash && typeof data.dialogHash === 'string' && isValidHash(data.dialogHash)) {
          ws.subscribedDialog = data.dialogHash;
        }
        // Auto-subscribe to user's rooms
        if (data.address && typeof data.address === 'string') {
          const memberships = await RoomMember.findAll({ where: { user_id: data.address } });
          for (const m of memberships) {
            ws.subscribedRooms.add(m.room_id);
          }
        }
      }

      // Subscribe to a specific room
      if (data.type === 'SUBSCRIBE_ROOM' && data.roomId && typeof data.roomId === 'string') {
        ws.subscribedRooms.add(data.roomId);
      }

      // Room message — save and broadcast
      if (data.type === 'ROOM_MESSAGE' && data.roomId && data.sender && data.text) {
        const msgId = uuidv4();
        const timestamp = Date.now();
        const senderName = data.senderName || data.sender.slice(0, 8) + '...';
        await RoomMessage.create({
          id: msgId,
          room_id: data.roomId.slice(0, 100),
          sender: data.sender.slice(0, 100),
          sender_name: senderName.slice(0, 100),
          text: data.text.slice(0, 10000),
          timestamp,
        });
        const msg = { type: 'room_message', payload: { id: msgId, roomId: data.roomId, sender: data.sender, senderName, text: data.text, timestamp } };
        broadcastToRoom(data.roomId, msg);
        // Also send to sender if not subscribed
        if (!ws.subscribedRooms.has(data.roomId)) {
          ws.send(JSON.stringify(msg));
        }
      }

      // Room typing indicator
      if (data.type === 'ROOM_TYPING' && data.roomId && data.sender) {
        broadcastToRoom(data.roomId, { type: 'room_typing', payload: { roomId: data.roomId, sender: data.sender } }, ws);
      }

      // Typing indicator — relay to the other party in the dialog
      if (data.type === 'TYPING' && data.dialogHash && data.senderHash) {
        const dialogParts = data.dialogHash.split('_');
        wss.clients.forEach((client: any) => {
          if (client !== ws && client.readyState === WebSocket.OPEN && client.subscribedHash) {
            // Only send to clients whose hash is part of this dialog (but not the sender)
            if (dialogParts.includes(client.subscribedHash) && client.subscribedHash !== data.senderHash) {
              client.send(JSON.stringify({ type: 'TYPING', payload: { dialogHash: data.dialogHash, senderHash: data.senderHash } }));
            }
          }
        });
      }

      // DM message — off-chain encrypted direct message
      if (data.type === 'DM_MESSAGE') {
        const { sender, senderHash, recipientHash, dialogHash, encryptedPayload, encryptedPayloadSelf, timestamp, attachmentPart1, attachmentPart2, tempId } = data;
        if (!sender || !senderHash || !recipientHash || !dialogHash || !encryptedPayload || !timestamp) {
          ws.send(JSON.stringify({ type: 'error', message: 'Missing required DM fields' }));
          return;
        }

        const msgId = uuidv4();

        // Resolve recipient address from hash
        let resolvedRecipient = 'unknown';
        const recipientProfile = await Profile.findOne({ where: { address_hash: recipientHash } });
        if (recipientProfile) resolvedRecipient = recipientProfile.address;

        await Message.create({
          id: msgId,
          sender: sender.slice(0, 100),
          recipient: resolvedRecipient,
          sender_hash: senderHash.slice(0, 300),
          recipient_hash: recipientHash.slice(0, 300),
          dialog_hash: dialogHash.slice(0, 600),
          encrypted_payload: encryptedPayload.slice(0, 50000),
          encrypted_payload_self: (encryptedPayloadSelf || '').slice(0, 50000),
          nonce: '',
          timestamp,
          block_height: 0,
          status: 'confirmed',
          attachment_part1: (attachmentPart1 || '').slice(0, 500),
          attachment_part2: (attachmentPart2 || '').slice(0, 500),
        });

        const messagePayload = {
          id: msgId, dialogHash, recipientHash, senderHash,
          sender, recipient: resolvedRecipient,
          encryptedPayload, encryptedPayloadSelf,
          timestamp,
          attachmentPart1: attachmentPart1 || '',
          attachmentPart2: attachmentPart2 || '',
          status: 'confirmed'
        };

        // Broadcast to recipient (and sender's other sessions)
        wss.clients.forEach((client: any) => {
          if (client.readyState === WebSocket.OPEN && client !== ws) {
            const subHash = client.subscribedHash;
            if (subHash && (subHash === recipientHash || subHash === senderHash)) {
              client.send(JSON.stringify({ type: 'message_detected', payload: messagePayload }));
            }
          }
        });

        // Confirm to sender with real ID
        ws.send(JSON.stringify({ type: 'dm_sent', payload: { tempId, id: msgId, timestamp } }));
      }

      // Heartbeat — update lastSeen
      if (data.type === 'HEARTBEAT') {
        ws.lastSeen = Date.now();
      }
    } catch (e) {
      console.error('WS handler error:', e);
    }
  });

  // Mark as online
  ws.lastSeen = Date.now();

  ws.on('close', () => {
    // Client disconnected
  });
});

// --- Online Status Endpoint ---
app.get('/online/:addressHash', (_req, res) => {
  const { addressHash } = _req.params;
  let isOnline = false;
  let lastSeen = 0;

  wss.clients.forEach((client: any) => {
    if (client.subscribedHash === addressHash && client.readyState === WebSocket.OPEN) {
      isOnline = true;
      lastSeen = client.lastSeen || 0;
    }
  });

  res.json({ online: isOnline, lastSeen });
});

// --- Routes ---

// GET /messages/:dialogHash — messages for a dialog or address
app.get('/messages/:dialogHash', async (req, res) => {
  try {
    const { dialogHash } = req.params;
    if (!isValidHash(dialogHash)) return res.status(400).json({ error: 'Invalid hash' });

    const limit = clampInt(req.query.limit, 1, 100, 50);
    const offset = clampInt(req.query.offset, 0, 100000, 0);

    let whereClause: any;
    if (dialogHash.includes('_')) {
      whereClause = { dialog_hash: dialogHash };
    } else {
      whereClause = {
        [Op.or]: [{ recipient: dialogHash }, { sender: dialogHash }, { recipient_hash: dialogHash }, { sender_hash: dialogHash }]
      };
    }

    const messages = await Message.findAll({
      where: whereClause,
      order: [['timestamp', 'ASC']],
      limit,
      offset
    });
    res.json(messages);
  } catch (e) {
    console.error('GET /messages/:dialogHash error:', e);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET /messages/dialog/:dialogHash — messages for a specific dialog
app.get('/messages/dialog/:dialogHash', async (req, res) => {
  try {
    const { dialogHash } = req.params;
    if (!isValidHash(dialogHash)) return res.status(400).json({ error: 'Invalid hash' });

    const limit = clampInt(req.query.limit, 1, 100, 50);
    const offset = clampInt(req.query.offset, 0, 100000, 0);

    const messages = await Message.findAll({
      where: { dialog_hash: dialogHash },
      order: [['timestamp', 'DESC']],
      limit,
      offset
    });
    res.json(messages);
  } catch (e) {
    console.error(`GET /messages/dialog error:`, e);
    res.status(500).json({ error: 'Failed to fetch dialog messages' });
  }
});

// GET /dialogs/:addressHash — all active dialogs for a user
app.get('/dialogs/:addressHash', async (req, res) => {
  try {
    const { addressHash } = req.params;
    if (!isValidHash(addressHash)) return res.status(400).json({ error: 'Invalid hash' });

    const dialogStats = await Message.findAll({
      attributes: [
        'dialog_hash',
        [sequelize.fn('MAX', sequelize.col('timestamp')), 'last_message_time']
      ],
      where: {
        [Op.or]: [{ sender_hash: addressHash }, { recipient_hash: addressHash }]
      },
      group: ['dialog_hash'],
      order: [[sequelize.fn('MAX', sequelize.col('timestamp')), 'DESC']],
      limit: 50
    });

    const dialogs = await Promise.all(dialogStats.map(async (stat: any) => {
      const lastMsg = await Message.findOne({
        where: {
          dialog_hash: stat.dialog_hash,
          timestamp: stat.getDataValue('last_message_time')
        }
      });
      return lastMsg;
    }));

    res.json(dialogs.filter(d => d !== null));
  } catch (e) {
    console.error('GET /dialogs error:', e);
    res.status(500).json({ error: 'Failed to fetch dialogs' });
  }
});

// GET /profiles/search — search profiles by username
app.get('/profiles/search', searchLimiter, async (req, res) => {
  try {
    const q = req.query.q;
    if (!q || typeof q !== 'string') return res.json([]);

    const sanitized = sanitizeSearchQuery(q);
    if (sanitized.length < 1) return res.json([]);

    const profiles = await Profile.findAll({
      where: {
        username: { [Op.like]: `%${sanitized}%` }
      },
      attributes: ['address', 'username', 'bio', 'address_hash'],
      limit: 10
    });
    res.json(profiles);
  } catch (e) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /profiles/hash/:hash — profile by address hash
app.get('/profiles/hash/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    if (!isValidHash(hash)) return res.status(400).json({ exists: false, profile: null });

    const profile = await Profile.findOne({ where: { address_hash: hash } });
    if (profile) {
      res.json({ exists: true, profile });
    } else {
      res.json({ exists: false, profile: null });
    }
  } catch (e) {
    console.error('GET /profiles/hash error:', e);
    res.json({ exists: false, profile: null });
  }
});

// GET /profiles/:address — profile by address or hash
app.get('/profiles/:address', async (req, res) => {
  try {
    const { address } = req.params;

    const profile = await Profile.findOne({
      where: {
        [Op.or]: [{ address }, { address_hash: address }]
      }
    });

    if (profile) {
      res.json({ exists: true, profile });
    } else {
      res.status(404).json({ exists: false, profile: null });
    }
  } catch (e) {
    console.error('GET /profiles/:address error:', e);
    res.json({ exists: false, profile: null });
  }
});

// GET /history/:address — transaction history
app.get('/history/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const limit = clampInt(req.query.limit, 1, 100, 50);

    const messages = await Message.findAll({
      where: {
        [Op.or]: [{ recipient: address }, { sender: address }]
      },
      order: [['timestamp', 'DESC']],
      limit
    });

    const history = messages.map((m: any) => ({
      id: m.id,
      type: m.sender === address ? 'sent_message' : 'received_message',
      hash: m.id,
      timestamp: m.timestamp,
      details: m.sender === address ? `To: ${m.recipient}` : `From: ${m.sender}`
    }));

    res.json(history);
  } catch (e) {
    res.status(500).json({ error: 'History fetch failed' });
  }
});

// POST /profiles — upsert profile (encryption key exchange)
app.post('/profiles', profileWriteLimiter, async (req, res) => {
  try {
    const { address, name, bio, txId, encryptionPublicKey } = req.body;

    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'address is required' });
    }

    // Build update data — only include non-empty fields to avoid overwriting
    const data: any = { address };

    if (typeof name === 'string' && name.length > 0) {
      data.username = name.slice(0, 100);
    }
    if (typeof bio === 'string' && bio.length > 0) {
      data.bio = bio.slice(0, 500);
    }
    if (typeof txId === 'string' && txId.length > 0) {
      data.tx_id = txId.slice(0, 200);
    }
    if (typeof encryptionPublicKey === 'string' && encryptionPublicKey.length > 0) {
      data.encryption_public_key = encryptionPublicKey.slice(0, 500);
    }

    await Profile.upsert(data);
    res.json({ success: true });
  } catch (e) {
    console.error('POST /profiles error:', e);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

// --- User Preferences ---

// Rate limiter for preferences
const preferencesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Preferences rate limit exceeded' }
});

// GET /preferences/:address — get user preferences
app.get('/preferences/:address', preferencesLimiter, async (req, res) => {
  try {
    const address = req.params.address as string;
    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    const prefs = await UserPreferences.findByPk(address);
    if (!prefs) {
      // Return defaults if no preferences stored
      return res.json({
        address,
        pinned_chats: [],
        muted_chats: [],
        deleted_chats: [],
        disappear_timers: {},
        encrypted_keys: null,
        key_nonce: null
      });
    }

    res.json({
      address: prefs.address,
      pinned_chats: JSON.parse(prefs.pinned_chats || '[]'),
      muted_chats: JSON.parse(prefs.muted_chats || '[]'),
      deleted_chats: JSON.parse(prefs.deleted_chats || '[]'),
      disappear_timers: JSON.parse(prefs.disappear_timers || '{}'),
      encrypted_keys: prefs.encrypted_keys ? JSON.parse(prefs.encrypted_keys) : null,
      key_nonce: prefs.key_nonce
    });
  } catch (e) {
    console.error('GET /preferences error:', e);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// POST /preferences/:address — update user preferences
app.post('/preferences/:address', preferencesLimiter, async (req, res) => {
  try {
    const address = req.params.address as string;
    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    const { pinnedChats, mutedChats, deletedChats, disappearTimers, encryptedKeys, keyNonce } = req.body;

    // Validate and stringify JSON fields
    const data: any = { address };

    if (pinnedChats !== undefined) {
      if (!Array.isArray(pinnedChats)) return res.status(400).json({ error: 'pinnedChats must be array' });
      data.pinned_chats = JSON.stringify(pinnedChats.slice(0, 100));
    }

    if (mutedChats !== undefined) {
      if (!Array.isArray(mutedChats)) return res.status(400).json({ error: 'mutedChats must be array' });
      data.muted_chats = JSON.stringify(mutedChats.slice(0, 100));
    }

    if (deletedChats !== undefined) {
      if (!Array.isArray(deletedChats)) return res.status(400).json({ error: 'deletedChats must be array' });
      data.deleted_chats = JSON.stringify(deletedChats.slice(0, 100));
    }

    if (disappearTimers !== undefined) {
      if (typeof disappearTimers !== 'object' || disappearTimers === null) {
        return res.status(400).json({ error: 'disappearTimers must be object' });
      }
      data.disappear_timers = JSON.stringify(disappearTimers);
    }

    if (encryptedKeys !== undefined) {
      data.encrypted_keys = typeof encryptedKeys === 'string'
        ? encryptedKeys.slice(0, 5000)
        : JSON.stringify(encryptedKeys).slice(0, 5000);
    }

    if (keyNonce !== undefined) {
      data.key_nonce = typeof keyNonce === 'string' ? keyNonce.slice(0, 200) : null;
    }

    await UserPreferences.upsert(data);

    res.json({ success: true });
  } catch (e) {
    console.error('POST /preferences error:', e);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// --- Reactions ---

// Rate limiter for reactions
const reactionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Reaction rate limit exceeded' }
});

function isValidEmoji(str: string): boolean {
  return typeof str === 'string' && str.length >= 1 && str.length <= 8;
}

// GET /reactions/:messageId — get reactions for a message
app.get('/reactions/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    if (!messageId || messageId.length > 300) return res.status(400).json({ error: 'Invalid messageId' });

    const reactions = await Reaction.findAll({ where: { message_id: messageId } });

    // Group by emoji
    const grouped: Record<string, string[]> = {};
    for (const r of reactions) {
      if (!grouped[r.emoji]) grouped[r.emoji] = [];
      grouped[r.emoji].push(r.user_address);
    }

    res.json(grouped);
  } catch (e) {
    console.error('GET /reactions error:', e);
    res.status(500).json({ error: 'Failed to fetch reactions' });
  }
});

// POST /reactions — add a reaction
app.post('/reactions', reactionLimiter, async (req, res) => {
  try {
    const { messageId, userAddress, emoji } = req.body;
    if (!messageId || typeof messageId !== 'string') return res.status(400).json({ error: 'messageId required' });
    if (!userAddress || typeof userAddress !== 'string') return res.status(400).json({ error: 'userAddress required' });
    if (!isValidEmoji(emoji)) return res.status(400).json({ error: 'Invalid emoji' });

    await Reaction.findOrCreate({
      where: { message_id: messageId.slice(0, 300), user_address: userAddress.slice(0, 100), emoji: emoji.slice(0, 8) },
      defaults: { message_id: messageId.slice(0, 300), user_address: userAddress.slice(0, 100), emoji: emoji.slice(0, 8) }
    });

    // Broadcast reaction to subscribed WebSocket clients
    const allReactions = await Reaction.findAll({ where: { message_id: messageId } });
    const grouped: Record<string, string[]> = {};
    for (const r of allReactions) {
      if (!grouped[r.emoji]) grouped[r.emoji] = [];
      grouped[r.emoji].push(r.user_address);
    }

    wss.clients.forEach((client: any) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'REACTION_UPDATE', payload: { messageId, reactions: grouped } }));
      }
    });

    res.json({ success: true });
  } catch (e) {
    console.error('POST /reactions error:', e);
    res.status(500).json({ error: 'Failed to add reaction' });
  }
});

// DELETE /reactions — remove a reaction
app.delete('/reactions', reactionLimiter, async (req, res) => {
  try {
    const { messageId, userAddress, emoji } = req.body;
    if (!messageId || !userAddress || !emoji) return res.status(400).json({ error: 'Missing fields' });

    await Reaction.destroy({
      where: { message_id: messageId.slice(0, 300), user_address: userAddress.slice(0, 100), emoji: emoji.slice(0, 8) }
    });

    // Broadcast updated reactions
    const allReactions = await Reaction.findAll({ where: { message_id: messageId } });
    const grouped: Record<string, string[]> = {};
    for (const r of allReactions) {
      if (!grouped[r.emoji]) grouped[r.emoji] = [];
      grouped[r.emoji].push(r.user_address);
    }

    wss.clients.forEach((client: any) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'REACTION_UPDATE', payload: { messageId, reactions: grouped } }));
      }
    });

    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /reactions error:', e);
    res.status(500).json({ error: 'Failed to remove reaction' });
  }
});

// GET /status — sync status
app.get('/status', async (_req, res) => {
  try {
    const status = await SyncStatus.findOne();
    const height = status ? status.last_block_height : 0;
    res.json({ height });
  } catch (e) {
    res.status(500).json({ error: 'Status fetch failed' });
  }
});

// --- DM Message Delete / Edit ---

// DELETE /messages/:id — delete a DM message off-chain
app.delete('/messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const address = req.query.address as string;
    if (!address) return res.status(400).json({ error: 'address required' });

    const msg = await Message.findByPk(id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.sender !== address) return res.status(403).json({ error: 'Only sender can delete' });

    const dialogHash = msg.dialog_hash;
    await msg.destroy();

    // Broadcast deletion to all relevant clients
    wss.clients.forEach((client: any) => {
      if (client.readyState === WebSocket.OPEN) {
        const subHash = client.subscribedHash;
        if (subHash && (subHash === msg.sender_hash || subHash === msg.recipient_hash)) {
          client.send(JSON.stringify({ type: 'message_deleted', payload: { id } }));
        }
      }
    });

    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /messages/:id error:', e);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// POST /messages/:id/edit — edit a DM message off-chain
app.post('/messages/:id/edit', async (req, res) => {
  try {
    const { id } = req.params;
    const { address, encryptedPayload, encryptedPayloadSelf } = req.body;
    if (!address || !encryptedPayload) return res.status(400).json({ error: 'address and encryptedPayload required' });

    const msg = await Message.findByPk(id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.sender !== address) return res.status(403).json({ error: 'Only sender can edit' });

    msg.encrypted_payload = encryptedPayload.slice(0, 50000);
    if (encryptedPayloadSelf) msg.encrypted_payload_self = encryptedPayloadSelf.slice(0, 50000);
    await msg.save();

    // Broadcast edit to all relevant clients
    wss.clients.forEach((client: any) => {
      if (client.readyState === WebSocket.OPEN) {
        const subHash = client.subscribedHash;
        if (subHash && (subHash === msg.sender_hash || subHash === msg.recipient_hash)) {
          client.send(JSON.stringify({
            type: 'message_updated',
            payload: {
              id, encryptedPayload: msg.encrypted_payload,
              encryptedPayloadSelf: msg.encrypted_payload_self,
              sender: msg.sender, recipient: msg.recipient,
              timestamp: msg.timestamp
            }
          }));
        }
      }
    });

    res.json({ success: true });
  } catch (e) {
    console.error('POST /messages/:id/edit error:', e);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// --- Rooms / Channels / Groups ---

// Helper: enrich rooms with member count
async function withMemberCount(rooms: any[]): Promise<any[]> {
  return Promise.all(rooms.map(async (r: any) => {
    const count = await RoomMember.count({ where: { room_id: r.id } });
    // Fetch last message for sidebar preview
    const lastMsg = await RoomMessage.findOne({
      where: { room_id: r.id },
      order: [['timestamp', 'DESC']],
      limit: 1
    });
    return {
      ...r.toJSON(),
      memberCount: count,
      lastMessage: lastMsg ? lastMsg.text : null,
      lastMessageTime: lastMsg ? lastMsg.timestamp : null
    };
  }));
}

// GET /rooms — list rooms by type
app.get('/rooms', async (req, res) => {
  try {
    const type = req.query.type as string;
    const address = req.query.address as string;

    if (type === 'group' && address) {
      // Groups: only where user is a member
      const memberships = await RoomMember.findAll({ where: { user_id: address } });
      const roomIds = memberships.map(m => m.room_id);
      if (roomIds.length === 0) return res.json([]);
      const rooms = await Room.findAll({ where: { id: roomIds, type: 'group' }, order: [['createdAt', 'DESC']] });
      return res.json(await withMemberCount(rooms));
    }

    if (type === 'channel') {
      const rooms = await Room.findAll({ where: { type: 'channel' }, order: [['createdAt', 'DESC']] });
      return res.json(await withMemberCount(rooms));
    }

    // Default: all non-private rooms
    const rooms = await Room.findAll({ where: { is_private: false }, order: [['createdAt', 'DESC']] });
    res.json(await withMemberCount(rooms));
  } catch (e) {
    console.error('GET /rooms error:', e);
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// GET /rooms/:id — room details + members
app.get('/rooms/:id', async (req, res) => {
  try {
    const room = await Room.findByPk(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const members = await RoomMember.findAll({ where: { room_id: room.id } });
    res.json({ ...room.toJSON(), members: members.map(m => m.user_id) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch room' });
  }
});

// POST /rooms — create a room
app.post('/rooms', async (req, res) => {
  try {
    const { name, type, creatorAddress } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) return res.status(400).json({ error: 'name required' });
    if (name.trim().length > 100) return res.status(400).json({ error: 'name too long (max 100)' });
    if (!creatorAddress || typeof creatorAddress !== 'string') return res.status(400).json({ error: 'creatorAddress required' });

    const roomType = type === 'group' ? 'group' : 'channel';
    const isPrivate = roomType === 'group';
    const roomId = uuidv4();

    await Room.create({ id: roomId, name: name.slice(0, 100), created_by: creatorAddress, is_private: isPrivate, type: roomType });
    await RoomMember.create({ room_id: roomId, user_id: creatorAddress });

    const room = await Room.findByPk(roomId);
    const roomData = { ...room!.toJSON(), memberCount: 1 };

    // Broadcast to all WS clients if channel (public)
    if (roomType === 'channel') {
      wss.clients.forEach((client: any) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'room_created', payload: roomData }));
        }
      });
    }

    res.json(roomData);
  } catch (e) {
    console.error('POST /rooms error:', e);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// PATCH /rooms/:id — rename room
app.patch('/rooms/:id', async (req, res) => {
  try {
    const { name, address } = req.body;
    if (!name || !address) return res.status(400).json({ error: 'name and address required' });

    const room = await Room.findByPk(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.created_by !== address) return res.status(403).json({ error: 'Only creator can rename' });

    room.name = name;
    await room.save();

    broadcastToRoom(room.id, { type: 'room_renamed', payload: { roomId: room.id, name } });

    res.json({ success: true, room: { id: room.id, name: room.name, type: room.type, createdBy: room.created_by, isPrivate: room.is_private } });
  } catch (e) {
    console.error('PATCH /rooms error:', e);
    res.status(500).json({ error: 'Failed to rename room' });
  }
});

// DELETE /rooms/:id — delete room (creator only)
app.delete('/rooms/:id', async (req, res) => {
  try {
    const room = await Room.findByPk(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const address = req.query.address as string;
    if (room.created_by !== address) return res.status(403).json({ error: 'Only creator can delete' });

    const roomId = room.id;

    // Broadcast deletion to subscribed clients
    broadcastToRoom(roomId, { type: 'room_deleted', payload: { roomId } });

    // Remove room subscriptions from all WS clients
    wss.clients.forEach((client: any) => {
      if (client.subscribedRooms) client.subscribedRooms.delete(roomId);
    });

    // Cascade delete
    await RoomMessage.destroy({ where: { room_id: roomId } });
    await RoomMember.destroy({ where: { room_id: roomId } });
    await room.destroy();

    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /rooms error:', e);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

// POST /rooms/:id/join — join a room
app.post('/rooms/:id/join', async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: 'address required' });

    const room = await Room.findByPk(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    await RoomMember.findOrCreate({ where: { room_id: room.id, user_id: address }, defaults: { room_id: room.id, user_id: address } });

    const members = await RoomMember.findAll({ where: { room_id: room.id } });
    broadcastToRoom(room.id, { type: 'room_member_joined', payload: { roomId: room.id, address, members: members.map(m => m.user_id) } });

    res.json({ success: true, members: members.map(m => m.user_id) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// POST /rooms/:id/leave — leave a room
app.post('/rooms/:id/leave', async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: 'address required' });

    await RoomMember.destroy({ where: { room_id: req.params.id, user_id: address } });
    broadcastToRoom(req.params.id, { type: 'room_member_left', payload: { roomId: req.params.id, address } });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to leave room' });
  }
});

// GET /rooms/:id/messages — room messages
app.get('/rooms/:id/messages', async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 1, 100, 50);
    const offset = clampInt(req.query.offset, 0, 100000, 0);
    const messages = await RoomMessage.findAll({
      where: { room_id: req.params.id },
      order: [['timestamp', 'ASC']],
      limit,
      offset,
    });
    res.json(messages);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch room messages' });
  }
});

// DELETE /rooms/:roomId/messages/:msgId — delete a room message
app.delete('/rooms/:roomId/messages/:msgId', async (req, res) => {
  try {
    const { roomId, msgId } = req.params;
    const address = req.query.address as string;
    if (!address) return res.status(400).json({ error: 'address required' });

    const msg = await RoomMessage.findByPk(msgId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.sender !== address) {
      // Check if user is room creator
      const room = await Room.findByPk(roomId);
      if (!room || room.created_by !== address) {
        return res.status(403).json({ error: 'Only sender or room creator can delete' });
      }
    }

    await msg.destroy();
    broadcastToRoom(roomId, { type: 'room_message_deleted', payload: { roomId, messageId: msgId } });
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE room message error:', e);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// PATCH /rooms/:roomId/messages/:msgId — edit a room message
app.post('/rooms/:roomId/messages/:msgId/edit', async (req, res) => {
  try {
    const { roomId, msgId } = req.params;
    const { address, text } = req.body;
    if (!address || !text) return res.status(400).json({ error: 'address and text required' });

    const msg = await RoomMessage.findByPk(msgId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.sender !== address) return res.status(403).json({ error: 'Only sender can edit' });

    msg.text = text.slice(0, 10000);
    await msg.save();

    broadcastToRoom(roomId, { type: 'room_message_edited', payload: { roomId, messageId: msgId, text: msg.text } });
    res.json({ success: true });
  } catch (e) {
    console.error('PATCH room message error:', e);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// DELETE /rooms/dm-clear — clear DM history between two addresses
app.delete('/rooms/dm-clear', async (req, res) => {
  try {
    const { dialogHash } = req.body;
    if (!dialogHash || typeof dialogHash !== 'string') return res.status(400).json({ error: 'dialogHash required' });

    await Message.destroy({ where: { dialog_hash: dialogHash } });

    // Notify all WS clients in this dialog
    wss.clients.forEach((client: any) => {
      if (client.readyState === WebSocket.OPEN && (client.subscribedDialog === dialogHash || (client.subscribedHash && dialogHash.includes(client.subscribedHash)))) {
        client.send(JSON.stringify({ type: 'dm_cleared', payload: { dialogHash } }));
      }
    });

    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /rooms/dm-clear error:', e);
    res.status(500).json({ error: 'Failed to clear DM' });
  }
});

// --- Pinned Messages ---

// GET /pins/:contextId — get pinned messages for a dialog or room
app.get('/pins/:contextId', async (req, res) => {
  try {
    const { contextId } = req.params;
    if (!contextId || contextId.length > 300) return res.json([]);
    const pins = await PinnedMessage.findAll({ where: { context_id: contextId }, order: [['createdAt', 'DESC']], limit: 50 });
    res.json(pins);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch pins' });
  }
});

// POST /pins — pin a message
app.post('/pins', async (req, res) => {
  try {
    const { contextId, messageId, pinnedBy, messageText } = req.body;
    if (!contextId || !messageId || !pinnedBy) return res.status(400).json({ error: 'Missing fields' });

    await PinnedMessage.findOrCreate({
      where: { context_id: contextId.slice(0, 300), message_id: messageId.slice(0, 300) },
      defaults: { context_id: contextId.slice(0, 300), message_id: messageId.slice(0, 300), pinned_by: pinnedBy.slice(0, 100), message_text: (messageText || '').slice(0, 5000) }
    });

    const pins = await PinnedMessage.findAll({ where: { context_id: contextId }, order: [['createdAt', 'DESC']] });

    // Broadcast pin update
    wss.clients.forEach((client: any) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'pin_update', payload: { contextId, pins: pins.map((p: any) => p.toJSON()) } }));
      }
    });

    res.json({ success: true });
  } catch (e) {
    console.error('POST /pins error:', e);
    res.status(500).json({ error: 'Failed to pin message' });
  }
});

// DELETE /pins — unpin a message
app.delete('/pins', async (req, res) => {
  try {
    const { contextId, messageId } = req.body;
    if (!contextId || !messageId) return res.status(400).json({ error: 'Missing fields' });

    await PinnedMessage.destroy({ where: { context_id: contextId, message_id: messageId } });

    const pins = await PinnedMessage.findAll({ where: { context_id: contextId }, order: [['createdAt', 'DESC']] });

    wss.clients.forEach((client: any) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'pin_update', payload: { contextId, pins: pins.map((p: any) => p.toJSON()) } }));
      }
    });

    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /pins error:', e);
    res.status(500).json({ error: 'Failed to unpin message' });
  }
});

// --- Start ---

const PORT = Number(process.env.PORT) || 3002;

initDB().then(() => {
  indexer.start();
  server.listen(PORT, () => {
    console.log(`Ghost backend running on port ${PORT}`);
  });
});
