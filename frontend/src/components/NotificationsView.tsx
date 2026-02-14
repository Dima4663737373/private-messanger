import React from 'react';
import { Bell, MessageSquare, Shield, Zap, X, CheckCheck, Trash2 } from 'lucide-react';
import { AppNotification } from '../types';

interface NotificationsViewProps {
  notifications: AppNotification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  onNavigate?: (chatId: string) => void;
}

const ICON_MAP: Record<AppNotification['type'], { icon: React.ReactNode; color: string }> = {
  message: { icon: <MessageSquare size={16} />, color: 'text-[#3B82F6]' },
  system: { icon: <Zap size={16} />, color: 'text-[#F59E0B]' },
  security: { icon: <Shield size={16} />, color: 'text-[#EF4444]' },
  transaction: { icon: <Zap size={16} />, color: 'text-[#10B981]' },
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const NotificationsView: React.FC<NotificationsViewProps> = ({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onClearAll,
  onNavigate,
}) => {
  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="flex-1 bg-white flex flex-col h-screen overflow-y-auto animate-slide-up">
      <div className="p-8 flex items-start justify-between">
        <div>
          <h2 className="text-4xl font-bold mb-2 tracking-tighter text-[#0A0A0A]">NOTIFICATIONS</h2>
          <p className="text-[#666]">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
        {notifications.length > 0 && (
          <div className="flex gap-2 mt-2">
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllRead}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[#3B82F6] bg-[#EFF6FF] rounded-lg hover:bg-[#DBEAFE] transition-colors"
              >
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
            <button
              onClick={onClearAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[#999] bg-[#F5F5F5] rounded-lg hover:bg-[#E5E5E5] transition-colors"
            >
              <Trash2 size={14} /> Clear
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 px-8 pb-8">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <div className="w-20 h-20 bg-[#FFF7ED] rounded-full flex items-center justify-center mb-4">
              <Bell size={36} className="text-[#F59E0B]/50" />
            </div>
            <h3 className="text-xl font-bold text-[#0A0A0A] mb-2">No notifications</h3>
            <p className="text-[#666] max-w-sm">
              When you receive messages, transaction confirmations, or system alerts, they will appear here.
            </p>
          </div>
        ) : (
          <div className="max-w-2xl space-y-2">
            {notifications.map(notif => {
              const { icon, color } = ICON_MAP[notif.type];
              return (
                <div
                  key={notif.id}
                  className={`group relative bg-[#FAFAFA] border rounded-2xl p-4 transition-colors cursor-pointer ${
                    notif.read
                      ? 'border-[#E5E5E5]'
                      : 'border-[#FF8C00]/30 bg-[#FFF7ED]'
                  }`}
                  onClick={() => {
                    if (!notif.read) onMarkRead(notif.id);
                    if (notif.chatId && onNavigate) onNavigate(notif.chatId);
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 ${color}`}>{icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className={`text-sm font-bold truncate ${notif.read ? 'text-[#666]' : 'text-[#0A0A0A]'}`}>
                          {notif.title}
                        </h4>
                        <span className="text-xs text-[#999] whitespace-nowrap shrink-0">{timeAgo(notif.timestamp)}</span>
                      </div>
                      <p className={`text-sm mt-0.5 ${notif.read ? 'text-[#999]' : 'text-[#666]'}`}>
                        {notif.body}
                      </p>
                    </div>
                    {!notif.read && (
                      <div className="w-2 h-2 bg-[#FF8C00] rounded-full mt-2 shrink-0" />
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDismiss(notif.id); }}
                    className="absolute top-3 right-3 p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-[#E5E5E5] transition-all"
                  >
                    <X size={14} className="text-[#999]" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsView;
