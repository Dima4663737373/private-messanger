# Wallet Integration Guide — Ghost Messenger

## Supported Wallets

Ghost Messenger supports multiple Aleo wallets through the [Demox Labs Aleo Wallet Adapter](https://github.com/demox-labs/aleo-wallet-adapter):

| Wallet | Status | Website |
|--------|--------|---------|
| **Leo Wallet** | ✅ Active | [leo.app](https://leo.app) |
| **Puzzle Wallet** | 🔄 Ready to add | [puzzle.online](https://puzzle.online) |
| **Fox Wallet** | 🔄 Ready to add | [foxwallet.com](https://foxwallet.com) |
| **Soter Wallet** | 🔄 Ready to add | - |
| **Shield Wallet** | 🔜 Q1 2026 | [shield.app](https://shield.app) |

**Current:** Only Leo Wallet is configured. Multi-wallet support coming soon.

---

## Current Implementation

### Dependencies

```json
{
  "@demox-labs/aleo-wallet-adapter-base": "^0.0.23",
  "@demox-labs/aleo-wallet-adapter-leo": "^0.0.25",
  "@demox-labs/aleo-wallet-adapter-react": "^0.0.22"
}
```

### App.tsx — Wallet Connection

**Connection trigger:** User clicks "Connect Wallet" on landing page.

```typescript
// App.tsx
const connectWallet = async () => {
  try {
    const { publicKey } = await (window as any).leoWallet.connect();
    setPublicKey(publicKey);
    setIsConnected(true);
    toast.success('Wallet connected');
  } catch (e: any) {
    toast.error('Failed to connect wallet: ' + (e?.message || 'Unknown error'));
  }
};
```

**Disconnect:**
```typescript
const disconnectWallet = () => {
  setPublicKey(null);
  setIsConnected(false);
  setMyProfile(null);
  toast.success('Wallet disconnected');
};
```

### useContract.ts — Transaction Execution

All on-chain operations use `window.leoWallet.requestTransaction()`:

```typescript
const executeTransaction = async (functionName: string, inputs: string[]): Promise<string> => {
  if (!window.leoWallet) throw new Error('Leo wallet not available');

  const txId = await window.leoWallet.requestTransaction({
    address: publicKey,
    network: NETWORK,
    program: PROGRAM_ID,
    functionName,
    inputs,
    fee: 50000,        // 0.05 ALEO
    feePrivate: false
  });

  return txId;
};
```

**Example — Send Message:**
```typescript
const sendMessageOnChain = async (
  recipientAddr: string,
  payload: [string, string, string, string],
  timestamp: number,
  attachmentCID?: string
): Promise<string> => {
  const senderHash = await getAddressHash(publicKey!);
  const recipientHash = await getAddressHash(recipientAddr);

  const inputs = [
    senderHash,
    recipientHash,
    recipientAddr,
    `[${payload.join(',')}]`,
    `${timestamp}u64`,
    attachmentCID ? `${attachmentCID.slice(0, 31)}field` : '0field',
    attachmentCID ? `${attachmentCID.slice(31)}field` : '0field'
  ];

  return await executeTransaction('send_message', inputs);
};
```

---

## Adding Multi-Wallet Support

### Step 1: Install Additional Adapters

```bash
cd frontend
npm install --legacy-peer-deps \
  @demox-labs/aleo-wallet-adapter-puzzlewallet \
  @demox-labs/aleo-wallet-adapter-foxwallet \
  @demox-labs/aleo-wallet-adapter-soter
```

### Step 2: Wrap App with WalletProvider

**Update `frontend/src/main.tsx`:**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { WalletProvider } from '@demox-labs/aleo-wallet-adapter-react';
import { WalletModalProvider } from '@demox-labs/aleo-wallet-adapter-reactui';
import { LeoWalletAdapter } from '@demox-labs/aleo-wallet-adapter-leo';
import { PuzzleWalletAdapter } from '@demox-labs/aleo-wallet-adapter-puzzlewallet';
import { FoxWalletAdapter } from '@demox-labs/aleo-wallet-adapter-foxwallet';
import { SoterWalletAdapter } from '@demox-labs/aleo-wallet-adapter-soter';

const wallets = [
  new LeoWalletAdapter({ appName: 'Ghost Messenger' }),
  new PuzzleWalletAdapter({ appName: 'Ghost Messenger' }),
  new FoxWalletAdapter({ appName: 'Ghost Messenger' }),
  new SoterWalletAdapter({ appName: 'Ghost Messenger' }),
];

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Could not find root element");

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <WalletProvider wallets={wallets} autoConnect>
      <WalletModalProvider>
        <App />
      </WalletModalProvider>
    </WalletProvider>
  </React.StrictMode>
);
```

### Step 3: Use `useWallet` Hook

**Update `frontend/src/App.tsx`:**

```typescript
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';

function App() {
  const {
    wallet,
    publicKey,
    connect,
    disconnect,
    requestTransaction
  } = useWallet();

  const connectWallet = async () => {
    try {
      await connect();
      toast.success(`Connected: ${wallet?.adapter.name}`);
    } catch (e: any) {
      toast.error('Failed to connect: ' + e?.message);
    }
  };

  const disconnectWallet = () => {
    disconnect();
    toast.success('Wallet disconnected');
  };

  // Rest of component...
}
```

### Step 4: Replace Direct `window.leoWallet` Calls

**Update `frontend/src/hooks/useContract.ts`:**

```typescript
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';

export function useContract(publicKey: string | null) {
  const { requestTransaction } = useWallet();

  const executeTransaction = async (
    functionName: string,
    inputs: string[]
  ): Promise<string> => {
    if (!requestTransaction) throw new Error('Wallet not connected');

    const txId = await requestTransaction({
      address: publicKey!,
      network: NETWORK,
      program: PROGRAM_ID,
      functionName,
      inputs,
      fee: 50000,
      feePrivate: false
    });

    return txId;
  };

  // Rest of hook...
}
```

### Step 5: Add WalletMultiButton Component

**Update `frontend/src/components/LandingPage.tsx`:**

```typescript
import { WalletMultiButton } from '@demox-labs/aleo-wallet-adapter-reactui';

export default function LandingPage({ onConnect }: LandingPageProps) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-5xl font-bold mb-8">👻 Ghost Messenger</h1>
        <p className="text-xl mb-8">Private messaging on Aleo</p>

        {/* Multi-wallet button */}
        <WalletMultiButton />
      </div>
    </div>
  );
}
```

---

## Shield Wallet Integration (Q1 2026)

Shield Wallet is launching in Q1 2026 with focus on **private transactions** and **private stablecoins** on Aleo.

**When available:**
1. Install adapter (if provided by Shield team or Demox Labs)
2. Add to `wallets` array in `main.tsx`
3. No code changes needed — wallet adapter handles everything

**Resources:**
- [Shield Wallet Website](https://shield.app)
- [Aleo Wallet Integration Docs](https://docs.leo.app/aleo-wallet-adapter)
- [Demox Labs GitHub](https://github.com/demox-labs/aleo-wallet-adapter)

---

## Testing

### Local Testing
1. Install Leo Wallet extension
2. Create/import test wallet
3. Get testnet ALEO from [faucet](https://faucet.aleo.org)
4. Run `npm run dev` in frontend
5. Click "Connect Wallet" → Sign transactions

### Multi-Wallet Testing
- Use different browsers for different wallets
- Test wallet switching (disconnect → connect different wallet)
- Verify transaction signing works across all wallets

---

## Troubleshooting

### "Wallet not found" error
- Ensure browser extension is installed and enabled
- Refresh page after installing extension
- Check console for wallet detection logs

### Transaction fails with "Insufficient funds"
- Get testnet ALEO from [faucet](https://faucet.aleo.org)
- Minimum ~0.5 ALEO needed for testing
- Each message costs ~0.05 ALEO

### "Network mismatch" error
- Ensure wallet is on **Testnet Beta** network
- Check `NETWORK` constant in `useContract.ts` matches wallet network

---

## API Reference

### Wallet Adapter Hooks

```typescript
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';

const {
  wallet,            // Current wallet adapter
  publicKey,         // Connected address (string | null)
  connected,         // Boolean connection status
  connect,           // () => Promise<void>
  disconnect,        // () => void
  requestTransaction // Transaction request function
} = useWallet();
```

### Transaction Request

```typescript
const txId = await requestTransaction({
  address: 'aleo1...',           // Sender address
  network: 'testnet',            // 'testnet' | 'mainnet'
  program: 'program.aleo',       // Program ID
  functionName: 'function_name', // Transition name
  inputs: ['arg1', 'arg2'],      // Array of arguments
  fee: 50000,                    // Fee in microcredits
  feePrivate: false              // Use private fee record
});
```

---

## Sources

- [Aleo Wallet Adapter Docs](https://docs.leo.app/aleo-wallet-adapter)
- [Demox Labs GitHub](https://github.com/demox-labs/aleo-wallet-adapter)
- [Aleo Developer Docs](https://developer.aleo.org/guides/wallets/)
- [Shield Wallet](https://shield.app)
- [Leo Wallet](https://leo.app)
