# Incomplete Features & Technical Debt

## 1. Decentralization & Profile Management
- **Current State:** Profiles (username, bio, encryption keys) are stored in a centralized backend database (`backend/src/services/database.ts`). The "Smart Contract" `create_profile` function only stores a hash on-chain (or just validates inputs), but the frontend relies on the backend API `/profiles/:address` to discover users and get public keys.
- **Missing:** 
  - Full on-chain profile storage and retrieval.
  - Decentralized username resolution (currently relies on backend mapping).
  - Removal of backend dependency for critical features like encryption key exchange.

## 2. Network Discovery
- **Current State:** The "Network Search" feature queries the centralized backend database.
- **Missing:** 
  - On-chain iterator or graph query to find users without a central indexer.
  - Peer-to-peer discovery mechanisms.

## 3. Encryption & Privacy
- **Current State:** Uses `tweetnacl` (Curve25519) for message encryption. This requires a specific keypair that is generated locally and published to the centralized backend.
- **Missing:** 
  - Derivation of encryption keys directly from Aleo keys (to remove the need for a separate "Messaging Key").
  - Forward Secrecy (Ratchet) - currently uses static keys.
  - Metadata privacy (sender/recipient are visible on-chain in the `Message` record, though the content is shielded).

## 4. Message Storage & History
- **Current State:** Messages are stored on-chain (good), but the frontend relies on the backend "Indexer" to fetch history efficiently via WebSocket.
- **Missing:** 
  - Client-side full sync from chain (slow but trustless). Currently, if the backend is down, history is unavailable or requires full chain scan.

## 5. Smart Contracts
- **Current State:** `ghost_messenger_v2.aleo` is basic. It stores `Message` records.
- **Missing:**
  - Logic for "Group Chats" (requires more complex record sharing).
  - "Tipping" or "Paid Messages" logic (partially implied by `amount` field but not fully enforced/used).
  - Anti-spam mechanisms (staking or minimum fee beyond gas).

## 6. UX / UI
- **Current State:** "Profile not found" previously blocked messaging. Fixed to allow plaintext fallback.
- **Missing:** 
  - Indication to user when a message is sent unencrypted.
  - Media support (images/files).
  - Notifications (browser native).

## 7. PrivTok Comparison
- **Analysis:** PrivTok uses a simulation for messaging (fakes it with timeouts). Ghost is actually ahead by using real on-chain records, even if the encryption key exchange is centralized.
