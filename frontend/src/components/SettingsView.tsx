import React, { useState, useEffect } from 'react';
import { User, Save, Loader2, AlertTriangle, Wallet, Copy, Shield, ChevronRight, LogOut, ExternalLink, Trash2, Lock, MessageSquare, Check, MessageCircle, Bell, BellOff, Eye } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { UserSettings } from '../utils/preferences-api';
import Toggle from './ui/Toggle';

interface SettingsViewProps {
  onCreateProfile: (name: string, bio: string) => Promise<void>;
  onUpdateProfile: (name: string, bio: string) => Promise<void>;
  isProcessing: boolean;
  initialData?: { username?: string; bio?: string } | null;
  error?: string | null;
  isWalletConnected: boolean;
  publicKey: string | null;
  balance?: number | null;
  onDisconnect: () => void;
  onClearAllConversations?: () => Promise<void>;
  contactCount?: number;
  // Toggleable settings from usePreferences
  settings: UserSettings;
  onUpdateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
}

type Section = 'main' | 'profile' | 'wallet' | 'privacy' | 'chat_settings' | 'notifications';

// Avatar color options
const AVATAR_COLORS = ['#FF8C00', '#EF4444', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#06B6D4'];

const SettingsView: React.FC<SettingsViewProps> = ({
  onCreateProfile,
  onUpdateProfile,
  isProcessing,
  initialData,
  error,
  isWalletConnected,
  publicKey,
  balance,
  onDisconnect,
  onClearAllConversations,
  contactCount = 0,
  settings,
  onUpdateSetting
}) => {
  const [activeSection, setActiveSection] = useState<Section>('main');
  const [name, setName] = useState(initialData?.username || '');
  const [bio, setBio] = useState(initialData?.bio || '');

  useEffect(() => {
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

  // Back button helper
  const BackHeader = ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div className="p-8 border-b border-[#E5E5E5]">
      <button onClick={() => setActiveSection('main')} className="text-[#FF8C00] font-bold mb-4 hover:underline text-sm">
        ← Back
      </button>
      <h2 className="text-3xl font-bold tracking-tighter text-[#0A0A0A]">{title}</h2>
      <p className="text-[#666] mt-1 text-sm">{subtitle}</p>
    </div>
  );

  // ── Main Menu ──
  if (activeSection === 'main') {
    return (
      <div className="flex-1 bg-white flex flex-col h-screen overflow-y-auto animate-slide-up">
        <div className="p-8">
          <h2 className="text-4xl font-bold mb-2 tracking-tighter text-[#0A0A0A]">SETTINGS</h2>
          <p className="text-[#666]">Manage your Ghost account</p>
        </div>
        <div className="flex-1 px-8 pb-8">
          <div className="space-y-2">
            {[
              { view: 'profile' as Section, icon: <User size={24} className="text-white" />, gradient: 'from-[#FF8C00] to-[#FF5500]', title: 'Profile', subtitle: initialData?.username || 'Set up your identity' },
              { view: 'wallet' as Section, icon: <Wallet size={24} className="text-white" />, gradient: 'from-[#10B981] to-[#059669]', title: 'Wallet', subtitle: isWalletConnected ? `${balance?.toFixed(2) || '0.00'} ALEO` : 'Not connected' },
              { view: 'privacy' as Section, icon: <Shield size={24} className="text-white" />, gradient: 'from-[#3B82F6] to-[#2563EB]', title: 'Privacy & Security', subtitle: 'Online status, read receipts, encryption' },
              { view: 'chat_settings' as Section, icon: <MessageCircle size={24} className="text-white" />, gradient: 'from-[#8B5CF6] to-[#7C3AED]', title: 'Chat Settings', subtitle: 'Coming soon' },
              { view: 'notifications' as Section, icon: <Bell size={24} className="text-white" />, gradient: 'from-[#F59E0B] to-[#D97706]', title: 'Notifications', subtitle: 'Sound, alerts, browser' },
            ].map(item => (
              <button key={item.view} onClick={() => setActiveSection(item.view)}
                className="w-full bg-[#FAFAFA] hover:bg-[#F0F0F0] border border-[#E5E5E5] hover:border-[#FF8C00] rounded-2xl p-5 flex items-center justify-between transition-colors group">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 bg-gradient-to-br ${item.gradient} rounded-full flex items-center justify-center`}>{item.icon}</div>
                  <div className="text-left">
                    <h3 className="font-bold text-[#0A0A0A]">{item.title}</h3>
                    <p className="text-sm text-[#666]">{item.subtitle}</p>
                  </div>
                </div>
                <ChevronRight size={20} className="text-[#999] group-hover:text-[#FF8C00] transition-colors" />
              </button>
            ))}
          </div>
          <div className="mt-8 text-center">
            <p className="text-xs text-[#999] font-mono">Ghost v1.0.0-beta · Aleo Testnet</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Profile Section ──
  if (activeSection === 'profile') {
    return (
      <div className="flex-1 bg-white flex flex-col h-screen overflow-y-auto animate-slide-up">
        <BackHeader title="PROFILE" subtitle="Your on-chain identity" />
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
            {/* Avatar Color Picker */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#666] mb-3">Avatar Color</label>
              <div className="flex gap-3 flex-wrap">
                {AVATAR_COLORS.map(color => (
                  <button key={color} onClick={() => onUpdateSetting('avatarColor', color)}
                    className={`w-10 h-10 rounded-full transition-all ${settings.avatarColor === color ? 'ring-2 ring-offset-2 ring-[#FF8C00] scale-110' : 'hover:scale-105'}`}
                    style={{ backgroundColor: color }}>
                    {settings.avatarColor === color && <Check size={16} className="text-white mx-auto" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Avatar Preview */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold" style={{ backgroundColor: settings.avatarColor }}>
                {name ? name.slice(0, 2).toUpperCase() : '?'}
              </div>
              <div>
                <p className="font-bold text-[#0A0A0A]">{name || 'No username'}</p>
                <p className="text-sm text-[#666]">{bio || 'No bio set'}</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#666] mb-2">Username</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-4 font-bold focus:outline-none focus:border-[#FF8C00] transition-all text-black"
                placeholder="e.g. GhostUser" />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#666] mb-2">Bio / Status</label>
              <textarea value={bio} onChange={(e) => setBio(e.target.value)}
                className="w-full bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-4 font-medium focus:outline-none focus:border-[#FF8C00] transition-all h-24 resize-none text-black"
                placeholder="Tell others about yourself..." />
            </div>

            {/* Wallet address (read-only) */}
            {publicKey && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#666] mb-2">Wallet Address</label>
                <div className="flex items-center gap-2 bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-4">
                  <p className="text-sm font-mono text-[#333] break-all flex-1">{publicKey}</p>
                  <button onClick={handleCopyAddress} className="p-1.5 hover:bg-[#E5E5E5] rounded-lg transition-colors shrink-0">
                    <Copy size={16} className="text-[#666]" />
                  </button>
                </div>
              </div>
            )}

            <button onClick={handleSaveProfile} disabled={isProcessing || !name || !bio}
              className="w-full bg-[#0A0A0A] text-white py-4 rounded-xl font-bold hover:bg-[#FF8C00] hover:text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {isProcessing ? (<><Loader2 className="animate-spin" size={20} /> SAVING...</>) : (<><Save size={20} /> {initialData?.username ? 'UPDATE PROFILE' : 'CREATE PROFILE'}</>)}
            </button>
            <p className="text-center text-xs text-[#999]">Requires wallet transaction signature</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Wallet Section ──
  if (activeSection === 'wallet') {
    return (
      <div className="flex-1 bg-white flex flex-col h-screen overflow-y-auto animate-slide-up">
        <BackHeader title="WALLET" subtitle="Your Aleo wallet" />
        <div className="flex-1 p-8">
          {!isWalletConnected ? (
            <div className="text-center py-12">
              <div className="w-20 h-20 bg-[#FFE4BC] rounded-full flex items-center justify-center mx-auto mb-4">
                <Wallet size={40} className="text-[#FF8C00]" />
              </div>
              <h3 className="text-xl font-bold mb-2 text-[#0A0A0A]">Wallet Not Connected</h3>
              <p className="text-[#666]">Connect your wallet to view details</p>
            </div>
          ) : (
            <div className="max-w-2xl space-y-6">
              <div className="p-8 bg-gradient-to-br from-[#0A0A0A] to-[#1A1A1A] text-white rounded-3xl shadow-2xl">
                <p className="text-[#999] uppercase text-xs font-bold mb-2">Balance</p>
                <div className="flex items-baseline gap-2 mb-4">
                  <h3 className="text-4xl font-mono font-bold">{balance !== undefined && balance !== null ? balance.toFixed(6) : '--'}</h3>
                  <span className="text-xl text-[#FF8C00] font-bold">ALEO</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-[#2A2A2A] rounded-full w-fit">
                  <div className="w-2 h-2 bg-[#10B981] rounded-full animate-pulse" />
                  <span className="text-xs font-bold uppercase tracking-wider text-[#999]">Testnet</span>
                </div>
              </div>

              <div className="p-5 bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl">
                <p className="text-[#666] uppercase text-xs font-bold mb-2">Address</p>
                <div className="flex items-center gap-3">
                  <p className="text-sm font-mono text-[#0A0A0A] break-all flex-1">{publicKey}</p>
                  <button onClick={handleCopyAddress} className="p-2 hover:bg-[#E5E5E5] rounded-lg transition-colors shrink-0">
                    <Copy size={18} className="text-[#666]" />
                  </button>
                </div>
              </div>

              <a href={`https://testnetbeta.aleoscan.io/address/${publicKey}`} target="_blank" rel="noreferrer"
                className="w-full bg-[#FAFAFA] hover:bg-[#E5E5E5] text-[#0A0A0A] py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2">
                View on Explorer <ExternalLink size={16} />
              </a>

              <button onClick={onDisconnect}
                className="w-full bg-white border-2 border-red-200 text-red-600 py-3 rounded-xl font-bold hover:bg-red-50 transition-all flex items-center justify-center gap-2">
                <LogOut size={18} /> Disconnect Wallet
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Privacy Section ──
  if (activeSection === 'privacy') {
    return (
      <div className="flex-1 bg-white flex flex-col h-screen overflow-y-auto animate-slide-up">
        <BackHeader title="PRIVACY & SECURITY" subtitle="Control what others see" />
        <div className="flex-1 p-8">
          <div className="max-w-2xl space-y-5">

            {/* Visibility */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Eye size={16} className="text-[#3B82F6]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#666]">Visibility</h3>
              </div>
              <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl p-5 divide-y divide-[#E5E5E5]">
                <Toggle
                  enabled={settings.showOnlineStatus}
                  onChange={(v) => onUpdateSetting('showOnlineStatus', v)}
                  label="Online Status"
                  description="Show the green dot when you're active"
                />
                <Toggle
                  enabled={settings.showLastSeen}
                  onChange={(v) => onUpdateSetting('showLastSeen', v)}
                  label="Last Seen"
                  description="Let others see when you were last online"
                />
                <Toggle
                  enabled={settings.showProfilePhoto}
                  onChange={(v) => onUpdateSetting('showProfilePhoto', v)}
                  label="Profile Photo"
                  description="Make your avatar visible to everyone"
                />
              </div>
            </div>

            {/* Messages */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare size={16} className="text-[#8B5CF6]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#666]">Messages</h3>
              </div>
              <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl p-5 divide-y divide-[#E5E5E5]">
                <Toggle
                  enabled={settings.typingIndicators}
                  onChange={(v) => onUpdateSetting('typingIndicators', v)}
                  label="Typing Indicators"
                  description="Let others see when you're typing"
                />
                <Toggle
                  enabled={settings.readReceipts}
                  onChange={(v) => onUpdateSetting('readReceipts', v)}
                  label="Read Receipts"
                  description="Send read status to message sender"
                />
                <Toggle
                  enabled={settings.linkPreview}
                  onChange={(v) => onUpdateSetting('linkPreview', v)}
                  label="Link Previews"
                  description="Generate previews for URLs in messages"
                />
              </div>
            </div>

            {/* Encryption & Blockchain (read-only info) */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Lock size={16} className="text-[#10B981]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#666]">Encryption</h3>
              </div>
              <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl p-5">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-[#666]">
                    <span>Algorithm</span>
                    <span className="font-mono text-[#333] text-xs">NaCl Curve25519 + Salsa20/Poly1305</span>
                  </div>
                  <div className="flex justify-between text-[#666]">
                    <span>Key storage</span>
                    <span className="text-[#333] text-xs">Server-side (encrypted)</span>
                  </div>
                  <div className="flex justify-between text-[#666]">
                    <span>Address hashing</span>
                    <span className="font-mono text-[#333] text-xs">BHP256</span>
                  </div>
                  <div className="flex justify-between text-[#666]">
                    <span>Program</span>
                    <span className="font-mono text-[#333] text-xs">ghost_msg_015.aleo</span>
                  </div>
                  <div className="flex justify-between text-[#666]">
                    <span>Message content</span>
                    <span className="text-[#10B981] font-medium text-xs">End-to-end encrypted</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Data Summary */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Shield size={16} className="text-[#F59E0B]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#666]">Your Data</h3>
              </div>
              <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl p-5">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-[#666]">
                    <span>Active conversations</span>
                    <span className="font-mono text-[#333]">{contactCount}</span>
                  </div>
                  <div className="flex justify-between text-[#666]">
                    <span>Server knows</span>
                    <span className="text-[#333] text-xs">Address, profile, metadata</span>
                  </div>
                  <div className="flex justify-between text-[#666]">
                    <span>Server cannot access</span>
                    <span className="text-[#10B981] font-medium text-xs">Message content</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Danger Zone */}
            {onClearAllConversations && (
              <div className="pt-2 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#999]">Danger Zone</h3>
                <button onClick={async () => {
                  if (!confirm('Clear ALL conversations? This requires wallet approval and cannot be undone.')) return;
                  await onClearAllConversations();
                }} className="w-full p-4 bg-white border-2 border-red-200 text-red-600 rounded-xl font-bold hover:bg-red-50 transition-colors flex items-center justify-center gap-2">
                  <Trash2 size={18} /> Clear All Conversations
                </button>
                <p className="text-xs text-[#999] text-center">Requires wallet transaction signature.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Chat Settings (Coming Soon) ──
  if (activeSection === 'chat_settings') {
    return (
      <div className="flex-1 bg-white flex flex-col h-screen overflow-y-auto animate-slide-up">
        <BackHeader title="CHAT SETTINGS" subtitle="Customize your chat experience" />
        <div className="flex-1 p-8 flex flex-col items-center justify-center">
          <div className="w-20 h-20 bg-[#F5F0FF] rounded-full flex items-center justify-center mb-4">
            <MessageCircle size={36} className="text-[#8B5CF6]/50" />
          </div>
          <h3 className="text-xl font-bold text-[#0A0A0A] mb-2">Coming Soon</h3>
          <p className="text-[#666] text-center max-w-sm">
            Chat themes, font size, message grouping, and more customization options are on the way.
          </p>
        </div>
      </div>
    );
  }

  // ── Notifications Section ──
  if (activeSection === 'notifications') {
    const browserPerm = typeof Notification !== 'undefined' ? Notification.permission : 'default';
    const isGranted = browserPerm === 'granted';
    const isDenied = browserPerm === 'denied';

    const handleRequestBrowserPermission = async () => {
      if (!('Notification' in window)) {
        toast.error('Notifications not supported in this browser');
        return;
      }
      if (Notification.permission === 'granted') {
        toast('Already enabled', { icon: 'ℹ️' });
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        toast.success('Browser notifications enabled');
        new Notification('Ghost Messenger', { body: 'Notifications are now active', icon: '/ghost-icon.png' });
      } else if (permission === 'denied') {
        toast.error('Blocked by browser. Enable in browser settings.');
      }
    };

    return (
      <div className="flex-1 bg-white flex flex-col h-screen overflow-y-auto animate-slide-up">
        <BackHeader title="NOTIFICATIONS" subtitle="Sound, alerts and browser permissions" />
        <div className="flex-1 p-8">
          <div className="max-w-2xl space-y-4">
            {/* Browser Permission Card */}
            <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  {isGranted ? <Bell size={20} className="text-[#FF8C00]" /> : <BellOff size={20} className="text-[#999]" />}
                  <h3 className="font-bold text-[#0A0A0A]">Browser Notifications</h3>
                </div>
                {!isGranted && !isDenied && (
                  <button onClick={handleRequestBrowserPermission}
                    className="px-4 py-1.5 bg-[#FF8C00] text-black text-sm font-bold rounded-lg hover:bg-[#FF9F2A] transition-colors">
                    Enable
                  </button>
                )}
                {isGranted && (
                  <span className="px-3 py-1 bg-[#10B981] text-white text-xs font-bold rounded-full">ON</span>
                )}
                {isDenied && (
                  <span className="px-3 py-1 bg-red-500 text-white text-xs font-bold rounded-full">BLOCKED</span>
                )}
              </div>
              {isDenied && (
                <p className="text-xs text-red-500">Blocked by browser. Go to browser settings to allow notifications for this site.</p>
              )}
              {isGranted && (
                <p className="text-xs text-[#666]">You will receive browser alerts for new messages when the tab is in background.</p>
              )}
              {!isGranted && !isDenied && (
                <p className="text-xs text-[#666]">Enable browser notifications to get alerts for new messages.</p>
              )}
            </div>

            {/* App Notification Toggles */}
            <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl p-5 divide-y divide-[#E5E5E5]">
              <Toggle
                enabled={settings.notifEnabled}
                onChange={(v) => {
                  onUpdateSetting('notifEnabled', v);
                  toast.success(v ? 'Notifications enabled' : 'Notifications muted');
                }}
                label="Enable Notifications"
                description="Master toggle for all message notifications"
              />
              <Toggle
                enabled={settings.notifSound}
                onChange={(v) => {
                  onUpdateSetting('notifSound', v);
                  toast.success(v ? 'Sound enabled' : 'Sound muted');
                }}
                label="Notification Sound"
                description="Play a sound when a new message arrives"
              />
              <Toggle
                enabled={settings.notifPreview}
                onChange={(v) => {
                  onUpdateSetting('notifPreview', v);
                  toast.success(v ? 'Preview enabled' : 'Preview hidden');
                }}
                label="Message Preview"
                description="Show message text in notifications"
              />
            </div>

            {/* Info */}
            <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl p-5">
              <h3 className="font-bold text-[#0A0A0A] text-sm mb-2">Per-chat muting</h3>
              <p className="text-sm text-[#666]">
                You can mute individual conversations from the sidebar — right-click a chat and select "Mute".
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
