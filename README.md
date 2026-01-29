# Ghost — Private Messenger on Aleo

A decentralized private messaging app on the Aleo blockchain with encrypted messages and privacy-preserving state.

---

## Program Name and Deploy Commands

**Program ID:** `priv_messenger_leotest_012.aleo`

### Deploy Commands

**Build the contract:**
```bash
leo build
```

**Deploy to Testnet:**
```bash
leo deploy --network testnet
```

**Deploy to Mainnet** (requires `.env` with `PRIVATE_KEY`):
```bash
# Create .env with:
# PRIVATE_KEY=your_private_key

./deploy_mainnet.sh
```

Or manually:
```bash
leo deploy --network mainnet --private-key "$PRIVATE_KEY" --priority-fee 1000000
```

**Verify after deploy:**
```bash
node verify_deployment.js
```

The script checks that all required functions exist on the network (`send_message`, `create_profile`, `update_profile`, `update_contact_name`, `delete_chat`, `restore_chat`).

---

## Smart Contract: Main Functions

Contract source: `src/main.leo`.

### Transitions

| Function | Parameters | Description |
|----------|------------|-------------|
| `create_profile` | `public name: field`, `public bio: field` | Create profile (name and bio stored as hashes). |
| `update_profile` | `public name: field`, `public bio: field` | Update profile (overwrites mapping). |
| `send_message` | `private recipient`, `private amount`, `private message`, `private timestamp` | Send message: creates two private records (recipient + sender) and updates public indexes. |
| `update_contact_name` | `private contact_address`, `private contact_name` | Store local contact name for the user (key = hash(user + contact)). |
| `delete_chat` | `private contact_address` | Mark chat as deleted/archived for the current user. |
| `restore_chat` | `private contact_address` | Restore chat after "deletion". |

### Data Structures

- **`ProfileInfo`** — profile: `name_hash`, `bio_hash` (both fields, hashes for privacy).
- **`Message`** — private message record: `owner`, `sender`, `recipient`, `amount`, `message`, `timestamp`.
- **`MessageMeta`** — public metadata for indexing: `sender_hash`, `recipient_hash`, `amount`, `message_hash`, `timestamp`.

### On-Chain Mappings

- `profiles: address => ProfileInfo` — profiles by address.
- `message_count: address => u64` — number of received messages per address.
- `message_index: field => MessageMeta` — inbox index (key = hash(recipient) + index).
- `sent_message_count: address => u64` — number of sent messages.
- `sent_message_index: field => MessageMeta` — outbox index (key = hash(sender) + index).
- `contact_names: field => field` — local contact names (key = hash(user, contact)).
- `deleted_chats: field => u64` — deleted/archived chats (1 = deleted, 0 = active).

---

## How It Works

1. **Profile**  
   User calls `create_profile` or `update_profile` with `name` and `bio`. The contract hashes them (BHP256) and stores `name_hash` and `bio_hash` in `profiles`. Raw name/bio are not stored on-chain.

2. **Sending a message**  
   `send_message(recipient, amount, message, timestamp)` creates two private `Message` records (one with `owner: recipient`, one with `owner: sender`). In `finalize_send_message`, addresses and message content are hashed; `MessageMeta` is stored in `message_index` (recipient) and `sent_message_index` (sender); `message_count` and `sent_message_count` are updated.

3. **Contacts and chats**  
   `update_contact_name` stores a local contact name under key `hash(user) + hash(contact_address)`. `delete_chat` / `restore_chat` set `deleted_chats` under the same key to 1 or 0.

4. **Frontend**  
   Connects Leo Wallet, builds transactions to `priv_messenger_leotest_012.aleo`, encodes text to field (`messageUtils`), sends transitions and syncs messages via wallet records and RPC (mappings, blocks).

---

## Public vs Private Data

### Private (Aleo encryption / records)

- **`Message` record** — fully private: `owner`, `sender`, `recipient`, `amount`, `message`, `timestamp`. Only the record owner can decrypt; message content is not visible in public state.
- **Transition inputs:** `recipient`, `amount`, `message`, `timestamp` in `send_message`; `contact_address`, `contact_name` in `update_contact_name`; `contact_address` in `delete_chat` / `restore_chat` — all passed as private inputs.

### Public but hashed (privacy-preserving)

- **`ProfileInfo`**: only `name_hash` and `bio_hash` (BHP256) stored; no raw name/bio.
- **`MessageMeta`**: mappings store `sender_hash`, `recipient_hash`, `message_hash`, plus `amount` and `timestamp` — for indexing without revealing sender/recipient/content.
- **`contact_names`**: key = `hash(user) + hash(contact_address)`; value = field (encoded contact name).
- **`deleted_chats`**: same key; value 0 or 1.

### Public (addresses and counts)

- **`message_count`**, **`sent_message_count`**: key = address, value = u64. Address is visible; message count is public.
- Keys in `message_index` and `sent_message_index` are built from hashes and indices, so records are not trivially linkable without the address.

---

## How to Install and Configure the Frontend

Follow these steps so the frontend runs and works with the Ghost program and Leo Wallet.

### 1. Prerequisites

- **Node.js** 18 or newer ([nodejs.org](https://nodejs.org))
- **npm** (comes with Node.js)
- **Leo Wallet** browser extension ([leo wallet](https://www.aleo.org/get-started)) — install and create/unlock a wallet
- **Leo CLI** — only if you build or deploy the contract yourself; not required to run the frontend

### 2. Clone and go to the project

```bash
git clone <your-repo-url>
cd ghost
```

### 3. Install frontend dependencies

From the project root:

```bash
cd frontend
npm install
```

Wait until install finishes without errors.

### 4. Configure Program ID (only if you use your own deployment)

The app talks to the Aleo program defined in `frontend/src/deployed_program.ts`.

- **Default:** `priv_messenger_leotest_012.aleo` — no change needed; frontend is already set for the shared Testnet deployment.
- **Your own program:** If you deployed a different program (e.g. your own `priv_messenger_*`), open `frontend/src/deployed_program.ts` and set:

  ```ts
  export const PROGRAM_ID = "your_program_id.aleo";
  ```

  Use the exact Program ID you deployed (e.g. from `program.json` or `leo deploy` output).

### 5. Network and environment

- **Network:** The frontend is configured for **Aleo Testnet** in `frontend/src/hooks/useContract.ts` (`WalletAdapterNetwork.TestnetBeta`). For Mainnet you’d change that and redeploy the contract there.
- **Environment variables:** No `.env` or API keys are required. The app uses public RPC endpoints (aleo.org, provable.com, etc.) for program and mapping checks.

### 6. Run the frontend (dev)

From the `frontend` folder:

```bash
npm run dev
```

- Open **http://localhost:5173** in your browser.
- Install/use **Leo Wallet** in that browser and switch it to **Testnet** (or the same network as your program).
- In the app: connect the wallet, allow permissions if asked, then you can create a profile, send messages, and sync inbox.

### 7. Production build (optional)

To build for production:

```bash
cd frontend
npm run build
```

Static files will be in `frontend/dist`. To preview:

```bash
npm run preview
```

### Troubleshooting

| Issue | What to check |
|-------|----------------|
| App doesn’t load / blank page | Console (F12) for errors; ensure `npm install` and `npm run dev` finished without errors. |
| Wallet not connecting | Leo Wallet extension installed and unlocked; same browser as the app; wallet network = Testnet (or Mainnet if you use it). |
| “Function does not exist” / transaction fails | Program ID in `frontend/src/deployed_program.ts` must match the program on the network. Run `node verify_deployment.js` from project root to confirm the deployed program has all functions. |
| Messages not syncing | In Leo Wallet, enable “On-Chain History” (or equivalent) if available; use the app’s SYNC / Force Refresh. |
| Transaction rejected or insufficient credits | Ensure the wallet has enough credits (e.g. Testnet credits) for fees. |

---

## Project Structure

```
ghost/
├── src/
│   └── main.leo                 # Leo smart contract
├── frontend/
│   ├── src/
│   │   ├── deployed_program.ts  # Program ID for frontend
│   │   ├── hooks/useContract.ts # Contract calls (send_message, create_profile, …)
│   │   ├── components/         # ChatInterface, Login, LandingPage, ProgramStatus
│   │   └── utils/              # aleo-rpc, messageUtils, constants, walletUtils, …
│   └── package.json
├── program.json                 # Program name and metadata (priv_messenger_leotest_012.aleo)
├── deploy_mainnet.sh            # Mainnet deploy script
├── verify_deployment.js        # Verify functions after deploy
└── README.md
```

---

## Summary

- **Program:** `priv_messenger_leotest_012.aleo`.
- **Deploy:** `leo build` → `leo deploy --network testnet` (or mainnet with `PRIVATE_KEY`); then `node verify_deployment.js`.
- **Private:** full message content and addresses in `Message` records; contact names and "deleted" chats keyed by hashes.
- **Public but protected:** profiles and message metadata as hashes; message counts public per address.
- **Frontend:** `cd frontend && npm install` → optionally update `deployed_program.ts` → `npm run dev` to run with the contract and wallet.
