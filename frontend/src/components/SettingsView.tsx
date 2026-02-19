import React, { useState, useEffect, useRef } from 'react';
import { User, Save, Loader2, AlertTriangle, Wallet, Copy, Shield, ChevronRight, LogOut, ExternalLink, Trash2, Lock, MessageSquare, Check, MessageCircle, Bell, BellOff, Eye, Camera, X, Type, Palette, Layout, CornerDownLeft, Ban, Key, Download, Upload } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { UserSettings, FontSize, ChatTheme, BubbleStyle } from '../utils/preferences-api';
import Toggle from './ui/Toggle';
import { uploadFileToIPFS } from '../utils/ipfs';
import { MAX_AVATAR_SIZE, AVATAR_ALLOWED_TYPES, IPFS_GATEWAY_URL, MAX_USERNAME_LENGTH, MAX_BIO_LENGTH } from '../constants';
import { encryptKeysWithPassphrase, decryptKeysWithPassphrase, validateKeyPair } from '../utils/crypto';
import { getCachedKeys, setCachedKeys } from '../utils/key-derivation';

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
  // Avatar
  avatarCid?: string | null;
  onAvatarUpload?: (cid: string | null) => Promise<void>;
  // Block
  blockedUsers?: string[];
  onUnblockUser?: (address: string) => void;
  // XMTP decentralized messaging status
  xmtpReady?: boolean;
  xmtpError?: string | null;
  xmtpIdentity?: string | null;
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
  onUpdateSetting,
  avatarCid,
  onAvatarUpload,
  blockedUsers = [],
  onUnblockUser,
  xmtpReady = false,
  xmtpError = null,
  xmtpIdentity = null,
}) => {
  const [activeSection, setActiveSection] = useState<Section>('main');
  const [name, setName] = useState(initialData?.username || '');
  const [bio, setBio] = useState(initialData?.bio || '');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Key backup state
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [backupLoading, setBackupLoading] = useState(false);

  const handleBackupKeys = async () => {
    if (!publicKey || backupPassphrase.length < 8) return;
    setBackupLoading(true);
    try {
      const keys = getCachedKeys(publicKey);
      if (!keys) {
        toast.error('No encryption keys found in session. Connect your wallet first.');
        return;
      }
      const backup = await encryptKeysWithPassphrase(keys, backupPassphrase);
      // Save to backend preferences
      const { safeBackendFetch } = await import('../utils/api-client');
      await safeBackendFetch(`preferences/${publicKey}`, {
        method: 'POST',
        body: { key: 'encrypted_keys', value: JSON.stringify(backup) }
      });
      toast.success('Keys backed up securely');
      setBackupPassphrase('');
    } catch (e) {
      toast.error('Backup failed');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleRestoreKeys = async () => {
    if (!publicKey || restorePassphrase.length < 8) return;
    setBackupLoading(true);
    try {
      const { safeBackendFetch } = await import('../utils/api-client');
      const { data } = await safeBackendFetch<any>(`preferences/${publicKey}`);
      const raw = data?.encrypted_keys || data?.settings?.encrypted_keys;
      if (!raw) {
        toast.error('No backup found on server');
        return;
      }
      const backup = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const keys = await decryptKeysWithPassphrase(
        backup.encrypted,
        backup.nonce,
        backup.salt,
        restorePassphrase
      );
      if (!keys) {
        toast.error('Wrong passphrase or corrupted backup');
        return;
      }
      setCachedKeys(publicKey, keys);
      toast.success('Keys restored successfully! Refresh to apply.');
      setRestorePassphrase('');
    } catch (e) {
      toast.error('Restore failed');
    } finally {
      setBackupLoading(false);
    }
  };

  useEffect(() => {
    if (initialData) {
      setName(initialData.username || '');
      setBio(initialData.bio || '');
    }
  }, [initialData]);

  const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
      toast.error('Allowed formats: JPEG, PNG, WebP, GIF');
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      toast.error(`Max avatar size: ${MAX_AVATAR_SIZE / 1024 / 1024}MB`);
      return;
    }

    setAvatarUploading(true);
    try {
      const cid = await uploadFileToIPFS(file, 'avatar');
      await onAvatarUpload?.(cid);
      toast.success('Avatar uploaded');
    } catch (err) {
      toast.error('Avatar upload failed');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setAvatarUploading(true);
    try {
      await onAvatarUpload?.(null);
      toast.success('Avatar removed');
    } catch {
      toast.error('Failed to remove avatar');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!name.trim() || !bio.trim()) {
      toast.error('Username and bio are required');
      return;
    }
    if (initialData?.username) {
      // Check if anything actually changed
      if (name.trim() === initialData.username && bio.trim() === (initialData.bio || '')) {
        toast('No changes to save', { icon: 'ℹ️' });
        return;
      }
      try {
        await onUpdateProfile(name.trim(), bio.trim());
      } catch (e: any) {
        toast.error('Failed to update profile: ' + (e?.message || 'Unknown error'));
      }
    } else {
      try {
        await onCreateProfile(name.trim(), bio.trim());
      } catch (e: any) {
        toast.error('Failed to create profile: ' + (e?.message || 'Unknown error'));
      }
    }
  };

  const handleCopyAddress = () => {
    if (publicKey) {
      navigator.clipboard.writeText(publicKey).catch(() => toast.error('Failed to copy'));
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
              { view: 'chat_settings' as Section, icon: <MessageCircle size={24} className="text-white" />, gradient: 'from-[#8B5CF6] to-[#7C3AED]', title: 'Chat Settings', subtitle: 'Theme, font size, layout' },
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

            {/* Avatar Preview & Upload */}
            <div className="flex items-center gap-4">
              <div className="relative group">
                {avatarCid ? (
                  <img
                    src={`${IPFS_GATEWAY_URL}${avatarCid}`}
                    alt="avatar"
                    className="w-16 h-16 rounded-full object-cover border-2 border-[#E5E5E5]"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold" style={{ backgroundColor: settings.avatarColor }}>
                    {name ? name.slice(0, 2).toUpperCase() : '?'}
                  </div>
                )}
                {/* Camera overlay */}
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  {avatarUploading ? (
                    <Loader2 size={20} className="text-white animate-spin" />
                  ) : (
                    <Camera size={20} className="text-white" />
                  )}
                </button>
                {/* Remove button */}
                {avatarCid && !avatarUploading && (
                  <button
                    onClick={handleRemoveAvatar}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={12} className="text-white" />
                  </button>
                )}
                <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleAvatarSelect} />
              </div>
              <div>
                <p className="font-bold text-[#0A0A0A]">{name || 'No username'}</p>
                <p className="text-sm text-[#666]">{bio || 'No bio set'}</p>
                <p className="text-xs text-[#999] mt-0.5">Hover avatar to change photo</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#666] mb-2">Username</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                maxLength={MAX_USERNAME_LENGTH}
                className="w-full bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-4 font-bold focus:outline-none focus:border-[#FF8C00] transition-all text-black"
                placeholder="e.g. GhostUser" />
              <span className="text-xs text-[#999] mt-1 block text-right">{name.length}/{MAX_USERNAME_LENGTH}</span>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#666] mb-2">Bio / Status</label>
              <textarea value={bio} onChange={(e) => setBio(e.target.value)}
                maxLength={MAX_BIO_LENGTH}
                className="w-full bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl p-4 font-medium focus:outline-none focus:border-[#FF8C00] transition-all h-24 resize-none text-black"
                placeholder="Tell others about yourself..." />
              <span className="text-xs text-[#999] mt-1 block text-right">{bio.length}/{MAX_BIO_LENGTH}</span>
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

              {/* Key Backup / Recovery */}
              <div className="pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Key size={16} className="text-[#FF8C00]" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#666]">Encryption Key Backup</h3>
                </div>
                <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl p-5 space-y-4">
                  <p className="text-xs text-[#666]">
                    Back up your encryption keys with a passphrase. If you lose access to your wallet, you can restore keys to decrypt old messages.
                  </p>

                  {/* Backup */}
                  <div>
                    <label className="block text-xs font-bold text-[#333] mb-1">Backup Keys</label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        placeholder="Enter passphrase (min 8 chars)"
                        value={backupPassphrase}
                        onChange={e => setBackupPassphrase(e.target.value)}
                        className="flex-1 bg-white border border-[#E5E5E5] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#FF8C00] text-black"
                      />
                      <button
                        onClick={handleBackupKeys}
                        disabled={backupPassphrase.length < 8 || backupLoading}
                        className="px-4 py-2 bg-[#FF8C00] text-black text-sm font-bold rounded-lg hover:bg-[#FF9F2A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                      >
                        {backupLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                        Backup
                      </button>
                    </div>
                  </div>

                  {/* Restore */}
                  <div>
                    <label className="block text-xs font-bold text-[#333] mb-1">Restore Keys</label>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        placeholder="Enter backup passphrase"
                        value={restorePassphrase}
                        onChange={e => setRestorePassphrase(e.target.value)}
                        className="flex-1 bg-white border border-[#E5E5E5] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#FF8C00] text-black"
                      />
                      <button
                        onClick={handleRestoreKeys}
                        disabled={restorePassphrase.length < 8 || backupLoading}
                        className="px-4 py-2 bg-[#0A0A0A] text-white text-sm font-bold rounded-lg hover:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
                      >
                        {backupLoading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                        Restore
                      </button>
                    </div>
                  </div>

                  <p className="text-[10px] text-[#999]">
                    Keys are encrypted with PBKDF2 (100K iterations) + NaCl secretbox. Never share your passphrase.
                  </p>
                </div>
              </div>
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
                    <span className="font-mono text-[#333] text-xs">ghost_msg_018.aleo</span>
                  </div>
                  <div className="flex justify-between text-[#666]">
                    <span>Message content</span>
                    <span className="text-[#10B981] font-medium text-xs">End-to-end encrypted</span>
                  </div>
                </div>
              </div>
            </div>

            {/* XMTP Decentralized Backup */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <MessageCircle size={16} className="text-[#6366F1]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#666]">XMTP Decentralized Backup</h3>
              </div>
              <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl p-5">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center text-[#666]">
                    <span>Status</span>
                    {xmtpReady ? (
                      <span className="flex items-center gap-1 text-[#10B981] font-medium text-xs">
                        <span className="w-1.5 h-1.5 bg-[#10B981] rounded-full inline-block" />
                        Active
                      </span>
                    ) : xmtpError === 'multi-tab' ? (
                      <span className="text-[#F59E0B] text-xs">Multi-tab (disabled)</span>
                    ) : xmtpError ? (
                      <span className="text-[#EF4444] text-xs">Error</span>
                    ) : (
                      <span className="text-[#999] text-xs">Initializing…</span>
                    )}
                  </div>
                  <div className="flex justify-between text-[#666]">
                    <span>Protocol</span>
                    <span className="font-mono text-[#333] text-xs">XMTP v3 (MLS)</span>
                  </div>
                  <div className="flex justify-between text-[#666]">
                    <span>Retention</span>
                    <span className="text-[#333] text-xs">60 days</span>
                  </div>
                  {xmtpIdentity && (
                    <div className="flex justify-between text-[#666]">
                      <span>XMTP identity</span>
                      <span className="font-mono text-[#333] text-xs">{xmtpIdentity.slice(0, 6)}…{xmtpIdentity.slice(-4)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[#666]">
                    <span>Transport</span>
                    <span className="text-[#333] text-xs">Secondary (backup)</span>
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

            {/* Blocked Users */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Ban size={16} className="text-red-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#666]">Blocked Users</h3>
              </div>
              <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl p-5">
                {blockedUsers.length === 0 ? (
                  <p className="text-sm text-[#999] text-center py-2">No blocked users</p>
                ) : (
                  <div className="space-y-2">
                    {blockedUsers.map(addr => (
                      <div key={addr} className="flex items-center justify-between py-2 border-b border-[#F0F0F0] last:border-0">
                        <span className="font-mono text-xs text-[#666] truncate max-w-[200px]" title={addr}>
                          {addr.slice(0, 12)}...{addr.slice(-6)}
                        </span>
                        <button
                          onClick={() => onUnblockUser?.(addr)}
                          className="text-xs font-bold text-[#10B981] hover:text-[#059669] px-3 py-1 border border-[#10B981]/30 rounded-lg hover:bg-[#10B981]/10 transition-colors"
                        >
                          Unblock
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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

  // ── Chat Settings ──
  if (activeSection === 'chat_settings') {
    const fontSizes: { value: FontSize; label: string; sample: string }[] = [
      { value: 'small', label: 'Small', sample: 'Aa' },
      { value: 'medium', label: 'Medium', sample: 'Aa' },
      { value: 'large', label: 'Large', sample: 'Aa' },
    ];
    const themes: { value: ChatTheme; label: string; bg: string; text: string; accent: string }[] = [
      { value: 'light', label: 'Light', bg: '#FFFFFF', text: '#0A0A0A', accent: '#FF8C00' },
      { value: 'dark', label: 'Dark', bg: '#0A0A0A', text: '#FAFAFA', accent: '#FF8C00' },
      { value: 'midnight', label: 'Midnight', bg: '#0D1117', text: '#C9D1D9', accent: '#58A6FF' },
      { value: 'aleo', label: 'Aleo', bg: '#1A0A00', text: '#FFD9B3', accent: '#FF8C00' },
    ];
    const bubbleStyles: { value: BubbleStyle; label: string }[] = [
      { value: 'rounded', label: 'Rounded' },
      { value: 'flat', label: 'Flat' },
    ];

    return (
      <div className="flex-1 bg-white flex flex-col h-screen overflow-y-auto animate-slide-up">
        <BackHeader title="CHAT SETTINGS" subtitle="Customize your chat experience" />
        <div className="flex-1 p-8">
          <div className="max-w-2xl space-y-5">

            {/* Font Size */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Type size={16} className="text-[#8B5CF6]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#666]">Font Size</h3>
              </div>
              <div className="flex gap-2">
                {fontSizes.map(fs => (
                  <button key={fs.value} onClick={() => onUpdateSetting('fontSize', fs.value)}
                    className={`flex-1 py-3 rounded-xl font-bold transition-all border-2 ${
                      settings.fontSize === fs.value
                        ? 'bg-[#FF8C00] text-black border-[#FF8C00]'
                        : 'bg-[#FAFAFA] text-[#666] border-[#E5E5E5] hover:border-[#FF8C00]'
                    }`}>
                    <span style={{ fontSize: fs.value === 'small' ? 12 : fs.value === 'medium' ? 15 : 18 }}>{fs.sample}</span>
                    <span className="block text-xs mt-0.5">{fs.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Chat Theme */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Palette size={16} className="text-[#3B82F6]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#666]">Chat Theme</h3>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {themes.map(t => (
                  <button key={t.value} onClick={() => onUpdateSetting('chatTheme', t.value)}
                    className={`p-3 rounded-xl transition-all border-2 flex items-center gap-3 ${
                      settings.chatTheme === t.value
                        ? 'border-[#FF8C00] ring-1 ring-[#FF8C00]/30'
                        : 'border-[#E5E5E5] hover:border-[#FF8C00]'
                    }`}>
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: t.bg, border: '1px solid #333' }}>
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: t.accent }} />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-sm text-[#0A0A0A]">{t.label}</p>
                      <p className="text-[10px] text-[#999]">{t.value === 'light' ? 'Clean & bright' : t.value === 'dark' ? 'Easy on the eyes' : t.value === 'midnight' ? 'Deep blue' : 'Warm orange'}</p>
                    </div>
                    {settings.chatTheme === t.value && <Check size={16} className="text-[#FF8C00] ml-auto" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Bubble Style */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <MessageCircle size={16} className="text-[#10B981]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#666]">Bubble Style</h3>
              </div>
              <div className="flex gap-2">
                {bubbleStyles.map(bs => (
                  <button key={bs.value} onClick={() => onUpdateSetting('bubbleStyle', bs.value)}
                    className={`flex-1 py-3 rounded-xl font-bold transition-all border-2 ${
                      settings.bubbleStyle === bs.value
                        ? 'bg-[#FF8C00] text-black border-[#FF8C00]'
                        : 'bg-[#FAFAFA] text-[#666] border-[#E5E5E5] hover:border-[#FF8C00]'
                    }`}>
                    {bs.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Layout & Behavior */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Layout size={16} className="text-[#F59E0B]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#666]">Layout & Input</h3>
              </div>
              <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl p-5 divide-y divide-[#E5E5E5]">
                <Toggle
                  enabled={settings.compactMode}
                  onChange={(v) => onUpdateSetting('compactMode', v)}
                  label="Compact Mode"
                  description="Reduce spacing between messages"
                />
                <Toggle
                  enabled={settings.sendOnEnter}
                  onChange={(v) => onUpdateSetting('sendOnEnter', v)}
                  label="Send on Enter"
                  description="Press Enter to send, Shift+Enter for new line"
                />
              </div>
            </div>

          </div>
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
