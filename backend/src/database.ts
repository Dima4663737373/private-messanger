import { Sequelize, DataTypes, Model } from 'sequelize';
import path from 'path';

// SQLCipher encryption: set DB_ENCRYPTION_KEY env var to enable
// If not set, falls back to unencrypted sqlite3
const DB_ENCRYPTION_KEY = process.env.DB_ENCRYPTION_KEY;

let dialectModule: any;
if (DB_ENCRYPTION_KEY) {
  try {
    dialectModule = require('@journeyapps/sqlcipher');
    console.log('[DB] SQLCipher module loaded — encryption will be enabled');
  } catch {
    console.warn('[DB] DB_ENCRYPTION_KEY set but @journeyapps/sqlcipher not installed — running unencrypted');
  }
}

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../database.sqlite'),
  logging: false,
  ...(dialectModule ? { dialectModule } : {}),
});

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
  declare encryption_public_key: string; // Stored as JSON string of parts or combined
  declare address_hash: string;
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
  declare disappear_timers: string; // JSON object
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
  disappear_timers: {
    type: DataTypes.TEXT,
    defaultValue: '{}',
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

export const initDB = async () => {
  // Apply SQLCipher encryption key before any other DB operations
  if (DB_ENCRYPTION_KEY && dialectModule) {
    await sequelize.query(`PRAGMA key = '${DB_ENCRYPTION_KEY.replace(/'/g, "''")}'`);
    console.log('[DB] SQLCipher PRAGMA key applied');
  }

  await sequelize.sync({ alter: true });
  const status = await SyncStatus.findOne();
  if (!status) {
    await SyncStatus.create({ last_block_height: 0 });
  }
};

export { sequelize };
