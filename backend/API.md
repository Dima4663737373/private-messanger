# Ghost Messenger — Backend API Documentation

Base URL: `https://<backend-host>` (Render deployment or `http://localhost:3001` for local dev)

## Authentication

All endpoints (except `/status` and `/health`) require HMAC-based authentication.

**Headers:**
- `x-address`: Aleo wallet address (e.g. `aleo1...`)
- `x-timestamp`: Unix timestamp (ms)
- `x-signature`: HMAC-SHA256(`address:timestamp`, server secret)

WebSocket authentication uses challenge-response with `AUTH` / `AUTH_RESPONSE` events.

---

## REST Endpoints

### Health / Status

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Health check (returns `{ status: 'ok' }`) |
| GET | `/status` | No | Server status with uptime, connections, DB info |

### Profiles

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/profiles/search?q=` | Yes | Search profiles by username |
| GET | `/profiles/hash/:hash` | Yes | Get profile by address hash |
| GET | `/profiles/:address` | Yes | Get profile by Aleo address |
| POST | `/profiles` | Yes | Create/update profile (username, bio, avatar, encryption key) |

**POST /profiles body:**
```json
{
  "address": "aleo1...",
  "username": "alice",
  "bio": "Hello",
  "show_avatar": true,
  "encryption_public_key": "base64..."
}
```

### Messages (DM)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/messages/:dialogHash` | Yes | Get messages for a dialog (query: `limit`, `offset`) |
| GET | `/messages/dialog/:dialogHash` | Yes | Alias for above |
| GET | `/messages/:id/history` | Yes | Get edit history for a message |
| POST | `/messages/:id/edit` | Yes | Edit a message |
| DELETE | `/messages/:id` | Yes | Delete a message |

**POST /messages/:id/edit body:**
```json
{
  "encrypted_payload": "nonce.ciphertext",
  "encrypted_payload_self": "nonce.ciphertext"
}
```

### Dialogs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/dialogs/:addressHash` | Yes | Get all dialogs for an address hash |
| GET | `/history/:address` | Full | Get message history (full auth required) |

### Online Status

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/online/:addressHash` | Yes | Get online/lastSeen status for a user |

### Link Preview

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/link-preview?url=` | Yes | Fetch OG metadata for a URL (rate limited: 30/min) |

### IPFS

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/ipfs/pin` | Yes | Pin a CID to Pinata |
| POST | `/ipfs/upload` | Yes | Upload file to IPFS via Pinata (multipart, max 10MB) |
| GET | `/ipfs/pins/:address` | Yes | List pinned files for an address |
| GET | `/ipfs/verify/:cid` | Yes | Verify a CID exists on IPFS |

### Preferences

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/preferences/:address` | Yes | Get user preferences |
| POST | `/preferences/:address` | Yes | Update user preferences |
| GET | `/blocked-by/:address` | Yes | Get list of users who blocked this address |

**POST /preferences/:address body:**
```json
{
  "pinned_chats": ["aleo1..."],
  "muted_chats": [],
  "blocked_users": [],
  "saved_contacts": [{ "address": "aleo1...", "name": "Bob" }],
  "disappear_timers": { "aleo1...": "5m" },
  "settings": { "readReceipts": true, "typingIndicators": true }
}
```

### Reactions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/reactions/:messageId` | Yes | Get reactions for a message |
| POST | `/reactions/batch` | Yes | Get reactions for multiple messages |
| POST | `/reactions` | Yes | Add a reaction (rate limited) |
| DELETE | `/reactions` | Yes | Remove a reaction |

**POST /reactions body:**
```json
{ "messageId": "uuid", "emoji": "thumbsup" }
```

### Rooms (Group Chat)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/rooms` | Yes | List rooms for authenticated user |
| GET | `/rooms/:id` | Yes | Get room details |
| POST | `/rooms` | Full | Create a new room |
| PATCH | `/rooms/:id` | Full | Update room (name, description) |
| DELETE | `/rooms/:id` | Full | Delete room (creator only) |
| DELETE | `/rooms/dm-clear` | Full | Clear DM history |
| POST | `/rooms/:id/join` | Full | Join a room |
| POST | `/rooms/:id/leave` | Full | Leave a room |
| GET | `/rooms/:id/messages` | Yes | Get room messages (query: `limit`, `before`) |
| DELETE | `/rooms/:roomId/messages/:msgId` | Full | Delete a room message |
| POST | `/rooms/:roomId/messages/:msgId/edit` | Full | Edit a room message |
| GET | `/rooms/:id/keys` | Full | Get encrypted room keys |
| POST | `/rooms/:id/keys` | Full | Upload encrypted room key for a member |
| GET | `/rooms/:id/members` | Full | Get room members |

### Pinned Messages

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/pins/:contextId` | Yes | Get pinned messages for a dialog/room |
| POST | `/pins` | Yes | Pin a message |
| DELETE | `/pins` | Yes | Unpin a message |

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/logout` | Yes | Logout (clear session) |

---

## WebSocket Events

Connect via Socket.IO to the same host. Authentication is required before most events.

### Client -> Server

| Event | Payload | Description |
|-------|---------|-------------|
| `AUTH` | `{ address }` | Initiate auth (server responds with challenge) |
| `AUTH_RESPONSE` | `{ address, signature }` | Complete auth with signed challenge |
| `SUBSCRIBE` | `{ addressHash }` | Subscribe to DM updates for an address hash |
| `SUBSCRIBE_ROOM` | `{ roomId }` | Join a room's real-time channel |
| `UNSUBSCRIBE_ROOM` | `{ roomId }` | Leave a room's real-time channel |
| `DM_MESSAGE` | `{ sender, recipient, senderHash, recipientHash, encrypted_payload, encrypted_payload_self, timestamp, ... }` | Send an encrypted DM |
| `ROOM_MESSAGE` | `{ roomId, encrypted_content, sender, timestamp }` | Send an encrypted room message |
| `TYPING` | `{ dialogHash }` | Notify typing in DM |
| `ROOM_TYPING` | `{ roomId }` | Notify typing in room |
| `READ_RECEIPT` | `{ dialogHash, messageIds }` | Mark messages as read |
| `HEARTBEAT` | (none) | Keep connection alive |

### Server -> Client

| Event | Payload | Description |
|-------|---------|-------------|
| `AUTH_CHALLENGE` | `{ challenge }` | Server sends random challenge for signing |
| `AUTH_SUCCESS` | `{ address }` | Authentication succeeded |
| `AUTH_FAILED` | `{ error }` | Authentication failed |
| `NEW_DM` | `{ id, sender, recipient, encrypted_payload, timestamp, ... }` | New DM received |
| `NEW_ROOM_MESSAGE` | `{ id, roomId, sender, encrypted_content, timestamp }` | New room message |
| `MESSAGE_DELETED` | `{ messageId }` | A message was deleted |
| `MESSAGE_UPDATED` | `{ messageId, encrypted_payload, editedAt, editCount }` | A message was edited |
| `TYPING` | `{ dialogHash, sender }` | Someone is typing in DM |
| `ROOM_TYPING` | `{ roomId, sender }` | Someone is typing in room |
| `READ_RECEIPT` | `{ dialogHash, messageIds, readAt }` | Messages were read |
| `ONLINE_STATUS` | `{ addressHash, online, lastSeen }` | User online status change |
| `error` | `string` | Error message |

---

## Rate Limits

| Endpoint / Event | Limit |
|------------------|-------|
| General API | 100 req / 15 min per IP |
| Profile writes | 10 req / 15 min |
| Link preview | 30 req / 1 min |
| Online status | 60 req / 1 min |
| File upload | 5 req / 15 min |
| Reactions | 30 req / 1 min |
| Profile search | 20 req / 1 min |
| Preferences | 30 req / 1 min |
| WebSocket messages | 30 msg / 10 sec per socket |
| WebSocket connections | 10 per IP |

---

## Encryption

All message content is end-to-end encrypted using NaCl (Curve25519 + XSalsa20-Poly1305).

- **DM messages**: `encrypted_payload` = `nonce.ciphertext` (NaCl box)
- **Room messages**: `encrypted_content` = `nonce.ciphertext` (NaCl secretbox with shared room key)
- **Room keys**: Distributed per-member via NaCl box encryption

The server never sees plaintext message content.
