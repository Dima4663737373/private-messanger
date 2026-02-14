import React from 'react';
import { X, MessageSquare, Shield, Share2, Copy, MoreVertical, Bell, Image as ImageIcon, FileText } from 'lucide-react';
import Avatar from './Avatar';
import { Contact } from '../types';
import { toast } from 'react-hot-toast';

interface ProfileViewProps {
  contact: Contact | any; // Accept Contact or raw profile object
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
  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(contact.address || '');
      toast.success('Address copied to clipboard');
    } catch {
      toast.error('Failed to copy address');
    }
  };

  const displayName = contact.name || contact.username || 'Unknown User';
  const displayBio = contact.description || contact.bio || 'No bio available';
  const displayAddress = contact.address || '';
  const username = displayName.replace(/\s+/g, '').toLowerCase(); // Mock username if not real

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white border border-[#E5E5E5] w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-scale-in">
        
        {/* Header / Cover */}
        <div className="relative h-32 bg-gradient-to-r from-[#FF8C00] to-[#FF5500]">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-black/20 hover:bg-black/40 text-white rounded-full transition-colors backdrop-blur-md"
          >
            <X size={20} />
          </button>
          <div className="absolute top-4 left-4 text-white font-bold text-lg tracking-tight flex items-center gap-2">
            <Shield size={16} />
            USER PROFILE
          </div>
        </div>

        {/* Profile Info */}
        <div className="px-6 pb-6 -mt-12 flex flex-col items-center relative">
          <div className="p-1 bg-white rounded-full mb-3">
            <Avatar 
              src={`https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random&color=fff`} 
              size={100} 
            />
          </div>
          
          <h2 className="text-2xl font-bold text-[#0A0A0A] text-center">{displayName}</h2>
          <p className="text-[#999] font-mono text-sm mb-4">@{username}</p>
          
          {/* Action Buttons */}
          <div className="flex gap-3 w-full mb-6">
            <button 
              onClick={() => onSendMessage(contact)}
              className="flex-1 bg-[#0A0A0A] text-white py-3 rounded-xl font-bold hover:bg-[#FF8C00] hover:text-black transition-all flex items-center justify-center gap-2"
            >
              <MessageSquare size={18} />
              Message
            </button>
            {!isContact && onAddContact && displayAddress && (
               <button
                 onClick={() => {
                   if (!displayAddress.startsWith('aleo1')) {
                     toast.error('Invalid address');
                     return;
                   }
                   onAddContact(displayAddress, displayName);
                 }}
                 className="flex-1 bg-[#F5F5F5] text-[#0A0A0A] py-3 rounded-xl font-bold hover:bg-[#E5E5E5] transition-all"
               >
                 Add Contact
               </button>
            )}
          </div>

          {/* Details List */}
          <div className="w-full space-y-1">
            
            {/* Bio */}
            <div className="p-4 hover:bg-[#FAFAFA] rounded-xl transition-colors">
              <p className="text-[#999] text-xs font-bold uppercase tracking-wider mb-1">Bio</p>
              <p className="text-[#333] leading-relaxed">{displayBio}</p>
            </div>

            {/* Address */}
            <div 
              onClick={handleCopyAddress}
              className="p-4 hover:bg-[#FAFAFA] rounded-xl transition-colors cursor-pointer group"
            >
              <p className="text-[#999] text-xs font-bold uppercase tracking-wider mb-1 flex items-center justify-between">
                Wallet Address
                <Copy size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
              </p>
              <p className="text-[#333] font-mono text-xs break-all">{displayAddress}</p>
            </div>

            {/* Notifications (Mock) */}
            <div className="p-4 hover:bg-[#FAFAFA] rounded-xl transition-colors flex items-center justify-between cursor-pointer">
               <div>
                  <p className="text-[#333] font-medium">Notifications</p>
                  <p className="text-[#999] text-xs">On</p>
               </div>
               <div className="w-10 h-6 bg-[#10B981] rounded-full relative">
                  <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full shadow-sm" />
               </div>
            </div>

            {/* Encryption Status */}
             <div className="p-4 hover:bg-[#FAFAFA] rounded-xl transition-colors">
               <div className="flex items-center gap-2">
                  <Shield size={16} className="text-[#10B981]" />
                  <p className="text-[#333] font-medium">End-to-End Encrypted</p>
               </div>
               <p className="text-[#999] text-xs mt-1 ml-6">Messages are encrypted with Curve25519</p>
            </div>

          </div>

        </div>
      </div>
    </div>
  );
};

export default ProfileView;
