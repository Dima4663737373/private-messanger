
import { Chat, Message, User } from './types';

export const COLORS = {
  BLACK: '#0A0A0A',
  WHITE: '#FAFAFA',
  ACCENT: '#FF8C00',
  ACCENT_GLOW: 'rgba(255, 140, 0, 0.4)',
  DARK_GRAY: '#1A1A1A',
  MEDIUM_GRAY: '#2A2A2A',
  GRAY_TEXT: '#666666',
  ONLINE: '#10B981',
};

export const MOCK_USER: User = {
  id: 'me',
  name: 'Ghost Operator',
  wallet: '0x71C...4f9',
  balance: '1.245 ETH',
  avatar: 'https://images.unsplash.com/photo-1633332755192-727a05c4013d?w=100&h=100&fit=crop',
};

export const MOCK_CHATS: Chat[] = [
  {
    id: '1',
    name: 'Satoshi',
    avatar: 'https://images.unsplash.com/photo-1568602471122-7832951cc4c5?w=100&h=100&fit=crop',
    status: 'online',
    lastMessage: 'The ghost is in the machine.',
    time: '12:45 PM',
    unreadCount: 3,
    type: 'private',
  },
  {
    id: '2',
    name: 'Phantom Squad',
    avatar: 'https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=100&h=100&fit=crop',
    status: 'online',
    lastMessage: 'Encryption keys rotated.',
    time: '10:30 AM',
    unreadCount: 0,
    type: 'group',
  },
  {
    id: '3',
    name: 'Vitalik',
    avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&h=100&fit=crop',
    status: 'offline',
    lastMessage: 'PoS is the way.',
    time: 'Yesterday',
    unreadCount: 1,
    type: 'private',
  }
];

export const MOCK_MESSAGES: Record<string, Message[]> = {
  '1': [
    { id: 'm1', text: 'Are you ready for the next drop?', time: '12:30 PM', senderId: '1', isMine: false, status: 'read' },
    { id: 'm2', text: 'Wallet is primed.', time: '12:35 PM', senderId: 'me', isMine: true, status: 'read' },
    { id: 'm3', text: 'The ghost is in the machine.', time: '12:45 PM', senderId: '1', isMine: false, status: 'read' },
  ]
};
