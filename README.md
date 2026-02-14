# 👻 Ghost Messenger — Private Messaging on Aleo

Decentralized end-to-end encrypted messenger with hybrid architecture: **instant off-chain delivery** + **optional on-chain blockchain proof**.

**Live Demo:** [Coming soon]
**Contract:** `ghost_msg_015.aleo` ([View on Explorer](https://testnetbeta.aleoscan.io/program?id=ghost_msg_015.aleo))

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js 18+
- npm or yarn
- Aleo wallet (Leo Wallet extension)

### Run Locally

```bash
# 1. Backend (Terminal 1)
cd backend
npm install
npm run dev
# → Running on http://localhost:3002

# 2. Frontend (Terminal 2)
cd frontend
npm install
npm run dev
# → Open http://localhost:3000
```

**Connect your Aleo wallet** → Create profile → Start messaging!

---

## 📦 Deployment (Production)

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for full Railway + Vercel deployment guide.

**Quick summary:**
1. **Backend** → Railway (free tier, WebSocket support)
2. **Frontend** → Vercel (free tier, auto-deploy)
3. **Smart Contract** → Already deployed: `ghost_msg_015.aleo`

---

## 🏗️ Architecture

### Hybrid Messaging Model

| Layer | Purpose | Speed | Cost |
|-------|---------|-------|------|
| **Off-chain** (WebSocket) | Instant message delivery | < 100ms | Free |
| **On-chain** (Aleo) | Blockchain proof (optional) | ~10-30s | 0.01-0.1 ALEO |

**Default:** Blockchain Proof is **OFF** → all messages are instant & free via WebSocket.
**Toggle ON** in Settings → Privacy to record messages on Aleo blockchain.

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
CORS_ORIGINS=https://your-frontend.vercel.app
ALEO_ENDPOINT=https://api.explorer.provable.com/v1
```

**Frontend** (Vercel):
```env
VITE_BACKEND_URL=https://your-backend.up.railway.app
VITE_WS_URL=wss://your-backend.up.railway.app
```

---

## 🎯 Features

✅ **Instant Messaging** — WebSocket real-time delivery
✅ **E2E Encryption** — NaCl cryptography
✅ **Blockchain Proof** — Optional Aleo on-chain records
✅ **Profiles & Contacts** — User management
✅ **Channels & Groups** — Multi-user chats (coming soon)
✅ **Message Editing** — Edit sent messages
✅ **Message Deletion** — Delete locally or on-chain
✅ **Modern UI** — Tailwind CSS, dark mode ready

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
