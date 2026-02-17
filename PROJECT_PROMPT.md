# Ghost Messenger — Full Project Specification & Prompt

> Use this document as a system prompt / context when working with AI assistants, onboarding developers, or debugging issues.

---

## 1. PROJECT OVERVIEW

**Ghost** is an encrypted messenger built on the **Aleo blockchain**. It combines instant off-chain messaging (WebSocket) with optional on-chain proofs (Aleo transactions) for verifiable privacy.

**Live URLs:**
- Frontend: Netlify (SPA)
- Backend: Railway (`ghost-production-839c.up.railway.app`)
- Blockchain: Aleo Testnet (`ghost_msg_018.aleo`)

**Core Principles:**
- End-to-end encryption (NaCl Curve25519 + Salsa20/Poly1305)
- Messages stored encrypted — server never sees plaintext
- Optional blockchain proof per message (toggle in Settings > Privacy)
- No phone number / email required — wallet address is your identity

---

## 2. TECH STACK

| Layer | Technology | Details |
|-------|-----------|---------|
| **Frontend** | React 18 + TypeScript + Vite | SPA with Tailwind CSS |
| **UI** | Lucide icons, Framer Motion, react-hot-toast | Animations + notifications |
| **Wallet** | Leo Wallet Adapter (@demox-labs) | Aleo wallet integration |
| **Encryption** | tweetnacl (NaCl) | Curve25519 key exchange, Salsa20/Poly1305 |
| **Backend** | Express 5 + WebSocket (ws) | REST API + real-time messaging |
| **Database** | PostgreSQL (prod) / SQLite (dev) | Via Sequelize ORM |
| **Blockchain** | Leo 3.4 on Aleo Testnet | Smart contract for on-chain proofs |
| **Hosting** | Netlify (frontend) + Railway (backend) | Auto-deploy from GitHub |

---

## 3. ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────┐
│                         FRONTEND                             │
│  React + TypeScript + Vite + Tailwind                        │
│                                                              │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐  ┌────────────┐ │
│  │ ChatArea │  │ Sidebar  │  │ ContactsView│  │ SettingsView│ │
│  └────┬────┘  └────┬─────┘  └─────┬──────┘  └────────────┘ │
│       │             │              │                          │
│  ┌────▼─────────────▼──────────────▼───────┐                 │
│  │              App.tsx (state hub)          │                 │
│  └──────┬──────────┬───────────┬───────────┘                 │
│         │          │           │                              │
│  ┌──────▼──┐ ┌─────▼────┐ ┌───▼──────────┐                  │
│  │useSync  │ │useContract│ │usePreferences│                  │
│  │(WS+REST)│ │(Aleo TXs) │ │(backend pref)│                  │
│  └────┬────┘ └─────┬─────┘ └──────┬───────┘                  │
└───────┼────────────┼──────────────┼──────────────────────────┘
        │            │              │
   WebSocket      Aleo RPC      REST API
        │            │              │
┌───────▼────────────┼──────────────▼──────────────────────────┐
│                    BACKEND (Express + WS)                      │
│                                                                │
│  ┌───────────────────────────────────────────────────────┐    │
│  │                   server.ts                            │    │
│  │  • WebSocket auth (NaCl challenge-response)            │    │
│  │  • REST endpoints (messages, profiles, rooms, pins)    │    │
│  │  • Rate limiting, CORS, Helmet security                │    │
│  │  • Session management (JWT-like tokens, 24h TTL)       │    │
│  └──────────────────────┬────────────────────────────────┘    │
│                         │                                      │
│  ┌──────────────────────▼────────────────────────────────┐    │
│  │              database.ts (Sequelize)                    │    │
│  │  PostgreSQL (prod) ←→ SQLite (dev)                      │    │
│  │  Models: Message, Profile, Room, RoomMember,            │    │
│  │          Reaction, PinnedMessage, UserPreferences, etc. │    │
│  └────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────┘
        │
   Aleo Testnet
        │
┌───────▼────────────────────────────────────────────────────────┐
│                  SMART CONTRACT (Leo 3.4)                        │
│  Program: ghost_msg_018.aleo                                     │
│                                                                  │
│  Mappings: secret_hashes, secret_senders, profiles,              │
│            channels, groups                                       │
│                                                                  │
│  Transitions: register_secret, register_profile,                  │
│               record_message, create_channel, create_group,       │
│               delete_channel, delete_group                        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. MESSAGE FLOW (Critical Path)

### Sending a DM

```
1. User types message + clicks Send
2. Frontend encrypts with recipient's NaCl public key (box)
3. Also encrypts self-copy with own key (for sent messages display)
4. Sends via WebSocket: DM_MESSAGE { encrypted_payload, encrypted_payload_self, ... }
5. Backend saves to PostgreSQL (Message table)
6. Backend broadcasts "message_detected" to recipient's WS subscription
7. Recipient decrypts with own NaCl secret key
8. (Optional) If "Blockchain Proof" enabled: also submit Aleo transaction
```

### Receiving a DM

```
1. WebSocket receives "message_detected" event
2. Check if message is for me (recipient matches my address)
3. Decrypt encrypted_payload with my NaCl secret key
4. If I'm the sender: decrypt encrypted_payload_self instead
5. Add to histories[contactId] state
6. Save to IndexedDB cache (survives page reload)
7. Show notification if not active chat
```

### Authentication Flow

```
1. User connects Leo Wallet → gets publicKey (aleo1...)
2. Frontend derives NaCl encryption keys from wallet signMessage()
3. WebSocket sends AUTH { address: "aleo1...", encryptionPublicKey: "base64..." }
4. Backend generates random 32-byte challenge, encrypts with user's NaCl pubkey
5. Sends AUTH_CHALLENGE { encrypted challenge }
6. Frontend decrypts challenge with NaCl secret key → sends AUTH_RESPONSE
7. Backend verifies → creates session token → AUTH_SUCCESS { token }
8. All subsequent REST calls include: Authorization: Bearer <token>
```

---

## 5. KEY FILE PATHS

### Frontend (`frontend/src/`)

| File | Purpose | Size |
|------|---------|------|
| `App.tsx` | **Main hub** — all state, handlers, routing | ~1800 lines |
| `components/ChatArea.tsx` | Chat messages, input, reactions, formatting | ~1230 lines |
| `components/Sidebar.tsx` | Chat list, room list, navigation | ~600 lines |
| `components/ContactsView.tsx` | Contact management, search | ~400 lines |
| `components/SettingsView.tsx` | Settings, privacy, key backup | ~500 lines |
| `hooks/useSync.ts` | WebSocket connection, message sync, offline queue | ~900 lines |
| `hooks/useContract.ts` | Aleo blockchain transactions | ~400 lines |
| `hooks/usePreferences.ts` | User preferences (pinned, muted, settings) | ~200 lines |
| `utils/crypto.ts` | NaCl encrypt/decrypt, key generation | ~150 lines |
| `utils/key-derivation.ts` | Derive keys from wallet, cache management | ~250 lines |
| `utils/api-client.ts` | REST API wrapper with auth, retry, timeout | ~110 lines |
| `utils/message-cache.ts` | IndexedDB message persistence | ~140 lines |
| `utils/formatText.tsx` | Text formatting (*bold*, _italic_, ~strike~) | ~50 lines |
| `types.ts` | All TypeScript interfaces | ~100 lines |
| `constants.ts` | All constants (fees, limits, URLs) | ~80 lines |
| `config.ts` | API URLs configuration | ~15 lines |
| `deployed_program.ts` | Current contract program ID | ~3 lines |

### Backend (`backend/src/`)

| File | Purpose | Size |
|------|---------|------|
| `server.ts` | **Everything** — REST + WS + auth + rate limits | ~1824 lines |
| `database.ts` | Sequelize models, PostgreSQL/SQLite config | ~426 lines |
| `services/indexer.ts` | Blockchain indexer (optional) | ~200 lines |

### Smart Contract

| File | Purpose |
|------|---------|
| `aleo-program/src/main.leo` | Leo program source |
| `program.json` | Program metadata |

---

## 6. DATABASE SCHEMA

### PostgreSQL (Production) / SQLite (Development)

```sql
-- Messages (E2E encrypted, server never sees plaintext)
Message {
  id              STRING PRIMARY KEY    -- UUID or tx_id
  sender          STRING NOT NULL       -- aleo1... address
  recipient       STRING NOT NULL       -- aleo1... address
  encrypted_payload      TEXT NOT NULL  -- NaCl box (for recipient)
  encrypted_payload_self TEXT          -- NaCl box (for sender, self-readable)
  nonce           STRING               -- NaCl nonce
  timestamp       BIGINT NOT NULL      -- Unix ms
  status          STRING DEFAULT 'pending'  -- pending|confirmed|read
  sender_hash     STRING               -- BHP256(sender) for privacy
  recipient_hash  STRING               -- BHP256(recipient)
  dialog_hash     STRING               -- sender_hash_recipient_hash (sorted)
  reply_to_id     STRING               -- Referenced message ID
  reply_to_text   TEXT                 -- Quoted text (encrypted then stored)
  reply_to_sender STRING               -- Original sender address
  attachment_part1 STRING              -- IPFS CID part 1
  attachment_part2 STRING              -- IPFS CID part 2
  INDEX(dialog_hash), INDEX(sender_hash), INDEX(recipient_hash)
  UNIQUE(sender_hash, recipient_hash, timestamp)  -- dedup
}

-- User Profiles
Profile {
  address              STRING PRIMARY KEY  -- aleo1...
  username             STRING
  bio                  STRING
  encryption_public_key STRING             -- NaCl public key (base64)
  address_hash         STRING UNIQUE       -- BHP256(address)
  show_last_seen       BOOLEAN DEFAULT true
  show_avatar          BOOLEAN DEFAULT true
  tx_id                STRING              -- Registration transaction
}

-- Rooms (Channels & Groups)
Room {
  id         STRING PRIMARY KEY   -- UUID
  name       STRING NOT NULL
  created_by STRING NOT NULL      -- Creator's aleo1... address
  is_private BOOLEAN DEFAULT false
  type       STRING DEFAULT 'channel'  -- channel|group
}

RoomMember {
  id      INTEGER PRIMARY KEY AUTOINCREMENT
  room_id STRING NOT NULL
  user_id STRING NOT NULL          -- aleo1... address
  UNIQUE(room_id, user_id)
}

RoomMessage {
  id          STRING PRIMARY KEY
  room_id     STRING NOT NULL
  sender      STRING NOT NULL
  sender_name STRING
  text        TEXT NOT NULL         -- Encrypted for rooms with keys
  timestamp   BIGINT NOT NULL
}

-- Reactions (emoji per message)
Reaction {
  id           INTEGER PRIMARY KEY AUTOINCREMENT
  message_id   STRING NOT NULL
  user_address STRING NOT NULL
  emoji        STRING(8) NOT NULL
  UNIQUE(message_id, user_address, emoji)
}

-- Pinned Messages
PinnedMessage {
  id           INTEGER PRIMARY KEY AUTOINCREMENT
  context_id   STRING NOT NULL      -- dialogHash or roomId
  message_id   STRING NOT NULL
  pinned_by    STRING NOT NULL
  message_text TEXT
  UNIQUE(context_id, message_id)
}

-- User Preferences (all JSON columns)
UserPreferences {
  address          STRING PRIMARY KEY
  pinned_chats     TEXT DEFAULT '[]'
  muted_chats      TEXT DEFAULT '[]'
  deleted_chats    TEXT DEFAULT '[]'
  saved_contacts   TEXT DEFAULT '[]'     -- [{address, name}, ...]
  disappear_timers TEXT DEFAULT '{}'     -- {chatId: "30s"|"5m"|"1h"|"24h"}
  encrypted_keys   TEXT                  -- Passphrase-encrypted NaCl keys backup
  key_nonce        STRING
  settings         TEXT DEFAULT '{}'     -- {readReceipts, blockchainProof, ...}
  migrated         BOOLEAN DEFAULT false
}

-- Room Encryption Keys
RoomKey {
  id                  INTEGER PRIMARY KEY AUTOINCREMENT
  room_id             STRING NOT NULL
  user_address        STRING NOT NULL
  encrypted_room_key  TEXT NOT NULL       -- Symmetric key, NaCl-boxed per user
  nonce               STRING NOT NULL
  sender_public_key   STRING NOT NULL
  UNIQUE(room_id, user_address)
}
```

---

## 7. REST API REFERENCE

### Authentication
All `(auth)` endpoints require: `Authorization: Bearer <session_token>`
All `(full auth)` endpoints also require non-limited session.

### Messages
```
GET    /messages/:dialogHash?limit=100&offset=0    # Fetch encrypted messages
DELETE /messages/:id                                  (auth) Delete message
POST   /messages/:id/edit  { text }                   (auth) Edit message text
```

### Profiles
```
GET    /profiles/:address                            # Get profile
GET    /profiles/hash/:hash                          # Get by address hash
GET    /profiles/search?q=query                      # Search (rate limited: 15/min)
POST   /profiles  { address, username, bio, ... }     (auth) Register/update
```

### Dialogs
```
GET    /dialogs/:addressHash?limit=100              # List conversations (last msg each)
```

### Rooms
```
GET    /rooms?type=channel|group                     # List rooms
POST   /rooms  { name, type, isPrivate }              (full auth) Create
PATCH  /rooms/:id  { name }                           (full auth) Rename
DELETE /rooms/:id                                      (full auth) Delete
POST   /rooms/:id/join                                 (full auth) Join
POST   /rooms/:id/leave                                (full auth) Leave
GET    /rooms/:id/members                              (full auth) List members
GET    /rooms/:id/messages?limit=100&offset=0        # Room messages
POST   /rooms/:roomId/messages/:msgId/edit { text }    (full auth) Edit
DELETE /rooms/:roomId/messages/:msgId                  (full auth) Delete
DELETE /rooms/dm-clear  { dialogHash }                 (full auth) Clear DM history
GET    /rooms/:id/keys                                 (full auth) Get room key
POST   /rooms/:id/keys  { keys: [...] }               (full auth) Distribute keys
```

### Reactions
```
GET    /reactions/:messageId                         # Get reactions
POST   /reactions  { messageId, emoji }                (auth) Add
DELETE /reactions?messageId=...&emoji=...               (auth) Remove
POST   /reactions/batch  { messageIds: [...] }        # Batch fetch
```

### Pins
```
GET    /pins/:contextId                              # List pinned
POST   /pins  { contextId, messageId, messageText }    (auth) Pin
DELETE /pins  { contextId, messageId }                  (auth) Unpin
```

### Preferences
```
GET    /preferences/:address                           (auth) Get all prefs
POST   /preferences/:address  { key, value }           (auth) Update
```

### Other
```
GET    /online/:addressHash                          # Online status
GET    /link-preview?url=...                          # OG metadata (rate limited)
GET    /health                                        # Health check
```

---

## 8. WEBSOCKET EVENTS

### Client → Server
```
AUTH                 { address, encryptionPublicKey }
AUTH_RESPONSE        { response: decryptedChallenge }
AUTH_KEY_MISMATCH    { address }
SUBSCRIBE            { addressHash }
SUBSCRIBE_ROOM       { roomId }
UNSUBSCRIBE_ROOM     { roomId }
DM_MESSAGE           { tempId, recipientAddress, recipientHash, senderHash,
                       dialogHash, encryptedPayload, encryptedPayloadSelf,
                       nonce, timestamp, replyToId?, replyToText?, replyToSender? }
ROOM_MESSAGE         { roomId, text, senderName }
TYPING               { dialogHash }
ROOM_TYPING          { roomId, senderName }
READ_RECEIPT         { dialogHash, messageIds: [...] }
HEARTBEAT            {}
```

### Server → Client
```
AUTH_CHALLENGE       { encrypted }
AUTH_SUCCESS         { token, limited }
AUTH_FAILED          { error }
message_detected     { id, sender, recipient, encrypted_payload, timestamp, ... }
dm_sent              { tempId, realId, timestamp }
room_message         { id, roomId, sender, senderName, text, timestamp }
typing               { dialogHash, sender }
room_typing          { roomId, senderName }
read_receipt         { dialogHash, messageIds }
pin_update           { contextId, pins: [...] }
room_renamed         { roomId, name }
room_deleted         { roomId }
room_member_joined   { roomId, userId }
room_member_left     { roomId, userId }
room_message_deleted { roomId, messageId }
room_message_edited  { roomId, messageId, text }
```

---

## 9. ENCRYPTION SYSTEM

### Key Derivation
```
1. User connects wallet → publicKey (aleo1...)
2. Call wallet.signMessage("Ghost Messenger - Derive encryption keys for aleo1...")
3. SHA-256(signature + publicKey) → 32-byte seed
4. nacl.box.keyPair.fromSecretKey(seed) → {publicKey, secretKey}
5. Cache in memory (4h TTL) + sessionStorage (survives reload)
```

### Message Encryption
```
Sending to recipient:
  1. nacl.box(plaintext, nonce, recipientPublicKey, mySecretKey) → encrypted_payload
  2. nacl.box(plaintext, nonce2, myPublicKey, mySecretKey) → encrypted_payload_self
  3. Send both + nonce to backend

Receiving:
  1. nacl.box.open(encrypted_payload, nonce, senderPublicKey, mySecretKey) → plaintext
```

### Room Encryption
```
1. Room creator generates random symmetric key (nacl.secretbox)
2. Encrypts symmetric key per member with their NaCl public key
3. Stores encrypted keys via POST /rooms/:id/keys
4. Each member decrypts their copy to get the symmetric key
5. Messages encrypted/decrypted with nacl.secretbox(text, nonce, symmetricKey)
```

---

## 10. SMART CONTRACT (Leo 3.4)

### Current Program: `ghost_msg_018.aleo`

```leo
program ghost_secret_v1.aleo {
    // On-chain storage
    mapping secret_hashes: field => bool;        // Message proof exists
    mapping secret_senders: field => field;       // Message → sender hash
    mapping profiles: field => field;             // Address hash → name hash
    mapping channels: field => field;             // Channel hash → creator hash
    mapping groups: field => field;               // Group hash → creator hash

    // Transitions
    async transition register_secret(secret_hash: field, sender_hash: field) -> Future
    async transition register_profile(address_hash: field, name_hash: field) -> Future
    async transition record_message(sender_hash: field, recipient_hash: field, payload_hash: field) -> Future
    async transition create_channel(channel_hash: field, creator_hash: field) -> Future
    async transition create_group(group_hash: field, creator_hash: field) -> Future
    async transition delete_channel(channel_hash: field, creator_hash: field) -> Future
    async transition delete_group(group_hash: field, creator_hash: field) -> Future
}
```

### Leo 3.4 Syntax Rules
- Use `async transition` + `async function` (NOT old `return then finalize`)
- Async functions cannot reassign variables from conditional scope — use ternary `?`
- All data on-chain is hashed (BHP256) for privacy — no plaintext ever stored
- Programs MUST have a constructor for fresh deployments: `@noupgrade async constructor() {}`

---

## 11. DEPLOYMENT

### Frontend (Netlify)
```
Build: cd frontend && npm install --legacy-peer-deps && npm run build
Publish: frontend/dist
Environment:
  VITE_BACKEND_URL = https://ghost-production-839c.up.railway.app
  VITE_WS_URL = wss://ghost-production-839c.up.railway.app
  VITE_ALEO_EXPLORER_API_BASE = https://api.explorer.provable.com/v1
```

### Backend (Railway)
```
Build: cd backend && npm install
Start: cd backend && npm start
Environment:
  DATABASE_URL = ${{ Postgres.DATABASE_URL }}   ← Railway PostgreSQL addon
  PORT = 3002 (auto-assigned by Railway)
  CORS_ORIGINS = https://your-frontend.netlify.app
```

### Database
- **Production:** PostgreSQL via Railway addon (persistent, survives redeploys)
- **Development:** SQLite file (`backend/database.sqlite`)
- Sequelize ORM abstracts the difference — same code works with both
- Switch is automatic: if `DATABASE_URL` env var exists → PostgreSQL, else → SQLite

---

## 12. FEATURES

### Implemented
- [x] E2E encrypted direct messages (NaCl)
- [x] Channels & Groups with per-room encryption
- [x] Text formatting: `*bold*` `_italic_` `~strikethrough~` `__underline__`
- [x] Clickable links with OG preview cards
- [x] Emoji picker (emoji-picker-react)
- [x] Message reactions (6 quick emojis + custom)
- [x] Reply to messages (quote + scroll to original)
- [x] Edit & delete messages (real-time sync)
- [x] Pinned messages per chat/room
- [x] Disappearing messages (30s / 5m / 1h / 24h)
- [x] File attachments via IPFS
- [x] Typing indicators
- [x] Read receipts (toggleable)
- [x] Online status with last seen
- [x] Contact management (add, rename, delete)
- [x] Network search by address or @username
- [x] User profiles (username, bio, avatar)
- [x] Blockchain Proof toggle (on-chain message verification)
- [x] Offline message queue (IndexedDB)
- [x] Local message cache (IndexedDB, survives page reload)
- [x] Key backup/recovery with passphrase
- [x] Session auth (NaCl challenge-response)
- [x] Dark theme (default)

### Settings (Per-user, Backend-persisted)
- Read receipts (on/off)
- Blockchain Proof (on/off, default: off)
- Show avatar (on/off)
- Show last seen (on/off)
- Notification sound (on/off)
- Disappearing message timers per chat

---

## 13. COMMON ISSUES & DEBUGGING

### "No encryption keys cached"
**Cause:** WebSocket connected before keys were derived from wallet.
**Fix:** `useSync(keysReady ? publicKey : null, ...)` — WS waits for keys.

### Messages disappear after deploy
**Cause:** Railway ephemeral filesystem wipes SQLite on every deploy.
**Fix:** Use PostgreSQL via `DATABASE_URL` env var (Railway addon).

### 403 Forbidden on API calls
**Cause:** Session token expired or wrong auth level (limited vs full).
**Check:** `requireAuth` = any session, `requireFullAuth` = non-limited session.

### Wallet NETWORK_NOT_GRANTED
**Cause:** Wallet is on wrong network (mainnet instead of testnet).
**Fix:** Switch wallet to Aleo Testnet in wallet settings.

### Reply not showing on receiver side
**Cause:** Reply metadata (replyToId, replyToText, replyToSender) not sent via WS or not saved in DB.
**Fix:** Include all reply fields in DM_MESSAGE payload AND save in Message table.

### Bio showing "Saved contact" instead of real bio
**Cause:** `contact.description` (hardcoded "Saved contact") was displayed instead of fetching real profile bio.
**Fix:** Fetch from `/profiles/:address` and use `profile.bio`.

### WS connection drops / reconnect loops
**Check:** CORS_ORIGINS in backend .env, SSL/WSS matching, Railway proxy config.

### Transaction stuck / timeout
**Cause:** Aleo testnet congestion or insufficient balance.
**Check:** Account balance > 0.05 credits, testnet status.

---

## 14. DEVELOPMENT SETUP

```bash
# Prerequisites: Node.js 20+, npm

# Clone
git clone https://github.com/kravadk/Ghost.git
cd Ghost

# Backend (terminal 1)
cd backend
npm install
# Create .env with PORT=3002, no DATABASE_URL = uses SQLite
npm run dev

# Frontend (terminal 2)
cd frontend
npm install --legacy-peer-deps
# Vite dev server auto-connects to localhost:3002
npm run dev

# Open http://localhost:5173
# Connect Leo Wallet (Aleo Testnet)
```

### Key Environment Variables
```bash
# Backend (.env)
PORT=3002
DATABASE_URL=                           # Empty = SQLite, set = PostgreSQL
CORS_ORIGINS=http://localhost:5173
DB_ENCRYPTION_KEY=                      # Optional: SQLCipher encryption

# Frontend (.env or vite.config)
VITE_BACKEND_URL=http://localhost:3002
VITE_WS_URL=ws://localhost:3002
VITE_ALEO_EXPLORER_API_BASE=https://api.explorer.provable.com/v1
```

---

## 15. DESIGN SYSTEM

### Colors
```
Primary:     #FF8C00 (Orange) — buttons, accents, active states
Background:  #0A0A0A (Near-black) — main background
Surface:     #111111, #1A1A1A — cards, input backgrounds
Border:      #2A2A2A — subtle borders
Text:        #FFFFFF (primary), #999 (secondary), #666 (muted)
Success:     #10B981 (Green)
Error:       #EF4444 (Red)
Link:        #3B82F6 (Blue)
```

### Typography
- Font: System default (sans-serif)
- Monospace: `font-mono` for addresses, codes
- Sizes: `text-xs` (10px labels), `text-sm` (14px body), `text-xl` (20px headings)

### Components Style
- Rounded corners: `rounded-xl` (12px), `rounded-2xl` (16px), `rounded-3xl` (24px)
- Shadows: `shadow-lg shadow-[#FF8C00]/20` for primary elements
- Animations: Framer Motion for modals/transitions, CSS for loading spinners
- Buttons: `btn-press` class for press effect, `btn-icon` for icon buttons
- Gradient: `gradient-border` class for orange gradient borders

### Message Bubbles
- Mine: `bg-[#0A0A0A] text-white rounded-br-sm` (right side)
- Theirs: `bg-white border border-[#E5E5E5] text-[#0A0A0A] rounded-bl-sm` (left side)

---

## 16. SECURITY MEASURES

- **E2E Encryption:** All DM content encrypted client-side with NaCl before sending
- **DOMPurify:** All rendered text sanitized (strip HTML tags, prevent XSS)
- **Session Auth:** NaCl challenge-response, 24h token TTL, limited sessions for new users
- **Rate Limiting:** Per-endpoint limits (see API section), WS rate limit (30 msg/min)
- **Input Validation:** Address format checks, emoji Unicode validation, filename sanitization
- **SSRF Protection:** Link preview validates URL scheme (http/https only), blocks internal IPs
- **Helmet:** Standard HTTP security headers
- **CORS:** Whitelist-based origin validation
- **No Plaintext Storage:** Server stores only encrypted payloads, never decrypts
- **Key Derivation:** Deterministic from wallet signMessage — same wallet = same keys

---

*Last updated: February 2026*
*Contract: ghost_msg_018.aleo | Backend: Railway PostgreSQL | Frontend: Netlify*
