# Wallet Integration Guide — Ghost Messenger

## Shield Wallet

Ghost Messenger uses [Shield Wallet](https://shieldwallet.app) via the `@provablehq/aleo-wallet-adaptor-*` packages.

| Feature | Details |
|---------|---------|
| **Wallet** | Shield Wallet |
| **Adapter** | `@provablehq/aleo-wallet-adaptor-shield` |
| **Proving** | Delegated (server-side, ~14s) |
| **Network** | Aleo Testnet Beta |
| **Permissions** | `DECRYPT_UPON_REQUEST` |

---

## Dependencies

```json
{
  "@provablehq/aleo-types": "^0.3.0-alpha.3",
  "@provablehq/aleo-wallet-adaptor-core": "^0.3.0-alpha.3",
  "@provablehq/aleo-wallet-adaptor-react": "^0.3.0-alpha.3",
  "@provablehq/aleo-wallet-adaptor-react-ui": "^0.3.0-alpha.3",
  "@provablehq/aleo-wallet-adaptor-shield": "^0.3.0-alpha.3",
  "@provablehq/aleo-wallet-standard": "^0.3.0-alpha.3"
}
```

---

## Provider Setup (App.tsx)

```tsx
import { AleoWalletProvider, useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { ShieldWalletAdapter } from "@provablehq/aleo-wallet-adaptor-shield";
import { DecryptPermission } from "@provablehq/aleo-wallet-adaptor-core";
import { Network } from "@provablehq/aleo-types";
import { PROGRAM_ID } from './deployed_program';

function App() {
  return (
    <AleoWalletProvider
      wallets={[new ShieldWalletAdapter({ appName: "Ghost Messenger" })]}
      decryptPermission={DecryptPermission.UponRequest}
      network={Network.TESTNET}
      programs={[PROGRAM_ID, 'credits.aleo']}
      autoConnect={true}
      onError={(error) => console.error('[Wallet]', error.message)}
    >
      <InnerApp />
    </AleoWalletProvider>
  );
}
```

---

## Wallet Hook (useWallet)

```tsx
import { useWallet } from "@provablehq/aleo-wallet-adaptor-react";

const {
  address,           // Connected wallet address (string | null)
  connected,         // Boolean connection status
  connecting,        // Boolean connecting status
  disconnect,        // () => Promise<void>
  wallets,           // Available wallet adapters
  selectWallet,      // (name: WalletName) => void
  executeTransaction,// (options: TransactionOptions) => Promise<{transactionId: string}>
  transactionStatus, // (txId: string) => Promise<TransactionStatusResponse>
  requestRecords,    // (program: string) => Promise<unknown[]>
  signMessage,       // (message: Uint8Array) => Promise<Uint8Array>
} = useWallet();
```

---

## Transaction Execution (useContract.ts)

```tsx
const result = await executeTransaction({
  program: PROGRAM_ID,          // e.g. 'ghost_msg_018.aleo'
  function: 'send_message',     // Transition name
  inputs: [                     // Array of Leo-typed arguments
    senderHash,
    recipientHash,
    recipientAddress,
    payloadArray,
    `${timestamp}u64`,
    attachmentField1,
    attachmentField2
  ],
  fee: 350_000,                 // Fee in microcredits
  privateFee: false              // Use public fee
});

const tempTxId = result?.transactionId; // Returns shield_* temporary ID
```

### Transaction ID Resolution

Shield Wallet returns temporary `shield_*` IDs. The `pollForOnChainTxId` function polls `transactionStatus()` every 2 seconds to resolve the real on-chain `at1...` transaction ID:

```tsx
const pollForOnChainTxId = async (tempTxId: string): Promise<string> => {
  for (let i = 0; i < 60; i++) {
    const resp = await transactionStatus(tempTxId);
    if (resp.status === 'accepted' || resp.status === 'finalized') {
      return resp.transactionId || tempTxId;
    }
    if (resp.status === 'rejected' || resp.status === 'failed') {
      throw new Error(`Transaction ${resp.status}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return tempTxId;
};
```

---

## Wallet Connection Flow

1. User clicks "Connect Wallet"
2. `selectWallet(wallets[0].adapter.name)` selects Shield Wallet
3. `adapter.connect(Network.TESTNET, DecryptPermission.UponRequest, programs)` opens Shield popup
4. User confirms connection in Shield Wallet
5. `address` becomes available, `connected = true`
6. Encryption keys are deterministically derived from the address
7. Profile is registered/updated on the backend

---

## Key Derivation

Encryption keys are derived deterministically from the wallet address (no `signMessage` required):

```tsx
import { getOrDeriveKeys } from '../utils/key-derivation';

// Derives NaCl Curve25519 keypair from wallet address
const keys = await getOrDeriveKeys(address, undefined);
// keys.publicKey — encryption public key (shared with recipients)
// keys.secretKey — encryption secret key (stays on device)
```

---

## Testing

1. Install [Shield Wallet](https://shieldwallet.app) browser extension
2. Create or import a test wallet
3. Get testnet ALEO from [faucet](https://faucet.aleo.org)
4. Run frontend locally: `cd frontend && npm run dev`
5. Click "Connect Wallet" → Approve in Shield popup
6. Send a message → Approve transaction in Shield popup

---

## Troubleshooting

### "Wallet not found"
- Ensure Shield Wallet extension is installed and enabled
- Refresh page after installing
- Check browser console for wallet detection logs

### Transaction timeout
- Shield Wallet uses delegated proving (~14s average)
- If >60s, check Shield Wallet popup for errors
- Verify sufficient ALEO balance (minimum ~0.5 ALEO)

### "502 Bad Gateway" on backend
- Render free tier spins down after 15 min of inactivity
- First request after spin-down takes ~30s (cold start)
- Subsequent requests are instant

---

## Resources

- [Shield Wallet](https://shieldwallet.app)
- [Provable Wallet Adapter](https://github.com/provablehq/aleo-wallet-adaptor)
- [Aleo Developer Docs](https://developer.aleo.org)
- [Provable API](https://docs.explorer.provable.com)
