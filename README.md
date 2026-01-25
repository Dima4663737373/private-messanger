# Ghost on Aleo

A decentralized private messaging application built on the Aleo blockchain, enabling encrypted peer-to-peer messaging with full privacy guarantees.

## Overview

This project consists of a smart contract written in Leo and a React-based frontend that allows users to send and receive encrypted messages on the Aleo blockchain. Messages are stored as private records on-chain, ensuring that only the intended recipient can decrypt and read them.

## Features

- **Private Messaging**: Send encrypted messages to any Aleo address
- **Profile Management**: Create and update user profiles with name and bio
- **Message Sync**: Automatically sync messages from the blockchain
- **Wallet Integration**: Supports Leo Wallet and Puzzle Wallet
- **Transaction History**: Track sent messages with transaction status
- **Blockchain Indexing**: Fast message retrieval using on-chain mappings

## Architecture

### Smart Contract (`src/main.leo`)

The Aleo program provides:
- `send_message`: Send an encrypted message to a recipient
- `create_profile` / `update_profile`: Manage user profiles
- Message indexing via mappings for efficient retrieval
- Private record encryption for message content

### Frontend (`frontend/`)

A React + TypeScript application that:
- Connects to Aleo wallets (Leo Wallet, Puzzle Wallet)
- Handles message encryption/decryption
- Syncs messages from blockchain records
- Provides a user-friendly messaging interface

## Prerequisites

- Node.js 18+ and npm
- Leo CLI (for contract compilation)
- Aleo wallet (Leo Wallet or Puzzle Wallet)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd ghost
```

2. Install frontend dependencies:
```bash
cd frontend
npm install
```

3. Build the smart contract:
```bash
cd ..
leo build
```

## Development

### Running the Frontend

```bash
cd frontend
npm run dev
```

The application will be available at `http://localhost:5173`

### Compiling the Contract

```bash
leo build
```

### Deploying the Contract

```bash
leo deploy --network testnet
```

**Important**: After deploying, verify that all functions are present:

```bash
node verify_deployment.js
```

This script checks that the deployed program includes all required functions (`send_message`, `create_profile`, etc.). If functions are missing, the deployment may have failed or an older version was deployed.

## Usage

1. **Connect Wallet**: Click "Select Wallet" and choose your Aleo wallet
2. **Grant Permissions**: Allow "On-Chain History" access for faster message syncing
3. **Create Profile**: Set your name and bio (optional)
4. **Send Messages**: Enter a recipient address and message, then click "Send Message"
5. **Sync Messages**: Click "SYNC" to retrieve messages from the blockchain
6. **View Inbox**: Received messages appear in the inbox after syncing

## How It Works

### Message Flow

1. **Sending**: When you send a message, the frontend creates a transaction calling `send_message` with the recipient address and encrypted content
2. **On-Chain Storage**: The contract creates two private records - one for the recipient and one for the sender
3. **Indexing**: Message metadata is stored in public mappings for efficient retrieval
4. **Receiving**: Recipients sync messages by:
   - First checking wallet records (fastest, requires On-Chain History permission)
   - Falling back to cache if available
   - Scanning recent blocks if needed

### Privacy Features

- Message content is encrypted and stored in private records
- Only the recipient can decrypt their messages
- Message metadata (sender, timestamp) is indexed for performance but content remains private
- All encryption/decryption happens client-side using wallet adapters

## Project Structure

```
ghost/
├── src/
│   └── main.leo              # Aleo smart contract
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # Main application component
│   │   ├── components/       # React components
│   │   ├── hooks/            # Custom React hooks
│   │   └── utils/            # Utility functions
│   └── package.json
├── build/                    # Compiled contract
└── README.md
```

## Configuration

The deployed program ID is configured in `frontend/src/deployed_program.ts`. Update this if deploying a new contract version.

## API Endpoints

The frontend uses the Provable API for blockchain queries:
- `/program/{PROGRAM_ID}/mapping/message_count/{address}` - Get message count
- `/block/{height}` - Get block data
- `/transaction/{txId}` - Get transaction data

## Troubleshooting

### Messages Not Appearing

1. Ensure wallet has "On-Chain History" permission enabled
2. Click "SYNC" to manually sync messages
3. Check browser console for errors
4. Try "Force Refresh" to clear cache and rescan

### Transaction Failures

1. Verify you have sufficient credits in your wallet
2. Check network connection
3. Ensure recipient address is valid (starts with `aleo1`)
4. Check transaction status in AleoScan or Provable Explorer

### "Function does not exist" Error

If you see an error like `The called function (send_message) does not exist in program`, this means:

1. **The deployed program is outdated**: The program on the network doesn't match your local code
2. **Solution**: Redeploy the program with the current code:
   ```bash
   leo build
   leo deploy --network testnet
   ```
3. **Verify deployment**: Run `node verify_deployment.js` to confirm all functions are present
4. **Update program ID**: If deploying a new version, update `frontend/src/deployed_program.ts` with the new program ID

## License

[Add your license here]

## Contributing

[Add contribution guidelines here]

