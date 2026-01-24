import React, { useMemo } from 'react';
import { WalletProvider, useWallet } from "@demox-labs/aleo-wallet-adapter-react";
import { LeoWalletAdapter } from "@demox-labs/aleo-wallet-adapter-leo";
import { WalletAdapterNetwork, DecryptPermission } from "@demox-labs/aleo-wallet-adapter-base";
import LandingPage from './components/LandingPage';
import ChatInterface from './components/ChatInterface';

const Content: React.FC = () => {
  const { publicKey } = useWallet();
  return publicKey ? <ChatInterface /> : <LandingPage />;
};

function App() {
  const wallets = useMemo(
    () => [
      new LeoWalletAdapter({
        appName: "Ghost Messenger",
      }),
    ],
    []
  );

  return (
    <WalletProvider
      wallets={wallets}
      decryptPermission={DecryptPermission.OnChainHistory}
      network={WalletAdapterNetwork.TestnetBeta}
      autoConnect
    >
      <div className="min-h-screen bg-brutal-white font-mono">
        <Content />
      </div>
    </WalletProvider>
  );
}

export default App;