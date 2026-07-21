import type WebSocket from 'ws';

// In-memory registry of currently-connected device sockets. Single backend
// instance only — if this ever runs as multiple instances behind a load
// balancer, cross-instance routing needs Redis pub/sub instead (see
// Projects/CyCove.md -> Architecture -> Backend, "Redis: active WebSocket
// session routing"). Not needed for a single Phase 1 instance.
const connections = new Map<string, WebSocket>();

export function registerConnection(deviceId: string, socket: WebSocket): void {
  connections.set(deviceId, socket);
}

// Only removes the entry if it still points at *this* socket — guards
// against a reconnect's new socket being wiped out by the old socket's
// delayed 'close' event.
export function unregisterConnection(deviceId: string, socket: WebSocket): void {
  if (connections.get(deviceId) === socket) {
    connections.delete(deviceId);
  }
}

export function getConnection(deviceId: string): WebSocket | undefined {
  return connections.get(deviceId);
}
