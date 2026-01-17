import { useState } from "react";
import type { FC } from "react";
import { useWallet } from "@demox-labs/aleo-wallet-adapter-react";
import { WalletAdapterNetwork, DecryptPermission } from "@demox-labs/aleo-wallet-adapter-base";
import type { WalletName } from "@demox-labs/aleo-wallet-adapter-base";
import "./Header.css";

interface HeaderProps {
    programId: string;
}

const WalletIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
    <path d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
    <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" />
  </svg>
);

export const Header: FC<HeaderProps> = ({ programId }) => {
    const { publicKey, disconnect, connecting, select, wallets } = useWallet();
    const [showModal, setShowModal] = useState(false);
    const network = WalletAdapterNetwork.TestnetBeta; // Default to Testnet

    const handleConnect = async (adapterName: string) => {
        const adapter = wallets.find(w => w.adapter.name === adapterName)?.adapter;
        if (!adapter) return;

        try {
            await adapter.connect(DecryptPermission.OnChainHistory, network, [programId]);
            select(adapterName as WalletName);
            setShowModal(false);
        } catch (e) {
            console.error("Connection failed:", e);
            alert("Connection failed: " + (e instanceof Error ? e.message : String(e)));
        }
    };

    return (
        <>
            <header className="header-container">
                <div className="logo-section">
                    <div className="logo-icon" />
                    <span className="logo-text"><span className="logo-highlight">GHOST</span></span>
                </div>
                
                <button 
                    onClick={() => publicKey ? disconnect() : setShowModal(true)}
                    className={`wallet-button ${publicKey ? 'connected' : 'disconnected'}`}
                    disabled={connecting}
                >
                    <WalletIcon />
                    <span>
                        {connecting ? "Connecting..." : 
                         publicKey ? `${publicKey.slice(0, 6)}...${publicKey.slice(-4)}` : 'Connect Wallet'}
                    </span>
                </button>
            </header>

            {showModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3 className="modal-title">Select Wallet</h3>
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            {wallets.map((w) => (
                                <button
                                    key={w.adapter.name}
                                    onClick={() => handleConnect(w.adapter.name)}
                                    className="wallet-option"
                                >
                                    {w.adapter.name}
                                    {w.readyState === "Installed" && <span style={{fontSize: "0.8em", opacity: 0.7, float: "right"}}>Detected</span>}
                                </button>
                            ))}
                            <button onClick={() => setShowModal(false)} className="cancel-button">
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
