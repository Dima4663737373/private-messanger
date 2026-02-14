# 👻 Ghost Messenger — Private Messaging on Aleo

Decentralized end-to-end encrypted messenger with **mandatory on-chain blockchain proof** for all message and profile operations.

**Live Demo:** [Coming soon on Netlify]
**Backend:** [Railway](https://ghost-production-839c.up.railway.app)
**Contract:** `ghost_msg_015.aleo` ([View on Explorer](https://testnetbeta.aleoscan.io/program?id=ghost_msg_015.aleo))

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js 20+
- npm (with `--legacy-peer-deps` flag)
- Aleo wallet ([Leo Wallet](https://leo.app), Puzzle, or Fox Wallet)

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
# → Open http://localhost:5173
```

**Connect your Aleo wallet** → Sign transactions → Create profile → Start messaging!

---

## 📦 Deployment (Production)

See **[NETLIFY_DEPLOY.md](NETLIFY_DEPLOY.md)** for full Railway + Netlify deployment guide.

**Quick summary:**
1. **Backend** → Railway: `https://ghost-production-839c.up.railway.app`
2. **Frontend** → Netlify (configured in `netlify.toml`)
3. **Smart Contract** → Deployed: `ghost_msg_015.aleo`

---

## 🏗️ Architecture

### On-Chain First Messaging

| Layer | Purpose | Speed | Cost |
|-------|---------|-------|------|
| **Off-chain** (WebSocket) | Instant message delivery + sync | < 100ms | Free |
| **On-chain** (Aleo) | All operations (send, edit, delete, profile) | ~10-30s | ~0.05 ALEO |

**All message and profile operations require on-chain transactions** with wallet signature approval. Off-chain WebSocket provides instant delivery and synchronization between clients.

### Tech Stack

**Frontend:**
- React 18.3 + TypeScript
- Vite 6.4
- Tailwind CSS
- Leo Wallet Adapter
- NaCl (tweetnacl-js) for E2E encryption

**Backend:**
- Express + WebSocket (ws)
- Sequelize + SQLite
- Aleo SDK for blockchain indexing

**Smart Contract:**
- Leo 3.4.0
- Deployed on Aleo Testnet Beta

---

## 🔐 Security & Privacy

✅ **End-to-End Encryption** — Curve25519 + Salsa20/Poly1305
✅ **Zero Server Knowledge** — Server cannot decrypt messages
✅ **Address Hashing** — BHP256 for on-chain privacy
✅ **Local Key Storage** — Encryption keys never leave your device

---

## 📝 Smart Contract

**Program ID:** `ghost_msg_015.aleo`
**TX ID:** `at1ls2f4zjkf2anmzy54k4p3tefw27nqldgnv6e2uly63r4snhuvs9slhhyve`

### Functions

| Transition | Description |
|------------|-------------|
| `register_profile` | Register encryption public key on-chain |
| `send_message` | Create message records for sender + recipient |
| `update_message` | Edit message content |
| `delete_message` | Consume message record |
| `create_channel` | Register channel on-chain |
| `create_group` | Register group on-chain |
| `delete_channel` | Remove channel |
| `delete_group` | Remove group |

### Build & Deploy Contract

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

## 🛠️ Development

### Project Structure

```
ghost/
├── src/main.leo           # Smart contract source
├── build/main.aleo        # Compiled Aleo instructions
├── backend/               # Express + WebSocket server
│   ├── src/server.ts      # Main server
│   └── src/database.ts    # SQLite models
├── frontend/              # React app
│   ├── src/
│   │   ├── App.tsx        # Main component
│   │   ├── hooks/         # useContract, useSync, etc.
│   │   └── components/    # UI components
│   └── vite.config.ts
└── DEPLOYMENT.md          # Production deployment guide
```

### Environment Variables

**Backend** (Railway):
```env
PORT=3002
CORS_ORIGINS=https://your-frontend.netlify.app
ALEO_ENDPOINT=https://api.explorer.provable.com/v1
```

**Frontend** (Netlify):
```env
VITE_BACKEND_URL=https://ghost-production-839c.up.railway.app
VITE_WS_URL=wss://ghost-production-839c.up.railway.app
VITE_ALEO_EXPLORER_API_BASE=https://api.explorer.provable.com/v1
```

---

## 🎯 Features

✅ **On-Chain Transactions** — All operations require wallet signature
✅ **Instant Messaging** — WebSocket real-time delivery
✅ **E2E Encryption** — NaCl cryptography (Curve25519)
✅ **Blockchain Proof** — Mandatory Aleo on-chain records
✅ **Profiles & Contacts** — On-chain profile registration
✅ **Message Editing** — Edit sent messages (on-chain)
✅ **Message Deletion** — Delete messages (on-chain)
✅ **Modern UI** — Tailwind CSS with Tipzo-inspired design

---

## 📜 License

MIT License — Copyright © 2026

---

## 🔗 Links

- [Aleo Developer Docs](https://developer.aleo.org)
- [Leo Language](https://docs.leo-lang.org)
- [Leo Wallet Adapter](https://docs.leo.app/aleo-wallet-adapter)
- [Provable API](https://docs.explorer.provable.com)

---

**Built for Aleo Hackathon 2026** 🏎️
