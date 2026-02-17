import React, { useState, useEffect } from 'react';
import { X, MessageSquare, Copy, UserPlus } from 'lucide-react';
import Avatar from './Avatar';
import { Contact } from '../types';
import { toast } from 'react-hot-toast';
import { safeBackendFetch } from '../utils/api-client';

interface ProfileViewProps {
  contact: Contact | any;
  onClose: () => void;
  onSendMessage: (contact: Contact) => void;
  onAddContact?: (address: string, name: string) => void;
  isContact?: boolean;
}

const ProfileView: React.FC<ProfileViewProps> = ({
  contact,
  onClose,
  onSendMessage,
  onAddContact,
  isContact = false
}) => {
  const [copied, setCopied] = useState(false);
  const [msgLoading, setMsgLoading] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [fetchedBio, setFetchedBio] = useState<string | null>(null);

  // Fetch real bio from backend profile if not already available
  useEffect(() => {
    const addr = contact.address || contact.id;
    if (!addr || contact.bio) return;
    safeBackendFetch<any>(`profiles/${addr}`).then(({ data }) => {
      if (data?.exists && data.profile?.bio) {
        setFetchedBio(data.profile.bio);
      }
    }).catch(() => {});
  }, [contact.address, contact.id, contact.bio]);

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(contact.address || '');
      setCopied(true);
      toast.success('Address copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const handleMessage = () => {
    setMsgLoading(true);
    setTimeout(() => {
      onSendMessage(contact);
      setMsgLoading(false);
    }, 300);
  };

  const handleAddContact = () => {
    if (!displayAddress.startsWith('aleo1')) {
      toast.error('Invalid address');
      return;
    }
    setAddLoading(true);
    setTimeout(() => {
      onAddContact?.(displayAddress, displayName);
      setAddLoading(false);
    }, 300);
  };

  const displayName = contact.name || contact.username || 'Unknown User';
  const displayBio = contact.bio || fetchedBio || '';
  const displayAddress = contact.address || '';
  const username = displayName.replace(/\s+/g, '').toLowerCase();

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[380px] overflow-hidden flex flex-col max-h-[90vh] animate-bounce-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Card with gradient border */}
        <div className="relative rounded-[28px] p-[2px] gradient-border shadow-2xl shadow-[#FF8C00]/10">
          <div className="bg-[#0A0A0A] rounded-[26px] overflow-hidden">

            {/* Header gradient area */}
            <div className="relative h-28 overflow-hidden">
              {/* Animated gradient background */}
              <div className="absolute inset-0 bg-gradient-to-br from-[#FF8C00] via-[#FF5500] to-[#FF8C00] gradient-border" />
              {/* Decorative pattern overlay */}
              <div className="absolute inset-0 opacity-10" style={{
                backgroundImage: 'radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px), radial-gradient(circle at 60% 80%, white 1px, transparent 1px)',
                backgroundSize: '60px 60px, 80px 80px, 40px 40px'
              }} />

              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center bg-black/30 hover:bg-black/50 text-white rounded-full transition-all btn-press backdrop-blur-md"
              >
                <X size={16} />
              </button>
            </div>

            {/* Avatar — overlapping the header */}
            <div className="flex flex-col items-center -mt-14 relative z-10 px-6">
              <div className="relative">
                <div className="p-[3px] rounded-2xl gradient-border shadow-lg shadow-[#FF8C00]/20">
                  <div className="bg-[#0A0A0A] p-[3px] rounded-[13px]">
                    <Avatar
                      src={`https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=1A1A1A&color=FF8C00&bold=true&format=svg`}
                      size={88}
                    />
                  </div>
                </div>
                {/* Online indicator */}
                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-[#10B981] border-[3px] border-[#0A0A0A] rounded-full" />
              </div>

              {/* Name & username */}
              <h2 className="text-xl font-bold text-white mt-3 text-center tracking-tight">{displayName}</h2>
              <p className="text-[#666] font-mono text-xs">@{username}</p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 px-6 mt-4">
              <button
                onClick={handleMessage}
                disabled={msgLoading}
                className="flex-1 bg-gradient-to-r from-[#FF8C00] to-[#FF6B00] text-black py-2.5 rounded-xl font-bold hover:shadow-lg hover:shadow-[#FF8C00]/25 transition-all flex items-center justify-center gap-2 btn-press disabled:opacity-70"
              >
                {msgLoading ? (
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                ) : (
                  <>
                    <MessageSquare size={16} />
                    Message
                  </>
                )}
              </button>
              {!isContact && onAddContact && displayAddress && (
                <button
                  onClick={handleAddContact}
                  disabled={addLoading}
                  className="flex-1 bg-[#1A1A1A] text-white py-2.5 rounded-xl font-bold hover:bg-[#2A2A2A] transition-all flex items-center justify-center gap-2 btn-press border border-[#2A2A2A] disabled:opacity-70"
                >
                  {addLoading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <UserPlus size={16} />
                      Add
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Info Cards */}
            <div className="px-4 mt-4 pb-4 space-y-1.5">

              {/* Bio */}
              {displayBio && (
                <div className="p-3.5 bg-[#111] rounded-xl border border-[#1A1A1A] hover:border-[#2A2A2A] transition-colors">
                  <p className="text-[#555] text-[10px] font-bold uppercase tracking-widest mb-1.5">Bio</p>
                  <p className="text-[#CCC] text-sm leading-relaxed">{displayBio}</p>
                </div>
              )}

              {/* Address */}
              <button
                onClick={handleCopyAddress}
                className="w-full p-3.5 bg-[#111] rounded-xl border border-[#1A1A1A] hover:border-[#FF8C00]/30 transition-all text-left group btn-press"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[#555] text-[10px] font-bold uppercase tracking-widest">Wallet Address</p>
                  <div className={`flex items-center gap-1 text-[10px] font-bold transition-all ${copied ? 'text-[#10B981]' : 'text-[#444] group-hover:text-[#FF8C00]'}`}>
                    {copied ? (
                      <><svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/></svg> Copied</>
                    ) : (
                      <><Copy size={10} /> Copy</>
                    )}
                  </div>
                </div>
                <p className="text-[#888] font-mono text-[11px] break-all leading-relaxed">{displayAddress}</p>
              </button>


            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileView;
