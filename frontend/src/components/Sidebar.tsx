
import React, { useState, useEffect, useRef } from 'react';
import { Search, Settings, Wallet, Users, MessageSquare, Plus, Ghost, ShieldCheck, LogOut, Radio, Hash, Lock, User, ExternalLink, Eye, Pin, BellOff, Bell, Archive, Trash2, Edit2 } from 'lucide-react';
import { Spinner } from './ui/Spinner';
import { Chat, AppView, Room, RoomType, ChatContextAction } from '../types';
import Avatar from './Avatar';

interface SidebarProps {
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
  currentView: AppView;
  onSetView: (view: AppView) => void;
  isWalletConnected: boolean;
  onConnectWallet: () => void;
  onDisconnect: () => void;
  chats: Chat[];
  isConnecting?: boolean;
  publicKey?: string | null;
  balance?: number | null;
  channels?: Room[];
  groups?: Room[];
  activeRoomId?: string | null;
  onSelectRoom?: (id: string) => void;
  onCreateRoom?: (name: string, type: RoomType) => void;
  onFabClick?: () => void;
  onContextAction?: (action: ChatContextAction, id: string, type: 'chat' | 'channel' | 'group', newName?: string) => void;
  pinnedIds?: string[];
  mutedIds?: string[];
  avatarColor?: string;
  username?: string;
  unreadNotifications?: number;
  showOnlineStatus?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({
  activeChatId,
  onSelectChat,
  isOpen,
  onClose,
  currentView,
  onSetView,
  isWalletConnected,
  onConnectWallet,
  onDisconnect,
  chats,
  isConnecting = false,
  publicKey,
  balance,
  channels = [],
  groups = [],
  activeRoomId,
  onSelectRoom,
  onCreateRoom,
  onFabClick,
  onContextAction,
  pinnedIds = [],
  mutedIds = [],
  avatarColor,
  username,
  unreadNotifications = 0,
  showOnlineStatus = true
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [navHovered, setNavHovered] = useState(false);

  // Context Menu State
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: string; itemType: 'chat' | 'channel' | 'group' } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  // Rename Modal State
  const [renameTarget, setRenameTarget] = useState<{ id: string; itemType: 'chat' | 'channel' | 'group'; currentName: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    setSearchQuery('');
  }, [currentView]);

  // Close context menu on click outside or scroll
  useEffect(() => {
    const close = () => setCtxMenu(null);
    document.addEventListener('click', close);
    document.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('click', close); document.removeEventListener('scroll', close, true); };
  }, []);

  const handleContextMenu = (e: React.MouseEvent, id: string, itemType: 'chat' | 'channel' | 'group') => {
    e.preventDefault();
    e.stopPropagation();
    // Position within the list panel (relative to viewport)
    const x = e.clientX;
    const y = e.clientY;
    setCtxMenu({ x, y, id, itemType });
  };

  const handleCtxAction = (action: ChatContextAction) => {
    if (!ctxMenu) return;
    if (action === 'rename') {
      // Find current name
      let currentName = '';
      if (ctxMenu.itemType === 'chat') {
        currentName = chats.find(c => c.id === ctxMenu.id)?.name || '';
      } else if (ctxMenu.itemType === 'channel') {
        currentName = channels.find(c => c.id === ctxMenu.id)?.name || '';
      } else {
        currentName = groups.find(g => g.id === ctxMenu.id)?.name || '';
      }
      setRenameTarget({ id: ctxMenu.id, itemType: ctxMenu.itemType, currentName });
      setRenameValue(currentName);
      setCtxMenu(null);
      return;
    }
    if (onContextAction) {
      onContextAction(action, ctxMenu.id, ctxMenu.itemType);
    }
    setCtxMenu(null);
  };

  const submitRename = () => {
    if (!renameTarget || !renameValue.trim()) return;
    if (onContextAction) {
      onContextAction('rename', renameTarget.id, renameTarget.itemType, renameValue.trim());
    }
    setRenameTarget(null);
    setRenameValue('');
  };

  const filteredChats = chats.filter(chat =>
    chat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Sort: pinned first, then by time
  const sortedChats = [...filteredChats].sort((a, b) => {
    const aPinned = pinnedIds.includes(a.id) ? 0 : 1;
    const bPinned = pinnedIds.includes(b.id) ? 0 : 1;
    return aPinned - bPinned;
  });

  const showListPanel = currentView === 'chats' || currentView === 'channels' || currentView === 'groups';

  const NavItem = ({ icon, view, label, badge, disabled }: { icon: React.ReactNode, view: AppView, label: string, badge?: number, disabled?: boolean }) => (
    <button
      onClick={() => !disabled && onSetView(view)}
      className={`relative flex items-center rounded-xl transition-all whitespace-nowrap ${
        navHovered ? 'w-full gap-3 px-3 py-2.5' : 'w-10 h-10 justify-center mx-auto'
      } ${
        disabled
        ? 'opacity-30 cursor-not-allowed text-[#444]'
        : currentView === view
        ? 'bg-[#FF8C00] text-black shadow-lg shadow-[#FF8C00]/20'
        : 'text-[#666] hover:bg-[#1A1A1A] hover:text-white'
      }`}
      title={disabled ? `${label} (Soon)` : label}
    >
      <span className="shrink-0 flex items-center justify-center">{icon}</span>
      <span className={`text-sm font-medium truncate transition-[opacity,max-width] duration-300 ${navHovered ? 'opacity-100 max-w-[120px]' : 'opacity-0 max-w-0'} overflow-hidden`}>{label}</span>
      {badge && badge > 0 && (
        <span className={`absolute ${navHovered ? 'right-2' : '-top-0.5 -right-0.5'} min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );

  const listTitle = currentView === 'chats' ? 'Messages' : currentView === 'channels' ? 'Channels' : 'Groups';

  return (
    <div
      className={`fixed lg:relative z-50 h-screen flex transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0 pointer-events-auto' : '-translate-x-full lg:translate-x-0 pointer-events-none lg:pointer-events-auto'}`}
    >
      {/* Column 1: Navigation Bar — fixed 60px base, expands as overlay on hover */}
      <div className="w-[60px] shrink-0 relative z-20">
        <div
          onMouseEnter={() => setNavHovered(true)}
          onMouseLeave={() => setNavHovered(false)}
          className={`absolute top-0 left-0 h-full ${navHovered ? 'w-[200px]' : 'w-[60px]'} transition-[width] duration-300 ease-in-out bg-[#0A0A0A] border-r border-[#1A1A1A] flex flex-col py-4 ${navHovered ? 'px-3' : 'px-2'} overflow-hidden`}
        >
        {/* Ghost Logo */}
        <div className={`flex items-center mb-6 whitespace-nowrap ${navHovered ? 'gap-3 px-1' : 'justify-center'}`}>
          <div className="w-10 h-10 bg-[#FF8C00] rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(255,140,0,0.3)] shrink-0">
            <Ghost size={20} className="text-black" />
          </div>
          <span className={`text-white font-bold text-lg transition-[opacity,max-width] duration-300 ${navHovered ? 'opacity-100 max-w-[100px]' : 'opacity-0 max-w-0'} overflow-hidden`}>Ghost</span>
        </div>

        {/* Nav Items */}
        <div className={`${navHovered ? 'space-y-1' : 'space-y-2 flex flex-col items-center'}`}>
          <NavItem icon={<MessageSquare size={18} />} view="chats" label="Messages" />
          <NavItem icon={<Radio size={18} />} view="channels" label="Channels" disabled />
          <NavItem icon={<Users size={18} />} view="groups" label="Groups" disabled />
          <NavItem icon={<User size={18} />} view="contacts" label="Contacts" />
          <NavItem icon={<Bell size={18} />} view="notifications" label="Notifications" badge={unreadNotifications} />
          <NavItem icon={<Settings size={18} />} view="settings" label="Settings" />
        </div>

        <div className="flex-1" />

        {/* Wallet Section */}
        {isWalletConnected ? (
          <div className={`border-t border-[#1A1A1A] pt-3 mt-3 overflow-hidden whitespace-nowrap ${navHovered ? '' : 'flex flex-col items-center'}`}>
            <div className={`flex items-center ${navHovered ? 'gap-3 px-1 mb-2' : 'justify-center mb-2'}`}>
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0 relative"
                style={{ backgroundColor: avatarColor || '#FF8C00' }}
              >
                {username ? username.slice(0, 2).toUpperCase() : publicKey ? publicKey.slice(0, 2).toUpperCase() : '?'}
                {showOnlineStatus && <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-[#10B981] rounded-full border-2 border-[#0A0A0A]" />}
              </div>
              <div className={`flex flex-col transition-[opacity,max-width] duration-300 ${navHovered ? 'opacity-100 max-w-[140px]' : 'opacity-0 max-w-0'} overflow-hidden`}>
                {username && <span className="text-white text-sm font-bold truncate">{username}</span>}
                <span className="text-[#666] font-mono text-xs truncate">
                  {publicKey ? `${publicKey.slice(0, 8)}...${publicKey.slice(-4)}` : ''}
                </span>
              </div>
            </div>
            <div className={`flex items-center ${navHovered ? 'justify-between px-1' : 'justify-center'}`}>
              <span className={`text-[#FF8C00] font-mono text-xs font-bold transition-[opacity,max-width] duration-300 ${navHovered ? 'opacity-100 max-w-[100px]' : 'opacity-0 max-w-0'} overflow-hidden`}>
                {balance !== undefined && balance !== null ? balance.toFixed(2) : '--'} ALEO
              </span>
              <button
                onClick={onDisconnect}
                className={`rounded-xl flex items-center justify-center text-[#666] hover:text-red-500 hover:bg-[#1A1A1A] transition-colors shrink-0 ${navHovered ? 'w-7 h-7 rounded-lg' : 'w-10 h-10 mx-auto'}`}
                title="Disconnect"
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={onConnectWallet}
            disabled={isConnecting}
            className={`flex items-center justify-center gap-2 bg-[#1A1A1A] rounded-xl py-2.5 text-[#FF8C00] hover:bg-[#2A2A2A] transition-colors disabled:opacity-50 ${navHovered ? 'w-full' : 'w-10 h-10 mx-auto'}`}
            title="Connect Wallet"
          >
            {isConnecting ? (
              <Spinner size="sm" className="border-[#FF8C00]/20 border-t-[#FF8C00]" />
            ) : (
              <>
                <Wallet size={16} className="shrink-0" />
                <span className={`text-sm font-medium transition-[opacity,max-width] duration-300 ${navHovered ? 'opacity-100 max-w-[80px]' : 'opacity-0 max-w-0'} overflow-hidden`}>Connect</span>
              </>
            )}
          </button>
        )}
        </div>
      </div>

      {/* Column 2: List Panel — outer clips, inner stays 280px (no reflow) */}
      <div className={`shrink-0 h-screen overflow-hidden transition-[width,opacity] duration-300 ease-in-out ${
        showListPanel ? 'w-[280px] opacity-100' : 'w-0 opacity-0 pointer-events-none'
      }`}>
        <div className="w-[280px] min-w-[280px] h-full bg-[#0A0A0A] border-r border-[#1A1A1A] flex flex-col relative">
          {/* Panel Header */}
          <div className="p-4 pb-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-bold text-lg">{listTitle}</h2>
              <ShieldCheck size={16} className="text-[#10B981]" />
            </div>
            {/* Search */}
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666] group-focus-within:text-[#FF8C00] transition-colors" size={14} />
              <input
                type="text"
                placeholder={`Search ${listTitle.toLowerCase()}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl py-2 pl-9 pr-4 text-white text-sm focus:outline-none focus:border-[#FF8C00] transition-all"
              />
            </div>
          </div>

          {/* List Content */}
          <div className="flex-1 overflow-y-auto px-3 pb-16 space-y-1 dark-scrollbar">
            {/* Chats List */}
            {currentView === 'chats' && sortedChats.map((chat) => (
              <div
                key={chat.id}
                onClick={() => { onSelectChat(chat.id); onClose(); }}
                onContextMenu={(e) => handleContextMenu(e, chat.id, 'chat')}
                className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all border ${
                  activeChatId === chat.id
                    ? 'bg-[#1A1A1A] border-[#FF8C00]/50'
                    : 'bg-transparent border-transparent hover:bg-[#1A1A1A]'
                }`}
              >
                <div className="relative shrink-0">
                  <Avatar src={chat.avatar} status={chat.status} isActive={activeChatId === chat.id} />
                  {chat.unreadCount > 0 && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-[#FF8C00] rounded-full flex items-center justify-center text-[9px] text-black font-bold">
                      {chat.unreadCount}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <h3 className={`text-sm font-bold truncate ${activeChatId === chat.id ? 'text-white' : 'text-[#E5E5E5]'}`}>
                      {pinnedIds.includes(chat.id) && <Pin size={10} className="inline mr-1 text-[#FF8C00]" />}
                      {mutedIds.includes(chat.id) && <BellOff size={10} className="inline mr-1 text-[#666]" />}
                      {chat.name}
                    </h3>
                    <span className="text-[10px] text-[#666] font-mono shrink-0 ml-2">{chat.time}</span>
                  </div>
                  <p className="text-xs text-[#888] truncate font-light">{chat.lastMessage}</p>
                </div>
              </div>
            ))}

            {/* Channels — Coming Soon */}
            {currentView === 'channels' && (
              <div className="flex flex-col items-center justify-center py-16 px-4">
                <div className="w-16 h-16 bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl flex items-center justify-center mb-4">
                  <Radio size={28} className="text-[#FF8C00]/40" />
                </div>
                <h3 className="text-white font-bold text-base mb-1">Channels</h3>
                <p className="text-[#666] text-xs text-center">Coming soon</p>
              </div>
            )}

            {/* Groups — Coming Soon */}
            {currentView === 'groups' && (
              <div className="flex flex-col items-center justify-center py-16 px-4">
                <div className="w-16 h-16 bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl flex items-center justify-center mb-4">
                  <Users size={28} className="text-[#FF8C00]/40" />
                </div>
                <h3 className="text-white font-bold text-base mb-1">Groups</h3>
                <p className="text-[#666] text-xs text-center">Coming soon</p>
              </div>
            )}

            {/* Empty State */}
            {currentView === 'chats' && filteredChats.length === 0 && (
              <div className="text-center py-8">
                <MessageSquare size={24} className="text-[#333] mx-auto mb-2" />
                <p className="text-[#666] text-xs">No conversations yet</p>
              </div>
            )}
          </div>

          {/* FAB Create Button - only for chats */}
          {onFabClick && currentView === 'chats' && (
            <button
              onClick={onFabClick}
              className="absolute bottom-5 right-5 w-12 h-12 bg-[#FF8C00] rounded-full flex items-center justify-center text-black shadow-lg shadow-[#FF8C00]/30 hover:shadow-[#FF8C00]/50 hover:scale-110 active:scale-95 transition-all duration-200 z-10"
              title="New Message"
            >
              <Plus size={22} />
            </button>
          )}
        </div>
      </div>

      {/* Rename Modal */}
      {renameTarget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setRenameTarget(null); setRenameValue(''); }}>
          <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-5 w-[360px] max-w-[90vw] shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-white text-base font-bold mb-3">
              Rename {renameTarget.itemType === 'chat' ? 'Contact' : renameTarget.itemType === 'channel' ? 'Channel' : 'Group'}
            </h3>
            <input
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && renameValue.trim()) submitRename();
                if (e.key === 'Escape') { setRenameTarget(null); setRenameValue(''); }
              }}
              autoFocus
              className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl py-2.5 px-4 text-white text-sm focus:outline-none focus:border-[#FF8C00] transition-colors mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={submitRename}
                disabled={!renameValue.trim() || renameValue.trim() === renameTarget.currentName}
                className="flex-1 py-2 bg-[#FF8C00] text-black font-bold rounded-xl hover:bg-[#FF9F2A] transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm"
              >
                Save
              </button>
              <button
                onClick={() => { setRenameTarget(null); setRenameValue(''); }}
                className="flex-1 py-2 bg-[#2A2A2A] text-[#888] font-bold rounded-xl hover:bg-[#333] transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu (portal-style, fixed position) */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="fixed z-[100] w-52 bg-[#1A1A1A] border border-[#2A2A2A] rounded-xl shadow-2xl overflow-hidden animate-scale-in"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => handleCtxAction('open_new_tab')} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#E5E5E5] hover:bg-[#2A2A2A] transition-colors">
            <ExternalLink size={16} className="text-[#888] shrink-0" /> Open in new tab
          </button>
          <button onClick={() => handleCtxAction('mark_unread')} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#E5E5E5] hover:bg-[#2A2A2A] transition-colors">
            <Eye size={16} className="text-[#888] shrink-0" /> Mark as unread
          </button>
          <div className="border-t border-[#2A2A2A]" />
          <button onClick={() => handleCtxAction('pin')} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#E5E5E5] hover:bg-[#2A2A2A] transition-colors">
            <Pin size={16} className={`shrink-0 ${pinnedIds.includes(ctxMenu.id) ? 'text-[#FF8C00]' : 'text-[#888]'}`} />
            {pinnedIds.includes(ctxMenu.id) ? 'Unpin' : 'Pin'}
          </button>
          <button onClick={() => handleCtxAction('mute')} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#E5E5E5] hover:bg-[#2A2A2A] transition-colors">
            <BellOff size={16} className={`shrink-0 ${mutedIds.includes(ctxMenu.id) ? 'text-[#FF8C00]' : 'text-[#888]'}`} />
            {mutedIds.includes(ctxMenu.id) ? 'Unmute' : 'Mute'}
          </button>
          <button onClick={() => handleCtxAction('rename')} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#E5E5E5] hover:bg-[#2A2A2A] transition-colors">
            <Edit2 size={16} className="text-[#888] shrink-0" /> Rename
          </button>
          <button onClick={() => handleCtxAction('archive')} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#E5E5E5] hover:bg-[#2A2A2A] transition-colors">
            <Archive size={16} className="text-[#888] shrink-0" /> Archive
          </button>
          <div className="border-t border-[#2A2A2A]" />
          <button onClick={() => handleCtxAction('delete')} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 size={16} className="shrink-0" /> Delete {ctxMenu.itemType === 'chat' ? 'Chat' : ctxMenu.itemType === 'channel' ? 'Channel' : 'Group'}
          </button>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
