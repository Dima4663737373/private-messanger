import { Sequelize, DataTypes, Model } from 'sequelize';
import path from 'path';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../ghost.sqlite');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: DB_PATH,
  logging: false,
});

// ── Models ──────────────────────────────────────────

export class UserModel extends Model {
  declare id: string;
  declare username: string;
  declare public_key: string;
}

UserModel.init({
  id: { type: DataTypes.STRING, primaryKey: true },
  username: { type: DataTypes.STRING, allowNull: false, unique: true },
  public_key: { type: DataTypes.STRING, allowNull: false },
}, { sequelize, modelName: 'User', timestamps: true });

export class RoomModel extends Model {
  declare id: string;
  declare name: string;
  declare created_by: string;
  declare is_private: boolean;
  declare type: 'channel' | 'group';
}

RoomModel.init({
  id: { type: DataTypes.STRING, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  created_by: { type: DataTypes.STRING, allowNull: false },
  is_private: { type: DataTypes.BOOLEAN, defaultValue: false },
  type: { type: DataTypes.STRING, defaultValue: 'channel', allowNull: false },
}, {
  sequelize, modelName: 'Room', timestamps: true,
  indexes: [{ fields: ['type'] }]
});

export class RoomMemberModel extends Model {
  declare room_id: string;
  declare user_id: string;
  declare encrypted_room_key: string;
}

RoomMemberModel.init({
  room_id: { type: DataTypes.STRING, allowNull: false },
  user_id: { type: DataTypes.STRING, allowNull: false },
  encrypted_room_key: { type: DataTypes.TEXT, allowNull: true },
}, {
  sequelize, modelName: 'RoomMember', timestamps: true,
  indexes: [{ unique: true, fields: ['room_id', 'user_id'] }]
});

export class MessageModel extends Model {
  declare id: string;
  declare room_id: string | null;
  declare sender_id: string;
  declare recipient_id: string | null;
  declare payload: string;
  declare nonce: string;
  declare timestamp: number;
}

MessageModel.init({
  id: { type: DataTypes.STRING, primaryKey: true },
  room_id: { type: DataTypes.STRING, allowNull: true },
  sender_id: { type: DataTypes.STRING, allowNull: false },
  recipient_id: { type: DataTypes.STRING, allowNull: true },
  payload: { type: DataTypes.TEXT, allowNull: false },
  nonce: { type: DataTypes.STRING, allowNull: false },
  timestamp: { type: DataTypes.BIGINT, allowNull: false },
}, {
  sequelize, modelName: 'Message', timestamps: false,
  indexes: [
    { fields: ['room_id'] },
    { fields: ['sender_id'] },
    { fields: ['recipient_id'] },
    { fields: ['timestamp'] }
  ]
});

// ── Init ──────────────────────────────────────────

export async function initDB() {
  await sequelize.sync({ alter: true });
  console.log('[DB] SQLite ready');
}

export { sequelize };
