const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

// ── Users ──────────────────────────────────────

export async function fetchUsers(): Promise<any[]> {
  return request('/users');
}

export async function fetchUser(id: string): Promise<any> {
  return request(`/users/${id}`);
}

// ── Rooms ──────────────────────────────────────

export async function fetchRooms(): Promise<any[]> {
  return request('/rooms');
}

export async function fetchChannels(): Promise<any[]> {
  return request('/rooms?type=channel');
}

export async function fetchGroups(userId: string): Promise<any[]> {
  return request(`/rooms?type=group&userId=${encodeURIComponent(userId)}`);
}

export async function fetchRoom(id: string): Promise<any> {
  return request(`/rooms/${id}`);
}

// ── Messages ──────────────────────────────────

export async function fetchRoomMessages(roomId: string, limit = 50, offset = 0): Promise<any[]> {
  return request(`/messages/room/${roomId}?limit=${limit}&offset=${offset}`);
}

export async function fetchDMMessages(userId1: string, userId2: string, limit = 50, offset = 0): Promise<any[]> {
  return request(`/messages/dm/${userId1}/${userId2}?limit=${limit}&offset=${offset}`);
}

// ── Aleo Verification ──────────────────────────

export async function verifyAleoHash(hash: string): Promise<{ exists: boolean; sender: string | null }> {
  return request(`/aleo/verify/${encodeURIComponent(hash)}`);
}
