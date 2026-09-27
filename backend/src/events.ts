import type { Response } from 'express';
import { billState } from './db.js';

/**
 * One Server-Sent Events stream per bill. Any mutation calls broadcast(), which
 * pushes the whole room state to everyone watching — no library, no WebSocket
 * upgrade, and the browser reconnects on its own if the connection drops.
 */
const rooms = new Map<string, Set<Response>>();

export function subscribe(code: string, res: Response): () => void {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // stop proxies buffering the stream
  });
  res.flushHeaders?.();

  const room = rooms.get(code) ?? new Set<Response>();
  room.add(res);
  rooms.set(code, room);

  // Send the current state immediately so a fresh subscriber is never blank.
  send(res, billState(code));

  // Comment frames keep intermediaries from closing an idle connection.
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);

  return () => {
    clearInterval(keepAlive);
    room.delete(res);
    if (room.size === 0) rooms.delete(code);
  };
}

function send(res: Response, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function broadcast(code: string): void {
  const room = rooms.get(code);
  if (!room?.size) return;

  const state = billState(code);
  for (const res of room) {
    try {
      send(res, state);
    } catch {
      room.delete(res); // client vanished mid-write
    }
  }
}

export const listenerCount = (code: string): number => rooms.get(code)?.size ?? 0;
