# Ghost Messenger

Private encrypted messenger with Aleo blockchain integration.

## Architecture

```
ghost/
├── server/          ← Node.js + Express + WebSocket + SQLite
│   └── src/
│       ├── index.ts          # Entry point
│       ├── database.ts       # Sequelize + SQLite models
│       ├── websocket.ts      # WS handler (rooms, DMs, secrets, typing)
│       ├── routes.ts         # REST API
│       ├── secret-store.ts   # In-memory one-time secret storage
│       ├── aleo.ts           # Aleo blockchain integration
│       └── types.ts          # Shared TypeScript types
├── client/          ← Vite + vanilla TypeScript + TweetNaCl
│   ├── index.html
│   └── src/
│       ├── main.ts           # Entry: UI + state + events
│       ├── crypto.ts         # E2E encryption (NaCl box/secretbox)
│       ├── ws-client.ts      # WebSocket client with reconnect
│       ├── secret.ts         # One-time secret message logic
│       ├── api.ts            # REST API client
│       └── style.css         # Dark theme UI
├── aleo-program/    ← Leo smart contract
│   ├── program.json
│   └── src/
│       └── main.leo          # register_secret, register_profile, record_message
└── .env.example
```

## Quick Start

### 1. Install dependencies

```bash
# Server
cd server
npm install

# Client
cd ../client
npm install
```

### 2. Configure

```bash
cp .env.example server/.env
# Edit server/.env if needed (defaults work for local dev)
```

### 3. Run

```bash
# Terminal 1 — Server
cd server
npm run dev

# Terminal 2 — Client
cd client
npm run dev
```

Open http://localhost:3000 — connect with a username.

## Features

### E2E Encryption
- **DMs**: NaCl box (Curve25519 + XSalsa20-Poly1305)
- **Rooms**: NaCl secretbox with passphrase-derived key
- Server stores only encrypted payloads — **never sees plaintext**

### Rooms
- Create rooms with a passphrase (used for encryption)
- Members need the passphrase to join and decrypt
- Real-time messaging via WebSocket

### Private DMs
- Point-to-point encryption with NaCl box
- Typing indicators
- Message history stored encrypted in SQLite

### Super-Secret Messages (One-Time Read)
1. Sender generates a **one-time ephemeral key pair**
2. Message encrypted with NaCl box (ephemeral secret + recipient public)
3. Hash of plaintext registered on **Aleo blockchain**
4. Server stores in **memory only** (not on disk)
5. Recipient reads → message **auto-deleted** from server
6. Recipient can verify hash on Aleo

### Aleo Integration
- **Program**: `ghost_secret_v1.aleo`
- **Transitions**: `register_secret`, `register_profile`, `record_message`
- **Verification**: Query mappings via Aleo REST API
- **Server endpoint**: `GET /api/aleo/verify/:hash`

## Aleo Program Deploy

### Prerequisites
```bash
# Install Leo
curl -sSf https://install.leo-lang.org | sh

# Or install snarkos
cargo install snarkos
```

### Build
```bash
cd aleo-program
leo build
```

### Deploy to Testnet
```bash
snarkos developer deploy ghost_secret_v1.aleo \
  --private-key YOUR_PRIVATE_KEY \
  --query https://api.explorer.aleo.org/v1 \
  --broadcast https://api.explorer.aleo.org/v1/testnet/transaction/broadcast \
  --fee 5000000 \
  --record "RECORD_STRING" \
  --path ./build/
```

### Execute from CLI
```bash
# Register a secret hash
leo run register_secret 12345field 67890field

# Register a profile
leo run register_profile 11111field 22222field
```

### Execute from Node.js
```typescript
import { Account, ProgramManager } from '@provablehq/sdk';

const account = new Account({ privateKey: 'APrivateKey1...' });
const pm = new ProgramManager('https://api.explorer.aleo.org/v1');

const txId = await pm.execute(
  'ghost_secret_v1.aleo',
  'register_secret',
  0.5,     // fee
  false,   // feePrivate
  ['12345field', '67890field'],
  undefined, undefined, undefined, undefined,
  account
);
```

### Verify a hash (REST API)
```bash
# Via Ghost server
curl http://localhost:3001/api/aleo/verify/12345field

# Direct Aleo API
curl https://api.explorer.aleo.org/v1/testnet/program/ghost_secret_v1.aleo/mapping/secret_hashes/12345field
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List online users |
| GET | `/api/rooms` | List public rooms |
| GET | `/api/rooms/:id` | Room details + members |
| GET | `/api/messages/room/:id` | Room message history |
| GET | `/api/messages/dm/:id1/:id2` | DM history |
| GET | `/api/aleo/verify/:hash` | Verify Aleo hash |
| GET | `/health` | Server health check |

## WebSocket Protocol

| Client → Server | Description |
|-----------------|-------------|
| `auth` | Authenticate with username + public key |
| `create_room` | Create a new room |
| `join_room` | Join a room |
| `message` | Send encrypted message (room or DM) |
| `secret` | Send one-time secret message |
| `read_secret` | Read and destroy a secret |
| `typing` | Typing indicator |

| Server → Client | Description |
|-----------------|-------------|
| `auth_ok` | Auth successful + online users |
| `message` | New encrypted message |
| `secret_available` | Secret message waiting |
| `secret_data` | Secret payload (one-time) |
| `secret_read` | Sender notification: secret was read |
| `typing` | Someone is typing |
| `user_joined/left` | Online status changes |

## Security

- **E2E**: TweetNaCl (NaCl box / secretbox)
- **Transport**: WebSocket (use WSS in production)
- **Server**: Helmet + CORS whitelist + rate limiting
- **Secrets**: In-memory only, 24h TTL, one-time read
- **Aleo**: On-chain proof of secret existence
- **Keys**: Generated client-side, stored in localStorage
