import { Router } from 'express';
import { UserModel, RoomModel, RoomMemberModel, MessageModel } from './database';
import { aleoService } from './aleo';
import { Op } from 'sequelize';

const router = Router();

// ── Input Helpers ──────────────────────────────────

function clamp(val: any, min: number, max: number, fallback: number): number {
  const n = Number(val);
  return isNaN(n) ? fallback : Math.max(min, Math.min(max, Math.floor(n)));
}

// ── Users ──────────────────────────────────────────

router.get('/users', async (_req, res) => {
  const users = await UserModel.findAll({ attributes: ['id', 'username', 'public_key'] });
  res.json(users);
});

router.get('/users/:id', async (req, res) => {
  const user = await UserModel.findByPk(req.params.id, { attributes: ['id', 'username', 'public_key'] });
  user ? res.json(user) : res.status(404).json({ error: 'Not found' });
});

// ── Rooms ──────────────────────────────────────────

router.get('/rooms', async (req, res) => {
  const { type, userId } = req.query;

  if (type === 'channel') {
    const rooms = await RoomModel.findAll({ where: { type: 'channel' } });
    return res.json(rooms);
  }

  if (type === 'group' && userId) {
    const memberships = await RoomMemberModel.findAll({ where: { user_id: String(userId) } });
    const roomIds = memberships.map(m => m.room_id);
    if (roomIds.length === 0) return res.json([]);
    const rooms = await RoomModel.findAll({ where: { id: roomIds, type: 'group' } });
    return res.json(rooms);
  }

  // Default: all non-private rooms
  const rooms = await RoomModel.findAll({ where: { is_private: false } });
  res.json(rooms);
});

router.get('/rooms/:id', async (req, res) => {
  const room = await RoomModel.findByPk(req.params.id);
  if (!room) return res.status(404).json({ error: 'Not found' });

  const members = await RoomMemberModel.findAll({ where: { room_id: req.params.id } });
  res.json({ ...room.toJSON(), members: members.map(m => m.user_id) });
});

router.get('/rooms/:id/members', async (req, res) => {
  const members = await RoomMemberModel.findAll({
    where: { room_id: req.params.id },
    include: [{ model: UserModel, attributes: ['id', 'username', 'public_key'] }]
  });
  res.json(members);
});

// ── Messages ──────────────────────────────────────

router.get('/messages/room/:roomId', async (req, res) => {
  const limit = clamp(req.query.limit, 1, 100, 50);
  const offset = clamp(req.query.offset, 0, 100000, 0);

  const messages = await MessageModel.findAll({
    where: { room_id: req.params.roomId },
    order: [['timestamp', 'DESC']],
    limit, offset
  });
  res.json(messages.reverse());
});

router.get('/messages/dm/:userId1/:userId2', async (req, res) => {
  const { userId1, userId2 } = req.params;
  const limit = clamp(req.query.limit, 1, 100, 50);
  const offset = clamp(req.query.offset, 0, 100000, 0);

  const messages = await MessageModel.findAll({
    where: {
      room_id: null,
      [Op.or]: [
        { sender_id: userId1, recipient_id: userId2 },
        { sender_id: userId2, recipient_id: userId1 }
      ]
    },
    order: [['timestamp', 'DESC']],
    limit, offset
  });
  res.json(messages.reverse());
});

// ── Aleo Verification ──────────────────────────────

router.get('/aleo/verify/:hash', async (req, res) => {
  const exists = await aleoService.verifySecretHash(req.params.hash);
  const sender = exists ? await aleoService.getSecretSender(req.params.hash) : null;
  res.json({ exists, sender });
});

router.get('/aleo/profile/:hash', async (req, res) => {
  const nameHash = await aleoService.getProfile(req.params.hash);
  res.json({ exists: !!nameHash, nameHash });
});

export default router;
