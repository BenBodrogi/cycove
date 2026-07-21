// Thin WebSocket client for the relay — see docs/api/asyncapi.yaml.
// Auth-as-first-message, matching the server (backend/src/routes/connect.ts).
//
// Generic to-device event transport, not just chat messages — carries both
// encrypted messages (event_type "m.room.encrypted") and plain
// verification-protocol messages (event_type "m.key.verification.*") the
// same way. See docs/crypto-integration-notes.md for why.

export interface DeliveredToDeviceEvent {
  message_id: string;
  sender_device_id: string;
  sender_user_id: string;
  event_type: string;
  content: unknown;
}

export class RelayConnection {
  private socket!: WebSocket;
  private authResolve!: () => void;
  private authPromise!: Promise<void>;
  private readonly sessionToken: string;
  private readonly onDeliver: (msg: DeliveredToDeviceEvent) => void;
  // Frames sent while the socket isn't OPEN (mid-reconnect) would otherwise be
  // silently dropped: browsers no-op WebSocket.send() on a CLOSING/CLOSED
  // socket instead of throwing, so a decline/accept sent during a reconnect
  // window vanished with no error anywhere. Queue and flush on reconnect instead.
  private outbox: string[] = [];
  private reconnectAttempts = 0;
  private closedByCaller = false;

  constructor(sessionToken: string, onDeliver: (msg: DeliveredToDeviceEvent) => void) {
    this.sessionToken = sessionToken;
    this.onDeliver = onDeliver;
    this.connect();
  }

  private connect(): void {
    this.authPromise = new Promise((resolve) => {
      this.authResolve = resolve;
    });

    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000';
    const wsUrl = apiBase.replace(/^http/, 'ws') + '/v1/connect';
    this.socket = new WebSocket(wsUrl);

    this.socket.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.socket.send(JSON.stringify({ type: 'auth', token: this.sessionToken }));
    });

    this.socket.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data as string);
      if (msg.type === 'queueFlush') {
        this.authResolve();
        this.flushOutbox();
        for (const m of msg.messages as DeliveredToDeviceEvent[]) this.onDeliver(m);
      } else if (msg.type === 'toDeviceEvent') {
        this.onDeliver(msg as DeliveredToDeviceEvent);
      } else if (msg.type === 'error') {
        console.error('relay error:', msg.error);
      }
    });

    this.socket.addEventListener('error', (event) => {
      console.error('WebSocket error', event);
    });

    this.socket.addEventListener('close', () => {
      if (this.closedByCaller) return;
      const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
      this.reconnectAttempts += 1;
      setTimeout(() => this.connect(), delay);
    });
  }

  private flushOutbox(): void {
    const pending = this.outbox;
    this.outbox = [];
    for (const frame of pending) this.socket.send(frame);
  }

  private sendFrame(frame: Record<string, unknown>): void {
    const data = JSON.stringify(frame);
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(data);
    } else {
      this.outbox.push(data);
    }
  }

  /** Resolves once auth succeeded and the initial queueFlush has been received. */
  ready(): Promise<void> {
    return this.authPromise;
  }

  sendToDevice(recipientDeviceId: string, eventType: string, content: unknown): void {
    this.sendFrame({ type: 'sendToDevice', recipient_device_id: recipientDeviceId, event_type: eventType, content });
  }

  ack(messageId: string): void {
    this.sendFrame({ type: 'deliveryAck', message_id: messageId });
  }

  close(): void {
    this.closedByCaller = true;
    this.socket.close();
  }
}
