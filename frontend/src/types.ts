export interface Message {
  id: string;
  text: string;
  sender: string;
  isUser: boolean;
  timestamp: Date;
}

export interface User {
  username: string; // Will act as display name
  walletAddress: string;
}

export interface Contact {
  id: string;
  name: string;
  description: string;
  context: string;
  initials: string;
  address?: string; // Aleo wallet address
  lastMessage?: string;
  lastMessageTime?: Date;
  unreadCount?: number;
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
}