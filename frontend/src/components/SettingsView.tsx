import React, { useState } from 'react';
import { User, Save, Loader2, AlertTriangle, Wallet, Copy, Shield, Lock, ChevronRight, LogOut, ExternalLink, Link } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface SettingsViewProps {
  // Profile
  onCreateProfile: (name: string, bio: string) => Promise<void>;
  onUpdateProfile: (name: string, bio: string) => Promise<void>;
  isProcessing: boolean;
  initialData?: { username?: string; bio?: string } | null;
  error?: string | null;

  // Wallet
  isWalletConnected: boolean;
  publicKey: string | null;
  balance?: number | null;
  onDisconnect: () => void;
}

type Section = 'main' | 'profile' | 'wallet' | 'security' | 'privacy';

const SettingsView: React.FC<SettingsViewProps> = ({
  onCreateProfile,
  onUpdateProfile,
  isProcessing,
  initialData,
  error,
  isWalletConnected,
  publicKey,
  balance,
  onDisconnect
}) => {
  const [activeSection, setActiveSection] = useState<Section>('main');
  const [name, setName] = useState(initialData?.username || '');
  const [bio, setBio] = useState(initialData?.bio || '');

  React.useEffect(() => {
    if (initialData) {
      setName(initialData.username || '');
      setBio(initialData.bio || '');
    }
  }, [initialData]);

  const handleSaveProfile = async () => {
    if (!name || !bio) {
      toast.error('Username and bio are required');
      return;
    }

    if (initialData?.username) {
      await onUpdateProfile(name, bio);
    } else {
      await onCreateProfile(name, bio);
    }
  };

  const handleCopyAddress = () => {
    if (publicKey) {
      navigator.clipboard.writeText(publicKey);
      toast.success('Address copied');
    }
  };

  // Main menu
  if (activeSection === 'main') {
    return (
      <div className="flex-1 bg-white flex flex-col h-screen overflow-y-auto animate-slide-up">
        <div className="p-8">
          <h2 className="text-4xl font-bold mb-2 tracking-tighter text-[#0A0A0A]">SETTINGS</h2>
          <p className="text-[#666]">Manage your Ghost account</p>
        </div>

        <div className="flex-1 px-8 pb-8">
          <div className="space-y-2">
            {/* Profile Section */}
            <button
              onClick={() => setActiveSection('profile')}
              className="w-full bg-[#FAFAFA] hover:bg-[#F0F0F0] border border-[#E5E5E5] hover:border-[#FF8C00] rounded-2xl p-6 flex items-center justify-between transition-colors group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-[#FF8C00] to-[#FF5500] rounded-full flex items-center justify-center">
                  <User size={24} className="text-white" />
                </div>
                <div className="text-left">
                  <h3 className="font-bold text-lg text-[#0A0A0A]">Profile</h3>
                  <p className="text-sm text-[#666]">
                    {initialData?.username || 'Set up your identity'}
                  </p>
                </div>
              </div>
              <ChevronRight size={20} className="text-[#999] group-hover:text-[#FF8C00] transition-colors" />
            </button>

            {/* Wallet Section */}
            <button
              onClick={() => setActiveSection('wallet')}
              className="w-full bg-[#FAFAFA] hover:bg-[#F0F0F0] border border-[#E5E5E5] hover:border-[#FF8C00] rounded-2xl p-6 flex items-center justify-between transition-colors group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-[#10B981] to-[#059669] rounded-full flex items-center justify-center">
                  <Wallet size={24} className="text-white" />
                </div>
                <div className="text-left">
                  <h3 className="font-bold text-lg text-[#0A0A0A]">Wallet & Assets</h3>
                  <p className="text-sm text-[#666]">
                    {isWalletConnected ? `${balance?.toFixed(2) || '0.00'} ALEO` : 'Not connected'}
                  </p>
                </div>
              </div>
              <ChevronRight size={20} className="text-[#999] group-hover:text-[#FF8C00] transition-colors" />
            </button>

            {/* Security Section */}
            <button
              onClick={() => setActiveSection('security')}
              className="w-full bg-[#FAFAFA] hover:bg-[#F0F0F0] border border-[#E5E5E5] hover:border-[#FF8C00] rounded-2xl p-6 flex items-center justify-between transition-colors group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-[#3B82F6] to-[#2563EB] rounded-full flex items-center justify-center">
                  <Shield size={24} className="text-white" />
                </div>
                <div className="text-left">
                  <h3 className="font-bold text-lg text-[#0A0A0A]">Security</h3>
                  <p className="text-sm text-[#666]">Encryption & keys</p>
                </div>
              </div>
              <ChevronRight size={20} className="text-[#999] group-hover:text-[#FF8C00] transition-colors" />
            </button>

            {/* Privacy Section */}
            <button
              onClick={() => setActiveSection('privacy')}
              className="w-full bg-[#FAFAFA] hover:bg-[#F0F0F0] border border-[#E5E5E5] hover:border-[#FF8C00] rounded-2xl p-6 flex items-center justify-between transition-colors group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-[#8B5CF6] to-[#7C3AED] rounded-full flex items-center justify-center">
                  <Lock size={24} className="text-white" />
                </div>
                <div className="text-left">
                  <h3 className="font-bold text-lg text-[#0A0A0A]">Privacy</h3>
                  <p className="text-sm text-[#666]">Control your data</p>
                </div>
              </div>
              <ChevronRight size={20} className="text-[#999] group-hover:text-[#FF8C00] transition-colors" />
            </button>
          </div>

          {/* Version Info */}
          <div className="mt-8 p-4 bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl">
            <p className="text-xs text-[#666] text-center font-mono">
              Ghost Messenger v1.0.0-beta<br/>
              Built on Aleo Blockchain
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Profile Section
  if (activeSection === 'profile') {
    return (
      <div className="flex-1 bg-white flex flex-col h-screen overflow-y-auto animate-slide-up">
        <div className="p-8 border-b border-[#E5E5E5]">
          <button
            onClick={() => setActiveSection('main')}
            className="text-[#FF8C00] font-bold mb-4 hover:underline"
          >
            ← Back
          </button>
          <h2 className="text-3xl font-bold tracking-tighter text-[#0A0A0A]">PROFILE</h2>
          <p className="text-[#666] mt-1">Manage your on-chain identity</p>
        </div>

        <div className="flex-1 p-8">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3">
              <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={20} />
              <div>
                <h4 className="font-bold text-red-900 text-sm">Error</h4>
                <p className="text-red-700 text-sm mt-1">{error}</p>
              </div>
            </div>
          )}

          <div className="max-w-2xl space-y-6">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#666] mb-2">
                Username
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-4 font-bold focus:outline-none focus:border-[#FF8C00] transition-all text-black"
                placeholder="e.g. GhostUser"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#666] mb-2">
                Bio / Status
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-4 font-medium focus:outline-none focus:border-[#FF8C00] transition-all h-32 resize-none text-black"
                placeholder="Tell others about yourself..."
              />
            </div>

            <button
              onClick={handleSaveProfile}
              disabled={isProcessing || !name || !bio}
              className="w-full bg-[#0A0A0A] text-white py-4 rounded-xl font-bold hover:bg-[#FF8C00] hover:text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  SAVING...
                </>
              ) : (
                <>
                  <Save size={20} />
                  {initialData?.username ? 'UPDATE PROFILE' : 'CREATE PROFILE'}
                </>
              )}
            </button>

            <p className="text-center text-xs text-[#666] font-mono">
              * Profile is stored off-chain on Ghost backend
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Wallet Section
  if (activeSection === 'wallet') {
    return (
      <div className="flex-1 bg-white flex flex-col h-screen overflow-y-auto animate-slide-up">
        <div className="p-8 border-b border-[#E5E5E5]">
          <button
            onClick={() => setActiveSection('main')}
            className="text-[#FF8C00] font-bold mb-4 hover:underline"
          >
            ← Back
          </button>
          <h2 className="text-3xl font-bold tracking-tighter text-[#0A0A0A]">WALLET & ASSETS</h2>
          <p className="text-[#666] mt-1">Your Aleo wallet information</p>
        </div>

        <div className="flex-1 p-8">
          {!isWalletConnected ? (
            <div className="text-center py-12">
              <div className="w-20 h-20 bg-[#FFE4BC] rounded-full flex items-center justify-center mx-auto mb-4">
                <Wallet size={40} className="text-[#FF8C00]" />
              </div>
              <h3 className="text-xl font-bold mb-2 text-[#0A0A0A]">Wallet Not Connected</h3>
              <p className="text-[#666]">Please connect your wallet to view details</p>
            </div>
          ) : (
            <div className="max-w-2xl space-y-6">
              {/* Balance Card */}
              <div className="p-8 bg-gradient-to-br from-[#0A0A0A] to-[#1A1A1A] text-white rounded-3xl shadow-2xl">
                <p className="text-[#999] uppercase text-xs font-bold mb-2">Available Balance</p>
                <div className="flex items-baseline gap-2 mb-6">
                  <h3 className="text-5xl font-mono font-bold">
                    {balance !== undefined && balance !== null ? balance.toFixed(6) : '--'}
                  </h3>
                  <span className="text-2xl text-[#FF8C00] font-bold">ALEO</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-[#2A2A2A] rounded-full w-fit">
                  <div className="w-2 h-2 bg-[#10B981] rounded-full animate-pulse" />
                  <span className="text-xs font-bold uppercase tracking-wider text-[#999]">Aleo Testnet</span>
                </div>
              </div>

              {/* Address Card */}
              <div className="p-6 bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl">
                <p className="text-[#666] uppercase text-xs font-bold mb-2">Wallet Address</p>
                <div className="flex items-center gap-3">
                  <p className="text-sm font-mono text-[#0A0A0A] break-all flex-1">
                    {publicKey}
                  </p>
                  <button
                    aria-label="Copy address"
                    onClick={handleCopyAddress}
                    className="p-2 hover:bg-[#E5E5E5] rounded-lg transition-colors shrink-0"
                  >
                    <Copy size={18} className="text-[#666]" />
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-3">
                <a
                  href={`https://testnetbeta.aleoscan.io/address/${publicKey}`}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full bg-[#FAFAFA] hover:bg-[#E5E5E5] text-[#0A0A0A] py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
                >
                  View on Explorer
                  <ExternalLink size={18} />
                </a>

                <button
                  onClick={onDisconnect}
                  className="w-full bg-white border-2 border-red-200 text-red-600 py-3 rounded-xl font-bold hover:bg-red-50 transition-all flex items-center justify-center gap-2"
                >
                  <LogOut size={18} />
                  Disconnect Wallet
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Security Section
  if (activeSection === 'security') {
    return (
      <div className="flex-1 bg-white flex flex-col h-screen overflow-y-auto animate-slide-up">
        <div className="p-8 border-b border-[#E5E5E5]">
          <button
            onClick={() => setActiveSection('main')}
            className="text-[#FF8C00] font-bold mb-4 hover:underline"
          >
            ← Back
          </button>
          <h2 className="text-3xl font-bold tracking-tighter text-[#0A0A0A]">SECURITY</h2>
          <p className="text-[#666] mt-1">Encryption and security settings</p>
        </div>

        <div className="flex-1 p-8">
          <div className="max-w-2xl space-y-4">
            <div className="p-6 bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl">
              <div className="flex items-center gap-3 mb-2">
                <Shield size={20} className="text-[#10B981]" />
                <h3 className="font-bold text-[#0A0A0A]">End-to-End Encryption</h3>
              </div>
              <p className="text-sm text-[#666]">
                All messages are encrypted with Curve25519. Only you and the recipient can read them.
              </p>
            </div>

            <div className="p-6 bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl">
              <div className="flex items-center gap-3 mb-2">
                <Lock size={20} className="text-[#3B82F6]" />
                <h3 className="font-bold text-[#0A0A0A]">Zero-Knowledge Proofs</h3>
              </div>
              <p className="text-sm text-[#666]">
                Powered by Aleo blockchain. Your identity and transactions are cryptographically verified without revealing data.
              </p>
            </div>

            <div className="p-6 bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl">
              <div className="flex items-center gap-3 mb-2">
                <Shield size={20} className="text-[#8B5CF6]" />
                <h3 className="font-bold text-[#0A0A0A]">Message Keys</h3>
              </div>
              <p className="text-sm text-[#666] mb-3">
                Your encryption keys are stored locally in your browser. They never leave your device.
              </p>
              <p className="text-xs text-[#666] font-mono">
                Key Storage: localStorage (browser-based)
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Privacy Section
  if (activeSection === 'privacy') {
    return (
      <div className="flex-1 bg-white flex flex-col h-screen overflow-y-auto animate-slide-up">
        <div className="p-8 border-b border-[#E5E5E5]">
          <button
            onClick={() => setActiveSection('main')}
            className="text-[#FF8C00] font-bold mb-4 hover:underline"
          >
            ← Back
          </button>
          <h2 className="text-3xl font-bold tracking-tighter text-[#0A0A0A]">PRIVACY</h2>
          <p className="text-[#666] mt-1">Control your data and visibility</p>
        </div>

        <div className="flex-1 p-8">
          <div className="max-w-2xl space-y-4">
            <div className="p-6 bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl flex items-center justify-between">
              <div>
                <h3 className="font-bold mb-1 text-[#0A0A0A]">Off-Chain Messaging</h3>
                <p className="text-sm text-[#666]">Messages are not stored on blockchain</p>
              </div>
              <div className="px-3 py-1 bg-[#10B981] text-white text-xs font-bold rounded-full">
                ACTIVE
              </div>
            </div>

            <div className="p-6 bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl flex items-center justify-between">
              <div>
                <h3 className="font-bold mb-1 text-[#0A0A0A]">No Server Knowledge</h3>
                <p className="text-sm text-[#666]">Server cannot decrypt your messages</p>
              </div>
              <div className="px-3 py-1 bg-[#10B981] text-white text-xs font-bold rounded-full">
                ACTIVE
              </div>
            </div>

            {/* On-Chain Transactions - Always Active */}
            <div className="p-6 bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link size={20} className="text-[#FF8C00]" />
                <div>
                  <h3 className="font-bold mb-1 text-[#0A0A0A]">On-Chain Messages</h3>
                  <p className="text-sm text-[#666]">All messages recorded on Aleo blockchain</p>
                </div>
              </div>
              <div className="px-3 py-1 bg-[#FF8C00] text-white text-xs font-bold rounded-full">
                ACTIVE
              </div>
            </div>

            <div className="p-6 bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl">
              <h3 className="font-bold mb-2 text-[#0A0A0A]">Data Collection</h3>
              <p className="text-sm text-[#666]">
                Ghost collects minimal data:
              </p>
              <ul className="text-sm text-[#666] mt-2 space-y-1 list-disc list-inside">
                <li>Wallet address (public)</li>
                <li>Profile metadata (username, bio)</li>
                <li>Message metadata (timestamps, IDs)</li>
              </ul>
              <p className="text-sm text-[#666] mt-2">
                Message content is <strong>never</strong> accessible to servers.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default SettingsView;
