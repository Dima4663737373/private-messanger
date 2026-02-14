// ── Domain Types ──────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  publicKey: string;   // NaCl box public key (base64)
  createdAt: number;
}

export type RoomType = 'channel' | 'group';

export interface Room {
  id: string;
  name: string;
  createdBy: string;   // userId
  isPrivate: boolean;
  type: RoomType;
  createdAt: number;
}

export interface RoomMember {
  roomId: string;
  userId: string;
  encryptedRoomKey: string; // Room key encrypted for this user (base64)
  joinedAt: number;
}

export interface EncryptedMessage {
  id: string;
  roomId: string | null;     // null → DM
  senderId: string;
  recipientId: string | null; // null → room broadcast
  payload: string;            // NaCl ciphertext (base64)
  nonce: string;              // NaCl nonce (base64)
  timestamp: number;
}

export interface SecretMessage {
  id: string;
  senderId: string;
  recipientId: string;
  payload: string;            // NaCl box ciphertext
  ephemeralPk: string;        // One-time public key
  nonce: string;
  aleoHash: string;           // Hash registered on Aleo
  createdAt: number;
  expiresAt: number;
}

// ── WebSocket Protocol ──────────────────────────────────────

export type ClientMsg =
  | { type: 'auth'; username: string; publicKey: string }
  | { type: 'join_room'; roomId: string; encryptedRoomKey?: string }
  | { type: 'leave_room'; roomId: string }
  | { type: 'delete_room'; roomId: string }
  | { type: 'clear_dm'; recipientId: string }
  | { type: 'create_room'; name: string; isPrivate: boolean; roomType: RoomType }
  | { type: 'message'; roomId?: string; recipientId?: string; payload: string; nonce: string }
  | { type: 'secret'; recipientId: string; payload: string; ephemeralPk: string; nonce: string; aleoHash: string }
  | { type: 'read_secret'; messageId: string }
  | { type: 'typing'; roomId?: string; recipientId?: string }
  | { type: 'heartbeat' };

export type ServerMsg =
  | { type: 'auth_ok'; userId: string; users: Pick<User, 'id' | 'username' | 'publicKey'>[] }
  | { type: 'error'; message: string }
  | { type: 'user_joined'; user: Pick<User, 'id' | 'username' | 'publicKey'> }
  | { type: 'user_left'; userId: string }
  | { type: 'room_created'; room: Room }
  | { type: 'room_joined'; roomId: string; userId: string; members: string[] }
  | { type: 'room_left'; roomId: string; userId: string }
  | { type: 'room_deleted'; roomId: string }
  | { type: 'dm_cleared'; recipientId: string }
  | { type: 'message'; message: EncryptedMessage }
  | { type: 'secret_available'; id: string; senderId: string; aleoHash: string }
  | { type: 'secret_data'; message: SecretMessage }
  | { type: 'secret_read'; messageId: string }
  | { type: 'typing'; userId: string; roomId?: string }
  | { type: 'online'; userId: string; online: boolean }
  | { type: 'room_list'; rooms: Room[] };
