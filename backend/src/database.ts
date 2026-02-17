import { Sequelize, DataTypes, Model } from 'sequelize';
import path from 'path';

// ── Database Configuration ──────────────────────
// Priority: DATABASE_URL (PostgreSQL) > SQLite (local dev)
const DATABASE_URL = process.env.DATABASE_URL;

let sequelize: Sequelize;
let usingSQLite = false;

if (DATABASE_URL) {
  // PostgreSQL — persistent storage (Railway, Supabase, etc.)
  // Railway internal network (.railway.internal) and localhost don't use SSL
  const noSSL = DATABASE_URL.includes('localhost') || DATABASE_URL.includes('.railway.internal');
  sequelize = new Sequelize(DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
    ...(noSSL ? {} : {
      dialectOptions: {
        ssl: { require: true, rejectUnauthorized: false },
      },
    }),
    pool: { max: 10, min: 2, acquire: 30000, idle: 10000 },
  });
  console.log(`[DB] Using PostgreSQL (persistent storage, SSL: ${!noSSL})`);
} else {
  // SQLite — local development only
  usingSQLite = true;
  const DB_ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY;

  let dialectModule: any;
  if (DB_ENCRYPTION_KEY) {
    try {
      dialectModule = require('@journeyapps/sqlcipher');
      console.log('[DB] SQLCipher module loaded — encryption enabled');
    } catch (err) {
      console.error('[DB] FATAL: DB_ENCRYPTION_KEY is set but @journeyapps/sqlcipher package is not installed!');
      throw new Error('SQLCipher module required but not installed');
    }
  } else {
    console.warn('[DB] WARNING: Using SQLite without encryption (local dev only)');
    console.warn('[DB] Set DATABASE_URL for persistent PostgreSQL in production!');
  }

  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, '../database.sqlite'),
    logging: false,
    ...(dialectModule ? { dialectModule } : {}),
  });
  console.log('[DB] Using SQLite (local development)');
}

export class SyncStatus extends Model {
  declare id: number;
  declare last_block_height: number;
}

SyncStatus.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  last_block_height: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
}, { sequelize, modelName: 'SyncStatus' });

export class Profile extends Model {
  declare address: string;
  declare username: string;
  declare bio: string;
  declare tx_id: string;
  declare encryption_public_key: string;
  declare address_hash: string;
  declare avatar_cid: string;
  declare show_last_seen: boolean;
  declare show_avatar: boolean;
  declare last_seen: number;
}

Profile.init({
  address: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  username: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  bio: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  tx_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  encryption_public_key: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  address_hash: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  avatar_cid: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  show_last_seen: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  show_avatar: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  last_seen: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
}, { sequelize, modelName: 'Profile' });

export class Message extends Model {
  declare id: string; // This will be the tx_id
  declare sender: string;
  declare recipient: string;
  declare encrypted_payload: string;
  declare encrypted_payload_self: string;
  declare nonce: string;
  declare signature: string;
  declare timestamp: number;
  declare block_height: number;
  declare status: string;
  
  // New fields for PrivTok-style architecture
  declare sender_hash: string;
  declare recipient_hash: string;
  declare dialog_hash: string;
  declare attachment_part1: string;
  declare attachment_part2: string;
  declare reply_to_id: string;
  declare reply_to_text: string;
  declare reply_to_sender: string;
  declare read_at: number;
  declare edited_at: number;
  declare edit_count: number;
}

Message.init({
  id: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  sender: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  recipient: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  encrypted_payload: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  encrypted_payload_self: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  nonce: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  signature: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  timestamp: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  block_height: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'pending',
  },
  sender_hash: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  recipient_hash: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  dialog_hash: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  attachment_part1: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  attachment_part2: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  reply_to_id: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  reply_to_text: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  reply_to_sender: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  read_at: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  edited_at: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  edit_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
}, {
  sequelize,
  modelName: 'Message',
  indexes: [
    { fields: ['dialog_hash'] },
    { fields: ['sender_hash'] },
    { fields: ['recipient_hash'] },
    { unique: true, fields: ['sender_hash', 'recipient_hash', 'timestamp'], name: 'msg_dedup_idx' }
  ]
});

export class Reaction extends Model {
  declare id: number;
  declare message_id: string;
  declare user_address: string;
  declare emoji: string;
}

Reaction.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  message_id: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  user_address: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  emoji: {
    type: DataTypes.STRING(8),
    allowNull: false,
  },
}, {
  sequelize,
  modelName: 'Reaction',
  indexes: [
    { fields: ['message_id'] },
    { unique: true, fields: ['message_id', 'user_address', 'emoji'] }
  ]
});

// ── Room / Channel / Group Models ──────────────────────

export class Room extends Model {
  declare id: string;
  declare name: string;
  declare created_by: string;
  declare is_private: boolean;
  declare type: string;
}

Room.init({
  id: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  created_by: { type: DataTypes.STRING, allowNull: false },
  is_private: { type: DataTypes.BOOLEAN, defaultValue: false },
  type: { type: DataTypes.STRING, defaultValue: 'channel' },
}, {
  sequelize,
  modelName: 'Room',
  indexes: [{ fields: ['type'] }],
});

export class RoomMember extends Model {
  declare id: number;
  declare room_id: string;
  declare user_id: string;
}

RoomMember.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  room_id: { type: DataTypes.STRING, allowNull: false },
  user_id: { type: DataTypes.STRING, allowNull: false },
}, {
  sequelize,
  modelName: 'RoomMember',
  indexes: [{ unique: true, fields: ['room_id', 'user_id'] }],
});

export class RoomMessage extends Model {
  declare id: string;
  declare room_id: string;
  declare sender: string;
  declare sender_name: string;
  declare text: string;
  declare timestamp: number;
}

RoomMessage.init({
  id: { type: DataTypes.STRING, primaryKey: true },
  room_id: { type: DataTypes.STRING, allowNull: false },
  sender: { type: DataTypes.STRING, allowNull: false },
  sender_name: { type: DataTypes.STRING, allowNull: true },
  text: { type: DataTypes.TEXT, allowNull: false },
  timestamp: { type: DataTypes.BIGINT, allowNull: false },
}, {
  sequelize,
  modelName: 'RoomMessage',
  indexes: [{ fields: ['room_id'] }],
});

// ── Room Encryption Keys ──────────────────────

export class RoomKey extends Model {
  declare id: number;
  declare room_id: string;
  declare user_address: string;
  declare encrypted_room_key: string; // NaCl box encrypted symmetric key
  declare nonce: string;
  declare sender_public_key: string; // Public key of the user who encrypted this entry
}

RoomKey.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  room_id: { type: DataTypes.STRING, allowNull: false },
  user_address: { type: DataTypes.STRING, allowNull: false },
  encrypted_room_key: { type: DataTypes.TEXT, allowNull: false },
  nonce: { type: DataTypes.STRING, allowNull: false },
  sender_public_key: { type: DataTypes.STRING, allowNull: false },
}, {
  sequelize,
  modelName: 'RoomKey',
  indexes: [
    { unique: true, fields: ['room_id', 'user_address'] },
    { fields: ['room_id'] }
  ],
});

// ── Pinned Messages ──────────────────────

export class PinnedMessage extends Model {
  declare id: number;
  declare context_id: string;  // dialogHash or roomId
  declare message_id: string;
  declare pinned_by: string;
  declare message_text: string;
}

PinnedMessage.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  context_id: { type: DataTypes.STRING, allowNull: false },
  message_id: { type: DataTypes.STRING, allowNull: false },
  pinned_by: { type: DataTypes.STRING, allowNull: false },
  message_text: { type: DataTypes.TEXT, allowNull: true },
}, {
  sequelize,
  modelName: 'PinnedMessage',
  indexes: [
    { fields: ['context_id'] },
    { unique: true, fields: ['context_id', 'message_id'] }
  ],
});

// ── User Preferences ──────────────────────

export class UserPreferences extends Model {
  declare address: string;
  declare pinned_chats: string; // JSON array
  declare muted_chats: string; // JSON array
  declare deleted_chats: string; // JSON array
  declare saved_contacts: string; // JSON array of {address, name}
  declare disappear_timers: string; // JSON object
  declare blocked_users: string; // JSON array of addresses
  declare encrypted_keys: string | null; // JSON object with publicKey/secretKey
  declare key_nonce: string | null;
  declare settings: string; // JSON object — toggleable user settings
  declare migrated: boolean; // Whether localStorage migration is complete
}

UserPreferences.init({
  address: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  pinned_chats: {
    type: DataTypes.TEXT,
    defaultValue: '[]',
  },
  muted_chats: {
    type: DataTypes.TEXT,
    defaultValue: '[]',
  },
  deleted_chats: {
    type: DataTypes.TEXT,
    defaultValue: '[]',
  },
  saved_contacts: {
    type: DataTypes.TEXT,
    defaultValue: '[]',
  },
  disappear_timers: {
    type: DataTypes.TEXT,
    defaultValue: '{}',
  },
  blocked_users: {
    type: DataTypes.TEXT,
    defaultValue: '[]',
  },
  encrypted_keys: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  key_nonce: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  settings: {
    type: DataTypes.TEXT,
    defaultValue: '{}',
  },
  migrated: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  sequelize,
  modelName: 'UserPreferences',
  timestamps: true,
});

// ── Message Edit History ──────────────────────

export class MessageEditHistory extends Model {
  declare id: number;
  declare message_id: string;
  declare previous_payload: string;
  declare previous_payload_self: string;
  declare edited_by: string;
  declare edited_at: number;
}

MessageEditHistory.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  message_id: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  previous_payload: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  previous_payload_self: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  edited_by: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  edited_at: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
}, {
  sequelize,
  modelName: 'MessageEditHistory',
  timestamps: false,
  indexes: [{ fields: ['message_id'] }],
});

// ── Deleted Message Audit ──────────────────────

export class DeletedMessage extends Model {
  declare id: number;
  declare message_id: string;
  declare dialog_hash: string;
  declare deleted_by: string;
  declare deleted_at: number;
  declare sender: string;
  declare recipient: string;
}

DeletedMessage.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  message_id: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  dialog_hash: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  deleted_by: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  deleted_at: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  sender: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  recipient: {
    type: DataTypes.STRING,
    allowNull: true,
  },
}, {
  sequelize,
  modelName: 'DeletedMessage',
  timestamps: false,
  indexes: [{ fields: ['dialog_hash'] }, { fields: ['deleted_by'] }],
});

// ── IPFS Pin Tracking ──────────────────────

export class PinnedFile extends Model {
  declare id: number;
  declare cid: string;
  declare uploader_address: string;
  declare file_name: string;
  declare file_size: number;
  declare mime_type: string;
  declare pin_status: string;
  declare last_verified: number;
  declare context: string;
}

PinnedFile.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  cid: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  uploader_address: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  file_name: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  file_size: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  mime_type: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  pin_status: {
    type: DataTypes.STRING(20),
    defaultValue: 'pinned', // pinned | lost | re-pinned
  },
  last_verified: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  context: {
    type: DataTypes.STRING, // 'avatar' | 'attachment' | 'other'
    defaultValue: 'attachment',
  },
}, {
  sequelize,
  modelName: 'PinnedFile',
  timestamps: true,
  indexes: [{ fields: ['uploader_address'] }, { fields: ['pin_status'] }],
});

// ── Persistent Sessions ──────────────────────

export class SessionRecord extends Model {
  declare token: string;
  declare address: string;
  declare limited: boolean;
  declare created_at: number;
}

SessionRecord.init({
  token: {
    type: DataTypes.STRING,
    primaryKey: true,
  },
  address: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  limited: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  created_at: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
}, {
  sequelize,
  modelName: 'SessionRecord',
  timestamps: false,
  indexes: [{ fields: ['address'] }],
});

export const initDB = async () => {
  // Apply SQLCipher encryption key before any other DB operations (SQLite only)
  if (usingSQLite && process.env.DB_ENCRYPTION_KEY) {
    await sequelize.query(`PRAGMA key = '${process.env.DB_ENCRYPTION_KEY.replace(/'/g, "''")}'`);
    console.log('[DB] SQLCipher PRAGMA key applied');
  }

  // Test connection (important for PostgreSQL)
  await sequelize.authenticate();
  console.log('[DB] Connection established successfully');

  await sequelize.sync({ alter: true });
  const status = await SyncStatus.findOne();
  if (!status) {
    await SyncStatus.create({ last_block_height: 0 });
  }
};

export { sequelize };
