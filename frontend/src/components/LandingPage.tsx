import React, { useState } from 'react';
import { useWallet } from "@demox-labs/aleo-wallet-adapter-react";
import { DecryptPermission, WalletAdapterNetwork } from "@demox-labs/aleo-wallet-adapter-base";
import type { WalletName } from "@demox-labs/aleo-wallet-adapter-base";

const LandingPage: React.FC = () => {
  const { publicKey, connect, connecting, select, wallets, wallet } = useWallet();
  const [showModal, setShowModal] = useState(false);

  const handleConnect = async () => {
    if (wallets.length === 0) {
      alert('No wallets available. Please install Leo Wallet extension.');
      return;
    }

    try {
      // Always select wallet first if not selected
      if (!wallet && wallets.length > 0) {
        const walletName = wallets[0].adapter.name as WalletName;
        select(walletName);
        // Wait longer for wallet to be selected and initialized
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Now connect
      if (wallets.length === 1) {
        await connect(DecryptPermission.OnChainHistory, WalletAdapterNetwork.TestnetBeta);
      } else {
        // For multiple wallets, show selection modal
        setShowModal(true);
      }
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      
      // If wallet not selected, try to select it
      if (errorMsg.includes("WalletNotSelected") || errorMsg.includes("not selected")) {
        if (wallets.length > 0) {
          try {
            select(wallets[0].adapter.name as WalletName);
            await new Promise(resolve => setTimeout(resolve, 500));
            await connect(DecryptPermission.OnChainHistory, WalletAdapterNetwork.TestnetBeta);
          } catch (retryError) {
            // Silently fail - not critical
            if (wallets.length > 1) {
              setShowModal(true);
            } else {
              alert('Failed to connect wallet. Please ensure Leo Wallet is installed and unlocked.');
            }
          }
        }
      } else if (wallets.length > 1) {
        setShowModal(true);
      } else {
        alert('Failed to connect wallet. Please try again.');
      }
    }
  };

  const handleSelectWallet = async (walletName: string) => {
    try {
      select(walletName as WalletName);
      // Wait a bit for wallet to be selected
      await new Promise(resolve => setTimeout(resolve, 100));
      await connect(DecryptPermission.OnChainHistory, WalletAdapterNetwork.TestnetBeta);
      setShowModal(false);
    } catch (e) {
      // Silently fail - not critical
      alert('Failed to connect wallet. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-brutal-white text-brutal-black overflow-x-hidden">
      
      {/* Navigation */}
      <nav className="border-b-4 border-brutal-black p-4 flex justify-between items-center sticky top-0 bg-brutal-white z-50 animate-fade-in">
        <div className="font-black text-2xl tracking-tighter uppercase">Ghost<span className="text-brutal-yellow bg-brutal-black px-1">.Aleo</span></div>
        <div className="hidden md:flex gap-6 font-bold uppercase text-sm">
          <a href="#features" className="hover:underline">ZK-Proof</a>
          <a href="#about" className="hover:underline">Manifesto</a>
          <a href="#community" className="hover:underline">Community</a>
        </div>
        <button 
          onClick={handleConnect}
          disabled={connecting || !!publicKey}
          className="bg-brutal-black text-brutal-yellow px-4 py-2 font-bold uppercase border-2 border-transparent hover:bg-brutal-yellow hover:text-brutal-black hover:border-brutal-black transition-all disabled:opacity-50"
        >
          {connecting ? 'Connecting...' : publicKey ? 'Connected' : 'Connect Wallet'}
        </button>

        {showModal && (
          <div className="modal-backdrop fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
            <div className="modal-content bg-white border-4 border-black p-6 max-w-md w-full mx-4 shadow-hard-lg" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-2xl font-black uppercase mb-4">Select Wallet</h2>
              {wallets.length === 0 ? (
                <div className="p-4 text-center">
                  <p className="font-bold mb-2">No wallets found</p>
                  <p className="text-sm text-gray-600">Please install Leo Wallet extension</p>
                  <a 
                    href="https://www.leo-wallet.com/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-block mt-4 px-4 py-2 bg-brutal-yellow border-2 border-black font-bold uppercase hover:bg-yellow-300"
                  >
                    Install Leo Wallet
                  </a>
                </div>
              ) : (
                <div className="space-y-2">
                  {wallets.map((walletItem) => (
                    <button
                      key={walletItem.adapter.name}
                      onClick={() => handleSelectWallet(walletItem.adapter.name)}
                      className="w-full p-3 border-4 border-black bg-yellow-400 hover:bg-yellow-300 font-bold uppercase text-left transition-colors"
                    >
                      {walletItem.adapter.name}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => setShowModal(false)}
                className="mt-4 w-full p-2 border-2 border-black bg-white hover:bg-gray-100 font-bold uppercase"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <header className="relative p-8 md:p-20 border-b-4 border-brutal-black flex flex-col md:flex-row items-center justify-between gap-12">
        <div className="max-w-2xl z-10 animate-slide-up">
          <div className="inline-block bg-brutal-yellow border-2 border-brutal-black px-2 py-1 font-bold mb-4 shadow-hard-sm">
            BETA v0.9.1 ON MAINNET
          </div>
          <h1 className="text-6xl md:text-8xl font-black uppercase leading-none mb-6">
            Private.<br/>
            Unseen.<br/>
            Ghost.
          </h1>
          <p className="text-xl md:text-2xl font-bold mb-8 max-w-lg">
            The first decentralized messenger built on <span className="underline decoration-4 decoration-brutal-yellow">Aleo</span>. 
            Zero-knowledge privacy meets brutalist efficiency.
          </p>
          <button 
            onClick={handleConnect}
            disabled={connecting || !!publicKey}
            className="bg-brutal-yellow border-4 border-brutal-black px-8 py-4 text-2xl font-black uppercase shadow-hard hover:translate-x-1 hover:translate-y-1 hover:shadow-none active:translate-x-0 active:translate-y-0 transition-all duration-150 disabled:opacity-50"
          >
            {connecting ? 'INITIALIZING...' : publicKey ? 'CONNECTED' : 'LAUNCH APP_'}
          </button>
        </div>

        {/* 3D Element Container */}
        <div className="perspective-container relative w-64 h-64 md:mr-20 hidden md:block">
           <div className="cube">
            <div className="face front">ZK</div>
            <div className="face back">P</div>
            <div className="face right">ID</div>
            <div className="face left">PVT</div>
            <div className="face top">G</div>
            <div className="face bottom">A</div>
          </div>
          {/* Decorative floor */}
          <div className="absolute -bottom-12 left-1/2 transform -translate-x-1/2 w-48 h-48 bg-brutal-black rounded-full opacity-20 blur-xl scale-y-25"></div>
        </div>
      </header>

      {/* Features Grid */}
      <section id="features" className="grid grid-cols-1 md:grid-cols-3 border-b-4 border-brutal-black">
        <div className="p-8 border-b-4 md:border-b-0 md:border-r-4 border-brutal-black hover:bg-brutal-yellow transition-colors group">
          <h3 className="text-3xl font-black uppercase mb-4 group-hover:translate-x-2 transition-transform">01. Zero Knowledge</h3>
          <p className="font-bold">Your messages are encrypted using ZK-SNARKs. Only you and the recipient hold the keys. Even the network doesn't know who you're talking to.</p>
        </div>
        <div className="p-8 border-b-4 md:border-b-0 md:border-r-4 border-brutal-black hover:bg-brutal-black hover:text-brutal-white transition-colors group">
          <h3 className="text-3xl font-black uppercase mb-4 group-hover:translate-x-2 transition-transform">02. On-Chain Identity</h3>
          <p className="font-bold">Login with your Aleo wallet. No phone numbers, no emails, no central servers storing your metadata.</p>
        </div>
        <div className="p-8 hover:bg-brutal-yellow transition-colors group">
          <h3 className="text-3xl font-black uppercase mb-4 group-hover:translate-x-2 transition-transform">03. Brutal Speed</h3>
          <p className="font-bold">Built for speed. No bloatware. Just raw, encrypted text transmission across the decentralized web.</p>
        </div>
      </section>

      {/* Info Block */}
      <section id="about" className="flex flex-col md:flex-row">
        <div className="w-full md:w-1/2 bg-brutal-black text-brutal-white p-12 flex flex-col justify-center border-b-4 md:border-b-0 md:border-r-4 border-brutal-white">
          <h2 className="text-5xl font-black uppercase mb-8 leading-none">
            Why Ghost?
          </h2>
          <p className="text-lg font-bold mb-6">
            In an era of surveillance, privacy is not a luxury, it's a necessity. Ghost leverages the power of the Aleo blockchain to ensure that your conversations remain yours.
          </p>
          <div className="grid grid-cols-2 gap-4 mt-8">
            <div className="border-2 border-brutal-white p-4">
              <div className="text-4xl font-black text-brutal-yellow">100%</div>
              <div className="text-xs uppercase">Open Source</div>
            </div>
            <div className="border-2 border-brutal-white p-4">
              <div className="text-4xl font-black text-brutal-yellow">0</div>
              <div className="text-xs uppercase">Trackers</div>
            </div>
          </div>
        </div>
        <div className="w-full md:w-1/2 bg-[url('https://www.transparenttextures.com/patterns/graphy.png')] p-12 relative overflow-hidden">
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 border-8 border-brutal-black rotate-45"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-brutal-yellow border-4 border-brutal-black -rotate-12 shadow-hard"></div>
           <div className="relative z-10 text-center">
             <h3 className="text-2xl font-black uppercase bg-brutal-white inline-block px-4 py-2 border-4 border-brutal-black transform -rotate-2">
               Powered by Aleo
             </h3>
           </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-brutal-yellow border-t-4 border-brutal-black p-8 text-center">
        <div className="font-black text-xl uppercase mb-4">Ghost Messenger © 2026</div>
        <div className="text-xs font-bold font-mono">
          RUNNING ON ALEO TESTNET V3 • SMART CONTRACT: 0x...GHOST
        </div>
      </footer>

    </div>
  );
};

export default LandingPage;