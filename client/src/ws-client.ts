type MessageHandler = (data: any) => void;

/**
 * WebSocket client with auto-reconnect and typed event handling.
 */
export class GhostWS {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers = new Map<string, MessageHandler[]>();
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private shouldReconnect = true;

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    this.shouldReconnect = true;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('[WS] Connected');
      this.reconnectDelay = 1000;
      this.emit('_connected', {});
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.emit(data.type, data);
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    };

    this.ws.onclose = () => {
      console.log('[WS] Disconnected');
      this.emit('_disconnected', {});
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      }
    };

    this.ws.onerror = () => this.ws?.close();
  }

  send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  on(type: string, handler: MessageHandler): void {
    const list = this.handlers.get(type) || [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  off(type: string, handler: MessageHandler): void {
    const list = this.handlers.get(type) || [];
    this.handlers.set(type, list.filter(h => h !== handler));
  }

  private emit(type: string, data: any): void {
    const list = this.handlers.get(type) || [];
    for (const h of list) {
      try { h(data); } catch (e) { console.error('[WS] Handler error:', e); }
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.ws?.close();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
