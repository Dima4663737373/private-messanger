
import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Search, MoreVertical, Paperclip, Send, Smile, Menu, Ghost, Shield, MessageSquare, Trash2, Edit2, X, Check, File as FileIcon, Download, Reply, Timer, Clock, Pin, Copy, Users, LogOut, Share2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Chat, Message, DisappearTimer, DISAPPEAR_TIMERS, Room, AppView } from '../types';
import { logger } from '../utils/logger';
import Avatar from './Avatar';
import { MessageStatus } from './ui/MessageStatus';
import { MessageSkeleton } from './ui/Skeleton';
import { EmptyState } from './ui/EmptyState';
import { toast } from 'react-hot-toast';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const GENERIC_AVATAR = 'https://ui-avatars.com/api/?name=?&background=888&color=fff';
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;

// Inline link preview card component
const previewCache = new Map<string, { title: string | null; description: string | null; image: string | null; siteName: string | null }>();

const LinkPreviewCard: React.FC<{
  url: string;
  fetchPreview: (url: string) => Promise<{ title: string | null; description: string | null; image: string | null; siteName: string | null }>;
}> = ({ url, fetchPreview }) => {
  const [preview, setPreview] = useState<{ title: string | null; description: string | null; image: string | null; siteName: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const cached = previewCache.get(url);
    if (cached) { setPreview(cached); setLoading(false); return; }
    fetchPreview(url).then(data => {
      if (cancelled) return;
      previewCache.set(url, data);
      setPreview(data);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url, fetchPreview]);

  if (loading) return (
    <div className="mt-2 rounded-lg border border-[#E5E5E5] bg-white/80 p-3 animate-pulse">
      <div className="h-3 bg-[#E5E5E5] rounded w-2/3 mb-2" />
      <div className="h-2 bg-[#E5E5E5] rounded w-full" />
    </div>
  );

  if (!preview || (!preview.title && !preview.description)) return null;

  const domain = (() => { try { return new URL(url).hostname; } catch { return url; } })();

  return (
    <a href={url} target="_blank" rel="noreferrer" className="block mt-2 rounded-lg border border-[#E5E5E5] bg-white overflow-hidden hover:border-[#FF8C00] transition-colors no-underline">
      <div className="flex">
        {preview.image && (
          <div className="w-20 h-20 shrink-0 bg-[#F5F5F5]">
            <img src={preview.image} alt="" className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
          </div>
        )}
        <div className="p-2.5 min-w-0 flex-1">
          {preview.title && <p className="text-xs font-bold text-[#0A0A0A] truncate">{preview.title}</p>}
          {preview.description && <p className="text-[11px] text-[#666] line-clamp-2 mt-0.5">{preview.description}</p>}
          <p className="text-[10px] text-[#999] font-mono mt-1">{preview.siteName || domain}</p>
        </div>
      </div>
    </a>
  );
};

interface ChatAreaProps {
  chatId: string | null;
  onToggleSidebar: () => void;
  activeChat: Chat | undefined;
  messages: Message[];
  currentUserId: string;
  currentView?: AppView;
  onSendMessage: (text: string, file?: File, replyTo?: { id: string; text: string; sender: string }) => void;
  onLoadMore?: () => void;
  isLoading?: boolean;
  isSending?: boolean;
  isTyping?: boolean;
  onTyping?: () => void;
  onViewProfile?: (chat: Chat) => void;
  onReact?: (messageId: string, emoji: string) => void;
  onRemoveReaction?: (messageId: string, emoji: string) => void;
  disappearTimer?: DisappearTimer;
  onSetDisappearTimer?: (timer: DisappearTimer) => void;
  roomChat?: Room;
  onDeleteRoom?: () => void;
  onLeaveRoom?: () => void;
  onClearDM?: () => void;
  onDeleteChat?: () => void;
  pinnedMessages?: any[];
  onPinMessage?: (msgId: string, msgText: string) => void;
  onUnpinMessage?: (msgId: string) => void;
  onDeleteRoomMessage?: (msgId: string) => void;
  onEditRoomMessage?: (msgId: string, newText: string) => void;
  onDeleteDMMessage?: (msgId: string) => void;
  onEditDMMessage?: (msgId: string, newText: string) => void;
  roomMembers?: string[];
  memberNames?: Record<string, string>;
  contactOnline?: boolean;
  contactLastSeen?: number | null;
  contactHideAvatar?: boolean;
  linkPreviews?: boolean;
  fetchLinkPreview?: (url: string) => Promise<{ title: string | null; description: string | null; image: string | null; siteName: string | null }>;
  onJoinRoom?: () => void;
}

const ChatArea: React.FC<ChatAreaProps> = ({
  chatId,
  onToggleSidebar,
  activeChat,
  messages,
  currentUserId,
  currentView = 'chats',
  onSendMessage,
  onLoadMore,
  isLoading = false,
  isSending = false,
  isTyping = false,
  onTyping,
  onViewProfile,
  onReact,
  onRemoveReaction,
  disappearTimer = 'off',
  onSetDisappearTimer,
  roomChat,
  onDeleteRoom,
  onLeaveRoom,
  onClearDM,
  onDeleteChat,
  pinnedMessages = [],
  onPinMessage,
  onUnpinMessage,
  onDeleteRoomMessage,
  onEditRoomMessage,
  onDeleteDMMessage,
  onEditDMMessage,
  roomMembers = [],
  memberNames = {},
  contactOnline,
  contactLastSeen,
  contactHideAvatar,
  linkPreviews = true,
  fetchLinkPreview,
  onJoinRoom
}) => {
  const [input, setInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const [prevScrollHeight, setPrevScrollHeight] = useState(0);

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // Helper: resolve address to display name
  const resolveName = (addr: string) =>
    addr === currentUserId ? 'You' : (memberNames[addr] || `${addr.slice(0, 10)}...${addr.slice(-6)}`);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Reply state
  const [replyingTo, setReplyingTo] = useState<{ id: string; text: string; sender: string } | null>(null);

  // Emoji picker state
  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState<string | null>(null);

  // Room info panel
  const [showRoomInfo, setShowRoomInfo] = useState(false);

  // Chat search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIds, setSearchMatchIds] = useState<string[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Clear edit/reply state and menu when switching chats
  useEffect(() => {
    setEditingMessageId(null);
    setEditContent('');
    setIsMenuOpen(false);
    setReplyingTo(null);
    setEmojiPickerMsgId(null);
    setShowRoomInfo(false);
    setIsSearchOpen(false);
    setSearchQuery('');
    setSearchMatchIds([]);
  }, [chatId]);

  // Update search matches when query changes
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchMatchIds([]);
      setSearchIndex(0);
      return;
    }
    const q = searchQuery.toLowerCase();
    const matches = messages
      .filter(m => m.text.toLowerCase().includes(q))
      .map(m => m.id);
    setSearchMatchIds(matches);
    setSearchIndex(matches.length > 0 ? matches.length - 1 : 0);
  }, [searchQuery, messages]);

  // Scroll to current search match
  useEffect(() => {
    if (searchMatchIds.length > 0 && searchMatchIds[searchIndex]) {
      const el = document.getElementById(`msg-${searchMatchIds[searchIndex]}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [searchIndex, searchMatchIds]);

  // Render message text with clickable URLs and optional search highlighting
  const renderMessageText = (text: string, isSearchMatch: boolean) => {
    // Split text by URLs
    const urlParts = text.split(URL_REGEX);
    const urls = text.match(URL_REGEX) || [];
    if (urls.length === 0) {
      // No URLs — just highlight search if needed
      if (!isSearchMatch || !searchQuery.trim()) return text;
      const q = searchQuery.trim();
      const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      const parts = text.split(regex);
      if (parts.length === 1) return text;
      return parts.map((part, i) =>
        regex.test(part)
          ? <mark key={i} className="bg-[#FF8C00]/40 text-inherit rounded-sm px-0.5">{part}</mark>
          : part
      );
    }
    // Interleave text parts and URL links
    const elements: React.ReactNode[] = [];
    urlParts.forEach((part, i) => {
      if (part) elements.push(<React.Fragment key={`t${i}`}>{part}</React.Fragment>);
      if (i < urls.length) {
        elements.push(
          <a key={`u${i}`} href={urls[i]} target="_blank" rel="noreferrer" className="text-[#3B82F6] underline break-all hover:text-[#2563EB]">
            {urls[i]}
          </a>
        );
      }
    });
    return <>{elements}</>;
  };

  // Extract first URL from message text
  const extractFirstUrl = (text: string): string | null => {
    const match = text.match(URL_REGEX);
    return match ? match[0] : null;
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-scroll to bottom on new messages (if sent by me or at bottom)
  useEffect(() => {
    if (scrollRef.current && !prevScrollHeight) {
       // Only scroll to bottom if we are NOT restoring scroll position
       scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, prevScrollHeight]);

  // Infinite Scroll Observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && onLoadMore && !isLoading && messages.length >= 20) {
             // Capture current height before loading more
             if (scrollRef.current) {
                 setPrevScrollHeight(scrollRef.current.scrollHeight);
             }
             onLoadMore();
        }
      },
      { threshold: 0.1, root: scrollRef.current }
    );

    if (topSentinelRef.current) {
      observer.observe(topSentinelRef.current);
    }

    return () => observer.disconnect();
  }, [onLoadMore, isLoading, messages.length]);

  // Restore scroll position after loading older messages
  useLayoutEffect(() => {
    if (scrollRef.current && prevScrollHeight > 0) {
      const newScrollHeight = scrollRef.current.scrollHeight;
      const heightDifference = newScrollHeight - prevScrollHeight;
      if (heightDifference > 0) {
        scrollRef.current.scrollTop = heightDifference;
      }
      setPrevScrollHeight(0);
    }
  }, [messages, prevScrollHeight]);

  const handleSend = () => {
    if ((!input.trim() && !selectedFile) || !chatId) return;
    onSendMessage(input, selectedFile || undefined, replyingTo || undefined);
    setInput('');
    setSelectedFile(null);
    setReplyingTo(null);
  };

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
        e.target.value = '';
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDelete = async (msg: Message) => {
      if (roomChat && onDeleteRoomMessage) {
          if (confirm("Delete this message?")) {
              onDeleteRoomMessage(msg.id);
              // Clear reply-in-progress if replying to deleted message
              if (replyingTo?.id === msg.id) setReplyingTo(null);
              // Auto-unpin if pinned
              if (onUnpinMessage && pinnedMessages.some((p: any) => p.message_id === msg.id)) {
                onUnpinMessage(msg.id);
              }
          }
          return;
      }
      // Off-chain DM delete
      if (onDeleteDMMessage) {
          if (confirm("Are you sure you want to delete this message?")) {
              try {
                  await onDeleteDMMessage(msg.id);
                  // Clear reply-in-progress if replying to deleted message
                  if (replyingTo?.id === msg.id) setReplyingTo(null);
                  // Auto-unpin if pinned
                  if (onUnpinMessage && pinnedMessages.some((p: any) => p.message_id === msg.id)) {
                    onUnpinMessage(msg.id);
                  }
              } catch (e: any) {
                  toast.error("Failed to delete: " + e.message);
              }
          }
          return;
      }
  };

  const handleEdit = (msg: Message) => {
      setEditingMessageId(msg.id);
      setEditContent(msg.text);
  };

  const submitEdit = async (msg: Message) => {
      if (roomChat && onEditRoomMessage) {
          onEditRoomMessage(msg.id, editContent);
          setEditingMessageId(null);
          return;
      }
      // Off-chain DM edit
      if (onEditDMMessage) {
          try {
              await onEditDMMessage(msg.id, editContent);
              setEditingMessageId(null);
              toast.success("Message edited");
          } catch (e: any) {
              toast.error("Failed to edit: " + e.message);
          }
          return;
      }
  };

  const cancelEdit = () => {
      setEditingMessageId(null);
      setEditContent('');
  };

  if (!chatId || !activeChat) {
    // Different empty states for different views
    const emptyStates = {
      chats: {
        title: 'GHOST ENCRYPTION',
        description: 'Your messages are protected by spectral end-to-end encryption. Select a contact to initiate handshake.',
        icon: Shield
      },
      channels: {
        title: 'NO CHANNEL SELECTED',
        description: 'Select a channel from the sidebar or create a new one to start broadcasting.',
        icon: MessageSquare
      },
      groups: {
        title: 'NO GROUP SELECTED',
        description: 'Select a private group from the sidebar or create a new one to start chatting.',
        icon: MessageSquare
      },
      contacts: {
        title: 'GHOST ENCRYPTION',
        description: 'Your messages are protected by spectral end-to-end encryption.',
        icon: Shield
      },
      settings: {
        title: 'GHOST ENCRYPTION',
        description: 'Your messages are protected by spectral end-to-end encryption.',
        icon: Shield
      }
    };

    const state = emptyStates[currentView] || emptyStates.chats;
    const IconComponent = state.icon;

    return (
      <div className="flex-1 bg-[#FAFAFA] flex flex-col items-center justify-center p-8 text-center relative">
        <div className="absolute top-0 right-0 p-8 opacity-5 select-none pointer-events-none">
           <Ghost size={400} />
        </div>
        <button onClick={onToggleSidebar} className="lg:hidden absolute top-5 left-5 p-3 bg-black rounded-xl text-[#FF8C00]">
          <Menu size={24} />
        </button>
        <div className="w-24 h-24 bg-white border border-[#E5E5E5] rounded-[32px] flex items-center justify-center mb-8 shadow-xl">
          <IconComponent size={48} className="text-[#FF8C00]" />
        </div>
        <h2 className="text-[#0A0A0A] text-3xl font-bold mb-3 tracking-tight italic">{state.title}</h2>
        <p className="text-[#666] max-w-sm text-lg font-light leading-relaxed">
          {state.description}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[#FAFAFA] flex flex-col relative h-screen overflow-hidden">
      {/* Chat Header */}
      <header className="px-8 py-5 border-b border-[#E5E5E5] bg-white flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          <button onClick={onToggleSidebar} className="lg:hidden p-2 hover:bg-[#F5F5F5] rounded-lg mr-2">
            <Menu size={20} className="text-[#666]" />
          </button>
          {roomChat ? (
            <div className="w-12 h-12 bg-[#0A0A0A] rounded-xl flex items-center justify-center">
              <MessageSquare size={22} className="text-[#FF8C00]" />
            </div>
          ) : (
            <Avatar src={contactHideAvatar ? GENERIC_AVATAR : activeChat.avatar} status={activeChat.status} size={48} />
          )}
          <div
            onClick={() => !roomChat && onViewProfile && onViewProfile(activeChat)}
            className={`${!roomChat ? 'cursor-pointer hover:opacity-70' : ''} transition-opacity`}
          >
            <h2 className="text-[#0A0A0A] text-lg font-bold flex items-center gap-2">
              {roomChat ? `# ${roomChat.name}` : activeChat.name}
              {!roomChat && contactOnline && <span className="w-2 h-2 bg-[#10B981] rounded-full animate-pulse" />}
            </h2>
            <p className="text-[#666] text-xs font-mono tracking-tighter uppercase">
              {roomChat
                ? `${roomChat.type.toUpperCase()} · ${roomChat.memberCount || 0} members`
                : contactOnline
                  ? 'Online'
                  : contactLastSeen
                    ? `Last seen ${timeAgo(contactLastSeen)}`
                    : activeChat.address
                      ? `${activeChat.address.slice(0, 14)}...${activeChat.address.slice(-6)}`
                      : activeChat.id}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 relative">
          <button
            aria-label="Search messages"
            onClick={() => { setIsSearchOpen(!isSearchOpen); if (!isSearchOpen) setTimeout(() => searchInputRef.current?.focus(), 100); }}
            className={`w-10 h-10 flex items-center justify-center border rounded-xl transition-colors ${isSearchOpen ? 'border-[#FF8C00] text-[#FF8C00] bg-[#FFF3E0]' : 'border-[#E5E5E5] text-[#666] hover:text-[#FF8C00]'}`}
          >
            <Search size={18} />
          </button>
          <button
            aria-label="Chat menu"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="w-10 h-10 flex items-center justify-center border border-[#E5E5E5] rounded-xl text-[#666] hover:text-[#FF8C00] transition-colors"
          >
            <MoreVertical size={18} />
          </button>

          {/* 3-Dots Menu Dropdown */}
          {isMenuOpen && (
            <div
              ref={menuRef}
              className="absolute top-12 right-0 w-52 bg-white border border-[#E5E5E5] rounded-xl shadow-xl z-50 overflow-hidden animate-fade-in"
            >
                {/* DM: View Profile */}
                {!roomChat && onViewProfile && (
                  <button onClick={() => { setIsMenuOpen(false); onViewProfile(activeChat); }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAFA] text-sm font-medium text-[#333]">
                    <Users size={16} className="text-[#888]" /> View Profile
                  </button>
                )}

                {/* Room: Info header */}
                {roomChat && (
                  <>
                    <button
                      onClick={() => { setIsMenuOpen(false); setShowRoomInfo(true); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAFA] text-sm font-medium text-[#333]"
                    >
                      <Users size={16} className="text-[#888]" />
                      Members ({roomChat.memberCount || roomMembers.length})
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(roomChat.id);
                        toast.success('Room ID copied — share it so others can join');
                        setIsMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAFA] text-sm font-medium text-[#333]"
                    >
                      <Share2 size={16} className="text-[#888]" /> Share Room ID
                    </button>
                  </>
                )}

                {/* DM: Disappearing Messages */}
                {!roomChat && onSetDisappearTimer && (
                  <div className="px-4 py-2 border-t border-[#F0F0F0]">
                    <p className="text-[10px] font-bold text-[#999] uppercase tracking-wider mb-1 flex items-center gap-1"><Timer size={10} /> Disappearing</p>
                    <div className="flex gap-1 flex-wrap">
                      {(['off', '30s', '5m', '1h', '24h'] as DisappearTimer[]).map(t => (
                        <button
                          key={t}
                          onClick={() => { onSetDisappearTimer(t); setIsMenuOpen(false); }}
                          className={`px-2 py-1 text-xs rounded-md transition-colors ${disappearTimer === t ? 'bg-[#FF8C00] text-white' : 'bg-[#F5F5F5] text-[#666] hover:bg-[#E5E5E5]'}`}
                        >
                          {t === 'off' ? 'Off' : t}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* DM: Clear History */}
                {!roomChat && onClearDM && (
                  <button
                    onClick={() => { setIsMenuOpen(false); if (confirm('Clear all messages in this chat?')) onClearDM(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAFA] text-sm font-medium text-[#333] border-t border-[#F0F0F0]"
                  >
                    <Trash2 size={16} className="text-[#888]" /> Clear History
                  </button>
                )}

                {/* Room: Leave */}
                {roomChat && onLeaveRoom && (
                  <button
                    onClick={() => { setIsMenuOpen(false); if (confirm(`Leave #${roomChat.name}?`)) onLeaveRoom(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAFA] text-sm font-medium text-[#333] border-t border-[#F0F0F0]"
                  >
                    <LogOut size={16} className="text-[#888]" /> Leave {roomChat.type === 'channel' ? 'Channel' : 'Group'}
                  </button>
                )}

                {/* Room: Delete (creator only) */}
                {roomChat && onDeleteRoom && (
                  <button
                    onClick={() => { setIsMenuOpen(false); if (confirm(`Delete #${roomChat.name}? This cannot be undone.`)) onDeleteRoom(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-50 text-sm font-medium text-red-500 border-t border-[#F0F0F0]"
                  >
                    <Trash2 size={16} /> Delete {roomChat.type === 'channel' ? 'Channel' : 'Group'}
                  </button>
                )}
            </div>
          )}
        </div>
      </header>

      {/* Search Bar */}
      {isSearchOpen && (
        <div className="px-8 py-3 bg-white border-b border-[#E5E5E5] flex items-center gap-3 animate-fade-in">
          <Search size={16} className="text-[#999] shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && searchMatchIds.length > 0) {
                setSearchIndex(prev => (prev > 0 ? prev - 1 : searchMatchIds.length - 1));
              }
              if (e.key === 'Escape') {
                setIsSearchOpen(false);
                setSearchQuery('');
                setSearchMatchIds([]);
              }
            }}
            placeholder="Search messages..."
            className="flex-1 bg-transparent text-sm text-[#0A0A0A] placeholder-[#999] focus:outline-none"
            autoFocus
          />
          {searchQuery && (
            <span className="text-xs text-[#999] font-mono shrink-0">
              {searchMatchIds.length > 0 ? `${searchMatchIds.length - searchIndex}/${searchMatchIds.length}` : '0 results'}
            </span>
          )}
          {searchMatchIds.length > 1 && (
            <div className="flex gap-1 shrink-0">
              <button
                onClick={() => setSearchIndex(prev => (prev < searchMatchIds.length - 1 ? prev + 1 : 0))}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-[#666] hover:bg-[#F5F5F5] text-xs"
                title="Previous"
              >
                ↑
              </button>
              <button
                onClick={() => setSearchIndex(prev => (prev > 0 ? prev - 1 : searchMatchIds.length - 1))}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-[#666] hover:bg-[#F5F5F5] text-xs"
                title="Next"
              >
                ↓
              </button>
            </div>
          )}
          <button
            onClick={() => { setIsSearchOpen(false); setSearchQuery(''); setSearchMatchIds([]); }}
            className="p-1.5 text-[#999] hover:text-[#333] rounded-lg hover:bg-[#F5F5F5]"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Room Info Panel */}
      {showRoomInfo && roomChat && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setShowRoomInfo(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative w-80 max-w-[85vw] bg-white h-full shadow-2xl flex flex-col animate-slide-in-right"
            onClick={e => e.stopPropagation()}
          >
            {/* Panel Header */}
            <div className="px-5 py-4 border-b border-[#E5E5E5] flex items-center justify-between">
              <h3 className="font-bold text-[#0A0A0A] text-base">
                {roomChat.type === 'channel' ? 'Channel' : 'Group'} Info
              </h3>
              <button onClick={() => setShowRoomInfo(false)} className="p-1.5 hover:bg-[#F5F5F5] rounded-lg text-[#666]">
                <X size={18} />
              </button>
            </div>

            {/* Room Details */}
            <div className="px-5 py-4 border-b border-[#F0F0F0]">
              <div className="w-16 h-16 bg-[#0A0A0A] rounded-2xl flex items-center justify-center mx-auto mb-3">
                <MessageSquare size={28} className="text-[#FF8C00]" />
              </div>
              <h4 className="text-center text-[#0A0A0A] font-bold text-lg">#{roomChat.name}</h4>
              <p className="text-center text-[#999] text-xs font-mono mt-1">
                {roomChat.type.toUpperCase()} · {roomChat.memberCount || roomMembers.length} members
              </p>

              {/* Share Room ID */}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(roomChat.id);
                    toast.success('Room ID copied');
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-[#F5F5F5] hover:bg-[#E5E5E5] rounded-xl text-sm font-medium text-[#333] transition-colors"
                >
                  <Copy size={14} /> Copy ID
                </button>
                {onJoinRoom && (
                  <button
                    onClick={() => { onJoinRoom(); toast.success('Joined!'); }}
                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-[#FF8C00] hover:bg-[#FF9F2A] rounded-xl text-sm font-bold text-black transition-colors"
                  >
                    Join
                  </button>
                )}
              </div>
            </div>

            {/* Members List */}
            <div className="flex-1 overflow-y-auto">
              <div className="px-5 py-3">
                <p className="text-[10px] font-bold text-[#999] uppercase tracking-wider mb-2">
                  Members ({roomMembers.length})
                </p>
              </div>
              {roomMembers.length === 0 ? (
                <p className="px-5 text-sm text-[#999]">No members data</p>
              ) : (
                roomMembers.map((addr) => {
                  const name = resolveName(addr);
                  const initials = memberNames[addr] ? memberNames[addr].slice(0, 2).toUpperCase() : addr.slice(-2).toUpperCase();
                  return (
                  <div key={addr} className="flex items-center gap-3 px-5 py-2.5 hover:bg-[#FAFAFA] transition-colors">
                    <div className="w-8 h-8 rounded-full bg-[#0A0A0A] flex items-center justify-center text-[#FF8C00] text-xs font-bold shrink-0">
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#0A0A0A] truncate">
                        {name}
                      </p>
                      {addr === roomChat.createdBy && (
                        <p className="text-[10px] text-[#FF8C00] font-bold">CREATOR</p>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(addr);
                        toast.success('Address copied');
                      }}
                      className="p-1.5 text-[#CCC] hover:text-[#666] transition-colors shrink-0"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                  );
                })
              )}
            </div>

            {/* Panel Footer Actions */}
            <div className="px-5 py-4 border-t border-[#E5E5E5] space-y-2">
              {onLeaveRoom && (
                <button
                  onClick={() => { setShowRoomInfo(false); if (confirm(`Leave #${roomChat.name}?`)) onLeaveRoom(); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#F5F5F5] hover:bg-[#E5E5E5] rounded-xl text-sm font-medium text-[#666] transition-colors"
                >
                  <LogOut size={14} /> Leave {roomChat.type === 'channel' ? 'Channel' : 'Group'}
                </button>
              )}
              {onDeleteRoom && (
                <button
                  onClick={() => { setShowRoomInfo(false); if (confirm(`Delete #${roomChat.name}? This cannot be undone.`)) onDeleteRoom(); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-red-50 hover:bg-red-100 rounded-xl text-sm font-medium text-red-500 transition-colors"
                >
                  <Trash2 size={14} /> Delete {roomChat.type === 'channel' ? 'Channel' : 'Group'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pinned Messages Banner */}
      {pinnedMessages.length > 0 && (
        <div className="px-8 py-2 bg-[#FFF8F0] border-b border-[#FFE0B2] flex items-center gap-2 shrink-0">
          <Pin size={14} className="text-[#FF8C00] shrink-0" />
          <p className="text-xs text-[#666] truncate flex-1">
            <span className="font-bold text-[#FF8C00]">{pinnedMessages.length} pinned</span>
            {' — '}
            {pinnedMessages[0]?.message_text?.slice(0, 60) || 'message'}
          </p>
          {onUnpinMessage && (
            <button
              onClick={() => onUnpinMessage(pinnedMessages[0]?.message_id)}
              className="text-[#999] hover:text-red-500 shrink-0"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-8 space-y-6 flex flex-col relative">
        {/* Sentinel for Infinite Scroll */}
        <div ref={topSentinelRef} className="h-1 w-full flex-shrink-0 opacity-0" />
        
        {isLoading && messages.length > 0 && (
             <div className="flex justify-center py-2">
                 <div className="w-5 h-5 border-2 border-[#FF8C00] border-t-transparent rounded-full animate-spin" />
             </div>
        )}

        {isLoading && messages.length === 0 ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
             <EmptyState 
                icon={MessageSquare} 
                title="No messages yet" 
                description="Start the conversation by sending an encrypted message." 
             />
          </div>
        ) : (
          messages.map((msg) => {
            const isSearchMatch = searchMatchIds.includes(msg.id);
            const isActiveMatch = isSearchMatch && searchMatchIds[searchIndex] === msg.id;
            return (
            <motion.div
              key={msg.id}
              id={`msg-${msg.id}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex items-end gap-3 max-w-[70%] ${msg.isMine ? 'self-end flex-row-reverse' : 'self-start'} ${isActiveMatch ? 'ring-2 ring-[#FF8C00] ring-offset-2 rounded-3xl' : isSearchMatch ? 'ring-1 ring-[#FF8C00]/30 ring-offset-1 rounded-3xl' : ''}`}
            >
              {!msg.isMine && (
                <div className="w-8 h-8 rounded-full bg-[#E5E5E5] flex-shrink-0 overflow-hidden">
                  {roomChat ? (
                    <div className="w-full h-full bg-[#0A0A0A] flex items-center justify-center text-[#FF8C00] text-xs font-bold">
                      {(msg.senderHash || '?')[0].toUpperCase()}
                    </div>
                  ) : (
                    <img src={activeChat.avatar} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
              )}

              <div className={`group relative px-6 py-4 rounded-3xl transition-all ${
                msg.isMine
                  ? 'bg-[#0A0A0A] text-white rounded-br-sm'
                  : 'bg-white border border-[#E5E5E5] text-[#0A0A0A] rounded-bl-sm'
              }`}>
                {/* Edit Mode */}
                {editingMessageId === msg.id ? (
                    <div className="flex flex-col gap-2 min-w-[200px]">
                        <input
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="w-full bg-transparent border-b border-white/20 outline-none pb-1 text-sm"
                            autoFocus
                        />
                        <div className="flex justify-end gap-2 mt-1">
                            <button onClick={cancelEdit} className="p-1 hover:bg-white/10 rounded"><X size={14} /></button>
                            <button onClick={() => submitEdit(msg)} className="p-1 hover:bg-white/10 rounded text-[#10B981]"><Check size={14} /></button>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Reply Quote */}
                        {msg.replyToText && (
                          <div
                            className={`mb-2 pl-3 border-l-2 ${msg.isMine ? 'border-[#FF8C00]/60' : 'border-[#FF8C00]'} rounded-sm ${msg.replyToText !== 'Message deleted' ? 'cursor-pointer hover:opacity-70' : ''} transition-opacity`}
                            onClick={() => {
                              if (msg.replyToId && msg.replyToText !== 'Message deleted') {
                                const el = document.getElementById(`msg-${msg.replyToId}`);
                                if (el) {
                                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                  el.classList.add('ring-2', 'ring-[#FF8C00]', 'ring-opacity-60');
                                  setTimeout(() => el.classList.remove('ring-2', 'ring-[#FF8C00]', 'ring-opacity-60'), 1500);
                                }
                              }
                            }}
                          >
                            <p className={`text-[10px] font-bold ${msg.isMine ? 'text-[#FF8C00]/80' : 'text-[#FF8C00]'}`}>
                              {msg.replyToSender === 'me' || msg.replyToSender === currentUserId ? 'You' : (memberNames[msg.replyToSender || ''] || activeChat?.name || msg.replyToSender?.slice(0, 8) || 'User')}
                            </p>
                            <p className={`text-xs truncate max-w-[200px] ${msg.replyToText === 'Message deleted' ? 'italic opacity-50' : ''} ${msg.isMine ? 'text-white/50' : 'text-[#999]'}`}>
                              {msg.replyToText}
                            </p>
                          </div>
                        )}

                        {msg.attachment && (
                            <div className="mb-2">
                                {msg.attachment.type === 'image' && msg.attachment.cid !== 'pending...' ? (
                                    <img
                                        src={msg.attachment.cid.startsWith('Qm') ? `https://ipfs.io/ipfs/${msg.attachment.cid}` : msg.attachment.cid}
                                        alt="attachment"
                                        className="rounded-lg max-w-full h-auto max-h-[200px] cursor-pointer hover:opacity-90"
                                        onClick={() => window.open(msg.attachment?.cid.startsWith('Qm') ? `https://ipfs.io/ipfs/${msg.attachment?.cid}` : msg.attachment?.cid, '_blank')}
                                    />
                                ) : (
                                    <div className={`flex items-center gap-3 p-2 rounded-lg ${msg.isMine ? 'bg-white/10' : 'bg-black/5'}`}>
                                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${msg.isMine ? 'bg-white/20' : 'bg-black/10'}`}>
                                            <FileIcon size={20} />
                                        </div>
                                        <div className="flex flex-col overflow-hidden min-w-[100px]">
                                            <span className="text-sm font-medium truncate max-w-[150px]">{msg.attachment.name || 'Attachment'}</span>
                                            <span className="text-xs opacity-70">{msg.attachment.size ? (msg.attachment.size/1024).toFixed(1) + ' KB' : (msg.attachment.cid === 'pending...' ? 'Uploading...' : 'File')}</span>
                                        </div>
                                        {msg.attachment.cid !== 'pending...' && (
                                            <a
                                                href={msg.attachment.cid.startsWith('Qm') ? `https://ipfs.io/ipfs/${msg.attachment.cid}` : '#'}
                                                target="_blank"
                                                rel="noreferrer"
                                                className={`p-2 rounded-lg transition-colors ml-2 ${msg.isMine ? 'hover:bg-white/20' : 'hover:bg-black/10'}`}
                                            >
                                                <Download size={18} />
                                            </a>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                        {roomChat && !msg.isMine && (msg.senderId || msg.senderHash) && (
                          <p className="text-[11px] font-bold text-[#FF8C00] mb-1">
                            {memberNames[msg.senderId || ''] || msg.senderHash || msg.senderId?.slice(0, 10)}
                          </p>
                        )}
                        <p className="text-[15px] leading-relaxed">{renderMessageText(msg.text, isSearchMatch)}</p>
                        {linkPreviews && fetchLinkPreview && extractFirstUrl(msg.text) && (
                          <LinkPreviewCard url={extractFirstUrl(msg.text)!} fetchPreview={fetchLinkPreview} />
                        )}
                        <div className={`text-[10px] mt-2 font-mono opacity-60 flex items-center gap-1 ${msg.isMine ? 'justify-end' : 'justify-start'}`}>
                        {msg.time}
                        {msg.edited && <span className="italic text-[#FF8C00]">(edited)</span>}
                        {disappearTimer !== 'off' && <Timer size={8} className="ml-1 text-[#FF8C00]" />}
                        {msg.isMine && (
                            <MessageStatus status={msg.status} />
                        )}
                        </div>

                        {/* Reactions Display */}
                        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {Object.entries(msg.reactions).map(([emoji, users]) => {
                              const userIds = users as string[];
                              return (
                              <button
                                key={emoji}
                                onClick={() => {
                                  if (userIds.includes(currentUserId) && onRemoveReaction) {
                                    onRemoveReaction(msg.id, emoji);
                                  } else if (onReact) {
                                    onReact(msg.id, emoji);
                                  }
                                }}
                                className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                                  userIds.includes(currentUserId)
                                    ? 'bg-[#FF8C00]/20 border-[#FF8C00]/40 text-[#FF8C00]'
                                    : msg.isMine
                                      ? 'bg-white/10 border-white/20 text-white/80 hover:bg-white/20'
                                      : 'bg-black/5 border-black/10 text-[#333] hover:bg-black/10'
                                }`}
                              >
                                {emoji} {userIds.length > 1 ? userIds.length : ''}
                              </button>
                            );})}
                          </div>
                        )}

                        {/* Hover Actions */}
                        <div className={`absolute -top-8 ${msg.isMine ? 'right-0' : 'left-0'} opacity-0 group-hover:opacity-100 transition-all duration-150 flex items-center gap-0.5 bg-white border border-[#E0E0E0] rounded-xl px-1.5 py-1 shadow-lg z-20`}>
                            {/* Reply (DM only) */}
                            {!roomChat && (
                            <button
                              onClick={() => setReplyingTo({ id: msg.id, text: msg.text, sender: msg.isMine ? 'me' : (msg.senderId || 'User') })}
                              title="Reply"
                              className="p-1.5 rounded-lg text-[#888] hover:text-[#FF8C00] hover:bg-[#FFF3E0] transition-colors"
                            >
                              <Reply size={14} />
                            </button>
                            )}
                            {/* Emoji React */}
                            <button
                              onClick={() => setEmojiPickerMsgId(emojiPickerMsgId === msg.id ? null : msg.id)}
                              title="React"
                              className="p-1.5 rounded-lg text-[#888] hover:text-[#FF8C00] hover:bg-[#FFF3E0] transition-colors"
                            >
                              <Smile size={14} />
                            </button>
                            {/* Pin */}
                            {onPinMessage && (
                              <button
                                onClick={() => {
                                  const isPinned = pinnedMessages.some((p: any) => p.message_id === msg.id);
                                  if (isPinned && onUnpinMessage) {
                                    onUnpinMessage(msg.id);
                                  } else {
                                    onPinMessage(msg.id, msg.text);
                                  }
                                }}
                                title={pinnedMessages.some((p: any) => p.message_id === msg.id) ? 'Unpin' : 'Pin'}
                                className={`p-1.5 rounded-lg transition-colors ${
                                  pinnedMessages.some((p: any) => p.message_id === msg.id)
                                    ? 'text-[#FF8C00] bg-[#FFF3E0]'
                                    : 'text-[#888] hover:text-[#FF8C00] hover:bg-[#FFF3E0]'
                                }`}
                              >
                                <Pin size={14} />
                              </button>
                            )}
                            {/* Copy text */}
                            <button
                              onClick={() => { navigator.clipboard.writeText(msg.text); toast.success('Copied'); }}
                              title="Copy text"
                              className="p-1.5 rounded-lg text-[#888] hover:text-[#FF8C00] hover:bg-[#FFF3E0] transition-colors"
                            >
                              <Copy size={14} />
                            </button>
                            {msg.isMine && (
                              <>
                                <button onClick={() => handleEdit(msg)} title="Edit" className="p-1.5 rounded-lg text-[#888] hover:text-[#FF8C00] hover:bg-[#FFF3E0] transition-colors">
                                    <Edit2 size={14} />
                                </button>
                                <button onClick={() => handleDelete(msg)} title="Delete" className="p-1.5 rounded-lg text-[#888] hover:text-red-500 hover:bg-red-50 transition-colors">
                                    <Trash2 size={14} />
                                </button>
                              </>
                            )}
                        </div>

                        {/* Quick Emoji Picker */}
                        <AnimatePresence>
                          {emojiPickerMsgId === msg.id && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.9, y: 5 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.9, y: 5 }}
                              className={`absolute ${msg.isMine ? 'right-0' : 'left-0'} -top-16 bg-white border border-[#E5E5E5] rounded-full shadow-lg px-2 py-1 flex gap-1 z-50`}
                            >
                              {QUICK_EMOJIS.map(emoji => (
                                <button
                                  key={emoji}
                                  onClick={() => {
                                    if (onReact) onReact(msg.id, emoji);
                                    setEmojiPickerMsgId(null);
                                  }}
                                  className="w-7 h-7 flex items-center justify-center hover:bg-[#F5F5F5] rounded-full text-sm transition-transform hover:scale-125"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                    </>
                )}
              </div>
            </motion.div>
          );})
        )}
      </div>

      {/* Typing Indicator */}
      {isTyping && (
        <div className="px-8 py-2 text-xs text-[#999] flex items-center gap-2 bg-[#FAFAFA]">
          <span className="flex gap-0.5">
            <span className="w-1.5 h-1.5 bg-[#FF8C00] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 bg-[#FF8C00] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-[#FF8C00] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </span>
          typing...
        </div>
      )}

      {/* Input Area */}
      <div className="p-6 bg-white border-t border-[#E5E5E5]">
        {/* Reply Bar */}
        {replyingTo && (
          <div className="mb-2 p-3 bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl flex items-center justify-between animate-fade-in">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="w-1 h-8 bg-[#FF8C00] rounded-full flex-shrink-0" />
              <div className="overflow-hidden">
                <p className="text-xs font-bold text-[#FF8C00]">
                  {replyingTo.sender === 'me' || replyingTo.sender === currentUserId
                    ? 'Replying to yourself'
                    : `Replying to ${memberNames[replyingTo.sender] || activeChat?.name || replyingTo.sender.slice(0, 10) + '...'}`}
                </p>
                <p className="text-xs text-[#999] truncate max-w-[300px]">{replyingTo.text}</p>
              </div>
            </div>
            <button onClick={() => setReplyingTo(null)} className="p-1 hover:bg-[#E5E5E5] rounded-full text-[#999]">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Disappearing Timer Badge */}
        {disappearTimer !== 'off' && (
          <div className="mb-2 flex items-center gap-1.5 text-[10px] text-[#FF8C00] font-mono">
            <Clock size={10} />
            Messages disappear after {disappearTimer}
          </div>
        )}

        {selectedFile && (
          <div className="mb-2 p-2 bg-gray-100 rounded-lg flex items-center justify-between border border-gray-200">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center text-gray-500">
                <Paperclip size={16} />
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="text-sm font-medium text-gray-700 truncate">{selectedFile.name}</span>
                <span className="text-xs text-gray-500">{(selectedFile.size / 1024).toFixed(1)} KB</span>
              </div>
            </div>
            <button 
              onClick={() => setSelectedFile(null)}
              className="p-1 hover:bg-gray-200 rounded-full text-gray-500"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="bg-[#FAFAFA] border border-[#E5E5E5] rounded-2xl p-2 flex items-center gap-2 focus-within:border-[#FF8C00] focus-within:shadow-[0_0_0_4px_rgba(255,140,0,0.1)] transition-all">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileSelect} 
            className="hidden" 
          />
          <button
            aria-label="Attach file"
            onClick={() => fileInputRef.current?.click()}
            className="w-10 h-10 flex items-center justify-center text-[#666] hover:text-[#0A0A0A] rounded-xl hover:bg-[#E5E5E5] transition-colors"
          >
            <Paperclip size={20} />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Debounced typing indicator
              if (onTyping && e.target.value) {
                if (!typingTimeoutRef.current) {
                  onTyping();
                }
                if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                typingTimeoutRef.current = setTimeout(() => { typingTimeoutRef.current = null; }, 2000);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={isSending ? "Encrypting & sending..." : roomChat ? `Message #${roomChat.name}...` : "Type an encrypted message..."}
            disabled={isSending}
            className="flex-1 bg-transparent border-none focus:ring-0 text-[#0A0A0A] placeholder-[#999] px-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button aria-label="Emoji" className="w-10 h-10 flex items-center justify-center text-[#666] hover:text-[#0A0A0A] rounded-xl hover:bg-[#E5E5E5] transition-colors">
            <Smile size={20} />
          </button>
          <button
            aria-label="Send message"
            onClick={handleSend}
            disabled={!input.trim() || isSending}
            className="w-10 h-10 flex items-center justify-center bg-[#0A0A0A] text-white rounded-xl hover:bg-[#FF8C00] hover:text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? <div className="w-4 h-4 border-2 border-white/60 border-t-transparent rounded-full animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatArea;
