import { SecretMessage } from './types';

/**
 * In-memory store for one-time secret messages.
 * Messages are NEVER written to disk.
 * Auto-cleanup removes expired messages every 60 seconds.
 */
class SecretStore {
  private secrets = new Map<string, SecretMessage>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Cleanup expired secrets every 60s
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  add(msg: SecretMessage): void {
    this.secrets.set(msg.id, msg);
  }

  /** Read and DELETE — one-time retrieval */
  readAndDestroy(id: string, recipientId: string): SecretMessage | null {
    const msg = this.secrets.get(id);
    if (!msg) return null;
    if (msg.recipientId !== recipientId) return null;
    if (Date.now() > msg.expiresAt) {
      this.secrets.delete(id);
      return null;
    }
    this.secrets.delete(id);
    return msg;
  }

  /** Check if a secret exists for a recipient (without reading it) */
  exists(id: string): boolean {
    return this.secrets.has(id);
  }

  /** Get pending secret IDs for a recipient */
  pendingFor(recipientId: string): { id: string; senderId: string; aleoHash: string }[] {
    const result: { id: string; senderId: string; aleoHash: string }[] = [];
    for (const [id, msg] of this.secrets) {
      if (msg.recipientId === recipientId && Date.now() <= msg.expiresAt) {
        result.push({ id, senderId: msg.senderId, aleoHash: msg.aleoHash });
      }
    }
    return result;
  }

  private cleanup(): void {
    const now = Date.now();
    let removed = 0;
    for (const [id, msg] of this.secrets) {
      if (now > msg.expiresAt) {
        this.secrets.delete(id);
        removed++;
      }
    }
    if (removed > 0) console.log(`[Secret] Cleaned up ${removed} expired secrets`);
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.secrets.clear();
  }
}

export const secretStore = new SecretStore();
