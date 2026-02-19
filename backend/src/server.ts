import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { initDB, Message, Profile, SyncStatus, Reaction, Room, RoomMember, RoomMessage, RoomKey, PinnedMessage, UserPreferences, SessionRecord, PinnedFile, MessageEditHistory, DeletedMessage, sequelize } from './database';
import { v4 as uuidv4 } from 'uuid';
import { IndexerService } from './services/indexer';
import { Op } from 'sequelize';
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { randomBytes } from 'crypto';
import multer from 'multer';

const app = express();
const server = createServer(app);

// --- Validation Limits ---
const LIMITS = {
  USERNAME: 50,
  BIO: 500,
  MESSAGE_TEXT: 10000,
  ENCRYPTED_PAYLOAD: 50000,
  ROOM_NAME: 100,
  ATTACHMENT_PART: 500,
  HASH: 600,
  ADDRESS: 200,
  REPLY_TEXT: 5000,
  TX_ID: 200,
  ENCRYPTION_KEY: 500,
  ROOM_MESSAGE: 10000,
} as const;

// --- Security Middleware ---

// HTTP security headers with CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline needed for React
      styleSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline for Tailwind
      imgSrc: ["'self'", "data:", "https:", "ipfs.io", "*.ipfs.io", "cloudflare-ipfs.com"],
      connectSrc: ["'self'", "ws:", "wss:", "https:", "ipfs.io", "*.ipfs.io"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "https:", "ipfs.io", "*.ipfs.io"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginEmbedderPolicy: false // Keep disabled for IPFS compatibility
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

// Socket.io server — replaces native WebSocket
const io = new SocketIOServer(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

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
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json({ limit: '500kb' })); // Encrypted payloads can be large

const indexer = new IndexerService(io);

// --- Session Management ---

interface Session {
  address: string;
  limited: boolean; // true = new user, can only register profile
  createdAt: number;
}

const sessions = new Map<string, Session>();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

const CHALLENGE_TTL = 5 * 60 * 1000; // 5 minutes to complete auth challenge
const pendingChallenges = new Map<string, { challenge: string; address: string; createdAt: number }>();

// Persistent session helpers
async function persistSession(token: string, session: Omit<Session, never>) {
  try {
    await SessionRecord.upsert({ token, address: session.address, limited: session.limited, created_at: session.createdAt });
  } catch { /* non-critical */ }
}
async function deletePersistedSession(token: string) {
  try {
    await SessionRecord.destroy({ where: { token } });
  } catch { /* non-critical */ }
}
async function loadPersistedSessions() {
  try {
    const now = Date.now();
    const records = await SessionRecord.findAll();
    let loaded = 0;
    for (const r of records) {
      const createdAt = Number(r.created_at);
      if (now - createdAt > SESSION_TTL) {
        r.destroy().catch(() => {});
      } else {
        sessions.set(r.token, { address: r.address, limited: r.limited, createdAt });
        loaded++;
      }
    }
    if (loaded > 0) console.log(`[Sessions] Restored ${loaded} persistent sessions`);
  } catch (e) {
    console.error('[Sessions] Failed to load persistent sessions:', e);
  }
}

// Cleanup expired sessions and stale challenges every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(token);
      deletePersistedSession(token);
    }
  }
  // Sweep stale pending challenges (e.g. client disconnected without completing auth)
  for (const [ws, pending] of pendingChallenges) {
    if (now - pending.createdAt > CHALLENGE_TTL) pendingChallenges.delete(ws);
  }
}, 60 * 60 * 1000);

// --- Rate Limiting (per-user when authenticated, per-IP fallback) ---

/** Extract authenticated user address from Bearer token, fall back to IP */
function rateLimitKeyGenerator(req: any): string {
  const authHeader = req.headers?.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const session = sessions.get(token);
    if (session && Date.now() - session.createdAt <= SESSION_TTL) {
      return `user:${session.address}`;
    }
  }
  return `ip:${req.ip}`;
}

// Global rate limiter: 600 requests per 15 minutes
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  message: { error: 'Too many requests, please try again later' },
  validate: false
}));

// Stricter limiter for search endpoint
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  keyGenerator: rateLimitKeyGenerator,
  message: { error: 'Search rate limit exceeded' },
  validate: false
});

// Stricter limiter for profile creation
const profileWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: rateLimitKeyGenerator,
  message: { error: 'Profile update rate limit exceeded' },
  validate: false
});

// --- Auth Middleware ---

function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.slice(7);
  const session = sessions.get(token);
  if (!session || Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(token);
    deletePersistedSession(token);
    return res.status(401).json({ error: 'Session expired' });
  }
  req.authenticatedAddress = session.address;
  req.sessionLimited = session.limited;
  next();
}

function requireFullAuth(req: any, res: any, next: any) {
  requireAuth(req, res, () => {
    if (req.sessionLimited) {
      return res.status(403).json({ error: 'Full authentication required. Register profile first.' });
    }
    next();
  });
}

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

// --- Socket.io Connection ---

// Per-socket WS message rate limit
const WS_MSG_LIMIT = 30; // max messages per 60s
const WS_MSG_WINDOW = 60_000;

// Helper: broadcast event to all sockets in a Socket.io room
function broadcastToRoom(roomId: string, eventName: string, data: any, excludeSocketId?: string) {
  const target = io.to('room:' + roomId);
  if (excludeSocketId) {
    (target as any).except(excludeSocketId).emit(eventName, data);
  } else {
    target.emit(eventName, data);
  }
}

io.on('connection', (socket) => {
  socket.data.msgTimestamps = [] as number[];
  socket.data.authenticated = false;
  socket.data.lastSeen = Date.now();

  // Per-socket rate limit check
  const rlOk = (): boolean => {
    const now = Date.now();
    socket.data.msgTimestamps = (socket.data.msgTimestamps || []).filter((t: number) => now - t < WS_MSG_WINDOW);
    if (socket.data.msgTimestamps.length >= WS_MSG_LIMIT) {
      socket.emit('error', 'Rate limit exceeded');
      return false;
    }
    socket.data.msgTimestamps.push(now);
    return true;
  };

  // Authentication guard
  const authOk = (): boolean => {
    if (!socket.data.authenticated) {
      socket.emit('error', 'Authentication required. Send AUTH message first.');
      return false;
    }
    return true;
  };

  // ── AUTH ─────────────────────────────────────────────────────────────────
  socket.on('AUTH', async (data: any) => {
    if (!rlOk()) return;
    const { address } = data || {};
    if (!address || !isValidAddress(address)) {
      socket.emit('AUTH_FAILED', { message: 'Invalid address' });
      return;
    }

    const profile = await Profile.findByPk(address);
    if (!profile || !profile.encryption_public_key) {
      // New user — limited token
      const token = uuidv4();
      const session = { address, limited: true, createdAt: Date.now() };
      sessions.set(token, session);
      persistSession(token, session);
      socket.data.authenticated = true;
      socket.data.authenticatedAddress = address;
      socket.data.sessionToken = token;
      socket.join('addr:' + address);
      socket.emit('AUTH_SUCCESS', { address, token, requiresProfile: true });
      return;
    }

    // Existing user — NaCl challenge-response
    try {
      const challenge = encodeBase64(nacl.randomBytes(32));
      const clientPubKey = decodeBase64(profile.encryption_public_key);
      const serverTempKeys = nacl.box.keyPair();
      const nonce = nacl.randomBytes(nacl.box.nonceLength);
      const challengeBytes = new TextEncoder().encode(challenge);
      const encrypted = nacl.box(challengeBytes, nonce, clientPubKey, serverTempKeys.secretKey);

      pendingChallenges.set(socket.id, { challenge, address, createdAt: Date.now() });
      socket.emit('AUTH_CHALLENGE', {
        encryptedChallenge: encodeBase64(encrypted),
        nonce: encodeBase64(nonce),
        serverPublicKey: encodeBase64(serverTempKeys.publicKey)
      });
    } catch (e) {
      console.error('AUTH challenge generation failed:', e);
      // Fallback: limited token
      const token = uuidv4();
      const fallbackSession = { address, limited: true, createdAt: Date.now() };
      sessions.set(token, fallbackSession);
      persistSession(token, fallbackSession);
      socket.data.authenticated = true;
      socket.data.authenticatedAddress = address;
      socket.data.sessionToken = token;
      socket.join('addr:' + address);
      socket.emit('AUTH_SUCCESS', { address, token, requiresProfile: true });
    }
  });

  // ── AUTH_RESPONSE ─────────────────────────────────────────────────────────
  socket.on('AUTH_RESPONSE', (data: any) => {
    if (!rlOk()) return;
    const pending = pendingChallenges.get(socket.id);
    if (!pending) {
      socket.emit('AUTH_FAILED', { message: 'No pending challenge' });
      return;
    }
    pendingChallenges.delete(socket.id);

    if (data?.decryptedChallenge === pending.challenge) {
      const token = uuidv4();
      const fullSession = { address: pending.address, limited: false, createdAt: Date.now() };
      sessions.set(token, fullSession);
      persistSession(token, fullSession);
      socket.data.authenticated = true;
      socket.data.authenticatedAddress = pending.address;
      socket.data.sessionToken = token;
      socket.join('addr:' + pending.address);
      socket.emit('AUTH_SUCCESS', { address: pending.address, token });
    } else {
      socket.emit('AUTH_FAILED', { message: 'Challenge verification failed' });
    }
  });

  // ── AUTH_KEY_MISMATCH ─────────────────────────────────────────────────────
  socket.on('AUTH_KEY_MISMATCH', (data: any) => {
    if (!rlOk()) return;
    const pending = pendingChallenges.get(socket.id);
    const address = pending?.address || data?.address;
    pendingChallenges.delete(socket.id);

    if (!address || !isValidAddress(address)) {
      socket.emit('AUTH_FAILED', { message: 'Invalid address' });
      return;
    }

    const token = uuidv4();
    const newSession = { address, limited: true, createdAt: Date.now() };
    sessions.set(token, newSession);
    persistSession(token, newSession);
    socket.data.authenticated = true;
    socket.data.authenticatedAddress = address;
    socket.data.sessionToken = token;
    socket.join('addr:' + address);
    socket.emit('AUTH_SUCCESS', { address, token, requiresProfile: true });
  });

  // ── SUBSCRIBE ─────────────────────────────────────────────────────────────
  socket.on('SUBSCRIBE', async (data: any) => {
    if (!rlOk() || !authOk()) return;

    if (data?.address && data.address !== socket.data.authenticatedAddress) {
      socket.emit('error', 'Subscribe address must match authenticated address');
      return;
    }

    if (data?.addressHash && typeof data.addressHash === 'string' && isValidHash(data.addressHash)) {
      socket.data.subscribedHash = data.addressHash;
      socket.data.lastSeen = Date.now();
      socket.join('user:' + data.addressHash);
    }

    if (data?.dialogHash && typeof data.dialogHash === 'string' && isValidHash(data.dialogHash)) {
      socket.data.subscribedDialog = data.dialogHash;
      socket.join('dialog:' + data.dialogHash);
    }

    // Auto-subscribe to user's rooms
    if (socket.data.authenticatedAddress) {
      const memberships = await RoomMember.findAll({ where: { user_id: socket.data.authenticatedAddress } });
      for (const m of memberships) {
        socket.join('room:' + m.room_id);
      }
    }

    // Push messages received while offline (last 30 days, max 500)
    if (socket.data.subscribedHash) {
      try {
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const pending = await Message.findAll({
          where: { recipient_hash: socket.data.subscribedHash, timestamp: { [Op.gte]: thirtyDaysAgo } },
          order: [['timestamp', 'ASC']],
          limit: 500
        });

        if (pending.length > 0) {
          const senderAddresses = [...new Set(pending.map(m => m.sender).filter(Boolean))];
          const profiles = await Profile.findAll({
            where: { address: senderAddresses },
            attributes: ['address', 'encryption_public_key']
          });
          const encKeyMap = new Map<string, string>(
            profiles.filter(p => p.encryption_public_key).map(p => [p.address, p.encryption_public_key!])
          );

          socket.emit('pending_messages', pending.map(msg => ({
            id: msg.id,
            dialogHash: msg.dialog_hash,
            recipientHash: msg.recipient_hash,
            senderHash: msg.sender_hash,
            sender: msg.sender,
            recipient: msg.recipient,
            encryptedPayload: msg.encrypted_payload,
            encryptedPayloadSelf: msg.encrypted_payload_self || '',
            timestamp: msg.timestamp,
            attachmentPart1: msg.attachment_part1 || '',
            attachmentPart2: msg.attachment_part2 || '',
            replyToId: msg.reply_to_id || '',
            replyToText: msg.reply_to_text || '',
            replyToSender: msg.reply_to_sender || '',
            senderEncryptionKey: encKeyMap.get(msg.sender) || '',
            status: msg.status
          })));
          console.log(`[SUBSCRIBE] Pushed ${pending.length} pending DMs to ${socket.data.authenticatedAddress?.slice(0, 10)}`);
        }
      } catch (err) {
        console.error('[SUBSCRIBE] Failed to push pending messages:', err);
      }
    }
  });

  // ── SUBSCRIBE_ROOM ────────────────────────────────────────────────────────
  socket.on('SUBSCRIBE_ROOM', async (data: any) => {
    if (!rlOk() || !authOk()) return;
    const { roomId } = data || {};
    if (!roomId || typeof roomId !== 'string') return;

    const room = await Room.findByPk(roomId);
    if (room && room.is_private && socket.data.authenticatedAddress) {
      const isMember = await RoomMember.findOne({ where: { room_id: roomId, user_id: socket.data.authenticatedAddress } });
      if (!isMember) {
        socket.emit('error', 'Not a member of this room');
        return;
      }
    }
    socket.join('room:' + roomId);
  });

  // ── UNSUBSCRIBE_ROOM ──────────────────────────────────────────────────────
  socket.on('UNSUBSCRIBE_ROOM', (data: any) => {
    if (!rlOk() || !authOk()) return;
    const { roomId } = data || {};
    if (!roomId || typeof roomId !== 'string') return;
    socket.leave('room:' + roomId);
  });

  // ── ROOM_MESSAGE ──────────────────────────────────────────────────────────
  socket.on('ROOM_MESSAGE', async (data: any) => {
    if (!rlOk() || !authOk()) return;
    const sender = socket.data.authenticatedAddress;
    const { roomId, text, senderName } = data || {};
    if (!sender || !roomId || !text) return;

    const membership = await RoomMember.findOne({ where: { room_id: roomId, user_id: sender } });
    if (!membership) { socket.emit('error', 'Not a member of this room'); return; }

    const msgId = uuidv4();
    const timestamp = Date.now();
    const resolvedSenderName = (senderName || sender.slice(0, 8) + '...').slice(0, 100);
    await RoomMessage.create({
      id: msgId,
      room_id: roomId.slice(0, 100),
      sender: sender.slice(0, 100),
      sender_name: resolvedSenderName,
      text: text.slice(0, LIMITS.ROOM_MESSAGE),
      timestamp,
    });
    io.to('room:' + roomId).emit('room_message', { id: msgId, roomId, sender, senderName: resolvedSenderName, text, timestamp });
  });

  // ── ROOM_TYPING ───────────────────────────────────────────────────────────
  socket.on('ROOM_TYPING', (data: any) => {
    if (!rlOk() || !authOk()) return;
    const { roomId } = data || {};
    if (!roomId) return;
    socket.to('room:' + roomId).emit('room_typing', { roomId, sender: socket.data.authenticatedAddress });
  });

  // ── TYPING ────────────────────────────────────────────────────────────────
  socket.on('TYPING', (data: any) => {
    if (!rlOk() || !authOk()) return;
    const { dialogHash, senderHash } = data || {};
    if (!dialogHash || !senderHash) return;
    for (const part of dialogHash.split('_')) {
      if (part !== senderHash) {
        io.to('user:' + part).emit('TYPING', { dialogHash, senderHash });
      }
    }
  });

  // ── READ_RECEIPT ──────────────────────────────────────────────────────────
  socket.on('READ_RECEIPT', async (data: any) => {
    if (!rlOk() || !authOk()) return;
    const { dialogHash, senderHash, messageIds: rawIds } = data || {};
    if (!dialogHash || !senderHash || !Array.isArray(rawIds)) return;

    const messageIds: string[] = rawIds.slice(0, 100);
    const readAt = Date.now();

    Message.update(
      { status: 'read', read_at: readAt },
      { where: { id: messageIds, status: { [Op.ne]: 'read' } } }
    ).catch(e => console.error('Failed to persist read receipts:', e));

    for (const part of dialogHash.split('_')) {
      if (part !== senderHash) {
        io.to('user:' + part).emit('READ_RECEIPT', { dialogHash, messageIds, readAt });
      }
    }
  });

  // ── DM_MESSAGE ────────────────────────────────────────────────────────────
  socket.on('DM_MESSAGE', async (data: any) => {
    if (!rlOk() || !authOk()) return;
    try {
      const { senderHash, recipientHash, dialogHash, encryptedPayload, encryptedPayloadSelf, timestamp,
              attachmentPart1, attachmentPart2, tempId, replyToId, replyToText, replyToSender } = data || {};
      const sender = socket.data.authenticatedAddress;

      if (!sender || !senderHash || !recipientHash || !dialogHash || !encryptedPayload || !timestamp) {
        socket.emit('error', 'Missing required DM fields');
        return;
      }

      const msgId = uuidv4();

      // Resolve recipient address (multiple strategies)
      let resolvedRecipient = 'unknown';
      const recipientProfile = await Profile.findOne({ where: { address_hash: recipientHash } });
      if (recipientProfile) resolvedRecipient = recipientProfile.address;

      if (resolvedRecipient === 'unknown') {
        try {
          const prevMsg = await Message.findOne({
            where: { dialog_hash: dialogHash, recipient_hash: recipientHash, recipient: { [Op.ne]: 'unknown' } },
            attributes: ['recipient'], order: [['timestamp', 'DESC']]
          });
          if (prevMsg?.recipient) {
            resolvedRecipient = prevMsg.recipient;
          } else {
            const prevSenderMsg = await Message.findOne({
              where: { dialog_hash: dialogHash, sender_hash: recipientHash },
              attributes: ['sender'], order: [['timestamp', 'DESC']]
            });
            if (prevSenderMsg?.sender) resolvedRecipient = prevSenderMsg.sender;
          }
        } catch { /* non-critical */ }
      }

      const [msg, created] = await Message.findOrCreate({
        where: { sender_hash: senderHash.slice(0, 300), recipient_hash: recipientHash.slice(0, 300), timestamp },
        defaults: {
          id: msgId, sender: sender.slice(0, 100), recipient: resolvedRecipient,
          sender_hash: senderHash.slice(0, 300), recipient_hash: recipientHash.slice(0, 300),
          dialog_hash: dialogHash.slice(0, 600),
          encrypted_payload: encryptedPayload.slice(0, 50000),
          encrypted_payload_self: (encryptedPayloadSelf || '').slice(0, 50000),
          nonce: '', timestamp, block_height: 0, status: 'confirmed',
          attachment_part1: (attachmentPart1 || '').slice(0, 500),
          attachment_part2: (attachmentPart2 || '').slice(0, 500),
          reply_to_id: (replyToId || '').slice(0, 300),
          reply_to_text: (replyToText || '').slice(0, 5000),
          reply_to_sender: (replyToSender || '').slice(0, 100),
        }
      });

      const realId = created ? msgId : msg.id;

      // Fetch sender encryption key (retry up to 3x — profile may be registering)
      let senderEncKey = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        const senderProfile = await Profile.findByPk(sender);
        if (senderProfile?.encryption_public_key) { senderEncKey = senderProfile.encryption_public_key; break; }
        if (attempt < 2) await new Promise(r => setTimeout(r, 500));
      }

      const messagePayload = {
        id: realId, dialogHash, recipientHash, senderHash, sender, recipient: resolvedRecipient,
        encryptedPayload, encryptedPayloadSelf, timestamp,
        attachmentPart1: attachmentPart1 || '', attachmentPart2: attachmentPart2 || '',
        replyToId: replyToId || '', replyToText: replyToText || '', replyToSender: replyToSender || '',
        senderEncryptionKey: senderEncKey, status: 'confirmed'
      };

      // Check if sender is blocked by recipient
      let recipientBlocked = false;
      if (resolvedRecipient !== 'unknown') {
        try {
          const recipientPrefs = await UserPreferences.findByPk(resolvedRecipient);
          if (recipientPrefs?.blocked_users) {
            recipientBlocked = JSON.parse(recipientPrefs.blocked_users || '[]').includes(sender);
          }
        } catch { /* non-critical */ }
      }

      if (recipientBlocked) socket.emit('blocked_by_user', { address: resolvedRecipient });

      // Deliver to recipient (if not blocked) and sender's other sessions
      if (!recipientBlocked) io.to('user:' + recipientHash).emit('message_detected', messagePayload);
      socket.to('user:' + senderHash).emit('message_detected', messagePayload);

      console.log(`[DM] ${sender.slice(0, 10)}→${resolvedRecipient.slice(0, 10)} id=${realId.slice(0, 8)} encKey=${senderEncKey ? 'yes' : 'NO'}`);
      socket.emit('dm_sent', { tempId, id: realId, timestamp, dialogHash });
    } catch (e) {
      console.error('DM_MESSAGE handler error:', e);
    }
  });

  // ── HEARTBEAT ─────────────────────────────────────────────────────────────
  socket.on('HEARTBEAT', () => {
    const now = Date.now();
    socket.data.lastSeen = now;
    if (socket.data.authenticatedAddress && (!socket.data.lastSeenDbWrite || now - socket.data.lastSeenDbWrite > 30000)) {
      socket.data.lastSeenDbWrite = now;
      Profile.update({ last_seen: now }, { where: { address: socket.data.authenticatedAddress } }).catch(() => {});
    }
  });

  // ── DISCONNECT ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    pendingChallenges.delete(socket.id);
    if (socket.data.authenticatedAddress) {
      Profile.update({ last_seen: Date.now() }, { where: { address: socket.data.authenticatedAddress } }).catch(() => {});
    }
  });
});

// --- Online Status Endpoint ---
const onlineStatusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: rateLimitKeyGenerator,
  message: { error: 'Online status rate limit exceeded' },
  validate: false
});

app.get('/online/:addressHash', onlineStatusLimiter, async (_req, res) => {
  const { addressHash } = _req.params;
  let isOnline = false;
  let lastSeen = 0;

  const room = io.sockets.adapter.rooms.get('user:' + addressHash);
  if (room && room.size > 0) {
    isOnline = true;
    for (const socketId of room) {
      const s = io.sockets.sockets.get(socketId);
      if (s?.data.lastSeen) lastSeen = Math.max(lastSeen, s.data.lastSeen);
    }
  }

  // Respect show_last_seen preference + get persisted last_seen from DB
  let showLastSeen = true;
  let showAvatar = true;
  try {
    const profile = await Profile.findOne({ where: { address_hash: addressHash } });
    if (profile) {
      showLastSeen = profile.show_last_seen !== false;
      showAvatar = profile.show_avatar !== false;
      // Use persisted last_seen if in-memory is missing (e.g., after server restart)
      if (!lastSeen && profile.last_seen) {
        lastSeen = Number(profile.last_seen);
      }
    }
  } catch { /* ignore */ }

  res.json({
    online: isOnline,
    lastSeen: showLastSeen ? lastSeen : null,
    showAvatar
  });
});

// --- Link Preview Endpoint ---
const linkPreviewCache = new Map<string, { data: any; expires: number }>();
const linkPreviewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: rateLimitKeyGenerator,
  message: { error: 'Link preview rate limit exceeded' },
  validate: false
});

app.get('/link-preview', linkPreviewLimiter, async (req, res) => {
  try {
    const url = req.query.url as string;
    if (!url || url.length > 2048 || !/^https?:\/\/.+/.test(url)) {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    // SSRF protection: block private/internal IPs
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' ||
          hostname === '::1' || hostname === '[::1]' || hostname.endsWith('.local') ||
          /^10\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
          /^192\.168\./.test(hostname) || /^169\.254\./.test(hostname)) {
        return res.status(400).json({ error: 'URL not allowed' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    // Check cache (15min TTL)
    const cached = linkPreviewCache.get(url);
    if (cached && typeof cached.expires === 'number' && cached.expires > Date.now()) {
      return res.json(cached.data);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'GhostMessenger/1.0 LinkPreview' }
    });
    clearTimeout(timeout);

    if (!response.ok) return res.json({ title: null, description: null, image: null });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return res.json({ title: null, description: null, image: null });
    }

    const html = await response.text();
    const getMetaContent = (name: string): string | null => {
      const patterns = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, 'i'),
      ];
      for (const p of patterns) {
        const m = html.match(p);
        if (m) return m[1];
      }
      return null;
    };

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const result = {
      title: getMetaContent('og:title') || titleMatch?.[1]?.trim() || null,
      description: getMetaContent('og:description') || getMetaContent('description') || null,
      image: getMetaContent('og:image') || null,
      siteName: getMetaContent('og:site_name') || null,
    };

    // Cache for 15 minutes (max 200 entries)
    linkPreviewCache.set(url, { data: result, expires: Date.now() + 15 * 60 * 1000 });

    // Cleanup: remove expired + enforce max size (200 entries)
    if (linkPreviewCache.size > 200) {
      const now = Date.now();
      const entries = Array.from(linkPreviewCache.entries());
      // Remove expired first
      for (const [k, v] of entries) {
        if (v.expires < now) linkPreviewCache.delete(k);
      }
      // If still over limit, remove oldest entries
      if (linkPreviewCache.size > 200) {
        const sortedByAge = entries.sort((a, b) => a[1].expires - b[1].expires);
        const toRemove = sortedByAge.slice(0, linkPreviewCache.size - 200);
        toRemove.forEach(([k]) => linkPreviewCache.delete(k));
      }
    }

    res.json(result);
  } catch (e) {
    res.json({ title: null, description: null, image: null });
  }
});

// --- Routes ---

// GET /messages/:dialogHash — messages for a dialog or address
app.get('/messages/:dialogHash', requireAuth, async (req: any, res) => {
  try {
    const { dialogHash } = req.params;
    if (!isValidHash(dialogHash)) return res.status(400).json({ error: 'Invalid hash' });

    const limit = clampInt(req.query.limit, 1, 200, 100);
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
app.get('/messages/dialog/:dialogHash', requireAuth, async (req: any, res) => {
  try {
    const { dialogHash } = req.params;
    if (!isValidHash(dialogHash)) return res.status(400).json({ error: 'Invalid hash' });

    const limit = clampInt(req.query.limit, 1, 200, 100);
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
app.get('/dialogs/:addressHash', requireAuth, async (req: any, res) => {
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

    // Search by username OR address (case-insensitive)
    const lowerQ = sanitized.toLowerCase();
    const isAddress = lowerQ.startsWith('aleo1');
    const lowerFn = sequelize.fn('LOWER', sequelize.col('username'));
    const profiles = await Profile.findAll({
      where: {
        [Op.or]: [
          sequelize.where(lowerFn, { [Op.like]: `%${lowerQ}%` }),
          ...(isAddress ? [{ address: { [Op.like]: `%${lowerQ}%` } }] : [])
        ]
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

// GET /history/:address — transaction history (requires full auth + ownership)
app.get('/history/:address', requireFullAuth, async (req: any, res) => {
  try {
    const address = req.authenticatedAddress; // Use authenticated address
    if (req.params.address !== address) {
      return res.status(403).json({ error: 'Can only access your own history' });
    }
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

// POST /profiles — upsert profile (encryption key exchange) — requires auth
app.post('/profiles', requireAuth, profileWriteLimiter, async (req: any, res) => {
  try {
    const address = req.authenticatedAddress; // Use authenticated address, not client-provided
    const { name, bio, txId, encryptionPublicKey, addressHash, showLastSeen, showProfilePhoto, avatarCid } = req.body;

    // Build update data — only include non-empty fields to avoid overwriting
    const data: any = { address };

    if (typeof name === 'string' && name.length > 0) {
      // Validate username: alphanumeric, dash, underscore only (prevent XSS)
      const sanitizedName = name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().slice(0, 50);
      if (sanitizedName.length === 0) {
        return res.status(400).json({ error: 'Username contains invalid characters' });
      }
      data.username = sanitizedName;
    }
    if (typeof bio === 'string' && bio.length > 0) {
      // Sanitize bio: strip HTML tags, limit length
      const sanitizedBio = bio.replace(/<[^>]*>/g, '').trim().slice(0, 500);
      data.bio = sanitizedBio;
    }
    if (typeof txId === 'string' && txId.length > 0) {
      data.tx_id = txId.slice(0, 200);
    }
    if (typeof encryptionPublicKey === 'string' && encryptionPublicKey.length > 0) {
      data.encryption_public_key = encryptionPublicKey.slice(0, 500);
    }
    if (typeof addressHash === 'string' && addressHash.length > 0) {
      data.address_hash = addressHash.slice(0, 500);
    }
    if (typeof showLastSeen === 'boolean') {
      data.show_last_seen = showLastSeen;
    }
    if (typeof showProfilePhoto === 'boolean') {
      data.show_avatar = showProfilePhoto;
    }
    if (typeof avatarCid === 'string' && avatarCid.length > 0) {
      // IPFS CID validation: must start with Qm or bafy (CIDv0/v1)
      if (avatarCid.startsWith('Qm') || avatarCid.startsWith('bafy')) {
        data.avatar_cid = avatarCid.slice(0, 200);
      }
    } else if (avatarCid === null || avatarCid === '') {
      // Allow clearing avatar
      data.avatar_cid = null;
    }

    await Profile.upsert(data);

    // Broadcast profile update to all connected clients (so they see the new name / avatar change)
    if (data.username || typeof showProfilePhoto === 'boolean' || data.avatar_cid !== undefined) {
      io.emit('profile_detected', { address, username: data.username, showAvatar: data.show_avatar, avatarCid: data.avatar_cid });
    }

    // If this was a limited session and user just registered with an encryption key,
    // upgrade the session to full access
    if (req.sessionLimited && encryptionPublicKey) {
      const token = req.headers.authorization?.slice(7);
      if (token && sessions.has(token)) {
        const s = sessions.get(token)!;
        s.limited = false;
        persistSession(token, s);
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error('POST /profiles error:', e);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

// --- Logout Endpoint ---
app.post('/logout', requireAuth, (req: any, res) => {
  const token = req.headers.authorization?.slice(7);
  if (token && sessions.has(token)) {
    sessions.delete(token);
    deletePersistedSession(token);
    console.log(`[Auth] Session invalidated for ${req.authenticatedAddress?.slice(0, 14)}... (logout)`);
  }
  res.json({ success: true });
});

// --- IPFS Pin Tracking ---

// POST /ipfs/pin — register a new pinned file
app.post('/ipfs/pin', requireAuth, async (req: any, res) => {
  try {
    const { cid, fileName, fileSize, mimeType, context } = req.body;
    if (!cid || typeof cid !== 'string') {
      return res.status(400).json({ error: 'CID required' });
    }
    if (!cid.startsWith('Qm') && !cid.startsWith('bafy')) {
      return res.status(400).json({ error: 'Invalid IPFS CID format' });
    }

    await PinnedFile.upsert({
      cid: cid.slice(0, 200),
      uploader_address: req.authenticatedAddress,
      file_name: (fileName || '').slice(0, 255),
      file_size: typeof fileSize === 'number' ? fileSize : 0,
      mime_type: (mimeType || '').slice(0, 100),
      pin_status: 'pinned',
      last_verified: Date.now(),
      context: (context || 'attachment').slice(0, 20),
    });

    res.json({ success: true });
  } catch (e) {
    console.error('POST /ipfs/pin error:', e);
    res.status(500).json({ error: 'Failed to register pin' });
  }
});

// POST /ipfs/upload — proxy file upload to Pinata (keeps JWT on server)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB

const uploadLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { error: 'Too many uploads' } });

app.post('/ipfs/upload', requireAuth, uploadLimiter, upload.single('file'), async (req: any, res) => {
  try {
    const PINATA_JWT = process.env.PINATA_JWT;
    if (!PINATA_JWT) {
      return res.status(503).json({ error: 'IPFS upload not configured on server' });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Build multipart form for Pinata
    const FormData = (await import('form-data')).default;
    const formData = new FormData();
    formData.append('file', file.buffer, { filename: file.originalname, contentType: file.mimetype });

    const axios = (await import('axios')).default;
    const pinataRes = await axios.post('https://api.pinata.cloud/pinning/pinFileToIPFS', formData, {
      headers: {
        'Authorization': `Bearer ${PINATA_JWT}`,
        ...formData.getHeaders(),
      },
      maxContentLength: 15 * 1024 * 1024,
      maxBodyLength: 15 * 1024 * 1024,
    });

    const cid = pinataRes.data.IpfsHash;

    // Auto-register pin
    await PinnedFile.upsert({
      cid: cid.slice(0, 200),
      uploader_address: req.authenticatedAddress,
      file_name: (file.originalname || '').slice(0, 255),
      file_size: file.size || 0,
      mime_type: (file.mimetype || '').slice(0, 100),
      pin_status: 'pinned',
      last_verified: Date.now(),
      context: ((req.body?.context) || 'attachment').slice(0, 20),
    });

    res.json({ cid });
  } catch (e: any) {
    console.error('POST /ipfs/upload error:', e?.response?.data || e.message);
    res.status(500).json({ error: 'Upload to IPFS failed' });
  }
});

// GET /ipfs/pins/:address — list pinned files for a user
app.get('/ipfs/pins/:address', requireAuth, async (req: any, res) => {
  try {
    if (req.authenticatedAddress !== req.params.address) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const pins = await PinnedFile.findAll({
      where: { uploader_address: req.params.address },
      order: [['createdAt', 'DESC']],
      limit: 100,
    });
    res.json({ pins });
  } catch (e) {
    console.error('GET /ipfs/pins error:', e);
    res.status(500).json({ error: 'Failed to fetch pins' });
  }
});

// GET /ipfs/verify/:cid — check if a CID is still accessible
app.get('/ipfs/verify/:cid', async (req, res) => {
  try {
    const { cid } = req.params;
    if (!cid.startsWith('Qm') && !cid.startsWith('bafy')) {
      return res.status(400).json({ error: 'Invalid CID' });
    }

    // Check IPFS gateway with a HEAD request (fast, no download)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`https://ipfs.io/ipfs/${cid}`, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const accessible = response.ok;
      // Update pin record
      await PinnedFile.update(
        { pin_status: accessible ? 'pinned' : 'lost', last_verified: Date.now() },
        { where: { cid } }
      );

      res.json({ cid, accessible, status: response.status });
    } catch {
      clearTimeout(timeout);
      await PinnedFile.update(
        { pin_status: 'lost', last_verified: Date.now() },
        { where: { cid } }
      );
      res.json({ cid, accessible: false, status: 0 });
    }
  } catch (e) {
    console.error('GET /ipfs/verify error:', e);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// --- User Preferences ---

// Rate limiter for preferences
const preferencesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  keyGenerator: rateLimitKeyGenerator,
  message: { error: 'Preferences rate limit exceeded' },
  validate: false
});

// GET /preferences/:address — get user preferences (requires auth + ownership)
app.get('/preferences/:address', requireAuth, preferencesLimiter, async (req: any, res) => {
  const address = req.params.address as string;
  if (address !== req.authenticatedAddress) {
    return res.status(403).json({ error: 'Can only access your own preferences' });
  }
  const defaults = {
    address,
    pinned_chats: [],
    muted_chats: [],
    deleted_chats: [],
    saved_contacts: [],
    disappear_timers: {},
    blocked_users: [],
    encrypted_keys: null,
    key_nonce: null,
    settings: {},
    migrated: false
  };

  try {
    if (!isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    const prefs = await UserPreferences.findByPk(address);
    if (!prefs) {
      return res.json(defaults);
    }

    const safeParse = (str: string | null, fallback: any) => {
      try { return JSON.parse(str || (Array.isArray(fallback) ? '[]' : '{}')); }
      catch { return fallback; }
    };

    res.json({
      address: prefs.address,
      pinned_chats: safeParse(prefs.pinned_chats, []),
      muted_chats: safeParse(prefs.muted_chats, []),
      deleted_chats: safeParse(prefs.deleted_chats, []),
      saved_contacts: safeParse(prefs.saved_contacts, []),
      disappear_timers: safeParse(prefs.disappear_timers, {}),
      blocked_users: safeParse(prefs.blocked_users, []),
      encrypted_keys: null, // Secret keys no longer returned — derived from wallet
      key_nonce: null,
      settings: safeParse(prefs.settings, {}),
      migrated: prefs.migrated || false
    });
  } catch (e: any) {
    console.error('GET /preferences error:', e);
    // If table doesn't exist yet, return defaults instead of 500
    if (e.message?.includes('no such table') || e.name === 'SequelizeDatabaseError') {
      return res.json(defaults);
    }
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// GET /blocked-by/:address — check which users have blocked this address
app.get('/blocked-by/:address', requireAuth, async (req: any, res) => {
  try {
    const address = req.params.address as string;
    if (address !== req.authenticatedAddress) {
      return res.status(403).json({ error: 'Can only check your own block status' });
    }

    // Find all preferences where blocked_users contains this address
    const allPrefs = await UserPreferences.findAll({
      attributes: ['address', 'blocked_users'],
      where: sequelize.where(
        sequelize.col('blocked_users'),
        { [Op.like]: `%${address}%` }
      )
    });

    const blockedBy: string[] = [];
    for (const pref of allPrefs) {
      try {
        const list: string[] = JSON.parse(pref.blocked_users || '[]');
        if (list.includes(address)) {
          blockedBy.push(pref.address);
        }
      } catch { /* skip malformed */ }
    }

    res.json({ blockedBy });
  } catch (e) {
    console.error('GET /blocked-by error:', e);
    res.status(500).json({ error: 'Failed to check block status' });
  }
});

// POST /preferences/:address — update user preferences (requires auth + ownership)
app.post('/preferences/:address', requireAuth, preferencesLimiter, async (req: any, res) => {
  try {
    const address = req.params.address as string;
    if (address !== req.authenticatedAddress) {
      return res.status(403).json({ error: 'Can only update your own preferences' });
    }

    const { pinnedChats, mutedChats, deletedChats, savedContacts, disappearTimers, blockedUsers, settings, migrated } = req.body;
    // Note: encryptedKeys and keyNonce are no longer accepted — keys derived from wallet

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

    if (savedContacts !== undefined) {
      if (!Array.isArray(savedContacts)) return res.status(400).json({ error: 'savedContacts must be array' });
      data.saved_contacts = JSON.stringify(savedContacts.slice(0, 500));
    }

    if (disappearTimers !== undefined) {
      if (typeof disappearTimers !== 'object' || disappearTimers === null || Array.isArray(disappearTimers)) {
        return res.status(400).json({ error: 'disappearTimers must be object' });
      }
      // Validate: max 100 entries, values must be valid timer keys
      const validTimerValues = ['off', '30s', '5m', '1h', '24h'];
      const entries = Object.entries(disappearTimers);
      if (entries.length > 100) return res.status(400).json({ error: 'Too many disappearTimers entries' });
      for (const [key, val] of entries) {
        if (typeof key !== 'string' || key.length > 300 || typeof val !== 'string' || !validTimerValues.includes(val)) {
          return res.status(400).json({ error: 'Invalid disappearTimers value' });
        }
      }
      data.disappear_timers = JSON.stringify(disappearTimers);
    }

    if (blockedUsers !== undefined) {
      if (!Array.isArray(blockedUsers)) return res.status(400).json({ error: 'blockedUsers must be array' });
      // Validate: max 500 entries, each must be a string address
      const validBlocked = blockedUsers.slice(0, 500).filter((a: any) => typeof a === 'string' && a.length > 0 && a.length <= 200);
      data.blocked_users = JSON.stringify(validBlocked);
    }

    if (settings !== undefined) {
      if (typeof settings !== 'object' || settings === null) {
        return res.status(400).json({ error: 'settings must be object' });
      }
      data.settings = JSON.stringify(settings);
    }

    if (migrated !== undefined) {
      data.migrated = !!migrated;
    }

    // Detect block/unblock changes to notify affected users
    let previousBlocked: string[] = [];
    if (blockedUsers !== undefined) {
      try {
        const existing = await UserPreferences.findByPk(address);
        if (existing?.blocked_users) {
          previousBlocked = JSON.parse(existing.blocked_users || '[]');
        }
      } catch { /* non-critical */ }
    }

    await UserPreferences.upsert(data);

    // Notify newly blocked/unblocked users via Socket.io
    if (blockedUsers !== undefined) {
      const newBlocked: string[] = JSON.parse(data.blocked_users);
      const justBlocked = newBlocked.filter(a => !previousBlocked.includes(a));
      const justUnblocked = previousBlocked.filter(a => !newBlocked.includes(a));

      for (const blockedAddr of justBlocked) {
        io.to('addr:' + blockedAddr).emit('blocked_by_user', { address });
      }
      for (const unblockedAddr of justUnblocked) {
        io.to('addr:' + unblockedAddr).emit('unblocked_by_user', { address });
      }
    }

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
  keyGenerator: rateLimitKeyGenerator,
  message: { error: 'Reaction rate limit exceeded' },
  validate: false
});

function isValidEmoji(str: string): boolean {
  if (typeof str !== 'string' || str.length === 0 || str.length > 32) return false;
  // Count Unicode codepoints (not UTF-16 length) to properly handle multi-byte emoji
  const codepoints = [...str].length;
  return codepoints >= 1 && codepoints <= 8;
}

// POST /reactions/batch — get reactions for multiple messages at once
app.post('/reactions/batch', requireAuth, async (req: any, res) => {
  try {
    const { messageIds } = req.body;
    if (!Array.isArray(messageIds) || messageIds.length === 0) return res.json({});
    // Limit to 200 message IDs per request, validate each ID
    const ids = messageIds.slice(0, 200).filter((id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 300 && isValidHash(id as string));
    if (ids.length === 0) return res.json({});

    const reactions = await Reaction.findAll({ where: { message_id: ids } });

    // Group by messageId -> emoji -> [users]
    const result: Record<string, Record<string, string[]>> = {};
    for (const r of reactions) {
      if (!result[r.message_id]) result[r.message_id] = {};
      if (!result[r.message_id][r.emoji]) result[r.message_id][r.emoji] = [];
      result[r.message_id][r.emoji].push(r.user_address);
    }

    res.json(result);
  } catch (e) {
    console.error('POST /reactions/batch error:', e);
    res.status(500).json({ error: 'Failed to fetch reactions' });
  }
});

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
app.post('/reactions', requireAuth, reactionLimiter, async (req: any, res) => {
  try {
    const userAddress = req.authenticatedAddress; // Use authenticated address
    const { messageId, emoji } = req.body;
    if (!messageId || typeof messageId !== 'string') return res.status(400).json({ error: 'messageId required' });
    if (!isValidEmoji(emoji)) return res.status(400).json({ error: 'Invalid emoji' });

    await Reaction.findOrCreate({
      where: { message_id: messageId.slice(0, 300), user_address: userAddress.slice(0, 100), emoji: emoji.slice(0, 8) },
      defaults: { message_id: messageId.slice(0, 300), user_address: userAddress.slice(0, 100), emoji: emoji.slice(0, 8) }
    });

    // Get message to find sender/recipient
    const message = await Message.findByPk(messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Broadcast reaction only to clients subscribed to this message's dialog
    const allReactions = await Reaction.findAll({ where: { message_id: messageId } });
    const grouped: Record<string, string[]> = {};
    for (const r of allReactions) {
      if (!grouped[r.emoji]) grouped[r.emoji] = [];
      grouped[r.emoji].push(r.user_address);
    }

    io.to('user:' + message.sender_hash).emit('REACTION_UPDATE', { messageId, reactions: grouped });
    io.to('user:' + message.recipient_hash).emit('REACTION_UPDATE', { messageId, reactions: grouped });

    res.json({ success: true });
  } catch (e) {
    console.error('POST /reactions error:', e);
    res.status(500).json({ error: 'Failed to add reaction' });
  }
});

// DELETE /reactions — remove a reaction
app.delete('/reactions', requireAuth, reactionLimiter, async (req: any, res) => {
  try {
    const userAddress = req.authenticatedAddress; // Use authenticated address
    const { messageId, emoji } = req.body;
    if (!messageId || !emoji) return res.status(400).json({ error: 'Missing fields' });

    await Reaction.destroy({
      where: { message_id: messageId.slice(0, 300), user_address: userAddress.slice(0, 100), emoji: emoji.slice(0, 8) }
    });

    // Get message to find sender/recipient
    const message = await Message.findByPk(messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Broadcast updated reactions only to relevant clients
    const allReactions = await Reaction.findAll({ where: { message_id: messageId } });
    const grouped: Record<string, string[]> = {};
    for (const r of allReactions) {
      if (!grouped[r.emoji]) grouped[r.emoji] = [];
      grouped[r.emoji].push(r.user_address);
    }

    io.to('user:' + message.sender_hash).emit('REACTION_UPDATE', { messageId, reactions: grouped });
    io.to('user:' + message.recipient_hash).emit('REACTION_UPDATE', { messageId, reactions: grouped });

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
app.delete('/messages/:id', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const address = req.authenticatedAddress; // Use authenticated address

    const msg = await Message.findByPk(id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.sender !== address) return res.status(403).json({ error: 'Only sender can delete' });

    // Save deletion audit record
    await DeletedMessage.create({
      message_id: id,
      dialog_hash: msg.dialog_hash || null,
      deleted_by: address,
      deleted_at: Date.now(),
      sender: msg.sender,
      recipient: msg.recipient,
    }).catch(e => console.error('Failed to save delete audit:', e));

    const dialogHash = msg.dialog_hash;
    await msg.destroy();

    // Broadcast deletion to relevant users
    io.to('user:' + msg.sender_hash).emit('message_deleted', { id });
    io.to('user:' + msg.recipient_hash).emit('message_deleted', { id });

    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /messages/:id error:', e);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// POST /messages/:id/edit — edit a DM message off-chain
app.post('/messages/:id/edit', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const address = req.authenticatedAddress; // Use authenticated address
    const { encryptedPayload, encryptedPayloadSelf } = req.body;
    if (!encryptedPayload) return res.status(400).json({ error: 'encryptedPayload required' });

    const msg = await Message.findByPk(id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.sender !== address) return res.status(403).json({ error: 'Only sender can edit' });

    // Save previous version to edit history
    const editedAt = Date.now();
    await MessageEditHistory.create({
      message_id: id,
      previous_payload: msg.encrypted_payload,
      previous_payload_self: msg.encrypted_payload_self || null,
      edited_by: address,
      edited_at: editedAt,
    });

    // Update the message
    msg.encrypted_payload = encryptedPayload.slice(0, 50000);
    if (encryptedPayloadSelf) msg.encrypted_payload_self = encryptedPayloadSelf.slice(0, 50000);
    msg.edited_at = editedAt;
    msg.edit_count = (Number(msg.edit_count) || 0) + 1;
    await msg.save();

    // Broadcast edit to relevant users
    const editPayload = {
      id, encryptedPayload: msg.encrypted_payload,
      encryptedPayloadSelf: msg.encrypted_payload_self,
      sender: msg.sender, recipient: msg.recipient,
      timestamp: msg.timestamp, editedAt, editCount: msg.edit_count
    };
    io.to('user:' + msg.sender_hash).emit('message_updated', editPayload);
    io.to('user:' + msg.recipient_hash).emit('message_updated', editPayload);

    res.json({ success: true, editedAt, editCount: msg.edit_count });
  } catch (e) {
    console.error('POST /messages/:id/edit error:', e);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// GET /messages/:id/history — get edit history for a message
app.get('/messages/:id/history', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const address = req.authenticatedAddress;

    // Verify the requester is sender or recipient
    const msg = await Message.findByPk(id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.sender !== address && msg.recipient !== address) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const history = await MessageEditHistory.findAll({
      where: { message_id: id },
      order: [['edited_at', 'DESC']],
      limit: 50,
    });

    res.json({ history });
  } catch (e) {
    console.error('GET /messages/:id/history error:', e);
    res.status(500).json({ error: 'Failed to fetch edit history' });
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

    if (type && type !== 'group' && type !== 'channel') {
      return res.status(400).json({ error: 'type must be "group" or "channel"' });
    }

    if (type === 'group' && address) {
      if (!isValidAddress(address)) return res.status(400).json({ error: 'Invalid address' });
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
app.get('/rooms/:id', requireAuth, async (req: any, res) => {
  try {
    const room = await Room.findByPk(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    // Private rooms require membership
    if (room.is_private) {
      const address = req.authenticatedAddress;
      const member = await RoomMember.findOne({ where: { room_id: room.id, user_id: address } });
      if (!member) return res.status(403).json({ error: 'Not a member of this private room' });
    }

    const members = await RoomMember.findAll({ where: { room_id: room.id } });
    res.json({ ...room.toJSON(), members: members.map(m => m.user_id) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch room' });
  }
});

// POST /rooms — create a room (requires full auth)
app.post('/rooms', requireFullAuth, async (req: any, res) => {
  try {
    const creatorAddress = req.authenticatedAddress; // Use authenticated address
    const { name, type } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) return res.status(400).json({ error: 'name required' });
    const sanitizedName = name.replace(/[\x00-\x1F\x7F]/g, '').trim(); // Strip control characters
    if (sanitizedName.length === 0) return res.status(400).json({ error: 'name required' });
    if (sanitizedName.length > 100) return res.status(400).json({ error: 'name too long (max 100)' });

    const roomType = type === 'group' ? 'group' : 'channel';
    const isPrivate = roomType === 'group';
    const roomId = uuidv4();

    await Room.create({ id: roomId, name: sanitizedName.slice(0, 100), created_by: creatorAddress, is_private: isPrivate, type: roomType });
    await RoomMember.create({ room_id: roomId, user_id: creatorAddress });

    const room = await Room.findByPk(roomId);
    const roomData = { ...room!.toJSON(), memberCount: 1 };

    // Broadcast to all clients if channel (public)
    if (roomType === 'channel') {
      io.emit('room_created', roomData);
    }

    res.json(roomData);
  } catch (e) {
    console.error('POST /rooms error:', e);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// PATCH /rooms/:id — rename room (requires full auth)
app.patch('/rooms/:id', requireFullAuth, async (req: any, res) => {
  try {
    const address = req.authenticatedAddress; // Use authenticated address
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const room = await Room.findByPk(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.created_by !== address) return res.status(403).json({ error: 'Only creator can rename' });

    room.name = name;
    await room.save();

    broadcastToRoom(room.id, 'room_renamed', { roomId: room.id, name });

    res.json({ success: true, room: { id: room.id, name: room.name, type: room.type, createdBy: room.created_by, isPrivate: room.is_private } });
  } catch (e) {
    console.error('PATCH /rooms error:', e);
    res.status(500).json({ error: 'Failed to rename room' });
  }
});

// DELETE /rooms/dm-clear — clear DM history (requires full auth)
// MUST be before /rooms/:id to avoid :id catching "dm-clear"
app.delete('/rooms/dm-clear', requireFullAuth, async (req: any, res) => {
  try {
    const { dialogHash } = req.body;
    if (!dialogHash || typeof dialogHash !== 'string') return res.status(400).json({ error: 'dialogHash required' });

    await Message.destroy({ where: { dialog_hash: dialogHash } });

    // Notify users in this dialog
    for (const part of dialogHash.split('_')) {
      io.to('user:' + part).emit('dm_cleared', { dialogHash });
    }
    io.to('dialog:' + dialogHash).emit('dm_cleared', { dialogHash });

    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /rooms/dm-clear error:', e);
    res.status(500).json({ error: 'Failed to clear DM' });
  }
});

// DELETE /rooms/:id — delete room (creator only, requires full auth)
app.delete('/rooms/:id', requireFullAuth, async (req: any, res) => {
  try {
    const room = await Room.findByPk(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const address = req.authenticatedAddress; // Use authenticated address
    if (room.created_by !== address) return res.status(403).json({ error: 'Only creator can delete' });

    const roomId = room.id;

    // Broadcast deletion to subscribed clients + remove them from the room
    broadcastToRoom(roomId, 'room_deleted', { roomId });
    io.in('room:' + roomId).socketsLeave('room:' + roomId);

    // Cascade delete
    await RoomMessage.destroy({ where: { room_id: roomId } });
    await RoomMember.destroy({ where: { room_id: roomId } });
    await RoomKey.destroy({ where: { room_id: roomId } });
    await room.destroy();

    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /rooms error:', e);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

// POST /rooms/:id/join — join a room (requires full auth)
app.post('/rooms/:id/join', requireFullAuth, async (req: any, res) => {
  try {
    const address = req.authenticatedAddress; // Use authenticated address

    const room = await Room.findByPk(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    await RoomMember.findOrCreate({ where: { room_id: room.id, user_id: address }, defaults: { room_id: room.id, user_id: address } });

    const members = await RoomMember.findAll({ where: { room_id: room.id } });
    broadcastToRoom(room.id, 'room_member_joined', { roomId: room.id, address, members: members.map(m => m.user_id) });

    res.json({ success: true, members: members.map(m => m.user_id) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// POST /rooms/:id/leave — leave a room (requires full auth)
app.post('/rooms/:id/leave', requireFullAuth, async (req: any, res) => {
  try {
    const address = req.authenticatedAddress; // Use authenticated address

    await RoomMember.destroy({ where: { room_id: req.params.id, user_id: address } });
    broadcastToRoom(req.params.id, 'room_member_left', { roomId: req.params.id, address });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to leave room' });
  }
});

// GET /rooms/:id/messages — room messages
app.get('/rooms/:id/messages', requireAuth, async (req: any, res) => {
  try {
    const roomId = req.params.id;
    const address = req.authenticatedAddress;

    // Verify membership for private rooms
    const room = await Room.findByPk(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.is_private) {
      const member = await RoomMember.findOne({ where: { room_id: roomId, user_id: address } });
      if (!member) return res.status(403).json({ error: 'Not a member of this room' });
    }

    const limit = clampInt(req.query.limit, 1, 200, 100);
    const offset = clampInt(req.query.offset, 0, 100000, 0);
    const messages = await RoomMessage.findAll({
      where: { room_id: roomId },
      order: [['timestamp', 'ASC']],
      limit,
      offset,
    });
    res.json(messages);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch room messages' });
  }
});

// DELETE /rooms/:roomId/messages/:msgId — delete a room message (requires full auth)
app.delete('/rooms/:roomId/messages/:msgId', requireFullAuth, async (req: any, res) => {
  try {
    const { roomId, msgId } = req.params;
    const address = req.authenticatedAddress; // Use authenticated address

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
    broadcastToRoom(roomId, 'room_message_deleted', { roomId, messageId: msgId });
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE room message error:', e);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// PATCH /rooms/:roomId/messages/:msgId — edit a room message (requires full auth)
app.post('/rooms/:roomId/messages/:msgId/edit', requireFullAuth, async (req: any, res) => {
  try {
    const { roomId, msgId } = req.params;
    const address = req.authenticatedAddress; // Use authenticated address
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });

    const msg = await RoomMessage.findByPk(msgId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.sender !== address) return res.status(403).json({ error: 'Only sender can edit' });

    msg.text = text.slice(0, 10000);
    await msg.save();

    broadcastToRoom(roomId, 'room_message_edited', { roomId, messageId: msgId, text: msg.text });
    res.json({ success: true });
  } catch (e) {
    console.error('PATCH room message error:', e);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// GET /rooms/:id/keys — get my encrypted room key (requires full auth)
app.get('/rooms/:id/keys', requireFullAuth, async (req: any, res) => {
  try {
    const address = req.authenticatedAddress;
    const roomKey = await RoomKey.findOne({
      where: { room_id: req.params.id, user_address: address }
    });
    if (!roomKey) return res.json({ exists: false });
    res.json({
      exists: true,
      encrypted_room_key: roomKey.encrypted_room_key,
      nonce: roomKey.nonce,
      sender_public_key: roomKey.sender_public_key
    });
  } catch (e) {
    console.error('GET /rooms/:id/keys error:', e);
    res.status(500).json({ error: 'Failed to fetch room key' });
  }
});

// POST /rooms/:id/keys — store encrypted room keys for members (requires full auth)
app.post('/rooms/:id/keys', requireFullAuth, async (req: any, res) => {
  try {
    const address = req.authenticatedAddress;
    const { keys } = req.body; // Array of { userAddress, encryptedRoomKey, nonce, senderPublicKey }
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: 'keys array required' });
    }
    if (keys.length > 200) {
      return res.status(400).json({ error: 'Too many keys (max 200)' });
    }

    // Verify sender is a member of the room
    const member = await RoomMember.findOne({ where: { room_id: req.params.id, user_id: address } });
    if (!member) return res.status(403).json({ error: 'Not a member of this room' });

    for (const k of keys) {
      if (!k.userAddress || !k.encryptedRoomKey || !k.nonce || !k.senderPublicKey) continue;
      await RoomKey.upsert({
        room_id: req.params.id,
        user_address: k.userAddress.slice(0, 200),
        encrypted_room_key: k.encryptedRoomKey.slice(0, 500),
        nonce: k.nonce.slice(0, 100),
        sender_public_key: k.senderPublicKey.slice(0, 100),
      });
    }

    res.json({ success: true });
  } catch (e) {
    console.error('POST /rooms/:id/keys error:', e);
    res.status(500).json({ error: 'Failed to store room keys' });
  }
});

// GET /rooms/:id/members — list room members with their encryption public keys
app.get('/rooms/:id/members', requireFullAuth, async (req: any, res) => {
  try {
    const members = await RoomMember.findAll({ where: { room_id: req.params.id } });
    const memberAddresses = members.map(m => m.user_id);

    // Fetch encryption public keys for all members
    const profiles = await Profile.findAll({
      where: { address: memberAddresses },
      attributes: ['address', 'username', 'encryption_public_key']
    });
    const profileMap = new Map(profiles.map(p => [p.address, p]));

    const result = memberAddresses.map(addr => ({
      address: addr,
      username: profileMap.get(addr)?.username || null,
      encryption_public_key: profileMap.get(addr)?.encryption_public_key || null
    }));

    res.json(result);
  } catch (e) {
    console.error('GET /rooms/:id/members error:', e);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});


// --- Pinned Messages ---

// GET /pins/:contextId — get pinned messages for a dialog or room
app.get('/pins/:contextId', requireAuth, async (req: any, res) => {
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
app.post('/pins', requireAuth, async (req: any, res) => {
  try {
    const pinnedBy = req.authenticatedAddress; // Use authenticated address
    const { contextId, messageId, messageText } = req.body;
    if (!contextId || !messageId) return res.status(400).json({ error: 'Missing fields' });

    await PinnedMessage.findOrCreate({
      where: { context_id: contextId.slice(0, 300), message_id: messageId.slice(0, 300) },
      defaults: { context_id: contextId.slice(0, 300), message_id: messageId.slice(0, 300), pinned_by: pinnedBy.slice(0, 100), message_text: (messageText || '').slice(0, 5000) }
    });

    const pins = await PinnedMessage.findAll({ where: { context_id: contextId }, order: [['createdAt', 'DESC']] });

    // Broadcast pin update to dialog or room subscribers
    const pinData = { contextId, pins: pins.map((p: any) => p.toJSON()) };
    io.to('dialog:' + contextId).emit('pin_update', pinData);
    io.to('room:' + contextId).emit('pin_update', pinData);

    res.json({ success: true });
  } catch (e) {
    console.error('POST /pins error:', e);
    res.status(500).json({ error: 'Failed to pin message' });
  }
});

// DELETE /pins — unpin a message
app.delete('/pins', requireAuth, async (req: any, res) => {
  try {
    const { contextId, messageId } = req.body;
    if (!contextId || !messageId) return res.status(400).json({ error: 'Missing fields' });

    await PinnedMessage.destroy({ where: { context_id: contextId, message_id: messageId } });

    const pins = await PinnedMessage.findAll({ where: { context_id: contextId }, order: [['createdAt', 'DESC']] });

    // Broadcast pin update to dialog or room subscribers
    const pinData = { contextId, pins: pins.map((p: any) => p.toJSON()) };
    io.to('dialog:' + contextId).emit('pin_update', pinData);
    io.to('room:' + contextId).emit('pin_update', pinData);

    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /pins error:', e);
    res.status(500).json({ error: 'Failed to unpin message' });
  }
});

// --- Disappearing Messages Cleanup ---

const DISAPPEAR_TTLS: Record<string, number> = {
  '30s': 30_000,
  '5m': 5 * 60_000,
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000
};

/**
 * Server-side cleanup of expired disappearing messages.
 * Reads all user preferences with disappear timers and deletes expired messages from DB.
 */
async function cleanupExpiredMessages() {
  try {
    const allPrefs = await UserPreferences.findAll({
      where: {
        disappear_timers: { [Op.ne]: '{}' }
      }
    });

    const now = Date.now();
    let totalDeleted = 0;

    for (const pref of allPrefs) {
      const timers: Record<string, string> = JSON.parse(pref.disappear_timers || '{}');

      for (const [dialogHashOrContact, timerKey] of Object.entries(timers)) {
        if (timerKey === 'off' || !DISAPPEAR_TTLS[timerKey]) continue;
        const ttl = DISAPPEAR_TTLS[timerKey];
        const cutoff = now - ttl;

        // Delete expired messages from this dialog
        // dialogHashOrContact could be a contactId (address) — find all dialogs involving this address
        const deleted = await Message.destroy({
          where: {
            timestamp: { [Op.lt]: cutoff },
            [Op.or]: [
              { dialog_hash: dialogHashOrContact },
              { sender: dialogHashOrContact },
              { recipient: dialogHashOrContact }
            ]
          }
        });
        totalDeleted += deleted;
      }
    }

    if (totalDeleted > 0) {
      console.log(`[Cleanup] Deleted ${totalDeleted} expired disappearing messages`);
    }
  } catch (e) {
    console.error('[Cleanup] Failed to cleanup expired messages:', e);
  }
}

// --- Start ---

const PORT = Number(process.env.PORT) || 3002;

// Health check endpoint (useful for Railway/uptime monitoring)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

initDB().then(async () => {
  await loadPersistedSessions();
  indexer.start();

  // Run disappearing message cleanup every 60 seconds
  setInterval(cleanupExpiredMessages, 60_000);

  server.listen(PORT, () => {
    console.log(`Ghost backend running on port ${PORT}`);
    console.log(`Allowed CORS origins: ${ALLOWED_ORIGINS.join(', ')}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  });
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
