import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { v4 as uuid } from 'uuid';
import { ClientMsg, ServerMsg, User, Room } from './types';
import { UserModel, RoomModel, RoomMemberModel, MessageModel } from './database';
import { Op } from 'sequelize';
import { secretStore } from './secret-store';

interface ConnectedClient {
  ws: WebSocket;
  user: User | null;
  rooms: Set<string>;
  lastSeen: number;
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server });
  const clients = new Map<WebSocket, ConnectedClient>();

  // ── Helpers ──────────────────────────────────────

  function send(ws: WebSocket, msg: ServerMsg) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function broadcast(msg: ServerMsg, filter?: (c: ConnectedClient) => boolean) {
    for (const [, client] of clients) {
      if (client.user && (!filter || filter(client))) {
        send(client.ws, msg);
      }
    }
  }

  function broadcastToRoom(roomId: string, msg: ServerMsg, exclude?: WebSocket) {
    for (const [ws, client] of clients) {
      if (client.rooms.has(roomId) && ws !== exclude) {
        send(ws, msg);
      }
    }
  }

  function getOnlineUsers(): Pick<User, 'id' | 'username' | 'publicKey'>[] {
    const users: Pick<User, 'id' | 'username' | 'publicKey'>[] = [];
    for (const [, c] of clients) {
      if (c.user) users.push({ id: c.user.id, username: c.user.username, publicKey: c.user.publicKey });
    }
    return users;
  }

  function findClientByUserId(userId: string): ConnectedClient | undefined {
    for (const [, c] of clients) {
      if (c.user?.id === userId) return c;
    }
    return undefined;
  }

  // ── Rate Limiting ──────────────────────────────

  const msgTimestamps = new WeakMap<WebSocket, number[]>();
  const MSG_LIMIT = 30;
  const MSG_WINDOW = 60_000;

  function rateLimit(ws: WebSocket): boolean {
    const now = Date.now();
    let ts = msgTimestamps.get(ws) || [];
    ts = ts.filter(t => now - t < MSG_WINDOW);
    if (ts.length >= MSG_LIMIT) return false;
    ts.push(now);
    msgTimestamps.set(ws, ts);
    return true;
  }

  // ── Connection Handler ─────────────────────────

  wss.on('connection', (ws: WebSocket) => {
    const client: ConnectedClient = { ws, user: null, rooms: new Set(), lastSeen: Date.now() };
    clients.set(ws, client);

    ws.on('message', async (raw) => {
      if (!rateLimit(ws)) {
        send(ws, { type: 'error', message: 'Rate limit exceeded' });
        return;
      }

      let data: ClientMsg;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      client.lastSeen = Date.now();

      try {
        switch (data.type) {

          // ── Auth ──
          case 'auth': {
            if (!data.username || !data.publicKey) {
              send(ws, { type: 'error', message: 'username and publicKey required' });
              return;
            }
            const username = data.username.slice(0, 50);
            const publicKey = data.publicKey.slice(0, 200);

            // Upsert user
            let [user, created] = await UserModel.findOrCreate({
              where: { username },
              defaults: { id: uuid(), username, public_key: publicKey }
            });

            if (!created) {
              await user.update({ public_key: publicKey });
            }

            client.user = {
              id: user.id,
              username: user.username,
              publicKey: user.public_key,
              createdAt: new Date(user.getDataValue('createdAt')).getTime()
            };

            // Load user's rooms
            const memberships = await RoomMemberModel.findAll({ where: { user_id: user.id } });
            for (const m of memberships) {
              client.rooms.add(m.room_id);
            }

            send(ws, { type: 'auth_ok', userId: user.id, users: getOnlineUsers() });

            // Send user's rooms (channels + groups they belong to)
            const userRooms = await RoomModel.findAll({
              where: { id: Array.from(client.rooms) }
            });
            const roomList: Room[] = userRooms.map(r => ({
              id: r.id, name: r.name, createdBy: r.created_by,
              isPrivate: r.is_private, type: r.type || 'channel',
              createdAt: new Date(r.getDataValue('createdAt')).getTime()
            }));
            send(ws, { type: 'room_list', rooms: roomList });

            // Notify others
            broadcast(
              { type: 'user_joined', user: { id: user.id, username: user.username, publicKey: user.public_key } },
              c => c.ws !== ws
            );

            // Send pending secrets
            const pending = secretStore.pendingFor(user.id);
            for (const p of pending) {
              send(ws, { type: 'secret_available', id: p.id, senderId: p.senderId, aleoHash: p.aleoHash });
            }
            break;
          }

          // ── Create Room (channel or group) ──
          case 'create_room': {
            if (!client.user) return;
            const roomId = uuid();
            const name = (data.name || 'Unnamed').slice(0, 100);
            const roomType = data.roomType === 'group' ? 'group' : 'channel';
            const isPrivate = roomType === 'group' ? true : (data.isPrivate || false);

            await RoomModel.create({ id: roomId, name, created_by: client.user.id, is_private: isPrivate, type: roomType });
            await RoomMemberModel.create({ room_id: roomId, user_id: client.user.id });
            client.rooms.add(roomId);

            const room: Room = { id: roomId, name, createdBy: client.user.id, isPrivate: isPrivate, type: roomType, createdAt: Date.now() };
            send(ws, { type: 'room_created', room });
            // Channels are broadcast to everyone; groups only to creator
            if (roomType === 'channel') {
              broadcast({ type: 'room_created', room }, c => c.ws !== ws);
            }
            break;
          }

          // ── Join Room ──
          case 'join_room': {
            if (!client.user) return;
            const room = await RoomModel.findByPk(data.roomId);
            if (!room) { send(ws, { type: 'error', message: 'Room not found' }); return; }

            await RoomMemberModel.findOrCreate({
              where: { room_id: data.roomId, user_id: client.user.id },
              defaults: { room_id: data.roomId, user_id: client.user.id, encrypted_room_key: data.encryptedRoomKey || '' }
            });
            client.rooms.add(data.roomId);

            const members = await RoomMemberModel.findAll({ where: { room_id: data.roomId } });
            send(ws, { type: 'room_joined', roomId: data.roomId, userId: client.user.id, members: members.map(m => m.user_id) });
            broadcastToRoom(data.roomId, { type: 'room_joined', roomId: data.roomId, userId: client.user.id, members: members.map(m => m.user_id) }, ws);
            break;
          }

          // ── Leave Room ──
          case 'leave_room': {
            if (!client.user) return;
            await RoomMemberModel.destroy({ where: { room_id: data.roomId, user_id: client.user.id } });
            client.rooms.delete(data.roomId);
            broadcastToRoom(data.roomId, { type: 'room_left', roomId: data.roomId, userId: client.user.id });
            break;
          }

          // ── Delete Room (only creator) ──
          case 'delete_room': {
            if (!client.user) return;
            const roomToDelete = await RoomModel.findByPk(data.roomId);
            if (!roomToDelete) { send(ws, { type: 'error', message: 'Room not found' }); return; }
            if (roomToDelete.created_by !== client.user.id) {
              send(ws, { type: 'error', message: 'Only the creator can delete this room' });
              return;
            }

            // Notify all members before deletion
            broadcastToRoom(data.roomId, { type: 'room_deleted', roomId: data.roomId });
            send(ws, { type: 'room_deleted', roomId: data.roomId });

            // Remove all room members from their client.rooms sets
            for (const [, c] of clients) {
              c.rooms.delete(data.roomId);
            }

            // Delete messages, members, and room from DB
            await MessageModel.destroy({ where: { room_id: data.roomId } });
            await RoomMemberModel.destroy({ where: { room_id: data.roomId } });
            await roomToDelete.destroy();
            break;
          }

          // ── Clear DM history ──
          case 'clear_dm': {
            if (!client.user) return;
            if (!data.recipientId) return;
            await MessageModel.destroy({
              where: {
                room_id: null,
                [Op.or]: [
                  { sender_id: client.user.id, recipient_id: data.recipientId },
                  { sender_id: data.recipientId, recipient_id: client.user.id }
                ]
              }
            });
            send(ws, { type: 'dm_cleared', recipientId: data.recipientId });
            // Also notify the other user
            const otherClient = findClientByUserId(data.recipientId);
            if (otherClient) {
              send(otherClient.ws, { type: 'dm_cleared', recipientId: client.user.id });
            }
            break;
          }

          // ── Message (Room or DM) ──
          case 'message': {
            if (!client.user) return;
            if (!data.payload || !data.nonce) return;

            const msgId = uuid();
            const timestamp = Date.now();

            await MessageModel.create({
              id: msgId,
              room_id: data.roomId || null,
              sender_id: client.user.id,
              recipient_id: data.recipientId || null,
              payload: data.payload.slice(0, 50_000),
              nonce: data.nonce.slice(0, 200),
              timestamp
            });

            const msg = {
              id: msgId,
              roomId: data.roomId || null,
              senderId: client.user.id,
              recipientId: data.recipientId || null,
              payload: data.payload,
              nonce: data.nonce,
              timestamp
            };

            if (data.roomId) {
              // Room message → broadcast to room
              broadcastToRoom(data.roomId, { type: 'message', message: msg });
            } else if (data.recipientId) {
              // DM → send to recipient + echo to sender
              send(ws, { type: 'message', message: msg });
              const recipientClient = findClientByUserId(data.recipientId);
              if (recipientClient) send(recipientClient.ws, { type: 'message', message: msg });
            }
            break;
          }

          // ── Secret Message (one-time) ──
          case 'secret': {
            if (!client.user) return;
            if (!data.recipientId || !data.payload || !data.ephemeralPk || !data.nonce) return;

            const secretId = uuid();
            const SECRET_TTL = 24 * 60 * 60_000; // 24 hours

            secretStore.add({
              id: secretId,
              senderId: client.user.id,
              recipientId: data.recipientId,
              payload: data.payload.slice(0, 50_000),
              ephemeralPk: data.ephemeralPk.slice(0, 200),
              nonce: data.nonce.slice(0, 200),
              aleoHash: data.aleoHash.slice(0, 300),
              createdAt: Date.now(),
              expiresAt: Date.now() + SECRET_TTL
            });

            // Notify recipient
            const recipientClient = findClientByUserId(data.recipientId);
            if (recipientClient) {
              send(recipientClient.ws, { type: 'secret_available', id: secretId, senderId: client.user.id, aleoHash: data.aleoHash });
            }

            // Confirm to sender
            send(ws, { type: 'secret_available', id: secretId, senderId: client.user.id, aleoHash: data.aleoHash });
            break;
          }

          // ── Read Secret (one-time retrieval) ──
          case 'read_secret': {
            if (!client.user) return;
            const secret = secretStore.readAndDestroy(data.messageId, client.user.id);
            if (!secret) {
              send(ws, { type: 'error', message: 'Secret not found or already read' });
              return;
            }
            send(ws, { type: 'secret_data', message: secret });

            // Notify sender that secret was read
            const senderClient = findClientByUserId(secret.senderId);
            if (senderClient) {
              send(senderClient.ws, { type: 'secret_read', messageId: data.messageId });
            }
            break;
          }

          // ── Typing ──
          case 'typing': {
            if (!client.user) return;
            if (data.roomId) {
              broadcastToRoom(data.roomId, { type: 'typing', userId: client.user.id, roomId: data.roomId }, ws);
            } else if (data.recipientId) {
              const r = findClientByUserId(data.recipientId);
              if (r) send(r.ws, { type: 'typing', userId: client.user.id });
            }
            break;
          }

          case 'heartbeat':
            break;
        }
      } catch (e) {
        console.error('[WS] Handler error:', e);
        send(ws, { type: 'error', message: 'Internal error' });
      }
    });

    ws.on('close', () => {
      const user = client.user;
      clients.delete(ws);
      if (user) {
        broadcast({ type: 'user_left', userId: user.id });
        broadcast({ type: 'online', userId: user.id, online: false });
      }
    });

    ws.on('error', () => ws.close());
  });

  return wss;
}
