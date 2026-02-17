
import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Search, MoreVertical, Paperclip, Send, Smile, Menu, Ghost, Shield, MessageSquare, Trash2, Edit2, X, Check, File as FileIcon, Download, Reply, Timer, Clock, Pin, Copy, Users, LogOut, Share2, Bold, Italic, Strikethrough, Underline, Ban, Lock, Mic, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Chat, Message, DisappearTimer, DISAPPEAR_TIMERS, Room, AppView, PinnedMessage } from '../types';
import { logger } from '../utils/logger';
import Avatar from './Avatar';
import { MessageStatus } from './ui/MessageStatus';
import { MessageSkeleton } from './ui/Skeleton';
import { EmptyState } from './ui/EmptyState';
import { toast } from 'react-hot-toast';
import DOMPurify from 'dompurify';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import { IPFS_GATEWAY_URL, ADDRESS_DISPLAY, MESSAGE_PREVIEW, GENERIC_AVATAR, MAX_MESSAGE_LENGTH } from '../constants';
import { applyFormatting } from '../utils/formatText';
import { safeBackendFetch } from '../utils/api-client';
import { TypingIndicator } from './ui/TypingIndicator';
import { ScrollToBottomButton } from './ui/ScrollToBottomButton';
import { useAutoResizeTextarea } from '../hooks/useAutoResizeTextarea';
import ImageLightbox from './ui/ImageLightbox';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

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
    <div className="mt-3 rounded-xl border-2 border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 animate-pulse">
      <div className="h-4 bg-[var(--border-primary)] rounded w-3/4 mb-3" />
      <div className="h-3 bg-[var(--border-primary)] rounded w-full mb-2" />
      <div className="h-3 bg-[var(--border-primary)] rounded w-2/3" />
    </div>
  );

  if (!preview || (!preview.title && !preview.description)) return null;

  const domain = (() => { try { return new URL(url).hostname; } catch { return url; } })();

  return (
    <motion.a
      href={url}
      target="_blank"
      rel="noreferrer"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="block mt-3 rounded-xl border-2 border-[var(--border-primary)] bg-[var(--bg-primary)] overflow-hidden hover:border-[var(--accent-primary)] hover:shadow-md transition-all no-underline group"
    >
      {preview.image && (
        <div className="w-full h-40 bg-[var(--bg-secondary)] overflow-hidden">
          <img
            src={preview.image}
            alt={preview.title || ''}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={e => (e.currentTarget.parentElement!.style.display = 'none')}
          />
        </div>
      )}
      <div className="p-4">
        {preview.title && (
          <h3 className="text-sm font-bold text-[var(--text-primary)] mb-2 line-clamp-2 leading-snug">
            {preview.title}
          </h3>
        )}
        {preview.description && (
          <p className="text-xs text-[var(--text-secondary)] line-clamp-3 leading-relaxed mb-2">
            {preview.description}
          </p>
        )}
        <div className="flex items-center gap-2 text-[10px] text-[var(--text-tertiary)] font-mono uppercase tracking-wider">
          <span className="w-1.5 h-1.5 bg-[var(--accent-primary)] rounded-full" />
          {preview.siteName || domain}
        </div>
      </div>
    </motion.a>
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
  typingUserName?: string;
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
  pinnedMessages?: PinnedMessage[];
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
  forwardContacts?: { id: string; name: string; address: string }[];
  onForwardMessage?: (toAddress: string, text: string, originalSender: string) => void;
  // Block user
  isBlocked?: boolean;
  onBlockUser?: () => void;
  onUnblockUser?: () => void;
  // Chat appearance settings
  fontSize?: 'small' | 'medium' | 'large';
  chatTheme?: 'light' | 'dark' | 'midnight' | 'aleo';
  bubbleStyle?: 'rounded' | 'flat';
  compactMode?: boolean;
  sendOnEnter?: boolean;
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
  typingUserName,
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
  onJoinRoom,
  forwardContacts = [],
  onForwardMessage,
  isBlocked = false,
  onBlockUser,
  onUnblockUser,
  fontSize = 'medium',
  chatTheme = 'dark',
  bubbleStyle = 'rounded',
  compactMode = false,
  sendOnEnter = true
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

  // Edit history modal
  const [editHistoryMsgId, setEditHistoryMsgId] = useState<string | null>(null);
  const [editHistoryEntries, setEditHistoryEntries] = useState<{ edited_at: number; previous_payload: string }[]>([]);
  const [editHistoryLoading, setEditHistoryLoading] = useState(false);

  // Helper: resolve address to display name
  const resolveName = (addr: string) =>
    addr === currentUserId ? 'You' : (memberNames[addr] || `${addr.slice(0, ADDRESS_DISPLAY.FULL_SHORT)}...${addr.slice(-ADDRESS_DISPLAY.SHORT_SUFFIX)}`);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Reply state
  const [replyingTo, setReplyingTo] = useState<{ id: string; text: string; sender: string } | null>(null);

  // Forward state
  const [forwardingMsg, setForwardingMsg] = useState<{ text: string; sender: string } | null>(null);
  const [forwardSearch, setForwardSearch] = useState('');

  // Emoji picker state (for message reactions)
  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState<string | null>(null);

  // Input emoji picker state
  const [showInputEmojiPicker, setShowInputEmojiPicker] = useState(false);
  const mainInputRef = useRef<HTMLTextAreaElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerContainerRef = useRef<HTMLDivElement>(null);

  // Image lightbox state
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Voice recorder
  const { isRecording, recordingDuration, startRecording, stopRecording, cancelRecording } = useVoiceRecorder();

  // Floating format toolbar state
  const [showFormatBar, setShowFormatBar] = useState(false);
  const [formatTarget, setFormatTarget] = useState<'main' | 'edit'>('main');
  const formatBarRef = useRef<HTMLDivElement>(null);

  // Room info panel
  const [showRoomInfo, setShowRoomInfo] = useState(false);

  // Chat search state
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIds, setSearchMatchIds] = useState<string[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Scroll tracking for FAB
  const [showScrollFAB, setShowScrollFAB] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const lastScrollTop = useRef(0);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);

  // ── Theme & appearance derived values ──
  const themeColors = {
    light: { bg: '#FFFFFF', chatBg: '#F5F5F5', myBubble: '#0A0A0A', myText: '#FFFFFF', theirBubble: '#FFFFFF', theirText: '#0A0A0A', theirBorder: '#E5E5E5', headerBg: '#FFFFFF', headerText: '#0A0A0A', inputBg: '#F5F5F5', inputText: '#0A0A0A', inputBorder: '#E5E5E5', accent: '#FF8C00' },
    dark: { bg: '#0A0A0A', chatBg: '#0A0A0A', myBubble: '#1A1A2E', myText: '#FFFFFF', theirBubble: '#1A1A1A', theirText: '#E5E5E5', theirBorder: '#2A2A2A', headerBg: '#0A0A0A', headerText: '#FFFFFF', inputBg: '#111111', inputText: '#FFFFFF', inputBorder: '#2A2A2A', accent: '#FF8C00' },
    midnight: { bg: '#0D1117', chatBg: '#0D1117', myBubble: '#161B22', myText: '#C9D1D9', theirBubble: '#161B22', theirText: '#C9D1D9', theirBorder: '#30363D', headerBg: '#0D1117', headerText: '#C9D1D9', inputBg: '#0D1117', inputText: '#C9D1D9', inputBorder: '#30363D', accent: '#58A6FF' },
    aleo: { bg: '#1A0A00', chatBg: '#1A0A00', myBubble: '#331A00', myText: '#FFD9B3', theirBubble: '#261300', theirText: '#FFD9B3', theirBorder: '#4D2600', headerBg: '#1A0A00', headerText: '#FFD9B3', inputBg: '#1A0A00', inputText: '#FFD9B3', inputBorder: '#4D2600', accent: '#FF8C00' },
  }[chatTheme];
  const fontSizePx = { small: 13, medium: 15, large: 17 }[fontSize];
  const bubbleRadius = bubbleStyle === 'rounded' ? 'rounded-3xl' : 'rounded-lg';
  const bubbleRadiusMine = bubbleStyle === 'rounded' ? 'rounded-3xl rounded-br-sm' : 'rounded-lg rounded-br-sm';
  const bubbleRadiusTheirs = bubbleStyle === 'rounded' ? 'rounded-3xl rounded-bl-sm' : 'rounded-lg rounded-bl-sm';
  const messageSpacing = compactMode ? 'space-y-2' : 'space-y-6';

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

  // Auto-resize textarea
  useAutoResizeTextarea(mainInputRef, input);

  // Scroll tracking for FAB visibility
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollEl;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;

      // Show FAB when scrolled up
      setShowScrollFAB(!isNearBottom);

      lastScrollTop.current = scrollTop;
    };

    scrollEl.addEventListener('scroll', handleScroll);
    return () => scrollEl.removeEventListener('scroll', handleScroll);
  }, []);

  // Smooth scroll to bottom
  const scrollToBottom = (smooth = true) => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      });
    }
  };

  // Auto-scroll on new messages (only if already near bottom)
  useEffect(() => {
    if (messages.length === 0) return;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollEl;
    const wasNearBottom = scrollHeight - scrollTop - clientHeight < 200;

    if (wasNearBottom) {
      // Delay to let DOM update
      requestAnimationFrame(() => scrollToBottom(true));
    }
  }, [messages.length]);

  // Render message text with formatting, clickable URLs and optional search highlighting
  const renderMessageText = (text: string, isSearchMatch: boolean) => {
    // Sanitize input first
    const sanitized = DOMPurify.sanitize(text, { ALLOWED_TAGS: [], KEEP_CONTENT: true });

    // Split text by URLs
    const urlParts = sanitized.split(URL_REGEX);
    const urls = sanitized.match(URL_REGEX) || [];
    if (urls.length === 0) {
      // No URLs — apply formatting + highlight search if needed
      if (!isSearchMatch || !searchQuery.trim()) return <>{applyFormatting(sanitized)}</>;
      const q = searchQuery.trim();
      const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      const parts = sanitized.split(regex);
      if (parts.length === 1) return <>{applyFormatting(sanitized)}</>;
      return parts.map((part, i) =>
        regex.test(part)
          ? <mark key={i} className="bg-[#FF8C00]/40 text-inherit rounded-sm px-0.5">{part}</mark>
          : <React.Fragment key={i}>{applyFormatting(part)}</React.Fragment>
      );
    }
    // Interleave text parts (formatted) and URL links
    const elements: React.ReactNode[] = [];
    urlParts.forEach((part, i) => {
      if (part) elements.push(<React.Fragment key={`t${i}`}>{applyFormatting(part)}</React.Fragment>);
      if (i < urls.length) {
        // Sanitize URL to prevent javascript: protocol
        const safeUrl = urls[i].match(/^https?:\/\//) ? urls[i] : '#';
        elements.push(
          <a key={`u${i}`} href={safeUrl} target="_blank" rel="noreferrer" className="text-[#3B82F6] underline break-all hover:text-[#2563EB]">
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

  // Close menu / emoji picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
      if (emojiPickerContainerRef.current && !emojiPickerContainerRef.current.contains(event.target as Node)) {
        setShowInputEmojiPicker(false);
      }
      if (formatBarRef.current && !formatBarRef.current.contains(event.target as Node) && event.target !== mainInputRef.current && event.target !== editInputRef.current) {
        setShowFormatBar(false);
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
    if (input.length > MAX_MESSAGE_LENGTH) {
      toast.error(`Message too long (max ${MAX_MESSAGE_LENGTH} characters)`);
      return;
    }
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
    if (e.key === 'Enter' && !e.shiftKey && sendOnEnter) {
      e.preventDefault();
      handleSend();
    }
  };

  // Check if text is selected in input → show/hide format bar
  const handleInputSelect = (target: 'main' | 'edit' = 'main') => {
    const el = target === 'edit' ? editInputRef.current : mainInputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (start !== end) {
      setFormatTarget(target);
      setShowFormatBar(true);
    } else {
      setShowFormatBar(false);
    }
  };

  // Wrap selected text with formatting markers (works for both main and edit inputs)
  const applyFormat = (prefix: string, suffix: string) => {
    const isEdit = formatTarget === 'edit';
    const el = isEdit ? editInputRef.current : mainInputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (start === end) return;
    const currentValue = isEdit ? editContent : input;
    const selected = currentValue.slice(start, end);
    const newValue = currentValue.slice(0, start) + prefix + selected + suffix + currentValue.slice(end);
    if (isEdit) {
      setEditContent(newValue);
    } else {
      setInput(newValue);
    }
    setShowFormatBar(false);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + prefix.length + selected.length + suffix.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleDelete = async (msg: Message) => {
      if (roomChat && onDeleteRoomMessage) {
          if (confirm("Delete this message?")) {
              onDeleteRoomMessage(msg.id);
              // Clear reply-in-progress if replying to deleted message
              if (replyingTo?.id === msg.id) setReplyingTo(null);
              // Auto-unpin if pinned
              if (onUnpinMessage && pinnedMessages.some((p: PinnedMessage) => p.message_id === msg.id)) {
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
                  if (onUnpinMessage && pinnedMessages.some((p: PinnedMessage) => p.message_id === msg.id)) {
                    onUnpinMessage(msg.id);
                  }
              } catch (e) {
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
      if (!editContent.trim()) {
          toast.error("Message cannot be empty");
          return;
      }
      if (editContent.trim() === msg.text) {
          toast("No changes to save", { icon: 'ℹ️' });
          cancelEdit();
          return;
      }
      setShowFormatBar(false);
      if (roomChat && onEditRoomMessage) {
          try {
              await onEditRoomMessage(msg.id, editContent);
              setEditingMessageId(null);
          } catch (e: any) {
              toast.error("Failed to edit: " + (e?.message || 'Unknown error'));
          }
          return;
      }
      // Off-chain DM edit
      if (onEditDMMessage) {
          try {
              await onEditDMMessage(msg.id, editContent);
              setEditingMessageId(null);
              toast.success("Message edited");
          } catch (e: any) {
              toast.error("Failed to edit: " + (e?.message || 'Unknown error'));
          }
          return;
      }
  };

  const cancelEdit = () => {
      setEditingMessageId(null);
      setEditContent('');
      setShowFormatBar(false);
  };

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only hide if leaving the main container
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const file = files[0]; // Take first file only
      handleFileSelect({ target: { files: [file] } } as any);
    }
  };

  const showEditHistory = async (msgId: string) => {
    if (roomChat) return; // Edit history only for DMs (encrypted payloads)
    setEditHistoryMsgId(msgId);
    setEditHistoryLoading(true);
    setEditHistoryEntries([]);
    try {
      const { data } = await safeBackendFetch<{ history: { edited_at: number; previous_payload: string; previous_payload_self: string }[] }>(
        `messages/${msgId}/history`
      );
      if (data?.history) {
        // We can't decrypt here since we don't have the decryption function,
        // but we show timestamps. The payload is encrypted — show the time only.
        setEditHistoryEntries(data.history);
      }
    } catch {
      toast.error('Failed to load edit history');
      setEditHistoryMsgId(null);
    } finally {
      setEditHistoryLoading(false);
    }
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
    <div className="flex-1 flex flex-col relative h-screen overflow-hidden" style={{ backgroundColor: themeColors.chatBg, color: themeColors.theirText }}>
      {/* Chat Header */}
      <header className="px-8 py-5 border-b flex items-center justify-between z-10 backdrop-blur-xl bg-opacity-90" style={{ backgroundColor: themeColors.headerBg, borderColor: themeColors.theirBorder, color: themeColors.headerText, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
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
              {!roomChat && contactOnline && <span className="w-2 h-2 bg-[var(--status-online)] rounded-full status-pulse" />}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--accent-light)] text-[var(--accent-primary)] text-[10px] font-bold uppercase tracking-wider rounded-md" title="End-to-end encrypted">
                <Lock size={10} /> E2E
              </span>
            </h2>
            <p className="text-[#666] text-xs font-mono tracking-tighter uppercase">
              {roomChat
                ? `${roomChat.type.toUpperCase()} · ${roomChat.memberCount || 0} members`
                : contactOnline
                  ? 'Online'
                  : contactLastSeen
                    ? `Last seen ${timeAgo(contactLastSeen)}`
                    : activeChat.address
                      ? `${activeChat.address.slice(0, 14)}...${activeChat.address.slice(-ADDRESS_DISPLAY.SHORT_SUFFIX)}`
                      : activeChat.id}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 relative">
          <button
            aria-label="Search messages"
            onClick={() => { setIsSearchOpen(!isSearchOpen); if (!isSearchOpen) setTimeout(() => searchInputRef.current?.focus(), 100); }}
            className={`w-10 h-10 flex items-center justify-center border rounded-xl btn-press ${isSearchOpen ? 'border-[#FF8C00] text-[#FF8C00] bg-[#FFF3E0]' : 'border-[#E5E5E5] text-[#666] hover:text-[#FF8C00]'} transition-colors`}
          >
            <Search size={18} />
          </button>
          <button
            aria-label="Chat menu"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="w-10 h-10 flex items-center justify-center border border-[#E5E5E5] rounded-xl text-[#666] hover:text-[#FF8C00] transition-colors btn-press"
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
                  <button onClick={() => { setIsMenuOpen(false); onViewProfile(activeChat); }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAFA] text-sm font-medium text-[#333] btn-press">
                    <Users size={16} className="text-[#888]" /> View Profile
                  </button>
                )}

                {/* Room: Info header */}
                {roomChat && (
                  <>
                    <button
                      onClick={() => { setIsMenuOpen(false); setShowRoomInfo(true); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAFA] text-sm font-medium text-[#333] btn-press"
                    >
                      <Users size={16} className="text-[#888]" />
                      Members ({roomChat.memberCount || roomMembers.length})
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(roomChat.id).catch(() => toast.error('Failed to copy'));
                        toast.success('Room ID copied — share it so others can join');
                        setIsMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAFA] text-sm font-medium text-[#333] btn-press"
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
                          className={`px-2 py-1 text-xs rounded-md transition-colors btn-press ${disappearTimer === t ? 'bg-[#FF8C00] text-white' : 'bg-[#F5F5F5] text-[#666] hover:bg-[#E5E5E5]'}`}
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
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAFA] text-sm font-medium text-[#333] btn-press border-t border-[#F0F0F0]"
                  >
                    <Trash2 size={16} className="text-[#888]" /> Clear History
                  </button>
                )}

                {/* DM: Block / Unblock User */}
                {!roomChat && (onBlockUser || onUnblockUser) && (
                  isBlocked ? (
                    <button
                      onClick={() => { setIsMenuOpen(false); onUnblockUser?.(); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAFA] text-sm font-medium text-[#10B981] btn-press border-t border-[#F0F0F0]"
                    >
                      <Ban size={16} /> Unblock User
                    </button>
                  ) : (
                    <button
                      onClick={() => { setIsMenuOpen(false); if (confirm('Block this user? They won\'t be able to send you messages.')) onBlockUser?.(); }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-50 text-sm font-medium text-red-500 btn-press border-t border-[#F0F0F0]"
                    >
                      <Ban size={16} /> Block User
                    </button>
                  )
                )}

                {/* Room: Leave */}
                {roomChat && onLeaveRoom && (
                  <button
                    onClick={() => { setIsMenuOpen(false); if (confirm(`Leave #${roomChat.name}?`)) onLeaveRoom(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAFA] text-sm font-medium text-[#333] btn-press border-t border-[#F0F0F0]"
                  >
                    <LogOut size={16} className="text-[#888]" /> Leave {roomChat.type === 'channel' ? 'Channel' : 'Group'}
                  </button>
                )}

                {/* Room: Delete (creator only) */}
                {roomChat && onDeleteRoom && (
                  <button
                    onClick={() => { setIsMenuOpen(false); if (confirm(`Delete #${roomChat.name}? This cannot be undone.`)) onDeleteRoom(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-50 text-sm font-medium text-red-500 border-t border-[#F0F0F0] btn-press"
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
                    navigator.clipboard.writeText(roomChat.id).catch(() => toast.error('Failed to copy'));
                    toast.success('Room ID copied');
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-[#F5F5F5] hover:bg-[#E5E5E5] rounded-xl text-sm font-medium text-[#333] transition-colors btn-press"
                >
                  <Copy size={14} /> Copy ID
                </button>
                {onJoinRoom && (
                  <button
                    onClick={() => { onJoinRoom(); toast.success('Joined!'); }}
                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-[#FF8C00] hover:bg-[#FF9F2A] rounded-xl text-sm font-bold text-black transition-all btn-press hover:shadow-lg hover:shadow-[#FF8C00]/20"
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
                  const initials = memberNames[addr] ? memberNames[addr].slice(0, ADDRESS_DISPLAY.INITIALS).toUpperCase() : addr.slice(-ADDRESS_DISPLAY.INITIALS).toUpperCase();
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
                        navigator.clipboard.writeText(addr).catch(() => toast.error('Failed to copy'));
                        toast.success('Address copied');
                      }}
                      className="p-1.5 text-[#CCC] hover:text-[#666] shrink-0 btn-icon"
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
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#F5F5F5] hover:bg-[#E5E5E5] rounded-xl text-sm font-medium text-[#666] transition-colors btn-press"
                >
                  <LogOut size={14} /> Leave {roomChat.type === 'channel' ? 'Channel' : 'Group'}
                </button>
              )}
              {onDeleteRoom && (
                <button
                  onClick={() => { setShowRoomInfo(false); if (confirm(`Delete #${roomChat.name}? This cannot be undone.`)) onDeleteRoom(); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-red-50 hover:bg-red-100 rounded-xl text-sm font-medium text-red-500 transition-colors btn-press"
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
            {pinnedMessages[0]?.message_text?.slice(0, MESSAGE_PREVIEW.NOTIFICATION) || 'message'}
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
      <div
        ref={scrollRef}
        className={`flex-1 overflow-y-auto px-8 py-8 ${messageSpacing} flex flex-col relative`}
        style={{ fontSize: fontSizePx }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
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

              <div className={`group relative px-6 py-4 transition-all ${
                msg.isMine ? bubbleRadiusMine : bubbleRadiusTheirs
              }`} style={{
                backgroundColor: msg.isMine ? themeColors.myBubble : themeColors.theirBubble,
                color: msg.isMine ? themeColors.myText : themeColors.theirText,
                border: msg.isMine ? 'none' : `1px solid ${themeColors.theirBorder}`,
              }}>
                {/* Edit Mode */}
                {editingMessageId === msg.id ? (
                    <div className="flex flex-col gap-2 min-w-[200px] relative">
                        <input
                            ref={editInputRef}
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            onSelect={() => handleInputSelect('edit')}
                            className="w-full bg-transparent border-b border-white/20 outline-none pb-1 text-sm"
                            autoFocus
                        />
                        {/* Format toolbar for edit input */}
                        {showFormatBar && formatTarget === 'edit' && (
                          <div ref={formatBarRef} className="absolute -top-10 left-0 flex items-center gap-1 bg-[#1A1A2E] border border-white/10 rounded-lg px-1 py-1 shadow-lg z-50">
                            <button onClick={() => applyFormat('*', '*')} className="w-7 h-7 flex items-center justify-center text-white/70 hover:text-[#FF8C00] hover:bg-white/10 rounded-md transition-colors" title="Bold"><Bold size={13} /></button>
                            <button onClick={() => applyFormat('_', '_')} className="w-7 h-7 flex items-center justify-center text-white/70 hover:text-[#FF8C00] hover:bg-white/10 rounded-md transition-colors" title="Italic"><Italic size={13} /></button>
                            <button onClick={() => applyFormat('~', '~')} className="w-7 h-7 flex items-center justify-center text-white/70 hover:text-[#FF8C00] hover:bg-white/10 rounded-md transition-colors" title="Strikethrough"><Strikethrough size={13} /></button>
                            <button onClick={() => applyFormat('__', '__')} className="w-7 h-7 flex items-center justify-center text-white/70 hover:text-[#FF8C00] hover:bg-white/10 rounded-md transition-colors" title="Underline"><Underline size={13} /></button>
                          </div>
                        )}
                        {/* Formatting preview */}
                        {/[*_~]/.test(editContent) && (
                          <div className="text-xs opacity-60 px-1">{applyFormatting(editContent)}</div>
                        )}
                        <div className="flex justify-end gap-2 mt-1">
                            <button onClick={cancelEdit} className="p-1 hover:bg-white/10 rounded"><X size={14} /></button>
                            <button onClick={() => submitEdit(msg)} disabled={!editContent.trim() || editContent.trim() === msg.text} className="p-1 hover:bg-white/10 rounded text-[#10B981] disabled:opacity-30 disabled:cursor-not-allowed"><Check size={14} /></button>
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
                              {msg.replyToSender === 'me' || msg.replyToSender === currentUserId ? 'You' : (memberNames[msg.replyToSender || ''] || activeChat?.name || msg.replyToSender?.slice(0, ADDRESS_DISPLAY.MEDIUM) || 'User')}
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
                                        src={msg.attachment.cid.startsWith('Qm') || msg.attachment.cid.startsWith('bafy') ? `${IPFS_GATEWAY_URL}${msg.attachment.cid}` : msg.attachment.cid}
                                        alt="attachment"
                                        className="rounded-lg max-w-full h-auto max-h-[200px] cursor-pointer hover:opacity-90 transition-opacity"
                                        onClick={() => {
                                          const src = msg.attachment?.cid.startsWith('Qm') || msg.attachment?.cid.startsWith('bafy')
                                            ? `${IPFS_GATEWAY_URL}${msg.attachment?.cid}`
                                            : msg.attachment?.cid;
                                          if (src) setLightboxSrc(src);
                                        }}
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
                                                href={msg.attachment.cid.startsWith('Qm') ? `${IPFS_GATEWAY_URL}${msg.attachment.cid}` : '#'}
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
                            {memberNames[msg.senderId || ''] || msg.senderHash || msg.senderId?.slice(0, ADDRESS_DISPLAY.FULL_SHORT)}
                          </p>
                        )}
                        <p className="text-[15px] leading-relaxed">{renderMessageText(msg.text, isSearchMatch)}</p>
                        {linkPreviews && fetchLinkPreview && extractFirstUrl(msg.text) && (
                          <LinkPreviewCard url={extractFirstUrl(msg.text)!} fetchPreview={fetchLinkPreview} />
                        )}
                        <div className={`text-[10px] mt-2 font-mono opacity-60 flex items-center gap-1 ${msg.isMine ? 'justify-end' : 'justify-start'}`}>
                        {msg.time}
                        {msg.edited && (
                          <span
                            className="italic text-[#FF8C00] cursor-pointer hover:underline"
                            onClick={() => showEditHistory(msg.id)}
                            title={msg.editedAt ? `Edited ${new Date(msg.editedAt).toLocaleString()}${msg.editCount && msg.editCount > 1 ? ` (${msg.editCount} edits)` : ''}` : 'Edited'}
                          >
                            (edited{msg.editCount && msg.editCount > 1 ? ` x${msg.editCount}` : ''})
                          </span>
                        )}
                        {disappearTimer !== 'off' && <Timer size={8} className="ml-1 text-[#FF8C00]" />}
                        {msg.isMine && (
                            <MessageStatus status={msg.status} readAt={msg.readAt} />
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
                                className={`px-2 py-0.5 rounded-full text-xs border transition-all btn-press hover:scale-105 ${
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
                              className="p-1.5 rounded-lg text-[#888] hover:text-[#FF8C00] hover:bg-[#FFF3E0] btn-icon"
                            >
                              <Reply size={14} />
                            </button>
                            )}
                            {/* Emoji React */}
                            <button
                              onClick={() => setEmojiPickerMsgId(emojiPickerMsgId === msg.id ? null : msg.id)}
                              title="React"
                              className="p-1.5 rounded-lg text-[#888] hover:text-[#FF8C00] hover:bg-[#FFF3E0] btn-icon"
                            >
                              <Smile size={14} />
                            </button>
                            {/* Pin */}
                            {onPinMessage && (
                              <button
                                onClick={() => {
                                  const isPinned = pinnedMessages.some((p: PinnedMessage) => p.message_id === msg.id);
                                  if (isPinned && onUnpinMessage) {
                                    onUnpinMessage(msg.id);
                                  } else {
                                    onPinMessage(msg.id, msg.text);
                                  }
                                }}
                                title={pinnedMessages.some((p: PinnedMessage) => p.message_id === msg.id) ? 'Unpin' : 'Pin'}
                                className={`p-1.5 rounded-lg btn-icon ${
                                  pinnedMessages.some((p: PinnedMessage) => p.message_id === msg.id)
                                    ? 'text-[#FF8C00] bg-[#FFF3E0]'
                                    : 'text-[#888] hover:text-[#FF8C00] hover:bg-[#FFF3E0]'
                                }`}
                              >
                                <Pin size={14} />
                              </button>
                            )}
                            {/* Copy text */}
                            <button
                              onClick={() => { navigator.clipboard.writeText(msg.text).catch(() => toast.error('Failed to copy')); toast.success('Copied'); }}
                              title="Copy text"
                              className="p-1.5 rounded-lg text-[#888] hover:text-[#FF8C00] hover:bg-[#FFF3E0] btn-icon"
                            >
                              <Copy size={14} />
                            </button>
                            {/* Forward */}
                            {onForwardMessage && !roomChat && (
                            <button
                              onClick={() => setForwardingMsg({ text: msg.text, sender: msg.isMine ? 'You' : (memberNames[msg.senderId] || msg.senderId?.slice(0, 8) || 'User') })}
                              title="Forward"
                              className="p-1.5 rounded-lg text-[#888] hover:text-[#FF8C00] hover:bg-[#FFF3E0] btn-icon"
                            >
                              <Share2 size={14} />
                            </button>
                            )}
                            {msg.isMine && (
                              <>
                                <button onClick={() => handleEdit(msg)} title="Edit" className="p-1.5 rounded-lg text-[#888] hover:text-[#FF8C00] hover:bg-[#FFF3E0] btn-icon">
                                    <Edit2 size={14} />
                                </button>
                                <button onClick={() => handleDelete(msg)} title="Delete" className="p-1.5 rounded-lg text-[#888] hover:text-red-500 hover:bg-red-50 btn-icon">
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
                                  className="w-7 h-7 flex items-center justify-center hover:bg-[#F5F5F5] rounded-full text-sm btn-icon"
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

        {/* Drag and Drop Overlay */}
        <AnimatePresence>
          {isDragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[var(--accent-primary)] bg-opacity-10 border-4 border-dashed border-[var(--accent-primary)] rounded-2xl flex items-center justify-center z-50 pointer-events-none"
            >
              <div className="bg-white px-8 py-6 rounded-2xl shadow-2xl flex flex-col items-center gap-3">
                <Paperclip size={48} className="text-[var(--accent-primary)]" />
                <p className="text-lg font-bold text-[var(--accent-primary)]">Drop file to upload</p>
                <p className="text-sm text-[var(--text-secondary)]">Image or document</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Typing Indicator */}
      <AnimatePresence>
        {isTyping && (
          <TypingIndicator userName={typingUserName} isRoom={!!roomChat} />
        )}
      </AnimatePresence>

      {/* Input Area */}
      <div className="p-6 border-t" style={{ backgroundColor: themeColors.headerBg, borderColor: themeColors.theirBorder }}>
        {/* Blocked User Banner */}
        {isBlocked && !roomChat && (
          <div className="mb-3 flex items-center justify-between gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
            <div className="flex items-center gap-2">
              <Ban size={16} className="text-red-400" />
              <span className="text-sm text-red-600 font-medium">You blocked this user</span>
            </div>
            <button
              onClick={() => onUnblockUser?.()}
              className="text-xs font-bold text-red-500 hover:text-red-700 px-3 py-1 border border-red-300 rounded-lg hover:bg-red-100 transition-colors"
            >
              Unblock
            </button>
          </div>
        )}

        {/* Reply Bar */}
        {replyingTo && (
          <div className="mb-2 p-3 bg-[#FAFAFA] border border-[#E5E5E5] rounded-xl flex items-center justify-between animate-fade-in">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="w-1 h-8 bg-[#FF8C00] rounded-full flex-shrink-0" />
              <div className="overflow-hidden">
                <p className="text-xs font-bold text-[#FF8C00]">
                  {replyingTo.sender === 'me' || replyingTo.sender === currentUserId
                    ? 'Replying to yourself'
                    : `Replying to ${memberNames[replyingTo.sender] || activeChat?.name || replyingTo.sender.slice(0, ADDRESS_DISPLAY.FULL_SHORT) + '...'}`}
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
        <div className="rounded-2xl p-2 flex items-center gap-2 transition-all border" style={{ backgroundColor: themeColors.inputBg, borderColor: themeColors.inputBorder }}>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileSelect} 
            className="hidden" 
          />
          <button
            aria-label="Attach file"
            onClick={() => fileInputRef.current?.click()}
            className="w-10 h-10 flex items-center justify-center text-[#666] hover:text-[#0A0A0A] rounded-xl hover:bg-[#E5E5E5] btn-icon"
          >
            <Paperclip size={20} />
          </button>
          <div className="relative flex-1">
            <textarea
              ref={mainInputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setShowFormatBar(false);
                // Debounced typing indicator
                if (onTyping && e.target.value) {
                  if (!typingTimeoutRef.current) {
                    onTyping();
                  }
                  if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                  typingTimeoutRef.current = setTimeout(() => { typingTimeoutRef.current = null; }, 2000);
                }
              }}
              onSelect={() => handleInputSelect('main')}
              onKeyDown={handleKeyDown}
              placeholder={isBlocked && !roomChat ? "User blocked" : isSending ? "Encrypting & sending..." : roomChat ? `Message #${roomChat.name}...` : "Type an encrypted message..."}
              disabled={isSending || (isBlocked && !roomChat)}
              maxLength={MAX_MESSAGE_LENGTH}
              rows={1}
              className="w-full bg-transparent border-none focus:ring-0 placeholder-opacity-50 px-2 py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed resize-none overflow-hidden"
              style={{ color: themeColors.inputText, minHeight: '44px', maxHeight: '160px' }}
            />
            {input.length > MAX_MESSAGE_LENGTH * 0.9 && (
              <span className={`text-xs font-mono shrink-0 ${input.length >= MAX_MESSAGE_LENGTH ? 'text-red-500' : 'text-[#999]'}`}>
                {input.length}/{MAX_MESSAGE_LENGTH}
              </span>
            )}
            {/* Floating format toolbar */}
            <AnimatePresence>
              {showFormatBar && formatTarget === 'main' && (
                <motion.div
                  ref={formatBarRef}
                  initial={{ opacity: 0, y: 4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.95 }}
                  transition={{ duration: 0.12 }}
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex items-center gap-0.5 bg-[#0A0A0A] rounded-lg px-1 py-1 shadow-xl shadow-black/30 border border-[#2A2A2A] z-50"
                >
                  <button onClick={() => applyFormat('*', '*')} className="w-8 h-8 flex items-center justify-center text-white/70 hover:text-[#FF8C00] hover:bg-white/10 rounded-md transition-colors" title="Bold">
                    <Bold size={15} />
                  </button>
                  <button onClick={() => applyFormat('_', '_')} className="w-8 h-8 flex items-center justify-center text-white/70 hover:text-[#FF8C00] hover:bg-white/10 rounded-md transition-colors" title="Italic">
                    <Italic size={15} />
                  </button>
                  <button onClick={() => applyFormat('~', '~')} className="w-8 h-8 flex items-center justify-center text-white/70 hover:text-[#FF8C00] hover:bg-white/10 rounded-md transition-colors" title="Strikethrough">
                    <Strikethrough size={15} />
                  </button>
                  <button onClick={() => applyFormat('__', '__')} className="w-8 h-8 flex items-center justify-center text-white/70 hover:text-[#FF8C00] hover:bg-white/10 rounded-md transition-colors" title="Underline">
                    <Underline size={15} />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="relative" ref={emojiPickerContainerRef}>
            <button
              aria-label="Emoji"
              onClick={() => setShowInputEmojiPicker(prev => !prev)}
              className={`w-10 h-10 flex items-center justify-center rounded-xl btn-icon transition-colors ${showInputEmojiPicker ? 'text-[#FF8C00] bg-[#FFF3E0]' : 'text-[#666] hover:text-[#0A0A0A] hover:bg-[#E5E5E5]'}`}
            >
              <Smile size={20} />
            </button>
            <AnimatePresence>
              {showInputEmojiPicker && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-12 right-0 z-50 shadow-2xl rounded-xl overflow-hidden"
                >
                  <EmojiPicker
                    theme={Theme.DARK}
                    width={320}
                    height={400}
                    searchPlaceHolder="Search emoji..."
                    onEmojiClick={(emojiData) => {
                      const el = mainInputRef.current;
                      if (el) {
                        const start = el.selectionStart ?? input.length;
                        const end = el.selectionEnd ?? input.length;
                        const newValue = input.slice(0, start) + emojiData.emoji + input.slice(end);
                        setInput(newValue);
                        // Restore cursor after emoji
                        requestAnimationFrame(() => {
                          el.focus();
                          const pos = start + emojiData.emoji.length;
                          el.setSelectionRange(pos, pos);
                        });
                      } else {
                        setInput(prev => prev + emojiData.emoji);
                      }
                      setShowInputEmojiPicker(false);
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {/* Voice Message */}
          {isRecording ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-xl">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-xs font-mono text-red-600">{Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}</span>
              </div>
              <button
                aria-label="Cancel recording"
                onClick={cancelRecording}
                className="w-10 h-10 flex items-center justify-center text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                title="Cancel"
              >
                <X size={20} />
              </button>
              <button
                aria-label="Send voice message"
                onClick={async () => {
                  const recording = await stopRecording();
                  if (!recording) {
                    toast.error('Recording too short (min 1s)');
                    return;
                  }
                  const file = new File([recording.blob], `voice_${Date.now()}.webm`, { type: recording.blob.type });
                  onSendMessage(`Voice message (${recording.duration}s)`, file);
                  URL.revokeObjectURL(recording.url);
                }}
                className="w-10 h-10 flex items-center justify-center bg-[#FF8C00] text-white rounded-xl hover:bg-[#FF9F2A] transition-all btn-press"
                title="Send voice message"
              >
                <Send size={18} />
              </button>
            </div>
          ) : (
            <button
              aria-label="Record voice message"
              onClick={async () => {
                const ok = await startRecording();
                if (!ok) toast.error('Microphone access denied');
              }}
              className="w-10 h-10 flex items-center justify-center text-[#666] hover:text-[#FF8C00] rounded-xl hover:bg-[#FFF3E0] btn-icon transition-colors"
              title="Record voice message"
            >
              <Mic size={20} />
            </button>
          )}
          <button
            aria-label="Send message"
            onClick={handleSend}
            disabled={!input.trim() || isSending || (isBlocked && !roomChat) || isRecording}
            className="w-10 h-10 flex items-center justify-center bg-[#0A0A0A] text-white rounded-xl hover:bg-[#FF8C00] hover:text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed btn-press hover:shadow-lg hover:shadow-[#FF8C00]/20"
          >
            {isSending ? <div className="w-4 h-4 border-2 border-white/60 border-t-transparent rounded-full animate-spin" /> : <Send size={18} />}
          </button>
        </div>

        {/* Formatting Hint */}
        <div className="px-2 pt-2 text-[10px] text-[var(--text-tertiary)] font-mono flex items-center gap-3">
          <span className="opacity-60">Format:</span>
          <span className="hover:text-[var(--accent-primary)] transition-colors cursor-default">*bold*</span>
          <span className="hover:text-[var(--accent-primary)] transition-colors cursor-default">_italic_</span>
          <span className="hover:text-[var(--accent-primary)] transition-colors cursor-default">~strikethrough~</span>
          <span className="hover:text-[var(--accent-primary)] transition-colors cursor-default">__underline__</span>
        </div>
      </div>

      {/* Forward Message Modal */}
      <AnimatePresence>
        {forwardingMsg && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => { setForwardingMsg(null); setForwardSearch(''); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 border-b border-[#E5E5E5]">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[#0A0A0A] font-bold text-sm">Forward message</h3>
                  <button onClick={() => { setForwardingMsg(null); setForwardSearch(''); }} className="p-1 hover:bg-[#F5F5F5] rounded-lg">
                    <X size={16} className="text-[#888]" />
                  </button>
                </div>
                <div className="bg-[#F8F8F8] rounded-lg p-2 mb-3">
                  <p className="text-[10px] text-[#999] font-mono uppercase">From {forwardingMsg.sender}</p>
                  <p className="text-xs text-[#333] line-clamp-2">{forwardingMsg.text}</p>
                </div>
                <input
                  value={forwardSearch}
                  onChange={e => setForwardSearch(e.target.value)}
                  placeholder="Search contacts..."
                  className="w-full px-3 py-2 bg-[#F5F5F5] rounded-lg text-sm outline-none border border-transparent focus:border-[#FF8C00] transition-colors"
                  autoFocus
                />
              </div>
              <div className="max-h-60 overflow-y-auto">
                {forwardContacts
                  .filter(c => c.id !== chatId && (
                    c.name.toLowerCase().includes(forwardSearch.toLowerCase()) ||
                    c.address.includes(forwardSearch)
                  ))
                  .map(c => (
                    <button
                      key={c.id}
                      onClick={() => {
                        if (onForwardMessage) {
                          onForwardMessage(c.address, forwardingMsg.text, forwardingMsg.sender);
                          toast.success(`Forwarded to ${c.name}`);
                        }
                        setForwardingMsg(null);
                        setForwardSearch('');
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F8F8F8] transition-colors text-left"
                    >
                      <div className="w-8 h-8 rounded-full bg-[#FF8C00]/10 flex items-center justify-center text-[#FF8C00] text-xs font-bold">
                        {c.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#0A0A0A] truncate">{c.name}</p>
                        <p className="text-[10px] text-[#999] font-mono truncate">{c.address.slice(0, 14)}...{c.address.slice(-4)}</p>
                      </div>
                      <Share2 size={14} className="text-[#CCC]" />
                    </button>
                  ))}
                {forwardContacts.filter(c => c.id !== chatId && (
                  c.name.toLowerCase().includes(forwardSearch.toLowerCase()) ||
                  c.address.includes(forwardSearch)
                )).length === 0 && (
                  <p className="text-center text-sm text-[#999] py-8">No contacts found</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit History Modal */}
      <AnimatePresence>
        {editHistoryMsgId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setEditHistoryMsgId(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 border-b border-[#E5E5E5]">
                <div className="flex items-center justify-between">
                  <h3 className="text-[#0A0A0A] font-bold text-sm">Edit History</h3>
                  <button onClick={() => setEditHistoryMsgId(null)} className="p-1 hover:bg-[#F5F5F5] rounded-lg">
                    <X size={16} className="text-[#888]" />
                  </button>
                </div>
              </div>
              <div className="max-h-[300px] overflow-y-auto p-4 space-y-3">
                {editHistoryLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <div className="w-5 h-5 border-2 border-[#FF8C00] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : editHistoryEntries.length === 0 ? (
                  <p className="text-center text-sm text-[#999] py-4">No previous versions found</p>
                ) : (
                  <>
                    {/* Current version header */}
                    <div className="pb-2 border-b border-[#E5E5E5]">
                      <p className="text-xs font-mono text-[#FF8C00]">Current version</p>
                      <p className="text-sm text-[#333] mt-1">
                        {messages.find(m => m.id === editHistoryMsgId)?.text || 'Current message'}
                      </p>
                    </div>
                    {/* Previous versions */}
                    {editHistoryEntries.map((entry, idx) => (
                      <div key={idx} className="pb-2 border-b border-[#F0F0F0] last:border-0">
                        <p className="text-[10px] font-mono text-[#999]">
                          {new Date(Number(entry.edited_at)).toLocaleString()}
                        </p>
                        <p className="text-xs text-[#666] mt-1 italic">Previous version (encrypted)</p>
                      </div>
                    ))}
                    <p className="text-[10px] text-[#999] text-center pt-2">
                      {editHistoryEntries.length} previous {editHistoryEntries.length === 1 ? 'version' : 'versions'}
                    </p>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scroll to Bottom FAB */}
      <ScrollToBottomButton
        show={showScrollFAB}
        unreadCount={unreadCount}
        onClick={() => scrollToBottom(true)}
      />

      {/* Image Lightbox */}
      <ImageLightbox
        src={lightboxSrc || ''}
        alt="Attachment"
        isOpen={!!lightboxSrc}
        onClose={() => setLightboxSrc(null)}
      />
    </div>
  );
};

export default ChatArea;
