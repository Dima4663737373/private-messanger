# Incomplete Features & Technical Debt

**Last Updated:** 2026-02-14
**Status:** Aleo Hackathon 2026 project

---

## ✅ Completed (Recent Updates)

### On-Chain First Architecture
- **Status:** ✅ All message operations (send, edit, delete) now require on-chain transactions
- **Status:** ✅ Profile creation/update requires on-chain transactions
- **Implementation:** Removed optional "Blockchain Proof" toggle, all operations are mandatory on-chain

### Smart Contract
- **Status:** ✅ `ghost_msg_018.aleo` deployed on Testnet Beta
- **TX ID:** `at1ls2f4zjkf2anmzy54k4p3tefw27nqldgnv6e2uly63r4snhuvs9slhhyve`
- **Transitions:** register_profile, send_message, update_message, delete_message, create_channel, create_group, delete_channel, delete_group

### Backend Deployment
- **Status:** ✅ Deployed on Railway
- **URL:** `https://ghost-production-839c.up.railway.app`
- **Features:** Express + WebSocket + SQLite + Aleo indexer

---

## 🔄 In Progress

### Wallet Integration
- **Current State:** Shield Wallet integrated via `@provablehq/aleo-wallet-adaptor-shield`
- **Features:** Delegated proving (~14s), auto-connect, transaction status polling
- **Documentation:** See [WALLET_INTEGRATION.md](WALLET_INTEGRATION.md)

### Frontend Deployment
- **Target:** Netlify
- **Config:** `netlify.toml` ready
- **Status:** Awaiting final git push + deployment

---

## 🚧 Known Limitations

### 1. Decentralization — Profile Discovery

**Current State:**
- Profiles (username, bio, encryption keys) stored in centralized backend database
- Frontend relies on backend API `/profiles/:address` to discover users
- Smart contract `register_profile` stores encryption key on-chain, but username/bio are off-chain

**Missing:**
- Full on-chain profile storage (username + bio in mappings)
- Decentralized username resolution
- Direct on-chain profile queries (currently requires backend indexer)

**Workaround:** Backend acts as cache/indexer, but encryption keys ARE on-chain for trustless verification

---

### 2. Network Discovery

**Current State:**
- "Network Search" queries centralized backend database
- Can only find users who have synced with backend

**Missing:**
- On-chain iterator to find all registered profiles
- P2P discovery mechanisms
- DHT or gossip protocol for decentralized user lookup

**Workaround:** Users must know recipient address or search via backend

---

### 3. Encryption & Privacy

**Current State:**
- Uses TweetNaCl (Curve25519 + Salsa20/Poly1305) for E2E encryption
- Separate encryption keypair generated client-side, stored in localStorage
- Encryption public key registered on-chain via `register_profile`
- Private keys never leave device

**Missing:**
- Derivation of encryption keys directly from Aleo account keys (would remove need for separate keypair)
- Forward secrecy (Signal-style Ratchet) — currently uses static keys
- Metadata privacy — sender/recipient hashes visible on-chain (though addresses are hashed with BHP256)

**Limitation:** If localStorage is cleared, encryption key is lost → cannot decrypt old messages

---

### 4. Message Storage & Sync

**Current State:**
- Messages stored on-chain as **private records** (good!)
- Backend indexer syncs dialogs via WebSocket for instant delivery
- Frontend caches messages in-memory

**Missing:**
- Client-side full chain scan (slow but trustless)
- Persistent local storage (IndexedDB) for message history
- Offline mode (currently requires backend for history)

**Limitation:** If backend is down, cannot sync message history (but can still send via direct blockchain interaction)

---

### 5. Smart Contract Features

**Current State:**
- `ghost_msg_018.aleo` implements:
  - ✅ Private message records (sender + recipient copies)
  - ✅ Dialog tracking (last block mapping)
  - ✅ Profile registration (encryption keys)
  - ✅ Channel/Group creation (basic)

**Missing:**
- **Group Chats:** Records can only have single owner, group messages need broadcast logic
- **Tipping/Paid Messages:** No native payment logic in contract
- **Anti-spam:** No staking or reputation system (only gas fees prevent spam)
- **Message Reactions:** No on-chain reaction storage
- **Read Receipts:** No on-chain read status tracking

**Limitation:** Group chats are placeholder — cannot enforce access control on-chain with current Leo record model

---

### 6. UX / UI

**Current State:**
- Wallet signature required for every message → can feel slow for chat
- Toast notifications for transaction status
- Loading states during blockchain operations

**Missing:**
- **Media Support:** Images/files (IPFS attachments exist in contract but not implemented in UI)
- **Browser Notifications:** No native push notifications
- **Unencrypted Message Indicator:** No visual warning when recipient has no encryption key
- **Optimistic UI:** Messages could appear instantly with "pending" status
- **Batch Transactions:** Cannot queue multiple messages into single transaction

**Workaround:** Off-chain WebSocket provides instant delivery, on-chain confirmation comes later

---

### 7. Security & Audits

**Current State:**
- No formal security audit
- Standard Web3 security practices (no private key storage on backend, E2E encryption)

**Missing:**
- Smart contract audit
- Penetration testing
- Bug bounty program
- Rate limiting on backend (basic but not comprehensive)

---

## 📊 Comparison to Other Projects

### vs. PrivTok
- **Ghost:** Uses real on-chain Aleo records for messages ✅
- **PrivTok:** Simulates messaging with timeouts (fake blockchain) ❌
- **Ghost Advantage:** Actual blockchain proof of messages

### vs. Traditional Messengers (Signal, Telegram)
- **Ghost Advantage:** Decentralized, blockchain-verified message history
- **Traditional Advantage:** Faster UX (no wallet signatures), group chats, media support

### vs. Pure On-Chain Messaging
- **Ghost Advantage:** Hybrid model — instant delivery via WebSocket + blockchain proof
- **Pure On-Chain:** Slow (10-30s per message), expensive gas fees

---

## 🎯 Roadmap (Post-Hackathon)

### Phase 1 — Production Ready
- [ ] Add IPFS support for media attachments
- [ ] Implement IndexedDB for persistent local storage
- [ ] Add optimistic UI for instant message display
- [ ] Multi-wallet support (Puzzle, Fox, Soter)
- [ ] Security audit

### Phase 2 — Advanced Features
- [ ] Group chat implementation (off-chain coordination + on-chain proof)
- [ ] Message reactions
- [ ] Read receipts
- [ ] Browser notifications
- [ ] Mobile app (React Native)

### Phase 3 — Full Decentralization
- [ ] On-chain username registry
- [ ] P2P network discovery (no backend required)
- [ ] Client-side full chain sync
- [ ] Forward secrecy (Signal-style ratchet)

---

## 📝 Notes for Hackathon Judges

**What Works:**
- ✅ Real on-chain message records (not simulated)
- ✅ Mandatory blockchain proof for all operations
- ✅ E2E encryption (NaCl Curve25519)
- ✅ Deployed on Aleo Testnet Beta
- ✅ Hybrid architecture (fast delivery + blockchain proof)

**What's Centralized (for now):**
- Backend indexer for message sync (but messages ARE on-chain)
- Profile discovery (username/bio stored in backend DB)
- CORS-protected API (not public, requires whitelisted frontend)

**Core Innovation:**
- Hybrid model: instant off-chain delivery + mandatory on-chain proof
- Every message is a blockchain transaction (provable, immutable)
- Private records ensure only sender + recipient can read

---

**Built for Aleo Hackathon 2026** 🏎️
