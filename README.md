# Ghost Messenger — Private Messaging on Aleo

Decentralized end-to-end encrypted messenger built on the **Aleo blockchain** with hybrid on-chain/off-chain architecture.

**Live:** [ghost-aleo.netlify.app](https://ghost-aleo.netlify.app)
**Backend:** [Render](https://ghost-backend-d3gg.onrender.com)
**Contract:** `ghost_msg_018.aleo` ([View on Explorer](https://testnetbeta.aleoscan.io/program?id=ghost_msg_018.aleo))

---

## Quick Start (Local Development)

### Prerequisites
- Node.js 20+
- npm (with `--legacy-peer-deps` flag)
- [Shield Wallet](https://shieldwallet.app) browser extension

### Run Locally

```bash
# 1. Backend (Terminal 1)
cd backend
npm install
npm run dev
# → Running on http://localhost:3002

# 2. Frontend (Terminal 2)
cd frontend
npm install --legacy-peer-deps
npm run dev
# → Open http://localhost:3000
```

**Connect Shield Wallet** → Approve connection → Profile auto-registers → Start messaging!

---

## Deployment (Production)

### Backend — Render
- Web Service with Node runtime
- PostgreSQL database (free tier)
- Environment variables: `DATABASE_URL`, `NODE_ENV`, `CORS_ORIGINS`, `PINATA_JWT`

### Frontend — Netlify
- Auto-deploys from GitHub `main` branch
- Build: `cd frontend && npm install --legacy-peer-deps && npm run build`
- Environment configured in `netlify.toml`

### Smart Contract — Aleo Testnet
- Deployed: `ghost_msg_018.aleo`
- Immutable (`@noupgrade` constructor)

---

## Architecture

### Hybrid Messaging Model

| Layer | Purpose | Speed | Cost |
|-------|---------|-------|------|
| **Off-chain** (WebSocket + Socket.io) | Instant message delivery & sync | < 100ms | Free |
| **On-chain** (Aleo) | Blockchain proof of operations | ~10-30s | ~0.05 ALEO |

Messages are delivered instantly via WebSocket. Blockchain proof is optional (configurable per user in Settings > Privacy). When enabled, Shield Wallet signs and submits transactions with delegated proving (~14s).

### Tech Stack

**Frontend:**
- React 18.3 + TypeScript
- Vite 6.4
- Tailwind CSS
- Shield Wallet via `@provablehq/aleo-wallet-adaptor-*`
- NaCl (tweetnacl-js) for E2E encryption

**Backend:**
- Express + Socket.io
- Sequelize + PostgreSQL (production) / SQLite (dev)
- Aleo SDK for blockchain indexing

**Smart Contract:**
- Leo 3.4.0
- Deployed on Aleo Testnet Beta

---

## Security & Privacy

- **End-to-End Encryption** — Curve25519 key exchange + Salsa20/Poly1305
- **Zero Server Knowledge** — Server cannot decrypt messages
- **Address Hashing** — BHP256 for on-chain privacy
- **Deterministic Key Derivation** — Keys derived from wallet address, never leave device
- **Delegated Proving** — Shield Wallet proves transactions server-side (~14s vs 30s+ local)

---

## Smart Contract

**Program ID:** `ghost_msg_018.aleo`

### Transitions

| Transition | Description |
|------------|-------------|
| `register_profile` | Register encryption public key on-chain |
| `update_profile` | Update encryption key |
| `send_message` | Create message records for sender + recipient |
| `update_message` | Edit message content |
| `delete_message` | Consume message record |
| `clear_history` | Clear chat history proof |
| `delete_chat` | Delete chat proof |
| `add_contact` | Add contact proof |
| `update_contact` | Update contact proof |
| `delete_contact` | Remove contact proof |
| `create_channel` | Register channel on-chain |
| `create_group` | Register group on-chain |
| `delete_channel` | Remove channel |
| `delete_group` | Remove group |

### Build & Deploy

```bash
# Build
leo build

# Deploy to testnet
leo deploy --yes --broadcast \
  --network testnet \
  --private-key <YOUR_KEY> \
  --endpoint https://api.explorer.provable.com/v1
```

---

## Wallet Integration (Shield Wallet)

Ghost Messenger uses [Shield Wallet](https://shieldwallet.app) via the `@provablehq/aleo-wallet-adaptor-*` packages.

### Key Features
- **Delegated Proving** — Transactions proved server-side (~14s)
- **Transaction Status Polling** — Real-time TX confirmation tracking
- **Auto-Connect** — Reconnects wallet on page reload
- **Decrypt Permission** — `DECRYPT_UPON_REQUEST` for record access

### Packages
```json
"@provablehq/aleo-types": "^0.3.0-alpha.3",
"@provablehq/aleo-wallet-adaptor-core": "^0.3.0-alpha.3",
"@provablehq/aleo-wallet-adaptor-react": "^0.3.0-alpha.3",
"@provablehq/aleo-wallet-adaptor-react-ui": "^0.3.0-alpha.3",
"@provablehq/aleo-wallet-adaptor-shield": "^0.3.0-alpha.3",
"@provablehq/aleo-wallet-standard": "^0.3.0-alpha.3"
```

### Usage
```tsx
import { AleoWalletProvider, useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { ShieldWalletAdapter } from "@provablehq/aleo-wallet-adaptor-shield";
import { DecryptPermission } from "@provablehq/aleo-wallet-adaptor-core";
import { Network } from "@provablehq/aleo-types";

// Provider
<AleoWalletProvider
  wallets={[new ShieldWalletAdapter({ appName: "Ghost Messenger" })]}
  decryptPermission={DecryptPermission.UponRequest}
  network={Network.TESTNET}
  programs={[PROGRAM_ID, 'credits.aleo']}
  autoConnect={true}
>
  <App />
</AleoWalletProvider>

// Hook
const { address, connected, executeTransaction, disconnect } = useWallet();
```

---

## Development

### Project Structure

```
ghost/
├── src/main.leo           # Smart contract source
├── build/main.aleo        # Compiled Aleo instructions
├── backend/               # Express + Socket.io server
│   ├── src/server.ts      # Main server
│   └── src/database.ts    # Sequelize models
├── frontend/              # React app
│   ├── src/
│   │   ├── App.tsx        # Main component
│   │   ├── hooks/         # useContract, useSync, useTransaction
│   │   └── components/    # UI components
│   └── vite.config.ts
├── render.yaml            # Render deployment config
└── netlify.toml           # Netlify deployment config
```

### Environment Variables

**Backend** (Render):
```env
NODE_ENV=production
DATABASE_URL=postgres://...
CORS_ORIGINS=https://ghost-aleo.netlify.app
PINATA_JWT=your_jwt_token
```

**Frontend** (Netlify — set in `netlify.toml`):
```env
VITE_BACKEND_URL=https://ghost-backend-d3gg.onrender.com
VITE_WS_URL=wss://ghost-backend-d3gg.onrender.com
VITE_ALEO_EXPLORER_API_BASE=https://api.explorer.provable.com/v1
```

---

## Features

- **Instant Messaging** — Socket.io real-time delivery
- **E2E Encryption** — NaCl cryptography (Curve25519 + Salsa20/Poly1305)
- **Blockchain Proof** — Optional Aleo on-chain transaction records
- **Shield Wallet** — Delegated proving for fast transactions
- **Profiles & Contacts** — On-chain profile registration
- **Message Editing & Deletion** — With on-chain proof
- **File Attachments** — IPFS via Pinata
- **Voice Messages** — Record and send audio
- **Offline Queue** — Messages queued when disconnected
- **Read Receipts** — Real-time delivery/read status

---

## Links

- [Aleo Developer Docs](https://developer.aleo.org)
- [Leo Language](https://docs.leo-lang.org)
- [Shield Wallet](https://shieldwallet.app)
- [Provable API](https://docs.explorer.provable.com)
- [Provable Wallet Adapter](https://github.com/provablehq/aleo-wallet-adaptor)

---

## License

MIT License — Copyright 2026
