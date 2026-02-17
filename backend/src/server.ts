import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { initDB, Message, Profile, SyncStatus, Reaction, Room, RoomMember, RoomMessage, RoomKey, PinnedMessage, UserPreferences, sequelize } from './database';
import { v4 as uuidv4 } from 'uuid';
import { IndexerService } from './services/indexer';
import { Op } from 'sequelize';
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

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
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json({ limit: '100kb' }));

const indexer = new IndexerService(wss);

// --- Session Management ---

interface Session {
  address: string;
  limited: boolean; // true = new user, can only register profile
  createdAt: number;
}

const sessions = new Map<string, Session>();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
const CHALLENGE_TTL = 5 * 60 * 1000; // 5 minutes to complete auth challenge
const pendingChallenges = new Map<WebSocket, { challenge: string; address: string; createdAt: number }>();

// Cleanup expired sessions and stale challenges every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) sessions.delete(token);
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
      // WS message size limit: 64KB max
      const msgStr = message.toString();
      if (msgStr.length > 65536) {
        ws.send(JSON.stringify({ type: 'error', message: 'Message too large (max 64KB)' }));
        return;
      }

      // Rate limit WS messages
      const now = Date.now();
      ws._msgTimestamps = (ws._msgTimestamps || []).filter((t: number) => now - t < WS_MSG_WINDOW);
      if (ws._msgTimestamps.length >= WS_MSG_LIMIT) {
        ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }));
        return;
      }
      ws._msgTimestamps.push(now);

      let data: any;
      try {
        data = JSON.parse(msgStr);
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }

      // AUTH message — initiate challenge-response authentication
      if (data.type === 'AUTH') {
        const { address } = data;
        if (!address || !isValidAddress(address)) {
          ws.send(JSON.stringify({ type: 'AUTH_FAILED', message: 'Invalid address' }));
          return;
        }

        // Look up profile to get encryption public key
        const profile = await Profile.findByPk(address);

        if (!profile || !profile.encryption_public_key) {
          // New user — issue limited token (can only register profile)
          const token = uuidv4();
          sessions.set(token, { address, limited: true, createdAt: Date.now() });
          ws.authenticated = true;
          ws.authenticatedAddress = address;
          ws.sessionToken = token;
          ws.send(JSON.stringify({ type: 'AUTH_SUCCESS', address, token, requiresProfile: true }));
          return;
        }

        // Existing user — challenge-response with NaCl
        try {
          const challenge = encodeBase64(nacl.randomBytes(32));
          const clientPubKey = decodeBase64(profile.encryption_public_key);
          const serverTempKeys = nacl.box.keyPair();
          const nonce = nacl.randomBytes(nacl.box.nonceLength);
          const challengeBytes = new TextEncoder().encode(challenge);
          const encrypted = nacl.box(challengeBytes, nonce, clientPubKey, serverTempKeys.secretKey);

          pendingChallenges.set(ws, { challenge, address, createdAt: Date.now() });

          ws.send(JSON.stringify({
            type: 'AUTH_CHALLENGE',
            encryptedChallenge: encodeBase64(encrypted),
            nonce: encodeBase64(nonce),
            serverPublicKey: encodeBase64(serverTempKeys.publicKey)
          }));
        } catch (e) {
          console.error('AUTH challenge generation failed:', e);
          // Fallback: issue limited token if challenge fails (e.g. malformed key)
          const token = uuidv4();
          sessions.set(token, { address, limited: true, createdAt: Date.now() });
          ws.authenticated = true;
          ws.authenticatedAddress = address;
          ws.sessionToken = token;
          ws.send(JSON.stringify({ type: 'AUTH_SUCCESS', address, token, requiresProfile: true }));
        }
        return;
      }

      // AUTH_RESPONSE — verify challenge answer
      if (data.type === 'AUTH_RESPONSE') {
        const pending = pendingChallenges.get(ws);
        if (!pending) {
          ws.send(JSON.stringify({ type: 'AUTH_FAILED', message: 'No pending challenge' }));
          return;
        }
        pendingChallenges.delete(ws);

        if (data.decryptedChallenge === pending.challenge) {
          const token = uuidv4();
          sessions.set(token, { address: pending.address, limited: false, createdAt: Date.now() });
          ws.authenticated = true;
          ws.authenticatedAddress = pending.address;
          ws.sessionToken = token;
          ws.send(JSON.stringify({ type: 'AUTH_SUCCESS', address: pending.address, token }));
        } else {
          ws.send(JSON.stringify({ type: 'AUTH_FAILED', message: 'Challenge verification failed' }));
        }
        return;
      }

      // AUTH_KEY_MISMATCH — client's encryption keys changed, can't decrypt challenge
      // Issue limited token so client can re-register profile with new keys
      if (data.type === 'AUTH_KEY_MISMATCH') {
        const pending = pendingChallenges.get(ws);
        const address = pending?.address || data.address;
        pendingChallenges.delete(ws);

        if (!address || !isValidAddress(address)) {
          ws.send(JSON.stringify({ type: 'AUTH_FAILED', message: 'Invalid address' }));
          return;
        }

        const token = uuidv4();
        sessions.set(token, { address, limited: true, createdAt: Date.now() });
        ws.authenticated = true;
        ws.authenticatedAddress = address;
        ws.sessionToken = token;
        ws.send(JSON.stringify({ type: 'AUTH_SUCCESS', address, token, requiresProfile: true }));
        return;
      }

      // Require authentication for all other operations
      if (!ws.authenticated) {
        ws.send(JSON.stringify({ type: 'error', message: 'Authentication required. Send AUTH message first.' }));
        return;
      }

      if (data.type === 'SUBSCRIBE') {
        // Verify address matches authenticated address (prevent impersonation)
        if (data.address && data.address !== ws.authenticatedAddress) {
          ws.send(JSON.stringify({ type: 'error', message: 'Subscribe address must match authenticated address' }));
          return;
        }
        if (data.addressHash && typeof data.addressHash === 'string' && isValidHash(data.addressHash)) {
          ws.subscribedAddress = ws.authenticatedAddress; // Use authenticated address, not client-provided
          ws.subscribedHash = data.addressHash;
          ws.lastSeen = Date.now();
        }
        if (data.dialogHash && typeof data.dialogHash === 'string' && isValidHash(data.dialogHash)) {
          ws.subscribedDialog = data.dialogHash;
        }
        // Auto-subscribe to user's rooms using authenticated address
        if (ws.authenticatedAddress) {
          const memberships = await RoomMember.findAll({ where: { user_id: ws.authenticatedAddress } });
          for (const m of memberships) {
            ws.subscribedRooms.add(m.room_id);
          }
        }
      }

      // Subscribe to a specific room (cap at 100, verify membership for private rooms)
      if (data.type === 'SUBSCRIBE_ROOM' && data.roomId && typeof data.roomId === 'string') {
        if (ws.subscribedRooms.size < 100) {
          // Check if room is private (group) — require membership
          const room = await Room.findByPk(data.roomId);
          if (room && room.is_private && ws.authenticatedAddress) {
            const isMember = await RoomMember.findOne({ where: { room_id: data.roomId, user_id: ws.authenticatedAddress } });
            if (!isMember) {
              ws.send(JSON.stringify({ type: 'error', message: 'Not a member of this room' }));
            } else {
              ws.subscribedRooms.add(data.roomId);
            }
          } else {
            // Public channel — allow subscription
            ws.subscribedRooms.add(data.roomId);
          }
        }
      }

      // Unsubscribe from a room
      if (data.type === 'UNSUBSCRIBE_ROOM' && data.roomId && typeof data.roomId === 'string') {
        ws.subscribedRooms.delete(data.roomId);
      }

      // Room message — save and broadcast (enforce sender = authenticated user + membership check)
      if (data.type === 'ROOM_MESSAGE' && data.roomId && data.text && ws.authenticatedAddress) {
        const sender = ws.authenticatedAddress; // Use authenticated address, not client-provided
        // Verify sender is a member of this room
        const membership = await RoomMember.findOne({ where: { room_id: data.roomId, user_id: sender } });
        if (!membership) {
          ws.send(JSON.stringify({ type: 'error', message: 'Not a member of this room' }));
          return;
        }
        const msgId = uuidv4();
        const timestamp = Date.now();
        const senderName = data.senderName || sender.slice(0, 8) + '...';
        await RoomMessage.create({
          id: msgId,
          room_id: data.roomId.slice(0, 100),
          sender: sender.slice(0, 100),
          sender_name: senderName.slice(0, 100),
          text: data.text.slice(0, 10000),
          timestamp,
        });
        const msg = { type: 'room_message', payload: { id: msgId, roomId: data.roomId, sender, senderName, text: data.text, timestamp } };
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

      // Read receipt — persist to DB + relay to the sender
      if (data.type === 'READ_RECEIPT' && data.dialogHash && data.senderHash && Array.isArray(data.messageIds)) {
        const dialogParts = data.dialogHash.split('_');
        const messageIds: string[] = data.messageIds.slice(0, 100);
        const readAt = Date.now();

        // Persist read status to database
        Message.update(
          { status: 'read', read_at: readAt },
          { where: { id: messageIds, status: { [Op.ne]: 'read' } } }
        ).catch(e => console.error('Failed to persist read receipts:', e));

        // Broadcast to sender's sessions
        wss.clients.forEach((client: any) => {
          if (client !== ws && client.readyState === WebSocket.OPEN && client.subscribedHash) {
            if (dialogParts.includes(client.subscribedHash) && client.subscribedHash !== data.senderHash) {
              client.send(JSON.stringify({ type: 'READ_RECEIPT', payload: { dialogHash: data.dialogHash, messageIds, readAt } }));
            }
          }
        });
      }

      // DM message — off-chain encrypted direct message (enforce sender = authenticated user)
      if (data.type === 'DM_MESSAGE') {
        const { senderHash, recipientHash, dialogHash, encryptedPayload, encryptedPayloadSelf, timestamp, attachmentPart1, attachmentPart2, tempId, replyToId, replyToText, replyToSender } = data;
        const sender = ws.authenticatedAddress; // Use authenticated address, not client-provided
        if (!sender || !senderHash || !recipientHash || !dialogHash || !encryptedPayload || !timestamp) {
          ws.send(JSON.stringify({ type: 'error', message: 'Missing required DM fields' }));
          return;
        }

        const msgId = uuidv4();

        // Resolve recipient address from hash
        let resolvedRecipient = 'unknown';
        const recipientProfile = await Profile.findOne({ where: { address_hash: recipientHash } });
        if (recipientProfile) {
          resolvedRecipient = recipientProfile.address;
        } else {
          // Fallback: check connected WS clients for matching hash
          wss.clients.forEach((client: any) => {
            if (client.subscribedHash === recipientHash && client.authenticatedAddress) {
              resolvedRecipient = client.authenticatedAddress;
            }
          });
        }

        // Use findOrCreate to prevent duplicate messages (unique index: sender_hash + recipient_hash + timestamp)
        const [msg, created] = await Message.findOrCreate({
          where: { sender_hash: senderHash.slice(0, 300), recipient_hash: recipientHash.slice(0, 300), timestamp },
          defaults: {
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
            reply_to_id: (replyToId || '').slice(0, 300),
            reply_to_text: (replyToText || '').slice(0, 5000),
            reply_to_sender: (replyToSender || '').slice(0, 100),
          }
        });

        const realId = created ? msgId : msg.id;

        // Fetch sender's encryption public key so recipient can decrypt without extra REST call
        // Retry up to 3 times — profile POST may still be in flight for new users
        let senderEncKey = '';
        for (let attempt = 0; attempt < 3; attempt++) {
          const senderProfile = await Profile.findByPk(sender);
          if (senderProfile?.encryption_public_key) {
            senderEncKey = senderProfile.encryption_public_key;
            break;
          }
          if (attempt < 2) await new Promise(r => setTimeout(r, 500));
        }

        const messagePayload = {
          id: realId, dialogHash, recipientHash, senderHash,
          sender, recipient: resolvedRecipient,
          encryptedPayload, encryptedPayloadSelf,
          timestamp,
          attachmentPart1: attachmentPart1 || '',
          attachmentPart2: attachmentPart2 || '',
          replyToId: replyToId || '',
          replyToText: replyToText || '',
          replyToSender: replyToSender || '',
          senderEncryptionKey: senderEncKey,
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
        ws.send(JSON.stringify({ type: 'dm_sent', payload: { tempId, id: realId, timestamp } }));
      }

      // Heartbeat — update lastSeen (in-memory + database)
      if (data.type === 'HEARTBEAT') {
        const now = Date.now();
        ws.lastSeen = now;
        // Persist to database (throttled: only if >30s since last DB write)
        if (ws.authenticatedAddress && (!ws.lastSeenDbWrite || now - ws.lastSeenDbWrite > 30000)) {
          ws.lastSeenDbWrite = now;
          Profile.update({ last_seen: now }, { where: { address: ws.authenticatedAddress } }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('WS handler error:', e);
    }
  });

  // Mark as online
  ws.lastSeen = Date.now();

  ws.on('close', () => {
    pendingChallenges.delete(ws);
    // Persist last_seen to DB on disconnect
    if (ws.authenticatedAddress) {
      Profile.update({ last_seen: Date.now() }, { where: { address: ws.authenticatedAddress } }).catch(() => {});
    }
    // Clear subscriptions to help GC
    ws.subscribedRooms.clear();
    ws.subscribedHash = null;
    ws.subscribedDialog = null;
    // Security: invalidate session on disconnect to prevent stolen tokens
    if (ws.sessionToken) {
      sessions.delete(ws.sessionToken);
      console.log(`[WS] Session invalidated for ${ws.authenticatedAddress?.slice(0, 14)}... on disconnect`);
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

  wss.clients.forEach((client: any) => {
    if (client.subscribedHash === addressHash && client.readyState === WebSocket.OPEN) {
      isOnline = true;
      lastSeen = client.lastSeen || 0;
    }
  });

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
app.get('/messages/:dialogHash', async (req, res) => {
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
app.get('/messages/dialog/:dialogHash', async (req, res) => {
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
    const { name, bio, txId, encryptionPublicKey, addressHash, showLastSeen, showProfilePhoto } = req.body;

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

    await Profile.upsert(data);

    // Broadcast profile update to all connected clients (so they see the new name / avatar change)
    if (data.username || typeof showProfilePhoto === 'boolean') {
      const payload = { type: 'profile_detected', payload: { address, username: data.username, showAvatar: data.show_avatar } };
      wss.clients.forEach((client: any) => {
        if (client.readyState === WebSocket.OPEN && client.authenticatedAddress !== address) {
          client.send(JSON.stringify(payload));
        }
      });
    }

    // If this was a limited session and user just registered with an encryption key,
    // upgrade the session to full access
    if (req.sessionLimited && encryptionPublicKey) {
      const token = req.headers.authorization?.slice(7);
      if (token && sessions.has(token)) {
        sessions.get(token)!.limited = false;
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
    console.log(`[Auth] Session invalidated for ${req.authenticatedAddress?.slice(0, 14)}... (logout)`);
  }
  res.json({ success: true });
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

// POST /preferences/:address — update user preferences (requires auth + ownership)
app.post('/preferences/:address', requireAuth, preferencesLimiter, async (req: any, res) => {
  try {
    const address = req.params.address as string;
    if (address !== req.authenticatedAddress) {
      return res.status(403).json({ error: 'Can only update your own preferences' });
    }

    const { pinnedChats, mutedChats, deletedChats, savedContacts, disappearTimers, settings, migrated } = req.body;
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

    if (settings !== undefined) {
      if (typeof settings !== 'object' || settings === null) {
        return res.status(400).json({ error: 'settings must be object' });
      }
      data.settings = JSON.stringify(settings);
    }

    if (migrated !== undefined) {
      data.migrated = !!migrated;
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
app.post('/reactions/batch', async (req, res) => {
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

    wss.clients.forEach((client: any) => {
      if (client.readyState === WebSocket.OPEN) {
        const subHash = client.subscribedHash;
        // Only send to clients subscribed to sender or recipient hash
        if (subHash && (subHash === message.sender_hash || subHash === message.recipient_hash)) {
          client.send(JSON.stringify({ type: 'REACTION_UPDATE', payload: { messageId, reactions: grouped } }));
        }
      }
    });

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

    wss.clients.forEach((client: any) => {
      if (client.readyState === WebSocket.OPEN) {
        const subHash = client.subscribedHash;
        // Only send to clients subscribed to sender or recipient hash
        if (subHash && (subHash === message.sender_hash || subHash === message.recipient_hash)) {
          client.send(JSON.stringify({ type: 'REACTION_UPDATE', payload: { messageId, reactions: grouped } }));
        }
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
app.delete('/messages/:id', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const address = req.authenticatedAddress; // Use authenticated address

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
app.post('/messages/:id/edit', requireAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const address = req.authenticatedAddress; // Use authenticated address
    const { encryptedPayload, encryptedPayloadSelf } = req.body;
    if (!encryptedPayload) return res.status(400).json({ error: 'encryptedPayload required' });

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

    broadcastToRoom(room.id, { type: 'room_renamed', payload: { roomId: room.id, name } });

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

// DELETE /rooms/:id — delete room (creator only, requires full auth)
app.delete('/rooms/:id', requireFullAuth, async (req: any, res) => {
  try {
    const room = await Room.findByPk(req.params.id);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const address = req.authenticatedAddress; // Use authenticated address
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
    broadcastToRoom(room.id, { type: 'room_member_joined', payload: { roomId: room.id, address, members: members.map(m => m.user_id) } });

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
    broadcastToRoom(req.params.id, { type: 'room_member_left', payload: { roomId: req.params.id, address } });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to leave room' });
  }
});

// GET /rooms/:id/messages — room messages
app.get('/rooms/:id/messages', async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 1, 200, 100);
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
    broadcastToRoom(roomId, { type: 'room_message_deleted', payload: { roomId, messageId: msgId } });
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

    broadcastToRoom(roomId, { type: 'room_message_edited', payload: { roomId, messageId: msgId, text: msg.text } });
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

    // Broadcast pin update only to clients subscribed to this context (dialog or room)
    const pinPayload = JSON.stringify({ type: 'pin_update', payload: { contextId, pins: pins.map((p: any) => p.toJSON()) } });
    wss.clients.forEach((client: any) => {
      if (client.readyState === WebSocket.OPEN) {
        const isDialogSubscriber = client.subscribedDialog === contextId;
        const isRoomSubscriber = client.subscribedRooms?.has(contextId);
        if (isDialogSubscriber || isRoomSubscriber) {
          client.send(pinPayload);
        }
      }
    });

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

    // Broadcast pin update only to clients subscribed to this context
    const pinPayload = JSON.stringify({ type: 'pin_update', payload: { contextId, pins: pins.map((p: any) => p.toJSON()) } });
    wss.clients.forEach((client: any) => {
      if (client.readyState === WebSocket.OPEN) {
        const isDialogSubscriber = client.subscribedDialog === contextId;
        const isRoomSubscriber = client.subscribedRooms?.has(contextId);
        if (isDialogSubscriber || isRoomSubscriber) {
          client.send(pinPayload);
        }
      }
    });

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

initDB().then(() => {
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
