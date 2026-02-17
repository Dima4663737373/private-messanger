
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
  // Read receipt timestamp
  readAt?: number;
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

// ═══════════════════════════════════════════════════════════
// Backend API Response Types (replace 'any' with these)
// ═══════════════════════════════════════════════════════════

/** Raw message from backend database */
export interface RawMessage {
  id: string;
  sender: string;
  recipient: string;
  encrypted_payload: string;
  encrypted_payload_self?: string;
  timestamp: number;
  status: string;
  sender_hash?: string;
  recipient_hash?: string;
  dialog_hash?: string;
  attachment_part1?: string;
  attachment_part2?: string;
  content_encrypted?: string;
  reply_to_id?: string;
  reply_to_text?: string;
  reply_to_sender?: string;
  edited?: boolean;
  read_at?: number;
}

/** Raw room from backend database */
export interface RawRoom {
  id: string;
  name: string;
  created_by: string;
  is_private: boolean;
  type: 'channel' | 'group';
  memberCount?: number;
  lastMessage?: string;
  lastMessageTime?: string | number;
}

/** Raw room message from backend database */
export interface RawRoomMessage {
  id: string;
  room_id: string;
  sender: string;
  sender_name?: string;
  text: string;
  timestamp: number;
}

/** Pinned message from backend */
export interface PinnedMessage {
  id: number;
  context_id: string;
  message_id: string;
  pinned_by: string;
  message_text?: string;
}

/** Network profile search result */
export interface NetworkProfile {
  address: string;
  username: string;
  bio?: string;
  encryption_public_key?: string;
  show_avatar?: boolean;
  show_last_seen?: boolean;
}

/** Backend profile response */
export interface ProfileResponse {
  exists: boolean;
  profile?: {
    address_hash: string;
    username?: string;
    bio?: string;
    encryption_public_key?: string;
    show_avatar?: boolean;
    show_last_seen?: boolean;
  };
}

/** Online status response */
export interface OnlineStatusResponse {
  online: boolean;
  lastSeen?: number;
}

/** Link preview response */
export interface LinkPreviewResponse {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  url: string;
}

/** Wallet adapter interface for Aleo transactions */
export interface WalletAdapter {
  requestTransaction: (transaction: AleoTransaction) => Promise<string>;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  requestRecordPlaintexts?: (program: string) => Promise<RecordPlaintextsResult>;
}

/** Aleo transaction structure */
export interface AleoTransaction {
  address: string;
  chainId: string;
  fee: number;
  feePrivate: boolean;
  transitions: Array<{
    program: string;
    functionName: string;
    inputs: string[];
  }>;
}

/** Record plaintexts result */
export interface RecordPlaintextsResult {
  records?: Array<{
    plaintext?: string;
  }>;
}
