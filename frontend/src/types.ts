
export type Status = 'online' | 'offline' | 'away';
export type AppView = 'chats' | 'channels' | 'groups' | 'settings' | 'contacts' | 'notifications';

export type RoomType = 'channel' | 'group';

export interface Room {
  id: string;
  name: string;
  createdBy: string;
  isPrivate: boolean;
  type: RoomType;
  memberCount?: number;
  lastMessage?: string;
  lastMessageTime?: string;
}

export interface Chat {
  id: string;
  name: string;
  avatar: string;
  status: Status;
  lastMessage: string;
  time: string;
  unreadCount: number;
  type: 'private' | 'group';
  address?: string;
}

export interface Message {
  id: string;
  text: string;
  time: string;
  timestamp?: number;
  senderId: string;
  isMine: boolean;
  status: 'sent' | 'delivered' | 'read' | 'pending' | 'confirmed' | 'failed' | 'included';
  attachment?: {
    type: 'image' | 'file';
    cid: string;
    name?: string;
    size?: number;
    mimeType?: string;
  };
  // Reply
  replyToId?: string;
  replyToText?: string;
  replyToSender?: string;
  // Edit indicator
  edited?: boolean;
  // Reactions (emoji -> count + who reacted)
  reactions?: Record<string, string[]>; // emoji -> [userId, ...]
  // PrivTok-style metadata
  senderHash?: string;
  recipientHash?: string;
  dialogHash?: string;
  // Aleo transaction ID (blockchain proof)
  txId?: string;
}

export type DisappearTimer = 'off' | '30s' | '5m' | '1h' | '24h';

export const DISAPPEAR_TIMERS: Record<DisappearTimer, number> = {
  'off': 0,
  '30s': 30_000,
  '5m': 5 * 60_000,
  '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000
};

export type ChatContextAction = 'open_new_tab' | 'mark_unread' | 'pin' | 'mute' | 'archive' | 'delete' | 'rename';

export type NotificationType = 'message' | 'system' | 'security' | 'transaction';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
  /** Optional chat/contact ID to navigate to */
  chatId?: string;
}

export interface User {
  id: string;
  name: string;
  wallet: string;
  avatar: string;
  balance: string;
}

export interface Contact {
  id: string;
  name: string;
  description: string;
  context: string;
  initials: string;
  address?: string;
  dialogHash?: string;
  lastMessage?: string;
  lastMessageTime?: Date;
  unreadCount?: number;
  hideAvatar?: boolean;
}
